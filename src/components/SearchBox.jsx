import { useMemo, useState } from 'react';
import { Icon } from '../App.jsx';
import { useStore } from '../lib/store.jsx';

/** Offline gazetteer search: LGAs, GeoNames towns, coordinates and report references. */
export default function SearchBox({ onPick, placeholder = 'Search LGA, town or coordinates', compact }) {
  const { geo, route } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !geo) return [];
    const out = [];
    const m = s.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) {
      let lat = Number(m[1]);
      let lon = Number(m[2]);
      if (lat < 5 && lon > 5) [lat, lon] = [lon, lat];
      out.push({ kind: 'Coordinates', name: `${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`, lat, lon });
    }
    if (/^fs-?[a-z0-9]{2,}/i.test(s)) out.push({ kind: 'Report', name: `Track report ${s.toUpperCase()}`, ref: s.toUpperCase().replace(/^FS-?/, 'FS-') });
    const norm = (x) => x.toLowerCase().replace(/[-/]/g, ' ');
    for (const f of geo.lgas.features) {
      if (norm(f.properties.name).includes(norm(s))) out.push({ kind: 'LGA', name: f.properties.name, lga_id: f.properties.lga_id, feature: f });
    }
    for (const f of geo.places.features) {
      if (norm(f.properties.name).includes(norm(s))) out.push({ kind: 'Town', name: f.properties.name, sub: `${f.properties.lga} LGA`, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
    }
    return out.slice(0, 8);
  }, [q, geo]);

  const pick = (r) => {
    setOpen(false);
    setQ(r.kind === 'Report' ? '' : r.name);
    if (r.kind === 'Report') return route.navigate(`/track?ref=${encodeURIComponent(r.ref)}`);
    onPick(r);
  };

  return (
    <div className={`searchbox ${compact ? 'compact' : ''}`} role="combobox" aria-expanded={open && results.length > 0} aria-haspopup="listbox">
      <Icon name="search" size={16} />
      <input
        value={q} placeholder={placeholder} aria-label="Search places" aria-autocomplete="list"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter' && results[hi]) { e.preventDefault(); pick(results[hi]); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {q && <button className="clear" onClick={() => { setQ(''); setOpen(false); }} aria-label="Clear search">×</button>}
      {open && q && (
        <ul className="search-results" role="listbox">
          {results.length === 0 && <li className="empty">No match in the Ogun gazetteer. Try an LGA name or “7.15, 3.35”.</li>}
          {results.map((r, i) => (
            <li key={`${r.kind}${r.name}${i}`} role="option" aria-selected={i === hi} className={i === hi ? 'hi' : ''} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
              <span className="r-kind">{r.kind}</span><span className="r-name">{r.name}</span>{r.sub && <span className="r-sub">{r.sub}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
