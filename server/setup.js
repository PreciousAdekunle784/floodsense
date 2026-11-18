/*
 * FloodSense setup CLI
 *   npm run setup                         create the first admin (if none) and seed demo reports
 *   npm run setup -- --no-demo            create admin only
 *   npm run setup -- --add-user EMAIL --role verifier
 *   npm run demo:reset                    delete and re-create synthetic demo reports
 *
 * Credentials come from FLOODSENSE_ADMIN_EMAIL / FLOODSENSE_ADMIN_PASSWORD. If no password is supplied a
 * strong random one is generated and printed once — it is never stored in plain text.
 */
import crypto from 'node:crypto';
import { hashPassword } from './auth.js';
import { db } from './db.js';
import { seedDemo } from './demo.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const genPassword = () => crypto.randomBytes(12).toString('base64url');

function createUser(email, name, role, password) {
  const pw = password || genPassword();
  if (pw.length < 10) throw new Error('Password must be at least 10 characters.');
  db.prepare('INSERT INTO users (email, name, role, password_hash) VALUES (?,?,?,?)').run(email.toLowerCase(), name, role, hashPassword(pw));
  console.log(`\n  Created ${role}: ${email}`);
  if (!password) console.log(`  Generated password: ${pw}\n  (shown once — store it securely)\n`);
}

if (flag('--reset-demo')) {
  console.log(`Re-seeded ${seedDemo({ reset: true })} synthetic demo reports.`);
} else if (opt('--add-user')) {
  createUser(opt('--add-user'), opt('--name') || opt('--add-user').split('@')[0], opt('--role') === 'admin' ? 'admin' : 'verifier', process.env.FLOODSENSE_USER_PASSWORD);
} else {
  const n = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (n === 0) {
    createUser(process.env.FLOODSENSE_ADMIN_EMAIL || 'admin@floodsense.local', process.env.FLOODSENSE_ADMIN_NAME || 'FloodSense Admin',
      'admin', process.env.FLOODSENSE_ADMIN_PASSWORD);
  } else console.log(`${n} user account(s) already exist — not creating another admin.`);
  if (!flag('--no-demo')) {
    const s = seedDemo();
    console.log(s ? `Seeded ${s} synthetic demo reports (labelled DEMO in the app).` : 'Demo reports already present.');
  }
}
