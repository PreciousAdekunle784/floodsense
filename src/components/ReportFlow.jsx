import { useEffect, useRef, useState } from 'react';
import { Icon, Link } from '../App.jsx';
import { api } from '../lib/api.js';
import { CLASS_NAMES, SEVERITY, coord } from '../lib/format.js';
import { cellIndex } from '../lib/grid.js';
import { useStore } from '../lib/store.jsx';
import { ClassChip } from './Inspector.jsx';
import SearchBox from './SearchBox.jsx';

const STEPS = ['Location', 'What you see', 'Photo & contact', 'Review'];

function localInputValue(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Re-encode the photo in the browser: downsizes to ≤1600 px and drops EXIF metadata (GPS, device). */
async function compressImage(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('This file could not be read as an image.');
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
  return { blob, url: URL.createObjectURL(blob), w: canvas.width, h: canvas.height };
}

export default function ReportFlow({ pin, setPin, flyTo, onCancel }) {
  const { geo, refreshReports, notify, route } = useStore();
  const [step, setStep] = useState(0);
  const [token, setToken] = useState(null);
  const [f, setF] = useState(() => ({ method: 'map', community: '', severity: 0, description: '', observed: localInputValue(new Date()), name: '', phone: '', email: '', consent: false, website: '' }));
  const [photo, setPhoto] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [done, setDone] = useState(null);
  const fileRef = useRef(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  useEffect(() => {
    api('/reports/form-token').then((d) => setToken(d.token)).catch(() => setServerError('Could not contact the FloodSense server. Your report cannot be sent until the connection is back.'));
  }, []);

  // location context (client-side, from the same GIS grid)
  let ctx = null;
  if (pin && geo) {
    const i = cellIndex(geo.grid, pin.lon, pin.lat);
    const lgaId = i >= 0 ? geo.grid.L.lga[i] : 0;
    ctx = { inside: !!lgaId, lga: lgaId ? geo.lgas.features.find((x) => x.properties.lga_id === lgaId).properties.name : null, cls: i >= 0 ? geo.grid.L.cls[i] : 0 };
  }

  const useGps = () => {
    if (!navigator.geolocation) return setErrors({ location: 'Location is not available on this device. Tap the map instead.' });
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        const loc = { lat: p.coords.latitude, lon: p.coords.longitude };
        setPin(loc); setF((x) => ({ ...x, method: 'gps' })); flyTo(loc, 14); setErrors({});
      },
      (err) => {
        setLocating(false);
        setErrors({ location: err.code === 1 ? 'Location permission was denied. Tap the map to place the pin instead.' : 'Could not get your location (GPS needs HTTPS or localhost). Tap the map instead.' });
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  const validate = (s) => {
    const e = {};
    if (s === 0) {
      if (!pin) e.location = 'Tap the map, use your location, or search for a place.';
      else if (ctx && !ctx.inside) e.location = 'This point is outside Ogun State — the pilot covers Ogun State only.';
    }
    if (s === 1) {
      if (!f.severity) e.severity = 'Choose the option closest to what you can see.';
      if (f.description.trim().length < 15) e.description = 'Please describe what you can see (at least 15 characters).';
      const t = new Date(f.observed);
      if (Number.isNaN(t.getTime())) e.observed = 'Enter when you saw the flooding.';
      else if (t.getTime() > Date.now() + 10 * 60e3) e.observed = 'The time cannot be in the future.';
      else if (Date.now() - t.getTime() > 14 * 86400e3) e.observed = 'FloodSense accepts reports about the last 14 days.';
    }
    if (s === 2) {
      const any = f.name || f.phone || f.email;
      if (any && !f.consent) e.consent = 'Tick the consent box, or clear your contact details.';
      if (f.phone && !/^[+0-9 ()-]{7,30}$/.test(f.phone)) e.phone = 'Enter a valid phone number.';
      if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Enter a valid email address.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => { if (validate(step)) setStep((s) => Math.min(s + 1, 3)); };

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('That file is very large — please choose a smaller photo.');
      const p = await compressImage(file);
      setPhoto(p);
      setErrors((x) => ({ ...x, photo: undefined }));
    } catch (err) {
      setErrors((x) => ({ ...x, photo: err.message }));
    }
  };

  const submit = async () => {
    for (const s of [0, 1, 2]) if (!validate(s)) { setStep(s); return; }
    setBusy(true); setServerError(null);
    const fd = new FormData();
    fd.append('lat', String(pin.lat)); fd.append('lon', String(pin.lon));
    fd.append('location_method', f.method); fd.append('community', f.community);
    fd.append('severity', String(f.severity)); fd.append('description', f.description);
    fd.append('observed_at', new Date(f.observed).toISOString());
    fd.append('contact_name', f.name); fd.append('contact_phone', f.phone); fd.append('contact_email', f.email);
    fd.append('contact_consent', f.consent ? '1' : '0');
    fd.append('website', f.website); fd.append('form_token', token || '');
    if (photo) fd.append('photo', photo.blob, 'photo.jpg');
    try {
      const r = await api('/reports', { method: 'POST', form: fd });
      setDone(r);
      refreshReports();
      notify(`Report ${r.ref} received — it now appears on the map as pending verification.`, 'good');
    } catch (err) {
      setServerError(err.message);
      if (err.fields) {
        setErrors(err.fields);
        if (err.fields.location) setStep(0);
        else if (err.fields.severity || err.fields.description || err.fields.observed_at) setStep(1);
        else if (err.fields.photo || err.fields.contact_consent) setStep(2);
      }
      if (err.status === 400 && /expired/i.test(err.message)) api('/reports/form-token').then((d) => setToken(d.token)).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="report-flow">
        <div className="done">
          <div className="done-mark"><Icon name="check" size={28} /></div>
          <h2>Report received</h2>
          <p>Thank you. Your reference is</p>
          <p className="ref-code">{done.ref}</p>
          <button className="btn btn-ghost sm" onClick={() => navigator.clipboard?.writeText(done.ref).then(() => notify('Reference copied'))}>Copy reference</button>
          <ol className="next-steps">
            <li className="on"><b>Submitted</b> — it is on the map now as <em>pending verification</em> (location shown to ~110 m, details hidden).</li>
            <li><b>Verification</b> — a trained verifier checks it against nearby reports, terrain and photos.</li>
            <li><b>Verified or not</b> — verified reports become visible in full and count in the dashboard.</li>
          </ol>
          <div className="row-gap">
            <Link to={`/track?ref=${done.ref}`} className="btn btn-accent">Track status</Link>
            <button className="btn btn-ghost" onClick={onCancel}>Back to map</button>
          </div>
          <p className="fine">If people are in danger, call 112 — FloodSense reports are not monitored in real time.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="report-flow">
      <div className="safety">If anyone is in danger, call <b>112</b> first. FloodSense reports are reviewed, not monitored live.</div>
      <ol className="stepper" aria-label="Report steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <button onClick={() => (i < step ? setStep(i) : i === step + 1 ? next() : null)} disabled={i > step + 1} aria-current={i === step ? 'step' : undefined}>
              <span className="n">{i + 1}</span><span className="t">{s}</span>
            </button>
          </li>
        ))}
      </ol>

      {serverError && <div className="alert" role="alert">{serverError}</div>}

      {step === 0 && (
        <div className="fstep">
          <h3>Where is the flooding?</h3>
          <p className="hint">Tap the map to drop a pin, then drag it to adjust. You can also use your phone’s location or search for a town.</p>
          <div className="row-gap">
            <button className="btn btn-ghost" onClick={useGps} disabled={locating}><Icon name="locate" size={16} />{locating ? 'Locating…' : 'Use my location'}</button>
          </div>
          <SearchBox compact placeholder="Search town or LGA" onPick={(r) => {
            const loc = r.feature ? { lat: r.feature.properties.label[1], lon: r.feature.properties.label[0] } : { lat: r.lat, lon: r.lon };
            setPin(loc); setF((x) => ({ ...x, method: 'search' })); flyTo(loc, r.feature ? 11 : 13);
          }} />
          <div className={`loc-card ${pin ? '' : 'empty'}`} aria-live="polite">
            {pin ? (
              <>
                <span className="coord">{coord(pin.lat, pin.lon)}</span>
                {ctx?.inside ? <><b>{ctx.lga} LGA</b><ClassChip cls={ctx.cls} /></> : <b className="warn">Outside Ogun State</b>}
              </>
            ) : <span>No location yet — tap the map.</span>}
          </div>
          {errors.location && <p className="field-error">{errors.location}</p>}
          <label className="field">
            <span>Community, street or landmark <em>optional</em></span>
            <input value={f.community} onChange={set('community')} maxLength={120} placeholder="e.g. near the market bridge" />
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="fstep">
          <h3>What can you see?</h3>
          <fieldset className="severity" aria-describedby={errors.severity ? 'sev-err' : undefined}>
            <legend>How severe is it?</legend>
            {[1, 2, 3, 4].map((s) => (
              <label key={s} className={`sev sev-${s} ${f.severity === s ? 'on' : ''}`}>
                <input type="radio" name="severity" checked={f.severity === s} onChange={() => setF((x) => ({ ...x, severity: s }))} />
                <span className="sev-bars" aria-hidden="true">{[1, 2, 3, 4].map((b) => <i key={b} className={b <= s ? 'f' : ''} />)}</span>
                <span><b>{SEVERITY[s].name}</b><small>{SEVERITY[s].hint}</small></span>
              </label>
            ))}
          </fieldset>
          {errors.severity && <p className="field-error" id="sev-err">{errors.severity}</p>}
          {f.severity === 4 && <div className="alert">Life-threatening flooding: call <b>112</b> or local emergency services now. Then finish this report if it is safe.</div>}
          <label className="field">
            <span>Describe what is happening</span>
            <textarea value={f.description} onChange={set('description')} maxLength={1000} rows={4} placeholder="Water depth, what is flooded, whether roads are passable, when it started…" aria-invalid={!!errors.description} />
            <small className="count">{f.description.length}/1000</small>
          </label>
          {errors.description && <p className="field-error">{errors.description}</p>}
          <label className="field">
            <span>When did you see it?</span>
            <input type="datetime-local" value={f.observed} onChange={set('observed')} max={localInputValue(new Date(Date.now() + 60e3))} aria-invalid={!!errors.observed} />
          </label>
          {errors.observed && <p className="field-error">{errors.observed}</p>}
        </div>
      )}

      {step === 2 && (
        <div className="fstep">
          <h3>Photo and contact <span className="opt">both optional</span></h3>
          <div className="photo-pick">
            {photo ? (
              <div className="photo-preview">
                <img src={photo.url} alt="Selected flood photo preview" />
                <button className="btn btn-ghost sm" onClick={() => { setPhoto(null); if (fileRef.current) fileRef.current.value = ''; }}>Remove photo</button>
              </div>
            ) : (
              <button className="photo-drop" onClick={() => fileRef.current?.click()}><Icon name="camera" size={22} />Add a photo<small>Helps verification. Location data inside the photo is removed before upload.</small></button>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} hidden />
            {errors.photo && <p className="field-error">{errors.photo}</p>}
          </div>
          <p className="hint">Contact details let a verifier ask a follow-up question. They are visible only to verifiers, never published, and deleted 30 days after review.</p>
          <div className="grid2">
            <label className="field"><span>Name</span><input value={f.name} onChange={set('name')} maxLength={80} autoComplete="name" /></label>
            <label className="field"><span>Phone</span><input value={f.phone} onChange={set('phone')} inputMode="tel" maxLength={30} autoComplete="tel" aria-invalid={!!errors.phone} /></label>
          </div>
          {errors.phone && <p className="field-error">{errors.phone}</p>}
          <label className="field"><span>Email</span><input type="email" value={f.email} onChange={set('email')} maxLength={120} autoComplete="email" aria-invalid={!!errors.email} /></label>
          {errors.email && <p className="field-error">{errors.email}</p>}
          <label className="check-row">
            <input type="checkbox" checked={f.consent} onChange={set('consent')} />
            I agree that FloodSense verifiers may contact me about this report.
          </label>
          {errors.consent && <p className="field-error">{errors.consent}</p>}
          <label className="hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
        </div>
      )}

      {step === 3 && (
        <div className="fstep">
          <h3>Check and send</h3>
          <dl className="dl review">
            <dt>Location</dt><dd>{pin && coord(pin.lat, pin.lon)}<br />{ctx?.lga} LGA{f.community ? ` · ${f.community}` : ''}</dd>
            <dt>Modelled susceptibility</dt><dd>{ctx?.cls ? CLASS_NAMES[ctx.cls] : '—'} <small className="muted">(for context only)</small></dd>
            <dt>Severity</dt><dd>{SEVERITY[f.severity]?.name}</dd>
            <dt>Observed</dt><dd>{new Date(f.observed).toLocaleString('en-GB')}</dd>
            <dt>Description</dt><dd>{f.description}</dd>
            <dt>Photo</dt><dd>{photo ? `Attached (${photo.w}×${photo.h}, metadata removed)` : 'None'}</dd>
            <dt>Contact</dt><dd>{f.consent && (f.name || f.phone || f.email) ? 'Shared with verifiers only' : 'Anonymous'}</dd>
          </dl>
          <p className="fine">Your report will appear on the public map as <b>pending verification</b> straight away, with its location shown to about 110 m and its text hidden until reviewed.</p>
        </div>
      )}

      <div className="flow-actions">
        <button className="btn btn-ghost" onClick={step === 0 ? onCancel : () => setStep(step - 1)}>{step === 0 ? 'Cancel' : 'Back'}</button>
        {step < 3 ? (
          <button className="btn btn-accent" onClick={next}>Continue<Icon name="arrow" size={16} /></button>
        ) : (
          <button className="btn btn-accent" onClick={submit} disabled={busy || !token}>{busy ? 'Sending…' : 'Send report'}</button>
        )}
      </div>
      {route.path === '/report' && step === 0 && !pin && <p className="map-hint-mobile">Tap the map above to place the pin.</p>}
    </div>
  );
}
