import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { ErrorBanner } from '../components/Common.jsx';
import ProviderPicker from '../components/ProviderPicker.jsx';

const EMPTY = {
  subject: '',
  description: '',
  logs: '',
  environment: 'production',
  affectedUsers: 1,
  minutesUntilSlaDeadline: 240,
};
const MAX_BYTES = 4 * 1024 * 1024; // matches the backend default (Vercel request limit is 4.5 MB)
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export default function CreateTicket() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState(['jev']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const providers = useApi(() => api.providers(), []);
  const configured = new Set((providers.data?.providers || []).filter((p) => p.configured).map((p) => p.id));
  const chosen = selected.filter((id) => configured.has(id));

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  function pickFile(e) {
    const f = e.target.files?.[0];
    setError(null);
    if (f && (!TYPES.includes(f.type) || f.size > MAX_BYTES)) {
      e.target.value = '';
      setError(new Error('Screenshot must be a PNG, JPEG or WebP image of 4 MB or less.'));
      return;
    }
    setFile(f || null);
  }

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(form)) fd.append(k, String(v));
      fd.append('triageMode', manual ? 'manual' : 'auto');
      if (manual) fd.append('providers', chosen.join(','));
      if (file) fd.append('screenshot', file);
      const res = await api.createTicket(fd);
      navigate(`/tickets/${res.ticket.ticketId}`, { state: { triageError: res.triageError } });
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">New ticket</h1>

      <form onSubmit={submit} className="card space-y-4 p-5">
        <ErrorBanner error={error} />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="label">Subject</label>
            <input className="input" required minLength={3} maxLength={200} value={form.subject} onChange={set('subject')} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Description</label>
            <textarea className="input" required minLength={10} rows={4} value={form.description} onChange={set('description')} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Logs (optional)</label>
            <textarea className="input font-mono text-xs" rows={3} value={form.logs} onChange={set('logs')} />
          </div>
          <div>
            <label className="label">Environment</label>
            <select className="input" value={form.environment} onChange={set('environment')}>
              <option value="production">production</option>
              <option value="staging">staging</option>
              <option value="development">development</option>
            </select>
          </div>
          <div>
            <label className="label">Affected users</label>
            <input className="input" type="number" min={0} required value={form.affectedUsers} onChange={set('affectedUsers')} />
          </div>
          <div>
            <label className="label">Minutes until SLA deadline</label>
            <input className="input" type="number" required value={form.minutesUntilSlaDeadline} onChange={set('minutesUntilSlaDeadline')} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Screenshot (optional)</label>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pickFile} className="text-sm" />
            {preview && <img src={preview} alt="screenshot preview" className="mt-2 max-h-32 rounded border border-slate-200" />}
          </div>
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
            Choose providers myself (otherwise routed automatically)
          </label>
          {manual && <ProviderPicker providers={providers.data?.providers} selected={selected} onChange={setSelected} />}
        </div>

        <div className="flex justify-end">
          <button className="btn-primary" disabled={submitting || (manual && !chosen.length)}>
            {submitting ? 'Calling OpenRouter…' : 'Submit and triage'}
          </button>
        </div>
      </form>
    </div>
  );
}
