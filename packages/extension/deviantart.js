const port = chrome.runtime.connect({ name: 'daPort' });

const INTERVAL_MS = 150;
const DOWNLOAD_SEARCH_MS = 5000;
const MODAL_WAIT_MS = 4000;

const started = Date.now();

function waitForElement(selector, time = 3000, validation = () => true) {
  return new Promise((resolve, reject) => {
    const elementLocator = () => document.querySelector(selector);

    const search = setInterval(() => {
      const element = elementLocator();
  
      if (element && validation(element)) {
        clearInterval(search);
        resolve(element);
      }
    }, INTERVAL_MS);

    setTimeout(() => {
      clearInterval(search);
      reject();
    }, time);
  });
}

function sleep(ms = 1000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


(async() => {
  try {
    await sleep(1000);
    const downloadButton = await waitForElement('[download]', DOWNLOAD_SEARCH_MS, (element) => !!element.href);
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
  } catch(ex) {
    console.log('Could not find download button', ex, document.querySelector('[download]'));
  }

  try {
    const firstImage = await waitForElement('img[fetchpriority="high"]');

    if (firstImage.computedStyleMap().get('cursor').value !== 'zoom-in') {
      port.postMessage({
        msg: 'DownloadThis',
        data: {
          url: firstImage.src,
          filename:
            urlToImageName(window.location.href) +
            '.' +
            urlToExtension(firstImage.src),
          msg: 'Preview Image',
        },
      });
      return;
    }
    firstImage.click();
    await sleep(1000);
  } catch(ex) {
    console.log('Could not find preview image', ex, document.querySelector('img[fetchpriority="high"]'));
    //port.postMessage({ msg: 'Error', data: { error: 'Could not find preview image' } });
    return;
  }

  await sleep(MODAL_WAIT_MS);

  try {
  const image = await waitForElement('.ReactModalPortal img', MODAL_WAIT_MS, (element) => !!element.src);
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
  } catch(ex) {
    port.postMessage({ msg: 'Error', data: { error: 'Could not find modal image' } });
    return;
  }
})();

// const search = setInterval(() => {
  

//   if (downloadButton?.href) {
//     clearInterval(search);
//     downloadButton.style.outline = '5px solid purple';
//     port.postMessage({
//       msg: 'DownloadThis',
//       data: {
//         url: downloadButton.href,
//         filename:
//           urlToImageName(window.location.href) +
//           '.' +
//           urlToExtension(downloadButton.href),
//         msg: 'Download Button',
//       },
//     });
//     return;
//   }

//   if (Date.now() - started > DOWNLOAD_SEARCH_MS) {
//     clearInterval(search);
//     openModalFallback();
//   }
// }, INTERVAL_MS);

// function openModalFallback() {
//   const firstImage = document.querySelector('img[fetchpriority="high"]');
//   if (!firstImage) {
//     port.postMessage({ msg: 'Error' });
//     return;
//   }
//   if (firstImage.computedStyleMap().get('cursor').value !== 'zoom-in') {
//     port.postMessage({
//       msg: 'DownloadThis',
//       data: {
//         url: firstImage.src,
//         filename:
//           urlToImageName(window.location.href) +
//           '.' +
//           urlToExtension(firstImage.src),
//         msg: 'Preview Image',
//       },
//     });
//     return;
//   }
//   firstImage.click();
//   setTimeout(() => {
//     const image = document.querySelector('.ReactModalPortal img');
//     if (!image?.src) {
//       port.postMessage({ msg: 'Error' });
//       return;
//     }
//     image.style.outline = '5px solid purple';
//     port.postMessage({
//       msg: 'DownloadThis',
//       data: {
//         url: image.src,
//         filename:
//           urlToImageName(window.location.href) +
//           '.' +
//           urlToExtension(image.src),
//         msg: 'Preview Image',
//       },
//     });
//   }, MODAL_WAIT_MS);
// }

function urlToImageName(url) {
  const i = url.lastIndexOf('/');
  return url.slice(i + 1).split('?')[0];
}

function urlToExtension(url) {
  const name = urlToImageName(url);
  const parts = name.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : 'jpg';
}
