const json = (v) => JSON.stringify(v ?? null);
const parse = (v, fallback = null) => {
  if (v == null) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};
const boolOrNull = (v) => (v == null ? null : !!v);

export function mapResultRow(r) {
  return {
    resultId: r.result_id,
    runId: r.run_id,
    ticketId: r.ticket_id,
    role: r.role,
    provider: r.provider,
    transport: r.transport,
    model: r.model,
    upstreamProvider: r.upstream_provider,
    status: r.status,
    team: r.team,
    severity: r.severity,
    rawSeverity: r.raw_severity,
    riskAssessment: { level: r.risk_level, summary: r.risk_summary },
    breachProbability: r.breach_probability,
    riskOutputType: r.risk_output_type,
    calibrationStatus: r.calibration_status,
    predicateScore: r.predicate_score,
    predicateVerdict: boolOrNull(r.predicate_verdict),
    confidence: r.confidence,
    explanation: r.explanation,
    humanReviewRequired: !!r.human_review_required,
    reviewReasons: parse(r.review_reasons, []),
    policyDecision: parse(r.policy_decision),
    error: r.error_code
      ? { code: r.error_code, message: r.error_message, retryable: !!r.error_retryable }
      : null,
    durationMs: r.duration_ms,
    costUsd: r.cost_usd,
    exchange: r.request_payload ? { request: parse(r.request_payload), responses: parse(r.response_payload, []) } : null,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
}

function mapRunRow(r) {
  return {
    runId: r.run_id,
    ticketId: r.ticket_id,
    mode: r.mode,
    requestedProviders: parse(r.requested_providers, []),
    routingTrace: parse(r.routing_trace, []),
    status: r.status,
    policyDecision: parse(r.policy_decision),
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

export function createTriageRepo(db) {
  const INSERT_RUN = `
    INSERT INTO triage_runs (run_id, ticket_id, mode, requested_providers, status, created_at)
    VALUES (@runId, @ticketId, @mode, @requestedProviders, 'running', @createdAt)`;
  const COMPLETE_RUN = `
    UPDATE triage_runs SET status = @status, routing_trace = @routingTrace, policy_decision = @policyDecision,
      completed_at = @completedAt WHERE run_id = @runId`;
  const INSERT_RESULT = `
    INSERT INTO provider_results (result_id, run_id, ticket_id, role, provider, transport, model, upstream_provider,
      status, team, severity, raw_severity, risk_level, risk_summary, breach_probability, risk_output_type,
      calibration_status, predicate_score, predicate_verdict, confidence, explanation, human_review_required,
      review_reasons, policy_decision, error_code, error_message, error_retryable, duration_ms, cost_usd,
      request_payload, response_payload, decided_at, created_at)
    VALUES (@resultId, @runId, @ticketId, @role, @provider, @transport, @model, @upstreamProvider,
      @status, @team, @severity, @rawSeverity, @riskLevel, @riskSummary, @breachProbability, @riskOutputType,
      @calibrationStatus, @predicateScore, @predicateVerdict, @confidence, @explanation, @humanReviewRequired,
      @reviewReasons, @policyDecision, @errorCode, @errorMessage, @errorRetryable, @durationMs, @costUsd,
      @requestPayload, @responsePayload, @decidedAt, @createdAt)`;

  return {
    async createRun({ runId, ticketId, mode, requestedProviders, createdAt }) {
      await db.run(INSERT_RUN, { runId, ticketId, mode, requestedProviders: json(requestedProviders || []), createdAt });
    },
    async completeRun({ runId, status, routingTrace, policyDecision, completedAt }) {
      await db.run(COMPLETE_RUN, {
        runId,
        status,
        routingTrace: json(routingTrace || []),
        policyDecision: json(policyDecision),
        completedAt,
      });
    },
    async insertResult(r) {
      await db.run(INSERT_RESULT, {
        resultId: r.resultId,
        runId: r.runId,
        ticketId: r.ticketId,
        role: r.role,
        provider: r.provider,
        transport: r.transport ?? null,
        model: r.model ?? null,
        upstreamProvider: r.upstreamProvider ?? null,
        status: r.status,
        team: r.team,
        severity: r.severity ?? null,
        rawSeverity: r.rawSeverity ?? null,
        riskLevel: r.riskAssessment?.level ?? null,
        riskSummary: r.riskAssessment?.summary ?? null,
        breachProbability: r.breachProbability ?? null,
        riskOutputType: r.riskOutputType ?? null,
        calibrationStatus: r.calibrationStatus ?? null,
        predicateScore: r.predicateScore ?? null,
        predicateVerdict: r.predicateVerdict == null ? null : r.predicateVerdict ? 1 : 0,
        confidence: r.confidence ?? null,
        explanation: r.explanation ?? null,
        humanReviewRequired: r.humanReviewRequired ? 1 : 0,
        reviewReasons: json(r.reviewReasons || []),
        policyDecision: json(r.policyDecision),
        errorCode: r.error?.code ?? null,
        errorMessage: r.error?.message ?? null,
        errorRetryable: r.error ? (r.error.retryable ? 1 : 0) : null,
        durationMs: Math.round(r.durationMs ?? 0),
        costUsd: r.costUsd ?? null,
        requestPayload: r.exchange ? json(r.exchange.request) : null,
        responsePayload: r.exchange ? json(r.exchange.responses) : null,
        decidedAt: r.decidedAt,
        createdAt: r.createdAt,
      });
    },
    async getRun(runId) {
      const r = await db.get('SELECT * FROM triage_runs WHERE run_id = ?', [runId]);
      return r ? mapRunRow(r) : null;
    },
    async listRunsForTicket(ticketId) {
      const runs = (await db.all('SELECT * FROM triage_runs WHERE ticket_id = ? ORDER BY created_at DESC, rowid DESC', [ticketId])).map(mapRunRow);
      const results = (await db.all('SELECT * FROM provider_results WHERE ticket_id = ? ORDER BY created_at, rowid', [ticketId])).map(mapResultRow);
      const byRun = new Map(runs.map((r) => [r.runId, { ...r, results: [] }]));
      for (const res of results) byRun.get(res.runId)?.results.push(res);
      return [...byRun.values()];
    },
    async resultsForRun(runId) {
      return (await db.all('SELECT * FROM provider_results WHERE run_id = ? ORDER BY rowid', [runId])).map(mapResultRow);
    },
  };
}
