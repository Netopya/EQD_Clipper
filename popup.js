const port = chrome.runtime.connect({name: "popupPort"});
const state = {data: null};


port.onMessage.addListener(function(msg) {
	console.log('popup heard', msg);

	if (msg.msg === 'updateState') {
		state.data = msg.data;
		console.log('new state data', state.data);
	}
});

const app = new Vue({
	el: '#app',
	data: {
		state
	},
	computed: {
		sources() {
			return state.data || [];
		},
		totalSources() {
			return this.sources.length;
		},
		totalImages() {
			return this.sources.reduce((acc, cur) => acc + cur.images.length, 0);
		}
	},
	methods: {
		start() {
			port.postMessage({msg: 'Scrape'});
		},
		download() {
			port.postMessage({msg: 'Download'});
		}
	}
});