import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { cellIndex, renderClasses, renderLandcover, renderWater } from '../lib/grid.js';
import { STATUS } from '../lib/format.js';
import { useStore } from '../lib/store.jsx';

export const OGUN_BOUNDS = [[2.70, 6.30], [4.61, 7.95]];
const DEM_BOUNDS = [2.65, 6.25, 4.66, 8.0];

const THEME = {
  dark: { bg: '#0d171b', shadow: '#03080a', highlight: '#5d7581', accent: '#1d2c33', mask: '#0b1114', line: '#e9eef0', lgaLine: '#9fb2ba', halo: '#0b1114' },
  light: { bg: '#ebe6da', shadow: '#5b5446', highlight: '#ffffff', accent: '#c9c1ae', mask: '#f4f1ea', line: '#13191c', lgaLine: '#4a5559', halo: '#ffffff' },
};
export const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

const reportsFC = (reports, selectedKey) => ({
  type: 'FeatureCollection',
  features: (reports || []).map((r) => ({
    type: 'Feature',
    id: r.id ?? undefined,
    properties: { key: r.ref, status: r.status, severity: r.severity, demo: r.is_demo ? 1 : 0, selected: r.ref === selectedKey ? 1 : 0 },
    geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
  })),
});

function buildStyle(geo, theme) {
  const T = THEME[theme];
  const origin = window.location.origin;
  const c = geo.grid.corners;
  const empty = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  return {
    version: 8,
    sources: {
      osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
      esri: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      dem: { type: 'raster-dem', tiles: [`${origin}/data/dem/{z}/{x}/{y}.png`], tileSize: 256, encoding: 'terrarium', minzoom: 5, maxzoom: 12, bounds: DEM_BOUNDS, attribution: 'Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus 2014-2018 provided under COPERNICUS by the EU and ESA' },
      dem3d: { type: 'raster-dem', tiles: [`${origin}/data/dem/{z}/{x}/{y}.png`], tileSize: 256, encoding: 'terrarium', minzoom: 5, maxzoom: 12, bounds: DEM_BOUNDS },
      susc: { type: 'image', url: empty, coordinates: c },
      water: { type: 'image', url: empty, coordinates: c },
      landcover: { type: 'image', url: empty, coordinates: c },
      mask: { type: 'geojson', data: geo.mask },
      state: { type: 'geojson', data: geo.state, attribution: 'Boundaries: geoBoundaries (CC BY 4.0)' },
      lgas: { type: 'geojson', data: geo.lgas, promoteId: 'lga_id' },
      drainage: { type: 'geojson', data: geo.drainage },
      reports: { type: 'geojson', data: reportsFC([]) },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': T.bg } },
      { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.35 } },
      { id: 'esri', type: 'raster', source: 'esri', layout: { visibility: 'none' } },
      { id: 'relief', type: 'color-relief', source: 'dem', layout: { visibility: 'none' }, paint: {
        'color-relief-opacity': 0.85,
        'color-relief-color': ['interpolate', ['linear'], ['elevation'],
          0, '#1f5f5b', 20, '#3f8a6b', 50, '#86b27a', 100, '#cfd08f', 150, '#e6c48a', 250, '#c98f5d', 400, '#9a6a4f', 700, '#f2efe8'],
      } },
      { id: 'hillshade', type: 'hillshade', source: 'dem', paint: {
        'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': T.shadow, 'hillshade-highlight-color': T.highlight, 'hillshade-accent-color': T.accent,
      } },
      { id: 'landcover', type: 'raster', source: 'landcover', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.75, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } },
      { id: 'susc', type: 'raster', source: 'susc', paint: { 'raster-opacity': 0.78, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } },
      { id: 'water', type: 'raster', source: 'water', layout: { visibility: 'none' }, paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } },
      { id: 'mask', type: 'fill', source: 'mask', paint: { 'fill-color': T.mask, 'fill-opacity': 0.62 } },
      { id: 'lga-fill', type: 'fill', source: 'lgas', paint: { 'fill-color': T.line, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.07, ['boolean', ['feature-state', 'selected'], false], 0.1, 0] } },
      { id: 'lga-line', type: 'line', source: 'lgas', paint: { 'line-color': T.lgaLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 11, 1.4], 'line-opacity': 0.75, 'line-dasharray': [3, 2] } },
      { id: 'lga-selected', type: 'line', source: 'lgas', filter: ['==', ['get', 'lga_id'], -1], paint: { 'line-color': T.line, 'line-width': 2.5 } },
      { id: 'state-casing', type: 'line', source: 'state', paint: { 'line-color': T.mask, 'line-width': 5, 'line-opacity': 0.8 } },
      { id: 'state-line', type: 'line', source: 'state', paint: { 'line-color': T.line, 'line-width': 1.8 } },
      { id: 'drainage', type: 'line', source: 'drainage', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
        'line-color': ['case', ['has', 'name'], '#5cc8ff', '#3aa0e6'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, ['interpolate', ['linear'], ['get', 'order'], 1, 0.3, 4, 0.9, 7, 2.6], 12, ['interpolate', ['linear'], ['get', 'order'], 1, 0.9, 4, 2.2, 7, 5]],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, ['interpolate', ['linear'], ['get', 'order'], 1, 0.35, 5, 0.95], 11, 0.95],
      } },
      { id: 'report-halo', type: 'circle', source: 'reports', paint: {
        'circle-radius': ['+', ['match', ['get', 'severity'], 1, 6, 2, 7.5, 3, 9, 10.5], ['case', ['==', ['get', 'selected'], 1], 6, 2.5]],
        'circle-color': ['case', ['==', ['get', 'selected'], 1], '#ffffff', T.halo], 'circle-opacity': 0.92,
      } },
      { id: 'report-dot', type: 'circle', source: 'reports', paint: {
        'circle-radius': ['match', ['get', 'severity'], 1, 6, 2, 7.5, 3, 9, 10.5],
        'circle-color': ['match', ['get', 'status'], 'verified', STATUS.verified.color, 'pending', STATUS.pending.color, 'rejected', STATUS.rejected.color, STATUS.duplicate.color],
        'circle-stroke-color': '#0b1114', 'circle-stroke-width': 1.5,
      } },
      { id: 'report-core', type: 'circle', source: 'reports', filter: ['==', ['get', 'status'], 'pending'], paint: { 'circle-radius': 2.6, 'circle-color': '#0b1114' } },
    ],
  };
}

const MapView = forwardRef(function MapView({
  layers, reports, selectedKey, onMapClick, onReportClick, pin, onPinMove, crosshair, interactiveLgas = true,
  onBasemapError, className = '', fit = OGUN_BOUNDS, fitPadding = 24, labels = true, onLgaHover,
}, ref) {
  const { geo, scenario } = useStore();
  const el = useRef(null);
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [zoomBucket, setZoomBucket] = useState(8);
  const handlers = useRef({});
  handlers.current = { onMapClick, onReportClick, onPinMove, onBasemapError, onLgaHover };
  const basemapErrors = useRef(0);

  useImperativeHandle(ref, () => ({
    flyTo: (opts) => mapRef.current?.flyTo({ duration: 1600, essential: true, ...opts }),
    fitBounds: (b, opts) => mapRef.current?.fitBounds(b, { padding: 40, duration: 1200, ...opts }),
    get map() { return mapRef.current; },
  }), []);

  // create map --------------------------------------------------------------
  useEffect(() => {
    if (!geo || !el.current) return undefined;
    const map = new maplibregl.Map({
      container: el.current,
      style: buildStyle(geo, currentTheme()),
      bounds: fit,
      fitBoundsOptions: { padding: typeof fitPadding === 'function' ? fitPadding() : fitPadding },
      maxBounds: [[-1.5, 3.2], [8.8, 11]],
      minZoom: 6.2,
      maxZoom: 15.5,
      attributionControl: { compact: true, customAttribution: 'FloodSense susceptibility model (prototype) · JRC Global Surface Water · ESA WorldCover 2021 · NASA GPM IMERG via POWER' },
      dragRotate: true,
      pitchWithRotate: true,
      cooperativeGestures: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-right');
    const markReady = () => { if (map.getSource('susc')) setReady(true); };
    map.once('style.load', markReady);
    map.once('load', () => { markReady(); map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'); });
    map.on('error', (e) => {
      const id = e.sourceId || e.source?.id;
      if (id === 'osm' || id === 'esri') {
        basemapErrors.current += 1;
        if (basemapErrors.current === 4) handlers.current.onBasemapError?.(id);
      }
    });
    let hoverId = null;
    map.on('mousemove', (e) => {
      setCursor(e.lngLat);
      if (!interactiveLgas) return;
      const f = map.queryRenderedFeatures(e.point, { layers: ['lga-fill'] })[0];
      const id = f ? f.id : null;
      if (id !== hoverId) {
        if (hoverId != null) map.setFeatureState({ source: 'lgas', id: hoverId }, { hover: false });
        if (id != null) map.setFeatureState({ source: 'lgas', id }, { hover: true });
        hoverId = id;
        handlers.current.onLgaHover?.(f?.properties || null);
      }
      const onReport = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['report-dot'] }).length > 0;
      map.getCanvas().style.cursor = onReport ? 'pointer' : 'crosshair';
    });
    map.on('mouseout', () => setCursor(null));
    map.on('zoom', () => setZoomBucket(Math.floor(map.getZoom() * 2) / 2));
    map.on('click', (e) => {
      const hits = map.queryRenderedFeatures([[e.point.x - 7, e.point.y - 7], [e.point.x + 7, e.point.y + 7]], { layers: ['report-dot'] });
      if (hits.length && handlers.current.onReportClick) return handlers.current.onReportClick(hits[0].properties.key);
      handlers.current.onMapClick?.({ lon: e.lngLat.lng, lat: e.lngLat.lat });
    });
    setZoomBucket(Math.floor(map.getZoom() * 2) / 2);
    return () => { setReady(false); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo?.grid]);

  // theme changes ------------------------------------------------------------
  useEffect(() => {
    if (!ready) return undefined;
    const apply = () => {
      const T = THEME[currentTheme()];
      const m = mapRef.current;
      if (!m) return;
      m.setPaintProperty('bg', 'background-color', T.bg);
      m.setPaintProperty('hillshade', 'hillshade-shadow-color', T.shadow);
      m.setPaintProperty('hillshade', 'hillshade-highlight-color', T.highlight);
      m.setPaintProperty('hillshade', 'hillshade-accent-color', T.accent);
      m.setPaintProperty('mask', 'fill-color', T.mask);
      m.setPaintProperty('state-casing', 'line-color', T.mask);
      m.setPaintProperty('state-line', 'line-color', T.line);
      m.setPaintProperty('lga-line', 'line-color', T.lgaLine);
      m.setPaintProperty('lga-selected', 'line-color', T.line);
      m.setPaintProperty('report-halo', 'circle-color', ['case', ['==', ['get', 'selected'], 1], '#ffffff', T.halo]);
    };
    window.addEventListener('fs-theme', apply);
    return () => window.removeEventListener('fs-theme', apply);
  }, [ready]);

  // static raster overlays --------------------------------------------------
  const grid = geo?.grid;
  const waterUrl = useMemo(() => (grid ? renderWater(grid) : null), [grid]);
  const lcUrl = useMemo(() => (grid && layers.landcover ? renderLandcover(grid) : null), [grid, layers.landcover]);
  const suscUrl = useMemo(() => (grid ? renderClasses(grid, scenario ? scenario.cls : grid.L.cls) : null), [grid, scenario]);

  useEffect(() => {
    const src = ready && mapRef.current?.getSource('susc');
    if (src) src.updateImage({ url: suscUrl, coordinates: grid.corners });
  }, [ready, suscUrl, grid]);
  useEffect(() => {
    const src = ready && mapRef.current?.getSource('water');
    if (src) src.updateImage({ url: waterUrl, coordinates: grid.corners });
  }, [ready, waterUrl, grid]);
  useEffect(() => {
    const src = ready && lcUrl && mapRef.current?.getSource('landcover');
    if (src) src.updateImage({ url: lcUrl, coordinates: grid.corners });
  }, [ready, lcUrl, grid]);

  // layer visibility ----------------------------------------------------------
  useEffect(() => {
    if (!ready) return;
    const m = mapRef.current;
    const vis = (id, on) => m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('osm', layers.basemap === 'streets');
    vis('esri', layers.basemap === 'satellite');
    vis('relief', layers.elevation);
    vis('hillshade', layers.hillshade);
    m.setPaintProperty('hillshade', 'hillshade-exaggeration', layers.basemap === 'terrain' ? 0.55 : 0.25);
    vis('landcover', layers.landcover);
    vis('susc', layers.susceptibility);
    m.setPaintProperty('susc', 'raster-opacity', layers.opacity);
    vis('water', layers.water);
    vis('drainage', layers.drainage);
    ['lga-line', 'lga-fill', 'lga-selected'].forEach((id) => vis(id, layers.lgas));
    ['report-halo', 'report-dot', 'report-core'].forEach((id) => vis(id, layers.reports));
    m.setPaintProperty('mask', 'fill-opacity', layers.basemap === 'terrain' ? 0.62 : 0.45);
    if (layers.terrain3d) {
      m.setTerrain({ source: 'dem3d', exaggeration: 2.2 });
      if (m.getPitch() < 30) m.easeTo({ pitch: 58, duration: 900 });
    } else {
      m.setTerrain(null);
      if (m.getPitch() > 0) m.easeTo({ pitch: 0, bearing: 0, duration: 700 });
    }
    if (layers.basemap === 'terrain') basemapErrors.current = 0;
  }, [ready, layers]);

  // reports -------------------------------------------------------------------
  useEffect(() => {
    if (!ready) return;
    mapRef.current.getSource('reports').setData(reportsFC(reports, selectedKey));
  }, [ready, reports, selectedKey]);

  // selected LGA outline
  const { selection } = useStore();
  useEffect(() => {
    if (!ready) return;
    const id = selection?.type === 'lga' ? selection.lga_id : selection?.lga_id ?? -1;
    mapRef.current.setFilter('lga-selected', ['==', ['get', 'lga_id'], selection?.type === 'lga' ? id : -1]);
  }, [ready, selection]);

  // draggable pin --------------------------------------------------------------
  const pinMarker = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const m = mapRef.current;
    if (!pin) { pinMarker.current?.remove(); pinMarker.current = null; return; }
    if (!pinMarker.current) {
      const node = document.createElement('div');
      node.className = 'pin-marker';
      node.innerHTML = '<svg viewBox="0 0 32 44" width="32" height="44" aria-hidden="true"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 43 16 43s15-16 15-27.2C31 7.6 24.3 1 16 1z" fill="#e2683c" stroke="#0b1114" stroke-width="2"/><circle cx="16" cy="15.5" r="5.5" fill="#0b1114"/></svg>';
      pinMarker.current = new maplibregl.Marker({ element: node, draggable: true, anchor: 'bottom' }).setLngLat([pin.lon, pin.lat]).addTo(m);
      pinMarker.current.on('dragend', () => {
        const ll = pinMarker.current.getLngLat();
        handlers.current.onPinMove?.({ lon: ll.lng, lat: ll.lat });
      });
    } else pinMarker.current.setLngLat([pin.lon, pin.lat]);
  }, [ready, pin]);

  // inspection crosshair -------------------------------------------------------
  const crossMarker = useRef(null);
  useEffect(() => {
    if (!ready) return;
    if (!crosshair) { crossMarker.current?.remove(); crossMarker.current = null; return; }
    if (!crossMarker.current) {
      const node = document.createElement('div');
      node.className = 'cross-marker';
      crossMarker.current = new maplibregl.Marker({ element: node }).setLngLat([crosshair.lon, crosshair.lat]).addTo(mapRef.current);
    } else crossMarker.current.setLngLat([crosshair.lon, crosshair.lat]);
  }, [ready, crosshair]);

  // HTML labels (no glyph server needed — works offline) -------------------------
  useEffect(() => {
    if (!ready || !labels) return undefined;
    const ms = [];
    for (const f of geo.lgas.features) {
      const n = document.createElement('div');
      n.className = `map-label lga-label ${f.properties.area_km2 < 250 ? 'small' : ''}`;
      n.textContent = f.properties.name;
      ms.push(new maplibregl.Marker({ element: n }).setLngLat(f.properties.label).addTo(mapRef.current));
    }
    for (const f of geo.places.features) {
      const n = document.createElement('div');
      n.className = 'map-label place-label';
      n.innerHTML = `<i></i><span>${f.properties.name.replace(/[<>&]/g, '')}</span>`;
      ms.push(new maplibregl.Marker({ element: n, anchor: 'left', offset: [-3, 0] }).setLngLat(f.geometry.coordinates).addTo(mapRef.current));
    }
    return () => ms.forEach((m) => m.remove());
  }, [ready, labels, grid]); // eslint-disable-line react-hooks/exhaustive-deps

  // cursor readout
  let elev = null;
  let cls = null;
  if (cursor && geo) {
    const i = cellIndex(geo.grid, cursor.lng, cursor.lat);
    if (i >= 0) {
      cls = (scenario ? scenario.cls : geo.grid.L.cls)[i];
      if (geo.grid.D && geo.grid.L.lga[i]) elev = geo.grid.D.elev[i] - 100;
    }
  }

  const z = zoomBucket;
  return (
    <div className={`mapview ${className} ${layers.lgas ? '' : 'no-lga-labels'} ${layers.places ? '' : 'no-place-labels'} ${z < 8.5 ? 'z-lo' : z < 10 ? 'z-mid' : 'z-hi'}`}>
      <div ref={el} className="mapview-canvas" role="application" aria-label="Interactive map of Ogun State" />
      {!geo && <div className="map-loading"><span className="spinner" />Loading GIS layers…</div>}
      {cursor && (
        <div className="cursor-readout" aria-hidden="true">
          {cursor.lat.toFixed(4)}°N {cursor.lng.toFixed(4)}°E{elev != null ? ` · ${elev} m` : ''}{cls >= 1 && cls <= 5 ? ` · class ${cls}` : ''}
        </div>
      )}
    </div>
  );
});

export default MapView;
