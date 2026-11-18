export const CLASS_NAMES = ['', 'Very low', 'Low', 'Moderate', 'High', 'Very high', 'Permanent water'];
export const CLASS_HEX = ['', '#f6efd2', '#f2c879', '#e8893c', '#c8462b', '#7f1d2a', '#2f80ed'];
export const STATUS = {
  pending: { label: 'Pending verification', short: 'Pending', color: '#fab219', icon: '◔' },
  verified: { label: 'Verified', short: 'Verified', color: '#0ca30c', icon: '✓' },
  rejected: { label: 'Rejected', short: 'Rejected', color: '#d03b3b', icon: '✕' },
  duplicate: { label: 'Duplicate', short: 'Duplicate', color: '#8a8f93', icon: '⧉' },
};
export const SEVERITY = {
  1: { name: 'Minor', hint: 'Water on roads or drains overflowing — still passable' },
  2: { name: 'Moderate', hint: 'Ankle-to-knee deep — entering compounds or shops' },
  3: { name: 'Severe', hint: 'Knee-to-waist deep — homes flooded, roads cut off' },
  4: { name: 'Extreme', hint: 'Life-threatening — people or vehicles trapped' },
};

export const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const pct = (n, d = 0) => (n == null ? '—' : `${fmt(n, d)}%`);
export const coord = (lat, lon) => `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
export const dist = (m) => (m == null ? '—' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

export function ago(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export function haversine(lat1, lon1, lat2, lon2) {
  const r = 6371008.8;
  const p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((((lon2 - lon1) * Math.PI) / 180) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function polyContains(geom, lon, lat) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.some((p) => ringContains(p[0], lon, lat) && !p.slice(1).some((h) => ringContains(h, lon, lat)));
}
