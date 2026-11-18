import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const onVercel = !!process.env.VERCEL;
const tursoUrl = process.env.TURSO_DATABASE_URL || '';
const dataDir = path.resolve(process.env.FLOODSENSE_DATA_DIR || path.join(root, 'data'));

if (onVercel && !tursoUrl) {
  throw new Error('TURSO_DATABASE_URL is not set. On Vercel FloodSense needs a Turso database (see docs/DEPLOY_VERCEL.md).');
}
// A local SQLite file needs a writable data directory; a Turso database does not.
if (!tursoUrl) fs.mkdirSync(dataDir, { recursive: true });

// Server-side secret used to salt IP hashes and sign form tokens; never sent to the browser.
// Serverless instances must share it, so on Vercel it has to come from the environment.
function loadSecret() {
  if (process.env.FLOODSENSE_SECRET) return process.env.FLOODSENSE_SECRET;
  if (onVercel) throw new Error('FLOODSENSE_SECRET is not set. Add a long random value in the Vercel project settings.');
  const p = path.join(dataDir, '.secret');
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(p, 'utf8').trim();
}

export const config = {
  root,
  onVercel,
  dataDir,
  dbPath: path.join(dataDir, 'floodsense.db'),
  tursoUrl,
  tursoToken: process.env.TURSO_AUTH_TOKEN || undefined,
  legacyUploadsDir: path.join(dataDir, 'uploads'),
  publicDataDir: path.join(root, 'public', 'data'),
  distDir: path.join(root, 'dist'),
  port: Number(process.env.PORT) || 8080,
  host: process.env.HOST || '0.0.0.0',
  // Secure cookies require HTTPS: on in production (Vercel sets NODE_ENV=production) unless overridden.
  secureCookies: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : process.env.NODE_ENV === 'production',
  trustProxy: onVercel || process.env.TRUST_PROXY === '1',
  sessionHours: 12,
  contactRetentionDays: Number(process.env.CONTACT_RETENTION_DAYS) || 30,
  secret: loadSecret(),
  limits: {
    reportsPerHour: Number(process.env.REPORTS_PER_HOUR) || 5,
    reportsPerDay: Number(process.env.REPORTS_PER_DAY) || 20,
    // Vercel functions accept request bodies up to 4.5 MB; photos are compressed in the browser to well below this.
    photoBytes: (onVercel ? 4 : 6) * 1024 * 1024,
    minFormSeconds: 4,
    maxReportAgeDays: 14,
  },
};
