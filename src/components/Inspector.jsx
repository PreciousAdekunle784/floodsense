import { useMemo } from 'react';
import { Icon } from '../App.jsx';
import { ClassBar, Columns, HStack } from '../charts/charts.jsx';
import { CLASS_HEX, CLASS_NAMES, SEVERITY, STATUS, ago, coord, dateTime, dist, fmt, haversine } from '../lib/format.js';
import { FACTOR_KEYS, LANDCOVER, cellIndex } from '../lib/grid.js';
import { CLASS_ACTIONS, CLASS_MEANING, DOCUMENTED_CONTEXT, FACTOR_INFO } from '../lib/knowledge.js';
import { useStore } from '../lib/store.jsx';

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function ClassChip({ cls, scenario }) {
  if (!cls) return <span className="class-chip none">Outside model</span>;
  return (
    <span className="class-chip" style={{ '--c': CLASS_HEX[cls] }}>
      <i />{CLASS_NAMES[cls]}{cls <= 5 ? ' susceptibility' : ''}{scenario ? ' · scenario' : ''}
    </span>
  );
}

export function StatusChip({ status }) {
  const s = STATUS[status];
  return <span className="status-chip" style={{ '--c': s.color }}><b aria-hidden="true">{s.icon}</b>{s.label}</span>;
}

export const DemoBadge = () => <span className="badge badge-demo" title="Synthetic demonstration data — not a real incident">Synthetic demo</span>;

function weightsOf(geo, scenario) {
  if (scenario) {
    const s = FACTOR_KEYS.reduce((a, k) => a + scenario.weights[k], 0);
    return Object.fromEntries(FACTOR_KEYS.map((k) => [k, scenario.weights[k] / s]));
  }
  return Object.fromEntries(geo.model.factors.map((f) => [f.key, f.weight]));
}

// ------------------------------------------------------------------ overview
function Overview({ onLga }) {
  const { geo, reports, includeDemo } = useStore();
  const m = geo.model;
  const hiPct = m.class_stats[3].area_pct + m.class_stats[4].area_pct;
  const builtHi = m.lgas.reduce((s, l) => s + l.builtup_in_high_km2, 0);
  const top = [...m.lgas].sort((a, b) => b.builtup_in_high_km2 - a.builtup_in_high_km2).slice(0, 6);
  const rs = m.rainfall_series;
  const last = rs[rs.length - 1];
  const recent = rs.slice(-12);
  const pending = reports.filter((r) => r.status === 'pending').length;
  const verified = reports.filter((r) => r.status === 'verified').length;
  return (
    <div className="insp-body">
      <p className="lede">Tap anywhere in Ogun State to see why it is — or isn’t — susceptible to flooding, what the community has reported nearby, and how to prepare.</p>
      <div className="kpis three">
        <div><b>{fmt(hiPct, 0)}%</b><span>of land in High or Very-high susceptibility</span></div>
        <div><b>{fmt(builtHi, 0)} km²</b><span>built-up land inside those zones</span></div>
        <div><b>{verified}<small> / {pending}</small></b><span>verified / pending reports{includeDemo ? ' (incl. demo)' : ''}</span></div>
      </div>
      <section className="block">
        <h3 className="block-title">Built-up land in High/Very-high zones, by LGA</h3>
        <HStack label="Built-up area in high susceptibility zones by LGA" valueSuffix=" km²"
          rows={top.map((l) => ({ label: l.name, v: l.builtup_in_high_km2, lga_id: l.lga_id }))}
          series={[{ key: 'v', label: 'Built-up km² in High/Very-high', color: 'var(--accent)', decimals: 1 }]}
          onRow={(r) => onLga(r.lga_id)} />
        <p className="fine">Exposure indicator: ESA WorldCover built-up area overlaid on the susceptibility model. Click an LGA for its profile.</p>
      </section>
      <section className="block">
        <h3 className="block-title">Rainfall, last 12 months <span className="tag">satellite estimate</span></h3>
        <Columns data={recent.map((r) => ({ x: r.month, tip: `${MONTHS_LONG[Number(r.month.slice(5)) - 1]} ${r.month.slice(0, 4)}`, mm: r.mm, clim: r.clim_mm }))}
          valueKey="mm" refKey="clim" refLabel="2001–2020 average" label="Rainfall" unit=" mm" height={110}
          xLabel={(d) => MONTHS[Number(d.x.slice(5)) - 1]} highlightLast />
        <p className="fine">
          {MONTHS_LONG[Number(last.month.slice(5)) - 1]} {last.month.slice(0, 4)}: <b>{fmt(last.mm)} mm</b> state average,{' '}
          {last.anomaly_pct >= 0 ? `${fmt(last.anomaly_pct)}% above` : `${fmt(-last.anomaly_pct)}% below`} the 2001–2020 normal (tick marks).
          NASA GPM IMERG via POWER; recent months are provisional. This is observed rainfall, <b>not a forecast</b>.
        </p>
      </section>
      <section className="block context">
        <h3 className="block-title">Documented flood context</h3>
        <p>{DOCUMENTED_CONTEXT.summary}</p>
        <ul className="sources">{DOCUMENTED_CONTEXT.sources.slice(0, 3).map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a></li>)}</ul>
        <p className="fine">{DOCUMENTED_CONTEXT.note}</p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ point
function PointInfo({ lat, lon, onReportHere, onLga }) {
  const { geo, scenario, reports } = useStore();
  const g = geo.grid;
  const i = cellIndex(g, lon, lat);
  const lgaId = i >= 0 ? g.L.lga[i] : 0;
  const nearby = useMemo(() => reports.map((r) => ({ ...r, d: haversine(lat, lon, r.lat, r.lon) })).filter((r) => r.d <= 2000).sort((a, b) => a.d - b.d), [reports, lat, lon]);
  if (!lgaId) {
    return (
      <div className="insp-body">
        <p className="coord">{coord(lat, lon)}</p>
        <div className="notice">This point is outside Ogun State. The FloodSense pilot models and accepts reports for Ogun State only.</div>
      </div>
    );
  }
  const lga = geo.lgas.features.find((f) => f.properties.lga_id === lgaId);
  const cls = (scenario ? scenario.cls : g.L.cls)[i];
  const w = weightsOf(geo, scenario);
  const contrib = FACTOR_KEYS.map((k) => ({ k, m: g.L[`m_${k}`][i] / 255, w: w[k] })).map((x) => ({ ...x, c: x.m * x.w }));
  const index = contrib.reduce((s, x) => s + x.c, 0);
  const D = g.D;
  const lc = LANDCOVER[g.L.lc[i]];
  const ref = g.L.ref[i];
  const place = geo.places.features.map((f) => ({ name: f.properties.name, d: haversine(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) })).sort((a, b) => a.d - b.d)[0];
  const maxC = Math.max(...contrib.map((x) => x.w));
  return (
    <div className="insp-body">
      <p className="coord">{coord(lat, lon)}{D ? ` · ${D.elev[i] - 100} m a.s.l.` : ''}</p>
      <p className="where">
        <button className="linkish" onClick={() => onLga(lgaId)}>{lga.properties.name} LGA</button>
        {place && <> · {dist(place.d)} from {place.name}</>}
      </p>
      <div className="class-hero" style={{ '--c': CLASS_HEX[cls] }}>
        <ClassChip cls={cls} scenario={!!scenario} />
        {cls <= 5 && <span className="index">index {index.toFixed(2)}</span>}
        <p>{CLASS_MEANING[cls]}</p>
      </div>

      {cls <= 5 && (
        <section className="block">
          <h3 className="block-title">Why — factor contributions</h3>
          <ul className="contrib">
            {contrib.map((x) => (
              <li key={x.k}>
                <div className="c-head"><span>{FACTOR_INFO[x.k].short}</span><b>{x.k === 'lulc' ? lc?.[0] || '—' : D ? FACTOR_INFO[x.k].fmt(D, i) : '…'}</b></div>
                <div className="c-bar" title={`Membership ${x.m.toFixed(2)} × weight ${x.w.toFixed(2)} = ${x.c.toFixed(3)}`}>
                  <span className="c-weight" style={{ width: `${(100 * x.w) / maxC}%` }}><span className="c-fill" style={{ width: `${100 * x.m}%` }} /></span>
                  <em>{x.c.toFixed(3)}</em>
                </div>
              </li>
            ))}
          </ul>
          <p className="fine">Each bar’s outline is the factor’s weight; the fill shows how strongly this location scores on it (0–1). Index = sum of contributions.</p>
        </section>
      )}

      <section className="block facts">
        <div><span>Observed water (Landsat 1984–2021)</span><b>{ref === 1 ? 'Water seen here at least occasionally' : ref === 2 ? 'Permanent water' : 'Not observed at this 150 m cell'}</b></div>
        <div><span>Built-up share of cell</span><b>{g.L.builtup[i]}%</b></div>
      </section>

      <section className="block">
        <h3 className="block-title">Community reports within 2 km</h3>
        {nearby.length === 0 ? <p className="muted">No reports nearby. Absence of reports does not mean an area does not flood.</p> : (
          <ul className="mini-reports">
            {nearby.slice(0, 5).map((r) => (
              <li key={r.ref}><StatusChip status={r.status} /><span>{SEVERITY[r.severity].name} · {dist(r.d)} · {ago(r.observed_at)}</span>{r.is_demo && <DemoBadge />}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="block prepare">
        <h3 className="block-title">Preparedness for this kind of location <span className="tag">general guidance</span></h3>
        <ul className="ticks">{(CLASS_ACTIONS[cls] || []).map((a) => <li key={a}>{a}</li>)}</ul>
        <p className="fine">Based on the long-term susceptibility class — not a forecast for today. Follow NIHSA, NiMet and Ogun State agencies for official warnings.</p>
      </section>
      <button className="btn btn-accent wide" onClick={() => onReportHere({ lat, lon })}><Icon name="plus" size={16} />Report flooding at this location</button>
    </div>
  );
}

// ------------------------------------------------------------------ LGA
function LgaInfo({ lgaId, onZoom }) {
  const { geo, scenario, reports } = useStore();
  const s = geo.model.lgas.find((l) => l.lga_id === lgaId);
  const rs = reports.filter((r) => r.lga === s.name);
  const rank = [...geo.model.lgas].sort((a, b) => b.high_or_very_high_pct - a.high_or_very_high_pct).findIndex((l) => l.lga_id === lgaId) + 1;
  return (
    <div className="insp-body">
      <p className="where">{fmt(s.area_km2)} km² · elevation {fmt(s.elev_min_m)}–{fmt(s.elev_max_m)} m · rank {rank}/20 by High+Very-high share</p>
      <section className="block">
        <h3 className="block-title">Susceptibility classes (share of land)</h3>
        <ClassBar shares={s.class_pct} compare={scenario ? scenario.lgaShares[lgaId] : null} baseLabel="Baseline model" compareLabel={`Scenario: ${scenario?.name}`} height={16} />
      </section>
      <div className="kpis">
        <div><b>{fmt(s.high_or_very_high_pct, 1)}%</b><span>High + Very-high</span></div>
        <div><b>{fmt(s.builtup_in_high_km2, 1)} km²</b><span>built-up land in those zones (of {fmt(s.builtup_km2, 1)})</span></div>
        <div><b>{fmt(s.channel_km)} km</b><span>modelled drainage channels</span></div>
        <div><b>{fmt(s.observed_water_km2, 1)} km²</b><span>intermittent water seen by Landsat</span></div>
      </div>
      <section className="block">
        <h3 className="block-title">Average monthly rainfall <span className="tag">IMERG 2001–2020</span></h3>
        <Columns data={s.rain_monthly_mm.map((v, k) => ({ x: MONTHS[k], tip: MONTHS_LONG[k], mm: v }))} valueKey="mm" label="Mean rainfall" unit=" mm" height={100} xLabel={(d) => d.x} />
        <p className="fine">{fmt(s.rain_annual_mm)} mm a year on average. Two wet peaks (June and September) with the “August break” between — the typical south-west Nigerian pattern.</p>
      </section>
      <section className="block">
        <h3 className="block-title">Community reports in this LGA</h3>
        {rs.length === 0 ? <p className="muted">No current reports.</p> : (
          <ul className="mini-reports">
            {rs.slice(0, 6).map((r) => <li key={r.ref}><StatusChip status={r.status} /><span>{SEVERITY[r.severity].name} · {ago(r.observed_at)}</span>{r.is_demo && <DemoBadge />}</li>)}
          </ul>
        )}
      </section>
      <button className="btn btn-ghost wide" onClick={onZoom}>Zoom to {s.name}</button>
    </div>
  );
}

// ------------------------------------------------------------------ report
function ReportInfo({ refCode }) {
  const { reports } = useStore();
  const r = reports.find((x) => x.ref === refCode);
  if (!r) return <div className="insp-body"><p className="muted">This report is no longer public.</p></div>;
  return (
    <div className="insp-body">
      <div className="row-gap"><StatusChip status={r.status} />{r.is_demo && <DemoBadge />}</div>
      <p className="coord">{r.ref} · {coord(r.lat, r.lon)} (±{r.precision_m} m)</p>
      <dl className="dl">
        <dt>Severity</dt><dd><b>{SEVERITY[r.severity].name}</b> — {SEVERITY[r.severity].hint}</dd>
        <dt>LGA</dt><dd>{r.lga || '—'}{r.community ? ` · ${r.community}` : ''}</dd>
        <dt>Observed</dt><dd>{dateTime(r.observed_at)} ({ago(r.observed_at)})</dd>
        <dt>Submitted</dt><dd>{dateTime(r.created_at)}</dd>
        {r.verified_at && <><dt>Verified</dt><dd>{dateTime(r.verified_at)}</dd></>}
        <dt>Modelled class here</dt><dd><ClassChip cls={r.geo_class} /></dd>
      </dl>
      {r.status === 'verified' ? (
        <>
          <blockquote className="quote">{r.description}</blockquote>
          {r.has_photo && <img className="report-photo" src={`/api/reports/${r.ref}/photo`} alt="Photo submitted with the report" loading="lazy" />}
        </>
      ) : (
        <div className="notice">Unverified report. The description and any photo stay hidden, and the location is shown to about 110 m, until a verifier has checked it.</div>
      )}
      {r.is_demo && <p className="fine">Synthetic demonstration record generated for the prototype — not a real incident.</p>}
    </div>
  );
}

export default function Inspector({ selection, onClose, onReportHere, onLga, onZoomLga }) {
  const { geo } = useStore();
  if (!geo) return null;
  let title = 'Ogun State overview';
  let eyebrow = 'Explore';
  let body = <Overview onLga={onLga} />;
  if (selection?.type === 'point') {
    title = 'Location analysis'; eyebrow = 'Point inspection';
    body = <PointInfo lat={selection.lat} lon={selection.lon} onReportHere={onReportHere} onLga={onLga} />;
  } else if (selection?.type === 'lga') {
    const f = geo.lgas.features.find((x) => x.properties.lga_id === selection.lga_id);
    title = f.properties.name; eyebrow = 'Local Government Area';
    body = <LgaInfo lgaId={selection.lga_id} onZoom={() => onZoomLga(selection.lga_id)} />;
  } else if (selection?.type === 'report') {
    title = 'Community report'; eyebrow = 'Crowd-sourced';
    body = <ReportInfo refCode={selection.ref} />;
  }
  return (
    <section className="inspector" aria-label={title}>
      <header className="panel-head">
        <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
        {selection && <button className="icon-btn sm" onClick={onClose} aria-label="Back to overview"><Icon name="close" size={16} /></button>}
      </header>
      {body}
    </section>
  );
}
