import { fmtDate, RULE_LABELS } from '../services/format.js';
import { ProviderName } from './Badges.jsx';

/** Escalation events (recorded only; no notifications are sent). */
export default function EscalationList({ escalations }) {
  if (!escalations?.length) return <p className="px-4 py-3 text-sm text-slate-500">None.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {escalations.map((e) => (
        <li key={e.escalationId} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
          <span className="font-medium text-red-700">{RULE_LABELS[e.rule] || e.rule}</span>
          <span className="text-slate-700">{e.reason}</span>
          <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            <ProviderName provider={e.provider} />
            {fmtDate(e.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
