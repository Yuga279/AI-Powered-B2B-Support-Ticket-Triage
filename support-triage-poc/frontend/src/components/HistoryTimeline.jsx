import { useState } from 'react';
import { fmtDate } from '../services/format.js';
import { ProviderName, SeverityBadge, StatusBadge, TeamBadge } from './Badges.jsx';
import ComparisonGrid from './ComparisonGrid.jsx';
import ResultCard from './ResultCard.jsx';

function RunRow({ run }) {
  const [open, setOpen] = useState(false);
  const shown = run.results.filter((r) => r.role !== 'fallback_attempt');
  const attempts = run.results.filter((r) => r.role === 'fallback_attempt');
  const primary = shown[0];
  const isCompare = run.mode === 'compare';
  return (
    <li className="card overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-50">
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
        <span className="text-slate-700">{fmtDate(run.createdAt)}</span>
        {isCompare ? (
          <span className="text-slate-500">Comparison of {shown.length} providers</span>
        ) : (
          primary && (
            <>
              <ProviderName provider={primary.provider} />
              {primary.status === 'ok' ? (
                <>
                  <TeamBadge team={primary.team} />
                  <SeverityBadge severity={primary.severity} />
                </>
              ) : (
                <StatusBadge status={primary.status} />
              )}
            </>
          )
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/50 p-4">
          {isCompare ? (
            <ComparisonGrid results={shown} />
          ) : (
            [...attempts, ...shown].map((r) => (
              <ResultCard key={r.resultId} result={r} title={r.role === 'fallback_attempt' ? 'Failed attempt (fell back)' : 'Result'} />
            ))
          )}
        </div>
      )}
    </li>
  );
}

export default function HistoryTimeline({ runs }) {
  if (!runs?.length) return <p className="text-sm text-slate-500">No triage runs yet.</p>;
  return (
    <ol className="space-y-2">
      {runs.map((run) => (
        <RunRow key={run.runId} run={run} />
      ))}
    </ol>
  );
}
