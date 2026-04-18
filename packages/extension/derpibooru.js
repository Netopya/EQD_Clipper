const port = chrome.runtime.connect({ name: 'derpiPort' });

const INTERVAL_MS = 150;
const MAX_WAIT_MS = 12000;
const started = Date.now();

const search = setInterval(() => {
  const downloadButton = document.querySelector(
    '[title="Download (no tags in filename)"]',
  );
  const errorBanner = document.querySelector(
    '.block.block--fixed.block--warning h1',
  );

  if (downloadButton?.href) {
    clearInterval(search);
    port.postMessage({
      msg: 'DownloadThis',
      data: {
        url: downloadButton.href,
        msg: 'Derpi download',
      },
    });
    return;
  }

  if (Date.now() - started > MAX_WAIT_MS) {
    clearInterval(search);
    if (
      errorBanner &&
      errorBanner.textContent?.includes('This image has been deleted')
    ) {
      port.postMessage({
        msg: 'Error',
        data: { error: 'This image has been deleted' },
      });
    } else {
      port.postMessage({
        msg: 'Error',
        data: { error: 'Could not find download button' },
      });
    }
  }
}, INTERVAL_MS);
