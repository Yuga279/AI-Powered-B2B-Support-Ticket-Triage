import pinoHttp from 'pino-http';
import { uuid } from '../utils/ids.js';

/** Structured access logs: method, path, status, duration. Bodies and auth headers are never logged. */
export function createRequestLogger(logger) {
  return pinoHttp({
    logger,
    genReqId: (req) => req.headers['x-request-id'] || uuid(),
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    autoLogging: { ignore: (req) => req.url === '/health' },
  });
}
