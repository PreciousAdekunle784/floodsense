import { useEffect, useState } from 'react';
import { DemoBadge, StatusChip } from '../components/Inspector.jsx';
import { api } from '../lib/api.js';
import { SEVERITY, dateTime } from '../lib/format.js';
import { useStore } from '../lib/store.jsx';

const ACTION = { submitted: 'Report submitted', verify: 'Verified by a reviewer', reject: 'Reviewed — not accepted', duplicate: 'Merged with an existing report of the same flood', reopen: 'Re-opened for review', flag: 'Marked for closer review', unflag: 'Review flag removed' };

export default function Track() {
  const { route } = useStore();
  const [ref, setRef] = useState(route.query.get('ref') || '');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const lookup = async (r) => {
    if (!r) return;
    setBusy(true); setErr(null);
    try { setData(await api(`/reports/${encodeURIComponent(r.trim().toUpperCase())}`)); } catch (e) { setData(null); setErr(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { if (route.query.get('ref')) lookup(route.query.get('ref')); /* eslint-disable-next-line */ }, []);

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 640 }}>
        <header className="page-head"><div><p className="eyebrow">Community reporting</p><h1>Track a report</h1><p>Enter the reference you received after submitting (e.g. FS-7KQ2M9).</p></div></header>
        <form className="row-gap" onSubmit={(e) => { e.preventDefault(); route.navigate(`/track?ref=${encodeURIComponent(ref.trim().toUpperCase())}`, { replace: true }); lookup(ref); }}>
          <label className="field" style={{ flex: 1, margin: 0 }}><span className="sr">Reference</span><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="FS-XXXXXX" maxLength={12} style={{ fontFamily: 'var(--mono)', textTransform: 'uppercase' }} /></label>
          <button className="btn btn-accent" disabled={busy || !ref.trim()}>{busy ? 'Checking…' : 'Check status'}</button>
        </form>
        {err && <div className="alert" role="alert">{err}</div>}
        {data && (
          <section className="card" style={{ marginTop: 16 }}>
            <div className="row-gap"><StatusChip status={data.status} />{data.is_demo && <DemoBadge />}</div>
            <dl className="dl">
              <dt>Reference</dt><dd style={{ fontFamily: 'var(--mono)' }}>{data.ref}</dd>
              <dt>LGA</dt><dd>{data.lga || '—'}</dd>
              <dt>Severity</dt><dd>{SEVERITY[data.severity].name}</dd>
              <dt>Observed</dt><dd>{dateTime(data.observed_at)}</dd>
            </dl>
            <h2 className="block-title">Timeline</h2>
            <ul className="timeline">
              {data.timeline.map((e, i) => <li key={i}><time>{dateTime(e.created_at)}</time>{ACTION[e.action] || e.action}</li>)}
            </ul>
            {data.status === 'pending' && <p className="fine">Verifiers check reports against nearby reports, terrain and photos. Reports are not monitored in real time — if anyone is in danger call 112.</p>}
            {(data.status === 'rejected' || data.status === 'duplicate') && <p className="fine">Reports may be merged when several people describe the same flood, or not accepted if they could not be confirmed. Thank you for reporting.</p>}
          </section>
        )}
      </div>
    </div>
  );
}
