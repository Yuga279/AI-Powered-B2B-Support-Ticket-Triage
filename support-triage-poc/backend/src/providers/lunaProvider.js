import { buildTicketState } from './prompts.js';
import { callDecisions, describeDecision, parseDecisionAnswers } from './openRouterDecisionsClient.js';

/**
 * Builds the Decisions `state` with images. OpenRouter documents that Luna's state may contain images but
 * not the part format, so two candidate formats exist; `npm run probe:decisions` reports which one works.
 */
export function buildImageState(ticketState, images, mode) {
  const text = JSON.stringify(ticketState);
  if (mode === 'state_input_image') {
    return [{ type: 'input_text', text }, ...images.map((img) => ({ type: 'input_image', image_url: img.dataUrl }))];
  }
  return [{ type: 'text', text }, ...images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } }))];
}

/**
 * OpenAI GPT-6 Luna Decisions via OpenRouter Decisions.
 * Risk semantics: OpenAI defines this yes/no question type as a *predicate*. The returned 0-1 value is kept
 * as a predicate score with a boolean verdict and is never treated as a breach probability, because OpenAI
 * does not document its calibration.
 */
export function createLunaProvider({ config, fetchImpl, sleep }) {
  const or = config.openRouter;
  const imagesEnabled = () => or.lunaImageMode !== 'off';
  return {
    id: 'luna',
    label: 'OpenAI GPT-6 Luna Decisions (via OpenRouter)',
    transport: 'openrouter_decisions',
    upstreamLabel: 'OpenAI',
    riskSemantics: 'predicate',
    isConfigured: () => !!(or.apiKey && or.lunaModel),
    configIssue: () => (!or.apiKey ? 'OPENROUTER_API_KEY not set' : !or.lunaModel ? 'OPENROUTER_LUNA_MODEL not set' : null),
    supportsImages: imagesEnabled,
    modelFor: () => or.lunaModel,

    async classify({ ticket, images = [], trace }) {
      const ticketState = buildTicketState(ticket, { maxLogChars: config.maxLogCharsToProvider });
      const sendImages = images.length > 0 && imagesEnabled();
      const state = sendImages ? buildImageState(ticketState, images, or.lunaImageMode) : ticketState;
      const res = await callDecisions({
        config,
        model: or.lunaModel,
        state,
        timeoutMs: sendImages ? config.http.visionTimeoutMs : config.http.timeoutMs,
        fetchImpl,
        trace,
        sleep,
      });
      const a = parseDecisionAnswers(res.answers);
      const score = a.slaBreachNoul;
      const verdict = score >= config.lunaPredicateThreshold;
      const reviewNotes = [];
      if (a.teamOutOfEnum) reviewNotes.push(`Model returned an unsupported team "${a.rawTeam}"`);
      if (images.length && !sendImages) {
        reviewNotes.push('Screenshot not analyzed: Luna image input via OpenRouter is disabled (LUNA_IMAGE_MODE=off)');
      }
      return {
        model: res.model || or.lunaModel,
        upstreamProvider: res.provider || 'OpenAI',
        team: a.team,
        severity: a.severity,
        rawSeverity: a.rawSeverity,
        riskOutputType: 'predicate',
        breachProbability: null,
        calibrationStatus: 'unknown',
        predicateScore: score,
        predicateVerdict: verdict,
        riskAssessment: {
          level: verdict ? 'high' : 'low',
          summary: `Predicate "will breach SLA" = ${verdict} (score ${score.toFixed(2)} at decision threshold ${config.lunaPredicateThreshold}; not a probability)`,
        },
        confidence: a.teamConfidence,
        aiReviewSignal: a.reviewNoul >= config.policy.reviewSignalThreshold,
        explanation:
          describeDecision('Luna', a, `sla_breach predicate=${verdict} (score ${score.toFixed(2)}, not a probability)`) +
          (sendImages ? ' Screenshot was included in the decision state.' : ''),
        reviewNotes,
        costUsd: res.usage?.cost ?? null,
      };
    },
  };
}
