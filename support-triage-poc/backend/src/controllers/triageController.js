export function createTriageController({ triageService }) {
  return {
    async triage(req, res) {
      const { provider } = req.body || {};
      res.json(await triageService.triageTicket(req.params.ticketId, { provider }));
    },
    async compare(req, res) {
      res.json(await triageService.compareProviders(req.body));
    },
  };
}
