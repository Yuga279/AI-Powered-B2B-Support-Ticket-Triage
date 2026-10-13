import { useState } from 'react';
import { fmtMs, fmtNum, RULE_LABELS, TEAM_LABELS } from '../services/format.js';

function Json({ value }) {
  return (
    <pre className="max-h-96 overflow-auto rounded bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function RequestView({ request }) {
  return (
    <div className="space-y-2">
      <div className="font-mono text-xs">
        <span className="font-semibold text-indigo-700">{request.method}</span> {request.url}
      </div>
      <div className="text-xs text-slate-500">
        Headers: {Object.entries(request.headers || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}
      </div>
      <Json value={request.body} />
    </div>
  );
}

function ResponseView({ responses }) {
  return (
    <div className="space-y-3">
      {responses.map((r) => (
        <div key={r.attempt} className="space-y-1">
          <div className="text-xs font-medium text-slate-700">
            Attempt {r.attempt} ·{' '}
            <span className={r.status >= 200 && r.status < 300 ? 'text-emerald-700' : 'text-red-700'}>{r.status ? `HTTP ${r.status}` : 'no response'}</span> ·{' '}
            {fmtMs(r.durationMs)}
            {responses.length > 1 && r.attempt < responses.length && <span className="text-slate-500"> (retried)</span>}
          </div>
          {r.error ? <p className="text-xs text-red-700">{r.error}</p> : <Json value={r.body} />}
        </div>
      ))}
    </div>
  );
}

function PolicyView({ result, decision }) {
  const risk =
    result.riskOutputType === 'probability'
      ? `probability ${fmtNum(result.breachProbability)} (${result.calibrationStatus})`
      : result.riskOutputType === 'predicate'
        ? `predicate "will breach" = ${result.predicateVerdict} (score ${fmtNum(result.predicateScore)})`
        : result.riskOutputType === 'qualitative'
          ? `qualitative "${result.riskAssessment?.level}"`
          : 'none';
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded bg-slate-50 p-3 text-xs text-slate-700">
        <div className="mb-1 font-medium text-slate-800">Inputs from the model (after validation)</div>
        Team {TEAM_LABELS[result.team] || result.team} · Severity {result.severity ?? '—'} · Risk {risk} · {decision.minutesRemaining} min to SLA deadline
      </div>
      <div>
        <div className="mb-1 font-medium text-slate-800">Escalation rules</div>
        <ul className="space-y-1">
          {(decision.checks || []).map((c) => (
            <li key={c.rule} className="flex gap-2">
              <span className={c.fired ? 'font-bold text-red-600' : 'text-slate-400'}>{c.fired ? '✔' : '✖'}</span>
              <span>
                <span className="font-medium">{RULE_LABELS[c.rule] || c.rule}</span>
                <span className="text-slate-500">: {c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="mb-1 font-medium text-slate-800">Human review checks</div>
        {decision.reviewReasons.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-slate-600">
            {decision.reviewReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500">Nothing requires review.</p>
        )}
      </div>
      <div className="rounded border border-slate-200 p-2 text-xs">
        <span className="font-medium">Outcome:</span>{' '}
        {decision.escalate ? <span className="text-red-700">escalate</span> : 'no escalation'}
        {' · '}
        {decision.humanReviewRequired ? <span className="text-amber-700">human review required</span> : 'no review needed'}
      </div>
    </div>
  );
}

/** Shows the request sent to OpenRouter, the raw response(s), and how the SLA policy turned them into a decision. */
export default function DecisionTrace({ result }) {
  const ex = result.exchange;
  const decision = result.policyDecision;
  const tabs = [
    ex && ['request', '1. Request sent'],
    ex && ['response', `2. Response${ex.responses?.length > 1 ? `s (${ex.responses.length})` : ''}`],
    decision && ['policy', `${ex ? '3' : '1'}. SLA policy`],
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0]?.[0]);
  if (!tabs.length) return <p className="text-xs text-slate-500">No provider call was made for this result.</p>;

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'request' && ex && <RequestView request={ex.request} />}
      {tab === 'response' && ex && <ResponseView responses={ex.responses || []} />}
      {tab === 'policy' && decision && <PolicyView result={result} decision={decision} />}
    </div>
  );
}
