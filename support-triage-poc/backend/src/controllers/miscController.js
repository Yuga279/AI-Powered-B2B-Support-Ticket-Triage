export function createMiscController({ providerStatusService, dashboardService, escalationRepo, db, registry }) {
  return {
    async providers(req, res) {
      res.json(await providerStatusService.describe({ probe: req.query.probe === 'true' }));
    },
    stats(_req, res) {
      res.json(dashboardService.stats());
    },
    escalations(_req, res) {
      res.json({ escalations: escalationRepo.list(), note: 'Escalations are recorded only: no PagerDuty, Slack or email notifications are sent.' });
    },
    health(_req, res) {
      let dbOk = true;
      try {
        db.prepare('SELECT 1').get();
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
