const BASE = import.meta.env.VITE_API_BASE_URL || '';

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, form } = {}) {
  const init = { method, headers: {} };
  if (form) init.body = form;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error?.message || `Request failed (HTTP ${res.status})`, res.status, data?.error?.code, data?.error?.details);
  }
  return data;
}

const qs = (params = {}) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString();
  return s ? `?${s}` : '';
};

export const api = {
  health: () => request('/health'),
  providers: (probe = false) => request(`/api/providers${probe ? '?probe=true' : ''}`),
  stats: () => request('/api/dashboard/stats'),
  tickets: (params) => request(`/api/tickets${qs(params)}`),
  ticket: (id) => request(`/api/tickets/${encodeURIComponent(id)}`),
  createTicket: (form) => request('/api/tickets', { method: 'POST', form }),
  triage: (id, body = {}) => request(`/api/triage/${encodeURIComponent(id)}`, { method: 'POST', body }),
  compare: (body) => request('/api/triage/compare', { method: 'POST', body }),
  escalations: () => request('/api/escalations'),
  review: (id, body) => request(`/api/tickets/${encodeURIComponent(id)}/review`, { method: 'PATCH', body }),
};
