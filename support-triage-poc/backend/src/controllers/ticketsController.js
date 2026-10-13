import { createTicketSchema } from '../validators/ticketSchemas.js';

export function createTicketsController({ ticketService }) {
  return {
    async create(req, res) {
      const input = createTicketSchema.parse(req.body ?? {});
      res.status(201).json(await ticketService.createTicket(input, req.file));
    },
    async list(req, res) {
      res.json({ tickets: await ticketService.list(req.validatedQuery) });
    },
    async get(req, res) {
      res.json(await ticketService.getDetail(req.params.ticketId));
    },
    async review(req, res) {
      res.json(await ticketService.review(req.params.ticketId, req.body));
    },
  };
}
