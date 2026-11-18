/*
 * The FloodSense API as an Express app.
 * Used by server/index.js (local / any Node host) and api/index.js (Vercel function).
 */
import express from 'express';
import multer from 'multer';
import { admin } from './admin.js';
import { login, logout, me, sessionFrom } from './auth.js';
import { config } from './config.js';
import { db } from './db.js';
import { geoContext, geoData } from './geo.js';
import { SEVERITY, createReport, formToken, listPublic, photoFor, stats, statusByRef } from './reports.js';

// Online basemaps are optional; the core map works from local data.
const TILE_HOSTS = 'https://tile.openstreetmap.org https://server.arcgisonline.com';
export const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
    `img-src 'self' data: blob: ${TILE_HOSTS}`, `connect-src 'self' data: blob: ${TILE_HOSTS}`, "worker-src 'self' blob:",
    "child-src blob:", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', true);
app.use((req, res, next) => { res.set(SECURITY_HEADERS); next(); });
app.use(express.json({ limit: '32kb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.photoBytes, files: 1, fields: 30, fieldSize: 4000 },
});

const api = express.Router();
api.get('/health', async (req, res) => res.json({ ok: true, time: new Date().toISOString(), reports: (await db.get('SELECT COUNT(*) n FROM reports')).n }));
api.get('/config', (req, res) => res.json({
  pilot: 'Ogun State, Nigeria', severity: SEVERITY, contact_retention_days: config.contactRetentionDays,
  max_report_age_days: config.limits.maxReportAgeDays, photo_max_mb: config.limits.photoBytes / 1048576,
}));
api.get('/context', (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat and lon are required' });
  res.json(geoContext(lat, lon));
});
api.get('/lgas', (req, res) => res.json(geoData.lgas));

api.get('/reports/form-token', (req, res) => res.set('Cache-Control', 'no-store').json({ token: formToken() }));
api.get('/reports', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ reports: await listPublic({ includeDemo: req.query.include_demo !== '0' }) });
});
api.post('/reports', (req, res, next) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) {
      const big = err.code === 'LIMIT_FILE_SIZE';
      const msg = big ? `Photo is too large (max ${config.limits.photoBytes / 1048576} MB).` : 'Could not read the submitted form.';
      return res.status(big ? 413 : 400).json({ error: msg, fields: big ? { photo: msg } : undefined });
    }
    try {
      const r = await createReport(req, req.file);
      res.status(r.status).json(r.body);
    } catch (e) { next(e); }
  });
});
api.get('/reports/:ref', async (req, res) => {
  const r = await statusByRef(req.params.ref);
  if (!r) return res.status(404).json({ error: 'No report with that reference.' });
  res.set('Cache-Control', 'no-store').json(r);
});
api.get('/reports/:ref/photo', async (req, res) => {
  const r = await db.get('SELECT status, photo_file FROM reports WHERE ref = ?', String(req.params.ref).toUpperCase());
  // Photos are published only after a verifier has checked them (faces, private property, misinformation).
  if (!r?.photo_file || (r.status !== 'verified' && !(await sessionFrom(req)))) return res.status(404).end();
  const p = await photoFor(r.photo_file);
  if (!p) return res.status(404).end();
  res.set({ 'Content-Type': p.mime, 'Cache-Control': r.status === 'verified' ? 'public, max-age=3600' : 'private, no-store' }).send(p.data);
});
api.get('/stats', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
  res.set('Cache-Control', 'no-store').json(await stats({ includeDemo: req.query.include_demo !== '0', days }));
});

api.post('/auth/login', login);
api.get('/auth/me', me);
api.post('/auth/logout', logout);
api.use('/admin', admin);
api.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', api);

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong on the server.' });
}
app.use('/api', errorHandler);

export default app;
