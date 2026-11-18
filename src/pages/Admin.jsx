import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../App.jsx';
import { DemoBadge, StatusChip } from '../components/Inspector.jsx';
import MapView from '../components/MapView.jsx';
import { api, setCsrf } from '../lib/api.js';
import { CLASS_NAMES, SEVERITY, ago, coord, dateTime, dist, fmt } from '../lib/format.js';
import { LANDCOVER } from '../lib/grid.js';
import { useStore } from '../lib/store.jsx';

const FLAG_TEXT = {
  contains_link: 'Description contains a web link — common in spam.',
  repeated_text: 'Same text as another report submitted in the last 24 h.',
  many_from_same_client: 'Three or more reports from the same device in 24 h.',
  severe_in_very_low_susceptibility: 'Severe flooding reported where the model shows Very-low susceptibility. Check carefully — it may be drain failure, or a misplaced pin.',
  on_permanent_water: 'The pin is on a permanent water body — the location may be misplaced.',
  manual_flag: 'Flagged by a verifier for closer review.',
};
const REASONS = ['Not a flood (photo/description)', 'Spam or advertising', 'Location clearly wrong', 'Insufficient information', 'Could not be corroborated'];

function Login({ onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email, password } });
      setCsrf(r.csrf);
      onDone(r.user);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="page"><form className="login" onSubmit={submit}>
      <p className="eyebrow">Module F · Restricted</p>
      <h1>Verifier sign-in</h1>
      <p>For trained FloodSense verifiers and administrators. Accounts are created by an administrator with <code>npm run setup</code> — there is no public sign-up and no default password.</p>
      {err && <div className="alert" role="alert">{err}</div>}
      <label className="field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
      <label className="field"><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      <button className="btn btn-accent wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="fine">Sessions use an HttpOnly, SameSite=Strict cookie and expire after 12 hours. Five failed attempts lock the account for 15 minutes from this device.</p>
    </form></div>
  );
}

function Signals({ ctx, report }) {
  const g = ctx.grid || {};
  const checks = [
    { ok: g.cls >= 4 && g.cls <= 5, label: 'Modelled susceptibility', value: g.cls ? CLASS_NAMES[g.cls] : 'Outside model' },
    { ok: g.hand_m != null && g.hand_m < 5, label: 'Height above drainage', value: g.hand_m != null ? `${g.hand_m.toFixed(1)} m` : '—' },
    { ok: g.dist_m != null && g.dist_m < 500, label: 'Distance to channel', value: dist(g.dist_m) },
    { ok: g.ref_water === 1, label: 'Landsat-observed water', value: g.ref_water === 1 ? 'Seen here before' : g.ref_water === 2 ? 'Permanent water' : 'Not seen' },
  ];
  const score = checks.filter((c) => c.ok).length;
  const verdict = score >= 3 ? 'Terrain strongly consistent with flooding here' : score >= 1 ? 'Terrain partly consistent' : 'Unusual location for flooding — check carefully (urban drain failure is still possible)';
  return (
    <section className="block">
      <h3 className="block-title">GIS consistency check <span className="tag">{score}/4</span></h3>
      <p style={{ fontSize: 13 }}><b>{verdict}.</b></p>
      <div className="signals">
        {checks.map((c) => <div key={c.label} className={`signal ${c.ok ? 'hi' : 'lo'}`}><span>{c.label}</span><b>{c.value}</b></div>)}
        <div className="signal"><span>Elevation</span><b>{g.elev_m != null ? `${g.elev_m} m` : '—'}</b></div>
        <div className="signal"><span>Land cover</span><b>{LANDCOVER[g.landcover]?.[0] || '—'} · {g.builtup_pct ?? 0}% built-up</b></div>
      </div>
      <p className="fine">Signals support a decision; they never decide. Location precision depends on how the reporter placed the pin ({report.location_method}).</p>
    </section>
  );
}

function Detail({ id, user, onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState('');
  const [dupRef, setDupRef] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/admin/reports/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { setD(null); setNote(''); setDupRef(''); setErr(null); load(); }, [load]);
  const act = async (action, extra = {}) => {
    setBusy(true); setErr(null);
    try {
      await api(`/admin/reports/${id}/review`, { method: 'POST', body: { action, note, ...extra } });
      setNote('');
      await load();
      onChanged(action);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  if (err && !d) return <div className="alert">{err}</div>;
  if (!d) return <div className="page-loading"><span className="spinner" />Loading report…</div>;
  const r = d.report;
  const candidates = d.nearby.filter((n) => ['verified', 'pending'].includes(n.status) && n.hours_apart <= 48);
  return (
    <>
      <div className="row-gap"><StatusChip status={r.status} />{r.is_demo && <DemoBadge />}{r.flagged && <span className="flag-dot">⚑ Flagged</span>}</div>
      <h2 style={{ marginTop: 8 }}>{r.ref}</h2>
      <p className="coord">{coord(r.lat, r.lon)} · exact location (private)</p>
      <dl className="dl">
        <dt>Severity</dt><dd><b>{SEVERITY[r.severity].name}</b> — {SEVERITY[r.severity].hint}</dd>
        <dt>Where</dt><dd>{r.lga_name || '—'} LGA{r.community ? ` · “${r.community}”` : ''}{d.context.nearestPlace && <><br /><span className="muted">{dist(d.context.nearestPlace.distance_m)} from {d.context.nearestPlace.name}</span></>}</dd>
        <dt>Observed</dt><dd>{dateTime(r.observed_at)}</dd>
        <dt>Submitted</dt><dd>{dateTime(r.created_at)} ({ago(r.created_at)})</dd>
        <dt>Located by</dt><dd>{{ gps: 'Device GPS', map: 'Pin on map', search: 'Place search' }[r.location_method]}</dd>
      </dl>
      <blockquote className="quote" style={{ borderLeftColor: 'var(--ink-3)' }}>{r.description}</blockquote>
      {r.has_photo && <img className="report-photo" src={`/api/admin/reports/${r.id}/photo`} alt="Photo submitted with the report" />}
      {r.flags.length > 0 && (
        <section className="block"><h3 className="block-title">Automated quality flags</h3>
          <ul className="flags">{r.flags.map((f) => <li key={f}>{FLAG_TEXT[f] || f}</li>)}</ul></section>
      )}
      <Signals ctx={d.context} report={r} />
      <section className="block">
        <h3 className="block-title">Corroboration within 1.5 km</h3>
        {d.nearby.length === 0 ? <p className="muted">No other reports nearby.</p> : (
          <ul className="mini-reports">
            {d.nearby.slice(0, 6).map((n) => (
              <li key={n.id}><StatusChip status={n.status} /><span className="q-ref">{n.ref}</span><span>{dist(n.distance_m)} · {n.hours_apart} h apart</span>
                {r.status === 'pending' && ['verified', 'pending'].includes(n.status) && <button className="btn btn-ghost xs" onClick={() => setDupRef(n.ref)}>Use as original</button>}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="block">
        <h3 className="block-title">Reporter contact</h3>
        {r.contact_consent ? (
          r.contact_purged_at ? <p className="muted">Deleted on {dateTime(r.contact_purged_at)} (retention policy).</p> : (
            <div className="contact-box">{r.contact_name && <div>{r.contact_name}</div>}{r.contact_phone && <div>{r.contact_phone}</div>}{r.contact_email && <div>{r.contact_email}</div>}
              <p className="fine">Shared with consent for follow-up only. Auto-deleted 30 days after review.</p></div>
          )
        ) : <p className="muted">Anonymous report.</p>}
      </section>

      <div className="actions">
        {err && <div className="alert" role="alert">{err}</div>}
        <label className="field" style={{ margin: 0 }}><span>Review note {r.status === 'pending' ? '(required to reject)' : '(required to re-open)'}</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What did you check?" /></label>
        {r.status === 'pending' ? (
          <>
            <div className="reason-chips">{REASONS.map((x) => <button key={x} onClick={() => setNote(x)}>{x}</button>)}</div>
            <div className="row-gap">
              <button className="btn btn-good" disabled={busy} onClick={() => act('verify')}><Icon name="check" size={16} />Verify</button>
              <button className="btn btn-crit" disabled={busy || !note.trim()} onClick={() => act('reject')} title={!note.trim() ? 'Add a reason first' : ''}>Reject</button>
            </div>
            <div className="row-gap">
              <input className="select" style={{ flex: 1, fontFamily: 'var(--mono)' }} placeholder="Original ref, e.g. FS-…" value={dupRef} onChange={(e) => setDupRef(e.target.value)} aria-label="Reference of the original report" list="dup-candidates" />
              <datalist id="dup-candidates">{candidates.map((c) => <option key={c.ref} value={c.ref} />)}</datalist>
              <button className="btn btn-ghost" disabled={busy || !dupRef.trim()} onClick={() => act('duplicate', { duplicate_of: dupRef.trim() })}>Mark duplicate</button>
            </div>
          </>
        ) : (
          <button className="btn btn-ghost" disabled={busy || !note.trim()} onClick={() => act('reopen')}>Re-open for review</button>
        )}
        <button className="btn btn-ghost sm" disabled={busy} onClick={() => act(r.flags.includes('manual_flag') ? 'unflag' : 'flag')}><Icon name="flag" size={14} />{r.flags.includes('manual_flag') ? 'Remove flag' : 'Flag for second opinion'}</button>
        <p className="fine">Signed in as {user.name}. Every action is recorded in the audit trail.</p>
      </div>

      <section className="block">
        <h3 className="block-title">Audit trail</h3>
        <ul className="timeline">
          {d.events.map((e) => <li key={e.id}><time>{dateTime(e.created_at)}</time><b>{e.action}</b> by {e.user_name || e.actor}{e.to_status && e.from_status && e.to_status !== e.from_status ? ` · ${e.from_status} → ${e.to_status}` : ''}{e.note ? ` — “${e.note}”` : ''}</li>)}
        </ul>
      </section>
    </>
  );
}

function Quality({ includeDemo }) {
  const [q, setQ] = useState(null);
  const [a, setA] = useState(null);
  useEffect(() => {
    api(`/admin/quality?include_demo=${includeDemo ? 1 : 0}`).then(setQ).catch(() => {});
    api('/admin/activity').then(setA).catch(() => {});
  }, [includeDemo]);
  if (!q || !a) return <div className="page-loading"><span className="spinner" />Loading…</div>;
  return (
    <div className="page"><div className="page-inner">
      <div className="stat-row">
        <div className="stat"><span className="k">Reports</span><span className="v">{q.total}</span></div>
        <div className="stat"><span className="k">Pending &gt; 48 h</span><span className="v">{q.pending_over_48h}</span><span className="d">target: 0</span></div>
        <div className="stat"><span className="k">With photo</span><span className="v">{q.with_photo_pct}%</span></div>
        <div className="stat"><span className="k">Rejection rate</span><span className="v">{q.rejection_rate_pct ?? '—'}%</span><span className="d">of reviewed</span></div>
        <div className="stat"><span className="k">Duplicate rate</span><span className="v">{q.duplicate_rate_pct ?? '—'}%</span></div>
        <div className="stat"><span className="k">Verified in High/V.high</span><span className="v">{q.verified_in_high_pct ?? '—'}%</span><span className="d">model agreement</span></div>
      </div>
      <div className="grid">
        <section className="card span-4"><h2>Automated flags raised</h2>
          {Object.keys(q.flags).length === 0 ? <p className="muted">None.</p> : <table className="tbl"><tbody>{Object.entries(q.flags).map(([k, v]) => <tr key={k}><td>{FLAG_TEXT[k] || k}</td><td className="num">{v}</td></tr>)}</tbody></table>}
        </section>
        <section className="card span-4"><h2>How reports were located</h2>
          <table className="tbl"><tbody>{Object.entries(q.location_method).map(([k, v]) => <tr key={k}><td>{{ gps: 'Device GPS', map: 'Pin on map', search: 'Place search' }[k]}</td><td className="num">{v}</td></tr>)}</tbody></table>
          <p className="fine">{q.with_contact_pct}% shared contact details · {q.contacts_purged} contact records deleted under the {q.contact_retention_days}-day retention rule.</p>
        </section>
        <section className="card span-4"><h2>Reviewer activity</h2>
          {a.reviewers.length === 0 ? <p className="muted">No reviews by signed-in users yet.</p> : <table className="tbl"><tbody>{a.reviewers.map((r) => <tr key={r.name}><td>{r.name}</td><td className="num">{r.n} decisions</td></tr>)}</tbody></table>}
          <h3 className="block-title" style={{ marginTop: 14 }}>Recent sign-ins</h3>
          <ul className="timeline">{a.logins.slice(0, 6).map((l, i) => <li key={i}><time>{dateTime(l.created_at)}</time>{l.action.replace('_', ' ')}{l.name ? ` · ${l.name}` : ''}</li>)}</ul>
        </section>
        <section className="card span-12"><h2>Activity log</h2>
          <div className="table-scroll"><table className="tbl">
            <thead><tr><th>When</th><th>Report</th><th>Action</th><th>By</th><th>Note</th></tr></thead>
            <tbody>{a.events.map((e) => <tr key={e.id}><td style={{ whiteSpace: 'nowrap' }}>{dateTime(e.created_at)}</td><td style={{ fontFamily: 'var(--mono)' }}>{e.ref}{e.is_demo ? ' · demo' : ''}</td><td>{e.action}{e.to_status && e.from_status && e.to_status !== e.from_status ? ` (${e.from_status} → ${e.to_status})` : ''}</td><td>{e.actor}</td><td className="muted">{e.note}</td></tr>)}</tbody>
          </table></div>
        </section>
      </div>
    </div></div>
  );
}

export default function Admin() {
  const { refreshReports, DEFAULT_LAYERS, notify } = useStore();
  const [user, setUser] = useState(undefined);
  const [tab, setTab] = useState('queue');
  const [status, setStatus] = useState('pending');
  const [includeDemo, setIncludeDemo] = useState(true);
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [listErr, setListErr] = useState(null);
  const [sel, setSel] = useState(null);
  const mapRef = useRef(null);

  useEffect(() => {
    api('/auth/me').then((r) => { if (r.user) setCsrf(r.csrf); setUser(r.user || null); }).catch(() => setUser(null));
  }, []);

  const loadList = useCallback(async () => {
    try {
      const st = status === 'flagged' ? 'all&flagged=1' : status === 'closed' ? 'all' : status;
      const d = await api(`/admin/reports?status=${st}&include_demo=${includeDemo ? 1 : 0}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      let rows = d.reports;
      if (status === 'closed') rows = rows.filter((r) => r.status === 'rejected' || r.status === 'duplicate');
      setList(rows); setListErr(null);
    } catch (e) {
      if (e.status === 401) setUser(null);
      setListErr(e.message);
    }
  }, [status, includeDemo, q]);
  useEffect(() => { if (user) loadList(); }, [user, loadList]);

  const selected = list.find((r) => r.id === sel);
  useEffect(() => {
    if (selected) mapRef.current?.flyTo({ center: [selected.lon, selected.lat], zoom: Math.max(mapRef.current.map?.getZoom() || 0, 11.5) });
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const mapLayers = useMemo(() => ({ ...DEFAULT_LAYERS, drainage: true, places: true, opacity: 0.6 }), [DEFAULT_LAYERS]);
  const mapReports = useMemo(() => list.map((r) => ({ ...r })), [list]);

  if (user === undefined) return <div className="page-loading"><span className="spinner" />Checking session…</div>;
  if (!user) return <Login onDone={setUser} />;

  const logout = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setCsrf(null); setUser(null); };
  const resetDemo = async () => {
    if (!window.confirm('Delete all synthetic demo reports and re-create the original demo set? Genuine reports are not affected.')) return;
    try { const r = await api('/admin/demo/reset', { method: 'POST' }); notify(`Demo data reset (${r.seeded} synthetic reports).`, 'good'); setSel(null); loadList(); refreshReports(); } catch (e) { notify(e.message, 'warn'); }
  };

  return (
    <div className={tab === 'queue' ? 'admin-wrap' : 'page'} style={tab === 'queue' ? undefined : { display: 'flex', flexDirection: 'column' }}>
      <div className="admin-bar">
        <h1>Verification console</h1>
        <div className="admin-tabs" role="tablist">
          {[['queue', 'Queue'], ['quality', 'Data quality & activity']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <label className="check-row"><input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />Include demo</label>
        <div className="who">
          {user.role === 'admin' && <button className="btn btn-ghost sm" onClick={resetDemo}>Reset demo data</button>}
          <span>{user.name} · {user.role}</span>
          <button className="btn btn-ghost sm" onClick={logout}>Sign out</button>
        </div>
      </div>
      {tab === 'quality' ? <div style={{ position: 'relative', flex: 1 }}><Quality includeDemo={includeDemo} /></div> : (
        <>
          <aside className="queue" aria-label="Report queue">
            <div className="queue-filters">
              <div className="seg" role="group" aria-label="Status filter" style={{ flexWrap: 'wrap' }}>
                {[['pending', 'Pending'], ['flagged', 'Flagged'], ['verified', 'Verified'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}
              </div>
              <input className="select" placeholder="Search ref, text or community" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search reports" />
            </div>
            {listErr && <div className="alert">{listErr}</div>}
            <ul className="queue-list">
              {list.length === 0 && <li className="empty-state">Nothing here. {status === 'pending' ? 'The queue is clear.' : ''}</li>}
              {list.map((r) => (
                <li key={r.id}>
                  <button className={sel === r.id ? 'on' : ''} onClick={() => setSel(r.id)}>
                    <span className="q-top"><span className="q-ref">{r.ref}</span><StatusChip status={r.status} />{r.flagged && <span className="flag-dot">⚑</span>}{r.is_demo && <DemoBadge />}</span>
                    <span className="q-meta">{SEVERITY[r.severity].name} · {r.lga_name || '—'} · {ago(r.created_at)} · class {r.geo_class ?? '—'}</span>
                    <span className="q-desc">{r.description}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="fine" style={{ padding: '0 12px' }}>{list.length} report(s) · pending first, flagged first.</p>
          </aside>
          <div className="admin-map">
            <MapView ref={mapRef} layers={mapLayers} reports={mapReports} selectedKey={selected?.ref}
              onReportClick={(ref) => { const r = list.find((x) => x.ref === ref); if (r) setSel(r.id); }} interactiveLgas={false} />
          </div>
          <aside className="admin-detail" aria-label="Report detail">
            {sel ? <Detail id={sel} user={user} onChanged={(action) => { loadList(); refreshReports(); notify(`Decision recorded (${action}). The public map and dashboard now reflect it.`, 'good'); }} />
              : <div className="empty-state"><p><b>Select a report</b></p><p>Pick one from the queue or click a marker. You’ll see the exact location, GIS consistency signals, nearby corroborating reports and the audit trail.</p><p className="fine">{fmt(list.filter((r) => r.status === 'pending').length)} pending in this view.</p></div>}
          </aside>
        </>
      )}
    </div>
  );
}
