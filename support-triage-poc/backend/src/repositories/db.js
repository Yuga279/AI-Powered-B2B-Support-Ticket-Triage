import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

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
  run(db) {
    for (const [table, column] of DROPPED_COLUMNS) {
      const exists = db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
      if (exists) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
    db.exec("UPDATE escalations SET status = 'recorded' WHERE status = 'simulated_sent'");
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

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      if (m.sql) db.exec(m.sql);
      if (m.run) m.run(db);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(m.version, new Date().toISOString());
    })();
  }
}

/** Opens (or creates) the SQLite database and applies migrations. Pass ':memory:' for tests. */
export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}
