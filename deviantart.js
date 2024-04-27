console.log('Fancy!');

const port = chrome.runtime.connect({name: "daPort"});

// function run() {
// 	const downloadButton = document.querySelector('[download]');
// 	console.log('Download button', downloadButton);

// 	if (downloadButton) {
// 		downloadFromButton(downloadButton);
// 	}
	
// }



let downloadSearch = setInterval(lookForkDownload, 100);
let checkedCount = 0;
let startLoadAt = new Date();

function lookForkDownload() {
	const downloadButton = document.querySelector('[download]');

	if (downloadButton && downloadButton.href) {
		downloadButton.style.outline = '5px solid purple';
		console.log('Download button', downloadButton);
		clearInterval(downloadSearch);
		downloadFromButton(downloadButton);
	} else if (checkedCount < 30) {
		checkedCount += 1;
		console.log('No download found', checkedCount);
	} else if (checkedCount >= 30 || new Date() - startLoadAt > 5000) {
		console.log('Using image')
		clearInterval(downloadSearch);
		clickOnImage();
	}
}

function downloadFromButton(node) {
	downloadImage(node.href, 'Download Button');
}

function clickOnImage() {
	let firstImage = document.querySelector('[fetchpriority="high"]');

	if (firstImage) {
		firstImage.click();
		setTimeout(downloadFromImage, 3000 + Math.random() * 2000);
	} else {
		port.postMessage({msg: 'Error'});
		return;
	}
}

function downloadFromImage() {
	let image = document.querySelector('.ReactModalPortal img');

	if (image) {
		image.style.outline = '5px solid purple';
		downloadImage(image.src, 'Preview Image');
	} else {
		port.postMessage({msg: 'Error'});
	}
}

function downloadImage(url, msg) {
	let extension = urlToExtension(url);
	let filename = urlToImageName(window.location.href);

	port.postMessage({msg: 'DownloadThis', data: {
		url,
		filename: filename + '.' + extension,
		msg
	}});
}

function urlToImageName(url) {
	let nameStart = url.lastIndexOf('/');
	return url.slice(nameStart + 1).split('?')[0];
}

function urlToExtension(url) {
	let downloadName = urlToImageName(url);
	let downloadNameParts = downloadName.split('.');
	let extension = downloadNameParts[downloadNameParts.length - 1];
	return extension;
}