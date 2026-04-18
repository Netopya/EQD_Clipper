const port = chrome.runtime.connect({ name: 'daPort' });

const INTERVAL_MS = 150;
const DOWNLOAD_SEARCH_MS = 5000;
const MODAL_WAIT_MS = 4000;

const started = Date.now();

const search = setInterval(() => {
  const downloadButton = document.querySelector('[download]');

  if (downloadButton?.href) {
    clearInterval(search);
    downloadButton.style.outline = '5px solid purple';
    port.postMessage({
      msg: 'DownloadThis',
      data: {
        url: downloadButton.href,
        filename:
          urlToImageName(window.location.href) +
          '.' +
          urlToExtension(downloadButton.href),
        msg: 'Download Button',
      },
    });
    return;
  }

  if (Date.now() - started > DOWNLOAD_SEARCH_MS) {
    clearInterval(search);
    openModalFallback();
  }
}, INTERVAL_MS);

function openModalFallback() {
  const firstImage = document.querySelector('img[fetchpriority="high"]');
  if (!firstImage) {
    port.postMessage({ msg: 'Error' });
    return;
  }
  firstImage.click();
  setTimeout(() => {
    const image = document.querySelector('.ReactModalPortal img');
    if (!image?.src) {
      port.postMessage({ msg: 'Error' });
      return;
    }
    image.style.outline = '5px solid purple';
    port.postMessage({
      msg: 'DownloadThis',
      data: {
        url: image.src,
        filename:
          urlToImageName(window.location.href) +
          '.' +
          urlToExtension(image.src),
        msg: 'Preview Image',
      },
    });
  }, MODAL_WAIT_MS);
}

function urlToImageName(url) {
  const i = url.lastIndexOf('/');
  return url.slice(i + 1).split('?')[0];
}

function urlToExtension(url) {
  const name = urlToImageName(url);
  const parts = name.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : 'jpg';
}
