import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseEqdPostHtml,
  classifyResolveKind,
  parseSourceNumberRanges,
  ParseError,
} from '@eqd/scrapers';
import { loadState, saveState } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../../web/dist');

const PORT = Number(process.env.PORT) || 8787;

/** @type {ReturnType<typeof loadState>} */
let state = loadState();

function persist() {
  saveState(state);
}

function authHeaders(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length);
}

function requireToken(req, reply) {
  const token = authHeaders(req);
  if (!token || token !== state.apiToken) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  return token;
}

/** @returns {number | null} */
let twitterCooldownUntil = null;

/**
 * @param {import('./store.js').Task} task
 */
function isTwitterTask(task) {
  return task.resolveKind === 'twitter';
}

async function waitForTwitterSlot() {
  const delay = state.settings.twitterDelayMs;
  while (true) {
    const now = Date.now();
    if (!twitterCooldownUntil || now >= twitterCooldownUntil) {
      twitterCooldownUntil = now + delay;
      return;
    }
    const wait = Math.min(500, twitterCooldownUntil - now);
    await new Promise((r) => setTimeout(r, wait));
  }
}

const STALE_TASK_MS = 10 * 60 * 1000;

function reclaimStaleTasks() {
  const now = Date.now();
  let changed = false;
  for (const t of state.tasks) {
    if (t.status !== 'in_progress') continue;
    if (!t.claimedAt) {
      t.status = 'pending';
      changed = true;
      continue;
    }
    const claimed = new Date(t.claimedAt).getTime();
    if (Number.isNaN(claimed) || now - claimed > STALE_TASK_MS) {
      t.status = 'pending';
      delete t.claimedAt;
      changed = true;
    }
  }
  if (changed) persist();
}

/**
 * @returns {import('./store.js').Task | null}
 */
async function pickNextTask() {
  reclaimStaleTasks();
  const pending = state.tasks.filter((t) => t.status === 'pending');
  if (!pending.length) return null;

  const twitterPending = pending.filter(isTwitterTask);
  const nonTwitter = pending.find((t) => !isTwitterTask(t));
  if (nonTwitter) return nonTwitter;

  if (twitterPending.length) {
    await waitForTwitterSlot();
    return twitterPending[0] ?? null;
  }
  return null;
}

async function fetchEqdHtml(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'EQD-Clipper/1.0 (companion; https://github.com/)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) {
    throw new Error(`EQD fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });

fastify.get('/api/health', async () => ({ ok: true }));

/** Dashboard bootstrap: token visible for initial setup (localhost only). */
fastify.get('/api/bootstrap', async () => ({
  apiToken: state.apiToken,
  twitterDelayMs: state.settings.twitterDelayMs,
}));

fastify.put('/api/settings', async (req, reply) => {
  if (!requireToken(req, reply)) return;
  const body = /** @type {{ twitterDelayMs?: number }} */ (req.body ?? {});
  if (typeof body.twitterDelayMs === 'number' && body.twitterDelayMs >= 0) {
    state.settings.twitterDelayMs = body.twitterDelayMs;
    persist();
  }
  return state.settings;
});

fastify.post('/api/auth/rotate', async (req, reply) => {
  if (!requireToken(req, reply)) return;
  state.apiToken = crypto.randomUUID();
  persist();
  return { apiToken: state.apiToken };
});

fastify.get('/api/jobs', async (req, reply) => {
  if (!requireToken(req, reply)) return;
  return state.jobs.map((j) => ({
    ...j,
    taskCounts: {
      total: state.tasks.filter((t) => t.jobId === j.id).length,
      pending: state.tasks.filter((t) => t.jobId === j.id && t.status === 'pending')
        .length,
      completed: state.tasks.filter((t) => t.jobId === j.id && t.status === 'completed')
        .length,
      failed: state.tasks.filter((t) => t.jobId === j.id && t.status === 'failed').length,
    },
  }));
});

fastify.get('/api/jobs/:id', async (req, reply) => {
  if (!requireToken(req, reply)) return;
  const job = state.jobs.find((j) => j.id === req.params.id);
  if (!job) {
    reply.code(404).send({ error: 'Job not found' });
    return;
  }
  const tasks = state.tasks.filter((t) => t.jobId === job.id);
  return { job, tasks };
});

fastify.post('/api/jobs', async (req, reply) => {
  if (!requireToken(req, reply)) return;
  const body = /** @type {{ eqdUrl?: string, folderName?: string }} */ (req.body ?? {});
  const eqdUrl = body.eqdUrl?.trim();
  if (!eqdUrl) {
    reply.code(400).send({ error: 'eqdUrl required' });
    return;
  }
  let parsed;
  try {
    new URL(eqdUrl);
  } catch {
    reply.code(400).send({ error: 'Invalid eqdUrl' });
    return;
  }

  const job = {
    id: crypto.randomUUID(),
    eqdUrl,
    folderName: (body.folderName?.trim() || '8').replace(/[/\\]/g, '_'),
    status: /** @type {const} */ ('parsing'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.jobs.unshift(job);
  persist();

  try {
    const html = await fetchEqdHtml(eqdUrl);
    parsed = parseEqdPostHtml(eqdUrl, html);
  } catch (e) {
    job.status = 'failed';
    job.error = e instanceof Error ? e.message : String(e);
    job.errorCode = e instanceof ParseError ? e.code : 'FETCH_OR_PARSE';
    job.updatedAt = new Date().toISOString();
    persist();
    reply.code(422).send({ job, error: job.error, code: job.errorCode });
    return;
  }

  job.sources = parsed;
  job.ranges = parseSourceNumberRanges(parsed);
  job.status = 'running';
  job.updatedAt = new Date().toISOString();

  for (const row of parsed) {
    for (const url of row.images) {
      state.tasks.push({
        id: crypto.randomUUID(),
        jobId: job.id,
        url,
        resolveKind: classifyResolveKind(url),
        folderName: job.folderName,
        sourceNumber: row.number,
        sourceName: row.name,
        status: 'pending',
      });
    }
  }

  persist();
  reply.code(201).send({ job });
});

fastify.post('/api/worker/poll', async (req, reply) => {
  if (!requireToken(req, reply)) return;
  const task = await pickNextTask();
  if (!task) {
    return { task: null };
  }
  task.status = 'in_progress';
  task.claimedAt = new Date().toISOString();
  jobTouch(task.jobId);
  persist();
  return {
    task: {
      id: task.id,
      jobId: task.jobId,
      folderName: task.folderName,
      url: task.url,
      resolveKind: task.resolveKind,
      sourceNumber: task.sourceNumber,
      sourceName: task.sourceName,
    },
  };
});

/**
 * @param {string} jobId
 */
function jobTouch(jobId) {
  const job = state.jobs.find((j) => j.id === jobId);
  if (job) job.updatedAt = new Date().toISOString();
}

function jobMaybeComplete(jobId) {
  const tasks = state.tasks.filter((t) => t.jobId === jobId);
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job || job.status === 'failed') return;
  const unfinished = tasks.some(
    (t) => t.status === 'pending' || t.status === 'in_progress',
  );
  if (!unfinished) {
    const failed = tasks.some((t) => t.status === 'failed');
    job.status = failed ? 'failed' : 'completed';
    job.updatedAt = new Date().toISOString();
  }
}

fastify.post('/api/worker/result', async (req, reply) => {
  if (!requireToken(req, reply)) return;
  const body =
    /** @type {{ taskId?: string, success?: boolean, error?: string }} */ (
      req.body ?? {}
    );
  const taskId = body.taskId;
  if (!taskId) {
    reply.code(400).send({ error: 'taskId required' });
    return;
  }
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) {
    reply.code(404).send({ error: 'Task not found' });
    return;
  }
  if (body.success) {
    task.status = 'completed';
    task.error = undefined;
    delete task.claimedAt;
  } else {
    task.status = 'failed';
    task.error = body.error || 'Unknown worker error';
    delete task.claimedAt;
  }
  jobTouch(task.jobId);
  jobMaybeComplete(task.jobId);
  persist();
  return { ok: true };
});

if (process.env.NODE_ENV === 'production') {
  try {
    await fastify.register(fastifyStatic, {
      root: WEB_DIST,
      prefix: '/',
    });
    fastify.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'Not found' });
    });
  } catch (e) {
    fastify.log.warn({ err: e }, 'Web dist not found; API only');
  }
}

await fastify.listen({ port: PORT, host: '0.0.0.0' });
fastify.log.info(`EQD companion API http://127.0.0.1:${PORT}`);
