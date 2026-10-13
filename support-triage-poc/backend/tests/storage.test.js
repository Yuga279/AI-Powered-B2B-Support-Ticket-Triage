import { describe, expect, it, vi } from 'vitest';
import { makeDemoPng } from '../src/utils/png.js';

const store = new Map();
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (pathname, body, opts) => {
    store.set(pathname, { body: Buffer.from(body), opts });
    return { pathname, url: `https://x.private.blob.vercel-storage.com/${pathname}` };
  }),
  get: vi.fn(async (pathname) => {
    const hit = store.get(pathname);
    if (!hit) return null;
    return { statusCode: 200, stream: new Blob([hit.body]).stream(), blob: { contentType: hit.opts.contentType } };
  }),
  del: vi.fn(async (pathname) => store.delete(pathname)),
}));

const { createAttachmentService, createBlobStorage } = await import('../src/services/attachmentService.js');
const blob = await import('@vercel/blob');

describe('Vercel Blob screenshot storage', () => {
  it('stores screenshots as private blobs and reads them back for providers', async () => {
    const service = createAttachmentService({ config: {}, storage: createBlobStorage('blob-token') });
    expect(service.storageKind).toBe('vercel-blob');
    const png = makeDemoPng();
    const meta = await service.saveUpload({ buffer: png, mimetype: 'image/png', originalname: 'shot one.png' });

    expect(meta.storedName).toMatch(/^screenshots\/[0-9a-f-]{36}\.png$/);
    expect(meta.originalName).toBe('shot_one.png');
    expect(blob.put).toHaveBeenCalledWith(meta.storedName.replace(/^screenshots\//, 'screenshots/'), png, expect.objectContaining({ access: 'private', token: 'blob-token', contentType: 'image/png' }));

    const images = await service.loadImages([{ attachment_id: 'a1', mime_type: 'image/png', stored_name: meta.storedName }]);
    expect(images[0].dataUrl).toBe(`data:image/png;base64,${png.toString('base64')}`);

    await service.remove(meta.storedName);
    expect(await service.loadImages([{ attachment_id: 'a1', mime_type: 'image/png', stored_name: meta.storedName }])).toEqual([]);
  });

  it('rejects files whose bytes are not an allowed image before storing anything', async () => {
    const service = createAttachmentService({ config: {}, storage: createBlobStorage('blob-token') });
    blob.put.mockClear();
    await expect(service.saveUpload({ buffer: Buffer.from('nope'), mimetype: 'image/png', originalname: 'x.png' })).rejects.toMatchObject({
      code: 'invalid_file_signature',
    });
    expect(blob.put).not.toHaveBeenCalled();
  });
});
