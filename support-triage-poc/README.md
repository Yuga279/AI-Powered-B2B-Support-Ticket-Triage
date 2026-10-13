# Support Triage POC: AI-assisted B2B ticket triage

This is a runnable proof of concept that:
- triages enterprise support tickets: owning team, severity 1–5 and SLA-breach risk;
- runs a deterministic SLA policy in application code;
- records auditable escalation events (no notifications are sent);
- keeps every triage run in SQLite;
- lets you compare providers side by side.

All real AI calls go through **OpenRouter** using a single backend key:

| Provider id | What it is | OpenRouter transport | Default model | Images | Risk output semantics |
|---|---|---|---|---|---|
| `jev` | TypeSafe **Jev** decision model | Decisions endpoint (`POST /api/alpha/decisions`) | `typesafe/jev-1.13` | No (text only) | **probability**: the `noul` value, with calibration `vendor_claimed` |
| `luna` | OpenAI **GPT-6 Luna Decisions** ("served through OpenAI's Decisions API") | Decisions endpoint | `openai/gpt-6-luna-decisions` | Only if `LUNA_IMAGE_MODE` is enabled after probing | **predicate**: a score plus a yes/no verdict. *Never* treated as a probability |
| `openrouter_llm` | Any general chat/vision LLM you choose | Chat completions (`POST /api/v1/chat/completions`) | none: you set `OPENROUTER_MODEL` / `OPENROUTER_VISION_MODEL` | Yes, with a vision model | **qualitative**: low/medium/high, no probability |

> `openrouter_llm` is an ordinary LLM call through OpenRouter. It is **not** the OpenAI Decisions API. The Luna Decisions model goes through OpenRouter's dedicated Decisions endpoint.

Without a key, tickets are still saved and the SLA deadline rule still runs, but AI triage is unavailable: tickets go to human review. There is no mock or simulated provider.

---

## 1. Prerequisites (Windows)

- **Node.js 20 or newer.** This repo was built and verified with **Node 22.17.0**; see `.nvmrc`.
  - Node 14 does **not** work: native `fetch`, Vite and `better-sqlite3` all need a newer Node.
  - With nvm-windows, run `nvm use 22.17.0` (or `nvm install 22.17.0` first).
- No Docker and no build tools are needed: `better-sqlite3` ships prebuilt binaries for Node 22 on Windows x64.

## 2. Setup (PowerShell)

```powershell
cd D:\Source6\DockerLearning\support-triage-poc
nvm use 22.17.0            # if you use nvm-windows
node --version             # should print v22.x (or >= v20)

npm run install:all        # installs root, backend and frontend dependencies
Copy-Item backend\.env.example backend\.env      # skip if backend\.env already exists
# Optional: Copy-Item frontend\.env.example frontend\.env

npm run dev                # API on http://localhost:4000, UI on http://localhost:5173
```


- **UI:** http://localhost:5173
- **API docs (Swagger UI):** http://localhost:4000/api-docs
- **Health:** http://localhost:4000/health

### Root scripts

| Script | What it does |
|---|---|
| `npm run install:all` | Installs dependencies in the root, `backend/` and `frontend/` |
| `npm run dev` | Runs Express (nodemon, port 4000) and Vite (port 5173) together |
| `npm run test` | Runs the backend Vitest + Supertest suite. It needs no network and no keys |
| `npm run build` | Builds the frontend for production into `frontend/dist` |

### Backend-only scripts (run from `backend/`)

| Script | What it does |
|---|---|
| `npm run models:openrouter` | Lists current OpenRouter models with vision, structured-output and pricing flags, to help you pick `OPENROUTER_MODEL` / `OPENROUTER_VISION_MODEL` |
| `npm run probe:decisions` | Live check of the Decisions endpoint URL, the Jev and Luna slugs, and **Luna image input**. Costs a fraction of a cent |

## 3. Enabling real providers (OpenRouter)

1. Put your key in `backend\.env`:
   ```
   OPENROUTER_API_KEY=sk-or-v1-...
   ```
   The key is read only by the backend. It is never sent to the browser, returned by `/api/providers` or written to logs.
2. Check the key and the Decisions endpoint:
   ```powershell
   cd backend
   npm run probe:decisions
   ```
   - It confirms which Decisions URL works and that `typesafe/jev-1.13` and `openai/gpt-6-luna-decisions` answer.
   - It then tests whether Luna can read an image. It sends two synthetic screenshots with different button colours, and enables image mode only if **both** are identified correctly.
   - If it prints `>> Set ...`, copy those values into `.env`.
3. Choose a general LLM for screenshots (and, optionally, text):
   ```powershell
   npm run models:openrouter                 # models with JSON / structured outputs
   npm run models:openrouter -- --search=gemini
   ```
   - Set `OPENROUTER_VISION_MODEL` to a model marked `vision=yes schema=yes`.
   - Set `OPENROUTER_MODEL` to a text model if you want `openrouter_llm` for text tickets too. Otherwise the vision model is reused.
   - If the model only supports JSON mode, set `OPENROUTER_JSON_MODE=json_object`.
   - Model IDs change over time, which is why none is hardcoded.
4. Restart `npm run dev`. The header changes from "AI not configured" to "Live (OpenRouter)". `GET /api/providers?probe=true` checks the key via OpenRouter `GET /api/v1/key`, which generates nothing and costs nothing.

### Automatic routing

| Ticket | Route |
|---|---|
| Text only | `TEXT_PROVIDER` (default `jev`), then the other configured real providers, as fallbacks |
| With screenshot | `luna` if `LUNA_IMAGE_MODE` is enabled, then `openrouter_llm` with `OPENROUTER_VISION_MODEL`, then the text-only providers. A text-only provider adds the review note "screenshot not analyzed" |
| Every real provider fails | A `provider: none`, `status: failed` result that requires human review. The ticket is kept, and the deadline rule still applies |
| No key configured | A `provider: none` result (`no_provider_configured`) that requires human review |

### Manual / comparison mode

- Pick one provider for a single triage, or two or more to compare them.
- Each provider's result is saved independently, and partial failures are shown next to the successful results.
- An unconfigured provider appears as **UNAVAILABLE**.
- Providers that aren't configured can't be selected in the UI. Through the API they return `status: unavailable` without any network call.

## 4. Risk semantics and SLA policy

The policy is in `backend/src/policies/slaPolicy.js`. It is made of pure functions and is fully unit-tested. The default thresholds below are **demonstration values, not validated production thresholds**:

| Setting | Default |
|---|---|
| `SLA_BREACH_PROBABILITY_THRESHOLD` | `0.85` |
| `SLA_CRITICAL_SEVERITY` | `5` |
| `SLA_URGENT_DEADLINE_MINUTES` | `5` |

The rules:

1. **`probability_threshold`.** Escalates only when *all* of these hold:
   - `riskOutputType === 'probability'`;
   - the value is **> 0.85**;
   - calibration is trusted. That means `calibrated`, or `vendor_claimed` with `SLA_TRUST_VENDOR_CALIBRATION=true`, which is **off by default**.
   - TypeSafe describes Jev as "trained … to return calibrated decisions". That is a vendor claim, so by default Jev's probability is shown but sends the ticket to human review instead of escalating it.
   - No current provider returns `calibrated`; the status exists for a future, independently calibrated model.
2. **`deadline_imminent`.** Escalates when the real SLA deadline is ≤ 5 minutes away or already passed. It uses ticket data only, so it applies even when every AI provider fails.
3. **`critical_severity`.** Escalates on severity 5, but only from a valid result.
4. **Human review.** Required when:
   - the result is invalid or failed;
   - the team is `unknown`;
   - confidence is low;
   - the model flags `needs_human_review`;
   - a probability exceeds the threshold but its calibration isn't trusted;
   - a positive **predicate** or a **high qualitative** risk has no other escalation trigger. Neither predicates nor qualitative judgements auto-escalate.

How each provider's output is treated:
- **Predicates stay predicates.** Luna's `noul` value is stored as `predicateScore` with `predicateVerdict = score >= LUNA_PREDICATE_DECISION_THRESHOLD` (0.5, a cut-off). `breachProbability` is always `null`. The normalized-result validator rejects any result that pairs a predicate with a probability.
- **LLM risk is qualitative.** The general LLM is asked for low/medium/high and explicitly *not* for numbers.

Escalation events:
- Each event stores the ticket, the triggering rule and reason, a risk snapshot taken at decision time, the provider and model, a timestamp and the status `recorded`.
- They are recorded idempotently through a `UNIQUE(ticket_id, rule)` constraint, so re-triaging never duplicates them.
- **No PagerDuty, Slack or email notifications are sent.**

## 5. API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/tickets` | JSON, or multipart with an optional `screenshot`. `triageMode`: `none` \| `auto` \| `manual` (+ `providers`) |
| GET | `/api/tickets` | Filters: `status`, `team`, `limit`, `offset` |
| GET | `/api/tickets/:ticketId` | Ticket, latest result, all runs and results, escalations, reviews |
| POST | `/api/triage/:ticketId` | `{}` for auto routing, or `{ "provider": "jev" }`. **Each call creates a new run** |
| POST | `/api/triage/compare` | `{ "ticketId", "providers": ["jev","luna"] }` |
| GET | `/api/providers` | Configuration and models, never keys. `?probe=true` checks the key |
| GET | `/api/dashboard/stats` | Team/severity distribution, review queue, escalations, provider success/failure/latency/cost, text vs image |
| GET | `/api/escalations` | Escalation audit trail |
| PATCH | `/api/tickets/:ticketId/review` | `{ "decision": "confirmed" \| "overridden" \| "dismissed", "team"?, "severity"?, "reviewer", "notes"? }` |
| GET | `/api-docs` | Swagger UI. The raw spec is at `/api-docs.json` |
| GET | `/health` | Database check and mode |

PowerShell example:

```powershell
$t = @{ subject='Production API returning 502'; description='All EU requests fail with 502 since 09:00.';
        affectedUsers=1200; minutesUntilSlaDeadline=30; triageMode='auto' } | ConvertTo-Json
Invoke-RestMethod -Method Post http://localhost:4000/api/tickets -ContentType 'application/json' -Body $t

# multipart with a screenshot (curl.exe ships with Windows 10+)
curl.exe -X POST http://localhost:4000/api/tickets -F "subject=Checkout button broken" `
  -F "description=Button overlaps the footer on mobile." -F affectedUsers=900 -F minutesUntilSlaDeadline=60 `
  -F triageMode=auto -F "screenshot=@C:\path\to\shot.png;type=image/png"
```

## 6. Architecture

```
backend/src
  app.js / server.js     Express app factory (dependencies injected; tests use :memory: DB + stubbed fetch) / entry point
  config/                dotenv + zod-validated configuration
  routes/ controllers/   HTTP layer only
  services/              ticket, triage orchestration, routing, normalizer, escalation, dashboard, attachments
  providers/             httpClient (timeout, bounded retry, typed errors), OpenRouter Decisions client,
                         jev / luna / openrouter_llm adapters, registry
  policies/slaPolicy.js  pure business rules
  repositories/          better-sqlite3 schema + migrations, data access
  validators/            zod: request schemas, provider response schemas, normalized result contract
  middleware/            upload (multer + magic bytes), validation, error handler, pino-http logging
frontend/src             React + Vite + Tailwind: Dashboard, Create ticket, Tickets, Ticket detail/history,
                         Compare (escalations and review are on the ticket page)
```

### Flow

1. **Validate and save.** The request is validated with zod. If there is a screenshot, its MIME type and magic bytes are checked. The ticket and attachment metadata are **committed before any AI call**.
2. **Route.** The routing service picks the provider chain.
3. **Call.** Each adapter makes a bounded call: a timeout per attempt, and retries only on 408/429/5xx/529 with backoff, honouring `Retry-After` up to a cap.
4. **Validate the response.** The raw response is validated, mapped to the normalized contract, and validated again. Any violation produces `status: invalid`, which goes to human review.
5. **Apply policy.** The SLA policy runs.
6. **Persist.** One transaction writes every result (including failed fallback attempts), the escalations, the run status and the ticket status.

### SQLite tables

| Table | Contents |
|---|---|
| `tickets` | The tickets |
| `attachments` | Metadata only |
| `triage_runs` | One row per triage attempt |
| `provider_results` | Every provider result (primary, fallback attempt or comparison) |
| `escalations` | Escalation events, with `UNIQUE(ticket_id, rule)` |
| `review_decisions` | Human review decisions |

- The database lives at `backend/data/triage.db`; delete the file to reset.
- Uploads are stored under `backend/data/uploads`, which is outside any public directory, with random UUID filenames.

## 7. Testing

```powershell
npm run test
```

- There are 90+ tests, built on Vitest + Supertest.
- The network is stubbed: a global guard fails any test that tries a real call.
- The database is in memory, and the clock is fixed.

| Area | What is covered |
|---|---|
| Ticket validation | Validation, upload type/size/signature checks, secret redaction |
| SLA policy | Thresholds, calibration trust, predicate vs probability, deadline with or without AI, critical severity |
| Decisions request shape | The request matches the documented OpenRouter Decisions schema |
| Provider errors | 401, 402, 429 retry and exhaustion, 529, timeouts, HTTP 200 with an error body, malformed and refusal answers |
| OpenRouter LLM adapter | Text vs image payloads, `json_schema` vs `json_object`, empty, cut-off and invalid outputs |
| Routing | Text/image routing, fallback chain, no-key behaviour |
| API | Persistence and history (a new run on every triage), escalations never duplicated, partial failures in comparisons, review, stats, no key leakage |

> The synthetic fixtures exercise the code paths. They are **not** evidence of real-world classification accuracy or calibration.

## 8. Security and reliability (POC scope)

**What is in place:**
- **Keys:** they live only in `backend/.env`. `.env`, the SQLite files and uploads are git-ignored, and no `VITE_*` variable holds a secret.
- **Uploads:** PNG, JPEG or WebP only, at most 5 MB (`MAX_UPLOAD_MB`), with MIME type and magic-byte checks. The JSON body limit is 1 MB. No user-supplied URLs are ever fetched.
- **Data sent to providers:** logs are truncated (`MAX_LOG_CHARS_TO_PROVIDER`) and obvious secrets are redacted (API keys, bearer tokens, `password=…`, JWTs) **before** anything is sent.
- **Logging:** logs are structured (pino) with redaction. Ticket bodies are not logged; only IDs and lengths are.

**Known limitations, deliberately out of scope:**
- No authentication or authorization, and no data isolation. Any caller can read and write every ticket.
- Escalations are recorded only; no PagerDuty, Slack or email notification is sent.
- The thresholds are illustrative.
- Calibration is not validated.
- There is no rate limiting on the API itself.
- A single SQLite file means a single process.
- OpenRouter's Decisions endpoint is labelled *alpha*, and the Luna image format through OpenRouter is undocumented, hence the probe script.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `SyntaxError` / `fetch is not defined` / `better-sqlite3` build errors | You're on an old Node. Run `nvm use 22.17.0` and confirm `node --version`, then delete the `node_modules` folders and run `npm run install:all` again |
| `node` not recognized right after `nvm use` | Open a new terminal. nvm-windows updates the PATH symlink for new shells |
| `EADDRINUSE :4000` or `:5173` | Something else is using the port. Stop it, or change `PORT` (and the proxy in `frontend/vite.config.js`) |
| The UI shows "Backend unreachable" | The API isn't running. Check the `[api]` lines in the `npm run dev` output |
| Header says "AI not configured" | `OPENROUTER_API_KEY` is missing from `backend.env`. See section 3 |
| `auth_failed` (401) | The key is wrong or revoked. Check `OPENROUTER_API_KEY` and call `GET /api/providers?probe=true` |
| `insufficient_credits` (402) | Add credits to your OpenRouter account |
| `rate_limited` (429) | The request was already retried up to `PROVIDER_MAX_RETRIES`. Wait and try again |
| `not_found` (404) from Jev or Luna | Run `npm run probe:decisions` and set `OPENROUTER_DECISIONS_URL` and/or the model slugs it reports |
| `bad_request` from `openrouter_llm` | The model may not support `json_schema`. Set `OPENROUTER_JSON_MODE=json_object` or pick another model (`npm run models:openrouter`) |
| `malformed_response` "hit max_tokens" | Raise `OPENROUTER_MAX_TOKENS`. Reasoning models use tokens before they answer |
| Screenshot "not analyzed" | Set `OPENROUTER_VISION_MODEL`, and/or enable `LUNA_IMAGE_MODE` after the probe confirms it works |
| Reset all data | Stop the API, then delete `backend\data\triage.db*` and `backend\data\uploads\*` |

## 10. Deploy to Vercel (frontend and backend)

The whole app deploys as **one Vercel project** at one URL:

| Part | How it runs on Vercel |
|---|---|
| React UI | Static files built from `frontend/` (`frontend/dist`) |
| Express API | One serverless function, `api/index.js`. `vercel.json` sends `/api/*`, `/health` and `/api-docs` to it |
| Database | **Turso** (hosted SQLite, via `@libsql/client`), when `TURSO_DATABASE_URL` is set |
| Screenshots | A **private Vercel Blob** store, when `BLOB_READ_WRITE_TOKEN` is set |

Locally nothing changes: without those variables the app uses `backend/data/triage.db` (better-sqlite3) and `backend/data/uploads`.

> Without Turso and Blob, the deployment still starts, but data goes to `/tmp` and is lost whenever Vercel recycles the function.

### Steps

1. **Push the code to GitHub.** Vercel deploys from the repository; `.vercelignore` and `.gitignore` keep `.env` and local data out.
2. **Import the project** in Vercel (Add New → Project → pick the repository).
   - **Root Directory:** `support-triage-poc` (the git repository root is one level above the app).
   - Framework preset: **Other**. Build, install and output settings come from `vercel.json`.
3. **Create the database:** in the project, Storage → Marketplace → **Turso** → create a database and connect it.
   - This adds `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. If the integration names them differently, add these two names yourself with the same values.
   - Tables are created automatically on the first request.
4. **Create the screenshot store:** Storage → **Blob** → create a store with **private** access and connect it. This adds `BLOB_READ_WRITE_TOKEN`.
5. **Add environment variables** (Settings → Environment Variables), at least:

   | Variable | Value |
   |---|---|
   | `OPENROUTER_API_KEY` | your OpenRouter key |
   | `OPENROUTER_APP_URL` | your Vercel URL, e.g. `https://<project>.vercel.app` |
   | `OPENROUTER_VISION_MODEL` | optional, a vision model for screenshots |

   Everything else has the same defaults as `backend/.env.example`.
6. **Deploy**, then open `https://<project>.vercel.app/health`. It should return `"db":"ok"` and `"mode":"live"`.

### Limits on Vercel

- **Screenshots** are limited to 4 MB, because Vercel functions accept request bodies up to 4.5 MB.
- **Each request** may run for up to 60 seconds (`maxDuration` in `vercel.json`); provider timeouts are 20 s (text) and 45 s (screenshots).
- **No login:** the deployment is public. Anyone with the URL can create tickets and trigger paid OpenRouter calls. Set a credit limit on the OpenRouter key you use there.
