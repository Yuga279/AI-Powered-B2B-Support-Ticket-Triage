import { describe, expect, it } from 'vitest';
import { evaluateSlaPolicy, isProbabilityUsable, RULES } from '../src/policies/slaPolicy.js';
import { FIXED_NOW, ticketFor } from './helpers.js';

const policy = {
  breachProbabilityThreshold: 0.85,
  criticalSeverity: 5,
  urgentDeadlineMinutes: 5,
  trustVendorCalibration: false,
  lowConfidenceThreshold: 0.5,
};

const ok = (over = {}) => ({
  status: 'ok',
  team: 'infrastructure',
  severity: 3,
  riskOutputType: 'qualitative',
  breachProbability: null,
  calibrationStatus: 'not_applicable',
  predicateScore: null,
  predicateVerdict: null,
  confidence: 0.9,
  riskAssessment: { level: 'low', summary: '' },
  reviewReasons: [],
  ...over,
});
const prob = (p, calibrationStatus) => ok({ riskOutputType: 'probability', breachProbability: p, calibrationStatus });
const ticket = (minutes = 120) => ticketFor({ slaDeadlineAt: new Date(FIXED_NOW.getTime() + minutes * 60000).toISOString() });
const evalWith = (result, { minutes = 120, pol = policy } = {}) =>
  evaluateSlaPolicy({ ticket: ticket(minutes), result, policy: pol, now: FIXED_NOW });
const rules = (d) => d.triggeredRules.map((r) => r.rule);

describe('SLA policy: probability threshold', () => {
  it('escalates a calibrated probability above 0.85', () => {
    const d = evalWith(prob(0.86, 'calibrated'));
    expect(rules(d)).toEqual([RULES.PROBABILITY_THRESHOLD]);
    expect(d.escalate).toBe(true);
  });

  it('does not escalate at exactly the threshold or below', () => {
    expect(rules(evalWith(prob(0.85, 'calibrated')))).toEqual([]);
    expect(rules(evalWith(prob(0.5, 'calibrated')))).toEqual([]);
  });

  it('never escalates on vendor-claimed calibration unless trust is enabled', () => {
    const d = evalWith(prob(0.97, 'vendor_claimed'));
    expect(d.escalate).toBe(false);
    expect(d.humanReviewRequired).toBe(true);
    expect(d.reviewReasons.join(' ')).toMatch(/vendor_claimed/);

    const trusted = evalWith(prob(0.97, 'vendor_claimed'), { pol: { ...policy, trustVendorCalibration: true } });
    expect(rules(trusted)).toEqual([RULES.PROBABILITY_THRESHOLD]);
  });

  it('never interprets an uncalibrated/unknown score as a probability', () => {
    expect(evalWith(prob(0.99, 'unknown')).escalate).toBe(false);
    expect(isProbabilityUsable(prob(0.99, 'unknown'), { ...policy, trustVendorCalibration: true })).toBe(false);
  });

  it('never treats a predicate as a numeric probability', () => {
    const predicate = ok({ riskOutputType: 'predicate', predicateScore: 0.99, predicateVerdict: true, calibrationStatus: 'unknown' });
    const d = evalWith(predicate);
    expect(d.escalate).toBe(false);
    expect(isProbabilityUsable(predicate, { ...policy, trustVendorCalibration: true })).toBe(false);
    expect(d.humanReviewRequired).toBe(true);
    expect(d.reviewReasons.join(' ')).toMatch(/predicates are not probabilities/);
  });

  it('ignores a breachProbability that is attached to a non-probability output type', () => {
    expect(evalWith(ok({ riskOutputType: 'qualitative', breachProbability: 0.99, calibrationStatus: 'calibrated' })).escalate).toBe(false);
  });
});

describe('SLA policy: deadline and severity', () => {
  it('escalates when the deadline is within 5 minutes', () => {
    expect(rules(evalWith(ok(), { minutes: 5 }))).toEqual([RULES.DEADLINE_IMMINENT]);
    expect(rules(evalWith(ok(), { minutes: 6 }))).toEqual([]);
  });

  it('escalates an already-breached deadline', () => {
    const d = evalWith(ok(), { minutes: -10 });
    expect(rules(d)).toEqual([RULES.DEADLINE_IMMINENT]);
    expect(d.triggeredRules[0].reason).toMatch(/passed/);
  });

  it('applies the deadline rule even when no AI result is available', () => {
    const d = evalWith(null, { minutes: 2 });
    expect(rules(d)).toEqual([RULES.DEADLINE_IMMINENT]);
    expect(d.humanReviewRequired).toBe(true);
  });

  it('applies the deadline rule when the provider failed', () => {
    const failed = { status: 'failed', error: { message: 'timeout' }, reviewReasons: [] };
    const d = evalWith(failed, { minutes: 1 });
    expect(rules(d)).toEqual([RULES.DEADLINE_IMMINENT]);
    expect(d.reviewReasons[0]).toMatch(/failed/);
  });

  it('escalates critical severity from a valid result only', () => {
    expect(rules(evalWith(ok({ severity: 5 })))).toEqual([RULES.CRITICAL_SEVERITY]);
    expect(rules(evalWith(ok({ severity: 4 })))).toEqual([]);
    expect(rules(evalWith({ status: 'invalid', severity: 5, reviewReasons: [], error: { message: 'x' } }))).toEqual([]);
  });

  it('combines multiple rules', () => {
    const d = evalWith({ ...prob(0.9, 'calibrated'), severity: 5 }, { minutes: 3 });
    expect(rules(d).sort()).toEqual([RULES.CRITICAL_SEVERITY, RULES.DEADLINE_IMMINENT, RULES.PROBABILITY_THRESHOLD].sort());
  });
});

describe('SLA policy: human review', () => {
  it('requires review for unknown team and low confidence', () => {
    const d = evalWith(ok({ team: 'unknown', confidence: 0.3 }));
    expect(d.humanReviewRequired).toBe(true);
    expect(d.reviewReasons).toHaveLength(2);
  });

  it('flags high qualitative risk for review instead of escalating', () => {
    const d = evalWith(ok({ riskAssessment: { level: 'high', summary: '' } }));
    expect(d.escalate).toBe(false);
    expect(d.humanReviewRequired).toBe(true);
  });

  it('passes a clean result through without review', () => {
    const d = evalWith(ok());
    expect(d).toMatchObject({ escalate: false, humanReviewRequired: false, minutesRemaining: 120 });
  });

  it('carries provider review reasons through', () => {
    const d = evalWith(ok({ reviewReasons: ['Screenshot not analyzed'] }));
    expect(d.reviewReasons).toContain('Screenshot not analyzed');
  });
});
