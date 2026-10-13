import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';

const MULTER_STATUS = { LIMIT_FILE_SIZE: 413, LIMIT_FILE_COUNT: 400, LIMIT_UNEXPECTED_FILE: 400, LIMIT_FIELD_VALUE: 413 };

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: `Route ${req.method} ${req.path} not found` } });
}

/** Central error handler: consistent { error: { code, message, details? } } bodies, no stack traces. */
export function createErrorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    if (err instanceof multer.MulterError) {
      return res.status(MULTER_STATUS[err.code] || 400).json({
        error: { code: err.code.toLowerCase(), message: err.code === 'LIMIT_FILE_SIZE' ? 'Screenshot exceeds the upload size limit' : err.message },
      });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body too large' } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON body' } });
    }
    if (err instanceof AppError || (err?.status && err?.code && err.status < 500)) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    }
    logger?.error({ err, path: req.path }, 'unhandled error');
    return res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
  };
}
