<script>

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

export default {
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
}
</script>

<template>

<!DOCTYPE html>
<html>
	<head>
		<style>
			html {
				width: 400px;
			}

			body {
				font-size: 0.875rem;
			}

			main {
				padding: 1em;
			}

			h1 {
				text-align: center;
			}

			.site-action-menu {
				display: grid;
				grid-template-columns: 1fr 1fr;
				column-gap: 1em;
				padding-left: 1em;
				padding-right: 1em;
			}
		</style>

		<link rel="stylesheet" href="vendor/bootstrap.min.css"/>
	</head>
	<body>
		<main id="app">
			<h1>EQD Clipper</h1>
			<form class="text-center">
				<div class="form-group site-action-menu">
					<button class="btn btn-primary" @click="start">Scrape Page</button>
					<button class="btn btn-success" @click="download">Download Images</button>
				</div>

				<div>
					<label class="form-group">
						Folder Name:
						<input class="form-control" type="text" v-model="state.scrapeName"/>
					</label>
				</div>
			</form>
			

			<h2>Report</h2>
			<div>Total Sources: {{ totalSources }}</div>
			<div>Total Images: {{ totalImages }}</div>
			<div>Duplicates: {{ duplicates }}</div>
			<div>Unknown: {{ unknowns }}</div>
			<div>Missing: {{ missing }}</div>


			<h2>Images</h2>

			<ul>
				<li v-for="source in sources">
					{{ source.number }} - {{ source.name }} - ({{ source.images.length }})
	
					<ul>
						<li v-for="image in source.images">{{ image }}</li>
					</ul>
				</li>
			</ul>
		</main>


		<script src="vendor/vue.js"></script>
		<script src="popup.js"></script>
	</body>
</html>

</template>