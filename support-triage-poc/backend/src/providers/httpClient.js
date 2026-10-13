import { redactSecrets } from '../utils/redact.js';

/** A normalized provider failure. `retryable` describes the failure class, not whether we retried. */
export class ProviderError extends Error {
  constructor(code, message, { status = null, retryable = false, details } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

function extractMessage(body, fallback) {
  const m = body?.error?.message ?? body?.message ?? (typeof body?.error === 'string' ? body.error : null);
  return redactSecrets(String(m ?? fallback)).slice(0, 500);
}

/** Maps an HTTP status + error body into a ProviderError. */
export function mapHttpError(status, body) {
  const msg = extractMessage(body, `HTTP ${status}`);
  const opts = { status, retryable: RETRYABLE_STATUS.has(status), details: body?.error?.metadata };
  switch (status) {
    case 400:
    case 422:
      return new ProviderError('bad_request', msg, opts);
    case 401:
      return new ProviderError('auth_failed', msg, opts);
    case 402:
      return new ProviderError('insufficient_credits', msg, opts);
    case 403:
      return new ProviderError('forbidden', msg, opts);
    case 404:
      return new ProviderError('not_found', msg, opts);
    case 408:
      return new ProviderError('timeout', msg, opts);
    case 429:
      return new ProviderError('rate_limited', msg, opts);
    default:
      if (status >= 500) return new ProviderError('upstream_error', msg, opts);
      return new ProviderError('http_error', msg, opts);
  }
}

function parseRetryAfter(value) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Headers safe to show in the UI: credentials are masked. */
function displayHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, /^authorization$/i.test(k) ? 'Bearer ***' : v]),
  );
}

/**
 * POST/GET JSON with a hard timeout per attempt and bounded retries for transient failures only
 * (429, 408, 5xx, 529, network errors). Timeouts are not retried, so total latency stays bounded.
 */
export async function requestJson({
  url,
  method = 'POST',
  headers = {},
  body,
  timeoutMs,
  maxRetries = 0,
  retryBaseMs = 500,
  retryAfterCapMs = 5000,
  fetchImpl = (...args) => globalThis.fetch(...args),
  sleep = defaultSleep,
  trace,
}) {
  // Optional: records the request and every attempt's response so the UI can show how a decision was made.
  if (trace) {
    trace.request = { method, url, headers: displayHeaders(headers), body };
    trace.responses = [];
  }
  const record = (entry) => trace?.responses.push(entry);
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    let res;
    let text;
    try {
      res = await fetchImpl(url, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      text = await res.text();
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted || err?.name === 'AbortError') {
        record({ attempt: attempt + 1, status: null, durationMs: Date.now() - started, error: `No response within ${timeoutMs} ms` });
        throw new ProviderError('timeout', `Provider did not respond within ${timeoutMs} ms`, { retryable: true });
      }
      lastError = new ProviderError('network_error', redactSecrets(err?.message || 'Network error'), { retryable: true });
      record({ attempt: attempt + 1, status: null, durationMs: Date.now() - started, error: lastError.message });
      if (attempt < maxRetries) {
        await sleep(retryBaseMs * 2 ** attempt);
        continue;
      }
      throw lastError;
    }
    clearTimeout(timer);

    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    record({ attempt: attempt + 1, status: res.status, durationMs: Date.now() - started, body: json ?? redactSecrets(String(text || '').slice(0, 2000)) });

    if (!res.ok) {
      lastError = mapHttpError(res.status, json);
      if (lastError.retryable && attempt < maxRetries) {
        const ra = parseRetryAfter(res.headers?.get?.('retry-after'));
        const delay = Math.min(ra ?? retryBaseMs * 2 ** attempt, retryAfterCapMs);
        await sleep(delay);
        continue;
      }
      lastError.attempts = attempt + 1;
      throw lastError;
    }

    if (json === undefined) {
      throw new ProviderError('malformed_response', 'Provider returned a non-JSON or empty body', {
        status: res.status,
      });
    }
    return { json, status: res.status, attempts: attempt + 1 };
  }
  throw lastError;
}
