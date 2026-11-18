/*
 * Community flood reports: submission, public read model, safeguards and statistics.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { clientHash } from './auth.js';
import { config } from './config.js';
import { db, nowIso } from './db.js';
import { geoContext, haversine } from './geo.js';

export const SEVERITY = {
  1: 'Minor — water on roads or drains overflowing; still passable',
  2: 'Moderate — ankle-to-knee deep; entering compounds or shops',
  3: 'Severe — knee-to-waist deep; homes flooded, roads cut off',
  4: 'Extreme — life-threatening; people or vehicles trapped',
};

const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newRef() {
  for (;;) {
    const bytes = crypto.randomBytes(6);
    let s = 'FS-';
    for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length];
    if (!db.prepare('SELECT 1 FROM reports WHERE ref = ?').get(s)) return s;
  }
}

// ---- form tokens: proof that a human spent a few seconds on the form ----------------
export function formToken() {
  const t = Date.now().toString(36);
  const mac = crypto.createHmac('sha256', config.secret).update(`form:${t}`).digest('base64url').slice(0, 22);
  return `${t}.${mac}`;
}
function checkFormToken(tok) {
  const [t, mac] = String(tok || '').split('.');
  if (!t || !mac) return 'missing';
  const expect = crypto.createHmac('sha256', config.secret).update(`form:${t}`).digest('base64url').slice(0, 22);
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return 'invalid';
  const age = (Date.now() - parseInt(t, 36)) / 1000;
  if (age < config.limits.minFormSeconds) return 'too_fast';
  if (age > 6 * 3600) return 'expired';
  return null;
}

// ---- photo handling: verify magic bytes and strip metadata (EXIF can contain GPS/device info)
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}
export function stripJpegMetadata(buf) {
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return buf; // malformed: keep original (already validated as JPEG)
    const marker = buf[i + 1];
    if (marker === 0xda) { out.push(buf.subarray(i)); break; } // start of scan: rest is image data
    const len = buf.readUInt16BE(i + 2);
    const isMeta = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe; // APP1..APP15, COM
    if (!isMeta) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return Buffer.concat(out);
}
function stripPngMetadata(buf) {
  const keep = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const chunk = buf.subarray(i, i + 12 + len);
    if (!['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(type)) keep.push(chunk);
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return Buffer.concat(keep);
}

// ---- rate limiting (per salted client hash, in-database so it survives restarts) -----------
function rateLimited(ipHash) {
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const dayAgo = new Date(Date.now() - 86400e3).toISOString();
  const h = db.prepare('SELECT COUNT(*) n FROM reports WHERE ip_hash = ? AND created_at > ?').get(ipHash, hourAgo).n;
  const d = db.prepare('SELECT COUNT(*) n FROM reports WHERE ip_hash = ? AND created_at > ?').get(ipHash, dayAgo).n;
  return h >= config.limits.reportsPerHour || d >= config.limits.reportsPerDay;
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

export function validateReport(body) {
  const errors = {};
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) errors.location = 'Choose the flood location on the map.';
  const severity = Number(body.severity);
  if (![1, 2, 3, 4].includes(severity)) errors.severity = 'Select how severe the flooding is.';
  const description = clean(body.description, 1000);
  if (description.length < 15) errors.description = 'Describe what you can see (at least 15 characters).';
  const community = clean(body.community, 120);
  const observed = new Date(body.observed_at);
  if (Number.isNaN(observed.getTime())) errors.observed_at = 'Enter when you saw the flooding.';
  else if (observed.getTime() > Date.now() + 10 * 60e3) errors.observed_at = 'The time cannot be in the future.';
  else if (Date.now() - observed.getTime() > config.limits.maxReportAgeDays * 86400e3) errors.observed_at = `Reports must be about flooding in the last ${config.limits.maxReportAgeDays} days.`;
  const method = ['map', 'gps', 'search'].includes(body.location_method) ? body.location_method : 'map';
  const contact_name = clean(body.contact_name, 80);
  const contact_phone = clean(body.contact_phone, 30);
  const contact_email = clean(body.contact_email, 120);
  const consent = body.contact_consent === true || body.contact_consent === 'true' || body.contact_consent === '1';
  const anyContact = contact_name || contact_phone || contact_email;
  if (anyContact && !consent) errors.contact_consent = 'Tick the consent box, or remove your contact details.';
  if (contact_phone && !/^[+0-9 ()-]{7,30}$/.test(contact_phone)) errors.contact_phone = 'Enter a valid phone number.';
  if (contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) errors.contact_email = 'Enter a valid email address.';
  return {
    errors,
    value: { lat, lon, severity, description, community, observed_at: Number.isNaN(observed.getTime()) ? null : observed.toISOString(),
      location_method: method, contact_name: anyContact && consent ? contact_name || null : null,
      contact_phone: anyContact && consent ? contact_phone || null : null,
      contact_email: anyContact && consent ? contact_email || null : null, contact_consent: anyContact && consent ? 1 : 0 },
  };
}

/** Automated quality signals. They never reject a report — they prioritise human review. */
export function qualityFlags(r, ipHash) {
  const flags = [];
  if (/https?:\/\/|www\./i.test(r.description)) flags.push('contains_link');
  const dayAgo = new Date(Date.now() - 86400e3).toISOString();
  const same = db.prepare('SELECT COUNT(*) n FROM reports WHERE description = ? AND created_at > ?').get(r.description, dayAgo).n;
  if (same > 0) flags.push('repeated_text');
  if (ipHash) {
    const n = db.prepare('SELECT COUNT(*) n FROM reports WHERE ip_hash = ? AND created_at > ?').get(ipHash, dayAgo).n;
    if (n >= 3) flags.push('many_from_same_client');
  }
  if (r.geo_class && r.geo_class <= 1 && r.severity >= 3) flags.push('severe_in_very_low_susceptibility');
  if (r.geo_class === 6) flags.push('on_permanent_water');
  return flags;
}

export function createReport(req, photo) {
  if (clean(req.body.website, 200)) return { status: 400, body: { error: 'Submission rejected.' } }; // honeypot
  const tokErr = checkFormToken(req.body.form_token);
  if (tokErr === 'too_fast') return { status: 429, body: { error: 'That was very fast — please check your report and submit again.' } };
  if (tokErr) return { status: 400, body: { error: 'Your form session expired. Reload the page and try again.' } };
  const { errors, value } = validateReport(req.body);
  if (Object.keys(errors).length) return { status: 422, body: { error: 'Please correct the highlighted fields.', fields: errors } };
  const ctx = geoContext(value.lat, value.lon);
  if (!ctx.inside) return { status: 422, body: { error: 'This location is outside Ogun State. The FloodSense pilot currently covers Ogun State only.', fields: { location: 'Outside Ogun State pilot area.' } } };
  const ipHash = clientHash(req);
  if (rateLimited(ipHash)) return { status: 429, body: { error: 'Too many reports from this device recently. Please try again later.' } };

  let photo_file = null;
  if (photo) {
    const kind = sniff(photo.buffer);
    if (!kind) return { status: 422, body: { error: 'Photo must be a JPEG or PNG image.', fields: { photo: 'Unsupported image type.' } } };
    const data = kind === 'jpg' ? stripJpegMetadata(photo.buffer) : stripPngMetadata(photo.buffer);
    photo_file = `${crypto.randomUUID()}.${kind}`;
    fs.writeFileSync(path.join(config.uploadsDir, photo_file), data);
  }
  const g = ctx.grid || {};
  const row = {
    ...value, ref: newRef(), lga_id: ctx.lga?.id ?? null, lga_name: ctx.lga?.name ?? null,
    geo_class: g.cls ?? null, geo_index: g.index ?? null, geo_hand_m: g.hand_m ?? null,
    geo_dist_m: g.dist_m ?? null, geo_elev_m: g.elev_m ?? null, geo_ref_water: g.ref_water ?? null,
  };
  const flags = qualityFlags(row, ipHash);
  const now = nowIso();
  const info = db.prepare(`INSERT INTO reports (ref, lat, lon, location_method, lga_id, lga_name, community, severity, description,
      observed_at, created_at, updated_at, status, flagged, flags, photo_file, contact_name, contact_phone, contact_email,
      contact_consent, ip_hash, geo_class, geo_index, geo_hand_m, geo_dist_m, geo_elev_m, geo_ref_water, is_demo)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(
    row.ref, row.lat, row.lon, row.location_method, row.lga_id, row.lga_name, row.community || null, row.severity,
    row.description, row.observed_at, now, now, flags.length ? 1 : 0, JSON.stringify(flags), photo_file,
    row.contact_name, row.contact_phone, row.contact_email, row.contact_consent, ipHash,
    row.geo_class, row.geo_index, row.geo_hand_m, row.geo_dist_m, row.geo_elev_m, row.geo_ref_water);
  db.prepare('INSERT INTO review_events (report_id, actor, action, to_status, note, created_at) VALUES (?,?,?,?,?,?)')
    .run(info.lastInsertRowid, 'reporter', 'submitted', 'pending', flags.length ? `Automated flags: ${flags.join(', ')}` : null, now);
  return { status: 201, body: { ref: row.ref, status: 'pending', lga: row.lga_name, geo_class: row.geo_class, created_at: now } };
}

// ---- public read model --------------------------------------------------------------------
// Pending reports: location rounded to ~110 m, no description/photo (unverified content).
// Verified reports: location rounded to ~11 m, description and photo visible.
// Rejected/duplicate reports and every private field are never published.
export function publicReport(r) {
  const verified = r.status === 'verified';
  const d = verified ? 4 : 3;
  return {
    ref: r.ref, status: r.status, severity: r.severity,
    lat: Number(r.lat.toFixed(d)), lon: Number(r.lon.toFixed(d)), precision_m: verified ? 11 : 110,
    lga: r.lga_name, community: r.community, observed_at: r.observed_at, created_at: r.created_at,
    verified_at: verified ? r.reviewed_at : null,
    description: verified ? r.description : null,
    has_photo: verified && !!r.photo_file,
    geo_class: r.geo_class, is_demo: !!r.is_demo,
  };
}

export function listPublic({ includeDemo }) {
  const rows = db.prepare(`SELECT * FROM reports WHERE status IN ('pending','verified') ${includeDemo ? '' : 'AND is_demo = 0'}
                           ORDER BY created_at DESC LIMIT 2000`).all();
  return rows.map(publicReport);
}

export function statusByRef(ref) {
  const r = db.prepare('SELECT * FROM reports WHERE ref = ?').get(String(ref).toUpperCase().slice(0, 12));
  if (!r) return null;
  const events = db.prepare(`SELECT action, to_status, created_at FROM review_events WHERE report_id = ? ORDER BY id`).all(r.id);
  return { ...publicReport(r), status: r.status, timeline: events };
}

export function nearbyReports(lat, lon, radius_m, excludeId, sinceIso) {
  const dLat = radius_m / 111000;
  const dLon = radius_m / (111000 * Math.cos((lat * Math.PI) / 180));
  const rows = db.prepare(`SELECT id, ref, lat, lon, status, severity, observed_at, created_at, is_demo FROM reports
      WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND id != ? ${sinceIso ? 'AND observed_at > ?' : ''}`)
    .all(lat - dLat, lat + dLat, lon - dLon, lon + dLon, excludeId ?? -1, ...(sinceIso ? [sinceIso] : []));
  return rows.map((x) => ({ ...x, distance_m: Math.round(haversine(lat, lon, x.lat, x.lon)) }))
    .filter((x) => x.distance_m <= radius_m).sort((a, b) => a.distance_m - b.distance_m);
}

// ---- statistics (computed live from the database) ------------------------------------------
export function stats({ includeDemo, days = 30 }) {
  const demo = includeDemo ? '' : 'AND is_demo = 0';
  const all = db.prepare(`SELECT id, status, severity, lga_name, geo_class, created_at, observed_at, reviewed_at, flagged, is_demo
                          FROM reports WHERE 1=1 ${demo}`).all();
  const by = (k) => all.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
  const status = { pending: 0, verified: 0, rejected: 0, duplicate: 0, ...by('status') };
  const lga = {};
  for (const r of all) {
    const k = r.lga_name || 'Unknown';
    lga[k] ??= { pending: 0, verified: 0, rejected: 0, duplicate: 0 };
    lga[k][r.status] += 1;
  }
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const daily = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400e3).toISOString().slice(0, 10);
    daily.push({ date: d, pending: 0, verified: 0, rejected: 0, duplicate: 0 });
  }
  const dayIdx = Object.fromEntries(daily.map((d, i) => [d.date, i]));
  for (const r of all) {
    const i = dayIdx[r.created_at.slice(0, 10)];
    if (i !== undefined) daily[i][r.status] += 1;
  }
  const verified = all.filter((r) => r.status === 'verified');
  const severity = [1, 2, 3, 4].map((s) => ({ severity: s, verified: verified.filter((r) => r.severity === s).length,
    pending: all.filter((r) => r.status === 'pending' && r.severity === s).length }));
  const geoClass = [1, 2, 3, 4, 5, 6].map((c) => ({ cls: c,
    verified: verified.filter((r) => r.geo_class === c).length,
    pending: all.filter((r) => r.status === 'pending' && r.geo_class === c).length }));
  const hours = verified.filter((r) => r.reviewed_at).map((r) => (new Date(r.reviewed_at) - new Date(r.created_at)) / 3600e3).sort((a, b) => a - b);
  const median = hours.length ? hours[Math.floor(hours.length / 2)] : null;
  const pendingOld = all.filter((r) => r.status === 'pending' && Date.now() - new Date(r.created_at) > 48 * 3600e3).length;
  const last = all.reduce((m, r) => (r.created_at > m ? r.created_at : m), '');
  const lastVerified = verified.reduce((m, r) => (r.reviewed_at && r.reviewed_at > m ? r.reviewed_at : m), '');
  return {
    generated_at: nowIso(), include_demo: includeDemo, total: all.length,
    demo_count: all.filter((r) => r.is_demo).length,
    status, by_lga: lga, daily, severity, geo_class: geoClass,
    median_hours_to_verify: median, pending_over_48h: pendingOld, flagged_pending: all.filter((r) => r.flagged && r.status === 'pending').length,
    last_report_at: last || null, last_verified_at: lastVerified || null,
  };
}

/** Delete reporter contact details N days after review (data minimisation). */
export function purgeContacts() {
  const cutoff = new Date(Date.now() - config.contactRetentionDays * 86400e3).toISOString();
  const r = db.prepare(`UPDATE reports SET contact_name = NULL, contact_phone = NULL, contact_email = NULL, contact_purged_at = ?
      WHERE reviewed_at IS NOT NULL AND reviewed_at < ? AND contact_purged_at IS NULL
      AND (contact_name IS NOT NULL OR contact_phone IS NOT NULL OR contact_email IS NOT NULL)`).run(nowIso(), cutoff);
  return r.changes;
}
