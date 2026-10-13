import { loadConfigFromEnvFile } from './config/index.js';
import { bootstrap } from './bootstrap.js';

const config = loadConfigFromEnvFile();
const { app, db, logger } = await bootstrap(config);

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, `Support triage API listening on http://localhost:${config.port} (docs: /api-docs)`);
});

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
