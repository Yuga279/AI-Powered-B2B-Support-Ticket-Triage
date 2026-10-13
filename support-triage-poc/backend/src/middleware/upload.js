import fs from 'node:fs';
import multer from 'multer';
import { ALLOWED_IMAGE_TYPES } from '../services/attachmentService.js';
import { AppError } from '../utils/errors.js';
import { uuid } from '../utils/ids.js';

/**
 * Accepts a single optional `screenshot` field. Files are written outside any public directory with a
 * random name. Declared MIME type is checked here; magic bytes are checked by attachmentService.
 */
export function createUploadMiddleware(config) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadDir),
    filename: (_req, file, cb) => cb(null, `${uuid()}${ALLOWED_IMAGE_TYPES[file.mimetype]?.ext || '.bin'}`),
  });
  return multer({
    storage,
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 20, fieldSize: 100 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
        cb(new AppError(415, 'unsupported_media_type', 'Screenshot must be a PNG, JPEG or WebP image'));
      } else cb(null, true);
    },
  }).single('screenshot');
}
