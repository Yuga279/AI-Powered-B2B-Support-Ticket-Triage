import { TEAMS } from '../validators/domain.js';

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

const count = async (db, sql) => Number((await db.get(sql)).n);

export function createDashboardService({ db }) {
  return {
    async stats() {
      const totalTickets = await count(db, 'SELECT COUNT(*) AS n FROM tickets');
      const byStatus = Object.fromEntries(
        (await db.all('SELECT status, COUNT(*) AS n FROM tickets GROUP BY status')).map((r) => [r.status, Number(r.n)]),
      );

      // Latest primary/comparison result per ticket, preferring 'ok' results.
      const latest = await db.all(
        `WITH ranked AS (
           SELECT ticket_id, team, severity, status, ROW_NUMBER() OVER (
             PARTITION BY ticket_id ORDER BY CASE status WHEN 'ok' THEN 0 ELSE 1 END, created_at DESC, rowid DESC) AS rn
           FROM provider_results WHERE role IN ('primary','comparison'))
         SELECT team, severity FROM ranked WHERE rn = 1`,
      );
      const byTeam = Object.fromEntries(TEAMS.map((t) => [t, 0]));
      const severityDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const r of latest) {
        byTeam[r.team] = (byTeam[r.team] || 0) + 1;
        if (r.severity) severityDistribution[Number(r.severity)] += 1;
      }
      const untriaged = totalTickets - latest.length;

      const providerRows = await db.all(`SELECT provider, status, duration_ms, cost_usd FROM provider_results WHERE provider <> 'none'`);
      const providerMap = new Map();
      for (const r of providerRows) {
        if (!providerMap.has(r.provider)) {
          providerMap.set(r.provider, { provider: r.provider, calls: 0, success: 0, failure: 0, latencies: [], costUsd: 0 });
        }
        const p = providerMap.get(r.provider);
        p.calls += 1;
        if (r.status === 'ok') {
          p.success += 1;
          p.latencies.push(Number(r.duration_ms));
        } else if (r.status !== 'unavailable') p.failure += 1;
        p.costUsd += Number(r.cost_usd) || 0;
      }
      const providers = [...providerMap.values()].map(({ latencies, ...p }) => {
        const sorted = latencies.sort((a, b) => a - b);
        return {
          ...p,
          unavailable: p.calls - p.success - p.failure,
          avgLatencyMs: sorted.length ? Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length) : null,
          p95LatencyMs: percentile(sorted, 95),
          costUsd: Math.round(p.costUsd * 1e6) / 1e6,
        };
      });

      const withImage = await count(db, 'SELECT COUNT(DISTINCT ticket_id) AS n FROM attachments');
      const escalationCount = await count(db, 'SELECT COUNT(*) AS n FROM escalations');
      const escalationsByRule = Object.fromEntries(
        (await db.all('SELECT rule, COUNT(*) AS n FROM escalations GROUP BY rule')).map((r) => [r.rule, Number(r.n)]),
      );
      const totalRuns = await count(db, 'SELECT COUNT(*) AS n FROM triage_runs');

      return {
        totalTickets,
        untriaged,
        byStatus,
        awaitingReview: byStatus.review_required || 0,
        byTeam,
        severityDistribution,
        escalationCount,
        escalationsByRule,
        providers,
        totalRuns,
        ticketsByEvidence: { textOnly: totalTickets - withImage, withImage },
        generatedAt: new Date().toISOString(),
      };
    },
  };
}
