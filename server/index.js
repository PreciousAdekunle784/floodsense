/*
 * Local / self-hosted entry point: API + built UI + GIS data from one Node process.
 * (On Vercel, static files are served by the CDN and api/index.js wraps server/app.js.)
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { app, errorHandler } from './app.js';
import { config } from './config.js';
import { db, init, usingTurso } from './db.js';
import { purgeContacts } from './reports.js';

// GIS layers (also copied into dist/ by the build). Long cache for immutable tiles.
app.use('/data/dem', express.static(path.join(config.publicDataDir, 'dem'), { maxAge: '7d', immutable: true }));
app.use('/data', express.static(config.publicDataDir, { maxAge: '1h' }));

if (fs.existsSync(path.join(config.distDir, 'index.html'))) {
  app.use(express.static(config.distDir, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/|\/data\/).*/, (req, res) => res.sendFile(path.join(config.distDir, 'index.html')));
} else {
  app.get('/', (req, res) => res.type('text').send('FloodSense API is running. Build the UI with `npm run build`, or use `npm run dev`.'));
}
app.use(errorHandler);

await init();
await purgeContacts();
setInterval(() => purgeContacts().catch(console.error), 3600e3).unref();

if ((await db.get('SELECT COUNT(*) n FROM users')).n === 0) {
  console.warn('\n  No verifier accounts exist yet. Run `npm run setup` to create the first admin.\n');
}
app.listen(config.port, config.host, () => {
  console.log(`FloodSense running at http://localhost:${config.port} (database: ${usingTurso ? 'Turso' : 'local SQLite file'})`);
});
