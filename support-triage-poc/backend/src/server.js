import { loadConfigFromEnvFile } from './config/index.js';
import { openDatabase } from './repositories/db.js';
import { createLogger } from './utils/logger.js';
import { createApp } from './app.js';

const config = loadConfigFromEnvFile();
const logger = createLogger(config);
const db = openDatabase(config.dbPath);
const app = createApp({ config, db, logger });
const registry = app.locals.services.registry;

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      mode: registry.anyConfigured() ? 'live' : 'not_configured',
      openRouterKey: config.openRouter.apiKey ? 'configured' : 'missing',
      providers: registry.describe().map((p) => `${p.id}:${p.configured ? 'configured' : 'unavailable'}`),
      dbPath: config.dbPath,
    },
    `Support triage API listening on http://localhost:${config.port} (docs: /api-docs)`,
  );
});

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
