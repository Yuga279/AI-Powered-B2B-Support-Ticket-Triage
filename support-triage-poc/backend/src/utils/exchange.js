const MAX_STORED_CHARS = 60_000;

/** Replaces inline image data URLs with a short placeholder so payloads stay readable and small. */
function shortenImages(value) {
  if (typeof value === 'string') {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(value);
    return m ? `data:${m[1]};base64,…(${value.length - m[0].length} base64 chars omitted)` : value;
  }
  if (Array.isArray(value)) return value.map(shortenImages);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shortenImages(v)]));
  }
  return value;
}

function capSize(value) {
  const text = JSON.stringify(value);
  return text.length > MAX_STORED_CHARS ? { truncated: true, preview: `${text.slice(0, MAX_STORED_CHARS)}…` } : value;
}

/**
 * Turns an httpClient trace into the request/response record shown in the UI.
 * The API key never appears (headers are masked in httpClient); images are shortened; size is capped.
 */
export function toExchange(trace) {
  if (!trace?.request) return null;
  return {
    request: capSize(shortenImages(trace.request)),
    responses: capSize(shortenImages(trace.responses || [])),
  };
}
