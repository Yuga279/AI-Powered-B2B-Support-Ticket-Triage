import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useApi } from './hooks/useApi.js';
import { api } from './services/api.js';
import Dashboard from './pages/Dashboard.jsx';
import Tickets from './pages/Tickets.jsx';
import CreateTicket from './pages/CreateTicket.jsx';
import TicketDetail from './pages/TicketDetail.jsx';
import Compare from './pages/Compare.jsx';

const NAV = [
  ['/', 'Dashboard'],
  ['/tickets/new', 'New ticket'],
  ['/tickets', 'Tickets'],
  ['/compare', 'Compare'],
];

function ModeNote() {
  const { data, error } = useApi(() => api.health(), []);
  if (error) return <span className="text-xs font-medium text-red-600">Backend offline</span>;
  if (data?.mode === 'not_configured') {
    return (
      <span className="text-xs text-amber-700" title="Set OPENROUTER_API_KEY in backend/.env and restart the API.">
        AI not configured
      </span>
    );
  }
  return data ? <span className="text-xs text-emerald-700">Live (OpenRouter)</span> : null;
}

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 px-4 py-3">
          <span className="font-semibold text-slate-900">Support Triage</span>
          <nav className="flex flex-wrap gap-1">
            {NAV.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/' || to === '/tickets'}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <ModeNote />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/tickets/new" element={<CreateTicket />} />
          <Route path="/tickets/:ticketId" element={<TicketDetail />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
