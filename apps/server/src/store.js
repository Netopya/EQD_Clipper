import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../../data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

/** @typedef {'pending'|'in_progress'|'completed'|'failed'} TaskStatus */
/** @typedef {'queued'|'parsing'|'ready'|'running'|'completed'|'failed'} JobStatus */

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} jobId
 * @property {string} url
 * @property {'none'|'deviantart'|'derpibooru'|'twitter'} resolveKind
 * @property {string} folderName
 * @property {string} [sourceNumber]
 * @property {string} sourceName
 * @property {TaskStatus} status
 * @property {string} [error]
 */

/**
 * @typedef {Object} Job
 * @property {string} id
 * @property {string} eqdUrl
 * @property {string} folderName
 * @property {JobStatus} status
 * @property {string} [error]
 * @property {string} [errorCode]
 * @property {Record<string, unknown>[]} [sources]
 * @property {Record<string, unknown>} [ranges]
 * @property {string} createdAt
 * @property {string} updatedAt
 */

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * @returns {{ jobs: Job[], tasks: Task[], settings: { twitterDelayMs: number }, apiToken: string }}
 */
function defaultState() {
  return {
    jobs: [],
    tasks: [],
    settings: { twitterDelayMs: 8000 },
    apiToken: crypto.randomUUID(),
  };
}

export function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) {
    const s = defaultState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');
    return s;
  }
  const raw = fs.readFileSync(STATE_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.settings) parsed.settings = { twitterDelayMs: 8000 };
    if (typeof parsed.settings.twitterDelayMs !== 'number') parsed.settings.twitterDelayMs = 8000;
    if (!parsed.apiToken) parsed.apiToken = crypto.randomUUID();
    if (!Array.isArray(parsed.jobs)) parsed.jobs = [];
    if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
    return parsed;
  } catch {
    const s = defaultState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');
    return s;
  }
}

/** @param {{ jobs: Job[], tasks: Task[], settings: { twitterDelayMs: number }, apiToken: string }} state */
export function saveState(state) {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export { DATA_DIR, STATE_FILE };
