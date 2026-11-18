-- FloodSense production schema for PostgreSQL 15+ with PostGIS 3+.
-- The prototype uses SQLite (server/db.js) with the same tables and columns; this file is the
-- migration target for a multi-user deployment. Spatial predicates move from JavaScript into SQL.
-- NOTE: provided as a design artefact; it has not been run against a live PostGIS server in this build.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE lgas (
  lga_id      smallint PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  geom        geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX lgas_geom_idx ON lgas USING gist (geom);

CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  email         citext UNIQUE NOT NULL,          -- CREATE EXTENSION citext;
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'verifier')),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TYPE report_status AS ENUM ('pending', 'verified', 'rejected', 'duplicate');

CREATE TABLE reports (
  id              bigserial PRIMARY KEY,
  ref             text UNIQUE NOT NULL,
  geom            geometry(Point, 4326) NOT NULL,
  location_method text NOT NULL CHECK (location_method IN ('map', 'gps', 'search')),
  lga_id          smallint REFERENCES lgas(lga_id),
  community       text,
  severity        smallint NOT NULL CHECK (severity BETWEEN 1 AND 4),
  description     text NOT NULL,
  observed_at     timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  status          report_status NOT NULL DEFAULT 'pending',
  flagged         boolean NOT NULL DEFAULT false,
  flags           jsonb NOT NULL DEFAULT '[]',
  duplicate_of    bigint REFERENCES reports(id),
  photo_key       text,                          -- object-storage key (private bucket)
  -- private
  contact_name    text,
  contact_phone   text,
  contact_email   text,
  contact_consent boolean NOT NULL DEFAULT false,
  contact_purged_at timestamptz,
  ip_hash         text,
  -- GIS context at submission
  geo_class       smallint,
  geo_index       real,
  geo_hand_m      real,
  geo_dist_m      real,
  geo_elev_m      real,
  geo_ref_water   smallint,
  reviewed_by     bigint REFERENCES users(id),
  reviewed_at     timestamptz,
  review_note     text,
  is_demo         boolean NOT NULL DEFAULT false
);
CREATE INDEX reports_geom_idx ON reports USING gist (geom);
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);
CREATE INDEX reports_ip_idx ON reports (ip_hash, created_at);

-- Pilot-area check and LGA assignment in SQL
CREATE OR REPLACE FUNCTION assign_lga() RETURNS trigger AS $$
BEGIN
  SELECT lga_id INTO NEW.lga_id FROM lgas WHERE ST_Intersects(geom, NEW.geom) LIMIT 1;
  IF NEW.lga_id IS NULL THEN RAISE EXCEPTION 'Location outside the Ogun State pilot area'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER reports_assign_lga BEFORE INSERT ON reports FOR EACH ROW EXECUTE FUNCTION assign_lga();

-- Public read model: never exposes private columns; pending locations snapped to ~110 m
CREATE VIEW public_reports AS
SELECT ref, status, severity, l.name AS lga, community, observed_at, created_at,
       CASE WHEN status = 'verified' THEN reviewed_at END AS verified_at,
       CASE WHEN status = 'verified' THEN description END AS description,
       CASE WHEN status = 'verified' THEN ST_SnapToGrid(r.geom, 0.0001) ELSE ST_SnapToGrid(r.geom, 0.001) END AS geom,
       geo_class, is_demo
FROM reports r LEFT JOIN lgas l USING (lga_id)
WHERE status IN ('pending', 'verified');

-- Corroboration query used by verifiers: reports within 1.5 km and 48 h
-- SELECT b.ref, ST_Distance(a.geom::geography, b.geom::geography) AS metres
-- FROM reports a JOIN reports b ON a.id <> b.id
--  AND ST_DWithin(a.geom::geography, b.geom::geography, 1500)
--  AND abs(extract(epoch FROM a.observed_at - b.observed_at)) <= 48*3600
-- WHERE a.id = $1;

CREATE TABLE review_events (
  id          bigserial PRIMARY KEY,
  report_id   bigint NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id     bigint REFERENCES users(id),
  actor       text NOT NULL,
  action      text NOT NULL,
  from_status report_status,
  to_status   report_status,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    bigint REFERENCES users(id),
  action     text NOT NULL,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Susceptibility raster (optional, for server-side raster queries)
-- raster2pgsql -s 32631 -t 256x256 -I pipeline/data/processed/susc_class.tif susceptibility | psql
