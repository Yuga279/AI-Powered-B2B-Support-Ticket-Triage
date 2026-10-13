import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ALLOWED_IMAGE_TYPES = {
  'image/png': { ext: '.png', check: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: '.jpg', check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': {
    ext: '.webp',
    check: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
};

/** Verifies that file content matches the declared image type (magic bytes). */
export function verifyImageSignature(buffer, mimeType) {
  const spec = ALLOWED_IMAGE_TYPES[mimeType];
  return !!spec && spec.check(buffer);
}

export function sanitizeFilename(name) {
  return String(name || 'upload')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 120);
}

export function createAttachmentService({ config }) {
  const resolveStored = (storedName) => {
    const full = path.resolve(config.uploadDir, storedName);
    if (!full.startsWith(path.resolve(config.uploadDir) + path.sep)) throw new Error('Invalid stored attachment path');
    return full;
  };

  return {
    /** Validates a multer upload already on disk. Returns attachment metadata or throws; deletes the file on failure. */
    inspectUpload(file) {
      const buffer = fs.readFileSync(file.path);
      if (!verifyImageSignature(buffer, file.mimetype)) {
        fs.rmSync(file.path, { force: true });
        const err = new Error('File content does not match an allowed image type (png, jpeg, webp)');
        err.status = 400;
        err.code = 'invalid_file_signature';
        throw err;
      }
      return {
        originalName: sanitizeFilename(file.originalname),
        storedName: path.basename(file.path),
        mimeType: file.mimetype,
        sizeBytes: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      };
    },
    discard(file) {
      if (file?.path) fs.rmSync(file.path, { force: true });
    },
    /** Loads stored images as base64 data URLs for providers. Missing files are skipped. */
    loadImages(attachmentRows) {
      const images = [];
      for (const a of attachmentRows) {
        if (!ALLOWED_IMAGE_TYPES[a.mime_type]) continue;
        try {
          const buf = fs.readFileSync(resolveStored(a.stored_name));
          images.push({
            attachmentId: a.attachment_id,
            mimeType: a.mime_type,
            dataUrl: `data:${a.mime_type};base64,${buf.toString('base64')}`,
          });
        } catch {
          // File removed from disk: triage continues without it.
        }
      }
      return images;
    },
  };
}
