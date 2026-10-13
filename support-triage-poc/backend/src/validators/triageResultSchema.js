import { z } from 'zod';
import { CALIBRATION_STATUSES, RESULT_STATUSES, RISK_LEVELS, RISK_OUTPUT_TYPES, TEAMS } from './domain.js';

const prob = z.number().min(0).max(1);

/**
 * The normalized triage contract every provider result is validated against before business rules run.
 * Semantic invariants:
 *  - breachProbability is only set for riskOutputType 'probability'.
 *  - a predicate keeps predicateScore/predicateVerdict and never gets a breachProbability.
 */
export const normalizedResultSchema = z
  .object({
    ticketId: z.string(),
    provider: z.string(),
    transport: z.string().nullable(),
    model: z.string().nullable(),
    upstreamProvider: z.string().nullable(),
    status: z.enum(RESULT_STATUSES),
    team: z.enum(TEAMS),
    severity: z.number().int().min(1).max(5).nullable(),
    rawSeverity: z.number().nullable(),
    riskAssessment: z.object({ level: z.enum(RISK_LEVELS), summary: z.string() }),
    breachProbability: prob.nullable(),
    riskOutputType: z.enum(RISK_OUTPUT_TYPES).nullable(),
    calibrationStatus: z.enum(CALIBRATION_STATUSES),
    predicateScore: prob.nullable(),
    predicateVerdict: z.boolean().nullable(),
    confidence: prob.nullable(),
    explanation: z.string(),
    humanReviewRequired: z.boolean(),
    reviewReasons: z.array(z.string()),
    error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).nullable(),
    durationMs: z.number().min(0),
    costUsd: z.number().min(0).nullable(),
    decidedAt: z.string(),
  })
  .superRefine((r, ctx) => {
    if (r.status === 'ok' && r.severity == null) {
      ctx.addIssue({ code: 'custom', path: ['severity'], message: 'ok results must have a severity' });
    }
    if (r.breachProbability != null && r.riskOutputType !== 'probability') {
      ctx.addIssue({
        code: 'custom',
        path: ['breachProbability'],
        message: 'breachProbability is only allowed for riskOutputType=probability',
      });
    }
    if (r.riskOutputType === 'predicate' && (r.predicateScore == null || r.predicateVerdict == null)) {
      ctx.addIssue({ code: 'custom', path: ['predicateScore'], message: 'predicate results need score and verdict' });
    }
    if (r.riskOutputType !== 'predicate' && (r.predicateScore != null || r.predicateVerdict != null)) {
      ctx.addIssue({ code: 'custom', path: ['predicateScore'], message: 'predicate fields only allowed for predicates' });
    }
  });
