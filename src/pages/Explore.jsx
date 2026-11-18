import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../App.jsx';
import Inspector from '../components/Inspector.jsx';
import LayerPanel from '../components/LayerPanel.jsx';
import MapView from '../components/MapView.jsx';
import ReportFlow from '../components/ReportFlow.jsx';
import SearchBox from '../components/SearchBox.jsx';
import { useStore } from '../lib/store.jsx';

function bboxOf(geom) {
  let minx = 180, miny = 90, maxx = -180, maxy = -90;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const p of polys) for (const [x, y] of p[0]) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  return [[minx, miny], [maxx, maxy]];
}

const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

export default function Explore() {
  const { geo, reports, layers, setLayers, selection, setSelection, route, notify, view, setView } = useStore();
  const reporting = route.path === '/report';
  const mapRef = useRef(null);
  const [pin, setPin] = useState(null);
  const [layersOpen, setLayersOpen] = useState(() => !isMobile());
  const [sheet, setSheet] = useState('peek');

  // a location handed over from "Report flooding at this location"
  useEffect(() => {
    const lat = Number(route.query.get('lat'));
    const lon = Number(route.query.get('lon'));
    if (reporting && Number.isFinite(lat) && Number.isFinite(lon) && lat && lon) setPin({ lat, lon });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reporting]);
  useEffect(() => { if (!reporting) setPin(null); else setSheet('full'); }, [reporting]);
  useEffect(() => { if (selection) setSheet('half'); }, [selection]);

  // view requests from the guided demo
  useEffect(() => {
    if (!view || !geo) return undefined;
    const t = setTimeout(() => {
      const m = mapRef.current;
      if (!m) return;
      if (view.bounds) m.fitBounds(view.bounds, { padding: isMobile() ? 20 : { top: 40, bottom: 40, left: 340, right: 420 } });
      else m.flyTo({ center: view.center, zoom: view.zoom, pitch: view.pitch ?? 0, bearing: view.bearing ?? 0 });
      if (view.pin) setPin(view.pin);
      setView(null);
    }, 350);
    return () => clearTimeout(t);
  }, [view, geo, setView]);

  const flyTo = useCallback((loc, zoom = 13) => mapRef.current?.flyTo({ center: [loc.lon, loc.lat], zoom }), []);
  const zoomLga = useCallback((id) => {
    const f = geo.lgas.features.find((x) => x.properties.lga_id === id);
    mapRef.current?.fitBounds(bboxOf(f.geometry), { padding: isMobile() ? 30 : { top: 60, bottom: 60, left: 360, right: 440 } });
  }, [geo]);
  const openLga = useCallback((id) => { setSelection({ type: 'lga', lga_id: id }); zoomLga(id); }, [setSelection, zoomLga]);

  const onMapClick = useCallback((p) => {
    if (reporting) { setPin(p); return; }
    setSelection({ type: 'point', ...p });
  }, [reporting, setSelection]);

  const onPick = (r) => {
    if (r.kind === 'LGA') return openLga(r.lga_id);
    flyTo(r, r.kind === 'Town' ? 12.5 : 13);
    setSelection({ type: 'point', lat: r.lat, lon: r.lon });
  };

  return (
    <div className={`explore ${reporting ? 'is-reporting' : ''} sheet-${sheet}`}>
      <MapView
        ref={mapRef}
        fitPadding={() => (isMobile() ? { top: 70, left: 16, right: 16, bottom: Math.round(window.innerHeight * 0.42) } : { top: 30, bottom: 30, left: 350, right: 430 })}
        layers={layers}
        reports={reports}
        selectedKey={selection?.type === 'report' ? selection.ref : null}
        onMapClick={onMapClick}
        onReportClick={(ref) => !reporting && setSelection({ type: 'report', ref })}
        pin={reporting ? pin : null}
        onPinMove={(p) => setPin(p)}
        crosshair={!reporting && selection?.type === 'point' ? selection : null}
        onBasemapError={() => {
          setLayers((l) => ({ ...l, basemap: 'terrain' }));
          notify('Online basemap could not load — switched to the offline terrain basemap. All FloodSense layers still work.', 'warn');
        }}
      />

      <div className="map-ui-left">
        {!reporting && <SearchBox onPick={onPick} />}
        <button className={`layers-fab ${layersOpen ? 'on' : ''}`} onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen}>
          <Icon name="layers" size={16} />Layers & legend
        </button>
        {layersOpen && (
          <div className="layer-panel-wrap">
            <LayerPanel onClose={isMobile() ? () => setLayersOpen(false) : undefined} />
          </div>
        )}
      </div>

      <aside className="side-panel" aria-label={reporting ? 'Report flooding' : 'Location details'}>
        <button className="sheet-handle" onClick={() => setSheet((s) => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek'))} aria-label="Resize panel"><span /></button>
        {reporting ? (
          <section className="inspector">
            <header className="panel-head"><div><p className="eyebrow">Community reporting</p><h2>Report flooding</h2></div></header>
            <ReportFlow pin={pin} setPin={setPin} flyTo={flyTo} onCancel={() => route.navigate('/')} />
          </section>
        ) : (
          <Inspector
            selection={selection}
            onClose={() => setSelection(null)}
            onLga={openLga}
            onZoomLga={zoomLga}
            onReportHere={(p) => route.navigate(`/report?lat=${p.lat.toFixed(6)}&lon=${p.lon.toFixed(6)}`)}
          />
        )}
      </aside>
    </div>
  );
}
