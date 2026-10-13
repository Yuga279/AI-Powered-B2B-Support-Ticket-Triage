import { createTicketRepo } from './ticketRepo.js';
import { createTriageRepo } from './triageRepo.js';
import { createEscalationRepo } from './escalationRepo.js';
import { createReviewRepo } from './reviewRepo.js';

/** All repositories bound to one connection or transaction (`db` may be a transaction handle). */
export function createRepos(db) {
  return {
    tickets: createTicketRepo(db),
    triage: createTriageRepo(db),
    escalations: createEscalationRepo(db),
    reviews: createReviewRepo(db),
  };
}
