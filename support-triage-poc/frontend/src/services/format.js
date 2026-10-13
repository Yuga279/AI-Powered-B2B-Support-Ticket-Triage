export const TEAMS = ['billing', 'infrastructure', 'auth_identity', 'frontend', 'unknown'];

export const TEAM_LABELS = {
  billing: 'Billing',
  infrastructure: 'Infrastructure',
  auth_identity: 'Auth & Identity',
  frontend: 'Frontend',
  unknown: 'Unknown',
};

export const PROVIDER_LABELS = {
  jev: 'Jev',
  luna: 'Luna Decisions',
  openrouter_llm: 'OpenRouter LLM',
  none: 'No provider',
};

export const RULE_LABELS = {
  probability_threshold: 'High breach probability',
  deadline_imminent: 'Deadline imminent',
  critical_severity: 'Critical severity',
};

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
export const fmtMs = (ms) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
export const fmtUsd = (v) => (v == null ? '—' : v === 0 ? '$0' : `$${v < 0.01 ? v.toFixed(6) : v.toFixed(4)}`);
export const fmtNum = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));

export function fmtMinutes(min) {
  if (min == null) return '—';
  if (min < 0) return `breached ${fmtDuration(-min)} ago`;
  return `${fmtDuration(min)} left`;
}

function fmtDuration(min) {
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.floor(min / 60)} h ${min % 60} min`;
  return `${Math.floor(min / 1440)} d ${Math.floor((min % 1440) / 60)} h`;
}
