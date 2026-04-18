const apiBaseUrl = document.getElementById('apiBaseUrl');
const apiToken = document.getElementById('apiToken');
const pollingEnabled = document.getElementById('pollingEnabled');
const saveBtn = document.getElementById('saveBtn');
const pollNowBtn = document.getElementById('pollNowBtn');
const statusEl = document.getElementById('status');

function setStatus(text, isErr) {
  statusEl.textContent = text;
  statusEl.classList.toggle('err', !!isErr);
}

async function load() {
  const s = await chrome.storage.local.get([
    'apiBaseUrl',
    'apiToken',
    'pollingEnabled',
  ]);
  apiBaseUrl.value = s.apiBaseUrl || 'http://127.0.0.1:8787';
  apiToken.value = s.apiToken || '';
  pollingEnabled.checked = !!s.pollingEnabled;
}

saveBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({
    apiBaseUrl: apiBaseUrl.value.replace(/\/$/, ''),
    apiToken: apiToken.value.trim(),
    pollingEnabled: pollingEnabled.checked,
  });
  setStatus('Saved.');
  chrome.runtime.sendMessage({ type: 'startPolling' });
});

pollNowBtn.addEventListener('click', () => {
  setStatus('Polling…');
  chrome.runtime.sendMessage({ type: 'pollNow' });
  setTimeout(() => setStatus('Poll requested.'), 500);
});

void load();
