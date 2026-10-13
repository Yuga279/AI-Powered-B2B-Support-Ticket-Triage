import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { fmtMinutes } from '../services/format.js';
import { EnvironmentBadge, SeverityBadge, StatusBadge, TeamBadge } from '../components/Badges.jsx';
import { Empty, ErrorBanner, Loading } from '../components/Common.jsx';

const STATUSES = ['triaged', 'review_required', 'escalated', 'reviewed', 'new'];

export default function Tickets() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const { data, error, loading } = useApi(() => api.tickets({ status }), [status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Tickets</h1>
        <div className="flex gap-2">
          <select className="input w-44" value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <Link className="btn-primary" to="/tickets/new">
            New ticket
          </Link>
        </div>
      </div>
      <ErrorBanner error={error} />
      <div className="card overflow-x-auto">
        {loading && !data ? (
          <Loading />
        ) : !data?.tickets.length ? (
          <Empty>No tickets.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Team</th>
                <th>Severity</th>
                <th>Environment</th>
                <th>Status</th>
                <th>SLA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.tickets.map((t) => (
                <tr key={t.ticketId} className="hover:bg-slate-50">
                  <td className="max-w-md">
                    <Link className="block truncate font-medium text-indigo-600 hover:underline" to={`/tickets/${t.ticketId}`}>
                      {t.subject}
                    </Link>
                    <span className="text-xs text-slate-500">
                      {t.ticketId}
                    </span>
                  </td>
                  <td>{t.latest ? <TeamBadge team={t.latest.team} /> : '—'}</td>
                  <td>{t.latest ? <SeverityBadge severity={t.latest.severity} /> : '—'}</td>
                  <td>
                    <EnvironmentBadge environment={t.environment} />
                  </td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td className={t.minutesRemaining <= 5 ? 'font-medium text-red-600' : ''}>{fmtMinutes(t.minutesRemaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
