const port = chrome.runtime.connect({name: "popupPort"});
const state = {data: {
	requests: [],
	scrapeName: ''
}};


port.onMessage.addListener(function(msg) {
	console.log('popup heard', msg);

	if (msg.msg === 'updateState') {
		state.data = msg.data;
		console.log('new state data', state);
	}
});

const app = new Vue({
	el: '#app',
	data: {
		sharedState: state
	},
	computed: {
		state() {
			return this.sharedState.data;
		},
		sources() {
			return this.state.requests || [];
		},
		totalSources() {
			return this.sources.length;
		},
		totalImages() {
			return this.sources.reduce((acc, cur) => acc + cur.images.length, 0);
		},
		ranges() {
			return this.state.ranges;
		},
		duplicates() {
			if (!this.ranges?.duplicates.length) {
				return 'None';
			}

			return this.ranges.duplicates.join(', ');
		},
		unknowns() {
			return this.ranges?.unknown.length || 'None';
		},
		missing() {
			if (!this.ranges?.missing.length) {
				return 'None';
			}

			return this.ranges.missing
				.map(range => range.join(' to '))
				.join(', ');
		}
	},
	methods: {
		start() {
			port.postMessage({msg: 'Scrape'});
		},
		download() {
			port.postMessage({msg: 'Download' });
		}
	},
	watch: {
		'state.scrapeName': (value) => {
			port.postMessage({msg: 'NameScrape', name: value });
		}
	}
});