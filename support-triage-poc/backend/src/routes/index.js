import { Router } from 'express';
import { asyncHandler } from '../utils/errors.js';
import { validate } from '../middleware/validate.js';
import {
  compareBodySchema,
  listTicketsQuerySchema,
  reviewBodySchema,
  ticketIdParamSchema,
  triageBodySchema,
} from '../validators/ticketSchemas.js';

export function ticketRoutes({ controller, upload }) {
  const r = Router();
  r.post('/', upload, asyncHandler(controller.create));
  r.get('/', validate(listTicketsQuerySchema, 'query'), asyncHandler(controller.list));
  r.get('/:ticketId', validate(ticketIdParamSchema, 'params'), asyncHandler(controller.get));
  r.patch('/:ticketId/review', validate(ticketIdParamSchema, 'params'), validate(reviewBodySchema), asyncHandler(controller.review));
  return r;
}

export function triageRoutes({ controller }) {
  const r = Router();
  // /compare must be registered before /:ticketId.
  r.post('/compare', validate(compareBodySchema), asyncHandler(controller.compare));
  r.post('/:ticketId', validate(ticketIdParamSchema, 'params'), validate(triageBodySchema), asyncHandler(controller.triage));
  return r;
}

export function miscRoutes({ controller }) {
  const r = Router();
  r.get('/providers', asyncHandler(controller.providers));
  r.get('/dashboard/stats', asyncHandler(controller.stats));
  r.get('/escalations', asyncHandler(controller.escalations));
  return r;
}
