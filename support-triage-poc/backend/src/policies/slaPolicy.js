/**
 * SLA policy engine. Pure functions only: no I/O, no clock reads except the injected `now`.
 * Thresholds are demonstration values from config, not validated production values.
 */

export const RULES = {
  PROBABILITY_THRESHOLD: 'probability_threshold',
  DEADLINE_IMMINENT: 'deadline_imminent',
  CRITICAL_SEVERITY: 'critical_severity',
};

export function minutesUntilDeadline(ticket, now = new Date()) {
  return Math.floor((Date.parse(ticket.slaDeadlineAt) - now.getTime()) / 60000);
}

/**
 * A numeric breach probability may drive escalation only if it is a probability (not a predicate or
 * qualitative judgement) AND its calibration is trusted. Vendor-claimed calibration is trusted only when
 * explicitly enabled (SLA_TRUST_VENDOR_CALIBRATION=true).
 */
export function isProbabilityUsable(result, policy) {
  if (!result || result.status !== 'ok') return false;
  if (result.riskOutputType !== 'probability') return false;
  if (typeof result.breachProbability !== 'number') return false;
  if (result.calibrationStatus === 'calibrated') return true;
  if (result.calibrationStatus === 'vendor_claimed') return !!policy.trustVendorCalibration;
  return false;
}

/** One line per escalation rule, fired or not, so the UI can show how the decision was reached. */
function explainChecks({ result, valid, remaining, policy, triggeredRules }) {
  const fired = new Set(triggeredRules.map((t) => t.rule));
  let probabilityDetail;
  if (!valid) probabilityDetail = 'No valid AI result';
  else if (result.riskOutputType !== 'probability') {
    probabilityDetail = `Not applicable: the result is ${result.riskOutputType}, not a probability`;
  } else {
    const p = result.breachProbability.toFixed(2);
    probabilityDetail = isProbabilityUsable(result, policy)
      ? `P(breach) ${p} vs threshold > ${policy.breachProbabilityThreshold} (calibration ${result.calibrationStatus} is trusted)`
      : `P(breach) ${p} vs threshold > ${policy.breachProbabilityThreshold}; calibration "${result.calibrationStatus}" is not trusted, so this rule cannot fire`;
  }
  return [
    { rule: RULES.DEADLINE_IMMINENT, fired: fired.has(RULES.DEADLINE_IMMINENT), detail: `${remaining} min left vs threshold <= ${policy.urgentDeadlineMinutes} min` },
    {
      rule: RULES.CRITICAL_SEVERITY,
      fired: fired.has(RULES.CRITICAL_SEVERITY),
      detail: valid ? `Severity ${result.severity} vs critical level ${policy.criticalSeverity}` : 'No valid AI result',
    },
    { rule: RULES.PROBABILITY_THRESHOLD, fired: fired.has(RULES.PROBABILITY_THRESHOLD), detail: probabilityDetail },
  ];
}

/**
 * @param {object} args
 * @param {object} args.ticket  ticket with slaDeadlineAt
 * @param {object|null} args.result normalized provider result, or null when no provider produced one
 * @param {object} args.policy  thresholds from config.policy
 * @param {Date}   [args.now]
 */
export function evaluateSlaPolicy({ ticket, result, policy, now = new Date() }) {
  const triggeredRules = [];
  const reviewReasons = [];
  const remaining = minutesUntilDeadline(ticket, now);
  const valid = !!result && result.status === 'ok';

  // Rule 1: calibrated probability above threshold.
  if (valid && result.riskOutputType === 'probability' && typeof result.breachProbability === 'number') {
    const p = result.breachProbability;
    if (p > policy.breachProbabilityThreshold) {
      if (isProbabilityUsable(result, policy)) {
        triggeredRules.push({
          rule: RULES.PROBABILITY_THRESHOLD,
          reason: `Breach probability ${p.toFixed(2)} > ${policy.breachProbabilityThreshold} (calibration: ${result.calibrationStatus})`,
        });
      } else {
        reviewReasons.push(
          `Breach probability ${p.toFixed(2)} exceeds ${policy.breachProbabilityThreshold}, but calibration is "${result.calibrationStatus}" and not trusted for auto-escalation`,
        );
      }
    }
  }

  // Rule 2: the real deadline, independent of AI availability.
  if (remaining <= policy.urgentDeadlineMinutes) {
    triggeredRules.push({
      rule: RULES.DEADLINE_IMMINENT,
      reason:
        remaining < 0
          ? `SLA deadline passed ${-remaining} min ago`
          : `SLA deadline in ${remaining} min (<= ${policy.urgentDeadlineMinutes} min)`,
    });
  }

  // Rule 3: critical severity from a valid result only.
  if (valid && typeof result.severity === 'number' && result.severity >= policy.criticalSeverity) {
    triggeredRules.push({
      rule: RULES.CRITICAL_SEVERITY,
      reason: `Severity ${result.severity} >= critical level ${policy.criticalSeverity}`,
    });
  }

  // Rule 4: human review for missing, invalid, ambiguous or non-actionable risk outputs.
  if (!result) {
    reviewReasons.push('No AI classification available');
  } else if (!valid) {
    reviewReasons.push(`Provider result is ${result.status}${result.error ? `: ${result.error.message}` : ''}`);
  } else {
    if (result.team === 'unknown') reviewReasons.push('Owning team could not be determined');
    if (typeof result.confidence === 'number' && result.confidence < policy.lowConfidenceThreshold) {
      reviewReasons.push(`Low classification confidence (${result.confidence.toFixed(2)} < ${policy.lowConfidenceThreshold})`);
    }
    const escalating = triggeredRules.length > 0;
    if (result.riskOutputType === 'predicate' && result.predicateVerdict === true && !escalating) {
      reviewReasons.push('Predicate indicates likely SLA breach; predicates are not probabilities, so a human decides on escalation');
    }
    if (result.riskOutputType === 'qualitative' && result.riskAssessment?.level === 'high' && !escalating) {
      reviewReasons.push('Qualitative SLA risk is high; qualitative judgements do not auto-escalate');
    }
  }
  for (const r of result?.reviewReasons || []) if (!reviewReasons.includes(r)) reviewReasons.push(r);

  return {
    escalate: triggeredRules.length > 0,
    triggeredRules,
    checks: explainChecks({ result, valid, remaining, policy, triggeredRules }),
    humanReviewRequired: reviewReasons.length > 0,
    reviewReasons,
    minutesRemaining: remaining,
    evaluatedAt: now.toISOString(),
    thresholds: {
      breachProbabilityThreshold: policy.breachProbabilityThreshold,
      criticalSeverity: policy.criticalSeverity,
      urgentDeadlineMinutes: policy.urgentDeadlineMinutes,
      trustVendorCalibration: !!policy.trustVendorCalibration,
    },
  };
}
