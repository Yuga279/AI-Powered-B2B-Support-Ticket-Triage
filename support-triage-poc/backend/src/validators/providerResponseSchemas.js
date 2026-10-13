import { z } from 'zod';
import { RISK_LEVELS, TEAMS } from './domain.js';

const prob = z.number().min(0).max(1);

// ---- OpenRouter Decisions (POST /api/alpha/decisions), per OpenRouter's Jev guide/tutorial ----
export const decisionChoiceAnswer = z
  .object({
    type: z.literal('choice'),
    choice: z.string(),
    confidence: prob.optional(),
    probabilities: z.record(z.number()).optional(),
  })
  .passthrough();

export const decisionScoreAnswer = z
  .object({
    type: z.literal('score'),
    score: z.number(),
    confidence: prob.optional(),
    probabilities: z.unknown().optional(),
    legend: z.unknown().optional(),
  })
  .passthrough();

export const decisionNoulAnswer = z.object({ type: z.literal('noul'), noul: prob }).passthrough();

export const decisionsResponseSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    answers: z.record(z.unknown()),
    usage: z
      .object({
        cost: z.number().optional(),
        input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// ---- OpenRouter chat completions ----
export const chatCompletionResponseSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            finish_reason: z.string().nullable().optional(),
            message: z.object({ content: z.string().nullable().optional() }).passthrough(),
          })
          .passthrough(),
      )
      .min(1),
    usage: z.object({ cost: z.number().optional() }).passthrough().optional(),
  })
  .passthrough();

/** The JSON object the general LLM is asked to return (validated after parsing message content). */
export const llmTriageOutputSchema = z.object({
  team: z.enum(TEAMS),
  severity: z.number().int().min(1).max(5),
  riskLevel: z.enum(RISK_LEVELS.filter((l) => l !== 'unknown')),
  needsHumanReview: z.boolean(),
  explanation: z.string().min(1).max(4000),
  screenshotFindings: z.string().max(2000).nullable(),
});

/** JSON Schema sent as response_format.json_schema.schema (strict mode: all keys required, no extras). */
export const llmTriageJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['team', 'severity', 'riskLevel', 'needsHumanReview', 'explanation', 'screenshotFindings'],
  properties: {
    team: { type: 'string', enum: TEAMS, description: 'Owning team; use unknown if unclear.' },
    severity: { type: 'integer', minimum: 1, maximum: 5, description: '1 = minimal, 5 = critical outage' },
    riskLevel: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'Qualitative SLA breach risk. This is a judgement, not a probability.',
    },
    needsHumanReview: { type: 'boolean', description: 'true if ambiguous, contradictory or missing information' },
    explanation: { type: 'string', description: 'Short justification (max 3 sentences).' },
    screenshotFindings: {
      type: ['string', 'null'],
      description: 'What the screenshot shows, or null if no screenshot was provided.',
    },
  },
};
