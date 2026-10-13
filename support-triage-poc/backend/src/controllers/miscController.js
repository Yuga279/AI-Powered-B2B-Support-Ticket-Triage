export function createMiscController({ providerStatusService, dashboardService, escalationRepo, db, registry }) {
  return {
    async providers(req, res) {
      res.json(await providerStatusService.describe({ probe: req.query.probe === 'true' }));
    },
    async stats(_req, res) {
      res.json(await dashboardService.stats());
    },
    async escalations(_req, res) {
      res.json({ escalations: await escalationRepo.list(), note: 'Escalations are recorded only: no PagerDuty, Slack or email notifications are sent.' });
    },
    async health(_req, res) {
      let dbOk = true;
      try {
        await db.get('SELECT 1 AS ok');
      } catch {
        dbOk = false;
      }
      res.status(dbOk ? 200 : 503).json({
        status: dbOk ? 'ok' : 'degraded',
        db: dbOk ? 'ok' : 'error',
        mode: registry.anyConfigured() ? 'live' : 'not_configured',
        time: new Date().toISOString(),
      });
    },
  };
}
