import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { fmtDate, fmtMinutes } from '../services/format.js';
import { EnvironmentBadge, StatusBadge, TeamBadge } from '../components/Badges.jsx';
import { ErrorBanner, Loading } from '../components/Common.jsx';
import ResultCard from '../components/ResultCard.jsx';
import HistoryTimeline from '../components/HistoryTimeline.jsx';
import EscalationList from '../components/EscalationList.jsx';
import ReviewForm from '../components/ReviewForm.jsx';

export default function TicketDetail() {
  const { ticketId } = useParams();
  const location = useLocation();
  const { data, error, loading, reload } = useApi(() => api.ticket(ticketId), [ticketId]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(location.state?.triageError || null);

  async function retriage() {
    setBusy(true);
    setActionError(null);
    try {
      await api.triage(ticketId);
      await reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  const { ticket, latestResult, runs, escalations, reviews } = data;
  const lastReview = reviews[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-slate-900">
            {ticket.subject} <StatusBadge status={ticket.status} /> <EnvironmentBadge environment={ticket.environment} />
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {ticket.ticketId} · {ticket.affectedUsers.toLocaleString()} users ·{' '}
            <span className={ticket.minutesRemaining <= 5 ? 'font-medium text-red-600' : ''}>SLA {fmtMinutes(ticket.minutesRemaining)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={retriage} disabled={busy}>
            {busy ? 'Triaging…' : 'Re-triage'}
          </button>
          <Link className="btn-secondary" to={`/compare?ticket=${ticket.ticketId}`}>
            Compare providers
          </Link>
        </div>
      </div>
      <ErrorBanner error={actionError} />

      <section className="card p-4 text-sm">
          <p className="whitespace-pre-wrap text-slate-800">{ticket.description}</p>
          {ticket.logs && <pre className="mt-3 max-h-40 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{ticket.logs}</pre>}
          {ticket.attachments.length > 0 && <p className="mt-3 text-xs text-slate-500">Screenshot: {ticket.attachments[0].originalName}</p>}
      </section>

      {busy ? (
        <div className="card p-6 text-sm text-slate-600">Sending the ticket to OpenRouter and applying the SLA policy…</div>
      ) : latestResult ? (
        <ResultCard result={latestResult} title="Triage result" showTrace />
      ) : (
        <div className="card p-6 text-sm text-slate-500">Not triaged yet.</div>
      )}

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Escalations</h2>
          <span className="text-xs text-slate-500">Recorded only: no notifications are sent</span>
        </div>
        <EscalationList escalations={escalations} />
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Human review</h2>
          {lastReview && (
            <span className="flex items-center gap-2 text-xs text-slate-500">
              {lastReview.decision} by {lastReview.reviewer}
              {lastReview.team && <TeamBadge team={lastReview.team} />}
              {lastReview.severity && <span>Sev {lastReview.severity}</span>}· {fmtDate(lastReview.createdAt)}
            </span>
          )}
        </div>
        <ReviewForm ticketId={ticket.ticketId} onSaved={reload} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-800">History ({runs.length})</h2>
        <HistoryTimeline runs={runs} />
      </section>
    </div>
  );
}
