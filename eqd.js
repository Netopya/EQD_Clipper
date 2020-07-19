console.log('On Screen!');

const port = chrome.runtime.connect({name: "eqdPort"});

chrome.runtime.onMessage.addListener(msg => {
	if (msg.msg === 'Scrape') {
		scrapePage();
	}
});

function scrapePage() {
	const post = document.querySelector('#Blog1 [itemprop="description articleBody"]')

	if (post) {
		console.log('Found post', post);
	} else {
		console.error('Could not find post');
		return;
	}

	const itemsOfInterest = [];
	parseNode(post, itemsOfInterest);

	console.log('Items of Interest:', itemsOfInterest);

	const results = [];
	const stack = [];
	buildSources(itemsOfInterest.slice(0), stack, results);

	console.log('Compile Results', results);

	//console.log(renderResults(results));

	let finalResults = results.map(x => annotateResult(x));
	console.log('Final Results', finalResults);

	port.postMessage({msg: 'DownloadThis', data: finalResults });
}

function parseNode(node, ioiList) {
	if (node.nodeName === 'A' && node.innerText) {
		let testSource = /\[?(?<number>\d*)?\]?\s*[Ss]ource/.exec(node.innerText);
		let testImageLink = /((\.jpg)|(\.png)|(\.jpeg)|(\.gif)|(\.webp))/i.exec(node.href);

		if (testSource) {
			ioiList.push({
				name: 'source',
				content: node.innerText,
				url: node.href,
				source: node.dataset.source,
				number: testSource.groups.number,
				node: node
			});
		} else if (testImageLink) {
			ioiList.push({
				name: 'link',
				content: node.innerText,
				url: node.href,
				source: node.dataset.source,
				node: node
			});
		}
	}

	if (node.nodeName === 'IMG') {
		ioiList.push({
			name: 'image',
			url: node.src,
			node: node
		});
	}


	if (node.childElementCount) {
		Array.from(node.children).forEach(child => parseNode(child, ioiList));
	}
}

function buildSources(items, stack, results) {
	if (!items.length) {
		if (stack.length) {
			buildSource(stack, results);
		}

		return;
	}

	let item = items.shift();

	if (item.name === 'image' || item.name === 'link') {
		stack.push(item);
		buildSources(items, stack, results);
		return;
	}

	if (item.name === 'source') {
		let stackHasSource = stack.find(x => x.name === 'source');

		if (stackHasSource) {
			buildSource(stack, results);
			stack = [item];
		} else if (stack.length) {
			stack.push(item);
			buildSource(stack, results);
			stack = [];
		} else {
			stack.push(item);
		}
		buildSources(items, stack, results);
		return;
	}
}

function buildSource(stack, results) {
	let source = stack.find(x => x.name === 'source');
	let images = stack.filter(x => x.name === 'image' || x.name === 'link');
	results.push({
		source,
		images
	});
}

function isSourceLink(link) {
	let result = /\[?(?<number>\d*)?\]?\s*[Ss]ource/.exec(link);
	
}

function renderResults(results) {
	let output = '';
	results.forEach(result => {
		output += `Source ${result.source.number}\n`;
		output += result.images.map(x => x.url).join(' ');
		output += '\n';
	})

	return output;
}

function annotateResult(result) {
	let output = {
		number: result.source.number,
		images: []
	}
	let isDeviantArt = /deviantart\.com/.exec(result.source.url);
	let isDerpi = /derpibooru\.org/.exec(result.source.url);
	
	if (isDeviantArt) {
		output.images.push(result.source.url);
		output.name = 'Deviant Art';

		if (result.images.length > 1) {
			output.name = 'Deviant Art with additional images'
			output.images = output.images.concat(result.images.map(x => x.url));
		}
	} else if (isDerpi) {
		output.images.push(result.source.url);
		output.name = 'Derpibooru';

		if (result.images.length > 1) {
			output.name = 'Derpibooru with additional images'
			output.images = output.images.concat(result.images.map(x => x.url));
		}
	} else {
		output.name = 'Other';
		output.images = result.images.map(x => x.url);
	}

	return output;
}

function highlightResult(result) {

}