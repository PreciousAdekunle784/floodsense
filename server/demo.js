/*
 * Synthetic demonstration reports.
 * These are NOT real incidents. Every row is stored with is_demo = 1 and is labelled
 * "Synthetic demo" everywhere in the interface; the public map and dashboard can hide them.
 * Locations are random cells inside Ogun State (biased towards higher modelled susceptibility so
 * the demo looks like a plausible pattern) generated with a fixed seed, so the demo is repeatable.
 */
import crypto from 'node:crypto';
import { db, tx } from './db.js';
import { geoContext } from './geo.js';
import { qualityFlags } from './reports.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEXT = [
  'Water has covered the road after the overnight rain; cars are turning back at the junction.',
  'Drainage channel beside the market overflowed. Shops on the low side have water at the doorstep.',
  'Stream behind the houses rose quickly in the evening. Several compounds have water up to the knee.',
  'Bridge approach is under water and okadas cannot pass. Pedestrians are wading across.',
  'Rain since morning; water is entering classrooms at the primary school on the low side of the street.',
  'River level is high and farmland near the bank is flooded. No houses affected yet.',
  'Gutters are blocked with refuse and the street is flooded ankle-deep for about 200 metres.',
  'Water entered ground-floor rooms during the night. Families have moved belongings upstairs.',
  'Low part of the estate road is flooded waist-deep; residents are stranded and asking for help.',
  'Heavy downpour for two hours; water flowing across the expressway shoulder.',
];
const SPAM = 'Best loan offer!! visit www.example-loans.test to claim now';

function randomCell(rng, wantHigh) {
  for (let i = 0; i < 20000; i++) {
    const lat = 6.35 + rng() * 1.6;
    const lon = 2.72 + rng() * 1.86;
    const ctx = geoContext(lat, lon);
    if (!ctx.inside || !ctx.grid || ctx.grid.cls < 1 || ctx.grid.cls > 5) continue;
    const c = ctx.grid.cls;
    const p = wantHigh ? [0, 0.02, 0.06, 0.25, 0.7, 1][c] : [0, 0.5, 0.6, 0.6, 0.6, 0.6][c];
    if (rng() < p) return { lat, lon, ctx };
  }
  throw new Error('could not sample a demo location');
}

const SEED_PLAN = [
  // [daysAgo, status, severity]
  [17, 'verified', 2], [15, 'verified', 3], [14, 'rejected', 1], [12, 'verified', 2], [11, 'duplicate', 2],
  [10, 'verified', 1], [9, 'verified', 3], [8, 'pending', 2], [7, 'verified', 2], [6, 'verified', 4],
  [5, 'duplicate', 3], [5, 'verified', 2], [4, 'pending', 1], [4, 'rejected', 2], [3, 'verified', 3],
  [3, 'pending', 2], [2, 'pending', 3], [2, 'verified', 2], [1, 'pending', 2], [1, 'pending', 1],
  [1, 'pending', 3], [0, 'pending', 2], [0, 'pending', 4], [0, 'pending', 1],
];

export function seedDemo({ reset = false } = {}) {
  if (reset) db.exec('DELETE FROM review_events WHERE report_id IN (SELECT id FROM reports WHERE is_demo = 1); UPDATE reports SET duplicate_of = NULL WHERE duplicate_of IN (SELECT id FROM reports WHERE is_demo = 1); DELETE FROM reports WHERE is_demo = 1;');
  else if (db.prepare('SELECT COUNT(*) n FROM reports WHERE is_demo = 1').get().n > 0) return 0;
  const rng = mulberry32(20261118);
  const now = Date.now();
  const inserted = [];
  tx(() => {
    SEED_PLAN.forEach(([daysAgo, status, severity], i) => {
      let loc;
      let dupOf = null;
      if (status === 'duplicate') {
        const orig = inserted.filter((x) => x.status === 'verified').at(-1);
        dupOf = orig;
        loc = { lat: orig.lat + (rng() - 0.5) * 0.004, lon: orig.lon + (rng() - 0.5) * 0.004 };
        loc.ctx = geoContext(loc.lat, loc.lon);
      } else {
        loc = randomCell(rng, status !== 'rejected');
      }
      const created = new Date(now - daysAgo * 86400e3 - Math.floor(rng() * 10) * 3600e3 - 3600e3);
      const observed = new Date(created.getTime() - Math.floor(rng() * 5 + 1) * 3600e3);
      const g = loc.ctx.grid;
      const description = status === 'rejected' && i % 2 === 0 ? SPAM : TEXT[Math.floor(rng() * TEXT.length)];
      const row = { description, severity, geo_class: g.cls };
      const flags = qualityFlags(row, null);
      const ref = 'FS-D' + crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
      const reviewed = status === 'pending' ? null : new Date(created.getTime() + (2 + rng() * 20) * 3600e3).toISOString();
      const note = { verified: 'Demo review: consistent with nearby reports and terrain context.',
        rejected: description === SPAM ? 'Demo review: advertising / spam.' : 'Demo review: photo and description do not show flooding.',
        duplicate: `Demo review: same event as ${dupOf?.ref}.` }[status] || null;
      const info = db.prepare(`INSERT INTO reports (ref, lat, lon, location_method, lga_id, lga_name, community, severity, description,
          observed_at, created_at, updated_at, status, flagged, flags, duplicate_of, contact_consent, geo_class, geo_index, geo_hand_m,
          geo_dist_m, geo_elev_m, geo_ref_water, reviewed_at, review_note, is_demo)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,1)`).run(
        ref, loc.lat, loc.lon, rng() < 0.5 ? 'gps' : 'map', loc.ctx.lga?.id ?? null, loc.ctx.lga?.name ?? null, null, severity, description,
        observed.toISOString(), created.toISOString(), (reviewed || created.toISOString()), status, flags.length ? 1 : 0, JSON.stringify(flags),
        dupOf?.id ?? null, g.cls, g.index, g.hand_m, g.dist_m, g.elev_m, g.ref_water, reviewed, note);
      const id = Number(info.lastInsertRowid);
      db.prepare('INSERT INTO review_events (report_id, actor, action, to_status, created_at) VALUES (?,?,?,?,?)').run(id, 'reporter (demo)', 'submitted', 'pending', created.toISOString());
      if (reviewed) {
        db.prepare('INSERT INTO review_events (report_id, actor, action, from_status, to_status, note, created_at) VALUES (?,?,?,?,?,?,?)')
          .run(id, 'demo seed', { verified: 'verify', rejected: 'reject', duplicate: 'duplicate' }[status], 'pending', status, note, reviewed);
      }
      inserted.push({ id, ref, status, lat: loc.lat, lon: loc.lon });
    });
  });
  return inserted.length;
}
