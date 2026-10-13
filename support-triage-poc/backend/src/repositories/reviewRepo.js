const mapReview = (r) => ({
  reviewId: r.review_id,
  ticketId: r.ticket_id,
  decision: r.decision,
  team: r.team,
  severity: r.severity,
  reviewer: r.reviewer,
  notes: r.notes,
  createdAt: r.created_at,
});

export function createReviewRepo(db) {
  const insert = db.prepare(`
    INSERT INTO review_decisions (review_id, ticket_id, decision, team, severity, reviewer, notes, created_at)
    VALUES (@reviewId, @ticketId, @decision, @team, @severity, @reviewer, @notes, @createdAt)`);
  return {
    insert(review) {
      insert.run({ team: null, severity: null, notes: null, ...review });
      return mapReview(db.prepare('SELECT * FROM review_decisions WHERE review_id = ?').get(review.reviewId));
    },
    listForTicket(ticketId) {
      return db
        .prepare('SELECT * FROM review_decisions WHERE ticket_id = ? ORDER BY created_at DESC, rowid DESC')
        .all(ticketId)
        .map(mapReview);
    },
  };
}
