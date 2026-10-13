import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';
import { EnvironmentBadge, SeverityBadge, StatusBadge, TeamBadge } from '../components/Badges.jsx';

function Section({ title, intro, children }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {intro && <p className="mt-0.5 text-sm text-slate-600">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function Step({ n, title, children }) {
  return (
    <li className="card relative p-4 pl-14">
      <span className="absolute left-4 top-4 grid h-7 w-7 place-items-center rounded-full bg-indigo-600 text-sm font-semibold text-white">{n}</span>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-1 text-sm text-slate-600">{children}</div>
    </li>
  );
}

function ProviderCard({ name, by, input, risk, configured }) {
  return (
    <div className="card space-y-2 p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900">{name}</h3>
          <p className="text-xs text-slate-500">{by}</p>
        </div>
        {configured != null && (
          <span className={`text-xs font-medium ${configured ? 'text-emerald-700' : 'text-slate-400'}`}>{configured ? 'Configured' : 'Not configured'}</span>
        )}
      </div>
      <p className="text-slate-600">
        <span className="font-medium text-slate-800">Reads:</span> {input}
      </p>
      <p className="text-slate-600">
        <span className="font-medium text-slate-800">SLA answer:</span> {risk}
      </p>
    </div>
  );
}

export default function HowItWorks() {
  const { data } = useApi(() => api.providers(), []);
  const policy = data?.policy;
  const configured = Object.fromEntries((data?.providers || []).map((p) => [p.id, p.configured]));
  const lunaReadsImages = (data?.providers || []).find((p) => p.id === 'luna')?.supportsImages;
  const v = (value, fallback) => (value ?? fallback);

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Proof of concept</p>
        <h1 className="text-2xl font-semibold text-slate-900">AI triage for B2B support tickets</h1>
        <p className="text-slate-700">
          When a support ticket comes in, this app asks an AI <strong>decision model</strong> four fixed questions: which team should own it, how severe it is,
          whether it will miss its SLA deadline, and whether a person should check it. The model only answers; <strong>plain, visible rules in the app</strong>{' '}
          then decide whether to escalate. Every step is saved, so you can see exactly why each decision was made.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-primary" to="/tickets/new">
            Try it: create a ticket
          </Link>
          <Link className="btn-secondary" to="/tickets">
            See existing tickets
          </Link>
        </div>
      </header>

      <Section title="What happens to a ticket" intro="From the moment you press Submit until the result appears (usually about a second).">
        <ol className="space-y-3">
          <Step n={1} title="You submit a ticket">
            Subject, description, optional logs, environment, number of affected users, minutes left until the SLA deadline, and an optional screenshot.
          </Step>
          <Step n={2} title="The ticket is saved first">
            It is stored before any AI is called, so a ticket is never lost if the AI is slow or fails. Obvious secrets in logs (API keys, passwords, tokens)
            are removed before anything is sent to a model.
          </Step>
          <Step n={3} title="It is routed to a model">
            Text-only tickets go to <strong>Jev</strong>. Tickets with a screenshot go to a model that can read images
            {lunaReadsImages ? <> (<strong>Luna</strong>, which receives the screenshot itself)</> : null}. If a model fails, the next one is tried.
            All calls go through <strong>OpenRouter</strong> from the server; the API key never reaches your browser.
          </Step>
          <Step n={4} title="The model answers four questions">
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                <strong>Team</strong>: pick one of Billing, Infrastructure, Auth &amp; Identity, Frontend or Unknown
              </li>
              <li>
                <strong>Severity</strong>: a score from 1 (minimal) to 5 (critical)
              </li>
              <li>
                <strong>SLA breach</strong>: yes or no, will this miss its deadline unless escalated?
              </li>
              <li>
                <strong>Needs review</strong>: yes or no, is the ticket unclear or missing information?
              </li>
            </ul>
            The answers come back as values, not free text, so the app can use them directly.
          </Step>
          <Step n={5} title="The answers are checked">
            Every answer is validated. A malformed or unexpected answer is never used for decisions; the ticket is sent to human review instead.
          </Step>
          <Step n={6} title="Rules decide: escalate, review, or done">
            The app applies the escalation rules below. If none fire but something is uncertain, the ticket is marked for human review.
          </Step>
          <Step n={7} title="Everything is recorded">
            Each triage run is saved with the exact request sent to the model, the raw response, and the rule checks. Open any ticket and expand{' '}
            <strong>How this decision was made</strong> to see them.
          </Step>
        </ol>
      </Section>

      <Section title="The AI models" intro="Decision models answer fixed questions with values and confidence scores. Each treats the yes/no SLA question differently, and the app respects that.">
        <div className="grid gap-3 md:grid-cols-3">
          <ProviderCard
            name="Jev"
            by="TypeSafe AI, via OpenRouter"
            input="Text only. Cheapest; the default for text tickets."
            risk="A probability (e.g. 0.79). TypeSafe says it is calibrated, but that is not yet verified, so it never escalates on its own."
            configured={configured.jev}
          />
          <ProviderCard
            name="Luna Decisions"
            by="OpenAI GPT-6 Luna, via OpenRouter"
            input={
              lunaReadsImages
                ? 'Text and screenshots. The default for tickets with a screenshot.'
                : 'Text. Screenshots only when image input is switched on (LUNA_IMAGE_MODE).'
            }
            risk="A yes/no verdict (OpenAI calls it a predicate). Treated as a flag, not a percentage."
            configured={configured.luna}
          />
          <ProviderCard
            name="OpenRouter LLM"
            by="Any general model you choose"
            input="Text and screenshots, when a vision model is set."
            risk="Low, medium or high. A judgement, not a number."
            configured={configured.openrouter_llm}
          />
        </div>
        <p className="text-sm text-slate-600">
          Want to see how they differ? Use <Link className="text-indigo-600 hover:underline" to="/compare">Compare</Link> to send the same ticket to several
          models side by side.
        </p>
      </Section>

      <Section title="Escalation rules" intro="Any one of these escalates the ticket. The values come from the server's current settings.">
        <div className="card overflow-x-auto">
          <table className="table table-fixed">
            <colgroup>
              <col className="w-48" />
              <col />
              <col className="w-56" />
            </colgroup>
            <thead>
              <tr>
                <th>Rule</th>
                <th>Escalates when</th>
                <th>Needs the AI?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="font-medium">Deadline imminent</td>
                <td className="!whitespace-normal">{v(policy?.urgentDeadlineMinutes, 5)} minutes or less remain before the SLA deadline (or it has passed)</td>
                <td className="!whitespace-normal">No: it works even if every model is down</td>
              </tr>
              <tr>
                <td className="font-medium">Critical severity</td>
                <td className="!whitespace-normal">The model rates severity {v(policy?.criticalSeverity, 5)}</td>
                <td>Yes</td>
              </tr>
              <tr>
                <td className="font-medium">High breach probability</td>
                <td className="!whitespace-normal">
                  A <em>trusted</em> probability is above {v(policy?.breachProbabilityThreshold, 0.85)}
                  {policy && !policy.trustVendorCalibration && ' (currently off: no provider’s probability is trusted yet)'}
                </td>
                <td>Yes</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-slate-600">
          A ticket also goes to <strong>human review</strong> when the team is unknown, the model is unsure (confidence below{' '}
          {v(policy?.lowConfidenceThreshold, 0.5)}), the model asks for review, an answer was invalid, or the risk looks high but no rule may act on it.
          Reviewers can confirm, override the team or severity, or dismiss.
        </p>
      </Section>

      <Section title="Reading a result">
        <div className="card divide-y divide-slate-100 text-sm">
          <div className="flex flex-wrap items-center gap-3 p-3">
            <span className="w-28 font-medium text-slate-800">Status</span>
            <StatusBadge status="triaged" /> <StatusBadge status="review_required" /> <StatusBadge status="escalated" /> <StatusBadge status="reviewed" />
            <span className="text-slate-600">where the ticket stands now</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 p-3">
            <span className="w-28 font-medium text-slate-800">Team</span>
            <TeamBadge team="infrastructure" /> <TeamBadge team="billing" /> <TeamBadge team="unknown" />
            <span className="text-slate-600">who should own it</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 p-3">
            <span className="w-28 font-medium text-slate-800">Severity</span>
            <SeverityBadge severity={2} /> <SeverityBadge severity={4} /> <SeverityBadge severity={5} />
            <span className="text-slate-600">1 = minimal, 5 = critical</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 p-3">
            <span className="w-28 font-medium text-slate-800">Environment</span>
            <EnvironmentBadge environment="production" /> <EnvironmentBadge environment="staging" /> <EnvironmentBadge environment="development" />
            <span className="text-slate-600">where the problem happens</span>
          </div>
          <div className="p-3">
            <span className="font-medium text-slate-800">SLA risk</span>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600">
              <li>
                <strong>P(breach) 0.79</strong>: a probability (Jev)
              </li>
              <li>
                <strong>Likely to breach: yes</strong>: a yes/no verdict (Luna), not a percentage
              </li>
              <li>
                <strong>High</strong>: a judgement (general LLM), not a number
              </li>
            </ul>
          </div>
        </div>
      </Section>

      <Section title="What this proof of concept does not do">
        <ul className="card list-disc space-y-1 p-4 pl-9 text-sm text-slate-600">
          <li>It does not send real alerts. Escalations are recorded only; no PagerDuty, Slack or email is sent.</li>
          <li>There is no login. Anyone with the link can create tickets, which uses paid AI calls.</li>
          <li>The thresholds are demo values, not tuned on real tickets, and the accuracy of the models has not been measured on real data.</li>
          <li>The SLA deadline is entered per ticket; there are no customer contracts or SLA plans.</li>
        </ul>
      </Section>
    </div>
  );
}
