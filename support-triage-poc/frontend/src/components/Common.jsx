export function StatTile({ label, value, hint, tone = 'slate' }) {
  const tones = { slate: 'text-slate-900', amber: 'text-amber-600', red: 'text-red-600', indigo: 'text-indigo-600' };
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

/** Horizontal bar list without a chart library. */
export function BarList({ items, color = 'bg-indigo-500' }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-2 text-sm">
          <span className="truncate text-slate-600">{i.label}</span>
          <span className="h-2.5 rounded bg-slate-100">
            <span className={`block h-2.5 rounded ${i.color || color}`} style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-medium tabular-nums text-slate-800">{i.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error.message || String(error)}
      {error.details && (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {error.details.map((d, i) => (
            <li key={i}>
              {d.path ? `${d.path}: ` : ''}
              {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return <div className="py-8 text-center text-sm text-slate-500">{label}</div>;
}

export function Empty({ children }) {
  return <div className="px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}
