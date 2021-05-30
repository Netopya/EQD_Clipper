const port = chrome.runtime.connect({name: "twitPort"});

let postSearch = setInterval(lookForPort, 100);
let checkedCount = 0;
let startLoadAt = new Date();

let imageSearch;

function lookForPort() {
	const article = document.querySelector('article[tabindex="0"]');

	if (!article) {
		return;
	}

	article.style.outline = '5px solid yellow';

	const post = article.querySelector('a[href*="/photo/"]');
	const view = article.querySelector('div[role="button"] > div[dir="auto"]')

	if (view) {
		view.style.outline = '5px solid yellow';
		view.click();
	} else if (post) {
		post.style.outline = '5px solid yellow';
		console.log('Post button', post);
		clearInterval(postSearch);
		checkedCount = 0;
		post.click();
		imageSearch = setInterval(lookForImage, 100)
	} else if (checkedCount < 30) {
		checkedCount += 1;
		console.log('No post found', checkedCount);
	}
}


function lookForImage() {
	const image = document.querySelector('div[role="dialog"] img[src*="/media/"]');
	debugger;

	if (image) {
		image.style.outline = '5px solid yellow';
		console.log('image', image);
		clearInterval(imageSearch);
		downloadImage(image.src)
	} else if (checkedCount < 30) {
		checkedCount += 1;
		console.log('No image found', checkedCount);
	}
}

function downloadImage(url, msg) {
	debugger;
	let extension = urlToExtension(url);
	let filename = urlToImageName(url);

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
	const format = /format=(\w{1,5})/

	return format.exec(url)[1];
}