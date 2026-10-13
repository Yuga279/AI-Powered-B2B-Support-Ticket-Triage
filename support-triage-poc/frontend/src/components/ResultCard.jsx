import { fmtDate, fmtMs, fmtNum, fmtUsd, RULE_LABELS } from '../services/format.js';
import { ProviderName, SeverityBadge, StatusBadge, TeamBadge } from './Badges.jsx';
import DecisionTrace from './DecisionTrace.jsx';

/** SLA risk in one line. A predicate is never shown as a probability. */
export function RiskLine({ r }) {
  if (r.riskOutputType === 'probability') {
    return (
      <span>
        P(breach) <strong>{fmtNum(r.breachProbability)}</strong>{' '}
        <span className="text-xs text-slate-500">({r.calibrationStatus === 'calibrated' ? 'calibrated' : 'vendor-claimed calibration'})</span>
      </span>
    );
  }
  if (r.riskOutputType === 'predicate') {
    return (
      <span>
        Likely to breach: <strong>{r.predicateVerdict ? 'yes' : 'no'}</strong>{' '}
        <span className="text-xs text-slate-500">(predicate, not a probability)</span>
      </span>
    );
  }
  if (r.riskOutputType === 'qualitative') {
    return (
      <span>
        <strong className="capitalize">{r.riskAssessment?.level}</strong> <span className="text-xs text-slate-500">(qualitative)</span>
      </span>
    );
  }
  return <span className="text-slate-400">—</span>;
}

function Row({ label, children, highlight }) {
  return (
    <div className={`grid grid-cols-[7rem_1fr] gap-2 px-4 py-1.5 text-sm ${highlight ? 'bg-amber-50' : ''}`}>
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-800">{children}</dd>
    </div>
  );
}

/** One provider result. `diff` (optional) highlights fields that differ in a comparison. */
export default function ResultCard({ result: r, title, diff, showTrace = false }) {
  if (!r) return null;
  const decision = r.policyDecision;
  const failed = r.status !== 'ok';
  return (
    <div className={`card overflow-hidden ${failed ? 'border-red-200' : ''}`}>
      <div className="card-header">
        <div className="flex flex-wrap items-center gap-2">
          {title && <span className="card-title">{title}</span>}
          <ProviderName provider={r.provider} />
          {failed && <StatusBadge status={r.status} />}
        </div>
        <span className="text-xs text-slate-500">{fmtMs(r.durationMs)}</span>
      </div>
      <dl className="py-1">
        {failed ? (
          <Row label="Error">
            <span className="text-red-700">{r.error?.message || r.status}</span>
          </Row>
        ) : (
          <>
            <Row label="Team" highlight={diff?.has('team')}>
              <TeamBadge team={r.team} />
            </Row>
            <Row label="Severity" highlight={diff?.has('severity')}>
              <SeverityBadge severity={r.severity} />
            </Row>
            <Row label="SLA risk">
              <RiskLine r={r} />
            </Row>
          </>
        )}
        <Row label="Escalation">
          {decision?.escalate ? (
            <span className="font-medium text-red-700" title={decision.triggeredRules.map((t) => t.reason).join('\n')}>
              Yes: {decision.triggeredRules.map((t) => RULE_LABELS[t.rule] || t.rule).join(', ')}
            </span>
          ) : (
            <span className="text-slate-500">No</span>
          )}
        </Row>
        <Row label="Review">
          {r.humanReviewRequired ? (
            <span title={r.reviewReasons.join('\n')}>
              <span className="font-medium text-amber-700">Needed</span> <span className="text-xs text-slate-600">{r.reviewReasons[0]}</span>
            </span>
          ) : (
            <span className="text-slate-500">Not needed</span>
          )}
        </Row>
      </dl>
      {r.explanation && !failed && <p className="border-t border-slate-100 px-4 py-2 text-sm text-slate-600">{r.explanation}</p>}
      {(r.exchange || decision) && (
        <details className="border-t border-slate-100 px-4 py-2" open={showTrace}>
          <summary className="cursor-pointer select-none text-sm font-medium text-indigo-700">How this decision was made</summary>
          <div className="mt-3">
            <DecisionTrace result={r} />
          </div>
        </details>
      )}
      <details className="border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
        <summary className="cursor-pointer select-none text-slate-500">Details</summary>
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1">
          <dt className="text-slate-400">Model</dt>
          <dd className="break-all font-mono">{r.model || '—'}</dd>
          <dt className="text-slate-400">Calibration</dt>
          <dd>{r.calibrationStatus}</dd>
          {r.predicateScore != null && (
            <>
              <dt className="text-slate-400">Predicate score</dt>
              <dd>{fmtNum(r.predicateScore)}</dd>
            </>
          )}
          {r.rawSeverity != null && r.rawSeverity !== r.severity && (
            <>
              <dt className="text-slate-400">Raw severity score</dt>
              <dd>{fmtNum(r.rawSeverity)}</dd>
            </>
          )}
          <dt className="text-slate-400">Confidence</dt>
          <dd>{fmtNum(r.confidence)}</dd>
          <dt className="text-slate-400">Cost</dt>
          <dd>{fmtUsd(r.costUsd)}</dd>
          {r.error && (
            <>
              <dt className="text-slate-400">Error code</dt>
              <dd>{r.error.code}</dd>
            </>
          )}
          {r.reviewReasons.length > 1 && (
            <>
              <dt className="text-slate-400">Review reasons</dt>
              <dd>{r.reviewReasons.join('; ')}</dd>
            </>
          )}
          <dt className="text-slate-400">Decided</dt>
          <dd>{fmtDate(r.decidedAt)}</dd>
        </dl>
      </details>
    </div>
  );
}
