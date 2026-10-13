import { PROVIDER_LABELS, TEAM_LABELS } from '../services/format.js';

// Only four things are shown as badges: status, severity, team and environment.
const base = 'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset';
const TONES = {
  slate: 'bg-slate-50 text-slate-700 ring-slate-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-300',
  red: 'bg-red-50 text-red-700 ring-red-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
};

function Badge({ tone = 'slate', children }) {
  return <span className={`${base} ${TONES[tone]}`}>{children}</span>;
}

export function TeamBadge({ team }) {
  const tone = { billing: 'sky', infrastructure: 'violet', auth_identity: 'indigo', frontend: 'green', unknown: 'amber' }[team] || 'slate';
  return <Badge tone={tone}>{TEAM_LABELS[team] || team}</Badge>;
}

export function SeverityBadge({ severity }) {
  if (severity == null) return <span className="text-slate-400">—</span>;
  const tone = severity >= 5 ? 'red' : severity >= 4 ? 'amber' : 'slate';
  return <Badge tone={tone}>Sev {severity}</Badge>;
}

export function StatusBadge({ status }) {
  const tone = {
    ok: 'green',
    triaged: 'green',
    reviewed: 'sky',
    review_required: 'amber',
    escalated: 'red',
    invalid: 'amber',
    failed: 'red',
  }[status] || 'slate';
  return <Badge tone={tone}>{String(status).replaceAll('_', ' ')}</Badge>;
}

export function EnvironmentBadge({ environment }) {
  const tone = { production: 'red', staging: 'amber', development: 'slate' }[environment] || 'slate';
  return <Badge tone={tone}>{environment}</Badge>;
}

/** Plain text (not a badge). */
export function ProviderName({ provider }) {
  return <span className="text-sm font-medium text-slate-800">{PROVIDER_LABELS[provider] || provider}</span>;
}
