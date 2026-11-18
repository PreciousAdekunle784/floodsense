import { useEffect } from 'react';
import { Icon } from '../App.jsx';
import { cellIndex, toLonLat } from '../lib/grid.js';
import { useStore } from '../lib/store.jsx';

const OGUN = [[2.70, 6.30], [4.61, 7.95]];

/** Finds the nearest Very-high, partly built-up cell to a target so the demo always lands on a meaningful spot. */
function findCell(grid, lon, lat, wantBuilt = true) {
  const { width: W, height: H, origin, cell_m: c } = grid.meta;
  const i0 = cellIndex(grid, lon, lat);
  if (i0 < 0) return { lon, lat };
  const r0 = Math.floor(i0 / W);
  const c0 = i0 % W;
  for (let rad = 0; rad < 60; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const r = r0 + dr; const cc = c0 + dc;
        if (r < 0 || cc < 0 || r >= H || cc >= W) continue;
        const i = r * W + cc;
        if (grid.L.cls[i] === 5 && (!wantBuilt || grid.L.builtup[i] >= 20)) {
          const [x, y] = [origin[0] + (cc + 0.5) * c, origin[1] - (r + 0.5) * c];
          const [lo, la] = toLonLat(x, y);
          return { lon: lo, lat: la };
        }
      }
    }
  }
  return { lon, lat };
}

const STEPS = [
  { title: 'FloodSense — Ogun State', route: '/', layers: {}, view: { bounds: OGUN }, select: null,
    body: 'A GIS flood-intelligence prototype for all 20 LGAs of Ogun State, combining terrain-based susceptibility, community reports and preparedness guidance.',
    say: '“Flooding along the Ogun River corridor recurs almost every rainy season. FloodSense connects where the land is susceptible with what communities actually see.”' },
  { title: 'Real terrain: Copernicus DEM', route: '/', layers: { elevation: true, susceptibility: false, drainage: false, reports: false }, view: { center: [3.36, 7.12], zoom: 9.6 },
    body: 'Elevation from the Copernicus 30 m DEM, served from local tiles — the map works offline. Notice the Ogun River valley cutting through Abeokuta.',
    say: '“Everything you see is real open data, processed by our own Python pipeline — not drawn by hand.”' },
  { title: 'Drainage derived from the DEM', route: '/', layers: { elevation: false, susceptibility: false, drainage: true, reports: false }, view: { center: [3.36, 7.0], zoom: 8.8 },
    body: 'We filled sinks, computed D8 flow direction and accumulation, and extracted every channel draining more than 5 km² — 2,292 segments in Ogun, ordered by Strahler stream order.',
    say: '“Water follows terrain. Knowing the flow network is the basis for knowing where it collects.”' },
  { title: 'The susceptibility model', route: '/', layers: { susceptibility: true, drainage: true, reports: false }, view: { center: [3.42, 6.75], zoom: 10.2 },
    body: 'Six factors — height above drainage (HAND), distance to channel, slope, wetness index, rainfall and land cover — combined with AHP weights (CR 0.005) and classed with Jenks breaks.',
    say: '“This is susceptibility — a property of the land — not a forecast. The interface never mixes the two.”' },
  { title: 'Inspect a location', route: '/', layers: { susceptibility: true, reports: true }, pick: { lon: 3.405, lat: 6.69 }, zoom: 12.5,
    body: 'Click anywhere: the panel explains the class, each factor’s contribution, the Landsat water record, nearby reports and preparedness guidance for that kind of location.',
    say: '“A resident can see not just that they are high-risk, but why.”' },
  { title: 'Check against observed water', route: '/', layers: { water: true, susceptibility: true }, view: { center: [3.38, 6.95], zoom: 9.4 },
    body: 'Cyan: where Landsat has seen water at some point since 1984 (JRC Global Surface Water). Our Very-high class contains 73% of these cells on 11% of the land (AUC 0.91).',
    say: '“We checked the model against 37 years of satellite observations — and we are honest that this is a consistency check, not full validation.”' },
  { title: '3D: the Ogun River valley', route: '/', layers: { water: false, terrain3d: true, susceptibility: true }, view: { center: [3.36, 7.08], zoom: 11, pitch: 60, bearing: -20 },
    body: 'Terrain exaggerated ×2.2 from the same DEM tiles — the susceptibility classes follow the valley floor.',
    say: '“You can literally see why the valley floor is red.”' },
  { title: 'Report a flood', route: '/report', layers: { terrain3d: false, reports: true }, pickPin: { lon: 3.405, lat: 6.69 }, zoom: 13,
    body: 'Anyone can report flooding from a phone: location (tap, GPS or search), severity, description, optional photo (EXIF removed) and optional contact with consent. Complete the form and press Send.',
    say: '“The report appears immediately — but as pending, with the text hidden and location rounded. We never treat a submission as confirmed.”' },
  { title: 'Verify the report', route: '/admin', layers: {},
    body: 'Sign in as a verifier. Open the new report: exact location, GIS consistency check, nearby corroborating reports, automated spam flags — then Verify, Reject or mark Duplicate.',
    say: '“Verification combines human judgement with GIS evidence. Every decision is audited.”' },
  { title: 'The dashboard updates', route: '/insights', layers: {},
    body: 'Counts, LGA distribution, activity, and how reports compare with modelled susceptibility are recomputed from the database — and IMERG shows how this season’s rainfall compares with normal.',
    say: '“Nothing here is hard-coded. Toggle demo data off and you see only genuine submissions.”' },
  { title: 'Change the model', route: '/model', layers: {},
    body: 'Edit the AHP judgements — weights, consistency ratio and the full state map are recomputed in the browser, with the agreement score updated live.',
    say: '“Planners can test assumptions transparently instead of trusting a black box.”' },
  { title: 'Honest about the data', route: '/sources', layers: {},
    body: 'What is real, modelled, synthetic or not yet integrated — plus limitations and the path to operational use: event-based validation, Sentinel-1 flood extents, official NIHSA/NiMet alerts.',
    say: '“FloodSense is a prototype that is ready to be piloted along the Ogun River corridor.”' },
];

export default function DemoGuide() {
  const { demo, setDemo, route, setLayers, DEFAULT_LAYERS, setSelection, setView, geo, setScenario } = useStore();
  const step = demo?.step ?? null;

  useEffect(() => {
    if (step == null || !geo) return;
    const s = STEPS[step];
    if (step === 0) setScenario(null);
    setLayers({ ...DEFAULT_LAYERS, ...s.layers });
    if (route.path !== s.route) route.navigate(s.route);
    if (s.pick) {
      const p = findCell(geo.grid, s.pick.lon, s.pick.lat);
      setSelection({ type: 'point', ...p });
      setView({ center: [p.lon, p.lat], zoom: s.zoom });
    } else if (s.pickPin) {
      const p = findCell(geo.grid, s.pickPin.lon, s.pickPin.lat);
      setSelection(null);
      setView({ center: [p.lon, p.lat], zoom: s.zoom, pin: p });
    } else {
      setSelection(null);
      if (s.view) setView(s.view);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, geo]);

  if (step == null) return null;
  const s = STEPS[step];
  const end = () => { setDemo(null); setLayers(DEFAULT_LAYERS); };
  return (
    <div className="demo-card" role="dialog" aria-label="Guided demonstration">
      <p className="eyebrow">Guided demo · {step + 1} / {STEPS.length}</p>
      <h3>{s.title}</h3>
      <p>{s.body}</p>
      <p className="say">{s.say}</p>
      <div className="demo-nav">
        <div className="demo-dots" aria-hidden="true">{STEPS.map((_, i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
        <button className="btn btn-ghost sm" onClick={end}>End</button>
        <button className="btn btn-ghost sm" disabled={step === 0} onClick={() => setDemo({ step: step - 1 })}><Icon name="back" size={14} />Back</button>
        {step < STEPS.length - 1
          ? <button className="btn btn-accent sm" onClick={() => setDemo({ step: step + 1 })}>Next<Icon name="arrow" size={14} /></button>
          : <button className="btn btn-accent sm" onClick={end}>Finish</button>}
      </div>
    </div>
  );
}
