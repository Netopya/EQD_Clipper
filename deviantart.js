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

function lookForkDownload() {
	const downloadButton = document.querySelector('[download]');

	if (downloadButton) {
		console.log('Download button', downloadButton);
		clearInterval(downloadSearch);
		downloadFromButton(downloadButton);
	} else if (checkedCount < 30) {
		checkedCount += 1;
		console.log('No download found', checkedCount);
	} else {
		console.log('Using image')
		clearInterval(downloadSearch);
		downloadFromImage();
	}
}

function downloadFromButton(node) {
	downloadImage(node.href, 'Download Button');
}

function downloadFromImage() {
	let image = document.querySelector('[data-hook="art_stage"] img');
	downloadImage(image.src, 'Preview Image');
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