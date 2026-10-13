import pino from 'pino';
import { redactSecrets } from './redact.js';

export function createLogger({ logLevel = 'info', nodeEnv = 'development' } = {}) {
  return pino({
    level: nodeEnv === 'test' ? 'silent' : logLevel,
    base: { service: 'support-triage-backend' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.apiKey',
        '*.authorization',
        'headers.authorization',
      ],
      censor: '[REDACTED]',
    },
    hooks: {
      // Last line of defence: scrub secret-looking substrings from string log messages.
      logMethod(args, method) {
        method.apply(
          this,
          args.map((a) => (typeof a === 'string' ? redactSecrets(a) : a)),
        );
      },
    },
  });
}
