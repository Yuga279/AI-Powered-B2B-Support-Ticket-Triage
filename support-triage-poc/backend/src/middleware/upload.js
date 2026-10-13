import multer from 'multer';
import { ALLOWED_IMAGE_TYPES } from '../services/attachmentService.js';
import { AppError } from '../utils/errors.js';

/**
 * Accepts a single optional `screenshot` field, held in memory (works on serverless hosts) and then stored
 * by attachmentService. Declared MIME type is checked here; magic bytes are checked before storing.
 */
export function createUploadMiddleware(config) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 20, fieldSize: 100 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
        cb(new AppError(415, 'unsupported_media_type', 'Screenshot must be a PNG, JPEG or WebP image'));
      } else cb(null, true);
    },
  }).single('screenshot');
}
