/**
 * Worker poll interval. Chrome repeating alarms are capped at ~1 minute, so we use
 * short one-shot alarms and reschedule after each tick (see onAlarm).
 * @type {number} seconds between polls when the queue is idle
 */
const POLL_INTERVAL_SEC = 5;
const POLL_ALARM = 'eqd-clipper-poll';

const LOG = '[EQD Clipper]';

/**
 * Only one drain loop at a time so overlapping alarms / Poll now / startup cannot open parallel resolver tabs.
 * @type {Promise<void>}
 */
let drainChain = Promise.resolve();

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

/**
 * Wait for any in-flight drain, then run one drain pass. Safe to call from alarm, popup, or startup concurrently.
 */
function drainQueue() {
  const next = drainChain.then(() => runDrainQueue());
  drainChain = next.catch(() => {});
  return next;
}

async function runDrainQueue() {
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

/** @type {Map<number, { settle: (ok: boolean) => void }>} */
const downloadsById = new Map();

chrome.downloads.onChanged.addListener((delta) => {
  const id = delta.id;
  if (typeof id !== 'number') return;
  const slot = downloadsById.get(id);
  if (!slot) return;
  if (delta.state?.current === 'complete') {
    chrome.downloads.erase({ id }, () => {});
    downloadsById.delete(id);
    slot.settle(true);
  } else if (delta.error) {
    downloadsById.delete(id);
    slot.settle(false);
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
        downloadsById.set(downloadId, {
          settle: (ok) => {
            if (ok) resolve();
            else reject(new Error('Download failed'));
          },
        });
      },
    );
  });
}

/**
 * Track resolver jobs per tab so we always close the intended tab.
 * @type {Map<number, { kind: 'da'|'derpi'|'twit', folderName: string, resolve: () => void, reject: (e: Error) => void, timer: ReturnType<typeof setTimeout> }>}
 */
const resolversByTabId = new Map();

/** @type {Record<string, { kind: 'da'|'derpi'|'twit', defaultError: string }>} */
const RESOLVER_PORTS = {
  daPort: {
    kind: 'da',
    defaultError: 'Could not resolve DeviantArt image',
  },
  derpiPort: {
    kind: 'derpi',
    defaultError: 'Could not resolve Derpibooru image',
  },
  twitPort: {
    kind: 'twit',
    defaultError: 'Could not resolve Twitter/X image',
  },
};

chrome.runtime.onConnect.addListener((port) => {
  const tabId = port.sender?.tab?.id;
  const def = RESOLVER_PORTS[port.name];
  if (!def) return;
  registerResolverPort(port, tabId, def);
});

/**
 * @param {number} tabId
 * @param {boolean} ok
 * @param {Error} [err]
 */
function finishResolver(tabId, ok, err) {
  const slot = resolversByTabId.get(tabId);
  if (!slot) return;
  resolversByTabId.delete(tabId);
  clearTimeout(slot.timer);
  chrome.tabs.remove(tabId, () => {
    if (ok) slot.resolve();
    else slot.reject(err || new Error('Resolver failed'));
  });
}

/**
 * @param {chrome.runtime.Port} port
 * @param {number | undefined} tabId
 * @param {{ kind: 'da'|'derpi'|'twit', defaultError: string }} def
 */
function registerResolverPort(port, tabId, def) {
  if (typeof tabId !== 'number') return;

  port.onMessage.addListener((msg) => {
    const slot = resolversByTabId.get(tabId);
    if (!slot) return;

    // If something unexpected connected on this tab, ignore.
    if (slot.kind !== def.kind) return;

    if (msg?.msg === 'DownloadThis') {
      const url = msg?.data?.url;
      const filename = msg?.data?.filename;
      if (typeof url !== 'string' || !url) {
        finishResolver(tabId, false, new Error('Resolver returned no url'));
        return;
      }
      if (typeof filename !== 'string' || !filename) {
        finishResolver(tabId, false, new Error('Resolver returned no filename'));
        return;
      }
      downloadToDisk(url, slot.folderName, filename)
        .then(() => finishResolver(tabId, true))
        .catch((e) => {
          finishResolver(
            tabId,
            false,
            e instanceof Error ? e : new Error(String(e)),
          );
        });
      return;
    }

    if (msg?.msg === 'Error') {
      const reason =
        typeof msg?.data?.error === 'string' ? msg.data.error : def.defaultError;
      finishResolver(tabId, false, new Error(reason));
    }
  });

  port.onDisconnect.addListener(() => {
    const slot = resolversByTabId.get(tabId);
    if (!slot) return;
    // If the content script port disconnects unexpectedly, treat as a failure.
    finishResolver(tabId, false, new Error('Resolver port disconnected'));
  });
}

/**
 * @param {'da'|'derpi'|'twit'} kind
 * @param {string} pageUrl
 * @param {string} folderName
 */
function downloadViaTab(kind, pageUrl, folderName) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: pageUrl, active: true }, (tab) => {
      if (!tab?.id) {
        reject(new Error('Could not open tab'));
        return;
      }
      if (typeof tab.windowId === 'number') {
        chrome.windows.update(tab.windowId, { focused: true }, () => {});
      }
      const tabId = tab.id;
      const timer = setTimeout(() => {
        if (resolversByTabId.has(tabId)) {
          resolversByTabId.delete(tabId);
          chrome.tabs.remove(tabId, () => {});
          reject(new Error('Resolver timed out'));
        }
      }, 120000);

      // This overwrites any previous (shouldn't happen under sequential processing).
      const existing = resolversByTabId.get(tabId);
      if (existing) {
        clearTimeout(existing.timer);
        resolversByTabId.delete(tabId);
      }

      resolversByTabId.set(tabId, {
        kind,
        tabId,
        folderName,
        timer,
        resolve: () => resolve(),
        reject: (e) => reject(e),
      });
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
