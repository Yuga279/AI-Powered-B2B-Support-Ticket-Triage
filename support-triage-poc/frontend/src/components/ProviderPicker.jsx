import { PROVIDER_LABELS } from '../services/format.js';

const IDS = ['jev', 'luna', 'openrouter_llm'];

/** Provider checkboxes. Providers that are not configured on the backend are disabled. */
export default function ProviderPicker({ providers = [], selected, onChange }) {
  const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="flex flex-wrap gap-2">
      {IDS.map((id) => {
        const configured = byId[id]?.configured ?? false;
        return (
          <label
            key={id}
            title={configured ? byId[id]?.textModel : byId[id]?.configIssue || 'Not configured'}
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
              !configured ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400' : selected.includes(id) ? 'cursor-pointer border-indigo-400 bg-indigo-50' : 'cursor-pointer border-slate-200 bg-white'
            }`}
          >
            <input type="checkbox" disabled={!configured} checked={configured && selected.includes(id)} onChange={() => toggle(id)} />
            {PROVIDER_LABELS[id]}
            {!configured && <span className="text-xs">(not configured)</span>}
          </label>
        );
      })}
    </div>
  );
}
