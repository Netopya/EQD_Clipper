# EQD Clipper — Companion app & architecture plan

This document records the agreed direction for evolving EQD Clipper: a **local Node.js companion site** (API + dashboard) plus a **Chrome MV3 extension** that resolves third-party pages and performs **all downloads in the browser**.

---

## Goals

- **Queue many EQD posts** from a dashboard without tying long-running work to a single extension popup.
- **Single responsibility split**
  - **Companion app (Node)**: job queue, EQD fetch + **one canonical HTML parser** (no alternate/fallback parsers to maintain), orchestration, logging, rate limits.
  - **Extension (Chrome)**: resolve real media URLs on DeviantArt, Derpibooru, and X/Twitter where needed; invoke `chrome.downloads` for every file.
- **Communication**: **HTTP only** (no WebSocket for v1).
- **Downloads**: **Browser-side only** (extension), preserving session/cookie behavior for gated sites.
- **Tests (later)**: **fixtures** for deterministic parser/resolver tests; **live sites** only for real jobs.
- **Repo hygiene**: remove legacy MV2 manifest, Vue, Bootstrap, and unused popup assets.

---

## High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Companion app (Node)                                           │
│  • Serves React + MUI dashboard (static or Vite-built assets)     │
│  • REST API: jobs, poll, results, health, auth token              │
│  • Fetches EQD HTML; runs canonical Cheerio (or similar) parser  │
│  • Queue store (start simple: SQLite or JSON file — TBD)          │
│  • Per-host rate limiting & backoff (especially X/Twitter)       │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP (localhost)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Chrome extension (MV3)                                         │
│  • Service worker: poll for work, dispatch to content scripts     │
│  • Content scripts: DA / Derpibooru / X resolvers                 │
│  • chrome.downloads → e.g. eqdc/<job folder>/...                 │
│  • Stores API base URL + Bearer token in chrome.storage.local     │
└─────────────────────────────────────────────────────────────────┘
```

**Dashboard browser vs extension browser**

- The **dashboard** is a normal **website** served by the companion (e.g. `http://127.0.0.1:<port>/`).
- You may open it in **Edge** (or any browser) while the **extension runs only in Chrome**.
- The extension talks to **localhost HTTP**; it does not need the dashboard and the extension to share the same browser profile.

---

## EQD parsing strategy

- **One version** of EQD parsing lives in shared Node code (e.g. `packages/scrapers`), used by the server for every job.
- **No fallback paths** (e.g. no “try extension scrape if server parse fails”). If EQD markup changes, fix the parser once in one place.
- Server flow (per job): `GET` post URL → parse HTML → emit structured tasks:
  - **Direct image URLs** (download via extension).
  - **Resolver-required URLs** (DA / Derpibooru / X) → extension opens tab / runs content script → returns final URL → extension downloads.

---

## HTTP API (sketch)

Exact paths can be finalized during implementation; shape should stay simple and poll-friendly.

| Concern | Suggested approach |
|--------|---------------------|
| Auth | Shared secret: server generates token; dashboard shows it once; extension saves to `chrome.storage.local`; `Authorization: Bearer <token>` on extension requests |
| Work assignment | Extension `POST /api/worker/poll` → next task or 204 empty |
| Results | Extension `POST /api/worker/result` with task id, status, resolved URL, error code, optional message |
| Jobs | Dashboard creates jobs via `POST /api/jobs` (EQD URL + output folder name / metadata) |
| Rate limits | Server enforces delays between dispatching X-related tasks; configurable in UI |

---

## Extension responsibilities

- **Minimal UI** (optional): status, connection to companion, token field, “start/stop polling”.
- **Refactored content scripts**: shared helpers (wait for selector with timeout, structured errors), no unbounded `setInterval` without hard caps.
- **Downloads**: all files via `chrome.downloads` under a predictable prefix (existing `eqdc/...` convention can be preserved).

---

## Repository layout (target)

Monorepo with npm workspaces (names illustrative):

- `apps/server` — HTTP API, job store, EQD fetch + orchestration
- `apps/web` — React + MUI dashboard (Vite)
- `packages/scrapers` — canonical EQD parser + shared types
- `packages/extension` — MV3 extension (manifest, service worker, content scripts)

**Remove** (once replaced): `manifest old.json`, `popup.html`, `popup.js`, `popup.vue`, `vendor/vue.js`, Bootstrap CSS/JS from legacy popups, duplicate/unused assets.

---

## Local development & Docker

- **Node**: target **Node 24**; use `node:24-slim` in Docker for CI-style `npm ci`, `npm run build`, `npm test`.
- **Local run**: start server + web dev server (or single-process static serve); load **unpacked extension** in Chrome pointing at `packages/extension` build output.

---

## Testing strategy (Phase 5 — later)

- **Fixtures**: committed files such as raw EQD HTML (or article subtree) and small DOM snippets for resolver logic; tests assert **stable JSON outputs** or golden files.
- **Live jobs**: real runs always hit live EQD and live host sites via the extension; not required for default CI.
- **Rationale**: fixtures catch regressions in *your* parsing and selector logic; live DOM changes are handled by fixes + optional manual smoke checks, not flaky CI.

---

## Non-goals (for this iteration)

- Electron desktop shell (companion stays a **local site**).
- WebSocket transport (HTTP only).
- Multiple parallel EQD parser implementations or server/extension “fallback” parsers.
- Server-side downloading of gated assets (downloads stay in Chrome).

---

## Open decisions (implementer fills in)

- **Job store**: SQLite vs file-backed JSON for v1.
- **Single port vs split ports**: API + static UI on one origin vs dev proxy (prefer one origin for simpler CORS).
- **Exact error taxonomy** for the dashboard (`SITE_CHANGED`, `TIMEOUT`, `LOGIN_REQUIRED`, etc.).

---

## Revision history

- **2026-04-18**: Initial plan — local companion site, HTTP-only, Chrome extension for resolvers + downloads, Edge (or other) OK for dashboard, fixtures reserved for tests.
