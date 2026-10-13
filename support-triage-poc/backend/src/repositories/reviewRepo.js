const mapReview = (r) => ({
  reviewId: r.review_id,
  ticketId: r.ticket_id,
  decision: r.decision,
  team: r.team,
  severity: r.severity == null ? null : Number(r.severity),
  reviewer: r.reviewer,
  notes: r.notes,
  createdAt: r.created_at,
});

const INSERT = `
  INSERT INTO review_decisions (review_id, ticket_id, decision, team, severity, reviewer, notes, created_at)
  VALUES (@reviewId, @ticketId, @decision, @team, @severity, @reviewer, @notes, @createdAt)`;

export function createReviewRepo(db) {
  return {
    async insert(review) {
      await db.run(INSERT, { team: null, severity: null, notes: null, ...review });
      return mapReview(await db.get('SELECT * FROM review_decisions WHERE review_id = ?', [review.reviewId]));
    },
    async listForTicket(ticketId) {
      return (await db.all('SELECT * FROM review_decisions WHERE ticket_id = ? ORDER BY created_at DESC, rowid DESC', [ticketId])).map(mapReview);
    },
  };
}
