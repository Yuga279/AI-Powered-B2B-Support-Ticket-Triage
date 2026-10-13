import { conflict, notFound } from '../utils/errors.js';
import { newTicketId, uuid } from '../utils/ids.js';

export function createTicketService({ repos, attachmentService, triageService, logger, clock = () => new Date() }) {
  return {
    /**
     * Persists the ticket (and screenshot metadata) first, then optionally triages it.
     * A triage failure never loses the ticket: the ticket is returned with a triageError.
     */
    async createTicket(input, file) {
      const now = clock();
      let attachment = null;
      let created = false;
      try {
        if (file) attachment = attachmentService.inspectUpload(file);
        const ticketId = input.ticketId || newTicketId();
        if (repos.tickets.exists(ticketId)) throw conflict(`Ticket ${ticketId} already exists`);
        const createdAt = now.toISOString();
        repos.tickets.create(
          {
            ticketId,
            subject: input.subject,
            description: input.description,
            logs: input.logs || '',
            environment: input.environment,
            affectedUsers: input.affectedUsers,
            minutesUntilSlaDeadline: input.minutesUntilSlaDeadline,
            slaDeadlineAt: new Date(now.getTime() + input.minutesUntilSlaDeadline * 60000).toISOString(),
            createdAt,
          },
          attachment ? [{ ...attachment, attachmentId: uuid(), createdAt }] : [],
        );
        created = true;
        logger?.info({ ticketId, hasAttachment: !!attachment, descriptionChars: input.description.length }, 'ticket created');

        let triage = null;
        let triageError = null;
        if (input.triageMode !== 'none') {
          try {
            const providers = input.providers || [];
            if (input.triageMode === 'manual' && providers.length >= 2) {
              triage = await triageService.compareProviders({ ticketId, providers });
            } else if (input.triageMode === 'manual') {
              triage = await triageService.triageTicket(ticketId, { provider: providers[0] });
            } else {
              triage = await triageService.triageTicket(ticketId);
            }
          } catch (err) {
            logger?.error({ err, ticketId }, 'triage after create failed; ticket preserved');
            triageError = { code: 'triage_failed', message: 'Ticket saved, but triage failed. Retry with POST /api/triage/:ticketId.' };
          }
        }
        return { ticket: repos.tickets.get(ticketId, clock()), triage, triageError };
      } catch (err) {
        if (file && !created) attachmentService.discard(file);
        throw err;
      }
    },

    getDetail(ticketId) {
      const ticket = repos.tickets.get(ticketId, clock());
      if (!ticket) throw notFound(`Ticket ${ticketId}`);
      const runs = repos.triage.listRunsForTicket(ticketId);
      // Runs are newest first. Prefer the latest auto/manual result; fall back to a comparison result.
      const all = runs.flatMap((r) => r.results);
      const latestResult =
        all.find((x) => x.role === 'primary') ||
        all.find((x) => x.role === 'comparison' && x.status === 'ok') ||
        all.find((x) => x.role === 'comparison') ||
        null;
      return {
        ticket,
        latestResult,
        runs,
        escalations: repos.escalations.listForTicket(ticketId),
        reviews: repos.reviews.listForTicket(ticketId),
      };
    },

    list(query) {
      return repos.tickets.list(query);
    },

    review(ticketId, body) {
      if (!repos.tickets.exists(ticketId)) throw notFound(`Ticket ${ticketId}`);
      const at = clock().toISOString();
      const review = repos.reviews.insert({ reviewId: uuid(), ticketId, ...body, createdAt: at });
      repos.tickets.setStatus(ticketId, 'reviewed', at);
      return { review, ticket: repos.tickets.get(ticketId, clock()) };
    },
  };
}
