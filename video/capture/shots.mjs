/*
 * Shot choreography for the FloodSense demo. Every shot drives the real, running application.
 *   node video/capture/shots.mjs [shotId ...]     (default: all app shots, in story order)
 * Requires the app on BASE (default http://localhost:8095) with a freshly seeded demo database.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { BUILD, FPS, H, OVERLAY_SCRIPT, ROOT, Shot, W, clamp01, cue, ease, easeSine } from './lib.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8095';
const EMAIL = process.env.CAP_EMAIL || 'verifier@floodsense.local';
const PASSWORD = process.env.CAP_PASSWORD || 'capture-password-2026';
const STATE = path.join(BUILD, 'capture-state.json');
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const saveState = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 1));

// The resident's report location: beside the Ogun River in Ifo LGA (Very-high class in the model)
const INSPECT = { lat: 6.7921, lon: 3.3424 };
const REPORT_AT = { lat: 6.7934, lon: 3.3446 };

const HIDE_UI = `.topbar,.map-ui-left,.side-panel,.mobilenav,.maplibregl-control-container,.lga-label,.place-label{display:none!important}`;

async function open(page, url) {
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__cap, null, { timeout: 20000 });
}
async function waitMap(page, labels = true) {
  await page.waitForFunction((l) => window.__fsMaps?.length && (!l || document.querySelectorAll('.lga-label').length === 20), labels, { timeout: 90000 });
}
const toggle = (page, label) => page.locator('.layer-toggle', { hasText: label }).first();
async function setToggle(page, label, on) {
  const t = toggle(page, label);
  const isOn = await t.evaluate((e) => e.classList.contains('on'));
  if (isOn !== on) await t.click();
}
async function hideUi(page) {
  await page.addStyleTag({ content: HIDE_UI });
  await page.evaluate(() => window.__fsMaps.forEach((m) => m.resize()));
}
const lowerThird = (e, t, s) => `<div class="cap-lt"><div class="e">${e}</div><div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
async function fadeLowerThird(shot, id, html, css, at, len = 12) {
  // call inside animate loops: returns opacity for current time
  return { id, html, css, at, len };
}
/** Opacity envelope: fade in at `a`, out at `b` (seconds), `f` frames. */
const env = (t, a, b = 1e9, f = 0.4) => Math.min(clamp01((t - a) / f), clamp01((b - t) / f));

// ======================================================================= shots
const SHOTS = {
  // ---------------------------------------------------------------- 1. opening terrain b-roll
  async s1_terrain(page) {
    await open(page, '/');
    await waitMap(page);
    await setToggle(page, 'Flood susceptibility', false);
    await setToggle(page, 'Flood reports', false);
    await setToggle(page, 'Observed surface water', true);
    await setToggle(page, 'Elevation', true);
    await setToggle(page, 'Towns', false);
    await setToggle(page, 'LGA boundaries', false);
    await setToggle(page, '3D terrain', true);
    await hideUi(page);
    await page.evaluate(() => { const m = window.__fsMaps.at(-1); m.setPaintProperty('relief', 'color-relief-opacity', 0.55); m.setPaintProperty('hillshade', 'hillshade-exaggeration', 0.8); });
    const shot = new Shot(page, 's1_terrain');
    await shot.jump({ center: [3.31, 7.03], zoom: 10.35, pitch: 70, bearing: -32 });
    await page.evaluate(() => window.__cap.vignette(true));
    const T = shot.total;
    const tag = `<div class="cap-tag">Ogun River valley</div><div class="cap-note" style="margin-top:8px">Ogun State, Nigeria · 7.0°N 3.3°E · Copernicus DEM, terrain ×2.2</div>`;
    const from = { center: [3.31, 7.03], zoom: 10.35, pitch: 70, bearing: -32 };
    const to = { center: [3.35, 6.90], zoom: 10.8, pitch: 72, bearing: -6 };
    for (let i = 0; i < T; i++) {
      const p = easeSine(i / (T - 1));
      const t = i / FPS;
      await shot.jump({ center: [from.center[0] + (to.center[0] - from.center[0]) * p, from.center[1] + (to.center[1] - from.center[1]) * p], zoom: from.zoom + (to.zoom - from.zoom) * p, pitch: from.pitch + (to.pitch - from.pitch) * p, bearing: from.bearing + (to.bearing - from.bearing) * p });
      await page.evaluate(([tt]) => window.__cap.rain(tt, 0.9), [t]);
      await shot.overlay('tag', tag, { left: '72px', bottom: '64px' }, env(t, 1.0, shot.total / FPS - 0.2, 0.8));
      await shot.snap();
    }
    await page.evaluate(() => { window.__cap.rain(0, 0); window.__cap.vignette(false); window.__cap.clear(); });
    await shot.finish();
  },

  // ---------------------------------------------------------------- 3a. map overview
  async s3_overview(page) {
    await open(page, '/');
    await waitMap(page);
    const shot = new Shot(page, 's3_overview');
    // frame the state in the area left clear by the side panels and the lower third
    const cam = await page.evaluate(() => { const m = window.__fsMaps.at(-1); const c = m.cameraForBounds([[2.70, 6.30], [4.61, 7.95]], { padding: { left: 350, right: 430, top: 30, bottom: 190 } }); return { center: [c.center.lng, c.center.lat], zoom: c.zoom }; });
    const z0 = cam.zoom - 0.04;
    const lt = lowerThird('Module A · Geospatial map', 'All 20 LGAs of Ogun State', 'Copernicus DEM · ESA WorldCover · NASA GPM IMERG · JRC Global Surface Water');
    const T = shot.total;
    for (let i = 0; i < T; i++) {
      const t = i / FPS;
      await shot.jump({ center: cam.center, zoom: z0 + 0.1 * easeSine(i / (T - 1)) });
      await shot.overlay('lt', lt, { left: '356px', bottom: '44px' }, env(t, 0.6, T / FPS - 0.5));
      if (t > 4.6 && !shot.cur.vis) await shot.setCursor(980, 640, true, false);
      if (shot.cur.vis) await shot.setCursor(980 + (520 - 980) * ease(clamp01((t - 4.6) / 2)), 640 + (300 - 640) * ease(clamp01((t - 4.6) / 2)), true);
      await shot.snap();
    }
    await shot.finish();
  },

  // ---------------------------------------------------------------- 3b. terrain + drainage
  async s3_layers(page) {
    const shot = new Shot(page, 's3_layers');
    await shot.setCursor(520, 300, true);
    await shot.clickEl(toggle(page, 'Flood susceptibility').locator('.switch'));
    await shot.clickEl(toggle(page, 'Elevation').locator('.switch'));
    await shot.snap(6);
    const lt = lowerThird('Terrain & drainage', 'Water follows the terrain', 'D8 flow routing on the Copernicus DEM · 2,292 channels ordered by Strahler stream order');
    await shot.overlay('lt', lt, { left: '356px', bottom: '44px' }, 0);
    await shot.moveTo(1300, 760, 14);
    await shot.setCursor(1300, 760, false);
    let k = 0;
    await shot.fly({ center: [3.33, 7.06], zoom: 9.35 }, 75, { easing: ease });
    const rest = shot.total - shot.n;
    await shot.animate(rest, async (i) => { k = i; await shot.overlay('lt', null, null, env(i / FPS, 0, rest / FPS - 0.3)); });
    void k;
    await page.evaluate(() => window.__cap.clear());
    await shot.finish();
  },

  // ---------------------------------------------------------------- 3c. the model
  async s3_model(page) {
    const shot = new Shot(page, 's3_model');
    await shot.setCursor(1300, 760, true);
    await shot.clickEl(toggle(page, 'Elevation').locator('.switch'));
    await shot.clickEl(toggle(page, 'Flood susceptibility').locator('.switch'));
    const factors = [
      ['Height above drainage', '35.5%', 'Height above the nearest stream'],
      ['Distance to channel', '21.8%', 'distance to a channel'],
      ['Slope', '12.0%', 'slope'],
      ['Wetness index', '12.0%', 'wetness'],
      ['Rainfall', '6.8%', 'rainfall'],
      ['Land cover', '12.0%', 'land cover'],
    ];
    const times = factors.map((f) => cue(shot, 'n07', f[2], -0.1));
    const ahpAt = cue(shot, 'n07', 'Analytic', -0.2);
    const chips = (t) => `<div class="cap-chips">${factors.map((f, i) => `<div class="cap-chip" style="opacity:${env(t, times[i], 1e9, 0.3)};transform:translateY(${(1 - env(t, times[i], 1e9, 0.3)) * 14}px)"><b>${f[0]}</b><span>${t > ahpAt ? f[1] : '&nbsp;'}</span><i style="width:${t > ahpAt ? parseFloat(f[1]) * 2.6 : 0}%"></i></div>`).join('')}</div>`;
    const ahpLine = `<div class="cap-note" style="text-align:center">Weighted overlay · Analytic Hierarchy Process · consistency ratio 0.005 · Jenks natural breaks</div>`;
    await shot.setCursor(0, 0, false);
    const flyStart = Math.round(cue(shot, 'n07', 'They are weighted', -0.6) * FPS);
    const T = shot.total;
    const from = await page.evaluate(() => { const m = window.__fsMaps.at(-1); const c = m.getCenter(); return { center: [c.lng, c.lat], zoom: m.getZoom() }; });
    const to = { center: [3.37, 6.86], zoom: 10.05 };
    const flyLen = 95;
    while (shot.n < T) {
      const t = shot.t;
      if (shot.n >= flyStart && shot.n < flyStart + flyLen) {
        const p = ease((shot.n - flyStart) / (flyLen - 1));
        await shot.jump({ center: [from.center[0] + (to.center[0] - from.center[0]) * p, from.center[1] + (to.center[1] - from.center[1]) * p], zoom: from.zoom + (to.zoom - from.zoom) * p });
      }
      await shot.overlay('chips', chips(t), { left: '918px', top: '78px', transform: 'translateX(-50%)' }, env(t, times[0] - 0.2, T / FPS - 0.25));
      await shot.overlay('ahp', ahpLine, { left: '918px', top: '196px', transform: 'translateX(-50%)', whiteSpace: 'nowrap', background: 'rgba(9,14,17,.9)', padding: '9px 16px', borderRadius: '6px' }, env(t, ahpAt + 0.4, T / FPS - 0.25));
      await shot.snap();
    }
    await page.evaluate(() => window.__cap.clear());
    await shot.finish();
  },

  // ---------------------------------------------------------------- 3d. inspect a location
  async s3_inspect(page) {
    const shot = new Shot(page, 's3_inspect');
    await shot.jump({ center: [3.37, 6.86], zoom: 10.05 });
    const pt = await page.evaluate((p) => { const m = window.__fsMaps.at(-1); const q = m.project([p.lon, p.lat]); return [q.x, q.y + 56]; }, INSPECT);
    await shot.setCursor(1180, 620, true);
    await shot.snap(6);
    await shot.click(pt[0], pt[1], { frames: 20, after: 8 });
    await page.waitForSelector('text=Location analysis');
    await shot.snap(8);
    // bring the point and panel together: zoom in, keeping the point left of the panel
    await shot.setCursor(0, 0, false);
    await shot.fly({ center: [INSPECT.lon + 0.07, INSPECT.lat - 0.006], zoom: 11.0 }, 60);
    const row = page.locator('.contrib li').first();
    const [rx, ry] = await shot.center(row);
    await shot.setCursor(rx - 160, ry + 160, true);
    await shot.moveTo(rx + 60, ry - 2, 20);
    const lt = lowerThird('Point inspection · Ifo LGA', 'Less than a metre above the river', 'Very-high susceptibility · every factor’s contribution explained');
    const T = shot.total;
    const scrollAt = T / FPS - 3.2;
    while (shot.n < T) {
      const t = shot.t;
      await shot.overlay('lt', lt, { left: '356px', bottom: '44px' }, env(t, 4.0, T / FPS - 0.3));
      if (t > scrollAt) await page.evaluate((y) => { document.querySelector('.insp-body').scrollTop = y; }, Math.round(380 * easeSine(clamp01((t - scrollAt) / 2.2))));
      await shot.snap();
    }
    await page.evaluate(() => window.__cap.clear());
    await shot.finish();
  },

  // ---------------------------------------------------------------- 3e. observed water check
  async s3_validate(page) {
    const shot = new Shot(page, 's3_validate');
    await shot.setCursor(1500, 420, true);
    await shot.clickEl(page.locator('.inspector .panel-head .icon-btn'), { frames: 16 });
    await shot.clickEl(toggle(page, 'Observed surface water').locator('.switch'), { frames: 18 });
    await shot.setCursor(0, 0, false);
    await shot.fly({ center: [3.36, 6.93], zoom: 9.25 }, 70);
    const at = cue(shot, 'n09', 'The highest class', -0.3);
    const at2 = cue(shot, 'n09', 'but holds', -0.2);
    const T = shot.total;
    const card = (t) => `<div class="cap-stat"><div><div class="big" style="color:#e9eef0">10.6%</div><div class="lbl">of Ogun’s land is in the Very-high class…</div></div>
      <div class="arrow" style="opacity:${env(t, at2)}">→</div>
      <div style="opacity:${env(t, at2)}"><div class="big" style="color:#5fd4ef">73%</div><div class="lbl">…of all the water Landsat has observed there since 1984</div></div>
      <div style="opacity:${env(t, at2 + 1.2)};border-left:1px solid rgba(255,255,255,.12);padding-left:28px"><div class="cap-note">AUC 0.91</div><div class="lbl" style="max-width:220px">A consistency check against observed water — not a forecast.</div></div></div>`;
    while (shot.n < T) {
      const t = shot.t;
      await shot.overlay('stat', card(t), { left: '356px', bottom: '40px' }, env(t, at, T / FPS - 0.3));
      await shot.snap();
    }
    await page.evaluate(() => window.__cap.clear());
    await shot.finish();
  },

  // ---------------------------------------------------------------- 4a. phone reporting
  async s4_phone(page, ctx) {
    const css = fs.readFileSync(path.join(ROOT, '..', 'dist', 'index.html'), 'utf8').match(/href="(\/assets\/index-[^"]+\.css)"/)[1];
    await page.route(`${BASE}/__stage`, (r) => r.fulfill({ contentType: 'text/html', body: stageHtml(css) }));
    await open(page, '/__stage');
    const frame = await (await page.waitForSelector('#phone-screen')).contentFrame();
    await frame.waitForLoadState('networkidle');
    await frame.waitForFunction(() => window.__fsMaps?.length, null, { timeout: 90000 });
    await frame.waitForTimeout(1500);
    const shot = new Shot(page, 's4_phone');
    shot.frame = frame;
    const off = await page.evaluate(() => { const r = document.getElementById('phone-screen').getBoundingClientRect(); return [r.left, r.top]; });
    await shot.jump({ center: [REPORT_AT.lon, REPORT_AT.lat + 0.004], zoom: 13.4 });
    const steps = (k) => page.evaluate((i) => window.stage.step(i), k);
    const inner = async (loc) => { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    shot.cur.touch = true;
    await steps(0);
    await shot.snap(Math.round(0.8 * FPS));
    // 1. drop pin
    const pinPx = await frame.evaluate((p) => { const m = window.__fsMaps.at(-1); const q = m.project([p.lon, p.lat]); return [q.x, q.y + m.getContainer().getBoundingClientRect().top]; }, REPORT_AT);
    await shot.setCursor(off[0] + 300, off[1] + 420, true, true);
    await shot.click(off[0] + pinPx[0], off[1] + pinPx[1], { frames: 14, after: 6 });
    await frame.waitForSelector('.loc-card b');
    await shot.snap(Math.round(0.9 * FPS));
    await shot.click(...(await inner(frame.locator('.flow-actions .btn-accent'))), { frames: 12, after: 5 });
    // 2. severity + description
    await steps(1);
    await shot.click(...(await inner(frame.locator('.sev-2'))), { frames: 12, after: 5 });
    await shot.click(...(await inner(frame.locator('textarea'))), { frames: 10, after: 4 });
    await shot.setCursor(0, 0, false, true);
    await shot.type('Water is over the road by the bridge and entering shops. About knee deep.', 3);
    await shot.snap(8);
    await frame.evaluate(() => { document.querySelector('.report-flow').scrollTop = 9999; });
    await shot.click(...(await inner(frame.locator('.flow-actions .btn-accent'))), { frames: 12, after: 5 });
    // 3. photo & contact (optional) -> skip
    await steps(2);
    await shot.snap(Math.round(1.0 * FPS));
    await shot.click(...(await inner(frame.locator('.flow-actions .btn-accent'))), { frames: 10, after: 5 });
    // 4. review & send (server requires >= 4 s on the form; frame-stepped capture is slower than that)
    await steps(3);
    await shot.snap(Math.round(1.0 * FPS));
    await shot.click(...(await inner(frame.locator('.flow-actions .btn-accent:has-text("Send report")'))), { frames: 12, after: 4 });
    await frame.waitForSelector('.ref-code', { timeout: 15000 });
    state.ref = (await frame.textContent('.ref-code')).trim();
    saveState();
    await shot.setCursor(0, 0, false, true);
    await steps(4);
    await shot.finish();
    console.log('  submitted', state.ref);
  },

  // ---------------------------------------------------------------- 4b. pending on the map
  async s4_pending(page) {
    await open(page, '/');
    await waitMap(page);
    const r = await (await fetch(`${BASE}/api/reports/${state.ref}`)).json();
    const shot = new Shot(page, 's4_pending');
    await shot.jump({ center: [r.lon + 0.02, r.lat - 0.002], zoom: 13.2 });
    await shot.snap(4);
    const pt = await page.evaluate((p) => { const m = window.__fsMaps.at(-1); const q = m.project([p.lon, p.lat]); return [q.x, q.y + 56]; }, r);
    await shot.setCursor(pt[0] + 260, pt[1] + 200, true, false);
    await shot.snap(Math.round(1.0 * FPS));
    await shot.click(pt[0], pt[1], { frames: 20, after: 8 });
    await page.waitForSelector('text=Community report');
    await shot.setCursor(0, 0, false);
    const lt = lowerThird('Crowd-sourced · unverified', 'On the map at once — as pending', `${state.ref} · text hidden · location rounded to ~110 m until verified`);
    const T = shot.total;
    while (shot.n < T) {
      await shot.overlay('lt', lt, { left: '356px', bottom: '44px' }, env(shot.t, 2.2, T / FPS - 0.3));
      await shot.snap();
    }
    await page.evaluate(() => window.__cap.clear());
    await shot.finish();
  },

  // ---------------------------------------------------------------- 5a. verification
  async s5_verify(page) {
    await open(page, '/admin');
    if (await page.locator('input[type=email]').count()) {
      await page.fill('input[type=email]', EMAIL);
      await page.fill('input[type=password]', PASSWORD);
      await page.click('button:has-text("Sign in")');
    }
    await page.waitForSelector('.queue-list button');
    await waitMap(page, false);
    const shot = new Shot(page, 's5_verify');
    await shot.setCursor(900, 600, true, false);
    await shot.snap(Math.round(0.6 * FPS));
    const item = page.locator(`.queue-list button:has-text("${state.ref}")`);
    await shot.clickEl(item, { frames: 18, after: 6 });
    await page.waitForSelector('text=GIS consistency check');
    await page.evaluate(() => window.__fsMaps.at(-1).stop());
    const r = await (await fetch(`${BASE}/api/reports/${state.ref}`)).json();
    await shot.jump({ center: [r.lon, r.lat], zoom: 13 });
    await shot.snap(Math.round(0.8 * FPS));
    const lt = lowerThird('Module F · Verification', 'Human judgement, backed by GIS evidence', 'Terrain at the exact spot · nearby reports · automated spam flags · full audit trail');
    // scroll detail to the GIS consistency check
    const toY = await page.evaluate(() => { const d = document.querySelector('.admin-detail'); const s = [...d.querySelectorAll('.block-title')].find((e) => e.textContent.includes('GIS consistency')); return s.getBoundingClientRect().top - d.getBoundingClientRect().top + d.scrollTop - 90; });
    await shot.animate(40, async (i, p) => {
      await page.evaluate((y) => { document.querySelector('.admin-detail').scrollTop = y; }, Math.round(toY * easeSine(p)));
      await shot.overlay('lt', lt, { left: '380px', bottom: '40px' }, clamp01(i / 12));
    });
    await shot.snap(Math.round(2.4 * FPS));
    await page.evaluate(() => { const d = document.querySelector('.admin-detail'); d.scrollTop = d.scrollHeight; });
    await page.evaluate(() => { const d = document.querySelector('.admin-detail'); const a = d.querySelector('.actions'); d.scrollTop = a.offsetTop - 120; });
    await shot.snap(6);
    await shot.clickEl(page.locator('.actions textarea'), { frames: 16, after: 4 });
    await shot.type('Pin, description and terrain are consistent.', 4);
    await shot.clickEl(page.locator('.actions .btn-good'), { frames: 14, after: 6 });
    await page.waitForSelector('.admin-detail .status-chip:has-text("Verified")');
    await page.evaluate(() => { document.querySelector('.admin-detail').scrollTop = 0; });
    await shot.setCursor(0, 0, false);
    const T = shot.total;
    while (shot.n < T) {
      await shot.overlay('lt', lt, { left: '380px', bottom: '40px' }, env(shot.t, 0, T / FPS - 0.3));
      await shot.snap();
    }
    await page.evaluate(() => window.__cap.clear());
    await shot.finish();
  },

  // ---------------------------------------------------------------- 5b. dashboard
  async s5_dashboard(page) {
    await open(page, '/insights');
    await page.waitForSelector('.stat-row');
    await page.waitForTimeout(800);
    const shot = new Shot(page, 's5_dashboard');
    const lt = lowerThird('Module D · Dashboard', 'Computed live from the database', 'Includes 24 synthetic demonstration reports — clearly labelled, and removable with one switch');
    const [vx, vy] = await shot.center(page.locator('.stat', { hasText: 'Verified incidents' }).locator('.v'));
    await shot.setCursor(vx + 220, vy + 260, true);
    await shot.moveTo(vx + 30, vy + 8, 22);
    const T = shot.total;
    const scrollStart = 3.4;
    while (shot.n < T) {
      const t = shot.t;
      if (t > scrollStart) {
        await page.evaluate((y) => { document.querySelector('.page').scrollTop = y; }, Math.round(330 * easeSine(clamp01((t - scrollStart) / 2.6))));
        if (shot.cur.vis) await shot.setCursor(0, 0, false);
      }
      await shot.overlay('lt', lt, { right: '64px', bottom: '40px' }, env(t, 0.5, T / FPS - 0.3));
      await shot.snap();
    }
    await page.evaluate(() => window.__cap.clear());
    await shot.finish();
  },

  // ---------------------------------------------------------------- 6a. scenario
  async s6_scenario(page) {
    await open(page, '/model');
    await waitMap(page);
    await page.evaluate(() => { const p = document.querySelector('.page'); const m = document.querySelector('.model-layout'); p.scrollTop = m.offsetTop - 70; });
    await page.waitForTimeout(500);
    const shot = new Shot(page, 's6_scenario');
    await shot.setCursor(1500, 700, true);
    await shot.snap(8);
    await shot.clickEl(page.locator('.presets button', { hasText: 'Urban runoff' }), { frames: 18, after: 6 });
    await shot.snap(10);
    await shot.clickEl(page.locator('button:has-text("Apply scenario to map")'), { frames: 16, after: 6 });
    await page.waitForSelector('button:has-text("Reset to baseline")');
    await shot.setCursor(0, 0, false);
    const lt = lowerThird('Module B · Transparent model', 'Change the weights — the state is re-classified', 'Pairwise judgements · consistency ratio checked · computed in the browser');
    const T = shot.total;
    while (shot.n < T) {
      await shot.overlay('lt', lt, { left: '140px', bottom: '40px' }, env(shot.t, 1.0, T / FPS - 0.3));
      await shot.snap();
    }
    await page.evaluate(() => window.__cap.clear());
    await shot.finish();
  },

  // ---------------------------------------------------------------- 6b. bigger picture b-roll
  async s6_bigger(page) {
    await open(page, '/');
    await waitMap(page);
    await setToggle(page, 'Towns', false);
    await setToggle(page, 'LGA boundaries', false);
    await setToggle(page, '3D terrain', true);
    await hideUi(page);
    const shot = new Shot(page, 's6_bigger');
    await page.evaluate(() => window.__cap.vignette(true));
    const from = { center: [3.40, 6.98], zoom: 9.7, pitch: 62, bearing: 24 };
    const to = { center: [3.36, 6.80], zoom: 10.45, pitch: 66, bearing: -12 };
    const a1 = cue(shot, 'n15', 'FloodSense does not', 0);
    const a2 = cue(shot, 'n15', 'so that residents', -0.2);
    const T = shot.total;
    const big1 = `<div class="cap-big">Not a forecast. Not a warning system.</div><div class="cap-note" style="margin-top:12px;font-size:17px">Susceptibility + verified community reports + observed water, kept distinct.</div>`;
    const big2 = `<div class="cap-big">For residents · local governments · emergency managers</div>`;
    for (let i = 0; i < T; i++) {
      const p = easeSine(i / (T - 1));
      const t = i / FPS;
      await shot.jump({ center: [from.center[0] + (to.center[0] - from.center[0]) * p, from.center[1] + (to.center[1] - from.center[1]) * p], zoom: from.zoom + (to.zoom - from.zoom) * p, pitch: from.pitch + (to.pitch - from.pitch) * p, bearing: from.bearing + (to.bearing - from.bearing) * p });
      await shot.overlay('b1', big1, { left: '96px', bottom: '96px' }, env(t, a1 + 0.2, a2 - 0.3, 0.5));
      await shot.overlay('b2', big2, { left: '96px', bottom: '96px' }, env(t, a2 + 0.2, T / FPS - 0.2, 0.5));
      await shot.snap();
    }
    await page.evaluate(() => { window.__cap.vignette(false); window.__cap.clear(); });
    await shot.finish();
  },
};

function stageHtml(css) {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${css}">
<style>
  html,body{margin:0;height:100%;background:#070c0e;overflow:hidden;font-family:'IBM Plex Sans',sans-serif;color:#e9eef0}
  body{background:radial-gradient(1200px 700px at 30% 55%, #13232a 0%, #070c0e 70%)}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:64px 64px}
  .phone{position:absolute;left:420px;top:${(1080 - 844 - 36) / 2}px;width:${390 + 36}px;height:${844 + 36}px;border-radius:62px;background:#111a1e;box-shadow:0 0 0 2px #2a383e, 0 40px 120px rgba(0,0,0,.7), inset 0 0 0 2px #05090b}
  #phone-screen{position:absolute;left:18px;top:18px;width:390px;height:844px;border:0;border-radius:46px;background:#0b1114}
  .side{position:absolute;left:1000px;top:250px;width:740px}
  .eyebrow{font:500 15px 'IBM Plex Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#f08a5d}
  h1{font:600 64px/1.05 'Barlow Condensed',sans-serif;margin:14px 0 34px;letter-spacing:.01em}
  ol{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:14px}
  li{display:flex;gap:18px;align-items:center;font:500 26px 'IBM Plex Sans';color:#5d6c73}
  li span{width:44px;height:44px;border-radius:50%;border:2px solid #2c3a40;display:grid;place-items:center;font:500 18px 'IBM Plex Mono'}
  li.on{color:#e9eef0} li.on span{border-color:#e2683c;background:#e2683c;color:#1a0b05}
  li.done{color:#a9b6bc} li.done span{border-color:#3cc13c;color:#3cc13c}
  .note{margin-top:34px;font:400 19px/1.5 'IBM Plex Sans';color:#a9b6bc;border-left:3px solid #2c3a40;padding-left:16px}
</style></head><body><div class="grid"></div>
<div class="phone"><iframe id="phone-screen" src="/report"></iframe></div>
<div class="side"><div class="eyebrow">Module C · Community reporting</div><h1>Report a flood from any phone</h1>
<ol id="steps"><li><span>1</span>Drop a pin — or use GPS</li><li><span>2</span>Severity and what you see</li><li><span>3</span>Optional photo &amp; contact</li><li><span>4</span>Review and send</li></ol>
<div class="note" id="note">Location is checked against the Ogun State boundary and tagged with its LGA and terrain context.</div></div>
<script>
window.stage = { step(k) {
  document.querySelectorAll('#steps li').forEach((li, i) => { li.className = i < k ? 'done' : i === k ? 'on' : ''; });
  const notes = ['Location is checked against the Ogun State boundary and tagged with its LGA and terrain context.',
    'Four plain-language severity levels — from water on the road to life-threatening.',
    'Photos are re-encoded on the phone; location metadata is stripped. Contact details need consent.',
    'Signed form tokens, a honeypot and rate limits keep out automated spam.',
    'Received — the reporter gets a reference code to track verification.'];
  document.getElementById('note').textContent = notes[k];
}};
</script></body></html>`;
}

// ======================================================================= main
const order = ['s1_terrain', 's3_overview', 's3_layers', 's3_model', 's3_inspect', 's3_validate', 's4_phone', 's4_pending', 's5_verify', 's5_dashboard', 's6_scenario', 's6_bigger'];
const want = process.argv.slice(2).length ? process.argv.slice(2) : order;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { try { localStorage.setItem('fs.theme', 'dark'); localStorage.setItem('fs.includeDemo', '1'); } catch { /* */ } });
await ctx.addInitScript(OVERLAY_SCRIPT);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  pageerror', e.message));
for (const id of order.filter((s) => want.includes(s))) {
  const t0 = Date.now();
  console.log(`shot ${id}`);
  await SHOTS[id](page, ctx);
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
void H;
