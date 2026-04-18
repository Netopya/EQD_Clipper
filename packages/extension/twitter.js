const port = chrome.runtime.connect({ name: 'twitPort' });

const INTERVAL_MS = 150;
const POST_TIMEOUT_MS = 20000;
const IMAGE_TIMEOUT_MS = 20000;

const postStarted = Date.now();
let viewClicked = false;
/** @type {ReturnType<typeof setInterval> | null} */
let imageSearch = null;

const postSearch = setInterval(() => {
  const article = document.querySelector('article[role="article"]');

  if (!article) {
    if (Date.now() - postStarted > POST_TIMEOUT_MS) {
      clearInterval(postSearch);
      port.postMessage({ msg: 'Error' });
    }
    return;
  }

  article.style.outline = '5px solid yellow';

  const photoLink = article.querySelector('a[href*="/photo/"]');
  const view = article.querySelector('div[role="button"] > div[dir="auto"]');

  if (view && !viewClicked) {
    viewClicked = true;
    view.style.outline = '5px solid yellow';
    view.click();
    return;
  }

  if (photoLink) {
    clearInterval(postSearch);
    photoLink.style.outline = '5px solid yellow';
    photoLink.click();
    startImageSearch();
    return;
  }

  if (Date.now() - postStarted > POST_TIMEOUT_MS) {
    clearInterval(postSearch);
    port.postMessage({ msg: 'Error' });
  }
}, INTERVAL_MS);

function startImageSearch() {
  const imgStarted = Date.now();
  let checks = 0;
  imageSearch = setInterval(() => {
    const image = document.querySelector(
      'div[role="dialog"] img[src*="/media/"]',
    );
    if (image?.src) {
      if (imageSearch) clearInterval(imageSearch);
      image.style.outline = '5px solid yellow';
      const ext = urlToExtension(image.src);
      const base = urlToImageName(image.src);
      port.postMessage({
        msg: 'DownloadThis',
        data: {
          url: image.src,
          filename: `${base}.${ext}`,
          msg: 'Twitter image',
        },
      });
      return;
    }
    checks += 1;
    if (
      checks > 200 ||
      Date.now() - imgStarted > IMAGE_TIMEOUT_MS
    ) {
      if (imageSearch) clearInterval(imageSearch);
      port.postMessage({ msg: 'Error' });
    }
  }, INTERVAL_MS);
}

function urlToImageName(url) {
  const i = url.lastIndexOf('/');
  return url.slice(i + 1).split('?')[0] || 'twitter-media';
}

function urlToExtension(url) {
  const m = /format=(\w{1,5})/.exec(url);
  if (m) return m[1];
  const name = urlToImageName(url);
  const parts = name.split('.');
  if (parts.length > 1) return parts[parts.length - 1];
  return 'jpg';
}
