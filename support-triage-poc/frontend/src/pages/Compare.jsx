import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { ErrorBanner, Loading } from '../components/Common.jsx';
import ProviderPicker from '../components/ProviderPicker.jsx';
import ComparisonGrid from '../components/ComparisonGrid.jsx';

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const [ticketId, setTicketId] = useState(params.get('ticket') || '');
  const [selected, setSelected] = useState(['jev', 'luna', 'openrouter_llm']);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const tickets = useApi(() => api.tickets({ limit: 200 }), []);
  const providers = useApi(() => api.providers(), []);
  const configured = new Set((providers.data?.providers || []).filter((p) => p.configured).map((p) => p.id));
  const chosen = selected.filter((id) => configured.has(id));

  useEffect(() => {
    if (!ticketId && tickets.data?.tickets[0]) setTicketId(tickets.data.tickets[0].ticketId);
  }, [tickets.data, ticketId]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setParams({ ticket: ticketId });
      setResult(await api.compare({ ticketId, providers: chosen }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (tickets.loading && !tickets.data) return <Loading />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Compare providers</h1>
      <section className="card space-y-3 p-4">
        <select className="input" value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
          {tickets.data?.tickets.map((t) => (
            <option key={t.ticketId} value={t.ticketId}>
              {t.subject}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ProviderPicker providers={providers.data?.providers} selected={selected} onChange={setSelected} />
          <button className="btn-primary" onClick={run} disabled={busy || !ticketId || chosen.length < 2}>
            {busy ? 'Running…' : 'Compare'}
          </button>
        </div>
      </section>
      <ErrorBanner error={error} />
      {result && (
        <>
          <ComparisonGrid results={result.results} />
          <Link className="text-sm text-indigo-600 hover:underline" to={`/tickets/${result.ticket.ticketId}`}>
            Open ticket →
          </Link>
        </>
      )}
    </div>
  );
}
