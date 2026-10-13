import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { fmtMs, TEAM_LABELS, TEAMS } from '../services/format.js';
import { ProviderName } from '../components/Badges.jsx';
import { BarList, Empty, ErrorBanner, Loading, StatTile } from '../components/Common.jsx';

export default function Dashboard() {
  const { data: s, error, loading } = useApi(() => api.stats(), []);
  if (loading && !s) return <Loading />;
  if (error) return <ErrorBanner error={error} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            AI decision models route each support ticket and rate its severity and SLA risk; simple rules decide what to escalate.{' '}
            <Link className="text-indigo-600 hover:underline" to="/how-it-works">
              How it works →
            </Link>
          </p>
        </div>
        <Link className="btn-primary" to="/tickets/new">
          New ticket
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link to="/tickets">
          <StatTile label="Tickets" value={s.totalTickets} hint={`${s.ticketsByEvidence.withImage} with screenshot`} />
        </Link>
        <Link to="/tickets?status=review_required">
          <StatTile label="Needs review" value={s.awaitingReview} tone={s.awaitingReview ? 'amber' : 'slate'} />
        </Link>
        <Link to="/tickets?status=escalated">
          <StatTile label="Escalated" value={s.escalationCount} tone={s.escalationCount ? 'red' : 'slate'} hint="no notifications sent" />
        </Link>
        <StatTile label="Triage runs" value={s.totalRuns} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">By team</h2>
          </div>
          <div className="p-4">
            <BarList items={TEAMS.map((t) => ({ label: TEAM_LABELS[t], value: s.byTeam[t] || 0 }))} />
          </div>
        </section>
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">By severity</h2>
          </div>
          <div className="p-4">
            <BarList items={[5, 4, 3, 2, 1].map((n) => ({ label: `Severity ${n}`, value: s.severityDistribution[n] || 0 }))} />
          </div>
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="card-header">
          <h2 className="card-title">Providers</h2>
        </div>
        {s.providers.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Provider</th>
                <th className="!text-right">Succeeded</th>
                <th className="!text-right">Failed</th>
                <th className="!text-right">Avg latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {s.providers.map((p) => (
                <tr key={p.provider}>
                  <td>
                    <ProviderName provider={p.provider} />
                  </td>
                  <td className="text-right tabular-nums">{p.success}</td>
                  <td className="text-right tabular-nums">{p.failure + p.unavailable}</td>
                  <td className="text-right tabular-nums">{fmtMs(p.avgLatencyMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No triage runs yet.</Empty>
        )}
      </section>
    </div>
  );
}
