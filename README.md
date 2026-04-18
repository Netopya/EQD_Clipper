# EQD Clipper

**EQD Clipper** is a Chrome extension that scrapes [Equestria Daily](https://www.equestriadaily.com/) post pages for source links and images, then downloads files via the browser (with extra handling for DeviantArt, Derpibooru, and X/Twitter).

## Roadmap

The project is moving toward a **local companion app** (Node.js: HTTP API + React/MUI dashboard) that manages a **job queue** and **EQD HTML parsing**, while the **Chrome extension** resolves third-party pages and performs **all downloads** using `chrome.downloads`. Communication will be **HTTP only**; you can open the dashboard in another browser (for example Edge) while the extension runs in Chrome.

Full details live in **[docs/COMPANION_APP_PLAN.md](docs/COMPANION_APP_PLAN.md)**.

## Current extension (until the monorepo lands)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository folder.
3. On an EQD post (`https://www.equestriadaily.com/...`), open the extension popup, optionally set a folder name, then **Scrape** and **Download Images**.

Files are saved under a path like `eqdc/<folder name>/<filename>` in your default downloads location.
