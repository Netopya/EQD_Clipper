console.log('Sanic!');

const port = chrome.runtime.connect({name: "derpiPort"});

let downloadSearch = setInterval(lookForDownload, 100);
let checkedCount = 0;

function lookForDownload() {
	const downloadButton = document.querySelector('[title="Download (no tags in filename)"]');
	const errorBanner = document.querySelector('.block.block--fixed.block--warning h1');

	if (downloadButton) {
		console.log('Download button', downloadButton);
		clearInterval(downloadSearch);
		downloadFromButton(downloadButton);
	} else if (checkedCount < 30) {
		checkedCount += 1;
		console.log('No download found', checkedCount);
	} else if (checkedCount === 30 && errorBanner && errorBanner.innerText === 'This image has been deleted') {
		port.postMessage({msg: 'Error', data: {
			error: 'This image has been deleted'
		}});
		clearInterval(downloadSearch);
	} else {
		console.error('Could not find download button!');
		port.postMessage({msg: 'Error', data: {
			error: 'Could not find download button'
		}});
		clearInterval(downloadSearch);
	}
}

function downloadFromButton(node) {
	downloadImage(node.href, 'Download Button');
}

function downloadImage(url) {
	port.postMessage({msg: 'DownloadThis', data: {
		url,
		msg: 'Derpi Download Small'
	}});
}