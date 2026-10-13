import { describe, expect, it } from 'vitest';
import { compareBodySchema, createTicketSchema, reviewBodySchema } from '../src/validators/ticketSchemas.js';
import { verifyImageSignature } from '../src/services/attachmentService.js';
import { makeDemoPng } from '../src/utils/png.js';
import { redactSecrets } from '../src/utils/redact.js';
import { SAMPLE_TICKETS } from './fixtures/sampleTickets.js';

const valid = {
  subject: 'Login broken',
  description: 'Users cannot log in via SSO since this morning.',
  affectedUsers: 10,
  minutesUntilSlaDeadline: 60,
};

describe('ticket validation', () => {
  it('accepts every synthetic fixture', () => {
    for (const s of SAMPLE_TICKETS) expect(createTicketSchema.safeParse(s.ticket).success, s.key).toBe(true);
  });

  it('applies defaults and coerces multipart string numbers', () => {
    const r = createTicketSchema.parse({ ...valid, affectedUsers: '25', minutesUntilSlaDeadline: '15' });
    expect(r).toMatchObject({ affectedUsers: 25, minutesUntilSlaDeadline: 15, environment: 'production', logs: '', triageMode: 'none' });
  });

  it.each([
    ['subject', 'ab'],
    ['description', 'short'],
    ['affectedUsers', -1],
    ['affectedUsers', 1.5],
    ['minutesUntilSlaDeadline', 'soon'],
    ['environment', 'qa'],
    ['ticketId', 'bad id!'],
  ])('rejects invalid %s=%j', (field, value) => {
    expect(createTicketSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(createTicketSchema.safeParse({ ...valid, priority: 'p1' }).success).toBe(false);
  });

  it('parses provider lists from multipart strings and requires them for manual mode', () => {
    expect(createTicketSchema.parse({ ...valid, triageMode: 'manual', providers: 'jev,luna' }).providers).toEqual(['jev', 'luna']);
    expect(createTicketSchema.safeParse({ ...valid, triageMode: 'manual' }).success).toBe(false);
    expect(createTicketSchema.safeParse({ ...valid, triageMode: 'manual', providers: 'gpt' }).success).toBe(false);
  });

  it('requires two or more unique providers for comparison', () => {
    expect(compareBodySchema.safeParse({ ticketId: 'TCK-1', providers: ['jev'] }).success).toBe(false);
    expect(compareBodySchema.safeParse({ ticketId: 'TCK-1', providers: ['jev', 'jev'] }).success).toBe(false);
    expect(compareBodySchema.safeParse({ ticketId: 'TCK-1', providers: ['jev', 'luna'] }).success).toBe(true);
  });

  it('validates review overrides', () => {
    expect(reviewBodySchema.safeParse({ decision: 'overridden', reviewer: 'sam' }).success).toBe(false);
    expect(reviewBodySchema.safeParse({ decision: 'overridden', reviewer: 'sam', team: 'billing' }).success).toBe(true);
    expect(reviewBodySchema.safeParse({ decision: 'confirmed', reviewer: 'sam', severity: 6 }).success).toBe(false);
  });
});

describe('upload signature checks', () => {
  it('accepts real PNG bytes and rejects spoofed content', () => {
    const png = makeDemoPng();
    expect(verifyImageSignature(png, 'image/png')).toBe(true);
    expect(verifyImageSignature(png, 'image/jpeg')).toBe(false);
    expect(verifyImageSignature(Buffer.from('<script>alert(1)</script>'), 'image/png')).toBe(false);
    expect(verifyImageSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBe(true);
    expect(verifyImageSignature(png, 'image/gif')).toBe(false);
  });
});

describe('secret redaction', () => {
  it('removes keys, bearer tokens and key=value secrets', () => {
    const out = redactSecrets('api_key=sk-test-1234567890abcdefXYZ Authorization: Bearer abc.def.ghi password: hunter2 sk-or-v1-abcdef123');
    expect(out).not.toMatch(/sk-test-1234567890/);
    expect(out).not.toMatch(/hunter2/);
    expect(out).not.toMatch(/abc\.def\.ghi/);
    expect(out).not.toMatch(/sk-or-v1-abcdef123/);
  });
});
