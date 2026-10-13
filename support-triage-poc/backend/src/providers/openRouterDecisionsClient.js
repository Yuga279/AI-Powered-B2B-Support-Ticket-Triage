import { ProviderError, requestJson } from './httpClient.js';
import { openRouterHeaders, requireKey, throwIfBodyError } from './openRouterCommon.js';
import { SEVERITY_LEVELS, TEAM_DESCRIPTIONS } from './prompts.js';
import {
  decisionChoiceAnswer,
  decisionNoulAnswer,
  decisionScoreAnswer,
  decisionsResponseSchema,
} from '../validators/providerResponseSchemas.js';
import { TEAMS } from '../validators/domain.js';

/**
 * Shared question set sent to both Jev and Luna through OpenRouter's Decisions endpoint.
 * Shapes follow OpenRouter's documented DecisionsRequest: questions is a keyed map of
 * { type: 'choice'|'score'|'noul', instructions, criteria }.
 */
export const DECISION_QUESTIONS = {
  team: {
    type: 'choice',
    instructions: 'Which support team should own this B2B support ticket?',
    criteria: { ...TEAM_DESCRIPTIONS },
  },
  severity: {
    type: 'score',
    instructions: 'How severe is this ticket for the customer, considering environment, affected users and impact?',
    criteria: [...SEVERITY_LEVELS],
  },
  sla_breach: {
    type: 'noul',
    instructions:
      'Given minutes_until_sla_deadline, the severity and the impact, will this ticket breach its SLA unless it is escalated now?',
    criteria: {
      true: 'The ticket is likely to breach its SLA without immediate escalation.',
      false: 'The ticket can be resolved within its SLA through the normal queue.',
    },
  },
  needs_human_review: {
    type: 'noul',
    instructions:
      'Is this ticket ambiguous, contradictory, or missing information needed to route it to a team confidently?',
    criteria: {
      true: 'A human should review the routing before acting.',
      false: 'The ticket is clear enough to route automatically.',
    },
  },
};

/** Builds the Decisions request body. `state` is a JSON object, or an array of parts when images are sent. */
export function buildDecisionsRequest({ model, state, user }) {
  return { model, state, questions: DECISION_QUESTIONS, ...(user ? { user } : {}) };
}

export async function callDecisions({ config, model, state, timeoutMs, fetchImpl, sleep, trace }) {
  requireKey(config.openRouter);
  const { json } = await requestJson({
    url: config.openRouter.decisionsUrl,
    method: 'POST',
    headers: openRouterHeaders(config.openRouter),
    body: buildDecisionsRequest({ model, state }),
    timeoutMs: timeoutMs ?? config.http.timeoutMs,
    maxRetries: config.http.maxRetries,
    retryBaseMs: config.http.retryBaseMs,
    retryAfterCapMs: config.http.retryAfterCapMs,
    fetchImpl,
    trace,
    sleep,
  });
  throwIfBodyError(json);
  const parsed = decisionsResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderError('malformed_response', 'Decisions response did not match the documented schema', {
      details: parsed.error.issues.slice(0, 5),
    });
  }
  return parsed.data;
}

function parseAnswer(answers, key, schema) {
  const raw = answers[key];
  if (raw && typeof raw === 'object' && raw.type === 'refusal') {
    throw new ProviderError('malformed_response', `Model refused to answer "${key}"`);
  }
  const p = schema.safeParse(raw);
  if (!p.success) {
    throw new ProviderError('malformed_response', `Answer "${key}" is missing or has an unexpected shape`, {
      details: p.error.issues.slice(0, 3),
    });
  }
  return p.data;
}

/**
 * Maps a score answer to severity 1-5. Decision scores are probability-weighted and may fall between
 * levels, so the raw value is kept and the integer severity is rounded and clamped. If a legend with
 * numeric keys is returned, its lowest key is treated as level 1.
 */
export function mapScoreToSeverity(score, legend) {
  let minLevel = 1;
  if (legend && typeof legend === 'object' && !Array.isArray(legend)) {
    const keys = Object.keys(legend).map(Number).filter(Number.isFinite);
    if (keys.length) minLevel = Math.min(...keys);
  }
  return Math.min(5, Math.max(1, Math.round(score - minLevel + 1)));
}

export function mapTeam(choice) {
  return TEAMS.includes(choice) ? { team: choice, outOfEnum: false } : { team: 'unknown', outOfEnum: true };
}

/** Validates the four expected answers and returns the shared, semantics-neutral parts. */
export function parseDecisionAnswers(answers) {
  const team = parseAnswer(answers, 'team', decisionChoiceAnswer);
  const severity = parseAnswer(answers, 'severity', decisionScoreAnswer);
  const slaBreach = parseAnswer(answers, 'sla_breach', decisionNoulAnswer);
  const review = parseAnswer(answers, 'needs_human_review', decisionNoulAnswer);
  const mappedTeam = mapTeam(team.choice);
  return {
    team: mappedTeam.team,
    rawTeam: team.choice,
    teamOutOfEnum: mappedTeam.outOfEnum,
    teamConfidence: team.confidence ?? null,
    teamProbability: team.probabilities?.[team.choice] ?? null,
    severity: mapScoreToSeverity(severity.score, severity.legend),
    rawSeverity: severity.score,
    severityConfidence: severity.confidence ?? null,
    slaBreachNoul: slaBreach.noul,
    reviewNoul: review.noul,
  };
}

const fmt = (n, d = 2) => (n == null ? 'n/a' : Number(n).toFixed(d));

export function describeDecision(label, a, riskText) {
  return (
    `${label} chose team "${a.rawTeam}"` +
    `${a.teamOutOfEnum ? ' (not an allowed team, mapped to unknown)' : ''}` +
    ` (p=${fmt(a.teamProbability)}, confidence ${fmt(a.teamConfidence)}); ` +
    `severity score ${fmt(a.rawSeverity)} → ${a.severity}; ${riskText}; ` +
    `needs_human_review=${fmt(a.reviewNoul)}.`
  );
}
