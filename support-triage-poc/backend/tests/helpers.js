import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config/index.js';
import { openDatabase } from '../src/repositories/db.js';
import { createApp } from '../src/app.js';

export const FIXED_NOW = new Date('2026-10-13T10:00:00.000Z');
export const fixedClock = () => new Date(FIXED_NOW);

export function testConfig(env = {}) {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-test-uploads-'));
  return loadConfig({
    NODE_ENV: 'test',
    DB_PATH: ':memory:',
    UPLOAD_DIR: uploadDir,
    PROVIDER_RETRY_BASE_MS: '0',
    PROVIDER_RETRY_AFTER_CAP_MS: '0',
    ...env,
  });
}

// Which database driver makeTestApp uses: 'better-sqlite3' (in memory) or 'libsql' (the Turso client, on a temp file).
let testDriver = 'better-sqlite3';
export const DRIVERS = ['better-sqlite3', 'libsql'];
export const setTestDriver = (driver) => {
  testDriver = driver;
};

/** Creates an app with a fresh DB, a fixed clock and an optional stubbed fetch. */
export async function makeTestApp({ env = {}, fetchImpl, clock = fixedClock } = {}) {
  const config = testConfig(env);
  const dbOptions =
    testDriver === 'libsql'
      ? { tursoUrl: `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'triage-libsql-')), 'test.db').split(path.sep).join('/')}` }
      : { dbPath: ':memory:' };
  const db = await openDatabase(dbOptions);
  const app = createApp({ config, db, fetchImpl, sleep: async () => {}, clock });
  // Simple synchronous-looking helpers for assertions in tests.
  const q = {
    count: async (sql, params) => Number((await db.get(sql, params)).n),
    get: (sql, params) => db.get(sql, params),
  };
  return { app, db, q, config, services: app.locals.services };
}

/** Builds a Response-like object for stubbed fetch. */
export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * Stub fetch that returns queued responses in order and records each request.
 * Each queue item is a Response, a function (url, init) => Response, or an Error to throw.
 */
export function queuedFetch(queue) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    const res = typeof next === 'function' ? await next(url, init) : next;
    return res.clone ? res.clone() : res;
  };
  fn.calls = calls;
  return fn;
}

/** A fetch that never resolves until aborted, to exercise timeouts. */
export function hangingFetch() {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
}

export function decisionsBody({ team = 'infrastructure', teamConf = 0.82, score = 4.2, legend, noul = 0.71, review = 0.1, model = 'typesafe/jev-1.13', provider = 'TypeSafe', cost = 0.00001 } = {}) {
  return {
    id: 'dec_123',
    model,
    provider,
    answers: {
      team: { type: 'choice', choice: team, confidence: teamConf, probabilities: { [team]: 0.9 } },
      severity: { type: 'score', score, confidence: 0.6, probabilities: {}, ...(legend ? { legend } : {}) },
      sla_breach: { type: 'noul', noul },
      needs_human_review: { type: 'noul', noul: review },
    },
    usage: { cost, input_tokens: 420, output_tokens: 0 },
  };
}

export function chatBody(obj, { model = 'test/vision-model', finish = 'stop', content } = {}) {
  return {
    id: 'gen-1',
    model,
    provider: 'TestProvider',
    choices: [{ finish_reason: finish, message: { role: 'assistant', content: content ?? JSON.stringify(obj) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.0002 },
  };
}

export const llmOutput = (over = {}) => ({
  team: 'frontend',
  severity: 3,
  riskLevel: 'medium',
  needsHumanReview: false,
  explanation: 'Button overflows viewport on mobile.',
  screenshotFindings: null,
  ...over,
});

export function ticketFor(over = {}) {
  return {
    ticketId: 'TCK-TEST',
    subject: 'Production API returning 502 errors',
    description: 'All requests to the API fail with 502 since this morning.',
    logs: 'status=502 api_key=sk-test-abcdefghijklmnop1234',
    environment: 'production',
    affectedUsers: 500,
    minutesUntilSlaDeadline: 60,
    slaDeadlineAt: new Date(FIXED_NOW.getTime() + 60 * 60000).toISOString(),
    hasImage: false,
    ...over,
  };
}
