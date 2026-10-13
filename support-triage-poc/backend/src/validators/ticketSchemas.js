import { z } from 'zod';
import { ENVIRONMENTS, PROVIDER_IDS, TEAMS } from './domain.js';

const csvArray = (inner) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      const s = v.trim();
      if (s.startsWith('[')) {
        try {
          return JSON.parse(s);
        } catch {
          return s;
        }
      }
      return s.split(',').map((x) => x.trim()).filter(Boolean);
    }
    return v;
  }, inner);

export const providerIdSchema = z.enum(PROVIDER_IDS);

/** Accepts JSON bodies and multipart string fields (numbers are coerced). */
export const createTicketSchema = z
  .object({
    ticketId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{3,64}$/, 'ticketId may contain letters, digits, _ and - (3-64 chars)')
      .optional(),
    subject: z.string().trim().min(3).max(200),
    description: z.string().trim().min(10).max(10_000),
    logs: z.string().max(50_000).optional().default(''),
    environment: z.enum(ENVIRONMENTS).default('production'),
    affectedUsers: z.coerce.number().int().min(0).max(10_000_000),
    minutesUntilSlaDeadline: z.coerce.number().int().min(-525_600).max(525_600),
    triageMode: z.enum(['none', 'auto', 'manual']).default('none'),
    providers: csvArray(z.array(providerIdSchema).max(4)).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.triageMode === 'manual' && (!v.providers || v.providers.length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['providers'], message: 'manual triage requires at least one provider' });
    }
  });

export const ticketIdParamSchema = z.object({
  ticketId: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/),
});

export const listTicketsQuerySchema = z.object({
  status: z.enum(['new', 'triaged', 'review_required', 'escalated', 'reviewed']).optional(),
  team: z.enum(TEAMS).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const triageBodySchema = z
  .object({
    provider: providerIdSchema.optional(),
  })
  .strict()
  .default({});

export const compareBodySchema = z
  .object({
    ticketId: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/),
    providers: z
      .array(providerIdSchema)
      .min(2, 'select at least two providers to compare')
      .max(4)
      .refine((a) => new Set(a).size === a.length, 'providers must be unique'),
  })
  .strict();

export const reviewBodySchema = z
  .object({
    decision: z.enum(['confirmed', 'overridden', 'dismissed']),
    team: z.enum(TEAMS).optional(),
    severity: z.number().int().min(1).max(5).optional(),
    reviewer: z.string().trim().min(1).max(100),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === 'overridden' && !v.team && !v.severity) {
      ctx.addIssue({ code: 'custom', path: ['team'], message: 'an override must set team and/or severity' });
    }
  });
