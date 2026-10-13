import { PROVIDER_IDS } from '../validators/domain.js';

/**
 * Decides the ordered provider chain for automatic mode.
 *  - Image tickets: Luna if its image mode is enabled, then the OpenRouter vision LLM, then text-only fallbacks.
 *  - Text tickets: TEXT_PROVIDER first (default jev), then the other configured providers.
 * An empty chain means no provider is configured; the run then returns a review-required result.
 */
export function planAutoRoute({ hasImage, registry, config }) {
  const configured = (id) => registry.get(id).isConfigured();
  const notes = [];
  const chain = [];
  const add = (id) => {
    if (!chain.includes(id) && configured(id)) chain.push(id);
  };

  if (hasImage) {
    if (registry.get('luna').supportsImages()) add('luna');
    if (registry.get('openrouter_llm').supportsImages()) add('openrouter_llm');
    if (chain.length === 0) notes.push('No image-capable provider configured: screenshot will not be analyzed');
  }
  for (const id of [config.textProvider, ...PROVIDER_IDS]) add(id);
  if (chain.length === 0) notes.push('No AI provider configured: set OPENROUTER_API_KEY');
  return { chain, notes };
}
