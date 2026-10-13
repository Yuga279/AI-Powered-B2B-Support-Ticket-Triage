// Vercel entry point for the backend service (see ../../vercel.json). Vercel routes /api/*, /health and
// /api-docs here with the original path, so Express routes them as usual. Settings come from Vercel env vars.
import { loadConfig } from './config/index.js';
import { bootstrap } from './bootstrap.js';

let ready;

export default async function handler(req, res) {
  ready ??= bootstrap(loadConfig(process.env)).catch((err) => {
    ready = undefined; // retry initialisation on the next request
    throw err;
  });
  const { app } = await ready;
  return app(req, res);
}
