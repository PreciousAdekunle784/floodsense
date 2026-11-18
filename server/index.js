import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { admin, removeOrphanUploads } from './admin.js';
import { login, logout, me, sessionFrom } from './auth.js';
import { config } from './config.js';
import { db } from './db.js';
import { geoContext, geoData } from './geo.js';
import { SEVERITY, createReport, formToken, listPublic, purgeContacts, stats, statusByRef } from './reports.js';

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

// Security headers. Online basemaps are optional; the core map works from local data.
const TILE_HOSTS = 'https://tile.openstreetmap.org https://server.arcgisonline.com';
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
      `img-src 'self' data: blob: ${TILE_HOSTS}`, `connect-src 'self' data: blob: ${TILE_HOSTS}`, "worker-src 'self' blob:",
      "child-src blob:", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  next();
});
app.use(express.json({ limit: '32kb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.photoBytes, files: 1, fields: 30, fieldSize: 4000 },
});

const api = express.Router();
api.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString(), reports: db.prepare('SELECT COUNT(*) n FROM reports').get().n }));
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
api.get('/reports', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ reports: listPublic({ includeDemo: req.query.include_demo !== '0' }) });
});
api.post('/reports', (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `Photo is too large (max ${config.limits.photoBytes / 1048576} MB).` : 'Could not read the submitted form.';
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: msg, fields: err.code === 'LIMIT_FILE_SIZE' ? { photo: msg } : undefined });
    }
    try {
      const r = createReport(req, req.file);
      res.status(r.status).json(r.body);
    } catch (e) { next(e); }
  });
});
api.get('/reports/:ref', (req, res) => {
  const r = statusByRef(req.params.ref);
  if (!r) return res.status(404).json({ error: 'No report with that reference.' });
  res.set('Cache-Control', 'no-store').json(r);
});
api.get('/reports/:ref/photo', (req, res) => {
  const r = db.prepare('SELECT status, photo_file FROM reports WHERE ref = ?').get(String(req.params.ref).toUpperCase());
  // Photos are published only after a verifier has checked them (faces, private property, misinformation).
  if (!r?.photo_file || (r.status !== 'verified' && !sessionFrom(req))) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(config.uploadsDir, path.basename(r.photo_file)));
});
api.get('/stats', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
  res.set('Cache-Control', 'no-store').json(stats({ includeDemo: req.query.include_demo !== '0', days }));
});

api.post('/auth/login', login);
api.get('/auth/me', me);
api.post('/auth/logout', logout);
api.use('/admin', admin);
api.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', api);

// GIS layers (also copied into dist/ by the build). Long cache for immutable tiles.
app.use('/data/dem', express.static(path.join(config.publicDataDir, 'dem'), { maxAge: '7d', immutable: true }));
app.use('/data', express.static(config.publicDataDir, { maxAge: '1h' }));

if (fs.existsSync(path.join(config.distDir, 'index.html'))) {
  app.use(express.static(config.distDir, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/|\/data\/).*/, (req, res) => res.sendFile(path.join(config.distDir, 'index.html')));
} else {
  app.get('/', (req, res) => res.type('text').send('FloodSense API is running. Build the UI with `npm run build`, or use `npm run dev`.'));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

purgeContacts();
removeOrphanUploads();
setInterval(purgeContacts, 3600e3).unref();

if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) {
  console.warn('\n  No verifier accounts exist yet. Run `npm run setup` to create the first admin.\n');
}
app.listen(config.port, config.host, () => {
  console.log(`FloodSense running at http://localhost:${config.port}`);
});
