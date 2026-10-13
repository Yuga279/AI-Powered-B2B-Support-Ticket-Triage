import { useState } from 'react';
import { api } from '../services/api.js';
import { TEAM_LABELS, TEAMS } from '../services/format.js';
import { ErrorBanner } from './Common.jsx';

export default function ReviewForm({ ticketId, onSaved }) {
  const [form, setForm] = useState({ decision: 'confirmed', team: '', severity: '', reviewer: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { decision: form.decision, reviewer: form.reviewer };
      if (form.decision === 'overridden') {
        if (form.team) body.team = form.team;
        if (form.severity) body.severity = Number(form.severity);
      }
      await api.review(ticketId, body);
      onSaved?.();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 p-4">
      <ErrorBanner error={error} />
      <div className="flex flex-wrap items-end gap-2">
        <select className="input w-auto" value={form.decision} onChange={set('decision')}>
          <option value="confirmed">Confirm</option>
          <option value="overridden">Override</option>
          <option value="dismissed">Dismiss</option>
        </select>
        {form.decision === 'overridden' && (
          <>
            <select className="input w-auto" value={form.team} onChange={set('team')}>
              <option value="">Team…</option>
              {TEAMS.map((t) => (
                <option key={t} value={t}>
                  {TEAM_LABELS[t]}
                </option>
              ))}
            </select>
            <select className="input w-auto" value={form.severity} onChange={set('severity')}>
              <option value="">Severity…</option>
              {[1, 2, 3, 4, 5].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </>
        )}
        <input className="input w-36" required value={form.reviewer} onChange={set('reviewer')} placeholder="Your name" />
        <button className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
