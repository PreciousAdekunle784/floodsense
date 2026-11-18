import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { classify, computeIndex, evaluate, lgaClassShares, loadDetail, loadGrid } from './grid.js';

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

// ------------------------------------------------------------ tiny router
export function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const on = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = useCallback((to, { replace } = {}) => {
    if (to === window.location.pathname + window.location.search) return;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);
  const url = new URL(path, window.location.origin);
  return { path: url.pathname, query: url.searchParams, navigate };
}

const DEFAULT_LAYERS = {
  basemap: 'terrain', susceptibility: true, opacity: 0.78, elevation: false, hillshade: true, drainage: true,
  water: false, landcover: false, reports: true, lgas: true, places: true, terrain3d: false,
};

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load ${url}`);
  return r.json();
}

export function StoreProvider({ children }) {
  const route = useRoute();
  const [geo, setGeo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportsError, setReportsError] = useState(null);
  const [includeDemo, setIncludeDemo] = useState(() => localStorageGet('fs.includeDemo', '1') === '1');
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [selection, setSelection] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [toast, setToast] = useState(null);
  const [view, setView] = useState(null);
  const [demo, setDemo] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [grid, model, lgas, state, mask, drainage, places, log] = await Promise.all([
          loadGrid(), json('/data/model.json'), json('/data/lgas.geojson'), json('/data/state.geojson'),
          json('/data/mask.geojson'), json('/data/drainage.geojson'), json('/data/places.geojson'), json('/data/processing_log.json'),
        ]);
        if (!alive) return;
        setGeo({ grid, model, lgas, state, mask, drainage, places, log });
        loadDetail(grid).then(() => alive && setGeo((g) => ({ ...g, detailReady: true }))).catch(() => {});
        // Baseline evaluated at web resolution, so scenario comparisons are like-for-like
        const weights = Object.fromEntries(model.factors.map((f) => [f.key, f.weight]));
        const idx = computeIndex(grid, weights);
        const { cls, breaks } = classify(grid, idx);
        setBaseline({ weights, idx, cls, breaks, eval: evaluate(grid, idx, cls) });
      } catch (e) {
        if (alive) setLoadError(e.message);
      }
    })();
    return () => { alive = false; };
  }, []);

  const refreshReports = useCallback(async () => {
    try {
      const d = await api(`/reports?include_demo=${includeDemo ? 1 : 0}`);
      setReports(d.reports);
      setReportsError(null);
    } catch (e) {
      setReportsError(e.message);
    }
  }, [includeDemo]);

  useEffect(() => { refreshReports(); }, [refreshReports]);
  useEffect(() => {
    localStorageSet('fs.includeDemo', includeDemo ? '1' : '0');
  }, [includeDemo]);
  useEffect(() => {
    const t = setInterval(refreshReports, 60000);
    return () => clearInterval(t);
  }, [refreshReports]);

  const runScenario = useCallback((name, weights) => {
    if (!geo) return null;
    const idx = computeIndex(geo.grid, weights);
    const { cls, breaks } = classify(geo.grid, idx);
    const s = { name, weights, idx, cls, breaks, eval: evaluate(geo.grid, idx, cls), lgaShares: lgaClassShares(geo.grid, cls), at: Date.now() };
    setScenario(s);
    return s;
  }, [geo]);

  const notify = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 5200);
    return () => clearTimeout(t);
  }, [toast]);

  const value = useMemo(() => ({
    route, geo, loadError, reports, reportsError, refreshReports, includeDemo, setIncludeDemo,
    layers, setLayers, selection, setSelection, scenario, setScenario, runScenario, baseline, toast, notify,
    view, setView, demo, setDemo, DEFAULT_LAYERS,
  }), [route, geo, loadError, reports, reportsError, refreshReports, includeDemo, layers, selection, scenario, runScenario, baseline, toast, notify, view, demo]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function localStorageGet(k, d) {
  try { return window.localStorage.getItem(k) ?? d; } catch { return d; }
}
export function localStorageSet(k, v) {
  try { window.localStorage.setItem(k, v); } catch { /* private mode */ }
}
