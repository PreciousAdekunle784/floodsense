import { useState } from 'react';
import { CLASS_HEX, CLASS_NAMES, STATUS } from '../lib/format.js';
import { LANDCOVER } from '../lib/grid.js';
import { useStore } from '../lib/store.jsx';

function Toggle({ on, onChange, label, sub, swatch, badge }) {
  return (
    <label className={`layer-toggle ${on ? 'on' : ''}`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
      <span className="lt-text">
        <span className="lt-label">{swatch}{label}{badge && <span className={`badge badge-${badge.tone}`}>{badge.text}</span>}</span>
        {sub && <span className="lt-sub">{sub}</span>}
      </span>
    </label>
  );
}

export default function LayerPanel({ onClose }) {
  const { layers, setLayers, scenario, setScenario, includeDemo, setIncludeDemo, route } = useStore();
  const set = (k) => (v) => setLayers((l) => ({ ...l, [k]: v }));
  const [legendOnly, setLegendOnly] = useState(false);
  return (
    <section className="layer-panel" aria-label="Map layers and legend">
      <header className="panel-head">
        <h2 className="eyebrow">Layers</h2>
        <div className="seg-small" role="tablist">
          <button role="tab" aria-selected={!legendOnly} className={!legendOnly ? 'on' : ''} onClick={() => setLegendOnly(false)}>All</button>
          <button role="tab" aria-selected={legendOnly} className={legendOnly ? 'on' : ''} onClick={() => setLegendOnly(true)}>Legend</button>
        </div>
        {onClose && <button className="icon-btn sm" onClick={onClose} aria-label="Close layers">×</button>}
      </header>

      {!legendOnly && (
        <div className="basemaps" role="radiogroup" aria-label="Basemap">
          {[['terrain', 'Terrain', 'Offline'], ['streets', 'Streets', 'Online'], ['satellite', 'Satellite', 'Online']].map(([k, l, s]) => (
            <button key={k} role="radio" aria-checked={layers.basemap === k} className={`bm bm-${k} ${layers.basemap === k ? 'on' : ''}`} onClick={() => set('basemap')(k)}>
              <span className="bm-thumb" /><span>{l}</span><small>{s}</small>
            </button>
          ))}
        </div>
      )}

      <div className="layer-group">
        <h3 className="group-title"><span className="tone tone-model" />Modelled</h3>
        {!legendOnly && (
          <Toggle on={layers.susceptibility} onChange={set('susceptibility')} label="Flood susceptibility"
            badge={scenario ? { tone: 'warn', text: 'Scenario' } : { tone: 'model', text: 'AHP model' }}
            sub={scenario ? `Showing “${scenario.name}”` : 'Relative, 5 classes · 150 m display grid'} />
        )}
        {layers.susceptibility && (
          <div className="legend-ramp">
            {[1, 2, 3, 4, 5].map((c) => (
              <div key={c} className="ramp-step"><span style={{ background: CLASS_HEX[c] }} /><small>{CLASS_NAMES[c]}</small></div>
            ))}
            {!legendOnly && (
              <input type="range" min="0.2" max="1" step="0.05" value={layers.opacity} onChange={(e) => set('opacity')(Number(e.target.value))} aria-label="Susceptibility layer opacity" className="opacity" />
            )}
          </div>
        )}
        {scenario && !legendOnly && (
          <button className="btn btn-ghost xs" onClick={() => setScenario(null)}>Revert to baseline model</button>
        )}
        {!legendOnly && <Toggle on={layers.drainage} onChange={set('drainage')} label="Drainage network" sub="Derived from the DEM (D8 flow, ≥5 km² catchment)" swatch={<i className="sw-line" />} />}
        {legendOnly && layers.drainage && <div className="legend-line"><i className="sw-line" />Drainage channel (modelled from terrain) — thicker = larger stream order</div>}
      </div>

      <div className="layer-group">
        <h3 className="group-title"><span className="tone tone-obs" />Observed</h3>
        {!legendOnly && <Toggle on={layers.water} onChange={set('water')} label="Observed surface water" sub="JRC Landsat record 1984–2021 · historical" />}
        {layers.water && (
          <div className="legend-items">
            <span><i style={{ background: 'rgb(0,200,230)' }} />Water seen at least occasionally</span>
            <span><i style={{ background: 'rgb(30,100,220)' }} />Permanent water (≥75% of observations)</span>
          </div>
        )}
      </div>

      <div className="layer-group">
        <h3 className="group-title"><span className="tone tone-crowd" />Community</h3>
        {!legendOnly && (
          <Toggle on={layers.reports} onChange={set('reports')} label="Flood reports" sub="Pending reports are unverified" />
        )}
        {layers.reports && (
          <div className="legend-items">
            <span><i className="dot-sw" style={{ background: STATUS.verified.color }} />Verified by a reviewer</span>
            <span><i className="dot-sw pending" style={{ background: STATUS.pending.color }} />Pending verification</span>
            <span className="muted"><i className="dot-sw size" />Larger = more severe</span>
          </div>
        )}
        {!legendOnly && (
          <label className="check-row">
            <input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />
            Include synthetic demo reports
          </label>
        )}
      </div>

      <div className="layer-group">
        <h3 className="group-title"><span className="tone tone-ref" />Reference</h3>
        {!legendOnly && <>
          <Toggle on={layers.elevation} onChange={set('elevation')} label="Elevation" sub="Copernicus DEM GLO-30 colour relief" />
          <Toggle on={layers.hillshade} onChange={set('hillshade')} label="Hillshade" sub="Terrain shading" />
          <Toggle on={layers.landcover} onChange={set('landcover')} label="Land cover" sub="ESA WorldCover 2021" />
          <Toggle on={layers.lgas} onChange={set('lgas')} label="LGA boundaries" sub="20 LGAs · geoBoundaries" />
          <Toggle on={layers.places} onChange={set('places')} label="Towns" sub="GeoNames (population > 1,000)" />
          <Toggle on={layers.terrain3d} onChange={set('terrain3d')} label="3D terrain" sub="Exaggerated ×2.2 · drag with right mouse / two fingers to tilt" />
        </>}
        {layers.elevation && (
          <div className="legend-elev"><span className="elev-ramp" /><div><small>0 m</small><small>150 m</small><small>400 m+</small></div></div>
        )}
        {layers.landcover && (
          <div className="legend-items two">
            {Object.entries(LANDCOVER).map(([k, [n, c]]) => <span key={k}><i style={{ background: `rgb(${c.join(',')})` }} />{n}</span>)}
          </div>
        )}
      </div>
      <p className="panel-foot">Susceptibility is a long-term property of the land, <b>not a forecast</b>. <a href="/sources" onClick={(e) => { e.preventDefault(); route.navigate('/sources'); }}>What is real vs illustrative →</a></p>
    </section>
  );
}
