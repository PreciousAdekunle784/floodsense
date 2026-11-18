// Unit tests for model maths, geo predicates, validation and photo sanitising.  Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.FLOODSENSE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-unit-'));
const { ahp, matrixFromUpper } = await import('../../src/lib/ahp.js');
const { jenks } = await import('../../src/lib/grid.js');
const geo = await import('../geo.js');
const { validateReport, stripJpegMetadata } = await import('../reports.js');
const { hashPassword, verifyPassword } = await import('../auth.js');
const model = JSON.parse(fs.readFileSync(new URL('../../public/data/model.json', import.meta.url)));

test('AHP in the browser reproduces the pipeline weights and consistency ratio', () => {
  const r = ahp(matrixFromUpper(6, model.ahp.matrix));
  model.factors.forEach((f, i) => assert.ok(Math.abs(r.weights[i] - f.weight) < 1e-3, f.key));
  assert.ok(Math.abs(r.cr - model.ahp.cr) < 1e-3);
  assert.ok(r.cr < 0.1);
});

test('AHP of a perfectly consistent matrix has CR = 0', () => {
  const p = [4, 2, 1];
  const upper = p.map((a) => p.map((b) => a / b));
  const r = ahp(matrixFromUpper(3, upper));
  assert.ok(r.cr < 1e-9);
  assert.ok(Math.abs(r.weights[0] - 4 / 7) < 1e-6);
});

test('Jenks finds obvious natural breaks', () => {
  const v = [1, 1.1, 1.2, 5, 5.1, 5.2, 9, 9.1, 9.3].sort((a, b) => a - b);
  const b = jenks(v, 3);
  assert.equal(b[1], 1.2);
  assert.equal(b[2], 5.2);
});

test('point-in-polygon: Abeokuta and Ijebu-Ode are in Ogun; Ikeja (Lagos) and Ibadan are not', () => {
  assert.equal(geo.insideOgun(7.155, 3.345), true);
  assert.equal(geo.lgaAt(6.82, 3.92)?.name, 'Ijebu Ode');
  assert.equal(geo.insideOgun(6.60, 3.35), false);
  assert.equal(geo.insideOgun(7.38, 3.93), false);
});

test('grid sampling returns terrain context consistent with the model', () => {
  const g = geo.sampleGrid(7.155, 3.345);
  assert.ok(g.cls >= 1 && g.cls <= 6);
  assert.ok(g.elev_m > 0 && g.elev_m < 400);
  if (g.index != null) assert.ok(g.index >= 0 && g.index <= 1);
});

test('report validation enforces required fields, time window and consent', () => {
  const base = { lat: 7, lon: 3.4, severity: 2, description: 'Water over the road near the bridge', observed_at: new Date().toISOString() };
  assert.deepEqual(validateReport(base).errors, {});
  assert.ok(validateReport({ ...base, severity: 7 }).errors.severity);
  assert.ok(validateReport({ ...base, description: 'flood' }).errors.description);
  assert.ok(validateReport({ ...base, observed_at: new Date(Date.now() + 3600e3).toISOString() }).errors.observed_at);
  assert.ok(validateReport({ ...base, observed_at: '2020-01-01' }).errors.observed_at);
  assert.ok(validateReport({ ...base, contact_phone: '+234 800' + '0000000' }).errors.contact_consent);
  const v = validateReport({ ...base, contact_name: 'A', contact_consent: '1' });
  assert.equal(v.value.contact_consent, 1);
});

test('JPEG metadata (EXIF/GPS) is stripped', () => {
  const src = fs.readFileSync(new URL('../../tests/fixtures/flood-with-exif.jpg', import.meta.url));
  assert.ok(src.includes(Buffer.from('Exif')));
  const out = stripJpegMetadata(src);
  assert.ok(!out.includes(Buffer.from('Exif')));
  assert.equal(out[0], 0xff); assert.equal(out[1], 0xd8);
  assert.ok(out.length > 10000);
});

test('passwords are hashed with scrypt and verified in constant time', () => {
  const h = hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$/);
  assert.equal(verifyPassword('correct horse battery', h), true);
  assert.equal(verifyPassword('wrong', h), false);
});
