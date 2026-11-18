# Deploying FloodSense on Vercel with Turso

On Vercel:
- **Static files on the CDN:** the map, pages and GIS layers (`dist/`, including `data/`).
- **API as one serverless function:** `api/index.js`, which wraps `server/app.js`.
- **Reports, accounts, sessions and photos in Turso:** a hosted SQLite (libSQL) database. Vercel's disk is not persistent, so they can't stay on the server.

Your laptop demo still works offline. Without the Turso variables, `npm start` uses the local file `data/floodsense.db`.

Allow about 20 minutes. Both services have free tiers (Vercel Hobby, Turso Free).

---

## 1. Create the Turso database

**Option A: Turso dashboard (no install).** Sign up at turso.tech and create a database named `floodsense`. Pick
the location closest to Nigeria (a European region). Then copy:
- the database **URL**, which looks like `libsql://floodsense-<org>.turso.io`
- a database **auth token** (Generate token → read & write)

**Option B: Turso CLI.**

```bash
turso db create floodsense
```

```bash
turso db show floodsense --url
```

```bash
turso db tokens create floodsense
```

## 2. Create the schema, first admin and demo data (from your computer)

```bash
cp .env.turso.example .env.turso
```

Edit `.env.turso`: paste `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, and set `FLOODSENSE_ADMIN_PASSWORD`. Then run:

```bash
npm run setup:turso
```

The first line printed should be `Database: Turso (libsql://…)`. This command creates the tables and the admin account, and seeds the 24 synthetic demo reports. To skip the demo data, add `-- --no-demo`.

`.env.turso` is git-ignored. Never commit the token.

## 3. Generate a server secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep the output for the next step. It signs form tokens and salts IP hashes, and every serverless instance must use the same value.

## 4. Import the project into Vercel

1. Go to vercel.com → **Add New… → Project** → import the `floodsense` GitHub repository.
2. **Framework preset:** Other. Leave the build settings alone; `vercel.json` sets them:
   - build: `npm run build`
   - output: `dist`
   - function: `api/index.js`
3. **Environment variables** (Production and Preview):

| Name | Value |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://floodsense-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | the token from step 1 |
| `FLOODSENSE_SECRET` | the value from step 3 |
| `NODEJS_HELPERS` | `0` (turns off Vercel's request-body helpers so Express and multer read uploads themselves) |

   If you add Turso through the Vercel Marketplace integration instead, it creates the database variables for you. Check that they are named exactly `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
4. Click **Deploy**.

**Branch:** Vercel builds production from the repository's default branch. FloodSense is on
`claude/confident-ramanujan-cx9lxb`. Either merge it into `main`, or set Project Settings → Git → Production Branch to that branch. Pushes to any other branch get a preview URL.

**Region (optional, faster):** in Project Settings → Functions → Region, choose the Vercel region nearest your Turso database. For example, Dublin (`dub1`) for Turso in Ireland. The default is Washington, D.C. That works, but each API call adds about 80–150 ms.

## 5. Check the deployment

1. Open `https://<your-project>.vercel.app/api/health`. It should return `{"ok":true,…,"reports":24}`.
2. Open the site. The map, layers, Insights and Model pages should load.
3. Submit a test report from your phone (GPS works because Vercel serves HTTPS).
4. Sign in at **Verify** with the admin account from step 2. Verify the report, then check that Insights updates.

## Limits and behaviour

- **Photo size:** Vercel functions accept requests up to 4.5 MB, so the server caps photos at 4 MB. The browser compresses them to about 0.2–0.5 MB first, so this is rarely reached.
- **Cold start:** the first API call after idle takes about 1–2 s while the function loads the 8 MB GIS grid. The map itself is static and loads immediately.
- **Background work:** the contact-details purge (30-day retention) runs when verifiers use the console, because serverless functions have no background timer. Login throttling and rate limits are stored in the database, so they hold across instances.
- **Hobby plan:** Vercel's Hobby plan is for non-commercial use, which fits the competition prototype. A production service should move to a paid plan, or to PostgreSQL/PostGIS (`server/sql/postgis_schema.sql`).

## What was tested here, and what wasn't

- **Tested in this repository:**
  - `vercel build` completes. The function bundle holds only the server code, its dependencies and the 10 GIS files it reads. No local database or secrets are included.
  - The full 30-check end-to-end suite passes against `scripts/vercel-sim.mjs` (`npm run e2e:vercel`). That simulation serves `dist/` with the `vercel.json` rewrites and headers, and calls the real `api/index.js` with `VERCEL=1` and production settings.
- **Not tested:** a live deployment on Vercel, and a live Turso database. I had no Vercel or Turso account. Turso uses the same libSQL client and the same SQL that is tested locally, but the network connection itself is unverified.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/api/*` returns 500 and the logs say `TURSO_DATABASE_URL is not set` or `FLOODSENSE_SECRET is not set` | Add the variable in Project Settings → Environment Variables, then redeploy. |
| Logs show `SERVER_ERROR` / 401 from Turso | The token is wrong or expired. Create a new one and update `TURSO_AUTH_TOKEN`. |
| Sign-in works but the session is lost straight away | Use the `https://` URL; session cookies are `Secure`. |
| Photo upload fails with 413 | The image is over 4 MB after compression. Choose a smaller photo. |
| Map is blank but `/api/health` works | Check the browser console. `/data/grid-core.bin.gz` must be served from the deployment; it is part of `dist/`. |
