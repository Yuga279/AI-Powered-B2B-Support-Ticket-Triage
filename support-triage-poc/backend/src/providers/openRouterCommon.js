import { ProviderError } from './httpClient.js';

export function openRouterHeaders(orConfig) {
  const h = {
    Authorization: `Bearer ${orConfig.apiKey}`,
    'X-OpenRouter-Title': orConfig.appTitle,
    'X-Title': orConfig.appTitle,
  };
  if (orConfig.appUrl) h['HTTP-Referer'] = orConfig.appUrl;
  return h;
}

/** OpenRouter can return HTTP 200 with an `error` object instead of a result. */
export function throwIfBodyError(json) {
  if (json && typeof json === 'object' && json.error) {
    const code = Number(json.error.code);
    const map = { 401: 'auth_failed', 402: 'insufficient_credits', 403: 'forbidden', 408: 'timeout', 429: 'rate_limited' };
    throw new ProviderError(map[code] || 'upstream_error', String(json.error.message || 'Provider returned an error').slice(0, 500), {
      status: Number.isFinite(code) ? code : null,
      retryable: [408, 429, 502, 503].includes(code),
      details: json.error.metadata,
    });
  }
}

export function requireKey(orConfig) {
  if (!orConfig.apiKey) {
    throw new ProviderError('not_configured', 'OPENROUTER_API_KEY is not set on the backend');
  }
}
