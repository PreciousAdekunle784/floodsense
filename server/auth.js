/*
 * Authentication for verifiers/administrators.
 *  - Passwords: scrypt (N=2^15, r=8, p=1) with a per-user random salt, constant-time comparison.
 *  - Sessions: 256-bit random token in an HttpOnly, SameSite=Strict cookie; only its SHA-256 is stored.
 *  - CSRF: every state-changing admin request must echo the per-session CSRF token in a header.
 *  - Brute force: failed logins are throttled per (email, client) pair.
 * There are no default passwords: accounts are created with `npm run setup`.
 */
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, nowIso } from './db.js';

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const COOKIE = 'fs_session';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, n, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = Buffer.from(keyB64, 'base64');
  const test = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), key.length, { ...SCRYPT, N: Number(n) });
  return crypto.timingSafeEqual(key, test);
}

// Dummy hash so unknown emails take as long as wrong passwords (no user enumeration via timing)
const DUMMY = hashPassword(crypto.randomBytes(16).toString('hex'));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const clientHash = (req) => sha256(`${config.secret}:${req.ip || req.socket.remoteAddress || ''}`).slice(0, 32);

const failures = new Map(); // key -> {count, until, first}
const WINDOW = 15 * 60 * 1000;

function throttled(key) {
  const f = failures.get(key);
  return f && f.until && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
function recordFailure(key) {
  const now = Date.now();
  let f = failures.get(key);
  if (!f || now - f.first > WINDOW) f = { count: 0, first: now };
  f.count += 1;
  if (f.count >= 5) f.until = now + WINDOW;
  failures.set(key, f);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, value, maxAgeSec) {
  const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (config.secureCookies) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

export function login(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
  const password = String(req.body?.password || '').slice(0, 200);
  const key = `${email}|${clientHash(req)}`;
  const wait = throttled(key);
  if (wait) return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} min.` });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = verifyPassword(password, user ? user.password_hash : DUMMY) && !!user;
  if (!ok) {
    recordFailure(key);
    db.prepare('INSERT INTO audit_log (user_id, action, detail, created_at) VALUES (?,?,?,?)')
      .run(null, 'login_failed', JSON.stringify({ email }), nowIso());
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  failures.delete(key);
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const now = new Date();
  const exp = new Date(now.getTime() + config.sessionHours * 3600 * 1000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?,?,?,?,?)')
    .run(sha256(token), user.id, csrf, now.toISOString(), exp.toISOString());
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now.toISOString(), user.id);
  db.prepare('INSERT INTO audit_log (user_id, action, detail, created_at) VALUES (?,?,?,?)').run(user.id, 'login', null, nowIso());
  setCookie(res, token, config.sessionHours * 3600);
  res.json({ user: publicUser(user), csrf });
}

export function sessionFrom(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = db.prepare(`SELECT s.csrf_token, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
                          WHERE s.token_hash = ?`).get(sha256(token));
  if (!row || row.expires_at < nowIso()) return null;
  return { user: publicUser(row), csrf: row.csrf_token, tokenHash: sha256(token) };
}

export function me(req, res) {
  const s = sessionFrom(req);
  if (!s) return res.json({ user: null });
  res.json({ user: s.user, csrf: s.csrf });
}

export function logout(req, res) {
  const s = sessionFrom(req);
  if (s) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.tokenHash);
  setCookie(res, '', 0);
  res.json({ ok: true });
}

/** Middleware: require a valid session (and a CSRF header for unsafe methods). */
export function requireAuth(roles = ['admin', 'verifier']) {
  return (req, res, next) => {
    const s = sessionFrom(req);
    if (!s) return res.status(401).json({ error: 'Sign in required' });
    if (!roles.includes(s.user.role)) return res.status(403).json({ error: 'Insufficient role' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const h = req.get('x-csrf-token') || '';
      const a = Buffer.from(h);
      const b = Buffer.from(s.csrf);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'CSRF check failed' });
    }
    req.user = s.user;
    next();
  };
}
