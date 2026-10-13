const PATTERNS = [
  [/sk-or-v\d-[A-Za-z0-9]+/g, '[REDACTED_KEY]'],
  [/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|token|client[_-]?secret)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2[REDACTED]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]'],
];

/** Removes obvious secrets (API keys, bearer tokens, key=value credentials, JWTs) from free text. */
export function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return text;
  return PATTERNS.reduce((acc, [re, rep]) => acc.replace(re, rep), text);
}

export function truncate(text, max) {
  if (typeof text !== 'string') return text;
  return text.length > max ? `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]` : text;
}
