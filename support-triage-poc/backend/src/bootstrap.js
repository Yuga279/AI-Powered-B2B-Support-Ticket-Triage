import { openDatabase } from './repositories/db.js';
import { createLogger } from './utils/logger.js';
import { createApp } from './app.js';

/** Opens storage (local SQLite/folder, or Turso/Vercel Blob) and builds the Express app. Shared by server.js and the Vercel function. */
export async function bootstrap(config) {
  const logger = createLogger(config);
  const db = await openDatabase(config);
  const app = createApp({ config, db, logger });
  const { registry, attachmentService } = app.locals.services;
  const storage = {
    database: db.driver === 'libsql' ? 'turso' : `sqlite:${config.dbPath}`,
    uploads: attachmentService.storageKind,
  };
  if (config.onVercel && (!config.tursoUrl || !config.blobToken)) {
    logger.warn(storage, 'Running on Vercel without TURSO_DATABASE_URL and/or BLOB_READ_WRITE_TOKEN: data is kept in /tmp and will be lost');
  }
  logger.info(
    {
      ...storage,
      mode: registry.anyConfigured() ? 'live' : 'not_configured',
      openRouterKey: config.openRouter.apiKey ? 'configured' : 'missing',
      providers: registry.describe().map((p) => `${p.id}:${p.configured ? 'configured' : 'unavailable'}`),
    },
    'support triage API initialised',
  );
  return { app, db, logger };
}
