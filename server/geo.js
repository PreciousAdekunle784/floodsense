/*
 * Server-side geospatial context.
 * Loads the same exported GIS layers the browser uses (public/data) and answers:
 *   - is a point inside Ogun State? which LGA?
 *   - what is the modelled susceptibility / terrain context at a point?
 *   - which reports are near a point (haversine)?
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from './config.js';

const D = config.publicDataDir;
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));

const state = readJson('state.geojson').features[0];
const lgas = readJson('lgas.geojson').features;
const model = readJson('model.json');
const gridMeta = readJson('grid.json');
const places = readJson('places.geojson').features;

const bundles = {};
for (const b of ['core', 'detail']) {
  bundles[b] = zlib.gunzipSync(fs.readFileSync(path.join(D, `grid-${b}.bin.gz`)));
}
const layer = {};
for (const l of gridMeta.layers) {
  const buf = bundles[l.bundle];
  const n = gridMeta.width * gridMeta.height;
  layer[l.name] = l.type === 'uint8'
    ? new Uint8Array(buf.buffer, buf.byteOffset + l.offset, n)
    : new Uint16Array(buf.buffer.slice(buf.byteOffset + l.offset, buf.byteOffset + l.offset + n * 2));
}

const R = 6378137;
const toMerc = (lon, lat) => [R * (lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polyContains(geom, x, y) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.some((p) => ringContains(p[0], x, y) && !p.slice(1).some((h) => ringContains(h, x, y)));
}

export function insideOgun(lat, lon) {
  return polyContains(state.geometry, lon, lat);
}

export function lgaAt(lat, lon) {
  const f = lgas.find((g) => polyContains(g.geometry, lon, lat));
  return f ? { id: f.properties.lga_id, name: f.properties.name } : null;
}

const weights = Object.fromEntries(model.factors.map((f) => [f.key, f.weight]));
const breaks = model.classification.breaks;

export function sampleGrid(lat, lon) {
  const [x, y] = toMerc(lon, lat);
  const col = Math.floor((x - gridMeta.origin[0]) / gridMeta.cell_m);
  const row = Math.floor((gridMeta.origin[1] - y) / gridMeta.cell_m);
  if (col < 0 || row < 0 || col >= gridMeta.width || row >= gridMeta.height) return null;
  const i = row * gridMeta.width + col;
  const cls = layer.cls[i];
  let index = null;
  if (cls >= 1 && cls <= 5) {
    index = 0;
    for (const k of Object.keys(weights)) index += (weights[k] * layer[`m_${k}`][i]) / 255;
  }
  return {
    cls,
    index,
    hand_m: layer.hand[i] / 10,
    dist_m: layer.dist[i],
    elev_m: layer.elev[i] - 100,
    slope_deg: layer.slope[i] / 100,
    ref_water: layer.ref[i],
    landcover: layer.lc[i],
    builtup_pct: layer.builtup[i],
    rain_mm: layer.rain[i],
  };
}

export function geoContext(lat, lon) {
  const inside = insideOgun(lat, lon);
  const lga = inside ? lgaAt(lat, lon) : null;
  const g = sampleGrid(lat, lon);
  return { inside, lga, grid: g, nearestPlace: nearestPlace(lat, lon) };
}

export function haversine(lat1, lon1, lat2, lon2) {
  const r = 6371008.8;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function nearestPlace(lat, lon) {
  let best = null;
  for (const p of places) {
    const [plon, plat] = p.geometry.coordinates;
    const d = haversine(lat, lon, plat, plon);
    if (!best || d < best.distance_m) best = { name: p.properties.name, lga: p.properties.lga, distance_m: Math.round(d) };
  }
  return best;
}

export const geoData = { model, gridMeta, lgas: lgas.map((f) => f.properties) };
