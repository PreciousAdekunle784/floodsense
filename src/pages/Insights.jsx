import { useEffect, useMemo, useState } from 'react';
import { Link } from '../App.jsx';
import { Columns, HStack, Legend, PairedBars, StackedColumns } from '../charts/charts.jsx';
import { api } from '../lib/api.js';
import { CLASS_HEX, CLASS_NAMES, SEVERITY, STATUS, ago, dateTime, fmt } from '../lib/format.js';
import { useStore } from '../lib/store.jsx';

const SERIES = ['verified', 'pending', 'duplicate', 'rejected'].map((k) => ({ key: k, label: STATUS[k].short, color: STATUS[k].color }));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Insights() {
  const { geo, includeDemo, setIncludeDemo, route, setSelection } = useStore();
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState(null);
  const [sort, setSort] = useState('builtup_in_high_km2');

  useEffect(() => {
    let alive = true;
    const load = () => api(`/stats?include_demo=${includeDemo ? 1 : 0}&days=${days}`).then((s) => { if (alive) { setStats(s); setErr(null); } }).catch((e) => alive && setErr(e.message));
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [includeDemo, days]);

  const lgaRows = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.by_lga).map(([label, v]) => ({ label, ...v, total: v.pending + v.verified + v.rejected + v.duplicate }))
      .sort((a, b) => b.total - a.total).slice(0, 12);
  }, [stats]);

  const classRows = useMemo(() => {
    if (!stats || !geo) return [];
    const ver = stats.geo_class.filter((g) => g.cls <= 5);
    const totV = ver.reduce((s, g) => s + g.verified + g.pending, 0) || 1;
    return ver.map((g) => ({ label: CLASS_NAMES[g.cls], color: CLASS_HEX[g.cls], area: geo.model.class_stats[g.cls - 1].area_pct, reports: (100 * (g.verified + g.pending)) / totV }));
  }, [stats, geo]);

  const lgaTable = useMemo(() => (geo ? [...geo.model.lgas].sort((a, b) => b[sort] - a[sort]) : []), [geo, sort]);
  const openLga = (id) => { setSelection({ type: 'lga', lga_id: id }); route.navigate('/'); };

  if (!geo) return <div className="page-loading"><span className="spinner" />Loading…</div>;
  const s = stats;
  const rs = geo.model.rainfall_series.slice(-24);
  const lastRain = rs[rs.length - 1];
  const reviewed = s ? s.status.verified + s.status.rejected + s.status.duplicate : 0;

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <div>
            <p className="eyebrow">Flood intelligence dashboard</p>
            <h1>Insights · Ogun State</h1>
            <p>Report figures are computed live from the FloodSense database; terrain and exposure figures come from the GIS model. {s && <>Updated {ago(s.generated_at)}.</>}</p>
          </div>
          <div className="filters">
            <div className="seg" role="group" aria-label="Time window">
              {[7, 30, 90].map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d} days</button>)}
            </div>
            <label className="check-row"><input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />Include synthetic demo reports</label>
          </div>
        </header>
        {err && <div className="alert" role="alert">{err}</div>}
        {s && s.demo_count > 0 && <div className="notice">{s.demo_count} of {s.total} reports below are <b>synthetic demonstration records</b>, not real incidents. Untick “Include synthetic demo reports” to see only genuine submissions.</div>}

        {s && (
          <div className="stat-row" role="list">
            <div className="stat" role="listitem"><span className="k">Reports submitted</span><span className="v">{s.total}</span><span className="d">all time</span></div>
            <div className="stat" role="listitem"><span className="k"><i style={{ background: STATUS.pending.color }} />Awaiting verification</span><span className="v">{s.status.pending}</span><span className="d">{s.pending_over_48h} waiting &gt; 48 h · {s.flagged_pending} flagged</span></div>
            <div className="stat" role="listitem"><span className="k"><i style={{ background: STATUS.verified.color }} />Verified incidents</span><span className="v">{s.status.verified}</span><span className="d">{reviewed ? `${fmt((100 * s.status.verified) / reviewed)}% of reviewed` : 'none reviewed yet'}</span></div>
            <div className="stat" role="listitem"><span className="k"><i style={{ background: STATUS.rejected.color }} />Rejected / duplicate</span><span className="v">{s.status.rejected + s.status.duplicate}</span><span className="d">{s.status.rejected} rejected · {s.status.duplicate} duplicate</span></div>
            <div className="stat" role="listitem"><span className="k">Median time to verify</span><span className="v">{s.median_hours_to_verify == null ? '—' : `${fmt(s.median_hours_to_verify, 1)} h`}</span><span className="d">submission → verification</span></div>
            <div className="stat" role="listitem"><span className="k">Data freshness</span><span className="v" style={{ fontSize: 18 }}>{ago(s.last_report_at)}</span><span className="d">last report · last verified {ago(s.last_verified_at)}</span></div>
          </div>
        )}

        <div className="grid">
          <section className="card span-7">
            <h2>Recent activity</h2>
            <p className="sub">Reports received per day (last {days} days), by current verification status.</p>
            {s && <>
              <Legend items={SERIES} />
              <StackedColumns data={s.daily.map((d) => ({ ...d, tip: new Date(d.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) }))} series={SERIES} height={170}
                label="Daily reports by status" xLabel={(d, i) => (i % Math.ceil(days / 8) === 0 ? new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')} />
            </>}
          </section>

          <section className="card span-5">
            <h2>Reports by LGA</h2>
            <p className="sub">Where reports are coming from (top 12 LGAs), by status.</p>
            {s && (lgaRows.length ? <>
              <Legend items={SERIES} />
              <HStack rows={lgaRows} series={SERIES} label="Reports by LGA and status" onRow={(r) => { const l = geo.model.lgas.find((x) => x.name === r.label); if (l) openLga(l.lga_id); }} />
            </> : <p className="empty-state">No reports yet.</p>)}
          </section>

          <section className="card span-6">
            <h2>Reports vs modelled susceptibility</h2>
            <p className="sub">Share of land area in each class compared with the share of pending + verified reports located in it. If community reports cluster in the high classes, the two sources of evidence agree.</p>
            {s && <>
              <Legend items={[{ label: 'Share of Ogun land area', color: 'var(--ink-3)' }, { label: 'Share of reports', color: 'var(--accent)' }]} />
              <PairedBars rows={classRows} a={{ key: 'area', label: 'Land area', color: 'var(--ink-3)' }} b={{ key: 'reports', label: 'Reports', color: 'var(--accent)' }} label="Area share vs report share by susceptibility class" />
              <p className="fine">With few reports this comparison is anecdotal. Demo reports were deliberately sampled towards higher classes, so judge this chart on genuine data only.</p>
            </>}
          </section>

          <section className="card span-6">
            <h2>Severity of reports</h2>
            <p className="sub">Verified and pending reports by reported severity.</p>
            {s && <>
              <Legend items={[{ label: 'Verified', color: STATUS.verified.color }, { label: 'Pending', color: STATUS.pending.color }]} />
              <HStack rows={s.severity.map((x) => ({ label: SEVERITY[x.severity].name, verified: x.verified, pending: x.pending }))}
                series={[{ key: 'verified', label: 'Verified', color: STATUS.verified.color }, { key: 'pending', label: 'Pending', color: STATUS.pending.color }]} label="Reports by severity" />
              <p className="fine">Severity is the reporter’s own description. Verifiers confirm that flooding occurred; they do not re-measure depth.</p>
            </>}
          </section>

          <section className="card span-8">
            <h2>Rainfall: last 24 months vs normal</h2>
            <p className="sub">Monthly rainfall averaged over Ogun State (bars) with the 2001–2020 average for the same month (dark ticks). Same axis, millimetres.</p>
            <Columns data={rs.map((r) => ({ x: r.month, tip: `${MONTHS[Number(r.month.slice(5)) - 1]} ${r.month.slice(0, 4)} · ${r.anomaly_pct >= 0 ? '+' : ''}${fmt(r.anomaly_pct)}% vs normal`, mm: r.mm, clim: r.clim_mm }))}
              valueKey="mm" refKey="clim" refLabel="2001–2020 average" label="Rainfall" unit=" mm" height={170}
              xLabel={(d, i) => (i % 3 === 0 ? `${MONTHS[Number(d.x.slice(5)) - 1]} ${d.x.slice(2, 4)}` : '')} />
            <p className="fine">Source: NASA GPM IMERG (via NASA POWER v10, 0.1°), cells whose centre falls in Ogun State. Latest month {MONTHS[Number(lastRain.month.slice(5)) - 1]} {lastRain.month.slice(0, 4)}; recent months are provisional and will be revised. This is observed rainfall, not a forecast.</p>
          </section>

          <section className="card span-4">
            <h2>Model at a glance</h2>
            <p className="sub">Share of Ogun State’s land in each susceptibility class (permanent water excluded).</p>
            <HStack rows={geo.model.class_stats.map((c) => ({ label: c.name, v: c.area_km2 }))}
              series={[{ key: 'v', label: 'Area km²', color: 'var(--accent)' }]} valueSuffix=" km²" label="Area by susceptibility class" />
            <p className="fine">Agreement with Landsat-observed intermittent water: AUC {geo.model.validation.auc}. <Link to="/model">How the model works →</Link></p>
          </section>

          <section className="card span-12">
            <h2>LGA exposure table</h2>
            <p className="sub">Modelled susceptibility and exposure for all 20 LGAs. Click a column to sort, a row to open the LGA on the map.</p>
            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>LGA</th>
                    {[['area_km2', 'Area km²'], ['high_or_very_high_pct', 'High + V.high'], ['builtup_in_high_km2', 'Built-up in high km²'], ['builtup_km2', 'Built-up km²'], ['elev_mean_m', 'Mean elev. m'], ['rain_annual_mm', 'Rain mm/yr'], ['observed_water_km2', 'Obs. water km²']].map(([k, l]) => (
                      <th key={k} className="num"><button className={sort === k ? 'on' : ''} onClick={() => setSort(k)} aria-sort={sort === k ? 'descending' : 'none'}>{l}{sort === k ? ' ↓' : ''}</button></th>
                    ))}
                    <th>Reports</th>
                  </tr>
                </thead>
                <tbody>
                  {lgaTable.map((l) => {
                    const r = s?.by_lga[l.name];
                    return (
                      <tr key={l.lga_id} className="clickable" onClick={() => openLga(l.lga_id)}>
                        <td><b>{l.name}</b></td>
                        <td className="num">{fmt(l.area_km2)}</td>
                        <td className="num"><span className="inline-bar" style={{ width: `${l.high_or_very_high_pct * 0.8}px` }} />{fmt(l.high_or_very_high_pct, 1)}%</td>
                        <td className="num">{fmt(l.builtup_in_high_km2, 1)}</td>
                        <td className="num">{fmt(l.builtup_km2, 1)}</td>
                        <td className="num">{fmt(l.elev_mean_m)}</td>
                        <td className="num">{fmt(l.rain_annual_mm)}</td>
                        <td className="num">{fmt(l.observed_water_km2, 1)}</td>
                        <td>{r ? <span className="muted">{r.verified} verified · {r.pending} pending</span> : <span className="muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="fine">Built-up area from ESA WorldCover 2021; “in high” = inside High or Very-high susceptibility cells. Areas computed on the 90 m analysis grid in UTM zone 31N. Report counts include {includeDemo ? 'synthetic demo data' : 'genuine submissions only'}.</p>
          </section>
        </div>
        <p className="fine">Generated {s ? dateTime(s.generated_at) : '—'} · Reports refresh every 30 s.</p>
      </div>
    </div>
  );
}
