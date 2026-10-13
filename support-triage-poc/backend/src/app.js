import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { createLogger } from './utils/logger.js';
import { createRepos } from './repositories/index.js';
import { asyncHandler } from './utils/errors.js';
import { createProviderRegistry } from './providers/registry.js';
import { createAttachmentService } from './services/attachmentService.js';
import { createEscalationService } from './services/escalationService.js';
import { createTriageService } from './services/triageService.js';
import { createTicketService } from './services/ticketService.js';
import { createDashboardService } from './services/dashboardService.js';
import { createProviderStatusService } from './services/providerStatusService.js';
import { createTicketsController } from './controllers/ticketsController.js';
import { createTriageController } from './controllers/triageController.js';
import { createMiscController } from './controllers/miscController.js';
import { miscRoutes, ticketRoutes, triageRoutes } from './routes/index.js';
import { createUploadMiddleware } from './middleware/upload.js';
import { createRequestLogger } from './middleware/requestLogger.js';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { openApiSpec } from './docs/openapi.js';

/**
 * Builds the Express app with explicit dependencies so tests can inject an in-memory DB,
 * a stubbed fetch and a fixed clock.
 */
export function createApp({ config, db, logger = createLogger(config), fetchImpl, sleep, clock, storage } = {}) {
  const repos = createRepos(db);
  const registry = createProviderRegistry(config, { fetchImpl, sleep });
  const attachmentService = createAttachmentService({ config, storage });
  const escalationService = createEscalationService({ logger });
  const triageService = createTriageService({ db, repos, registry, attachmentService, escalationService, config, logger, clock });
  const ticketService = createTicketService({ repos, attachmentService, triageService, logger, clock });
  const dashboardService = createDashboardService({ db });
  const providerStatusService = createProviderStatusService({ config, registry, fetchImpl });

  const app = express();
  app.disable('x-powered-by');
  app.use(createRequestLogger(logger));
  app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.jsonBodyLimit }));

  const misc = createMiscController({ providerStatusService, dashboardService, escalationRepo: repos.escalations, db, registry });
  app.get('/health', asyncHandler(misc.health));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: 'Support Triage POC API' }));
  app.get('/api-docs.json', (_req, res) => res.json(openApiSpec));

  app.use(
    '/api/tickets',
    ticketRoutes({ controller: createTicketsController({ ticketService }), upload: createUploadMiddleware(config) }),
  );
  app.use('/api/triage', triageRoutes({ controller: createTriageController({ triageService }) }));
  app.use('/api', miscRoutes({ controller: misc }));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  app.locals.services = { triageService, ticketService, registry, attachmentService };
  return app;
}
