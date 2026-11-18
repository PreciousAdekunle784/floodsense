import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { requireAuth } from './auth.js';
import { config } from './config.js';
import { db, nowIso, tx } from './db.js';
import { seedDemo } from './demo.js';
import { geoContext } from './geo.js';
import { nearbyReports } from './reports.js';

export const admin = express.Router();
admin.use(requireAuth());

const parseFlags = (r) => ({ ...r, flags: JSON.parse(r.flags || '[]'), is_demo: !!r.is_demo, flagged: !!r.flagged, has_photo: !!r.photo_file });
const strip = ({ ip_hash, photo_file, ...r }) => r; // the hash stays server-side even for admins

admin.get('/reports', (req, res) => {
  const { status = 'all', flagged, lga, q } = req.query;
  const includeDemo = req.query.include_demo !== '0';
  const where = [];
  const args = [];
  if (['pending', 'verified', 'rejected', 'duplicate'].includes(status)) { where.push('r.status = ?'); args.push(status); }
  if (flagged === '1') where.push('r.flagged = 1');
  if (lga) { where.push('r.lga_name = ?'); args.push(String(lga)); }
  if (!includeDemo) where.push('r.is_demo = 0');
  if (q) { where.push('(r.ref LIKE ? OR r.description LIKE ? OR r.community LIKE ?)'); const s = `%${String(q).slice(0, 60)}%`; args.push(s, s, s); }
  const rows = db.prepare(`SELECT r.*, u.name AS reviewer_name FROM reports r LEFT JOIN users u ON u.id = r.reviewed_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (r.status = 'pending') DESC, r.flagged DESC, r.created_at DESC LIMIT 500`).all(...args);
  res.json({ reports: rows.map((r) => strip(parseFlags(r))) });
});

admin.get('/reports/:id', (req, res) => {
  const r = db.prepare(`SELECT r.*, u.name AS reviewer_name FROM reports r LEFT JOIN users u ON u.id = r.reviewed_by WHERE r.id = ?`).get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Report not found' });
  const obs = new Date(r.observed_at).getTime();
  const nearby = nearbyReports(r.lat, r.lon, 1500, r.id).map((n) => ({ ...n, hours_apart: Math.round(Math.abs(new Date(n.observed_at).getTime() - obs) / 3600e3) }));
  const events = db.prepare(`SELECT e.*, u.name AS user_name FROM review_events e LEFT JOIN users u ON u.id = e.user_id WHERE report_id = ? ORDER BY e.id`).all(r.id);
  const ctx = geoContext(r.lat, r.lon);
  res.json({ report: strip(parseFlags(r)), nearby, events, context: ctx });
});

const TRANSITIONS = {
  verify: { from: ['pending'], to: 'verified' },
  reject: { from: ['pending'], to: 'rejected', note: true },
  duplicate: { from: ['pending'], to: 'duplicate', note: false },
  reopen: { from: ['verified', 'rejected', 'duplicate'], to: 'pending', note: true },
};

admin.post('/reports/:id/review', (req, res) => {
  const id = Number(req.params.id);
  const action = String(req.body?.action || '');
  const note = String(req.body?.note || '').trim().slice(0, 500) || null;
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  const now = nowIso();
  if (action === 'flag' || action === 'unflag') {
    const flags = new Set(JSON.parse(r.flags || '[]'));
    if (action === 'flag') flags.add('manual_flag'); else flags.delete('manual_flag');
    tx(() => {
      db.prepare('UPDATE reports SET flagged = ?, flags = ?, updated_at = ? WHERE id = ?').run(action === 'flag' || flags.size ? 1 : 0, JSON.stringify([...flags]), now, id);
      db.prepare('INSERT INTO review_events (report_id, user_id, actor, action, from_status, to_status, note, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, req.user.id, req.user.name, action, r.status, r.status, note, now);
    });
    return res.json({ ok: true });
  }
  const t = TRANSITIONS[action];
  if (!t) return res.status(400).json({ error: 'Unknown action' });
  if (!t.from.includes(r.status)) return res.status(409).json({ error: `Cannot ${action} a report that is ${r.status}.` });
  if (t.note && !note) return res.status(422).json({ error: 'A short reason is required for this action.' });
  let dupId = null;
  if (action === 'duplicate') {
    const target = db.prepare('SELECT id, status FROM reports WHERE ref = ?').get(String(req.body?.duplicate_of || '').toUpperCase());
    if (!target || target.id === id) return res.status(422).json({ error: 'Enter the reference of the original report.' });
    if (!['verified', 'pending'].includes(target.status)) return res.status(422).json({ error: 'The original must be a pending or verified report.' });
    dupId = target.id;
  }
  tx(() => {
    db.prepare(`UPDATE reports SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, duplicate_of = ?, updated_at = ? WHERE id = ?`)
      .run(t.to, t.to === 'pending' ? null : req.user.id, t.to === 'pending' ? null : now, note, dupId, now, id);
    db.prepare('INSERT INTO review_events (report_id, user_id, actor, action, from_status, to_status, note, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, req.user.id, req.user.name, action, r.status, t.to, note, now);
  });
  res.json({ ok: true, status: t.to });
});

admin.get('/reports/:id/photo', (req, res) => {
  const r = db.prepare('SELECT photo_file FROM reports WHERE id = ?').get(Number(req.params.id));
  if (!r?.photo_file) return res.status(404).end();
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(path.join(config.uploadsDir, path.basename(r.photo_file)));
});

admin.get('/activity', (req, res) => {
  const events = db.prepare(`SELECT e.id, e.action, e.from_status, e.to_status, e.note, e.created_at, e.actor, r.ref, r.lga_name, r.is_demo
      FROM review_events e JOIN reports r ON r.id = e.report_id ORDER BY e.id DESC LIMIT 60`).all();
  const reviewers = db.prepare(`SELECT u.name, COUNT(*) n FROM review_events e JOIN users u ON u.id = e.user_id
      WHERE e.action IN ('verify','reject','duplicate') GROUP BY u.id ORDER BY n DESC`).all();
  const logins = db.prepare(`SELECT a.action, a.created_at, u.name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 20`).all();
  res.json({ events, reviewers, logins });
});

admin.get('/quality', (req, res) => {
  const includeDemo = req.query.include_demo !== '0';
  const rows = db.prepare(`SELECT * FROM reports ${includeDemo ? '' : 'WHERE is_demo = 0'}`).all();
  const n = rows.length || 1;
  const flagCounts = {};
  for (const r of rows) for (const f of JSON.parse(r.flags || '[]')) flagCounts[f] = (flagCounts[f] || 0) + 1;
  const reviewed = rows.filter((r) => r.status !== 'pending');
  const verified = rows.filter((r) => r.status === 'verified');
  res.json({
    total: rows.length,
    with_photo_pct: Math.round((100 * rows.filter((r) => r.photo_file).length) / n),
    with_contact_pct: Math.round((100 * rows.filter((r) => r.contact_consent).length) / n),
    location_method: rows.reduce((m, r) => ((m[r.location_method] = (m[r.location_method] || 0) + 1), m), {}),
    flags: flagCounts,
    rejection_rate_pct: reviewed.length ? Math.round((100 * reviewed.filter((r) => r.status === 'rejected').length) / reviewed.length) : null,
    duplicate_rate_pct: reviewed.length ? Math.round((100 * reviewed.filter((r) => r.status === 'duplicate').length) / reviewed.length) : null,
    verified_in_high_pct: verified.length ? Math.round((100 * verified.filter((r) => r.geo_class >= 4 && r.geo_class <= 5).length) / verified.length) : null,
    pending_over_48h: rows.filter((r) => r.status === 'pending' && Date.now() - new Date(r.created_at) > 48 * 3600e3).length,
    contacts_purged: rows.filter((r) => r.contact_purged_at).length,
    contact_retention_days: config.contactRetentionDays,
  });
});

admin.post('/demo/reset', requireAuth(['admin']), (req, res) => {
  const n = seedDemo({ reset: true });
  db.prepare('INSERT INTO audit_log (user_id, action, detail, created_at) VALUES (?,?,?,?)').run(req.user.id, 'demo_reset', JSON.stringify({ seeded: n }), nowIso());
  res.json({ ok: true, seeded: n });
});

export function removeOrphanUploads() {
  const used = new Set(db.prepare('SELECT photo_file FROM reports WHERE photo_file IS NOT NULL').all().map((r) => r.photo_file));
  for (const f of fs.readdirSync(config.uploadsDir)) if (!used.has(f) && !f.startsWith('demo-')) fs.rmSync(path.join(config.uploadsDir, f));
}
