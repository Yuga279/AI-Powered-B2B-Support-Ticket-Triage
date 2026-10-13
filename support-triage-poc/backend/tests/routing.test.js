import { describe, expect, it } from 'vitest';
import { planAutoRoute } from '../src/services/routingService.js';
import { createProviderRegistry } from '../src/providers/registry.js';
import { testConfig } from './helpers.js';

const route = (env, hasImage) => {
  const config = testConfig(env);
  return planAutoRoute({ hasImage, registry: createProviderRegistry(config), config });
};
const KEY = { OPENROUTER_API_KEY: 'sk-or-v1-k' };

describe('automatic routing', () => {
  it('returns an empty chain with a note when no key is configured', () => {
    const r = route({}, false);
    expect(r.chain).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/No AI provider configured/);
  });

  it('text: TEXT_PROVIDER first, then the other configured providers', () => {
    expect(route(KEY, false).chain).toEqual(['jev', 'luna']);
    expect(route({ ...KEY, OPENROUTER_MODEL: 'm' }, false).chain).toEqual(['jev', 'luna', 'openrouter_llm']);
    expect(route({ ...KEY, OPENROUTER_MODEL: 'm', TEXT_PROVIDER: 'openrouter_llm' }, false).chain).toEqual(['openrouter_llm', 'jev', 'luna']);
  });

  it('image: OpenRouter vision model first when Luna image mode is off', () => {
    expect(route({ ...KEY, OPENROUTER_VISION_MODEL: 'v' }, true).chain).toEqual(['openrouter_llm', 'jev', 'luna']);
  });

  it('image: Luna first when its image mode is enabled', () => {
    expect(route({ ...KEY, OPENROUTER_VISION_MODEL: 'v', LUNA_IMAGE_MODE: 'state_parts' }, true).chain).toEqual(['luna', 'openrouter_llm', 'jev']);
  });

  it('image without any vision provider: text providers with a note', () => {
    const r = route(KEY, true);
    expect(r.chain).toEqual(['jev', 'luna']);
    expect(r.notes[0]).toMatch(/screenshot will not be analyzed/);
  });
});
