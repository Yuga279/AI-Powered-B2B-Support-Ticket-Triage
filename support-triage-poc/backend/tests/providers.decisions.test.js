import { describe, expect, it } from 'vitest';
import { createJevProvider } from '../src/providers/jevProvider.js';
import { createLunaProvider } from '../src/providers/lunaProvider.js';
import { mapScoreToSeverity, mapTeam } from '../src/providers/openRouterDecisionsClient.js';
import { normalizeProviderOutput } from '../src/services/normalizer.js';
import { decisionsBody, hangingFetch, jsonResponse, queuedFetch, testConfig, ticketFor } from './helpers.js';

const KEY = 'sk-or-v1-testkey';
const cfg = (env = {}) => testConfig({ OPENROUTER_API_KEY: KEY, ...env });
const noSleep = async () => {};
const image = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };

describe('Decisions request shape (OpenRouter /api/alpha/decisions)', () => {
  it('Jev sends model, state and keyed questions with the documented types', async () => {
    const fetchImpl = queuedFetch([jsonResponse(decisionsBody())]);
    await createJevProvider({ config: cfg(), fetchImpl, sleep: noSleep }).classify({ ticket: ticketFor() });
    const [call] = fetchImpl.calls;
    expect(call.url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(call.body.model).toBe('typesafe/jev-1.13');
    expect(Object.keys(call.body)).toEqual(['model', 'state', 'questions']);
    const q = call.body.questions;
    expect(q.team.type).toBe('choice');
    expect(Object.keys(q.team.criteria)).toEqual(['billing', 'infrastructure', 'auth_identity', 'frontend', 'unknown']);
    expect(q.severity.type).toBe('score');
    expect(q.severity.criteria).toHaveLength(5);
    expect(q.sla_breach).toMatchObject({ type: 'noul', criteria: { true: expect.any(String), false: expect.any(String) } });
    expect(q.needs_human_review.type).toBe('noul');
  });

  it('redacts secrets and never sends the API key in the state', async () => {
    const fetchImpl = queuedFetch([jsonResponse(decisionsBody())]);
    await createJevProvider({ config: cfg(), fetchImpl, sleep: noSleep }).classify({ ticket: ticketFor() });
    const state = JSON.stringify(fetchImpl.calls[0].body.state);
    expect(state).not.toContain('sk-test-abcdefghijklmnop1234');
    expect(state).not.toContain(KEY);
    expect(state).toContain('[REDACTED]');
  });

  it('Jev never sends images (text-only) and notes the screenshot was not analyzed', async () => {
    const fetchImpl = queuedFetch([jsonResponse(decisionsBody())]);
    const out = await createJevProvider({ config: cfg(), fetchImpl, sleep: noSleep }).classify({ ticket: ticketFor(), images: [image] });
    expect(JSON.stringify(fetchImpl.calls[0].body)).not.toContain('data:image');
    expect(out.reviewNotes.join(' ')).toMatch(/text-only/);
  });

  it('Luna sends image parts only when LUNA_IMAGE_MODE is enabled', async () => {
    const off = queuedFetch([jsonResponse(decisionsBody({ model: 'openai/gpt-6-luna-decisions' }))]);
    await createLunaProvider({ config: cfg(), fetchImpl: off, sleep: noSleep }).classify({ ticket: ticketFor(), images: [image] });
    expect(Array.isArray(off.calls[0].body.state)).toBe(false);

    const on = queuedFetch([jsonResponse(decisionsBody({ model: 'openai/gpt-6-luna-decisions' }))]);
    await createLunaProvider({ config: cfg({ LUNA_IMAGE_MODE: 'state_parts' }), fetchImpl: on, sleep: noSleep }).classify({
      ticket: ticketFor(),
      images: [image],
    });
    const state = on.calls[0].body.state;
    expect(state[0].type).toBe('text');
    expect(state[1]).toEqual({ type: 'image_url', image_url: { url: image.dataUrl } });
  });
});

describe('Decisions risk semantics', () => {
  it('Jev noul is a probability with vendor-claimed calibration', async () => {
    const fetchImpl = queuedFetch([jsonResponse(decisionsBody({ noul: 0.91 }))]);
    const out = await createJevProvider({ config: cfg(), fetchImpl, sleep: noSleep }).classify({ ticket: ticketFor() });
    expect(out).toMatchObject({
      riskOutputType: 'probability',
      breachProbability: 0.91,
      calibrationStatus: 'vendor_claimed',
      predicateScore: null,
      predicateVerdict: null,
      team: 'infrastructure',
      severity: 4,
      rawSeverity: 4.2,
      costUsd: 0.00001,
    });
  });

  it('Luna noul stays a predicate: score + verdict, no breach probability', async () => {
    const fetchImpl = queuedFetch([jsonResponse(decisionsBody({ noul: 0.92, model: 'openai/gpt-6-luna-decisions' }))]);
    const out = await createLunaProvider({ config: cfg(), fetchImpl, sleep: noSleep }).classify({ ticket: ticketFor() });
    expect(out).toMatchObject({
      riskOutputType: 'predicate',
      breachProbability: null,
      calibrationStatus: 'unknown',
      predicateScore: 0.92,
      predicateVerdict: true,
    });
    const low = queuedFetch([jsonResponse(decisionsBody({ noul: 0.3 }))]);
    const out2 = await createLunaProvider({ config: cfg(), fetchImpl: low, sleep: noSleep }).classify({ ticket: ticketFor() });
    expect(out2.predicateVerdict).toBe(false);
  });

  it('maps out-of-enum teams to unknown with a review note', async () => {
    const fetchImpl = queuedFetch([jsonResponse(decisionsBody({ team: 'payments' }))]);
    const out = await createJevProvider({ config: cfg(), fetchImpl, sleep: noSleep }).classify({ ticket: ticketFor() });
    expect(out.team).toBe('unknown');
    expect(out.reviewNotes.join(' ')).toMatch(/payments/);
  });

  it('flags model-requested human review', async () => {
    const fetchImpl = queuedFetch([jsonResponse(decisionsBody({ review: 0.8 }))]);
    const out = await createJevProvider({ config: cfg(), fetchImpl, sleep: noSleep }).classify({ ticket: ticketFor() });
    expect(out.aiReviewSignal).toBe(true);
  });
});

describe('severity and team mapping', () => {
  it('rounds and clamps fractional scores to 1-5', () => {
    expect(mapScoreToSeverity(4.2)).toBe(4);
    expect(mapScoreToSeverity(4.5)).toBe(5);
    expect(mapScoreToSeverity(0.2)).toBe(1);
    expect(mapScoreToSeverity(7)).toBe(5);
  });
  it('treats a zero-based legend as level 1', () => {
    expect(mapScoreToSeverity(3.6, { 0: 'a', 1: 'b', 2: 'c', 3: 'd', 4: 'e' })).toBe(5);
    expect(mapScoreToSeverity(0, { 0: 'a', 1: 'b', 2: 'c', 3: 'd', 4: 'e' })).toBe(1);
  });
  it('maps teams', () => {
    expect(mapTeam('auth_identity')).toEqual({ team: 'auth_identity', outOfEnum: false });
    expect(mapTeam('sales')).toEqual({ team: 'unknown', outOfEnum: true });
  });
});

describe('Decisions error handling', () => {
  const run = (fetchImpl, env) => createJevProvider({ config: cfg(env), fetchImpl, sleep: noSleep }).classify({ ticket: ticketFor() });

  it('missing credentials -> not_configured, no network call', async () => {
    const fetchImpl = queuedFetch([jsonResponse(decisionsBody())]);
    const p = createJevProvider({ config: testConfig(), fetchImpl, sleep: noSleep });
    expect(p.isConfigured()).toBe(false);
    await expect(p.classify({ ticket: ticketFor() })).rejects.toMatchObject({ code: 'not_configured' });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('401 -> auth_failed without retry', async () => {
    const fetchImpl = queuedFetch([jsonResponse({ error: { code: 401, message: 'No auth credentials found' } }, { status: 401 })]);
    await expect(run(fetchImpl)).rejects.toMatchObject({ code: 'auth_failed', status: 401 });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('402 -> insufficient_credits without retry', async () => {
    const fetchImpl = queuedFetch([jsonResponse({ error: { code: 402, message: 'Insufficient credits' } }, { status: 402 })]);
    await expect(run(fetchImpl)).rejects.toMatchObject({ code: 'insufficient_credits' });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('429 is retried (bounded) and can recover', async () => {
    const fetchImpl = queuedFetch([
      jsonResponse({ error: { code: 429, message: 'Rate limited' } }, { status: 429, headers: { 'retry-after': '1' } }),
      jsonResponse(decisionsBody()),
    ]);
    const out = await run(fetchImpl);
    expect(out.team).toBe('infrastructure');
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('429 exhausts retries -> rate_limited after 1 + PROVIDER_MAX_RETRIES attempts', async () => {
    const fetchImpl = queuedFetch([jsonResponse({ error: { code: 429, message: 'Rate limited' } }, { status: 429 })]);
    await expect(run(fetchImpl)).rejects.toMatchObject({ code: 'rate_limited', retryable: true });
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it('529 overloaded is treated as transient upstream_error', async () => {
    const fetchImpl = queuedFetch([jsonResponse({ error: { message: 'overloaded' } }, { status: 529 }), jsonResponse(decisionsBody())]);
    await expect(run(fetchImpl)).resolves.toBeTruthy();
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('timeout -> timeout error, not retried', async () => {
    const fetchImpl = Object.assign(hangingFetch(), {});
    let calls = 0;
    const counting = (...a) => {
      calls++;
      return fetchImpl(...a);
    };
    await expect(run(counting, { PROVIDER_TIMEOUT_MS: '30' })).rejects.toMatchObject({ code: 'timeout' });
    expect(calls).toBe(1);
  });

  it('HTTP 200 carrying an error object is a failure', async () => {
    const fetchImpl = queuedFetch([jsonResponse({ error: { code: 502, message: 'Upstream model down' } })]);
    await expect(run(fetchImpl)).rejects.toMatchObject({ code: 'upstream_error' });
  });

  it.each([
    ['non-JSON body', new Response('<html>oops</html>', { status: 200 })],
    ['missing answers', jsonResponse({ model: 'x' })],
    ['missing answer key', jsonResponse({ answers: { team: { type: 'choice', choice: 'billing' } } })],
    ['noul out of range', jsonResponse(decisionsBody({ noul: 1.7 }))],
    ['refusal', jsonResponse({ answers: { ...decisionsBody().answers, team: { type: 'refusal' } } })],
  ])('malformed response (%s) -> malformed_response', async (_name, res) => {
    await expect(run(queuedFetch([res]))).rejects.toMatchObject({ code: 'malformed_response' });
  });
});

describe('normalization of decision outputs', () => {
  it('produces a valid normalized Jev result', async () => {
    const config = cfg();
    const provider = createJevProvider({ config, fetchImpl: queuedFetch([jsonResponse(decisionsBody())]), sleep: noSleep });
    const out = await provider.classify({ ticket: ticketFor() });
    const r = normalizeProviderOutput({ ticketId: 'TCK-TEST', provider, out, durationMs: 120, decidedAt: new Date().toISOString() });
    expect(r.status).toBe('ok');
    expect(r).toMatchObject({ provider: 'jev', transport: 'openrouter_decisions', model: 'typesafe/jev-1.13' });
  });

  it('rejects outputs that violate the contract (e.g. predicate with breachProbability)', () => {
    const provider = { id: 'luna', transport: 'openrouter_decisions', label: 'Luna', modelFor: () => 'm' };
    const out = {
      team: 'billing',
      severity: 3,
      riskOutputType: 'predicate',
      breachProbability: 0.9,
      calibrationStatus: 'unknown',
      predicateScore: 0.9,
      predicateVerdict: true,
      riskAssessment: { level: 'high', summary: 's' },
      explanation: 'x',
    };
    const r = normalizeProviderOutput({ ticketId: 'T', provider, out, durationMs: 1, decidedAt: 'now' });
    expect(r.status).toBe('invalid');
    expect(r.error.code).toBe('invalid_result');
    expect(r.breachProbability).toBeNull();
  });

  it('rejects severity outside 1-5', () => {
    const provider = { id: 'openrouter_llm', transport: 'openrouter_chat', label: 'LLM', modelFor: () => 'm' };
    const out = {
      team: 'billing',
      severity: 9,
      riskOutputType: 'qualitative',
      calibrationStatus: 'not_applicable',
      riskAssessment: { level: 'low', summary: 's' },
      explanation: 'x',
    };
    expect(normalizeProviderOutput({ ticketId: 'T', provider, out, durationMs: 1, decidedAt: 'now' }).status).toBe('invalid');
  });
});
