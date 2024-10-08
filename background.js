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
let state = {
	requests: [],
	scrapeName: ''
};

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
	} else if (port.name == 'twitPort') {
		registerTwitPort(port);
	}
});

function parseRanges(requests) {
	const sources = requests
		.map(source => parseInt(source.number))
		.reduce((acc, cur) => {
			if (!isNaN(cur)) {
				acc.push(cur);
			}
			return acc;
		}, [])
		.sort((a,b)=>a-b);


	const duplicates = new Set();
	const missing = [];


	let last = sources[0];
	for (i = 1; i < sources.length; i++) {
		if (last === sources[i]) {
			duplicates.add(sources[i]);
		} else if (last + 2 === sources[i]) {
			missing.push([sources[i] - 1]);
		} else if (sources[i] - last > 2) {
			missing.push([last + 1, sources[i] - 1]);
		}

		last = sources[i];
	}

	return {
		unknown: requests.length - sources.length,
		duplicates: Array.from(duplicates),
		missing
	};
}

function registerEqdPort(port) {
	eqdPort = port;
	port.onDisconnect.addListener(() => {
		console.log('eqdPort disconnected');
		eqdPort = null;
	});
	port.onMessage.addListener(msg => {
		console.log(arguments);
		if (msg.msg == 'DownloadThis') {
			console.log('Received Download Request', msg.data);
			state.requests = msg.data;
			state.ranges = parseRanges(state.requests);
			updatePopup(state);
		}
	});
}

function registerDaPort(port) {
	port.onMessage.addListener((msg, sender) => {
		if (msg.msg == 'DownloadThis' && currentDaParse && currentDaParse.tabId === sender.sender.tab.id) {
			processDaDownload(msg.data);
		} else if (msg.msg == 'Error' && currentDaParse) {
			currentDaParse.resolve({
				success: false,
				msg: 'Could not find DA image'
			});
		}
	})
}

function registerDerpiPort(port) {
	port.onMessage.addListener(msg => {
		if (msg.msg == 'DownloadThis') {
			processDerpiDownload(msg.data);
		} else if (msg.msg == 'Error' && currentDerpiParse) {
			currentDerpiParse.resolve({
				success: false,
				msg: msg.data.error
			});
		}
	})
}

function registerTwitPort(port) {
	port.onMessage.addListener((msg, sender) => {
		if (msg.msg == 'DownloadThis' && currentTwitParse && currentTwitParse.tabId === sender.sender.tab.id) {
			console.log('Processing twit download');
			processTwitDownload(msg.data);
		} else if (msg.msg == 'Error' && currentTwitParse) {
			currentTwitParse.resolve({
				success: false,
				msg: 'Could not find Twit image'
			});
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
		if (msg.msg === 'Scrape') {
			//eqdPort.postMessage({msg: 'Scrape'});

			chrome.tabs.query({
				active: true,
				currentWindow: true,
				//url: 'https://*.equestriadaily.com/*'
			}, function(tabs) {
				console.log('Found tabs', tabs);
				chrome.tabs.sendMessage(tabs[0].id, {msg: 'Scrape'});
			});
		} else if (msg.msg === 'Download' && state.requests) {
			processDownload(state);
		} else if (msg.msg === 'NameScrape') {
			state.scrapeName = msg.name;
			console.log('Updating scrape name', state);
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

	console.log('processing download', data);

	const results = [];
	let sourceResults = [];
	for (const source of data.requests) {
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
		} else if (url.indexOf('twitter.com') > 0 || url.indexOf('x.com') > 0) {
			downloadTwitter(url, resolve);
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
		//active: false
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

let currentTwitParse = null;

function downloadTwitter(url, resolve) {
	console.log('Twitter download', url);

	chrome.tabs.create({
		url: url,
	}, tab => {
		console.log('Opened tab', tab.id);
		currentTwitParse = {
			tabId: tab.id,
			resolve
		};
	});
}

function processTwitDownload(data) {
	callback = function(result) {
		if (currentTwitParse) {
			result.msg = data.msg;
			console.log('Closing tab', currentTwitParse.tabId);
			chrome.tabs.remove(currentTwitParse.tabId, () => {
				currentTwitParse.resolve(result);
			});
		}
	}
	downloadImage(data.url, callback, data.filename);
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
	} else if (currentDownload !== null && downloadDelta.id == currentDownload.id && downloadDelta.error) {
		console.warn('A download errored');
		currentDownload.resolve({
			success: false
		});
	}
});

function downloadImage(url, resolve, defaultFilename) {
	console.log('Regular download', url);
	let filename = defaultFilename || urlToImageName(url);

	chrome.downloads.download({ url: url, filename: "eqdc/" + (state.scrapeName || "8") + "/" + filename, saveAs: false }, function(downloadId) {
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