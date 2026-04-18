/**
 * Worker poll interval. Chrome repeating alarms are capped at ~1 minute, so we use
 * short one-shot alarms and reschedule after each tick (see onAlarm).
 * @type {number} seconds between polls when the queue is idle
 */
const POLL_INTERVAL_SEC = 5;
const POLL_ALARM = 'eqd-clipper-poll';

const LOG = '[EQD Clipper]';

/** Runs as soon as the service worker script is parsed (before any async work). */
console.info(LOG, 'background script evaluated', new Date().toISOString());

self.addEventListener('error', (event) => {
  console.error(LOG, 'global error', event.message, event.filename, event.lineno);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error(LOG, 'unhandledrejection', event.reason);
});

function scheduleNextPollTick() {
  const delayMin = Math.max(POLL_INTERVAL_SEC / 60, 1 / 60);
  chrome.alarms.create(
    POLL_ALARM,
    { delayInMinutes: delayMin },
    () => {
      if (chrome.runtime.lastError) {
        console.error(
          LOG,
          'chrome.alarms.create failed',
          chrome.runtime.lastError.message,
        );
        return;
      }
      console.info(LOG, 'scheduled poll alarm in ~', POLL_INTERVAL_SEC, 's');
    },
  );
}

chrome.runtime.onInstalled.addListener((details) => {
  console.info(LOG, 'onInstalled', details.reason);
  void (async () => {
    const cfg = await getConfig();
    if (cfg.pollingEnabled) scheduleNextPollTick();
    else console.info(LOG, 'onInstalled: polling off, open popup and Save to enable');
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  console.info(LOG, 'alarm fired', alarm.name);
  void (async () => {
    await drainQueue();
    const cfg = await getConfig();
    if (cfg.pollingEnabled) scheduleNextPollTick();
    else console.info(LOG, 'alarm: polling disabled, not rescheduling');
  })();
});

chrome.runtime.onMessage.addListener((msg) => {
  console.info(LOG, 'onMessage', msg?.type ?? msg);
  if (msg?.type === 'pollNow') {
    void drainQueue();
    return;
  }
  if (msg?.type === 'pollingSettings') {
    if (msg.enabled) {
      scheduleNextPollTick();
      void drainQueue();
    } else {
      chrome.alarms.clear(POLL_ALARM, () => {
        if (chrome.runtime.lastError) {
          console.warn(LOG, 'alarms.clear', chrome.runtime.lastError.message);
        } else {
          console.info(LOG, 'polling disabled; alarms cleared');
        }
      });
    }
  }
});

async function getConfig() {
  const s = await chrome.storage.local.get([
    'apiBaseUrl',
    'apiToken',
    'pollingEnabled',
  ]);
  return {
    apiBaseUrl: (s.apiBaseUrl || 'http://127.0.0.1:8787').replace(/\/$/, ''),
    apiToken: s.apiToken || '',
    pollingEnabled: !!s.pollingEnabled,
  };
}

async function authFetch(path, options = {}) {
  const { apiBaseUrl, apiToken } = await getConfig();
  const url = `${apiBaseUrl}${path}`;
  console.info(LOG, 'fetch', options.method || 'GET', url);
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${apiToken}`,
  };
  return fetch(url, { ...options, headers });
}

async function drainQueue() {
  console.info(LOG, 'drainQueue() start');
  const cfg = await getConfig();
  if (!cfg.pollingEnabled) {
    console.warn(
      LOG,
      'drainQueue skipped: polling is OFF — enable "Poll for download jobs" in the popup and Save',
    );
    return;
  }
  if (!cfg.apiToken) {
    console.warn(
      LOG,
      'drainQueue skipped: no API token — paste token from dashboard and Save',
    );
    return;
  }

  const maxTasks = 80;
  for (let i = 0; i < maxTasks; i++) {
    const again = await getConfig();
    if (!again.pollingEnabled) break;

    const res = await authFetch('/api/worker/poll', { method: 'POST' });
    if (!res.ok) {
      const hint = await res.text().catch(() => '');
      console.warn(LOG, 'poll failed', res.status, hint);
      break;
    }
    const data = await res.json();
    if (!data.task) {
      console.info(LOG, 'poll: no task (queue empty or all busy)');
      break;
    }

    console.info(LOG, 'running task', data.task.id, data.task.resolveKind, data.task.url);
    const outcome = await runTask(data.task);
    await authFetch('/api/worker/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: data.task.id,
        success: outcome.success,
        error: outcome.error,
      }),
    });
    console.info(LOG, 'task finished', data.task.id, outcome.success, outcome.error || '');
  }
  console.info(LOG, 'drainQueue() end');
}

/**
 * @param {{ id: string, folderName: string, url: string, resolveKind: string }} task
 */
async function runTask(task) {
  try {
    if (task.resolveKind === 'none') {
      await downloadToDisk(task.url, task.folderName);
      return { success: true };
    }
    if (task.resolveKind === 'deviantart') {
      await downloadViaTab('da', task.url, task.folderName);
      return { success: true };
    }
    if (task.resolveKind === 'derpibooru') {
      await downloadViaTab('derpi', task.url, task.folderName);
      return { success: true };
    }
    if (task.resolveKind === 'twitter') {
      await downloadViaTab('twit', task.url, task.folderName);
      return { success: true };
    }
    await downloadToDisk(task.url, task.folderName);
    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('runTask', task, e);
    return { success: false, error: msg };
  }
}

/** @type {{ id: number, settle: (ok: boolean) => void } | null} */
let currentDownload = null;

chrome.downloads.onChanged.addListener((delta) => {
  if (
    currentDownload !== null &&
    delta.id === currentDownload.id &&
    delta.state?.current === 'complete'
  ) {
    chrome.downloads.erase({ id: currentDownload.id }, () => {});
    currentDownload.settle(true);
    currentDownload = null;
  } else if (
    currentDownload !== null &&
    delta.id === currentDownload.id &&
    delta.error
  ) {
    currentDownload.settle(false);
    currentDownload = null;
  }
});

function urlToFilename(url) {
  const i = url.lastIndexOf('/');
  return url.slice(i + 1).split('?')[0] || 'image.bin';
}

/**
 * @param {string} url
 * @param {string} folderName
 * @param {string} [filename]
 */
function downloadToDisk(url, folderName, filename) {
  const fn = filename || urlToFilename(url);
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename: `eqdc/${folderName}/${fn}`,
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (downloadId === undefined) {
          reject(new Error('downloadId missing'));
          return;
        }
        currentDownload = {
          id: downloadId,
          settle: (ok) => {
            if (ok) resolve();
            else reject(new Error('Download failed'));
          },
        };
      },
    );
  });
}

/** @type {null | { kind: string, tabId: number, resolve: () => void, reject: (e: Error) => void, folderName: string, timer: ReturnType<typeof setTimeout> }} */
let resolverSlot = null;

chrome.runtime.onConnect.addListener((port) => {
  const tabId = port.sender?.tab?.id;
  if (port.name === 'daPort') registerDaPort(port, tabId);
  else if (port.name === 'derpiPort') registerDerpiPort(port, tabId);
  else if (port.name === 'twitPort') registerTwitPort(port, tabId);
});

function finishResolver(ok, err) {
  if (!resolverSlot) return;
  clearTimeout(resolverSlot.timer);
  const slot = resolverSlot;
  resolverSlot = null;
  chrome.tabs.remove(slot.tabId, () => {
    if (ok) slot.resolve();
    else slot.reject(err || new Error('Resolver failed'));
  });
}

function registerDaPort(port, tabId) {
  port.onMessage.addListener((msg) => {
    if (
      msg.msg === 'DownloadThis' &&
      resolverSlot &&
      resolverSlot.kind === 'da' &&
      tabId === resolverSlot.tabId
    ) {
      const data = msg.data;
      downloadToDisk(data.url, resolverSlot.folderName, data.filename)
        .then(() => finishResolver(true))
        .catch(() =>
          finishResolver(false, new Error('DeviantArt download failed')),
        );
    } else if (
      msg.msg === 'Error' &&
      resolverSlot &&
      resolverSlot.kind === 'da' &&
      tabId === resolverSlot.tabId
    ) {
      finishResolver(false, new Error('Could not resolve DeviantArt image'));
    }
  });
}

function registerDerpiPort(port, tabId) {
  port.onMessage.addListener((msg) => {
    if (
      msg.msg === 'DownloadThis' &&
      resolverSlot &&
      resolverSlot.kind === 'derpi' &&
      tabId === resolverSlot.tabId
    ) {
      const data = msg.data;
      downloadToDisk(data.url, resolverSlot.folderName)
        .then(() => finishResolver(true))
        .catch(() =>
          finishResolver(false, new Error('Derpibooru download failed')),
        );
    } else if (
      msg.msg === 'Error' &&
      resolverSlot &&
      resolverSlot.kind === 'derpi' &&
      tabId === resolverSlot.tabId
    ) {
      finishResolver(
        false,
        new Error(msg.data?.error || 'Could not resolve Derpibooru image'),
      );
    }
  });
}

function registerTwitPort(port, tabId) {
  port.onMessage.addListener((msg) => {
    if (
      msg.msg === 'DownloadThis' &&
      resolverSlot &&
      resolverSlot.kind === 'twit' &&
      tabId === resolverSlot.tabId
    ) {
      const data = msg.data;
      downloadToDisk(data.url, resolverSlot.folderName, data.filename)
        .then(() => finishResolver(true))
        .catch(() =>
          finishResolver(false, new Error('Twitter download failed')),
        );
    } else if (
      msg.msg === 'Error' &&
      resolverSlot &&
      resolverSlot.kind === 'twit' &&
      tabId === resolverSlot.tabId
    ) {
      finishResolver(false, new Error('Could not resolve Twitter/X image'));
    }
  });
}

/**
 * @param {'da'|'derpi'|'twit'} kind
 * @param {string} pageUrl
 * @param {string} folderName
 */
function downloadViaTab(kind, pageUrl, folderName) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: pageUrl, active: kind !== 'derpi' }, (tab) => {
      if (!tab?.id) {
        reject(new Error('Could not open tab'));
        return;
      }
      const tabId = tab.id;
      const timer = setTimeout(() => {
        if (resolverSlot && resolverSlot.tabId === tabId) {
          const slot = resolverSlot;
          resolverSlot = null;
          chrome.tabs.remove(tabId, () => {});
          slot.reject(new Error('Resolver timed out'));
        }
      }, 120000);

      resolverSlot = {
        kind,
        tabId,
        folderName,
        timer,
        resolve: () => resolve(),
        reject: (e) => reject(e),
      };
    });
  });
}

void (async () => {
  try {
    console.info(LOG, 'startup bootstrap');
    const cfg = await getConfig();
    console.info(LOG, 'config', {
      apiBaseUrl: cfg.apiBaseUrl,
      hasToken: !!cfg.apiToken,
      pollingEnabled: cfg.pollingEnabled,
    });
    if (cfg.pollingEnabled) scheduleNextPollTick();
    await drainQueue();
  } catch (e) {
    console.error(LOG, 'startup bootstrap failed', e);
  }
})();
