import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(__dirname, '../..');

const bool = (def) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      if (typeof v === 'boolean') return v;
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    });

const optStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

const num = (def, schema = z.number()) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(schema);

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: num(4000, z.number().int().positive()),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DB_PATH: z.string().default('data/triage.db'),
  UPLOAD_DIR: z.string().default('data/uploads'),
  // Vercel functions accept request bodies up to 4.5 MB, so uploads default to 4 MB.
  MAX_UPLOAD_MB: num(4, z.number().positive().max(20)),
  // Hosted storage (used on Vercel). Without these, the local SQLite file and upload folder are used.
  TURSO_DATABASE_URL: optStr,
  TURSO_AUTH_TOKEN: optStr,
  BLOB_READ_WRITE_TOKEN: optStr,
  VERCEL: optStr,
  JSON_BODY_LIMIT: z.string().default('1mb'),

  TEXT_PROVIDER: z.enum(['jev', 'luna', 'openrouter_llm']).default('jev'),

  OPENROUTER_API_KEY: optStr,
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  // Verified in OpenRouter's Jev guide; the API reference's server+path pairing is ambiguous, so it is configurable.
  OPENROUTER_DECISIONS_URL: z.string().url().default('https://openrouter.ai/api/alpha/decisions'),
  OPENROUTER_APP_URL: optStr,
  OPENROUTER_APP_TITLE: z.string().default('Support Triage POC'),
  OPENROUTER_MODEL: optStr,
  OPENROUTER_VISION_MODEL: optStr,
  OPENROUTER_JSON_MODE: z.enum(['json_schema', 'json_object']).default('json_schema'),
  OPENROUTER_MAX_TOKENS: num(1500, z.number().int().positive()),
  OPENROUTER_JEV_MODEL: z.string().default('typesafe/jev-1.13'),
  OPENROUTER_LUNA_MODEL: z.string().default('openai/gpt-6-luna-decisions'),
  // Image input for Luna through OpenRouter is undocumented; enable only after `npm run probe:decisions` confirms it.
  // state_parts: chat-style {type:'image_url'} parts; state_input_image: OpenAI-native {type:'input_image'} parts.
  LUNA_IMAGE_MODE: z.enum(['off', 'state_parts', 'state_input_image']).default('off'),

  PROVIDER_TIMEOUT_MS: num(20000, z.number().int().positive()),
  PROVIDER_VISION_TIMEOUT_MS: num(45000, z.number().int().positive()),
  PROVIDER_MAX_RETRIES: num(2, z.number().int().min(0).max(5)),
  PROVIDER_RETRY_BASE_MS: num(500, z.number().int().min(0)),
  PROVIDER_RETRY_AFTER_CAP_MS: num(5000, z.number().int().min(0)),
  MAX_LOG_CHARS_TO_PROVIDER: num(4000, z.number().int().positive()),

  // Demonstration thresholds, not validated production values.
  SLA_BREACH_PROBABILITY_THRESHOLD: num(0.85, z.number().min(0).max(1)),
  SLA_CRITICAL_SEVERITY: num(5, z.number().int().min(1).max(5)),
  SLA_URGENT_DEADLINE_MINUTES: num(5, z.number()),
  SLA_TRUST_VENDOR_CALIBRATION: bool(false),
  LOW_CONFIDENCE_THRESHOLD: num(0.5, z.number().min(0).max(1)),
  LUNA_PREDICATE_DECISION_THRESHOLD: num(0.5, z.number().min(0).max(1)),
  REVIEW_SIGNAL_THRESHOLD: num(0.5, z.number().min(0).max(1)),
});

function resolvePath(p) {
  if (p === ':memory:') return p;
  return path.isAbsolute(p) ? p : path.resolve(BACKEND_ROOT, p);
}

/** Builds a validated config object from an env-like map. Pure: does not read .env itself. */
export function loadConfig(env = process.env) {
  const e = envSchema.parse(env);
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    corsOrigin: e.CORS_ORIGIN,
    // On Vercel the deployment folder is read-only; without Turso/Blob, fall back to /tmp (data is not kept).
    dbPath: e.VERCEL && !e.TURSO_DATABASE_URL ? '/tmp/triage.db' : resolvePath(e.DB_PATH),
    uploadDir: e.VERCEL && !e.BLOB_READ_WRITE_TOKEN ? '/tmp/uploads' : resolvePath(e.UPLOAD_DIR),
    tursoUrl: e.TURSO_DATABASE_URL,
    tursoAuthToken: e.TURSO_AUTH_TOKEN,
    blobToken: e.BLOB_READ_WRITE_TOKEN,
    onVercel: !!e.VERCEL,
    maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
    jsonBodyLimit: e.JSON_BODY_LIMIT,
    textProvider: e.TEXT_PROVIDER,
    openRouter: {
      apiKey: e.OPENROUTER_API_KEY,
      baseUrl: e.OPENROUTER_BASE_URL.replace(/\/$/, ''),
      decisionsUrl: e.OPENROUTER_DECISIONS_URL,
      appUrl: e.OPENROUTER_APP_URL,
      appTitle: e.OPENROUTER_APP_TITLE,
      llmModel: e.OPENROUTER_MODEL,
      visionModel: e.OPENROUTER_VISION_MODEL,
      jsonMode: e.OPENROUTER_JSON_MODE,
      maxTokens: e.OPENROUTER_MAX_TOKENS,
      jevModel: e.OPENROUTER_JEV_MODEL,
      lunaModel: e.OPENROUTER_LUNA_MODEL,
      lunaImageMode: e.LUNA_IMAGE_MODE,
    },
    http: {
      timeoutMs: e.PROVIDER_TIMEOUT_MS,
      visionTimeoutMs: e.PROVIDER_VISION_TIMEOUT_MS,
      maxRetries: e.PROVIDER_MAX_RETRIES,
      retryBaseMs: e.PROVIDER_RETRY_BASE_MS,
      retryAfterCapMs: e.PROVIDER_RETRY_AFTER_CAP_MS,
    },
    maxLogCharsToProvider: e.MAX_LOG_CHARS_TO_PROVIDER,
    policy: {
      breachProbabilityThreshold: e.SLA_BREACH_PROBABILITY_THRESHOLD,
      criticalSeverity: e.SLA_CRITICAL_SEVERITY,
      urgentDeadlineMinutes: e.SLA_URGENT_DEADLINE_MINUTES,
      trustVendorCalibration: e.SLA_TRUST_VENDOR_CALIBRATION,
      lowConfidenceThreshold: e.LOW_CONFIDENCE_THRESHOLD,
      reviewSignalThreshold: e.REVIEW_SIGNAL_THRESHOLD,
    },
    lunaPredicateThreshold: e.LUNA_PREDICATE_DECISION_THRESHOLD,
  };
}

/** Loads backend/.env (never in tests) and returns the validated config. */
export function loadConfigFromEnvFile() {
  if (process.env.NODE_ENV !== 'test') {
    dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });
  }
  return loadConfig(process.env);
}
