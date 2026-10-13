import { buildTicketState } from './prompts.js';
import { callDecisions, describeDecision, parseDecisionAnswers } from './openRouterDecisionsClient.js';

const levelFromProbability = (p) => (p >= 0.7 ? 'high' : p >= 0.4 ? 'medium' : 'low');

/**
 * TypeSafe Jev via OpenRouter Decisions. Text only.
 * Risk semantics: the sla_breach `noul` is a probability whose calibration is vendor-claimed
 * (TypeSafe: "trained … to return calibrated decisions"), not independently validated.
 */
export function createJevProvider({ config, fetchImpl, sleep }) {
  const or = config.openRouter;
  return {
    id: 'jev',
    label: 'TypeSafe Jev (via OpenRouter)',
    transport: 'openrouter_decisions',
    upstreamLabel: 'TypeSafe',
    riskSemantics: 'probability',
    isConfigured: () => !!(or.apiKey && or.jevModel),
    configIssue: () => (!or.apiKey ? 'OPENROUTER_API_KEY not set' : !or.jevModel ? 'OPENROUTER_JEV_MODEL not set' : null),
    supportsImages: () => false,
    modelFor: () => or.jevModel,

    async classify({ ticket, images = [], trace }) {
      const state = buildTicketState(ticket, { maxLogChars: config.maxLogCharsToProvider });
      const res = await callDecisions({ config, model: or.jevModel, state, fetchImpl, sleep, trace });
      const a = parseDecisionAnswers(res.answers);
      const p = a.slaBreachNoul;
      const reviewNotes = [];
      if (a.teamOutOfEnum) reviewNotes.push(`Model returned an unsupported team "${a.rawTeam}"`);
      if (images.length) reviewNotes.push('Screenshot not analyzed: Jev is a text-only model');
      return {
        model: res.model || or.jevModel,
        upstreamProvider: res.provider || 'TypeSafe',
        team: a.team,
        severity: a.severity,
        rawSeverity: a.rawSeverity,
        riskOutputType: 'probability',
        breachProbability: p,
        calibrationStatus: 'vendor_claimed',
        predicateScore: null,
        predicateVerdict: null,
        riskAssessment: {
          level: levelFromProbability(p),
          summary: `SLA breach probability ${p.toFixed(2)} (vendor-claimed calibration, not independently validated)`,
        },
        confidence: a.teamConfidence,
        aiReviewSignal: a.reviewNoul >= config.policy.reviewSignalThreshold,
        explanation: describeDecision('Jev', a, `sla_breach=${p.toFixed(2)} (probability, vendor-claimed)`),
        reviewNotes,
        costUsd: res.usage?.cost ?? null,
      };
    },
  };
}
