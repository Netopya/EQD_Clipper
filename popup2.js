const port = chrome.runtime.connect({name: "popupPort"});
const state = {
    data: {
        requests: [],
        scrapeName: ''
    }
};

const totalSourcesElement = document.getElementById('totalSources');
const totalImagesElement = document.getElementById('totalImages');
const duplicatesElement = document.getElementById('duplicates');
const unknownsElement = document.getElementById('unknowns');
const missingElement = document.getElementById('missing');
const sourcesListElement = document.getElementById('sourcesList');
const scrapeNameInputElement = document.getElementById('scrapeNameInput');
const startBtn = document.getElementById('startBtn');
const downloadBtn = document.getElementById('downloadBtn');

function updateDisplay() {
    const sources = state.data.requests || [];
    const ranges = state.data.ranges;

    totalSourcesElement.textContent = `Total Sources: ${sources.length}`;
    totalImagesElement.textContent = `Total Images: ${sources.reduce((acc, cur) => acc + cur.images.length, 0)}`;

    duplicatesElement.textContent = ranges?.duplicates?.length ? `Duplicates: ${ranges.duplicates.join(', ')}` : 'Duplicates: None';
    unknownsElement.textContent = ranges?.unknown?.length ? `Unknown: ${ranges.unknown.length}` : 'Unknown: None';
    missingElement.textContent = ranges?.missing?.length ? `Missing: ${ranges.missing.map(range => range.join(' to ')).join(', ')}` : 'Missing: None';

    sourcesListElement.innerHTML = '';
    sources.forEach(source => {
        const sourceLi = document.createElement('li');
        sourceLi.textContent = `${source.number} - ${source.name} - (${source.images.length})`;

        const imagesUl = document.createElement('ul');
        source.images.forEach(image => {
            const imageLi = document.createElement('li');
            imageLi.textContent = image;
            imagesUl.appendChild(imageLi);
        });

        sourceLi.appendChild(imagesUl);
        sourcesListElement.appendChild(sourceLi);
    });
}

port.onMessage.addListener(function(msg) {
    console.log('popup heard', msg);

    if (msg.msg === 'updateState') {
        state.data = msg.data;
        console.log('new state data', state);
        updateDisplay();
    }
});

scrapeNameInputElement.value = state.data.scrapeName;

scrapeNameInputElement.addEventListener('input', function() {
    state.data.scrapeName = this.value;
    port.postMessage({msg: 'NameScrape', name: this.value});
});

startBtn.addEventListener('click', function() {
    port.postMessage({msg: 'Scrape'});
});

downloadBtn.addEventListener('click', function() {
    port.postMessage({msg: 'Download'});
});

updateDisplay();