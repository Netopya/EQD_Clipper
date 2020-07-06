console.log('I am Iron Man!');

chrome.runtime.onInstalled.addListener(function() {
	chrome.declarativeContent.onPageChanged.removeRules(undefined, function() {
		chrome.declarativeContent.onPageChanged.addRules([{
				conditions: [new chrome.declarativeContent.PageStateMatcher({
					pageUrl: {hostEquals: 'www.equestriadaily.com'},
				})
			],
			actions: [new chrome.declarativeContent.ShowPageAction()]
		}]);
	});
});

let popupPort = null;
let eqdPort = null;
let state = null;

chrome.runtime.onConnect.addListener(function(port) {
	console.log('Port connected', port.name);

	if (port.name == 'eqdPort') {
		registerEqdPort(port);
	} else if (port.name == 'daPort') {
		registerDaPort(port);
	} else if (port.name == 'derpiPort') {
		registerDerpiPort(port);
	} else if (port.name == 'popupPort') {
		registerPopupPort(port);
	}
});

function registerEqdPort(port) {
	eqdPort = port;
	port.onDisconnect.addListener(() => {
		console.log('eqdPort disconnected');
		eqdPort = null;
	});
	port.onMessage.addListener(msg => {
		if (msg.msg == 'DownloadThis') {
			console.log('Received Download Request', msg.data);
			state = msg.data;
			updatePopup(msg.data);
		}
	});
}

function registerDaPort(port) {
	port.onMessage.addListener(msg => {
		if (msg.msg == 'DownloadThis') {
			processDaDownload(msg.data);
		}
	})
}

function registerDerpiPort(port) {
	port.onMessage.addListener(msg => {
		if (msg.msg == 'DownloadThis') {
			processDerpiDownload(msg.data);
		}
	})
}

function registerPopupPort(port) {
	popupPort = port;
	port.onDisconnect.addListener(() => {
		console.log('Popup disconnected');
		popupPort = null;
	});
	port.onMessage.addListener(msg => {
		if (msg.msg === 'Scrape' && eqdPort) {
			eqdPort.postMessage({msg: 'Scrape'});
		} else if (msg.msg === 'Download' && state) {
			processDownload(state);
		}
	});

	if (state) {
		updatePopup(state);
	}
}

function updatePopup(data) {
	if (popupPort) {
		popupPort.postMessage({msg: 'updateState', data: data });
	}
}

async function processDownload(data) {
//	downloadURL(data[0].images[1]);

	const results = [];
	let sourceResults = [];
	for (const source of data) {
		sourceResults = [];
		for (const image of source.images) {
			let result = await downloadURL(image);
			sourceResults.push({
				image,
				result
			});
		}

		results.push({
			source,
			results: sourceResults.slice()
		});
	}

	console.log('Download results: ', results);
	renderFinalResults(results);
}


async function downloadURL(url) {
	return new Promise((resolve, reject) => {
		try {
			let urlObject = new URL(url);
		} catch (ex) {
			resolve({
				success: false,
				msg: url + ' is not a valid URL'
			})
			return;
		}

		if (url.indexOf('deviantart.com') > 0) {
			downloadDeviantArt(url, resolve);
		} else if (url.indexOf('derpibooru.org') > 0 ) {
			downloadDerpibooru(url, resolve);
		} else {
			downloadImage(url, resolve);
		}
	});
}

let currentDaParse = null;

function downloadDeviantArt(url, resolve) {
	console.log('Deviant Art download', url);

	// resolve({
	// 	success: true
	// });

	// return;

	chrome.tabs.create({
		url: url,
		active: false
	}, tab => {
		console.log('Opened tab', tab.id);
		currentDaParse = {
			tabId: tab.id,
			resolve
		};
		// setTimeout(() => {
		// 	chrome.tabs.remove(tab.id, () => {
		// 		resolve({
		// 			success: true
		// 		});
		// 	});
		// }, 1000);
	});
}

function processDaDownload(data) {
	callback = function(result) {
		if (currentDaParse) {
			result.msg = data.msg;
			console.log('Closing tab', currentDaParse.tabId);
			chrome.tabs.remove(currentDaParse.tabId, () => {
				currentDaParse.resolve(result);
			});
		}
	}
	downloadImage(data.url, callback, data.filename);
}

let currentDerpiParse = null;

function downloadDerpibooru(url, resolve) {
	console.log('Derpi download', url);
	chrome.tabs.create({
		url: url,
		active: false
	}, tab => {
		currentDerpiParse = {
			tabId: tab.id,
			resolve
		};
	});
}

function processDerpiDownload(data) {
	callback = function(result) {
		if (currentDerpiParse) {
			result.msg = data.msg;
			chrome.tabs.remove(currentDerpiParse.tabId, () => {
				currentDerpiParse.resolve(result);
			});
		}
	}
	downloadImage(data.url, callback);
}

let currentDownload = null;

chrome.downloads.onChanged.addListener(function(downloadDelta) {
	if (currentDownload !== null && downloadDelta.id == currentDownload.id && downloadDelta.state && downloadDelta.state.current == 'complete') {
		chrome.downloads.erase({
			id: currentDownload.id
		}, function(ids) {
			console.log('erased Ids', ids);
		});
		currentDownload.resolve({
			success: true
		});
	}
});

function downloadImage(url, resolve, defaultFilename) {
	console.log('Regular download', url);
	let filename = defaultFilename || urlToImageName(url);

	chrome.downloads.download({ url: url, filename: "eqdc/" + "8" + "/" + filename, saveAs: false }, function(downloadId) {
		currentDownload = {
			id: downloadId,
			resolve
		}
	});
}

function urlToImageName(url) {
	let nameStart = url.lastIndexOf('/');
	return url.slice(nameStart + 1).split('?')[0];
}

function renderFinalResults(results) {
	results.forEach(source => {
		console.log('Source ', source.source.number);
		source.results.forEach(result => {
			console.log('    ', result.image);
			console.log('    Success', result.result.success);
			console.log('    Msg', result.result.msg);
		});
	});
}

function testDa() {
	downloadDeviantArt('https://www.deviantart.com/megubunnii/art/Comm-Winx-Club-Bloom-830439536', result => {
		console.log('Test 1 complete', result);
	})
}

function testDa2() {
	downloadDeviantArt('https://www.deviantart.com/rimmes-broose/art/Bloom-846521724', result => {
		console.log('Test 2 complete', result);
	})
}

function testDerpi() {
	downloadDerpi('https://derpibooru.org/images/2390301', result => {
		console.log('Test 3 complete', result);
	})
}