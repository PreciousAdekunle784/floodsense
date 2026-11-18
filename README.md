# FloodSense — Ogun State

**See the risk. Understand the location. Prepare before disaster.**

FloodSense is a working GIS prototype that connects three sources of flood intelligence for Ogun State, Nigeria:

1. **Geographic and environmental data** — a flood-susceptibility model built from the Copernicus DEM, ESA
   WorldCover, NASA GPM IMERG rainfall and a DEM-derived drainage network, checked against 37 years of
   Landsat-observed water.
2. **Community-reported flood incidents** — a mobile-first reporting flow with a verification workflow,
   anti-spam safeguards and privacy protection.
3. **Location-based preparedness** — plain-language explanations and guidance for any point in the state.

> FloodSense is a prototype. It shows **susceptibility** (a property of the land), **community reports**
> (pending or verified), and the **satellite record of observed water**. It does **not** forecast floods or issue
> warnings; it points users to NIHSA, NiMet and Ogun State agencies for those.

* Methodology and data sources: [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md)
* Live demonstration script and judge Q&A: [`docs/DEMO_GUIDE.md`](docs/DEMO_GUIDE.md)

---

## Quick start (runs offline once installed)

Requirements: **Node.js 22.13 or newer** (uses the built-in `node:sqlite`). No database server and no API keys are needed.

```bash
npm install
```

```bash
npm run build
```

```bash
FLOODSENSE_ADMIN_PASSWORD='choose-a-strong-password' npm run setup
```

```bash
npm start
```

Open <http://localhost:8080>. Sign in at **Verify** with `admin@floodsense.local` and the password you chose.
If you leave `FLOODSENSE_ADMIN_PASSWORD` empty, `npm run setup` generates a strong password and prints it once.
`setup` also seeds 24 **synthetic demo reports** (clearly badged in the UI; hide them with the "Include synthetic
demo reports" toggle, reset them with `npm run demo:reset`).

Development with hot reload (API on :8080, UI on :5173 with proxy):

```bash
npm run dev
```

### Tests

```bash
npm test
```

```bash
npm run build && npm run e2e
```

`npm test` runs 8 unit tests (AHP maths, Jenks, point-in-polygon, validation, EXIF stripping, password hashing).
`npm run e2e` starts an isolated server with a temporary database and drives the real UI in Chromium through 30
checks: map loading, inspection, layers, search, a full report with photo, public privacy, admin login, CSRF,
verification, dashboard update, refresh persistence, spam safeguards and the mobile layout. It needs Playwright
with Chromium available. Screenshots go to `test-results/`.

---

## What is genuinely functional

| Module | Working features |
|---|---|
| **A · Map** | MapLibre map of Ogun State and its 20 LGAs; zoom, pan, rotate, 3D terrain; layers for susceptibility, drainage network (Strahler order), observed surface water, elevation colour relief, hillshade, land cover, LGA boundaries, towns and reports; legend; offline terrain basemap plus optional online Streets/Satellite with automatic fallback; gazetteer search (LGAs, towns, coordinates, report references); point and LGA inspection panels |
| **B · Analysis** | Python pipeline from raw open data to classes; AHP with eigenvector weights and consistency ratio; **in-browser re-computation** of the whole state when a user edits the pairwise matrix; Jenks classification; consistency check (AUC, frequency ratio) recomputed per scenario; sensitivity analysis |
| **C · Reporting** | 4-step form (map tap / GPS / search, severity, description, time, optional photo and consented contact); client-side photo re-encoding; server-side validation, Ogun boundary check, LGA assignment and terrain context; reference code and status tracking; immediate pending marker on the map |
| **D · Dashboard** | KPIs, daily activity by status, reports by LGA, reports vs susceptibility, severity, IMERG rainfall vs normal (to Oct 2026), sortable LGA exposure table, data freshness — all computed live from the database or GIS outputs |
| **E · Preparedness** | Class-specific explanations and actions in the inspector; before/during/after guidance; official information sources by name; clear separation from warnings |
| **F · Verification** | Real authentication (scrypt, server-side sessions, HttpOnly SameSite=Strict cookie, CSRF tokens, login throttling); queue with filters and search; map of all reports; GIS consistency signals; corroboration within 1.5 km/48 h; automated quality flags; verify / reject (reason required) / duplicate / re-open / flag; per-report audit trail; data-quality and activity views; demo reset (admin role) |

## Illustrative or simulated

* **24 synthetic demo reports** (`server/demo.js`, fixed seed). Random locations inside Ogun, biased toward higher
  susceptibility, generic text, refs starting `FS-D`, badged "Synthetic demo" everywhere and excludable from every view.
* **AHP judgements** are the team's documented expert judgements, not calibrated weights.
* The **consistency check** uses Landsat-observed water as a proxy, not a flood-event inventory.
* **Preparedness guidance** is general advice keyed to susceptibility class — not a location-specific forecast.

## Not yet integrated

Sentinel-1 SAR flood extents, a historical flood-event inventory (NEMA/OGSEMA/NIHSA), official forecasts and
warnings, OSM buildings/roads for exposure, soil data, Oyan Dam release scenarios, SMS/USSD reporting, PostGIS in
production. See [`docs/METHODOLOGY.md` §10](docs/METHODOLOGY.md#10-path-to-operational-use).

---

## Architecture

```
pipeline/            Python GIS pipeline (rasterio, GeoPandas, pysheds, xarray, scipy)
  01_acquire.py      downloads open datasets
  02_terrain.py      DEM conditioning, D8 flow, drainage network, slope, HAND, distance, TWI
  03_factors.py      WorldCover, JRC Global Surface Water, GPM IMERG on the same 90 m UTM grid
  04_model.py        memberships, AHP, weighted overlay, Jenks, consistency check, LGA statistics
  05_web_export.py   Web-Mercator grid bundles, vectors, Terrarium DEM tiles → public/data
  run_all.sh         rebuilds everything
public/data/         exported GIS layers served to the browser and read by the server (committed: ~36 MB)
server/              Node.js + Express 5 API
  index.js           routes, security headers, static hosting
  db.js              SQLite schema (node:sqlite)
  auth.js            scrypt passwords, sessions, CSRF, throttling
  reports.js         validation, safeguards, photo sanitising, public read model, statistics
  admin.js           verification API, audit, data quality, demo reset
  geo.js             point-in-polygon, grid sampling, nearest place
  demo.js            synthetic demo data
  setup.js           first admin + demo seeding CLI
  sql/postgis_schema.sql   production PostgreSQL/PostGIS schema
src/                 React 19 + MapLibre GL 5 client (Vite)
  lib/grid.js        client raster engine: weighted overlay, Jenks, AUC, rendering
  lib/ahp.js         AHP eigenvector + consistency ratio
  components/        MapView, LayerPanel, Inspector, ReportFlow, SearchBox, DemoGuide
  pages/             Explore, Insights, Model, Data, Prepare, Admin, Track
tests/e2e.mjs        Playwright end-to-end suite
```

**Data flow.** The pipeline writes compact rasters (`grid-core.bin.gz`, 3.2 MB) that both the browser and the
server read. The browser renders and re-classifies the susceptibility surface itself; the server uses the same grid
to attach LGA and terrain context to each report. Reports live in SQLite (`data/floodsense.db`); photos in
`data/uploads/`.

### Database schema (SQLite)

| Table | Purpose |
|---|---|
| `users` | verifiers/admins: email, role, scrypt hash |
| `sessions` | SHA-256 of session token, CSRF token, expiry |
| `reports` | location, LGA, severity, description, times, status, flags, duplicate link, photo file; private contact fields; GIS context (`geo_class`, `geo_index`, `geo_hand_m`, `geo_dist_m`, `geo_elev_m`, `geo_ref_water`); review fields; `is_demo` |
| `review_events` | audit trail per report (actor, action, from/to status, note) |
| `audit_log` | sign-ins, failed sign-ins, demo resets |

The schema is created automatically on first start. `server/sql/postgis_schema.sql` gives the equivalent PostGIS
design with spatial indexes, an LGA-assignment trigger and a privacy-safe public view (not executed in this build).

### Security and privacy

* No default credentials; admins are created from the CLI. No secrets in the frontend.
* Public endpoints never return contact details or IP hashes. Pending reports: no text, no photo, location rounded
  to ~110 m. Photos are published only after verification.
* Photos are re-encoded in the browser and JPEG/PNG metadata segments are stripped on the server (EXIF GPS removed).
* Contact details require explicit consent and are purged 30 days after review.
* Safeguards: HMAC-signed form tokens with a 4-second minimum fill time, honeypot, per-device rate limits
  (salted IP hashes; raw IPs are not stored), boundary check, time-window check, automated quality flags.
* Strict Content-Security-Policy, `nosniff`, `frame-ancestors 'none'`, same-origin referrer.

## Configuration

See [`.env.example`](.env.example). Key variables: `PORT`, `FLOODSENSE_DATA_DIR`, `FLOODSENSE_ADMIN_EMAIL`,
`FLOODSENSE_ADMIN_PASSWORD`, `NODE_ENV`, `COOKIE_SECURE`, `TRUST_PROXY`, `REPORTS_PER_HOUR`,
`CONTACT_RETENTION_DAYS`. A `.env` file in the project root is loaded automatically by `npm start` / `npm run setup`.

## Deployment

FloodSense is a single Node.js process serving the API and the built UI, so it fits any Node 22 host (a VPS,
Render, Railway, Fly.io).

1. `npm ci && npm run build`
2. Set `NODE_ENV=production` (enables Secure cookies — HTTPS required), `TRUST_PROXY=1` behind a proxy or PaaS,
   and `FLOODSENSE_DATA_DIR` to a **persistent volume**.
3. `npm run setup` once (with `FLOODSENSE_ADMIN_PASSWORD` set), then `npm start`.
4. Put it behind HTTPS (required for secure cookies and for phone GPS).

It has **not** been deployed as part of this build. For multi-instance production, move to PostgreSQL/PostGIS
and object storage for photos.

## Rebuilding the GIS layers

```bash
cd pipeline && ./run_all.sh
```

Takes ~6 minutes and ~300 MB of downloads; needs access to AWS Open Data, Google Cloud public storage and GitHub.
Outputs are already committed in `public/data`, so this is only needed to change the model.

## Credits and licences

Copernicus DEM © DLR e.V. 2010–2014 and © Airbus 2014–2018, provided under COPERNICUS by the EU and ESA ·
ESA WorldCover 2021 (CC BY 4.0) · NASA GPM IMERG via NASA POWER · JRC Global Surface Water (Pekel et al., 2016) ·
geoBoundaries (CC BY 4.0) · GeoNames (CC BY 4.0) · Natural Earth · OpenStreetMap contributors and Esri (optional online basemaps).
