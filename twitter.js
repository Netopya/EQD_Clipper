const port = chrome.runtime.connect({name: "twitPort"});

let postSearch = setInterval(lookForPort, 100);
let postCheckedCount = 0;
let imageCheckedCount = 0;
let startLoadAt = new Date();

let imageSearch;

function lookForPort() {
	const article = document.querySelector('article[role="article"]');

	if (!article) {
		if (postCheckedCount > 30) {
			clearInterval(postSearch);
			console.log('Aborting article search');
			port.postMessage({msg: 'Error'});
		}

		postCheckedCount += 1;
		return;
	}

	console.log('Using Article', article);

	article.style.outline = '5px solid yellow';

	const post = article.querySelector('a[href*="/photo/"]');
	const view = article.querySelector('div[role="button"] > div[dir="auto"]')

	if (view) {
		view.style.outline = '5px solid yellow';
		console.log('Clicking on view', view);
		view.click();
	} else if (post) {
		post.style.outline = '5px solid yellow';
		console.log('Post button', post);
		clearInterval(postSearch);
		postCheckedCount = 0;
		post.click();
		imageSearch = setInterval(lookForImage, 100)
	} else if (postCheckedCount < 30) {
		postCheckedCount += 1;
		console.log('No post found', postCheckedCount);
	} else {
		clearInterval(postSearch);
		console.log('Aborting post search');
		port.postMessage({msg: 'Error'});
	}
}


function lookForImage() {
	const image = document.querySelector('div[role="dialog"] img[src*="/media/"]');
	//debugger;

	if (image) {
		image.style.outline = '5px solid yellow';
		console.log('image', image);
		clearInterval(imageSearch);
		downloadImage(image.src)
	} else if (imageCheckedCount < 30) {
		imageCheckedCount += 1;
		console.log('No image found', imageCheckedCount);
	} else {
		clearInterval(imageSearch);
		console.log('Aborting image search');
		port.postMessage({msg: 'Error'});
	}
}

function downloadImage(url, msg) {
	//debugger;
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