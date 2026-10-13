const mapAttachment = (r) => ({
  attachmentId: r.attachment_id,
  originalName: r.original_name,
  mimeType: r.mime_type,
  sizeBytes: Number(r.size_bytes),
  sha256: r.sha256,
  createdAt: r.created_at,
});

const INSERT_TICKET = `
  INSERT INTO tickets (ticket_id, subject, description, logs, environment, affected_users,
    minutes_until_sla_deadline, sla_deadline_at, status, created_at, updated_at)
  VALUES (@ticketId, @subject, @description, @logs, @environment, @affectedUsers,
    @minutesUntilSlaDeadline, @slaDeadlineAt, 'new', @createdAt, @createdAt)`;
const INSERT_ATTACHMENT = `
  INSERT INTO attachments (attachment_id, ticket_id, original_name, stored_name, mime_type, size_bytes, sha256, created_at)
  VALUES (@attachmentId, @ticketId, @originalName, @storedName, @mimeType, @sizeBytes, @sha256, @createdAt)`;
const SELECT_ATTACHMENTS = 'SELECT * FROM attachments WHERE ticket_id = ? ORDER BY created_at';

export function createTicketRepo(db) {
  async function mapTicket(r, now = new Date()) {
    if (!r) return null;
    const attachments = await db.all(SELECT_ATTACHMENTS, [r.ticket_id]);
    return {
      ticketId: r.ticket_id,
      subject: r.subject,
      description: r.description,
      logs: r.logs,
      environment: r.environment,
      affectedUsers: Number(r.affected_users),
      minutesUntilSlaDeadline: Number(r.minutes_until_sla_deadline),
      slaDeadlineAt: r.sla_deadline_at,
      minutesRemaining: Math.floor((Date.parse(r.sla_deadline_at) - now.getTime()) / 60000),
      status: r.status,
      attachments: attachments.map(mapAttachment),
      hasImage: attachments.some((a) => a.mime_type.startsWith('image/')),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  return {
    /** Inserts the ticket and its attachment metadata atomically. */
    async create(ticket, attachments = []) {
      await db.transaction(async (tx) => {
        await tx.run(INSERT_TICKET, ticket);
        for (const a of attachments) await tx.run(INSERT_ATTACHMENT, { ...a, ticketId: ticket.ticketId });
      });
      return mapTicket(await db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticket.ticketId]));
    },
    async exists(ticketId) {
      return !!(await db.get('SELECT 1 AS present FROM tickets WHERE ticket_id = ?', [ticketId]));
    },
    async get(ticketId, now) {
      return mapTicket(await db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]), now);
    },
    getAttachmentRows(ticketId) {
      return db.all(SELECT_ATTACHMENTS, [ticketId]);
    },
    async list({ status, team, limit = 100, offset = 0 } = {}) {
      const where = [];
      const params = { limit, offset };
      if (status) {
        where.push('t.status = @status');
        params.status = status;
      }
      if (team) {
        where.push('lr.team = @team');
        params.team = team;
      }
      const rows = await db.all(
        `WITH latest AS (
           SELECT pr.*, ROW_NUMBER() OVER (PARTITION BY pr.ticket_id ORDER BY pr.created_at DESC,
             CASE pr.status WHEN 'ok' THEN 0 ELSE 1 END) AS rn
           FROM provider_results pr WHERE pr.role IN ('primary','comparison')
         )
         SELECT t.*, lr.team AS latest_team, lr.severity AS latest_severity, lr.provider AS latest_provider,
           lr.status AS latest_result_status,
           (SELECT COUNT(*) FROM attachments a WHERE a.ticket_id = t.ticket_id) AS attachment_count,
           (SELECT COUNT(*) FROM triage_runs r WHERE r.ticket_id = t.ticket_id) AS run_count,
           (SELECT COUNT(*) FROM escalations e WHERE e.ticket_id = t.ticket_id) AS escalation_count
         FROM tickets t
         LEFT JOIN latest lr ON lr.ticket_id = t.ticket_id AND lr.rn = 1
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY t.created_at DESC
         LIMIT @limit OFFSET @offset`,
        params,
      );
      const now = Date.now();
      return rows.map((r) => ({
        ticketId: r.ticket_id,
        subject: r.subject,
        environment: r.environment,
        affectedUsers: Number(r.affected_users),
        slaDeadlineAt: r.sla_deadline_at,
        minutesRemaining: Math.floor((Date.parse(r.sla_deadline_at) - now) / 60000),
        status: r.status,
        createdAt: r.created_at,
        hasImage: Number(r.attachment_count) > 0,
        runCount: Number(r.run_count),
        escalationCount: Number(r.escalation_count),
        latest: r.latest_team
          ? {
              team: r.latest_team,
              severity: r.latest_severity == null ? null : Number(r.latest_severity),
              provider: r.latest_provider,
              status: r.latest_result_status,
            }
          : null,
      }));
    },
    async setStatus(ticketId, status, at = new Date().toISOString()) {
      await db.run('UPDATE tickets SET status = ?, updated_at = ? WHERE ticket_id = ?', [status, at, ticketId]);
    },
  };
}
