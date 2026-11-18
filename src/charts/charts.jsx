/*
 * Small SVG chart kit. Rules applied (dataviz skill): one axis per chart, thin marks with 2px surface gaps,
 * rounded data-ends, recessive gridlines, legends for multi-series, hover tooltips on every mark,
 * text in ink tokens (never series colour).
 */
import { useRef, useState } from 'react';
import { CLASS_HEX, CLASS_NAMES, fmt } from '../lib/format.js';

function useTip() {
  const [tip, setTip] = useState(null);
  const box = useRef(null);
  const show = (e, content) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content, w: r.width });
  };
  const hide = () => setTip(null);
  const node = tip && (
    <div className="chart-tip" style={{ left: Math.min(Math.max(tip.x, 70), tip.w - 70), top: tip.y }} role="tooltip">{tip.content}</div>
  );
  return { box, show, hide, node };
}

export function Legend({ items }) {
  return (
    <ul className="legend-row">
      {items.map((i) => (
        <li key={i.label}><span className="sw" style={{ background: i.color, borderStyle: i.dashed ? 'dashed' : undefined }} />{i.label}</li>
      ))}
    </ul>
  );
}

/** 100% horizontal stacked bar of the five susceptibility classes. */
export function ClassBar({ shares, height = 14, compare, compareLabel = 'Scenario', baseLabel, labels = true }) {
  const t = useTip();
  const row = (vals, tag) => {
    const total = vals.reduce((s, v) => s + v, 0) || 1;
    return (
      <div className="classbar" style={{ height }}>
        {vals.map((v, i) => v > 0 && (
          <span key={i} style={{ flexGrow: v / total, background: CLASS_HEX[i + 1] }}
            onMouseMove={(e) => t.show(e, <><b>{CLASS_NAMES[i + 1]}</b>{tag ? ` · ${tag}` : ''}<br />{fmt(v, 1)}% of land area</>)} onMouseLeave={t.hide} />
        ))}
      </div>
    );
  };
  return (
    <div className="chart" ref={t.box} role="img" aria-label={`Susceptibility class shares: ${shares.map((s, i) => `${CLASS_NAMES[i + 1]} ${fmt(s, 1)}%`).join(', ')}`}>
      {compare && <div className="classbar-tag">{baseLabel || 'Baseline'}</div>}
      {row(shares, compare ? baseLabel || 'Baseline' : '')}
      {labels && !compare && (
        <div className="classbar-labels">
          {shares.map((s, i) => <span key={i} style={{ flexGrow: Math.max(s, 0.0001) }}>{s >= 9 ? `${fmt(s, 0)}%` : ''}</span>)}
        </div>
      )}
      {compare && <><div className="classbar-tag">{compareLabel}</div>{row(compare, compareLabel)}</>}
      {t.node}
    </div>
  );
}

/** Vertical bars (e.g. monthly rainfall) with an optional reference value per bar drawn as a tick on the same axis. */
export function Columns({ data, valueKey, refKey, refLabel, label, unit = '', height = 150, color = 'var(--river)', format = (v) => fmt(v), xLabel = (d) => d.x, highlightLast }) {
  const t = useTip();
  const max = Math.max(1, ...data.map((d) => Math.max(d[valueKey] || 0, refKey ? d[refKey] || 0 : 0)));
  const nice = niceMax(max);
  const ticks = [nice, nice / 2, 0];
  return (
    <div className="chart" ref={t.box}>
      <div className="chart-plot" style={{ height }} role="img" aria-label={label}>
        <div className="y-ticks">{ticks.map((v) => <span key={v}>{format(v)}</span>)}</div>
        <div className="plot-area">
          {ticks.map((v) => <i key={v} className="gridline-h" style={{ bottom: `${(100 * v) / nice}%` }} />)}
          <div className="cols">
            {data.map((d, i) => (
              <div key={i} className="col" onMouseMove={(e) => t.show(e, <><b>{d.tip || xLabel(d)}</b><br />{label}: {format(d[valueKey])}{unit}{refKey && d[refKey] != null ? <><br />{refLabel}: {format(d[refKey])}{unit}</> : null}</>)} onMouseLeave={t.hide}>
                <span className="bar" style={{ height: `${(100 * (d[valueKey] || 0)) / nice}%`, background: color, opacity: highlightLast && i !== data.length - 1 ? 0.55 : 1 }} />
                {refKey && d[refKey] != null && <span className="ref-tick" style={{ bottom: `${(100 * d[refKey]) / nice}%` }} />}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="x-labels">{data.map((d, i) => <span key={i}>{xLabel(d, i)}</span>)}</div>
      {t.node}
    </div>
  );
}

/** Stacked columns (e.g. daily reports by status). */
export function StackedColumns({ data, series, height = 140, label, xLabel }) {
  const t = useTip();
  const totals = data.map((d) => series.reduce((s, k) => s + (d[k.key] || 0), 0));
  const nice = niceMax(Math.max(1, ...totals), true);
  const ticks = [nice, nice / 2, 0];
  return (
    <div className="chart" ref={t.box}>
      <div className="chart-plot" style={{ height }} role="img" aria-label={label}>
        <div className="y-ticks">{ticks.map((v) => <span key={v}>{v}</span>)}</div>
        <div className="plot-area">
          {ticks.map((v) => <i key={v} className="gridline-h" style={{ bottom: `${(100 * v) / nice}%` }} />)}
          <div className="cols">
            {data.map((d, i) => (
              <div key={i} className="col stack" onMouseMove={(e) => t.show(e, <><b>{d.tip || xLabel?.(d, i)}</b>{series.map((s) => <div key={s.key}><span className="sw-inline" style={{ background: s.color }} />{s.label}: {d[s.key] || 0}</div>)}</>)} onMouseLeave={t.hide}>
                {series.map((s) => (d[s.key] ? <span key={s.key} className="seg" style={{ height: `calc(${(100 * d[s.key]) / nice}% - 2px)`, background: s.color }} /> : null))}
              </div>
            ))}
          </div>
        </div>
      </div>
      {xLabel && <div className="x-labels">{data.map((d, i) => <span key={i}>{xLabel(d, i)}</span>)}</div>}
      {t.node}
    </div>
  );
}

/** Horizontal stacked bars, one row per category (e.g. reports by LGA by status). */
export function HStack({ rows, series, label, max: maxIn, onRow, valueSuffix = '' }) {
  const t = useTip();
  const max = maxIn || Math.max(1, ...rows.map((r) => series.reduce((s, k) => s + (r[k.key] || 0), 0)));
  return (
    <div className="chart hstack" ref={t.box} role="img" aria-label={label}>
      {rows.map((r) => {
        const total = series.reduce((s, k) => s + (r[k.key] || 0), 0);
        return (
          <div key={r.label} className={`hrow ${onRow ? 'clickable' : ''}`} onClick={onRow ? () => onRow(r) : undefined}>
            <span className="hlabel" title={r.label}>{r.label}</span>
            <span className="htrack">
              {series.map((s) => {
                const v = r[s.key] || 0;
                if (!v) return null;
                return <span key={s.key} className="hseg" style={{ width: `calc(${(100 * v) / max}% - 2px)`, background: s.color }}
                  onMouseMove={(e) => t.show(e, <><b>{r.label}</b><br />{s.label}: {fmt(v, s.decimals || 0)}{valueSuffix}</>)} onMouseLeave={t.hide} />;
              })}
            </span>
            <span className="hval">{fmt(total, series[0].decimals || 0)}{valueSuffix}</span>
          </div>
        );
      })}
      {t.node}
    </div>
  );
}

/** Paired horizontal bars: share of area vs share of reports per class. */
export function PairedBars({ rows, a, b, label }) {
  const t = useTip();
  const max = Math.max(1, ...rows.flatMap((r) => [r[a.key], r[b.key]]));
  return (
    <div className="chart paired" ref={t.box} role="img" aria-label={label}>
      {rows.map((r) => (
        <div className="prow" key={r.label}>
          <span className="hlabel"><span className="sw-inline" style={{ background: r.color }} />{r.label}</span>
          <div className="pbars">
            {[a, b].map((s) => (
              <div className="pbar" key={s.key} onMouseMove={(e) => t.show(e, <><b>{r.label}</b><br />{s.label}: {fmt(r[s.key], 1)}%</>)} onMouseLeave={t.hide}>
                <span style={{ width: `${(100 * r[s.key]) / max}%`, background: s.color }} />
                <em>{fmt(r[s.key], 0)}%</em>
              </div>
            ))}
          </div>
        </div>
      ))}
      {t.node}
    </div>
  );
}

/** Piecewise-linear membership curve. */
export function Curve({ knots, unit, height = 64 }) {
  const xs = knots.map((k) => k[0]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const pad = (x1 - x0) * 0.08;
  const sx = (x) => (100 * (x - x0 + pad)) / (x1 - x0 + 2 * pad);
  const sy = (y) => height - 6 - y * (height - 12);
  const pts = [[x0 - pad, knots[0][1]], ...knots, [x1 + pad, knots[knots.length - 1][1]]];
  return (
    <div className="curve">
      <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="100" y1={sy(0)} y2={sy(0)} className="gridline" vectorEffect="non-scaling-stroke" />
        <line x1="0" x2="100" y1={sy(1)} y2={sy(1)} className="gridline" vectorEffect="non-scaling-stroke" />
        <polyline points={pts.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="curve-x"><span>{fmt(x0)}{unit ? ` ${unit}` : ''}</span><span>{fmt(x1)}{unit ? ` ${unit}` : ''}</span></div>
    </div>
  );
}

function niceMax(v, integer) {
  if (integer && v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  const out = n * p;
  return integer ? Math.max(2, Math.ceil(out / 2) * 2) : out;
}
