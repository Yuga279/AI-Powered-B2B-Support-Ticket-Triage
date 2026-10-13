import { TEAMS } from '../validators/domain.js';

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function createDashboardService({ db }) {
  return {
    stats() {
      const totalTickets = db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n;
      const byStatus = Object.fromEntries(
        db.prepare('SELECT status, COUNT(*) AS n FROM tickets GROUP BY status').all().map((r) => [r.status, r.n]),
      );

      // Latest primary/comparison result per ticket, preferring 'ok' results.
      const latest = db
        .prepare(
          `WITH ranked AS (
             SELECT ticket_id, team, severity, status, ROW_NUMBER() OVER (
               PARTITION BY ticket_id ORDER BY CASE status WHEN 'ok' THEN 0 ELSE 1 END, created_at DESC, rowid DESC) AS rn
             FROM provider_results WHERE role IN ('primary','comparison'))
           SELECT team, severity FROM ranked WHERE rn = 1`,
        )
        .all();
      const byTeam = Object.fromEntries(TEAMS.map((t) => [t, 0]));
      const severityDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const r of latest) {
        byTeam[r.team] = (byTeam[r.team] || 0) + 1;
        if (r.severity) severityDistribution[r.severity] += 1;
      }
      const untriaged = totalTickets - latest.length;

      const providerRows = db
        .prepare(
          `SELECT provider, status, duration_ms, cost_usd FROM provider_results WHERE provider <> 'none'`,
        )
        .all();
      const providerMap = new Map();
      for (const r of providerRows) {
        const key = r.provider;
        if (!providerMap.has(key)) {
          providerMap.set(key, { provider: r.provider, calls: 0, success: 0, failure: 0, latencies: [], costUsd: 0 });
        }
        const p = providerMap.get(key);
        p.calls += 1;
        if (r.status === 'ok') {
          p.success += 1;
          p.latencies.push(r.duration_ms);
        } else if (r.status !== 'unavailable') p.failure += 1;
        p.costUsd += r.cost_usd || 0;
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

      const withImage = db.prepare('SELECT COUNT(DISTINCT ticket_id) AS n FROM attachments').get().n;
      const escalationCount = db.prepare('SELECT COUNT(*) AS n FROM escalations').get().n;
      const escalationsByRule = Object.fromEntries(
        db.prepare('SELECT rule, COUNT(*) AS n FROM escalations GROUP BY rule').all().map((r) => [r.rule, r.n]),
      );
      const totalRuns = db.prepare('SELECT COUNT(*) AS n FROM triage_runs').get().n;

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
