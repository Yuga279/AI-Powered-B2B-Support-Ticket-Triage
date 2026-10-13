import { performance } from 'node:perf_hooks';
import { ProviderError } from '../providers/httpClient.js';
import { evaluateSlaPolicy } from '../policies/slaPolicy.js';
import { failureResult, normalizeProviderOutput, statusForError } from './normalizer.js';
import { planAutoRoute } from './routingService.js';
import { notFound } from '../utils/errors.js';
import { uuid } from '../utils/ids.js';
import { toExchange } from '../utils/exchange.js';
import { createRepos } from '../repositories/index.js';

const NONE_PROVIDER = { id: 'none', label: 'No provider', transport: null };

function ticketStatusFor(decisions) {
  if (decisions.some((d) => d.escalate)) return 'escalated';
  if (decisions.some((d) => d.humanReviewRequired)) return 'review_required';
  return 'triaged';
}

export function createTriageService({ db, repos, registry, attachmentService, escalationService, config, logger, clock = () => new Date() }) {
  /** Runs one provider and returns a normalized result. Never throws. */
  async function executeProvider(provider, ticket, images) {
    const started = performance.now();
    const decidedAt = () => clock().toISOString();
    const trace = {};
    try {
      const out = await provider.classify({ ticket, images, trace });
      const durationMs = Math.round(performance.now() - started);
      const result = normalizeProviderOutput({ ticketId: ticket.ticketId, provider, out, durationMs, decidedAt: decidedAt() });
      result.exchange = toExchange(trace);
      logger?.info({ ticketId: ticket.ticketId, provider: provider.id, model: result.model, status: result.status, durationMs }, 'provider call');
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - started);
      const isProviderError = err instanceof ProviderError;
      const code = isProviderError ? err.code : 'internal_error';
      const error = {
        code,
        message: isProviderError ? err.message : 'Unexpected adapter error',
        retryable: isProviderError ? err.retryable : false,
      };
      if (!isProviderError) logger?.error({ err, provider: provider.id }, 'unexpected provider adapter error');
      else logger?.warn({ ticketId: ticket.ticketId, provider: provider.id, code, status: err.status, durationMs }, 'provider call failed');
      return {
        ...failureResult({
          ticketId: ticket.ticketId,
          provider,
          model: provider.modelFor?.(images.length > 0) ?? null,
          status: statusForError(code),
          error,
          durationMs,
          decidedAt: decidedAt(),
        }),
        exchange: toExchange(trace),
      };
    }
  }

  function unavailableResult(provider, ticket) {
    return failureResult({
      ticketId: ticket.ticketId,
      provider,
      status: 'unavailable',
      error: { code: 'not_configured', message: provider.configIssue() || 'Provider not configured', retryable: false },
      decidedAt: clock().toISOString(),
    });
  }

  /** Runs a provider if configured; otherwise returns an `unavailable` result (no network call). */
  function runOrUnavailable(id, ticket, images) {
    const provider = registry.get(id);
    return provider.isConfigured() ? executeProvider(provider, ticket, images) : Promise.resolve(unavailableResult(provider, ticket));
  }

  async function loadContext(ticketId) {
    const now = clock();
    const ticket = await repos.tickets.get(ticketId, now);
    if (!ticket) throw notFound(`Ticket ${ticketId}`);
    const images = ticket.hasImage ? await attachmentService.loadImages(await repos.tickets.getAttachmentRows(ticketId)) : [];
    return { ticket, images };
  }

  /** Persists a run with all its results and escalations in one transaction. */
  async function persistRun({ ticket, runId, routingTrace, entries }) {
    const at = clock().toISOString();
    const escalations = [];
    await db.transaction(async (tx) => {
      const txRepos = createRepos(tx);
      for (const e of entries) {
        e.result.resultId = uuid();
        await txRepos.triage.insertResult({ ...e.result, runId, role: e.role, policyDecision: e.policyDecision, createdAt: at });
        if (e.policyDecision) {
          escalations.push(
            ...(await escalationService.recordForDecision(txRepos.escalations, {
              ticketId: ticket.ticketId,
              runId,
              result: e.result.provider === 'none' ? null : e.result,
              resultId: e.result.resultId,
              policyDecision: e.policyDecision,
              at,
            })),
          );
        }
      }
      const decisions = entries.filter((e) => e.policyDecision).map((e) => e.policyDecision);
      const runStatus = entries.some((e) => e.policyDecision && e.result.status === 'ok') ? 'completed' : 'failed';
      await txRepos.triage.completeRun({
        runId,
        status: runStatus,
        routingTrace,
        policyDecision: decisions.length === 1 ? decisions[0] : decisions,
        completedAt: at,
      });
      await txRepos.tickets.setStatus(ticket.ticketId, ticketStatusFor(decisions), at);
    });
    return escalations;
  }

  function decide(ticket, result) {
    const usable = result.provider === 'none' ? null : result;
    const decision = evaluateSlaPolicy({ ticket, result: usable, policy: config.policy, now: clock() });
    result.humanReviewRequired = decision.humanReviewRequired;
    result.reviewReasons = decision.reviewReasons;
    return decision;
  }

  const traceOf = (r) => ({
    provider: r.provider,
    model: r.model,
    status: r.status,
    errorCode: r.error?.code ?? null,
    durationMs: r.durationMs,
  });

  return {
    /**
     * Auto mode (no provider) walks the routing chain until one provider succeeds.
     * Manual mode (provider given) runs exactly that provider.
     */
    async triageTicket(ticketId, { provider: providerId } = {}) {
      const { ticket, images } = await loadContext(ticketId);
      const runId = uuid();
      const mode = providerId ? 'manual' : 'auto';

      let chain;
      let notes = [];
      if (providerId) {
        chain = [providerId];
      } else {
        const plan = planAutoRoute({ hasImage: images.length > 0, registry, config });
        notes = plan.notes;
        chain = plan.chain;
      }
      await repos.triage.createRun({ runId, ticketId, mode, requestedProviders: chain, createdAt: clock().toISOString() });

      const attempts = [];
      for (const id of chain) {
        const r = await runOrUnavailable(id, ticket, images);
        attempts.push(r);
        if (r.status === 'ok') break;
      }

      let primary = attempts.find((r) => r.status === 'ok');
      if (!primary) {
        primary =
          attempts.length === 1
            ? attempts[0]
            : failureResult({
                ticketId,
                provider: NONE_PROVIDER,
                status: 'failed',
                error: attempts.length
                  ? {
                      code: 'all_providers_failed',
                      message: `All providers failed: ${attempts.map((a) => `${a.provider} (${a.error?.code})`).join(', ')}`,
                      retryable: attempts.some((a) => a.error?.retryable),
                    }
                  : { code: 'no_provider_configured', message: 'No AI provider is configured (set OPENROUTER_API_KEY)', retryable: false },
                decidedAt: clock().toISOString(),
              });
      }
      const policyDecision = decide(ticket, primary);
      const entries = attempts
        .filter((a) => a !== primary)
        .map((a) => ({ result: a, role: 'fallback_attempt', policyDecision: null }));
      entries.push({ result: primary, role: 'primary', policyDecision });

      const routingTrace = { notes, attempts: attempts.map(traceOf) };
      const escalations = await persistRun({ ticket, runId, routingTrace, entries });

      return {
        ticket: await repos.tickets.get(ticketId, clock()),
        run: await repos.triage.getRun(runId),
        result: { ...primary, policyDecision },
        attempts: attempts.map(traceOf),
        escalations,
      };
    },

    /** Sends the same ticket to each selected provider independently; partial failures are kept. */
    async compareProviders({ ticketId, providers }) {
      const { ticket, images } = await loadContext(ticketId);
      const runId = uuid();
      await repos.triage.createRun({ runId, ticketId, mode: 'compare', requestedProviders: providers, createdAt: clock().toISOString() });

      const settled = await Promise.allSettled(providers.map((id) => runOrUnavailable(id, ticket, images)));
      const results = settled.map((s, i) =>
        s.status === 'fulfilled'
          ? s.value
          : failureResult({
              ticketId,
              provider: registry.get(providers[i]),
              status: 'failed',
              error: { code: 'internal_error', message: 'Unexpected comparison error', retryable: false },
              decidedAt: clock().toISOString(),
            }),
      );
      const entries = results.map((r) => ({ result: r, role: 'comparison', policyDecision: decide(ticket, r) }));
      const escalations = await persistRun({
        ticket,
        runId,
        routingTrace: { notes: [], attempts: results.map(traceOf) },
        entries,
      });

      const ok = results.filter((r) => r.status === 'ok');
      return {
        ticket: await repos.tickets.get(ticketId, clock()),
        run: await repos.triage.getRun(runId),
        results: entries.map((e) => ({ ...e.result, policyDecision: e.policyDecision })),
        escalations,
        summary: {
          succeeded: ok.length,
          failed: results.length - ok.length,
          teamsAgree: ok.length > 1 ? new Set(ok.map((r) => r.team)).size === 1 : null,
          severityRange: ok.length ? [Math.min(...ok.map((r) => r.severity)), Math.max(...ok.map((r) => r.severity))] : null,
          riskOutputTypes: [...new Set(ok.map((r) => r.riskOutputType))],
        },
      };
    },
  };
}
