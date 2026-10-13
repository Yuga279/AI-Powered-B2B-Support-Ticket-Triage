import { describe, expect, it } from 'vitest';
import { createOpenRouterLlmProvider, parseLlmContent } from '../src/providers/openRouterLlmProvider.js';
import { chatBody, jsonResponse, llmOutput, queuedFetch, testConfig, ticketFor } from './helpers.js';

const env = { OPENROUTER_API_KEY: 'sk-or-v1-testkey', OPENROUTER_MODEL: 'test/text-model', OPENROUTER_VISION_MODEL: 'test/vision-model' };
const make = (fetchImpl, extra = {}) =>
  createOpenRouterLlmProvider({ config: testConfig({ ...env, ...extra }), fetchImpl, sleep: async () => {} });
const image = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };

describe('OpenRouter LLM (chat completions)', () => {
  it('text ticket: uses OPENROUTER_MODEL, strict json_schema and require_parameters', async () => {
    const fetchImpl = queuedFetch([jsonResponse(chatBody(llmOutput({ team: 'infrastructure', severity: 4, riskLevel: 'high' }), { model: 'test/text-model' }))]);
    const out = await make(fetchImpl).classify({ ticket: ticketFor() });
    const { url, body, init } = fetchImpl.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-or-v1-testkey');
    expect(body.model).toBe('test/text-model');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.provider).toEqual({ require_parameters: true });
    expect(typeof body.messages[1].content).toBe('string');
    expect(out).toMatchObject({
      team: 'infrastructure',
      severity: 4,
      riskOutputType: 'qualitative',
      breachProbability: null,
      calibrationStatus: 'not_applicable',
      riskAssessment: { level: 'high' },
    });
  });

  it('image ticket: uses the vision model and sends text first, then image_url data URL', async () => {
    const fetchImpl = queuedFetch([jsonResponse(chatBody(llmOutput({ screenshotFindings: 'Button overlaps footer' })))]);
    const out = await make(fetchImpl).classify({ ticket: ticketFor({ hasImage: true }), images: [image] });
    const { body } = fetchImpl.calls[0];
    expect(body.model).toBe('test/vision-model');
    const content = body.messages[1].content;
    expect(content[0].type).toBe('text');
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: image.dataUrl } });
    expect(out.explanation).toMatch(/Button overlaps footer/);
  });

  it('json_object fallback mode', async () => {
    const fetchImpl = queuedFetch([jsonResponse(chatBody(llmOutput()))]);
    await make(fetchImpl, { OPENROUTER_JSON_MODE: 'json_object' }).classify({ ticket: ticketFor() });
    expect(fetchImpl.calls[0].body.response_format).toEqual({ type: 'json_object' });
    expect(fetchImpl.calls[0].body.provider).toBeUndefined();
  });

  it('accepts JSON wrapped in a markdown fence', () => {
    expect(parseLlmContent('```json\n' + JSON.stringify(llmOutput()) + '\n```').team).toBe('frontend');
  });

  it.each([
    ['empty content', chatBody(null, { content: '' })],
    ['length cut-off', chatBody(null, { content: '', finish: 'length' })],
    ['invalid JSON', chatBody(null, { content: '{team: billing' })],
    ['schema violation', chatBody(llmOutput({ severity: 9 }))],
    ['unknown team', chatBody(llmOutput({ team: 'sales' }))],
    ['probability smuggled in riskLevel', chatBody(llmOutput({ riskLevel: 0.9 }))],
    ['no choices', { id: 'x', choices: [] }],
  ])('%s -> malformed_response', async (_n, body) => {
    await expect(make(queuedFetch([jsonResponse(body)])).classify({ ticket: ticketFor() })).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });

  it('HTTP 200 with error body -> failure', async () => {
    const fetchImpl = queuedFetch([jsonResponse({ error: { code: 429, message: 'Rate limited upstream' } })]);
    await expect(make(fetchImpl).classify({ ticket: ticketFor() })).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('503 retried then succeeds', async () => {
    const fetchImpl = queuedFetch([jsonResponse({ error: { code: 503, message: 'No provider' } }, { status: 503 }), jsonResponse(chatBody(llmOutput()))]);
    await expect(make(fetchImpl).classify({ ticket: ticketFor() })).resolves.toMatchObject({ team: 'frontend' });
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('not configured without a model', () => {
    const p = createOpenRouterLlmProvider({ config: testConfig({ OPENROUTER_API_KEY: 'k' }) });
    expect(p.isConfigured()).toBe(false);
    expect(p.configIssue()).toMatch(/OPENROUTER_MODEL/);
  });
});
