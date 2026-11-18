import { useMemo, useState } from 'react';
import { Link } from '../App.jsx';
import { ClassBar, Curve, Legend } from '../charts/charts.jsx';
import MapView from '../components/MapView.jsx';
import { SAATY, ahp, matrixFromUpper, saatyLabel } from '../lib/ahp.js';
import { CLASS_HEX, CLASS_NAMES, fmt } from '../lib/format.js';
import { FACTOR_KEYS } from '../lib/grid.js';
import { FACTOR_INFO } from '../lib/knowledge.js';
import { useStore } from '../lib/store.jsx';

const nearestSaaty = (r) => SAATY.reduce((b, v) => (Math.abs(Math.log(v) - Math.log(r)) < Math.abs(Math.log(b) - Math.log(r)) ? v : b), 1);
const fromPriorities = (p) => FACTOR_KEYS.map((a, i) => FACTOR_KEYS.map((b, j) => (j > i ? nearestSaaty(p[a] / p[b]) : 1)));

const WORKFLOW = [
  ['Data acquisition', 'Copernicus DEM, ESA WorldCover, JRC GSW, GPM IMERG, geoBoundaries, GeoNames — scripted downloads from open archives.', 'done'],
  ['Cleaning', 'Ocean/void handling, nodata masks, removal of duplicate place names.', 'done'],
  ['CRS harmonisation', 'Everything reprojected to WGS 84 / UTM 31N (EPSG:32631) on one 90 m grid; display grid in Web Mercator.', 'done'],
  ['Raster & vector preparation', 'Mosaicking, windowed COG reads, mode/average resampling, LGA rasterisation.', 'done'],
  ['Terrain analysis', 'Pit and depression filling, flat resolution (pysheds).', 'done'],
  ['Slope analysis', 'Gradient of the unconditioned DEM, degrees.', 'done'],
  ['Rainfall analysis', 'IMERG 2001–2020 climatology per cell, monthly series and anomalies for the state.', 'done'],
  ['Drainage & flow', 'D8 flow direction, flow accumulation, channel extraction (≥5 km²), Strahler order, HAND, TWI.', 'done'],
  ['Distance to river', 'Euclidean distance to the extracted channel network.', 'done'],
  ['Susceptibility classification', 'Fuzzy memberships → AHP weighted overlay → Jenks natural breaks (5 classes).', 'done'],
  ['Map visualisation', 'Web grid + vector layers rendered with MapLibre; scenarios recomputed in the browser.', 'done'],
  ['Validation', 'Consistency check against Landsat-observed water (AUC, frequency ratio). Event-based validation still required.', 'partial'],
];

export default function Model() {
  const { geo, scenario, setScenario, runScenario, baseline, DEFAULT_LAYERS, notify, route } = useStore();
  const model = geo?.model;
  const baseUpper = useMemo(() => (model ? model.ahp.matrix.map((row) => row.slice()) : null), [model]);
  const [upper, setUpper] = useState(null);
  const [name, setName] = useState('Custom judgements');
  const U = upper || baseUpper;
  const res = useMemo(() => (U ? ahp(matrixFromUpper(FACTOR_KEYS.length, U)) : null), [U]);
  const mapLayers = useMemo(() => ({ ...DEFAULT_LAYERS, reports: false, places: false, drainage: false, lgas: true }), [DEFAULT_LAYERS]);

  if (!geo || !baseline) return <div className="page-loading"><span className="spinner" />Loading model…</div>;

  const setCell = (i, j, v) => {
    const next = U.map((r) => r.slice());
    next[i][j] = v;
    setUpper(next);
    setName('Custom judgements');
  };
  const preset = (label, mat) => { setUpper(mat); setName(label); };
  const weights = Object.fromEntries(FACTOR_KEYS.map((k, i) => [k, res.weights[i]]));
  const consistent = res.cr < 0.1;
  const apply = () => {
    if (!consistent) return;
    const s = runScenario(name, weights);
    notify(`Scenario “${name}” applied — map, LGA profiles and inspector now use these weights.`, 'good');
    return s;
  };
  const be = baseline.eval;
  const se = scenario?.eval;
  const shares = (cls) => {
    const a = [0, 0, 0, 0, 0];
    let n = 0;
    for (let i = 0; i < cls.length; i++) if (cls[i] >= 1 && cls[i] <= 5) { a[cls[i] - 1]++; n++; }
    return a.map((x) => (100 * x) / n);
  };

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <div>
            <p className="eyebrow">Module B · GIS analysis</p>
            <h1>Flood susceptibility model</h1>
            <p>A multi-criteria weighted overlay of six terrain, hydrology, land-cover and rainfall factors, weighted with the Analytic Hierarchy Process. Edit the pairwise judgements below and the whole state is re-classified in your browser.</p>
          </div>
          <div className="row-gap"><span className="status-pill pill-model">Prototype · not calibrated</span><span className="status-pill pill-real">Real input data</span></div>
        </header>

        <h2 className="block-title">1 · Factors and how each is scored</h2>
        <div className="factor-grid">
          {model.factors.map((f) => (
            <article className="factor" key={f.key}>
              <h3>{FACTOR_INFO[f.key].short}<b>{fmt(100 * f.weight, 1)}%</b></h3>
              <div className="wbar" title="Baseline AHP weight"><span style={{ width: `${Math.min(100, f.weight * 250)}%` }} /></div>
              <p>{FACTOR_INFO[f.key].why}</p>
              {f.knots ? <Curve knots={f.knots} unit={f.unit} /> : (
                <div className="lulc-scores">
                  {Object.values(model.lulc_classes).filter((c) => c.name !== 'Snow and ice' && c.name !== 'Moss and lichen').map((c) => (
                    <div key={c.name} className="hrow" style={{ gridTemplateColumns: '130px 1fr 34px' }}><span className="hlabel">{c.name}</span><span className="htrack"><span className="hseg" style={{ width: `${c.membership * 100}%`, background: 'var(--accent)' }} /></span><span className="hval">{c.membership}</span></div>
                  ))}
                </div>
              )}
              <span className="src">{FACTOR_INFO[f.key].source}{f.knots ? ' · membership 0→1 (higher = more susceptible)' : ''}</span>
            </article>
          ))}
        </div>

        <h2 className="block-title" style={{ marginTop: 28 }}>2 · Weights by Analytic Hierarchy Process</h2>
        <div className="model-layout">
          <div className="model-map">
            <MapView layers={mapLayers} labels fit={[[2.70, 6.30], [4.61, 7.95]]} interactiveLgas={false} />
          </div>
          <section className="card">
            <h2>Pairwise comparison matrix</h2>
            <p className="sub">Each cell: how much more important is the <b>row</b> factor than the <b>column</b> factor for flood susceptibility (Saaty 1–9 scale; 1/3 means the column is moderately more important).</p>
            <div className="presets">
              <button className="btn btn-ghost sm" onClick={() => preset('FloodSense baseline', baseUpper.map((r) => r.slice()))}>Baseline</button>
              <button className="btn btn-ghost sm" onClick={() => preset('Equal importance', FACTOR_KEYS.map(() => FACTOR_KEYS.map(() => 1)))}>Equal</button>
              <button className="btn btn-ghost sm" onClick={() => preset('Urban runoff emphasis', fromPriorities({ hand: 4, dist: 3, slope: 2, twi: 2, rain: 2, lulc: 7 }))}>Urban runoff</button>
              <button className="btn btn-ghost sm" onClick={() => preset('Rainfall emphasis', fromPriorities({ hand: 3, dist: 3, slope: 2, twi: 2, rain: 7, lulc: 2 }))}>Rainfall</button>
            </div>
            <div className="table-scroll">
              <table className="ahp">
                <thead><tr><th />{FACTOR_KEYS.map((k) => <th key={k} title={FACTOR_INFO[k].short}>{k.toUpperCase()}</th>)}</tr></thead>
                <tbody>
                  {FACTOR_KEYS.map((a, i) => (
                    <tr key={a}>
                      <th className="rowh" title={FACTOR_INFO[a].short}>{a.toUpperCase()}</th>
                      {FACTOR_KEYS.map((b, j) => (
                        <td key={b} className={i === j ? 'diag' : j < i ? 'recip' : ''}>
                          {i === j ? '1' : j < i ? saatyLabel(1 / U[j][i]) : (
                            <select value={nearestSaaty(U[i][j])} onChange={(e) => setCell(i, j, Number(e.target.value))} className={Math.abs(U[i][j] - baseUpper[i][j]) > 1e-6 ? 'changed' : ''} aria-label={`${FACTOR_INFO[a].short} vs ${FACTOR_INFO[b].short}`}>
                              {SAATY.map((v) => <option key={v} value={v}>{saatyLabel(v)}</option>)}
                            </select>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ahp-stats">
              <div><span>λ<sub>max</sub></span><b>{res.lambda.toFixed(3)}</b></div>
              <div><span>Consistency index</span><b>{res.ci.toFixed(4)}</b></div>
              <div><span>Consistency ratio</span><b className={consistent ? 'ok' : 'bad'}>{res.cr.toFixed(3)} {consistent ? '✓' : '✕'}</b></div>
            </div>
            {!consistent && <div className="alert">CR ≥ 0.10: these judgements contradict each other (e.g. A&gt;B, B&gt;C but C&gt;A). Revise them before applying.</div>}
            <div className="hstack">
              {FACTOR_KEYS.map((k, i) => (
                <div className="hrow" key={k} style={{ gridTemplateColumns: '140px 1fr 50px' }}>
                  <span className="hlabel">{FACTOR_INFO[k].short}</span>
                  <span className="htrack"><span className="hseg" style={{ width: `${Math.min(100, res.weights[i] * 200)}%`, background: 'var(--accent)' }} /></span>
                  <span className="hval">{fmt(100 * res.weights[i], 1)}%</span>
                </div>
              ))}
            </div>
            <div className="row-gap" style={{ marginTop: 14 }}>
              <button className="btn btn-accent" onClick={apply} disabled={!consistent}>Apply scenario to map</button>
              {scenario && <button className="btn btn-ghost" onClick={() => { setScenario(null); setUpper(null); notify('Back to the baseline model.'); }}>Reset to baseline</button>}
              {scenario && <button className="btn btn-ghost" onClick={() => route.navigate('/')}>Explore scenario on map</button>}
            </div>
            <p className="fine">Weights = principal eigenvector of the matrix; CR = CI / RI (RI = 1.24 for six factors). Baseline CR = {model.ahp.cr}.</p>
          </section>
        </div>

        <h2 className="block-title" style={{ marginTop: 28 }}>3 · Classification and consistency check</h2>
        <div className="grid">
          <section className="card span-6">
            <h2>Class distribution</h2>
            <p className="sub">Jenks natural breaks into five classes — relative within Ogun State, not absolute probabilities.</p>
            <ClassBar shares={shares(geo.grid.L.cls)} compare={scenario ? shares(scenario.cls) : null} baseLabel="Baseline (pipeline classes)" compareLabel={`Scenario: ${scenario?.name}`} height={18} />
            <p className="fine">Baseline breaks (index): {model.classification.breaks.slice(1, 5).map((b) => b.toFixed(3)).join(' · ')}{scenario && <> — scenario: {scenario.breaks.slice(1, 5).map((b) => b.toFixed(3)).join(' · ')}</>}</p>
          </section>
          <section className="card span-6">
            <h2>Agreement with observed water</h2>
            <p className="sub">How well the index ranks cells where Landsat has seen intermittent water (JRC GSW 1984–2021) above cells where it has not. AUC 0.5 = no skill, 1 = perfect ranking.</p>
            <div className="compare-row">
              <div><span className="muted">Baseline (150 m display grid)</span><div className="big-num">{be.auc.toFixed(3)}</div><span className="fine">pipeline at 90 m: {model.validation.auc}</span></div>
              <div><span className="muted">{scenario ? `Scenario: ${scenario.name}` : 'Scenario'}</span><div className="big-num">{se ? se.auc.toFixed(3) : '—'}</div>
                {se && <span className={`delta ${se.auc >= be.auc ? 'ok' : 'bad'}`}>{se.auc >= be.auc ? '+' : ''}{(se.auc - be.auc).toFixed(3)} vs baseline</span>}</div>
            </div>
            <table className="tbl" style={{ marginTop: 12 }}>
              <thead><tr><th>Class</th><th className="num">% of area</th><th className="num">% of observed water</th><th className="num">Frequency ratio</th>{se && <th className="num">FR scenario</th>}</tr></thead>
              <tbody>
                {be.classes.map((c, k) => (
                  <tr key={c.cls}><td><span className="sw-inline" style={{ background: CLASS_HEX[c.cls] }} />{CLASS_NAMES[c.cls]}</td><td className="num">{fmt(c.area_pct, 1)}</td><td className="num">{fmt(c.ref_pct, 1)}</td><td className="num">{fmt(c.fr, 2)}</td>{se && <td className="num">{fmt(se.classes[k].fr, 2)}</td>}</tr>
                ))}
              </tbody>
            </table>
            <p className="fine">FR &gt; 1: observed water is over-represented in that class. A rising FR from Very low to Very high is the expected pattern.</p>
          </section>
          <section className="card span-12">
            <h2>Sensitivity analysis (90 m pipeline)</h2>
            <p className="sub">AUC of each factor on its own, and of the model with that factor removed (weights renormalised).</p>
            <Legend items={[{ label: 'Factor alone', color: 'var(--ink-3)' }, { label: 'Model without this factor', color: 'var(--accent)' }]} />
            <div className="paired">
              {FACTOR_KEYS.map((k) => (
                <div className="prow" key={k} style={{ gridTemplateColumns: '170px 1fr' }}>
                  <span className="hlabel">{FACTOR_INFO[k].short}</span>
                  <div className="pbars">
                    <div className="pbar"><span style={{ width: `${(model.validation.single_factor_auc[k] - 0.4) * 160}%`, background: 'var(--ink-3)' }} /><em>{model.validation.single_factor_auc[k].toFixed(3)}</em></div>
                    <div className="pbar"><span style={{ width: `${(model.validation.leave_one_out_auc[k] - 0.4) * 160}%`, background: 'var(--accent)' }} /><em>{model.validation.leave_one_out_auc[k].toFixed(3)}</em></div>
                  </div>
                </div>
              ))}
            </div>
            <p className="fine">Bars start at AUC 0.4. Reading: HAND is the strongest single predictor (removing it costs the most). Rainfall alone scores below 0.5 — at state scale its gentle north–south gradient does not explain where water is observed, which is why it carries a low weight. Model AUC {model.validation.auc} over {fmt(model.validation.n_reference_cells)} reference cells.</p>
            <div className="notice"><b>What this check is — and is not.</b> {model.validation.caveat}</div>
          </section>
        </div>

        <h2 className="block-title" style={{ marginTop: 28 }}>4 · Processing workflow</h2>
        <ol className="workflow">
          {WORKFLOW.map(([t, d, st]) => <li key={t}><b>{t} {st === 'partial' && <span className="status-pill pill-demo">partial</span>}</b>{d}</li>)}
        </ol>
        <p className="fine">Reproducible with <code>pipeline/run_all.sh</code> (Python: rasterio, GeoPandas, pysheds, xarray). Full methodology and limitations: <Link to="/sources">Data & status</Link> and <code>docs/METHODOLOGY.md</code>.</p>
      </div>
    </div>
  );
}
