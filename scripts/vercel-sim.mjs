/*
 * Local approximation of the Vercel deployment, used to test the serverless code path:
 *  - static files from dist/ (like Vercel's CDN), with vercel.json headers and rewrites
 *  - /api/* handled by the exported function in api/index.js, with VERCEL=1 and NODE_ENV=production
 * It does not reproduce cold starts, request-size limits or Turso's network protocol.
 *
 *   TURSO_DATABASE_URL=file:/tmp/fs.db FLOODSENSE_SECRET=... node scripts/vercel-sim.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VERCEL = '1';
process.env.NODE_ENV = 'production';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const { default: handler } = await import('../api/index.js');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.gz': 'application/gzip' };
const toRe = (src) => new RegExp(`^${src.replace(/\(\.\*\)/g, '(.*)')}$`);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  for (const h of vercel.headers) if (toRe(h.source).test(url.pathname)) for (const { key, value } of h.headers) res.setHeader(key, value);
  const file = path.join(dist, decodeURIComponent(url.pathname));
  if (file.startsWith(dist) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    return fs.createReadStream(file).pipe(res);
  }
  const rule = vercel.rewrites.find((r) => toRe(r.source).test(url.pathname));
  if (rule?.destination === '/api') return handler(req, res); // Vercel keeps the original URL
  if (rule?.destination === '/index.html') { res.setHeader('Content-Type', 'text/html'); return fs.createReadStream(path.join(dist, 'index.html')).pipe(res); }
  res.statusCode = 404;
  res.end('Not found');
}).listen(Number(process.env.PORT) || 3000, () => console.log(`Vercel simulation on http://localhost:${process.env.PORT || 3000}`));
