# EQD Clipper

**EQD Clipper** is a small system for scraping [Equestria Daily](https://www.equestriadaily.com/) posts and downloading referenced artwork. A **Node companion** fetches and parses EQD HTML, queues download tasks, and serves a **React + MUI dashboard**. A **Chrome extension** polls the API, resolves DeviantArt / Derpibooru / X pages when needed, and saves files with `chrome.downloads` under `eqdc/<folder>/…`.

Architecture notes: [docs/COMPANION_APP_PLAN.md](docs/COMPANION_APP_PLAN.md).

## Prerequisites

Either:

- **Node.js 20+** on the host (repo targets Node 24), or  
- **Docker Desktop** (or compatible engine) and use Compose below—no local Node install required.

You still need **Google Chrome** on the host for the extension (the dashboard can run in Edge or another browser).

## Install (host Node)

From the repository root:

```bash
npm install
```

## Install & run with Docker (recommended if you have no local Node)

From the repository root, using Docker Compose v2:

**PowerShell**

```powershell
docker compose run --rm dev npm install
docker compose up dev
```

**bash**

```bash
docker compose run --rm dev npm install
docker compose up dev
```

- API: [http://127.0.0.1:8787](http://127.0.0.1:8787)
- Dashboard (Vite): [http://127.0.0.1:5173](http://127.0.0.1:5173)

`node_modules` lives in a Docker volume (`eqd_clipper_node_modules`), so installs are consistent with the Linux image. Your repo files (including `data/state.json` and `package-lock.json`) stay on the host via the bind mount.

One-off shell inside the same image:

```powershell
docker compose run --rm dev sh
```

## Development (host Node)

1. Start the API and the dashboard (two processes):

   ```bash
   npm run dev
   ```

   - API: [http://127.0.0.1:8787](http://127.0.0.1:8787)
   - Dashboard (Vite): [http://127.0.0.1:5173](http://127.0.0.1:5173) — job detail pages live at `/jobs/<job-id>` (client-side routing).

2. On first API start, a token is created in `data/state.json`. Open the dashboard, copy the token from the **API token** panel (or from the file), click **Save token**, and use the **same** token in the Chrome extension popup.

3. Load the extension: `chrome://extensions` → Developer mode → **Load unpacked** → choose the folder  
   `packages/extension`.

4. In the extension popup, set **API base URL** (default `http://127.0.0.1:8787`), paste the **API token**, enable **Poll for download jobs**, and click **Save**.

5. In the dashboard, queue an EQD post URL. The extension should pick up tasks and download in Chrome.

### Extension polling

- With **Poll for download jobs** enabled, the service worker asks the server for work about **every 5 seconds** (one-shot alarms; Chrome’s repeating alarms are limited to about once per minute, which is too slow for an empty queue).
- **Poll now** triggers an immediate check without waiting for the next tick.
- If a task was left **`in_progress`** because the worker crashed or the browser closed mid-download, the server **reclaims** it after **10 minutes** (or immediately if it has no claim timestamp). Reload the extension or hit **Poll now** after reclaim if needed.
- If nothing runs, see **Service worker DevTools** below.

### Service worker DevTools (why it can look “empty”)

MV3 **service workers stop when idle**. The **Console** and **Network** panels only show what happens **while the worker is awake** and **while DevTools is open**.

1. Go to `chrome://extensions`, enable **Developer mode**.
2. Find **EQD Clipper** → click **Service worker** (or **Inspect views: service worker**).  
   Do **not** use the popup’s Inspect — that is a different context.
3. In DevTools, open the **Console** tab (try **Network** second; some builds are finicky for extension workers).
4. With DevTools **still open**, open the extension **popup** and click **Poll now** (or toggle polling and **Save**).  
   You should see lines starting with **`[EQD Clipper]`** (e.g. `background script evaluated`, `drainQueue() start`, `fetch … /api/worker/poll`).
5. If the link says the service worker is **inactive**, click **Poll now** once — that wakes it — then click **Service worker** again to attach.

Typical issues visible in the console:

- **`drainQueue skipped: polling is OFF`** — turn on **Poll for download jobs** and **Save**.
- **`drainQueue skipped: no API token`** — paste the token from the dashboard and **Save**.
- **`poll failed 401`** — token mismatch; copy from `data/state.json` or dashboard and align extension + dashboard.

Optional: copy [apps/web/.env.example](apps/web/.env.example) to `apps/web/.env` and adjust `VITE_API_URL` if the API listens elsewhere.

## Production-style run

Build the dashboard and run the server with `NODE_ENV=production` so it can serve static files from `apps/web/dist`:

```bash
npm run build
set NODE_ENV=production
node apps/server/src/index.js
```

Then open [http://127.0.0.1:8787](http://127.0.0.1:8787) for the UI (or continue using a separate static host).

## Repository layout

| Path | Role |
|------|------|
| `apps/server` | Fastify HTTP API, job queue, EQD fetch + parse |
| `apps/web` | Vite + React + MUI dashboard |
| `packages/scrapers` | Shared EQD HTML parser (Cheerio) |
| `packages/extension` | Chrome MV3 worker + host resolvers |

## Docker (manual one-liner, no Compose)

```powershell
docker run -it --rm -v "${PWD}:/app" -w /app -p 8787:8787 -p 5173:5173 --entrypoint sh node:24-slim
```

Then run `npm install` and `npm run dev` inside the container. Prefer **`docker compose`** (above) so `node_modules` uses a Linux volume and file watching is configured.
