import { createJevProvider } from './jevProvider.js';
import { createLunaProvider } from './lunaProvider.js';
import { createOpenRouterLlmProvider } from './openRouterLlmProvider.js';

/**
 * Holds every provider adapter. All of them go through OpenRouter with the single backend key.
 * `deps.fetchImpl` / `deps.sleep` allow tests to stub the network.
 */
export function createProviderRegistry(config, deps = {}) {
  const providers = {
    jev: createJevProvider({ config, ...deps }),
    luna: createLunaProvider({ config, ...deps }),
    openrouter_llm: createOpenRouterLlmProvider({ config, ...deps }),
  };

  return {
    get: (id) => providers[id],
    anyConfigured: () => Object.values(providers).some((p) => p.isConfigured()),
    describe() {
      return Object.values(providers).map((p) => ({
        id: p.id,
        label: p.label,
        transport: p.transport,
        upstream: p.upstreamLabel,
        riskSemantics: p.riskSemantics,
        configured: p.isConfigured(),
        configIssue: p.configIssue(),
        supportsImages: p.supportsImages(),
        textModel: p.modelFor(false) ?? null,
        imageModel: p.supportsImages() ? (p.modelFor(true) ?? null) : null,
      }));
    },
  };
}
