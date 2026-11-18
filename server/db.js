import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

/*
 * Storage: SQLite (built into Node >= 22.13) so the prototype runs offline with zero setup.
 * Spatial predicates (point-in-polygon, nearest/nearby) are evaluated in server/geo.js.
 * server/sql/postgis_schema.sql contains the equivalent PostgreSQL + PostGIS schema
 * for a production deployment.
 */
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

db.exec(`
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
  token_hash  TEXT PRIMARY KEY,           -- sha256 of the cookie token; raw token never stored
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id              INTEGER PRIMARY KEY,
  ref             TEXT NOT NULL UNIQUE,      -- public reference code given to the reporter
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
  flags           TEXT NOT NULL DEFAULT '[]',  -- JSON array of automated/manual quality flags
  duplicate_of    INTEGER REFERENCES reports(id),
  photo_file      TEXT,
  -- private fields: never returned by public endpoints
  contact_name    TEXT,
  contact_phone   TEXT,
  contact_email   TEXT,
  contact_consent INTEGER NOT NULL DEFAULT 0,
  contact_purged_at TEXT,
  ip_hash         TEXT,
  -- GIS context sampled at submission time from the susceptibility model
  geo_class       INTEGER,
  geo_index       REAL,
  geo_hand_m      REAL,
  geo_dist_m      REAL,
  geo_elev_m      REAL,
  geo_ref_water   INTEGER,
  -- review
  reviewed_by     INTEGER REFERENCES users(id),
  reviewed_at     TEXT,
  review_note     TEXT,
  is_demo         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_reports_latlon ON reports(lat, lon);
CREATE INDEX IF NOT EXISTS idx_reports_ip ON reports(ip_hash, created_at);

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
`);

export const nowIso = () => new Date().toISOString();

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
