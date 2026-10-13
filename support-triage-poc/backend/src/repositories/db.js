import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS tickets (
        ticket_id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        logs TEXT NOT NULL DEFAULT '',
        environment TEXT NOT NULL,
        affected_users INTEGER NOT NULL,
        minutes_until_sla_deadline INTEGER NOT NULL,
        sla_deadline_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new'
          CHECK (status IN ('new','triaged','review_required','escalated','reviewed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

      CREATE TABLE IF NOT EXISTS attachments (
        attachment_id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON attachments(ticket_id);

      CREATE TABLE IF NOT EXISTS triage_runs (
        run_id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK (mode IN ('auto','manual','compare')),
        requested_providers TEXT NOT NULL DEFAULT '[]',
        routing_trace TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
        policy_decision TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_ticket ON triage_runs(ticket_id, created_at);

      CREATE TABLE IF NOT EXISTS provider_results (
        result_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES triage_runs(run_id) ON DELETE CASCADE,
        ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('primary','fallback_attempt','comparison')),
        provider TEXT NOT NULL,
        transport TEXT,
        model TEXT,
        upstream_provider TEXT,
        status TEXT NOT NULL CHECK (status IN ('ok','invalid','failed','unavailable')),
        team TEXT NOT NULL,
        severity INTEGER,
        raw_severity REAL,
        risk_level TEXT,
        risk_summary TEXT,
        breach_probability REAL,
        risk_output_type TEXT,
        calibration_status TEXT,
        predicate_score REAL,
        predicate_verdict INTEGER,
        confidence REAL,
        explanation TEXT,
        human_review_required INTEGER NOT NULL DEFAULT 0,
        review_reasons TEXT NOT NULL DEFAULT '[]',
        policy_decision TEXT,
        error_code TEXT,
        error_message TEXT,
        error_retryable INTEGER,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL,
        decided_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_results_ticket ON provider_results(ticket_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_results_run ON provider_results(run_id);
      CREATE INDEX IF NOT EXISTS idx_results_provider ON provider_results(provider);

      CREATE TABLE IF NOT EXISTS escalations (
        escalation_id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
        rule TEXT NOT NULL,
        reason TEXT NOT NULL,
        run_id TEXT,
        result_id TEXT,
        provider TEXT NOT NULL,
        model TEXT,
        risk_snapshot TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'recorded',
        created_at TEXT NOT NULL,
        UNIQUE (ticket_id, rule)
      );
      CREATE INDEX IF NOT EXISTS idx_escalations_created ON escalations(created_at);

      CREATE TABLE IF NOT EXISTS review_decisions (
        review_id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
        decision TEXT NOT NULL CHECK (decision IN ('confirmed','overridden','dismissed')),
        team TEXT,
        severity INTEGER,
        reviewer TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_ticket ON review_decisions(ticket_id, created_at);
    `,
  },
];

// v2: tenant and mock/simulated support were removed. Drops the old columns from databases created by v1
// (fresh databases are created without them, so each drop is conditional).
const DROPPED_COLUMNS = [
  ['tickets', 'tenant_id'],
  ['provider_results', 'simulated'],
  ['escalations', 'simulated_provider'],
];
MIGRATIONS.push({
  version: 2,
  async run(db) {
    for (const [table, column] of DROPPED_COLUMNS) {
      const exists = await db.get(`SELECT 1 AS present FROM pragma_table_info('${table}') WHERE name = ?`, [column]);
      if (exists) await db.run(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
    await db.run("UPDATE escalations SET status = 'recorded' WHERE status = 'simulated_sent'");
  },
});

// v3: keep the provider request/response so the UI can show how each decision was made.
MIGRATIONS.push({
  version: 3,
  sql: `
    ALTER TABLE provider_results ADD COLUMN request_payload TEXT;
    ALTER TABLE provider_results ADD COLUMN response_payload TEXT;
  `,
});

const splitStatements = (sql) =>
  sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

export async function migrate(db) {
  await db.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((await db.all('SELECT version FROM schema_migrations')).map((r) => Number(r.version)));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    await db.transaction(async (tx) => {
      for (const stmt of splitStatements(m.sql || '')) await tx.run(stmt);
      if (m.run) await m.run(tx);
      await tx.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [m.version, new Date().toISOString()]);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Driver adapters. Both expose the same async API:
//   all(sql, params) -> rows, get(sql, params) -> row | undefined, run(sql, params) -> { changes },
//   transaction(async (tx) => ...) -> result, close()
// params: an array for `?` placeholders, or an object (keys without prefix) for `@name` placeholders.
// ---------------------------------------------------------------------------------------------

const toSqlValue = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const normalizeParams = (params) => {
  if (params == null) return [];
  if (Array.isArray(params)) return params.map(toSqlValue);
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, toSqlValue(v)]));
};

/** Local driver: better-sqlite3 (file or ':memory:'). Used for development and tests. */
async function openBetterSqlite(dbPath) {
  const { default: Database } = await import('better-sqlite3');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const raw = new Database(dbPath);
  if (dbPath !== ':memory:') raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.pragma('busy_timeout = 5000');

  const call = (method, sql, params) => {
    const stmt = raw.prepare(sql);
    const p = normalizeParams(params);
    return Array.isArray(p) ? stmt[method](...p) : stmt[method](p);
  };
  const api = {
    driver: 'better-sqlite3',
    all: async (sql, params) => call('all', sql, params),
    get: async (sql, params) => call('get', sql, params),
    run: async (sql, params) => ({ changes: call('run', sql, params).changes }),
    /**
     * better-sqlite3 is synchronous, so every await inside `fn` resolves without yielding to other requests;
     * BEGIN/COMMIT on the single connection is therefore safe.
     */
    async transaction(fn) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(api);
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        if (raw.inTransaction) raw.exec('ROLLBACK');
        throw err;
      }
    },
    close: async () => raw.close(),
  };
  return api;
}

/** Hosted driver: Turso / libSQL (also accepts a local `file:` URL, used by the tests). */
async function openLibsql(url, authToken) {
  const { createClient } = await import('@libsql/client');
  const client = createClient({ url, ...(authToken ? { authToken } : {}) });
  await client.execute('PRAGMA foreign_keys = ON');

  const wrap = (executor) => {
    const exec = (sql, params) => executor.execute({ sql, args: normalizeParams(params) });
    return {
      all: async (sql, params) => (await exec(sql, params)).rows,
      get: async (sql, params) => (await exec(sql, params)).rows[0],
      run: async (sql, params) => ({ changes: (await exec(sql, params)).rowsAffected }),
    };
  };
  const api = {
    driver: 'libsql',
    ...wrap(client),
    async transaction(fn) {
      const tx = await client.transaction('write');
      try {
        await tx.execute('PRAGMA foreign_keys = ON');
        const out = await fn({ ...wrap(tx), transaction: (inner) => inner(wrap(tx)) });
        await tx.commit();
        return out;
      } catch (err) {
        await tx.rollback().catch(() => {});
        throw err;
      } finally {
        tx.close();
      }
    },
    close: async () => client.close(),
  };
  return api;
}

/**
 * Opens the database and applies migrations.
 * - TURSO_DATABASE_URL set (libsql://… or file:…): libSQL / Turso — used on Vercel.
 * - otherwise: better-sqlite3 at DB_PATH (or ':memory:').
 */
export async function openDatabase({ dbPath, tursoUrl, tursoAuthToken } = {}) {
  const db = tursoUrl ? await openLibsql(tursoUrl, tursoAuthToken) : await openBetterSqlite(dbPath);
  await migrate(db);
  return db;
}
