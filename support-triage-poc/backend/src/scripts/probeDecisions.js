// Live probe of OpenRouter's Decisions endpoint for Jev and Luna, plus a Luna image-input check.
// Usage: npm run probe:decisions          Costs a fraction of a cent. Never prints the API key.
import { loadConfigFromEnvFile } from '../config/index.js';
import { openRouterHeaders } from '../providers/openRouterCommon.js';
import { buildImageState } from '../providers/lunaProvider.js';
import { makeDemoPng } from '../utils/png.js';

const config = loadConfigFromEnvFile();
const or = config.openRouter;
if (!or.apiKey) {
  console.error('OPENROUTER_API_KEY is not set in backend/.env');
  process.exit(1);
}
const headers = { ...openRouterHeaders(or), 'Content-Type': 'application/json', Accept: 'application/json' };

async function post(url, body) {
  const started = Date.now();
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text: text.slice(0, 400), ms: Date.now() - started };
  } catch (err) {
    return { status: 0, json: null, text: err.message, ms: Date.now() - started };
  }
}

const textQuestion = {
  is_billing: {
    type: 'noul',
    instructions: 'Is this support ticket about billing or invoices?',
    criteria: { true: 'It is about billing.', false: 'It is not about billing.' },
  },
};
const textState = { subject: 'Charged twice for my subscription', description: 'Please refund the duplicate invoice.' };

// 1. Find a working Decisions URL.
const candidates = [...new Set([or.decisionsUrl, 'https://openrouter.ai/api/alpha/decisions', 'https://openrouter.ai/api/v1/alpha/decisions'])];
let workingUrl = null;
console.log('== Decisions endpoint ==');
for (const url of candidates) {
  const r = await post(url, { model: or.jevModel, state: textState, questions: textQuestion });
  console.log(`${url} -> HTTP ${r.status} (${r.ms} ms) ${r.json?.answers ? JSON.stringify(r.json.answers) : r.text}`);
  if (r.status === 200 && r.json?.answers && !r.json.error) {
    workingUrl = url;
    break;
  }
}
if (!workingUrl) {
  console.log('\nNo Decisions URL worked. Check the key, credits, and OpenRouter docs; set OPENROUTER_DECISIONS_URL.');
  process.exit(2);
}
if (workingUrl !== or.decisionsUrl) console.log(`\n>> Set OPENROUTER_DECISIONS_URL=${workingUrl}`);

// 2. Each model with the text question.
console.log('\n== Models (text) ==');
for (const model of [or.jevModel, or.lunaModel]) {
  const r = await post(workingUrl, { model, state: textState, questions: textQuestion });
  console.log(
    `${model} -> HTTP ${r.status} (${r.ms} ms) model=${r.json?.model ?? '-'} provider=${r.json?.provider ?? '-'} ` +
      `answers=${r.json?.answers ? JSON.stringify(r.json.answers) : r.text} cost=${r.json?.usage?.cost ?? '-'}`,
  );
}

// 3. Luna image input: two images with different button colours; image mode works only if both are answered correctly.
console.log('\n== Luna image input ==');
const colours = { red: [220, 38, 38], blue: [37, 99, 235] };
const colourQuestion = {
  button_colour: {
    type: 'choice',
    instructions: 'What is the colour of the large button in the attached screenshot?',
    criteria: { red: 'The button is red.', blue: 'The button is blue.', green: 'The button is green.', no_image: 'No image is visible.' },
  },
};
const results = {};
for (const mode of ['state_parts', 'state_input_image']) {
  let correct = 0;
  for (const [name, rgb] of Object.entries(colours)) {
    const img = { dataUrl: `data:image/png;base64,${makeDemoPng(160, 96, rgb).toString('base64')}` };
    const state = buildImageState({ note: 'Look at the screenshot.' }, [img], mode);
    const r = await post(workingUrl, { model: or.lunaModel, state, questions: colourQuestion });
    const ans = r.json?.answers?.button_colour;
    if (ans?.choice === name) correct++;
    console.log(`${mode} [${name} button] -> HTTP ${r.status} (${r.ms} ms) ${ans ? JSON.stringify(ans) : r.text}`);
  }
  results[mode] = correct === Object.keys(colours).length;
}
const workingMode = Object.entries(results).find(([, ok]) => ok)?.[0];
console.log(
  workingMode
    ? `\n>> Luna image input works with LUNA_IMAGE_MODE=${workingMode}`
    : '\n>> Luna image input not confirmed: keep LUNA_IMAGE_MODE=off (screenshots route to OPENROUTER_VISION_MODEL).',
);
