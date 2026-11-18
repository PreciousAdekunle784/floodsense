/*
 * FloodSense end-to-end test.
 * Starts an isolated server (temporary database + uploads), then drives the real UI with Playwright:
 * map → inspect → search → report (with an EXIF-tagged photo) → public privacy checks → admin login →
 * CSRF / auth checks → verify → dashboard update → refresh persistence → spam safeguards → mobile layout.
 *
 *   npm run build && npm run e2e
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8099;
const BASE = `http://localhost:${PORT}`;
const EMAIL = 'e2e-admin@floodsense.local';
const PASSWORD = 'e2e-password-123';
const OUT = process.env.E2E_OUT || path.join(root, 'test-results');
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
const failures = [];
let current = null;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) {
    failures.push(name); console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
    if (current) await current.screenshot({ path: path.join(OUT, `fail-${failures.length}.png`) }).catch(() => {});
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'floodsense-e2e-'));
const sim = !!process.env.E2E_SERVER;
const env = { ...process.env, TURSO_DATABASE_URL: sim ? `file:${path.join(dataDir, 'turso-sim.db')}` : '', TURSO_AUTH_TOKEN: '', FLOODSENSE_SECRET: sim ? 'e2e-simulated-vercel-secret-0123456789' : '', FLOODSENSE_DATA_DIR: dataDir, PORT: String(PORT), FLOODSENSE_ADMIN_EMAIL: EMAIL, FLOODSENSE_ADMIN_PASSWORD: PASSWORD, FLOODSENSE_ADMIN_NAME: 'E2E Verifier' };
spawnSync(process.execPath, ['server/setup.js'], { cwd: root, env, stdio: 'ignore' });
// E2E_SERVER lets the suite run against another entry point (e.g. scripts/vercel-sim.mjs)
const server = spawn(process.execPath, [process.env.E2E_SERVER || 'server/index.js'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 200)); }

const browser = await chromium.launch();
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/tile\.openstreetmap|arcgisonline|ERR_TUNNEL|net::/.test(m.text())) errors.push(`${label}: ${m.text().slice(0, 160)}`); });
};
const api = async (p, opts) => { const r = await fetch(`${BASE}/api${p}`, opts); return { status: r.status, body: await r.json().catch(() => null) }; };

let ref;
const before = (await api('/stats?include_demo=0')).body;
try {
  console.log('\nDesktop journey');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  current = page;
  watch(page, 'desktop');
  await page.goto(BASE, { waitUntil: 'networkidle' });

  await check('map canvas and GIS layers load', async () => {
    await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('.lga-label').length === 20, null, { timeout: 30000 });
  });
  await check('overview shows model-derived statistics', async () => {
    const t = await page.textContent('.inspector');
    assert(/High or Very-high/.test(t) && /km²/.test(t), 'overview KPIs missing');
  });
  await check('clicking the map inspects a location (class, factors, guidance)', async () => {
    await page.mouse.click(640, 520);
    await page.waitForSelector('text=Location analysis', { timeout: 5000 });
    await page.waitForSelector('.class-hero .class-chip');
    const t = await page.textContent('.inspector');
    assert(/Height above drainage/.test(t) && /LGA/.test(t) && /Preparedness/.test(t), 'inspector content incomplete');
  });
  await check('layer toggle switches observed-water layer on', async () => {
    await page.click('text=Observed surface water');
    await page.waitForSelector('text=Water seen at least occasionally');
  });
  await check('search finds an LGA and opens its profile', async () => {
    await page.fill('.map-ui-left input[aria-label="Search places"]', 'Ifo');
    await page.click('.search-results li:has-text("LGA")');
    await page.waitForSelector('.inspector h2:has-text("Ifo")');
    await page.waitForSelector('text=Average monthly rainfall');
  });

  console.log('\nCommunity reporting');
  await check('report form validates required fields', async () => {
    await page.click('.report-cta');
    await page.waitForSelector('.report-flow');
    await page.click('.flow-actions .btn-accent');
    await page.waitForSelector('.field-error');
  });
  await check('report can be submitted end-to-end with a photo', async () => {
    await page.mouse.click(560, 560); // drop pin inside Ogun State
    await page.waitForSelector('.loc-card b:has-text("LGA")');
    await page.fill('input[placeholder^="e.g. near"]', 'E2E test street');
    await page.click('.flow-actions .btn-accent');
    await page.click('.sev-2');
    await page.fill('textarea', 'E2E test: water across the road, knee deep near the bridge.');
    await page.click('.flow-actions .btn-accent');
    await page.setInputFiles('input[type=file]', path.join(root, 'tests/fixtures/flood-with-exif.jpg'));
    await page.waitForSelector('.photo-preview img');
    await page.fill('input[autocomplete="name"]', 'Test Reporter');
    await page.fill('input[autocomplete="tel"]', '+234 800 000 0000');
    // contact given without consent: the step must not advance
    await page.click('.flow-actions .btn-accent');
    await page.waitForSelector('text=Tick the consent box');
    await page.check('text=I agree that FloodSense verifiers may contact me');
    await page.click('.flow-actions .btn-accent');
    await page.waitForTimeout(4500); // server enforces a minimum human fill time
    await page.click('.flow-actions .btn-accent:has-text("Send report")');
    await page.waitForSelector('.ref-code', { timeout: 10000 });
    ref = (await page.textContent('.ref-code')).trim();
    assert(/^FS-[A-Z0-9]{6}$/.test(ref), `bad ref ${ref}`);
  });
  await check('new report is public as pending, with text hidden and location coarsened', async () => {
    const { body } = await api('/reports?include_demo=0');
    const r = body.reports.find((x) => x.ref === ref);
    assert(r, 'report not in public list');
    assert(r.status === 'pending' && r.description === null && r.has_photo === false && r.precision_m === 110, 'pending report leaks detail');
    const raw = JSON.stringify(body);
    assert(!/contact|ip_hash|Test Reporter|\+234/.test(raw), 'private fields exposed publicly');
  });
  await check('unverified photo is not publicly accessible', async () => {
    const r = await fetch(`${BASE}/api/reports/${ref}/photo`);
    assert(r.status === 404, `expected 404, got ${r.status}`);
  });
  await check('reporter can track status by reference', async () => {
    await page.click('text=Track status');
    await page.waitForSelector('.status-chip:has-text("Pending verification")');
  });

  console.log('\nVerification (admin)');
  await check('admin API rejects unauthenticated requests', async () => {
    assert((await api('/admin/reports')).status === 401, 'expected 401');
  });
  await check('wrong password is refused', async () => {
    const r = await api('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: 'nope-nope-nope' }) });
    assert(r.status === 401, `expected 401 got ${r.status}`);
  });
  await check('verifier signs in and sees the new report with contact details', async () => {
    await page.goto(`${BASE}/admin`);
    await page.fill('input[type=email]', EMAIL);
    await page.fill('input[type=password]', PASSWORD);
    await page.click('button:has-text("Sign in")');
    await page.click(`.queue-list button:has-text("${ref}")`);
    await page.waitForSelector('text=GIS consistency check');
    await page.waitForSelector('.contact-box:has-text("Test Reporter")');
  });
  await check('state-changing admin request without CSRF token is refused', async () => {
    const cookies = await ctx.cookies();
    const c = cookies.find((x) => x.name === 'fs_session');
    assert(c && c.httpOnly && c.sameSite === 'Strict', 'session cookie must be HttpOnly + SameSite=Strict');
    const r = await api('/admin/reports/1/review', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `fs_session=${c.value}` }, body: JSON.stringify({ action: 'verify' }) });
    assert(r.status === 403, `expected 403 got ${r.status}`);
  });
  await check('rejecting requires a reason', async () => {
    assert(await page.isDisabled('.actions .btn-crit'), 'reject should be disabled without note');
  });
  await check('verifier verifies the report', async () => {
    await page.fill('.actions textarea', 'E2E: photo shows standing water; consistent with terrain.');
    await page.click('.actions .btn-good');
    await page.waitForSelector('.admin-detail .status-chip:has-text("Verified")', { timeout: 8000 });
    await page.waitForSelector('.timeline li:has-text("verify")');
  });
  await check('verified report is published with text and a metadata-free photo', async () => {
    const { body } = await api('/reports?include_demo=0');
    const r = body.reports.find((x) => x.ref === ref);
    assert(r.status === 'verified' && /knee deep/.test(r.description) && r.has_photo, 'verified report incomplete');
    const img = Buffer.from(await (await fetch(`${BASE}/api/reports/${ref}/photo`)).arrayBuffer());
    assert(img[0] === 0xff && img[1] === 0xd8, 'photo is not a JPEG');
    assert(!img.includes(Buffer.from('Exif')) && !img.includes(Buffer.from('FloodSenseTestDevice')), 'EXIF metadata survived');
  });
  await check('dashboard statistics update from the database', async () => {
    const after = (await api('/stats?include_demo=0')).body;
    assert(after.total === before.total + 1 && after.status.verified === before.status.verified + 1, 'stats did not update');
    await page.goto(`${BASE}/insights`);
    await page.uncheck('text=Include synthetic demo reports');
    await page.waitForSelector('.stat:has-text("Verified incidents") .v:text-is("1")', { timeout: 8000 });
  });
  await check('session and data persist after a page refresh', async () => {
    await page.goto(`${BASE}/admin`);
    await page.reload();
    await page.waitForSelector('text=Verification console');
    await page.click('.seg button:has-text("Verified")');
    await page.waitForSelector(`.queue-list button:has-text("${ref}")`);
  });
  await check('model page recomputes a scenario in the browser', async () => {
    await page.goto(`${BASE}/model`);
    await page.click('button:has-text("Equal")');
    await page.click('button:has-text("Apply scenario to map")');
    await page.waitForSelector('text=Scenario: Equal importance');
  });
  await ctx.close();

  console.log('\nSafeguards (API)');
  const tok = (await api('/reports/form-token')).body.token;
  const form = (extra) => { const f = new FormData(); const base = { lat: '7.0', lon: '3.4', severity: '2', description: 'Water over the road near the junction.', observed_at: new Date().toISOString(), form_token: tok, ...extra }; for (const [k, v] of Object.entries(base)) f.append(k, v); return f; };
  await check('submissions faster than a human are refused', async () => {
    const r = await api('/reports', { method: 'POST', body: form({}) });
    assert(r.status === 429, `expected 429 got ${r.status}`);
  });
  await new Promise((r) => setTimeout(r, 4200));
  await check('honeypot field rejects bots', async () => {
    assert((await api('/reports', { method: 'POST', body: form({ website: 'spam.example' }) })).status === 400, 'honeypot not enforced');
  });
  await check('forged form token is refused', async () => {
    assert((await api('/reports', { method: 'POST', body: form({ form_token: 'abc.def' }) })).status === 400, 'token not enforced');
  });
  await check('locations outside Ogun State are refused', async () => {
    const r = await api('/reports', { method: 'POST', body: form({ lat: '9.07', lon: '7.49' }) });
    assert(r.status === 422 && /outside Ogun/.test(r.body.error), 'pilot boundary not enforced');
  });
  await check('future observation time is refused', async () => {
    const r = await api('/reports', { method: 'POST', body: form({ observed_at: new Date(Date.now() + 864e5).toISOString() }) });
    assert(r.status === 422 && r.body.fields.observed_at, 'future time accepted');
  });
  await check('non-image upload is refused', async () => {
    const f = form({});
    f.append('photo', new Blob(['<script>alert(1)</script>'], { type: 'image/jpeg' }), 'x.jpg');
    const r = await api('/reports', { method: 'POST', body: f });
    assert(r.status === 422, `expected 422 got ${r.status}`);
  });

  console.log('\nMobile (Pixel 7)');
  const m = await browser.newContext({ ...devices['Pixel 7'] });
  const mp = await m.newPage();
  current = mp;
  watch(mp, 'mobile');
  await check('mobile map with bottom navigation and sheet', async () => {
    await mp.goto(BASE, { waitUntil: 'networkidle' });
    await mp.waitForSelector('.mobilenav');
    await mp.waitForFunction(() => document.querySelectorAll('.lga-label').length === 20, null, { timeout: 30000 });
    await mp.waitForTimeout(1500);
    await mp.screenshot({ path: path.join(OUT, 'mobile-map.png') });
  });
  await check('mobile report flow opens from bottom nav', async () => {
    await mp.click('.mobilenav a:has-text("Report")');
    await mp.waitForSelector('.report-flow .stepper');
    await mp.waitForTimeout(1500);
    await mp.touchscreen.tap(206, 200);
    await mp.waitForSelector('.loc-card b');
    await mp.screenshot({ path: path.join(OUT, 'mobile-report.png') });
  });
  await check('no horizontal overflow on mobile pages', async () => {
    for (const p of ['/insights', '/model', '/sources', '/prepare']) {
      await mp.goto(BASE + p, { waitUntil: 'networkidle' });
      const over = await mp.evaluate(() => { const el = document.querySelector('.page'); return el ? el.scrollWidth - el.clientWidth : 0; });
      assert(over <= 1, `${p} overflows by ${over}px`);
    }
    await mp.screenshot({ path: path.join(OUT, 'mobile-prepare.png') });
  });
  await m.close();

  await check('no JavaScript errors in the console', async () => {
    assert(errors.length === 0, errors.slice(0, 5).join(' | '));
  });
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? `: ${failures.join('; ')}` : ''}`);
process.exit(failures.length ? 1 : 0);
