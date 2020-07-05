console.log('Sanic!');

const port = chrome.runtime.connect({name: "derpiPort"});

let downloadSearch = setInterval(lookForkDownload, 100);
let checkedCount = 0;

function lookForkDownload() {
	const downloadButton = document.querySelector('[title="Download (no tags in filename)"]');

	if (downloadButton) {
		console.log('Download button', downloadButton);
		clearInterval(downloadSearch);
		downloadFromButton(downloadButton);
	} else if (checkedCount < 30) {
		checkedCount += 1;
		console.log('No download found', checkedCount);
	} else {
		console.error('Could not find download button!');
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