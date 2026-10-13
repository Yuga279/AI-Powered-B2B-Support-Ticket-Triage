import { normalizedResultSchema } from '../validators/triageResultSchema.js';

const STATUS_FOR_CODE = {
  malformed_response: 'invalid',
  invalid_result: 'invalid',
  not_configured: 'unavailable',
};

export function statusForError(code) {
  return STATUS_FOR_CODE[code] || 'failed';
}

/** A result for a provider that produced no usable classification. Always requires human review. */
export function failureResult({ ticketId, provider, model = null, status, error, durationMs = 0, decidedAt }) {
  return {
    ticketId,
    provider: provider.id,
    transport: provider.transport ?? null,
    model,
    upstreamProvider: null,
    status,
    team: 'unknown',
    severity: null,
    rawSeverity: null,
    riskAssessment: { level: 'unknown', summary: `No risk assessment (provider ${status})` },
    breachProbability: null,
    riskOutputType: null,
    calibrationStatus: 'not_applicable',
    predicateScore: null,
    predicateVerdict: null,
    confidence: null,
    explanation: `${provider.label || provider.id} ${status}: ${error.message}`,
    humanReviewRequired: true,
    reviewReasons: [],
    error,
    durationMs,
    costUsd: null,
    decidedAt,
  };
}

/**
 * Converts a provider's raw output into the normalized contract and validates it. Any contract violation
 * produces an `invalid` result instead of reaching the business rules.
 */
export function normalizeProviderOutput({ ticketId, provider, out, durationMs, decidedAt }) {
  const reviewReasons = [...(out.reviewNotes || [])];
  if (out.aiReviewSignal) reviewReasons.push('Model flagged the ticket as ambiguous or missing information');
  const candidate = {
    ticketId,
    provider: provider.id,
    transport: provider.transport ?? null,
    model: out.model ?? provider.modelFor?.(false) ?? null,
    upstreamProvider: out.upstreamProvider ?? null,
    status: 'ok',
    team: out.team,
    severity: out.severity,
    rawSeverity: out.rawSeverity ?? out.severity ?? null,
    riskAssessment: out.riskAssessment,
    breachProbability: out.breachProbability ?? null,
    riskOutputType: out.riskOutputType,
    calibrationStatus: out.calibrationStatus,
    predicateScore: out.predicateScore ?? null,
    predicateVerdict: out.predicateVerdict ?? null,
    confidence: out.confidence ?? null,
    explanation: out.explanation ?? '',
    humanReviewRequired: reviewReasons.length > 0,
    reviewReasons,
    error: null,
    durationMs,
    costUsd: out.costUsd ?? null,
    decidedAt,
  };
  const parsed = normalizedResultSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  return failureResult({
    ticketId,
    provider,
    model: candidate.model,
    status: 'invalid',
    error: { code: 'invalid_result', message: `Output failed contract validation (${issues})`.slice(0, 500), retryable: false },
    durationMs,
    decidedAt,
  });
}
