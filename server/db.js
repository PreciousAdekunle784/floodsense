import { createClient } from '@libsql/client';
import { config } from './config.js';

/*
 * Storage: SQLite via libSQL.
 *  - Local / offline demo: a file in $FLOODSENSE_DATA_DIR (no setup, works without internet).
 *  - Hosted (Vercel): a Turso database, selected by TURSO_DATABASE_URL + TURSO_AUTH_TOKEN.
 * The same SQL runs in both. Spatial predicates are evaluated in server/geo.js.
 * server/sql/postgis_schema.sql is the equivalent PostgreSQL + PostGIS design for a larger deployment.
 */
const client = createClient(
  config.tursoUrl ? { url: config.tursoUrl, authToken: config.tursoToken } : { url: `file:${config.dbPath}` },
);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','verifier')),
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id              INTEGER PRIMARY KEY,
  ref             TEXT NOT NULL UNIQUE,
  lat             REAL NOT NULL,
  lon             REAL NOT NULL,
  location_method TEXT NOT NULL CHECK (location_method IN ('map','gps','search')),
  lga_id          INTEGER,
  lga_name        TEXT,
  community       TEXT,
  severity        INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 4),
  description     TEXT NOT NULL,
  observed_at     TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','duplicate')),
  flagged         INTEGER NOT NULL DEFAULT 0,
  flags           TEXT NOT NULL DEFAULT '[]',
  duplicate_of    INTEGER REFERENCES reports(id),
  photo_file      TEXT,
  contact_name    TEXT,
  contact_phone   TEXT,
  contact_email   TEXT,
  contact_consent INTEGER NOT NULL DEFAULT 0,
  contact_purged_at TEXT,
  ip_hash         TEXT,
  geo_class       INTEGER,
  geo_index       REAL,
  geo_hand_m      REAL,
  geo_dist_m      REAL,
  geo_elev_m      REAL,
  geo_ref_water   INTEGER,
  reviewed_by     INTEGER REFERENCES users(id),
  reviewed_at     TEXT,
  review_note     TEXT,
  is_demo         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_reports_latlon ON reports(lat, lon);
CREATE INDEX IF NOT EXISTS idx_reports_ip ON reports(ip_hash, created_at);
CREATE TABLE IF NOT EXISTS photos (
  id         TEXT PRIMARY KEY,      -- referenced by reports.photo_file
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,         -- metadata-stripped image bytes
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_events (
  id          INTEGER PRIMARY KEY,
  report_id   INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_report ON review_events(report_id);
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_failures (
  key        TEXT NOT NULL,          -- sha256(email | salted client hash)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_failures ON login_failures(key, created_at);
`;

const toObj = (rs, row) => {
  const o = {};
  rs.columns.forEach((c, i) => { o[c] = row[i]; });
  return o;
};

let ready = null;
/** Creates the schema once per process (idempotent). Every query awaits it. */
export function init() {
  ready ??= (async () => {
    if (!config.tursoUrl) await client.executeMultiple('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
    await client.executeMultiple(SCHEMA);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

async function exec(sql, args) {
  await init();
  return client.execute({ sql, args });
}

export const db = {
  async get(sql, ...args) {
    const rs = await exec(sql, args);
    return rs.rows.length ? toObj(rs, rs.rows[0]) : undefined;
  },
  async all(sql, ...args) {
    const rs = await exec(sql, args);
    return rs.rows.map((r) => toObj(rs, r));
  },
  async run(sql, ...args) {
    const rs = await exec(sql, args);
    return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid == null ? null : Number(rs.lastInsertRowid) };
  },
  /** Atomic multi-statement write. Each entry: [sql, ...args]. */
  async batch(stmts) {
    await init();
    await client.batch(stmts.map(([sql, ...args]) => ({ sql, args })), 'write');
  },
  async exec(sql) {
    await init();
    await client.executeMultiple(sql);
  },
};

export const nowIso = () => new Date().toISOString();
export const usingTurso = !!config.tursoUrl;
