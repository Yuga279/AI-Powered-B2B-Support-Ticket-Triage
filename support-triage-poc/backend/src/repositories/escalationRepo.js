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

// Idempotency: UNIQUE(ticket_id, rule) + ON CONFLICT DO NOTHING; a repeat trigger is reported, not re-recorded.
const INSERT = `
  INSERT INTO escalations (escalation_id, ticket_id, rule, reason, run_id, result_id, provider, model,
    risk_snapshot, status, created_at)
  VALUES (@escalationId, @ticketId, @rule, @reason, @runId, @resultId, @provider, @model,
    @riskSnapshot, 'recorded', @createdAt)
  ON CONFLICT (ticket_id, rule) DO NOTHING`;

export function createEscalationRepo(db) {
  return {
    /** Returns { escalation, alreadyRecorded }. */
    async record(e) {
      const { changes } = await db.run(INSERT, { ...e, riskSnapshot: JSON.stringify(e.riskSnapshot) });
      const row = await db.get('SELECT * FROM escalations WHERE ticket_id = ? AND rule = ?', [e.ticketId, e.rule]);
      return { escalation: mapEscalation(row), alreadyRecorded: changes === 0 };
    },
    async listForTicket(ticketId) {
      return (await db.all('SELECT * FROM escalations WHERE ticket_id = ? ORDER BY created_at, rowid', [ticketId])).map(mapEscalation);
    },
    async list({ limit = 200 } = {}) {
      const rows = await db.all(
        `SELECT e.*, t.subject FROM escalations e JOIN tickets t ON t.ticket_id = e.ticket_id
         ORDER BY e.created_at DESC, e.rowid DESC LIMIT ?`,
        [limit],
      );
      return rows.map(mapEscalation);
    },
  };
}
