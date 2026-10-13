import { uuid } from '../utils/ids.js';

export function riskSnapshot(result, policyDecision) {
  return {
    resultStatus: result?.status ?? 'none',
    team: result?.team ?? 'unknown',
    severity: result?.severity ?? null,
    riskOutputType: result?.riskOutputType ?? null,
    riskLevel: result?.riskAssessment?.level ?? 'unknown',
    breachProbability: result?.breachProbability ?? null,
    calibrationStatus: result?.calibrationStatus ?? 'not_applicable',
    predicateScore: result?.predicateScore ?? null,
    predicateVerdict: result?.predicateVerdict ?? null,
    confidence: result?.confidence ?? null,
    minutesRemaining: policyDecision.minutesRemaining,
    thresholds: policyDecision.thresholds,
  };
}

/**
 * Records an escalation event for each triggered rule. No external notification (PagerDuty, Slack, email) is sent.
 * Must be called inside the caller's transaction.
 */
export function createEscalationService({ escalationRepo, logger }) {
  return {
    recordForDecision({ ticketId, runId, result, resultId, policyDecision, at }) {
      return policyDecision.triggeredRules.map(({ rule, reason }) => {
        const { escalation, alreadyRecorded } = escalationRepo.record({
          escalationId: uuid(),
          ticketId,
          rule,
          reason,
          runId,
          resultId,
          provider: result?.provider ?? 'none',
          model: result?.model ?? null,
          riskSnapshot: riskSnapshot(result, policyDecision),
          createdAt: at,
        });
        if (!alreadyRecorded) {
          logger?.info({ ticketId, rule, escalationId: escalation.escalationId }, 'escalation recorded (no notification sent)');
        }
        return { ...escalation, alreadyRecorded };
      });
    },
  };
}
