import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { beforeAll } from 'vitest';
import { chatBody, decisionsBody, DRIVERS, jsonResponse, llmOutput, makeTestApp, queuedFetch, setTestDriver } from './helpers.js';
import { makeDemoPng } from '../src/utils/png.js';
import { SAMPLE_TICKETS } from './fixtures/sampleTickets.js';

const base = {
  subject: 'Invoice shows duplicate charge',
  description: 'Our invoice for October has the same subscription charge twice.',
  logs: '',
  environment: 'production',
  affectedUsers: 2,
  minutesUntilSlaDeadline: 600,
};
const sample = (key) => SAMPLE_TICKETS.find((s) => s.key === key).ticket;
const KEY = 'sk-or-v1-secretkey';
const env = { OPENROUTER_API_KEY: KEY, OPENROUTER_VISION_MODEL: 'test/vision-model' };

/** A stubbed OpenRouter: every Decisions call returns the same answers. */
const decisions = (over) => queuedFetch([jsonResponse(decisionsBody(over))]);
const live = (over, extraEnv = {}) => makeTestApp({ env: { ...env, ...extraEnv }, fetchImpl: decisions(over) });

describe.each(DRIVERS)('database driver: %s', (driver) => {
  beforeAll(() => setTestDriver(driver));

  describe('tickets API', () => {
    it('health and docs are available', async () => {
      const { app } = await live();
      const h = await request(app).get('/health');
      expect(h.status).toBe(200);
      expect(h.body).toMatchObject({ status: 'ok', mode: 'live' });
      expect((await request(app).get('/api-docs/')).status).toBe(200);
      expect((await request((await makeTestApp()).app).get('/health')).body.mode).toBe('not_configured');
    });

    it('creates and fetches a ticket (JSON, no triage)', async () => {
      const { app } = await live();
      const c = await request(app).post('/api/tickets').send({ ...base, ticketId: 'TCK-1' });
      expect(c.status).toBe(201);
      expect(c.body.ticket).toMatchObject({ ticketId: 'TCK-1', status: 'new', minutesRemaining: 600, hasImage: false, environment: 'production' });
      expect(c.body.ticket.tenantId).toBeUndefined();
      const g = await request(app).get('/api/tickets/TCK-1');
      expect(g.status).toBe(200);
      expect(g.body.runs).toEqual([]);
      expect((await request(app).get('/api/tickets/NOPE-1')).status).toBe(404);
    });

    it('rejects invalid tickets, unknown fields (e.g. tenantId) and duplicate ids', async () => {
      const { app } = await live();
      const bad = await request(app).post('/api/tickets').send({ ...base, affectedUsers: -5 });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('validation_error');
      expect((await request(app).post('/api/tickets').send({ ...base, tenantId: 'acme' })).status).toBe(400);
      await request(app).post('/api/tickets').send({ ...base, ticketId: 'TCK-D' });
      expect((await request(app).post('/api/tickets').send({ ...base, ticketId: 'TCK-D' })).status).toBe(409);
    });

    it('rejects a spoofed image (wrong magic bytes), unsupported types and oversized uploads', async () => {
      const { app, q } = await live();
      const spoof = await request(app)
        .post('/api/tickets')
        .field({ ...base })
        .attach('screenshot', Buffer.from('not really a png'), { filename: 'x.png', contentType: 'image/png' });
      expect(spoof.status).toBe(400);
      expect(spoof.body.error.code).toBe('invalid_file_signature');
      const gif = await request(app)
        .post('/api/tickets')
        .field({ ...base })
        .attach('screenshot', Buffer.from('GIF89a'), { filename: 'x.gif', contentType: 'image/gif' });
      expect(gif.status).toBe(415);
      expect(await q.count('SELECT COUNT(*) n FROM tickets')).toBe(0);

      const small = await makeTestApp({ env: { MAX_UPLOAD_MB: '0.001' } });
      const big = Buffer.concat([makeDemoPng(), Buffer.alloc(4096)]);
      const res = await request(small.app).post('/api/tickets').field({ ...base }).attach('screenshot', big, { filename: 'b.png', contentType: 'image/png' });
      expect(res.status).toBe(413);
    });

    it('every triage creates a new run; escalations are idempotent', async () => {
      const { app, q } = await live({ team: 'infrastructure', score: 5 });
      await request(app).post('/api/tickets').send({ ...sample('infra-eu-outage'), ticketId: 'TCK-OUT', minutesUntilSlaDeadline: 3 });
      const t1 = await request(app).post('/api/triage/TCK-OUT').send({});
      expect(t1.status).toBe(200);
      expect(t1.body.result).toMatchObject({ provider: 'jev', severity: 5, team: 'infrastructure' });
      expect(t1.body.escalations.map((e) => e.rule).sort()).toEqual(['critical_severity', 'deadline_imminent']);
      expect(t1.body.escalations.every((e) => !e.alreadyRecorded && e.status === 'recorded')).toBe(true);
      expect(t1.body.ticket.status).toBe('escalated');

      const t2 = await request(app).post('/api/triage/TCK-OUT').send({});
      expect(t2.body.escalations.every((e) => e.alreadyRecorded)).toBe(true);
      expect(await q.count('SELECT COUNT(*) n FROM escalations')).toBe(2);
      expect(await q.count('SELECT COUNT(*) n FROM triage_runs')).toBe(2);

      const detail = await request(app).get('/api/tickets/TCK-OUT');
      expect(detail.body.runs).toHaveLength(2);
      expect(detail.body.escalations).toHaveLength(2);
      expect(detail.body.escalations[0].riskSnapshot).toMatchObject({ severity: 5, minutesRemaining: 3 });
      expect(detail.body.latestResult.provider).toBe('jev');
      expect((await request(app).get('/api/escalations')).body.escalations).toHaveLength(2);
    });

    it('ambiguous ticket goes to human review; review PATCH records the decision', async () => {
      const { app } = await live({ team: 'unknown', review: 0.9 });
      const c = await request(app).post('/api/tickets').send({ ...sample('ambiguous'), ticketId: 'TCK-AMB', triageMode: 'auto' });
      expect(c.body.triage.result).toMatchObject({ team: 'unknown', humanReviewRequired: true });
      expect(c.body.ticket.status).toBe('review_required');
      expect((await request(app).get('/api/dashboard/stats')).body.awaitingReview).toBe(1);

      const rv = await request(app).patch('/api/tickets/TCK-AMB/review').send({ decision: 'overridden', team: 'infrastructure', severity: 3, reviewer: 'ops-lead' });
      expect(rv.status).toBe(200);
      expect(rv.body.ticket.status).toBe('reviewed');
      expect((await request(app).get('/api/tickets/TCK-AMB')).body.reviews[0]).toMatchObject({ decision: 'overridden', team: 'infrastructure' });
      expect((await request(app).patch('/api/tickets/TCK-AMB/review').send({ decision: 'maybe', reviewer: 'x' })).status).toBe(400);
    });

    it('without a key the ticket is saved, flagged for review, and the deadline rule still applies', async () => {
      const { app, q } = await makeTestApp();
      const c = await request(app).post('/api/tickets').send({ ...base, ticketId: 'TCK-NOKEY', minutesUntilSlaDeadline: 2, triageMode: 'auto' });
      expect(c.status).toBe(201);
      expect(c.body.triage.result).toMatchObject({ provider: 'none', status: 'failed', humanReviewRequired: true, error: { code: 'no_provider_configured' } });
      expect(c.body.triage.escalations.map((e) => e.rule)).toEqual(['deadline_imminent']);
      expect(await q.count("SELECT COUNT(*) n FROM tickets WHERE ticket_id='TCK-NOKEY'")).toBe(1);
    });

    it('dashboard stats aggregate teams, severity, providers and evidence', async () => {
      const fetchImpl = async (_url, init) => {
        const subject = JSON.parse(init.body).state.subject;
        const team = /charged|invoice/i.test(subject) ? 'billing' : /502|outage/i.test(subject) ? 'infrastructure' : /SSO|login/i.test(subject) ? 'auth_identity' : 'frontend';
        return jsonResponse(decisionsBody({ team, score: 3 }));
      };
      const { app } = await makeTestApp({ env, fetchImpl });
      for (const key of ['billing-double-charge', 'infra-eu-outage', 'auth-saml-rotation', 'frontend-blank-charts']) {
        await request(app).post('/api/tickets').send({ ...sample(key), triageMode: 'auto' });
      }
      const s = (await request(app).get('/api/dashboard/stats')).body;
      expect(s.totalTickets).toBe(4);
      expect(s.byTeam).toMatchObject({ billing: 1, infrastructure: 1, auth_identity: 1, frontend: 1 });
      expect(s.severityDistribution[3]).toBe(4);
      expect(s.providers[0]).toMatchObject({ provider: 'jev', success: 4, failure: 0 });
      expect(s.providers[0].simulated).toBeUndefined();
      expect(s.ticketsByEvidence).toEqual({ textOnly: 4, withImage: 0 });
      expect((await request(app).get('/api/tickets?team=billing')).body.tickets).toHaveLength(1);
    });
  });

  describe('API with providers (stubbed OpenRouter)', () => {
    it('providers endpoint never leaks the key and lists only real providers', async () => {
      const { app } = await live();
      const res = await request(app).get('/api/providers');
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(KEY);
      expect(res.body.mode).toBe('live');
      expect(res.body.providers.map((p) => p.id)).toEqual(['jev', 'luna', 'openrouter_llm']);
      expect(res.body.providers[0]).toMatchObject({ configured: true, transport: 'openrouter_decisions', textModel: 'typesafe/jev-1.13' });
    });

    it('text ticket is routed to Jev via the Decisions endpoint', async () => {
      const fetchImpl = decisions({ noul: 0.95 });
      const { app } = await makeTestApp({ env, fetchImpl });
      const r = await request(app).post('/api/tickets').send({ ...sample('infra-eu-outage'), triageMode: 'auto' });
      expect(fetchImpl.calls[0].url).toMatch(/\/api\/alpha\/decisions$/);
      expect(JSON.stringify(fetchImpl.calls[0].body.state)).not.toMatch(/tenant/);
      expect(r.body.triage.result).toMatchObject({
        provider: 'jev',
        riskOutputType: 'probability',
        calibrationStatus: 'vendor_claimed',
        breachProbability: 0.95,
      });
      // Vendor-claimed probability does not auto-escalate by default.
      expect(r.body.triage.escalations.map((e) => e.rule)).not.toContain('probability_threshold');
      expect(r.body.triage.result.reviewReasons.join(' ')).toMatch(/vendor_claimed/);
    });

    it('stores the provider request/response (key masked) and explains every policy check', async () => {
      const fetchImpl = queuedFetch([
        jsonResponse({ error: { code: 429, message: 'Rate limited' } }, { status: 429 }),
        jsonResponse(decisionsBody({ noul: 0.6 })),
      ]);
      const { app } = await makeTestApp({ env, fetchImpl });
      const r = await request(app).post('/api/tickets').send({ ...base, ticketId: 'TCK-EX', triageMode: 'auto' });
      const ex = r.body.triage.result.exchange;
      expect(ex.request).toMatchObject({ method: 'POST', url: 'https://openrouter.ai/api/alpha/decisions', headers: { Authorization: 'Bearer ***' } });
      expect(ex.request.body.questions.team.type).toBe('choice');
      expect(ex.responses.map((x) => [x.attempt, x.status])).toEqual([
        [1, 429],
        [2, 200],
      ]);
      expect(ex.responses[1].body.answers.sla_breach.noul).toBe(0.6);
      expect(r.body.triage.result.policyDecision.checks.map((c) => [c.rule, c.fired])).toEqual([
        ['deadline_imminent', false],
        ['critical_severity', false],
        ['probability_threshold', false],
      ]);

      // Persisted with the run, and the key never appears anywhere in the ticket detail.
      const detail = await request(app).get('/api/tickets/TCK-EX');
      expect(detail.body.latestResult.exchange.responses).toHaveLength(2);
      expect(JSON.stringify(detail.body)).not.toContain(KEY);
    });

    it('shortens screenshot data URLs in the stored request', async () => {
      const fetchImpl = queuedFetch([jsonResponse(chatBody(llmOutput()))]);
      const { app } = await makeTestApp({ env, fetchImpl });
      const r = await request(app)
        .post('/api/tickets')
        .field({ ...base, affectedUsers: '2', minutesUntilSlaDeadline: '600', triageMode: 'auto' })
        .attach('screenshot', makeDemoPng(), { filename: 's.png', contentType: 'image/png' });
      const imagePart = r.body.triage.result.exchange.request.body.messages[1].content[1];
      expect(imagePart.image_url.url).toMatch(/^data:image\/png;base64,…\(\d+ base64 chars omitted\)$/);
    });

    it('vendor-claimed probability escalates when trust is explicitly enabled', async () => {
      const { app } = await live({ noul: 0.95 }, { SLA_TRUST_VENDOR_CALIBRATION: 'true' });
      const r = await request(app).post('/api/tickets').send({ ...base, triageMode: 'auto' });
      expect(r.body.triage.escalations.map((e) => e.rule)).toContain('probability_threshold');
    });

    it('falls back to the next provider when the first fails', async () => {
      const fetchImpl = queuedFetch([
        jsonResponse({ error: { code: 401, message: 'bad key' } }, { status: 401 }),
        jsonResponse(decisionsBody({ model: 'openai/gpt-6-luna-decisions', noul: 0.4 })),
      ]);
      const { app } = await makeTestApp({ env, fetchImpl });
      const r = await request(app).post('/api/tickets').send({ ...base, triageMode: 'auto' });
      expect(r.body.triage.attempts.map((a) => [a.provider, a.status])).toEqual([
        ['jev', 'failed'],
        ['luna', 'ok'],
      ]);
      expect(r.body.triage.result).toMatchObject({ provider: 'luna', riskOutputType: 'predicate', predicateVerdict: false });
    });

    it('all providers failing -> review-required result, ticket kept, deadline rule still applies', async () => {
      const fetchImpl = queuedFetch([jsonResponse({ error: { code: 503, message: 'down' } }, { status: 503 })]);
      const { app, q } = await makeTestApp({ env, fetchImpl });
      const r = await request(app).post('/api/tickets').send({ ...base, ticketId: 'TCK-DOWN', minutesUntilSlaDeadline: 2, triageMode: 'auto' });
      expect(r.status).toBe(201);
      expect(r.body.triage.result).toMatchObject({ provider: 'none', status: 'failed', humanReviewRequired: true });
      expect(r.body.triage.result.error.code).toBe('all_providers_failed');
      expect(r.body.triage.escalations.map((e) => e.rule)).toEqual(['deadline_imminent']);
      expect(r.body.ticket.status).toBe('escalated');
      expect(await q.count("SELECT COUNT(*) n FROM provider_results WHERE ticket_id='TCK-DOWN'")).toBe(4);
    });

    it('screenshot ticket is stored (metadata only) and routed to the OpenRouter vision model', async () => {
      const fetchImpl = queuedFetch([jsonResponse(chatBody(llmOutput({ screenshotFindings: 'Red button overflows the viewport' })))]);
      const { app, q } = await makeTestApp({ env, fetchImpl });
      const r = await request(app)
        .post('/api/tickets')
        .field({ ...sample('frontend-screenshot'), affectedUsers: '900', minutesUntilSlaDeadline: '60', triageMode: 'auto' })
        .attach('screenshot', makeDemoPng(), { filename: 'mobile.png', contentType: 'image/png' });
      expect(r.status).toBe(201);
      expect(r.body.ticket.attachments[0]).toMatchObject({ mimeType: 'image/png', originalName: 'mobile.png' });
      expect((await q.get('SELECT stored_name FROM attachments')).stored_name).toMatch(/^[0-9a-f-]{36}\.png$/);
      expect(fetchImpl.calls[0].url).toMatch(/chat\/completions$/);
      expect(fetchImpl.calls[0].body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
      expect(r.body.triage.result).toMatchObject({ provider: 'openrouter_llm', model: 'test/vision-model', riskOutputType: 'qualitative' });
      expect(r.body.triage.result.explanation).toMatch(/Red button overflows/);
    });

    it('comparison keeps partial failures and marks unconfigured providers unavailable', async () => {
      const fetchImpl = async (_url, init) => {
        const body = JSON.parse(init.body);
        if (body.model === 'typesafe/jev-1.13') return jsonResponse({ error: { code: 429, message: 'slow down' } }, { status: 429 });
        return jsonResponse(decisionsBody({ model: body.model, noul: 0.8 }));
      };
      const { app } = await makeTestApp({ env: { OPENROUTER_API_KEY: KEY }, fetchImpl });
      await request(app).post('/api/tickets').send({ ...base, ticketId: 'TCK-RC' });
      const r = await request(app).post('/api/triage/compare').send({ ticketId: 'TCK-RC', providers: ['jev', 'luna', 'openrouter_llm'] });
      expect(r.status).toBe(200);
      expect(r.body.results.map((x) => [x.provider, x.status, x.error?.code ?? null])).toEqual([
        ['jev', 'failed', 'rate_limited'],
        ['luna', 'ok', null],
        ['openrouter_llm', 'unavailable', 'not_configured'],
      ]);
      expect(r.body.summary).toMatchObject({ succeeded: 1, failed: 2 });
      expect((await request(app).get('/api/tickets/TCK-RC')).body.runs[0].results).toHaveLength(3);
      expect((await request(app).post('/api/triage/compare').send({ ticketId: 'TCK-RC', providers: ['jev'] })).status).toBe(400);
      expect((await request(app).post('/api/triage/compare').send({ ticketId: 'TCK-RC', providers: ['jev', 'mock'] })).status).toBe(400);
    });
  });
});
