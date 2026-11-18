/*
 * Renders the motion-graphics shots frame by frame from graphics.html (deterministic: frame = f(t)).
 *   node video/graphics/render.mjs [shotId ...]
 * All data shown comes from the FloodSense project outputs (IMERG series, geoBoundaries, DEM drainage).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { BUILD, FPS, ROOT, Shot, cue, shotSpec, timeline } from '../capture/lib.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const DATA = path.join(ROOT, '..', 'public', 'data');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const model = rd('model.json');
const rain = model.rainfall_series.filter((r) => r.month.startsWith('2026')).map((r) => ({ m: Number(r.month.slice(5)), mm: r.mm, clim: r.clim_mm }));
const drainAll = rd('drainage.geojson');
const drain = { type: 'FeatureCollection', features: drainAll.features.filter((f) => f.properties.order >= 3) };
// drawing order for the closing scene: big rivers first
drain.features.forEach((f) => { f.properties.k = ({ 7: 0, 6: 0.05, 5: 0.15, 4: 0.35, 3: 0.6 })[f.properties.order] ?? 0.8; });
const data = { rain, state: rd('state.geojson'), lgas: rd('lgas.geojson'), drain, communities: ['Isheri', 'Akute', 'Alagbole', 'Magboro', 'Warewa'] };

const want = process.argv.slice(2).length ? process.argv.slice(2) : timeline.shots.filter((s) => s.kind === 'gfx').map((s) => s.id);
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('file://' + path.join(ROOT, 'graphics', 'graphics.html'));
await page.evaluate(() => document.fonts.ready);
await page.evaluate((d) => window.setup(d), data);
await page.evaluate(() => document.fonts.ready);

for (const id of want) {
  const shot = new Shot(page, id);
  const spec = shotSpec(id);
  const T = spec.duration;
  const cues = { T };
  if (id === 's1_evidence') { cues.split = spec.lead + timeline.split_n02_at; cues.pct = cue(shot, 'n02', 'forty-one', 0); cues.comm = cue(shot, 'n02', 'Isheri', -0.15); }
  if (id === 's1_question') cues.q2 = cue(shot, 'n03', 'or of what', 0.1);
  if (id === 's2_intro') { cues.A = cue(shot, 'n04', 'Geographic analysis', -0.1); cues.B = cue(shot, 'n04', 'and verified', -0.1); cues.C = cue(shot, 'n04', 'from the community', 0.6); }
  if (id === 's7_close') { cues.brand = cue(shot, 'n16', 'With FloodSense', -0.4); cues.credits = spec.lead + 10.6; }
  const t0 = Date.now();
  for (let i = 0; i < shot.total; i++) {
    await page.evaluate(([s, t, c]) => window.render(s, t, c), [id, i / FPS, cues]);
    const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
    fs.writeFileSync(shot.file(i), buf);
    shot.n = i + 1;
  }
  if (id === 's2_intro') shot.cues.push({ frame: 6, type: 'reveal' });
  if (id === 's7_close') shot.cues.push({ frame: Math.round(cues.brand * FPS), type: 'reveal' });
  fs.writeFileSync(path.join(shot.dir, 'meta.json'), JSON.stringify({ id, frames: shot.n, cues: shot.cues }, null, 1));
  console.log(`${id}: ${shot.n} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
void BUILD;
