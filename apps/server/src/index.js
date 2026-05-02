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
 * Atomically moves the next eligible task to `in_progress` and returns it, or null.
 * @returns {import('./store.js').Task | null}
 */
async function claimNextTask() {
  reclaimStaleTasks();
  let pending = state.tasks.filter((t) => t.status === 'pending');
  if (!pending.length) return null;

  const twitterPending = pending.filter(isTwitterTask);
  const nonTwitter = pending.find((t) => !isTwitterTask(t));
  if (nonTwitter) {
    nonTwitter.status = 'in_progress';
    nonTwitter.claimedAt = new Date().toISOString();
    jobTouch(nonTwitter.jobId);
    persist();
    return nonTwitter;
  }

  if (twitterPending.length) {
    await waitForTwitterSlot();
    reclaimStaleTasks();
    pending = state.tasks.filter((t) => t.status === 'pending');
    const twitterNow = pending.filter(isTwitterTask);
    const head = twitterNow[0];
    if (!head) return null;
    head.status = 'in_progress';
    head.claimedAt = new Date().toISOString();
    jobTouch(head.jobId);
    persist();
    return head;
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

/**
 * Body-based path avoids 404s in some deployments where nested `/api/jobs/:id/requeue`
 * did not match (e.g. static / catch-all ordering).
 */
fastify.post('/api/jobs/requeue', async (req, reply) => {
  if (!requireToken(req, reply)) return;
  const body = /** @type {{ jobId?: string }} */ (req.body ?? {});
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
  if (!jobId) {
    reply.code(400).send({ error: 'jobId required' });
    return;
  }
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) {
    reply.code(404).send({ error: 'Job not found' });
    return;
  }
  let reset = 0;
  for (const t of state.tasks) {
    if (t.jobId !== job.id) continue;
    if (t.status !== 'failed' && t.status !== 'in_progress') continue;
    t.status = 'pending';
    delete t.error;
    delete t.claimedAt;
    reset += 1;
  }
  if (reset > 0) {
    job.status = 'running';
    delete job.error;
    delete job.errorCode;
    job.updatedAt = new Date().toISOString();
    persist();
  }
  return { reset, job };
});

fastify.post('/api/tasks/requeue', async (req, reply) => {
  if (!requireToken(req, reply)) return;
  const body = /** @type {{ taskId?: string }} */ (req.body ?? {});
  const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
  if (!taskId) {
    reply.code(400).send({ error: 'taskId required' });
    return;
  }
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) {
    reply.code(404).send({ error: 'Task not found' });
    return;
  }
  if (task.status !== 'failed' && task.status !== 'in_progress') {
    reply
      .code(400)
      .send({ error: 'Task is not failed or in progress' });
    return;
  }
  task.status = 'pending';
  delete task.error;
  delete task.claimedAt;
  const job = state.jobs.find((j) => j.id === task.jobId);
  if (job) {
    job.status = 'running';
    delete job.error;
    delete job.errorCode;
    job.updatedAt = new Date().toISOString();
  }
  persist();
  return { task, job };
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
  const task = await claimNextTask();
  if (!task) {
    return { task: null };
  }
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
