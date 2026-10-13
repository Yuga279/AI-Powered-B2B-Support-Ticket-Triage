import { requestJson } from '../providers/httpClient.js';
import { openRouterHeaders } from '../providers/openRouterCommon.js';

/** Provider configuration overview, with an optional credential probe via OpenRouter GET /key (no generation). */
export function createProviderStatusService({ config, registry, fetchImpl }) {
  return {
    async describe({ probe = false } = {}) {
      const providers = registry.describe();
      let credentialCheck = null;
      if (probe) {
        if (!config.openRouter.apiKey) {
          credentialCheck = { ok: false, code: 'not_configured', message: 'OPENROUTER_API_KEY not set' };
        } else {
          try {
            const { json } = await requestJson({
              url: `${config.openRouter.baseUrl}/key`,
              method: 'GET',
              headers: openRouterHeaders(config.openRouter),
              timeoutMs: 10000,
              maxRetries: 0,
              fetchImpl,
            });
            const d = json?.data || {};
            credentialCheck = {
              ok: true,
              label: d.label ?? null,
              isFreeTier: d.is_free_tier ?? null,
              limitRemaining: d.limit_remaining ?? null,
              usage: d.usage ?? null,
            };
          } catch (err) {
            credentialCheck = { ok: false, code: err.code || 'error', message: err.message };
          }
        }
      }
      return {
        mode: registry.anyConfigured() ? 'live' : 'not_configured',
        textProvider: config.textProvider,
        openRouter: {
          keyConfigured: !!config.openRouter.apiKey,
          decisionsUrl: config.openRouter.decisionsUrl,
          lunaImageMode: config.openRouter.lunaImageMode,
          jsonMode: config.openRouter.jsonMode,
        },
        policy: { ...config.policy, lunaPredicateThreshold: config.lunaPredicateThreshold },
        providers,
        credentialCheck,
      };
    },
  };
}
