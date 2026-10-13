import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { uuid } from '../utils/ids.js';

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

/** Local folder outside any public directory (development, tests). */
export function createDiskStorage(uploadDir) {
  const resolve = (name) => {
    const full = path.resolve(uploadDir, name);
    if (!full.startsWith(path.resolve(uploadDir) + path.sep)) throw new Error('Invalid stored attachment path');
    return full;
  };
  return {
    kind: 'disk',
    async save(name, buffer) {
      await fs.mkdir(uploadDir, { recursive: true });
      await fs.writeFile(resolve(name), buffer);
      return name;
    },
    read: (storedName) => fs.readFile(resolve(storedName)),
    remove: (storedName) => fs.rm(resolve(storedName), { force: true }),
  };
}

/** Private Vercel Blob store (production on Vercel). Needs BLOB_READ_WRITE_TOKEN. */
export function createBlobStorage(token) {
  const blob = () => import('@vercel/blob');
  return {
    kind: 'vercel-blob',
    async save(name, buffer, contentType) {
      const { put } = await blob();
      const res = await put(`screenshots/${name}`, buffer, { access: 'private', contentType, addRandomSuffix: false, token });
      return res.pathname;
    },
    async read(storedName) {
      const { get } = await blob();
      const res = await get(storedName, { access: 'private', token });
      if (!res || res.statusCode !== 200 || !res.stream) throw new Error('Screenshot not found in blob store');
      return Buffer.from(await new Response(res.stream).arrayBuffer());
    },
    async remove(storedName) {
      const { del } = await blob();
      await del(storedName, { token }).catch(() => {});
    },
  };
}

export function createAttachmentService({ config, storage }) {
  const store = storage ?? (config.blobToken ? createBlobStorage(config.blobToken) : createDiskStorage(config.uploadDir));

  return {
    storageKind: store.kind,
    /** Validates an in-memory upload, stores it, and returns attachment metadata. Throws on an invalid image. */
    async saveUpload(file) {
      const buffer = file.buffer;
      if (!verifyImageSignature(buffer, file.mimetype)) {
        const err = new Error('File content does not match an allowed image type (png, jpeg, webp)');
        err.status = 400;
        err.code = 'invalid_file_signature';
        throw err;
      }
      const storedName = await store.save(`${uuid()}${ALLOWED_IMAGE_TYPES[file.mimetype].ext}`, buffer, file.mimetype);
      return {
        originalName: sanitizeFilename(file.originalname),
        storedName,
        mimeType: file.mimetype,
        sizeBytes: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      };
    },
    remove: (storedName) => store.remove(storedName),
    /** Loads stored images as base64 data URLs for providers. Missing files are skipped. */
    async loadImages(attachmentRows) {
      const images = [];
      for (const a of attachmentRows) {
        if (!ALLOWED_IMAGE_TYPES[a.mime_type]) continue;
        try {
          const buf = await store.read(a.stored_name);
          images.push({
            attachmentId: a.attachment_id,
            mimeType: a.mime_type,
            dataUrl: `data:${a.mime_type};base64,${buf.toString('base64')}`,
          });
        } catch {
          // File no longer available: triage continues without it.
        }
      }
      return images;
    },
  };
}
