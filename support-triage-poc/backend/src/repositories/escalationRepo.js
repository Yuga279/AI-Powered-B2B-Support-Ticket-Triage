const mapEscalation = (r) => ({
  escalationId: r.escalation_id,
  ticketId: r.ticket_id,
  rule: r.rule,
  reason: r.reason,
  runId: r.run_id,
  resultId: r.result_id,
  provider: r.provider,
  model: r.model,
  riskSnapshot: JSON.parse(r.risk_snapshot),
  status: r.status,
  createdAt: r.created_at,
  ...(r.subject !== undefined ? { subject: r.subject } : {}),
});

export function createEscalationRepo(db) {
  // Idempotency: UNIQUE(ticket_id, rule) + ON CONFLICT DO NOTHING; a repeat trigger is reported, not re-recorded.
  const insert = db.prepare(`
    INSERT INTO escalations (escalation_id, ticket_id, rule, reason, run_id, result_id, provider, model,
      risk_snapshot, status, created_at)
    VALUES (@escalationId, @ticketId, @rule, @reason, @runId, @resultId, @provider, @model,
      @riskSnapshot, 'recorded', @createdAt)
    ON CONFLICT (ticket_id, rule) DO NOTHING`);
  const byTicketRule = db.prepare('SELECT * FROM escalations WHERE ticket_id = ? AND rule = ?');

  return {
    /** Returns { escalation, alreadyRecorded }. */
    record(e) {
      const info = insert.run({
        ...e,
        riskSnapshot: JSON.stringify(e.riskSnapshot),
      });
      return {
        escalation: mapEscalation(byTicketRule.get(e.ticketId, e.rule)),
        alreadyRecorded: info.changes === 0,
      };
    },
    listForTicket(ticketId) {
      return db
        .prepare('SELECT * FROM escalations WHERE ticket_id = ? ORDER BY created_at, rowid')
        .all(ticketId)
        .map(mapEscalation);
    },
    list({ limit = 200 } = {}) {
      return db
        .prepare(
          `SELECT e.*, t.subject FROM escalations e JOIN tickets t ON t.ticket_id = e.ticket_id
           ORDER BY e.created_at DESC, e.rowid DESC LIMIT ?`,
        )
        .all(limit)
        .map(mapEscalation);
    },
  };
}
