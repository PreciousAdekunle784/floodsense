import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.FLOODSENSE_DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

// Server-side secret used to salt IP hashes and sign form tokens.
// Generated once per installation and never sent to the browser.
function loadSecret() {
  if (process.env.FLOODSENSE_SECRET) return process.env.FLOODSENSE_SECRET;
  const p = path.join(dataDir, '.secret');
  if (!fs.existsSync(p)) fs.writeFileSync(p, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(p, 'utf8').trim();
}

export const config = {
  root,
  dataDir,
  dbPath: path.join(dataDir, 'floodsense.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  publicDataDir: path.join(root, 'public', 'data'),
  distDir: path.join(root, 'dist'),
  port: Number(process.env.PORT) || 8080,
  host: process.env.HOST || '0.0.0.0',
  // Secure cookies require HTTPS. Enabled automatically in production unless explicitly disabled
  // (e.g. for a local offline demo served over plain http://localhost).
  secureCookies: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1',
  sessionHours: 12,
  contactRetentionDays: Number(process.env.CONTACT_RETENTION_DAYS) || 30,
  secret: loadSecret(),
  limits: {
    reportsPerHour: Number(process.env.REPORTS_PER_HOUR) || 5,
    reportsPerDay: Number(process.env.REPORTS_PER_DAY) || 20,
    photoBytes: 6 * 1024 * 1024,
    minFormSeconds: 4,
    maxReportAgeDays: 14,
  },
};
