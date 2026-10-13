// Lists current OpenRouter models useful for this POC so you can pick OPENROUTER_MODEL / OPENROUTER_VISION_MODEL.
// Usage: npm run models:openrouter [-- --search=gemini] [-- --all]
// Never prints the API key.
import { loadConfigFromEnvFile } from '../config/index.js';

const config = loadConfigFromEnvFile();
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const headers = { Accept: 'application/json' };
if (config.openRouter.apiKey) headers.Authorization = `Bearer ${config.openRouter.apiKey}`;

const res = await fetch(`${config.openRouter.baseUrl}/models`, { headers });
if (!res.ok) {
  console.error(`GET /models failed: HTTP ${res.status}`);
  process.exit(1);
}
const { data = [] } = await res.json();
const perM = (v) => (v == null ? '-' : `$${(Number(v) * 1e6).toFixed(3)}`);
const rows = data
  .map((m) => ({
    id: m.id,
    vision: (m.architecture?.input_modalities || []).includes('image'),
    structured: (m.supported_parameters || []).includes('structured_outputs'),
    jsonMode: (m.supported_parameters || []).includes('response_format'),
    ctx: m.context_length,
    prompt: m.pricing?.prompt,
    completion: m.pricing?.completion,
  }))
  .filter((m) => (args.search ? m.id.toLowerCase().includes(String(args.search).toLowerCase()) : true))
  .filter((m) => (args.all ? true : m.structured || m.jsonMode))
  .sort((a, b) => Number(a.prompt ?? 1) - Number(b.prompt ?? 1));

console.log(`${data.length} models listed by OpenRouter; showing ${rows.length}${args.all ? '' : ' with structured outputs or JSON mode'}.\n`);
console.log('id'.padEnd(52), 'vision', 'schema', 'json', 'context'.padStart(9), 'in/1M'.padStart(9), 'out/1M'.padStart(9));
for (const m of rows.slice(0, Number(args.limit || 60))) {
  console.log(
    m.id.padEnd(52),
    (m.vision ? 'yes' : '-').padEnd(6),
    (m.structured ? 'yes' : '-').padEnd(6),
    (m.jsonMode ? 'yes' : '-').padEnd(4),
    String(m.ctx ?? '-').padStart(9),
    perM(m.prompt).padStart(9),
    perM(m.completion).padStart(9),
  );
}
const decisionModels = data.filter((m) => /jev|luna|decision/i.test(m.id)).map((m) => m.id);
console.log(`\nDecision-model slugs present in /models: ${decisionModels.join(', ') || '(none listed; Decisions models may not appear here)'}`);
console.log('\nPick a model with "schema=yes" for OPENROUTER_MODEL, and one with "vision=yes" and "schema=yes" for OPENROUTER_VISION_MODEL.');
console.log('If a model only has json=yes, set OPENROUTER_JSON_MODE=json_object.');
