/*
 * Read-only health check of a deployed FloodSense site. Changes nothing.
 *   node scripts/check-live.mjs https://your-project.vercel.app
 */
const BASE = (process.argv[2] || '').replace(/\/$/, '');
if (!BASE) { console.error('Usage: node scripts/check-live.mjs https://your-project.vercel.app'); process.exit(2); }

let failed = 0;
async function check(name, fn) {
  try { const note = await fn(); console.log(`  ✓ ${name}${note ? ` — ${note}` : ''}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}
const get = async (p) => {
  const t = Date.now();
  const r = await fetch(BASE + p, { redirect: 'manual' });
  r.ms = Date.now() - t;
  return r;
};
const json = async (p) => {
  const r = await get(p);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = null; }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  if (!body) throw new Error(`not JSON: ${text.slice(0, 120)}`);
  return { body, ms: r.ms, headers: r.headers };
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log(`\nChecking ${BASE}\n\nAPI (serverless function + Turso)`);
await check('/api/health responds (database reachable)', async () => {
  const { body, ms } = await json('/api/health');
  assert(body.ok === true, JSON.stringify(body));
  return `${body.reports} reports in database, ${ms} ms`;
});
await check('public reports list', async () => {
  const { body } = await json('/api/reports');
  const raw = JSON.stringify(body);
  assert(!/contact_|ip_hash/.test(raw), 'private fields exposed');
  return `${body.reports.length} public (pending + verified)`;
});
await check('dashboard statistics', async () => {
  const { body } = await json('/api/stats?include_demo=1');
  return `pending ${body.status.pending}, verified ${body.status.verified}, demo ${body.demo_count}`;
});
await check('form token issued (FLOODSENSE_SECRET set)', async () => {
  const { body } = await json('/api/reports/form-token');
  assert(/^[a-z0-9]+\.[\w-]{22}$/.test(body.token), 'unexpected token format');
});
await check('GIS context lookup at Abeokuta', async () => {
  const { body } = await json('/api/context?lat=7.155&lon=3.345');
  assert(body.inside && body.lga, 'point not resolved inside Ogun');
  return `${body.lga.name}, class ${body.grid?.cls}`;
});
await check('admin API requires sign-in', async () => {
  const r = await get('/api/admin/reports');
  assert(r.status === 401, `expected 401, got ${r.status}`);
});
await check('no user signed in for an anonymous request', async () => {
  const { body } = await json('/api/auth/me');
  assert(body.user === null, JSON.stringify(body));
});

console.log('\nStatic site and GIS data (CDN)');
await check('home page', async () => {
  const r = await get('/');
  const html = await r.text();
  assert(r.status === 200 && /FloodSense/.test(html) && /\/assets\/index-/.test(html), `HTTP ${r.status}`);
  const csp = r.headers.get('content-security-policy');
  assert(csp && csp.includes("frame-ancestors 'none'"), 'security headers missing');
  return 'HTML + security headers OK';
});
await check('deep link /insights serves the app', async () => {
  const r = await get('/insights');
  assert(r.status === 200 && /\/assets\/index-/.test(await r.text()), `HTTP ${r.status}`);
});
for (const f of ['grid.json', 'model.json', 'lgas.geojson', 'drainage.geojson', 'grid-core.bin.gz', 'grid-detail.bin.gz', 'dem/8/129/123.png']) {
  await check(`/data/${f}`, async () => {
    const r = await get(`/data/${f}`);
    assert(r.status === 200, `HTTP ${r.status}`);
    const n = (await r.arrayBuffer()).byteLength;
    assert(n > 100, 'empty file');
    return `${(n / 1024).toFixed(0)} KB`;
  });
}
await check('missing data file returns 404 (not the app page)', async () => {
  const r = await get('/data/does-not-exist.png');
  assert(r.status === 404, `HTTP ${r.status}`);
});

console.log(failed ? `\n${failed} check(s) failed — paste this output to get help.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
