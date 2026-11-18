/*
 * Client-side raster engine.
 * Loads the exported Web-Mercator grid (150 m) and performs the weighted-overlay model,
 * Jenks classification and the consistency check against observed surface water — in the browser.
 */
const R = 6378137;
export const toMerc = (lon, lat) => [R * (lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
export const toLonLat = (x, y) => [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];

export const FACTOR_KEYS = ['hand', 'dist', 'slope', 'twi', 'rain', 'lulc'];

async function fetchGz(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  if ('DecompressionStream' in window) {
    const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  throw new Error('This browser cannot decompress the map data (DecompressionStream unsupported).');
}

export async function loadGrid() {
  const meta = await (await fetch('/data/grid.json')).json();
  const buf = await fetchGz('/data/grid-core.bin.gz');
  const n = meta.width * meta.height;
  const L = {};
  for (const l of meta.layers.filter((x) => x.bundle === 'core')) L[l.name] = new Uint8Array(buf, l.offset, n);
  const [x0, y1] = meta.origin;
  const x1 = x0 + meta.width * meta.cell_m;
  const y0 = y1 - meta.height * meta.cell_m;
  const corners = [toLonLat(x0, y1), toLonLat(x1, y1), toLonLat(x1, y0), toLonLat(x0, y0)];
  return { meta, n, L, D: null, corners };
}

export async function loadDetail(grid) {
  if (grid.D) return grid.D;
  const buf = await fetchGz('/data/grid-detail.bin.gz');
  const D = {};
  for (const l of grid.meta.layers.filter((x) => x.bundle === 'detail')) D[l.name] = new Uint16Array(buf, l.offset, grid.n);
  grid.D = D;
  return D;
}

export function cellIndex(grid, lon, lat) {
  const [x, y] = toMerc(lon, lat);
  const c = Math.floor((x - grid.meta.origin[0]) / grid.meta.cell_m);
  const r = Math.floor((grid.meta.origin[1] - y) / grid.meta.cell_m);
  if (c < 0 || r < 0 || c >= grid.meta.width || r >= grid.meta.height) return -1;
  return r * grid.meta.width + c;
}

// ---------------------------------------------------------------- model
export function computeIndex(grid, weights) {
  const { L, n } = grid;
  const sum = FACTOR_KEYS.reduce((s, k) => s + (weights[k] || 0), 0) || 1;
  const w = FACTOR_KEYS.map((k) => (weights[k] || 0) / sum / 255);
  const m = FACTOR_KEYS.map((k) => L[`m_${k}`]);
  const idx = new Float32Array(n);
  const cls = L.cls;
  for (let i = 0; i < n; i++) {
    const c = cls[i];
    if (c < 1 || c > 5) { idx[i] = -1; continue; }
    idx[i] = w[0] * m[0][i] + w[1] * m[1][i] + w[2] * m[2][i] + w[3] * m[3][i] + w[4] * m[4][i] + w[5] * m[5][i];
  }
  return idx;
}

/** Fisher-Jenks natural breaks on a sorted sample. Returns k+1 break values. */
export function jenks(sorted, k) {
  const n = sorted.length;
  const mat1 = Array.from({ length: n + 1 }, () => new Int32Array(k + 1));
  const mat2 = Array.from({ length: n + 1 }, () => new Float64Array(k + 1).fill(Infinity));
  for (let j = 1; j <= k; j++) { mat1[1][j] = 1; mat2[1][j] = 0; }
  for (let l = 2; l <= n; l++) {
    let s1 = 0, s2 = 0, w = 0, v = 0;
    for (let m = 1; m <= l; m++) {
      const i3 = l - m + 1;
      const val = sorted[i3 - 1];
      s2 += val * val; s1 += val; w++;
      v = s2 - (s1 * s1) / w;
      const i4 = i3 - 1;
      if (i4 !== 0) {
        for (let j = 2; j <= k; j++) {
          if (mat2[l][j] >= v + mat2[i4][j - 1]) { mat1[l][j] = i3; mat2[l][j] = v + mat2[i4][j - 1]; }
        }
      }
    }
    mat1[l][1] = 1; mat2[l][1] = v;
  }
  const breaks = new Array(k + 1);
  breaks[k] = sorted[n - 1]; breaks[0] = sorted[0];
  let kk = n;
  for (let j = k; j > 1; j--) { breaks[j - 1] = sorted[mat1[kk][j] - 2]; kk = mat1[kk][j] - 1; }
  return breaks;
}

export function classify(grid, idx) {
  const vals = [];
  for (let i = 0; i < idx.length; i++) if (idx[i] >= 0) vals.push(idx[i]);
  vals.sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(vals.length / 3000));
  const sample = [];
  for (let i = 0; i < vals.length; i += step) sample.push(vals[i]);
  const breaks = jenks(sample, 5);
  breaks[0] = vals[0]; breaks[5] = vals[vals.length - 1];
  const cls = new Uint8Array(idx.length);
  const src = grid.L.cls;
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i];
    if (v < 0) { cls[i] = src[i] === 6 ? 6 : 0; continue; }
    cls[i] = v <= breaks[1] ? 1 : v <= breaks[2] ? 2 : v <= breaks[3] ? 3 : v <= breaks[4] ? 4 : 5;
  }
  return { cls, breaks };
}

/** Consistency check against JRC observed intermittent water (ref == 1). */
export function evaluate(grid, idx, cls) {
  const ref = grid.L.ref;
  const BINS = 1024;
  const pos = new Float64Array(BINS);
  const neg = new Float64Array(BINS);
  const area = new Float64Array(6);
  const hit = new Float64Array(6);
  let nValid = 0, nRef = 0;
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i];
    if (v < 0) continue;
    nValid++;
    const b = Math.min(BINS - 1, Math.floor(v * BINS));
    const isRef = ref[i] === 1;
    if (isRef) { pos[b]++; nRef++; } else neg[b]++;
    area[cls[i]]++;
    if (isRef) hit[cls[i]]++;
  }
  // AUC = P(score_pos > score_neg) + 0.5 P(tie), via cumulative histogram
  let cumNeg = 0, aucSum = 0;
  const totNeg = nValid - nRef;
  for (let b = 0; b < BINS; b++) { aucSum += pos[b] * (cumNeg + 0.5 * neg[b]); cumNeg += neg[b]; }
  const auc = nRef && totNeg ? aucSum / (nRef * totNeg) : null;
  const classes = [1, 2, 3, 4, 5].map((c) => {
    const ap = area[c] / nValid;
    const rp = nRef ? hit[c] / nRef : 0;
    return { cls: c, area_pct: 100 * ap, ref_pct: 100 * rp, fr: ap ? rp / ap : null };
  });
  return { auc, classes, nValid, nRef };
}

export function lgaClassShares(grid, cls) {
  const lga = grid.L.lga;
  const counts = {};
  for (let i = 0; i < cls.length; i++) {
    const g = lga[i];
    const c = cls[i];
    if (!g || c < 1 || c > 5) continue;
    (counts[g] ??= [0, 0, 0, 0, 0, 0])[c]++;
    counts[g][0]++;
  }
  const out = {};
  for (const [g, a] of Object.entries(counts)) out[g] = [1, 2, 3, 4, 5].map((c) => (100 * a[c]) / a[0]);
  return out;
}

// ---------------------------------------------------------------- rendering
export const CLASS_COLORS = {
  1: [246, 239, 210], 2: [242, 200, 121], 3: [232, 137, 60], 4: [200, 70, 43], 5: [127, 29, 42], 6: [47, 128, 237],
};

function toUrl(grid, fill) {
  const { width: W, height: H } = grid.meta;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  fill(img.data);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export function renderClasses(grid, cls) {
  return toUrl(grid, (d) => {
    for (let i = 0; i < cls.length; i++) {
      const c = cls[i];
      if (!c) continue;
      const col = CLASS_COLORS[c];
      const o = i * 4;
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = c === 1 ? 70 : c === 2 ? 175 : 255;
    }
  });
}

export function renderWater(grid) {
  const ref = grid.L.ref;
  return toUrl(grid, (d) => {
    for (let i = 0; i < ref.length; i++) {
      if (!ref[i]) continue;
      const o = i * 4;
      if (ref[i] === 1) { d[o] = 0; d[o + 1] = 200; d[o + 2] = 230; d[o + 3] = 255; }
      else { d[o] = 30; d[o + 1] = 100; d[o + 2] = 220; d[o + 3] = 255; }
    }
  });
}

export const LANDCOVER = {
  10: ['Tree cover', [0, 100, 0]], 20: ['Shrubland', [255, 187, 34]], 30: ['Grassland', [255, 255, 76]],
  40: ['Cropland', [240, 150, 255]], 50: ['Built-up', [250, 0, 0]], 60: ['Bare / sparse vegetation', [180, 180, 180]],
  80: ['Permanent water', [0, 100, 200]], 90: ['Herbaceous wetland', [0, 150, 160]], 95: ['Mangroves', [0, 207, 117]],
};

export function renderLandcover(grid) {
  const lc = grid.L.lc;
  return toUrl(grid, (d) => {
    for (let i = 0; i < lc.length; i++) {
      const e = LANDCOVER[lc[i]];
      if (!e) continue;
      const o = i * 4;
      d[o] = e[1][0]; d[o + 1] = e[1][1]; d[o + 2] = e[1][2]; d[o + 3] = 255;
    }
  });
}
