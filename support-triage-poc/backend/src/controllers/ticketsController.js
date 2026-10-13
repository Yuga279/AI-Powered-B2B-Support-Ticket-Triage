import { createTicketSchema } from '../validators/ticketSchemas.js';

export function createTicketsController({ ticketService, attachmentService }) {
  return {
    async create(req, res) {
      const parsed = createTicketSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        attachmentService.discard(req.file);
        throw parsed.error;
      }
      const out = await ticketService.createTicket(parsed.data, req.file);
      res.status(201).json(out);
    },
    list(req, res) {
      res.json({ tickets: ticketService.list(req.validatedQuery) });
    },
    get(req, res) {
      res.json(ticketService.getDetail(req.params.ticketId));
    },
    review(req, res) {
      res.json(ticketService.review(req.params.ticketId, req.body));
    },
  };
}
