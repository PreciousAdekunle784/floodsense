/*
 * Frame-stepped screen recorder for the FloodSense demo video.
 * Every frame is rendered only after the map has finished drawing, so camera moves are perfectly smooth
 * regardless of how fast the machine renders WebGL. A synthetic cursor, click ripples and caption overlays
 * are injected into the page; clicks and typing are real interactions with the real application.
 */
import fs from 'node:fs';
import path from 'node:path';

export const FPS = 30;
export const W = 1920;
export const H = 1080;
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const BUILD = path.join(ROOT, 'build');
export const timeline = JSON.parse(fs.readFileSync(path.join(ROOT, 'timeline.json'), 'utf8'));
export const vo = JSON.parse(fs.readFileSync(path.join(BUILD, 'vo', 'durations.json'), 'utf8')).durations;
export const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'script.json'), 'utf8'));

export function shotSpec(id) {
  const s = timeline.shots.find((x) => x.id === id);
  const voDur = s.vo.reduce((a, v) => a + vo[v], 0);
  return { ...s, duration: s.lead + voDur + s.tail, frames: Math.round((s.lead + voDur + s.tail) * FPS) };
}

/** Approximate time (s, from shot start) at which `phrase` is spoken, by character proportion. */
export function cue(shot, voId, phrase, offset = 0) {
  const text = script.lines.find((l) => l.id === voId).text;
  const i = text.indexOf(phrase);
  if (i < 0) throw new Error(`phrase not found: ${phrase}`);
  return shot.spec.lead + (i / text.length) * vo[voId] + offset;
}

export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const clamp01 = (t) => Math.max(0, Math.min(1, t));

// ------------------------------------------------------------------ overlay injected into pages
export const OVERLAY_SCRIPT = () => {
  if (window.top !== window) return;
  const install = () => {
    if (document.getElementById('cap-root')) return;
    const st = document.createElement('style');
    st.textContent = `
      *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
      .cursor-readout, .toast { display: none !important; }
      #cap-root { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; font-family: 'IBM Plex Sans', system-ui, sans-serif; }
      #cap-cursor { position: absolute; width: 30px; height: 30px; transform: translate(-3px, -2px); filter: drop-shadow(0 3px 6px rgba(0,0,0,.55)); display: none; }
      #cap-touch { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; background: rgba(255,255,255,.28); border: 2px solid rgba(255,255,255,.85); box-shadow: 0 4px 14px rgba(0,0,0,.45); display: none; }
      #cap-ripple { position: absolute; border-radius: 50%; border: 3px solid #f08a5d; display: none; }
      .cap-el { position: absolute; }
      .cap-lt { background: rgba(9,14,17,.92); border: 1px solid rgba(255,255,255,.08); border-left: 4px solid #e2683c; border-radius: 10px; padding: 18px 26px 18px 22px; box-shadow: 0 18px 40px rgba(0,0,0,.45); color: #e9eef0; max-width: 820px; }
      .cap-lt .e { font: 500 14px/1 'IBM Plex Mono', monospace; letter-spacing: .14em; text-transform: uppercase; color: #f08a5d; margin-bottom: 10px; }
      .cap-lt .t { font: 600 40px/1.08 'Barlow Condensed', sans-serif; letter-spacing: .01em; }
      .cap-lt .s { font: 400 19px/1.4 'IBM Plex Sans', sans-serif; color: #a9b6bc; margin-top: 8px; }
      .cap-chips { display: flex; gap: 10px; }
      .cap-chip { background: rgba(9,14,17,.92); border: 1px solid rgba(255,255,255,.12); border-radius: 10px; padding: 12px 16px 12px 14px; color: #e9eef0; min-width: 150px; box-shadow: 0 12px 30px rgba(0,0,0,.4); }
      .cap-chip b { display: block; font: 600 25px/1.05 'Barlow Condensed', sans-serif; }
      .cap-chip span { display: block; font: 500 15px 'IBM Plex Mono', monospace; color: #f08a5d; margin-top: 6px; }
      .cap-chip i { display: block; height: 4px; border-radius: 2px; background: #e2683c; margin-top: 8px; }
      .cap-stat { background: rgba(9,14,17,.94); border: 1px solid rgba(255,255,255,.1); border-radius: 12px; padding: 22px 28px; color: #e9eef0; box-shadow: 0 18px 40px rgba(0,0,0,.5); display: flex; gap: 34px; align-items: center; }
      .cap-stat .big { font: 500 64px/1 'IBM Plex Mono', monospace; letter-spacing: -.04em; }
      .cap-stat .lbl { font: 400 18px/1.35 'IBM Plex Sans', sans-serif; color: #a9b6bc; max-width: 240px; margin-top: 6px; }
      .cap-stat .arrow { font: 300 54px/1 'IBM Plex Sans'; color: #74838a; }
      .cap-note { font: 500 17px 'IBM Plex Mono', monospace; color: #a9b6bc; letter-spacing: .04em; }
      .cap-tag { font: 600 22px/1 'IBM Plex Mono', monospace; letter-spacing: .16em; text-transform: uppercase; color: #e9eef0; text-shadow: 0 2px 10px rgba(0,0,0,.9); }
      .cap-big { font: 600 64px/1.05 'Barlow Condensed', sans-serif; color: #fff; text-shadow: 0 4px 30px rgba(0,0,0,.85); letter-spacing: .01em; }
      #cap-vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.55) 100%); display: none; }
      #cap-rain { position: absolute; inset: 0; display: none; }
    `;
    document.head.appendChild(st);
    const root = document.createElement('div');
    root.id = 'cap-root';
    root.innerHTML = `<canvas id="cap-rain" width="1920" height="1080"></canvas><div id="cap-vignette"></div><div id="cap-ripple"></div><div id="cap-touch"></div>
      <svg id="cap-cursor" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#0b1114" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(root);
    window.__cap = {
      cursor(x, y, vis, touch) {
        const c = document.getElementById(touch ? 'cap-touch' : 'cap-cursor');
        document.getElementById(touch ? 'cap-cursor' : 'cap-touch').style.display = 'none';
        c.style.display = vis ? 'block' : 'none'; c.style.left = `${x}px`; c.style.top = `${y}px`;
      },
      ripple(x, y, p) {
        const r = document.getElementById('cap-ripple');
        if (p == null || p >= 1) { r.style.display = 'none'; return; }
        const size = 18 + 46 * p;
        Object.assign(r.style, { display: 'block', left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px`, opacity: String(1 - p) });
      },
      el(id, html, css, opacity = 1) {
        let e = document.getElementById(`cap-${id}`);
        if (!e) { e = document.createElement('div'); e.id = `cap-${id}`; e.className = 'cap-el'; root.appendChild(e); }
        if (html != null) e.innerHTML = html;
        if (css) Object.assign(e.style, css);
        e.style.opacity = String(opacity);
        e.style.display = opacity <= 0 ? 'none' : 'block';
      },
      remove(id) { document.getElementById(`cap-${id}`)?.remove(); },
      clear() { root.querySelectorAll('.cap-el').forEach((e) => e.remove()); },
      vignette(on) { document.getElementById('cap-vignette').style.display = on ? 'block' : 'none'; },
      rain(t, alpha) {
        const cv = document.getElementById('cap-rain');
        if (!alpha) { cv.style.display = 'none'; return; }
        cv.style.display = 'block';
        const g = cv.getContext('2d');
        g.clearRect(0, 0, 1920, 1080);
        let s = 1234567;
        const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 260; i++) {
          const x0 = rnd() * 2200 - 140; const sp = 1400 + rnd() * 900; const len = 30 + rnd() * 50; const ph = rnd();
          const y = ((ph * 1300 + t * sp) % 1300) - 110; const x = x0 - (y + 110) * 0.18;
          g.strokeStyle = `rgba(200,225,240,${(0.10 + rnd() * 0.22) * alpha})`; g.lineWidth = 1 + rnd() * 1.2;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - len * 0.18, y + len); g.stroke();
        }
      },
    };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
};

// ------------------------------------------------------------------ shot recorder
export class Shot {
  constructor(page, id) {
    this.page = page;
    this.id = id;
    this.spec = shotSpec(id);
    this.dir = path.join(BUILD, 'frames', id);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.n = 0;
    this.cues = [];
    this.cur = { x: W / 2, y: H / 2, vis: false, touch: false };
    this.frame = page; // frame whose maps we wait on (main or iframe)
  }
  get t() { return this.n / FPS; }
  get total() { return this.spec.frames; }
  cueSfx(type) { this.cues.push({ frame: this.n, type }); }
  file(i) { return path.join(this.dir, `${String(i).padStart(5, '0')}.jpg`); }

  async idle() {
    await this.frame.evaluate(() => Promise.all((window.__fsMaps || []).map((m) => new Promise((res) => {
      const done = () => requestAnimationFrame(() => requestAnimationFrame(res));
      const to = setTimeout(res, 6000);
      if (m.loaded() && m.areTilesLoaded() && !m.isMoving()) { clearTimeout(to); done(); } else m.once('idle', () => { clearTimeout(to); done(); });
    })))).catch(() => {});
  }

  async snap(hold = 1) {
    if (this.n >= this.total) return;
    await this.idle();
    const buf = await this.page.screenshot({ type: 'jpeg', quality: 93 });
    fs.writeFileSync(this.file(this.n), buf);
    const src = this.file(this.n);
    this.n++;
    for (let k = 1; k < hold && this.n < this.total; k++) { fs.linkSync(src, this.file(this.n)); this.n++; }
  }

  /** Hold the current image until shot time `t` (seconds). */
  async holdUntil(t) {
    const target = Math.min(Math.round(t * FPS), this.total);
    if (target > this.n) await this.snap(target - this.n);
  }

  /** Run fn(i, p) for `frames` frames (p: 0..1) and capture each. */
  async animate(frames, fn) {
    for (let i = 0; i < frames && this.n < this.total; i++) {
      await fn(i, frames > 1 ? i / (frames - 1) : 1);
      await this.snap();
    }
  }

  async setCursor(x, y, vis = true, touch = this.cur.touch) {
    this.cur = { x, y, vis, touch };
    await this.page.evaluate(([a, b, v, tc]) => window.__cap.cursor(a, b, v, tc), [x, y, vis, touch]);
  }
  async moveTo(x, y, frames = 16) {
    const { x: x0, y: y0 } = this.cur;
    if (!this.cur.vis) await this.setCursor(x0, y0, true);
    await this.animate(frames, async (i, p) => {
      const e = ease(p);
      // gentle arc
      const arc = Math.sin(Math.PI * e) * Math.min(60, Math.hypot(x - x0, y - y0) * 0.08);
      await this.setCursor(x0 + (x - x0) * e, y0 + (y - y0) * e - arc, true);
    });
  }
  async click(x, y, { frames = 14, after = 6, real = true } = {}) {
    await this.moveTo(x, y, frames);
    this.cueSfx('click');
    if (real) await this.page.mouse.click(x, y);
    await this.animate(after, async (i, p) => this.page.evaluate(([a, b, q]) => window.__cap.ripple(a, b, q), [x, y, p]));
    await this.page.evaluate(() => window.__cap.ripple(0, 0, null));
  }
  async center(locator) {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const b = await locator.boundingBox();
    if (!b) throw new Error(`no bounding box for ${locator}`);
    return [b.x + b.width / 2, b.y + b.height / 2];
  }
  async clickEl(locator, opts) {
    const [x, y] = await this.center(locator);
    await this.click(x, y, opts);
  }
  async type(text, perFrame = 3) {
    for (let i = 0; i < text.length; i += perFrame) {
      await this.page.keyboard.type(text.slice(i, i + perFrame));
      await this.snap();
    }
  }
  async overlay(id, html, css, opacity = 1) {
    await this.page.evaluate(([a, b, c, o]) => window.__cap.el(a, b, c, o), [id, html, css, opacity]);
  }

  /** Smooth camera move along the van Wijk & Nuij "optimal path" (as MapLibre flyTo), one frame at a time. */
  async fly(to, frames, { curve = 1.42, easing = ease } = {}) {
    const from = await this.frame.evaluate(() => {
      const m = window.__fsMaps.at(-1);
      const c = m.getCenter();
      return { center: [c.lng, c.lat], zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing(), width: m.getContainer().clientWidth };
    });
    const merc = ([lon, lat]) => [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2];
    const unmerc = ([x, y]) => [x * 360 - 180, (360 / Math.PI) * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - 90];
    const c0 = merc(from.center);
    const c1 = merc(to.center || from.center);
    const z1 = to.zoom ?? from.zoom;
    const w0 = from.width / (512 * 2 ** from.zoom);
    const w1 = from.width / (512 * 2 ** z1);
    const u1 = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
    const rho = curve;
    let S; let path;
    if (u1 < 1e-12) {
      S = Math.abs(Math.log(w1 / w0)) / rho || 1;
      path = (s) => ({ u: 0, w: w0 * Math.exp((w1 >= w0 ? 1 : -1) * rho * s) });
    } else {
      const b = (i) => (w1 * w1 - w0 * w0 + (i ? -1 : 1) * rho ** 4 * u1 * u1) / (2 * (i ? w1 : w0) * rho * rho * u1);
      const r = (i) => Math.log(Math.sqrt(b(i) ** 2 + 1) - b(i));
      const r0 = r(0); const r1 = r(1);
      S = (r1 - r0) / rho;
      path = (s) => ({ u: (w0 / rho ** 2) * (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0)), w: (w0 * Math.cosh(r0)) / Math.cosh(rho * s + r0) });
    }
    const p0 = from.pitch; const p1 = to.pitch ?? from.pitch;
    let b0 = from.bearing; const b1 = to.bearing ?? from.bearing;
    await this.animate(frames, async (i, p) => {
      const e = easing(p);
      const { u, w } = path(S * e);
      const k = u1 < 1e-12 ? 0 : u / u1;
      const cm = [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k];
      const cam = { center: unmerc(cm), zoom: Math.log2(from.width / (512 * w)), pitch: p0 + (p1 - p0) * e, bearing: b0 + (b1 - b0) * e };
      await this.frame.evaluate((c) => { const m = window.__fsMaps.at(-1); m.stop(); m.jumpTo(c); }, cam);
    });
  }

  async jump(cam) {
    await this.frame.evaluate((c) => { const m = window.__fsMaps.at(-1); m.stop(); m.jumpTo(c); }, cam);
  }

  async finish() {
    await this.holdUntil(this.total / FPS);
    fs.writeFileSync(path.join(this.dir, 'meta.json'), JSON.stringify({ id: this.id, frames: this.n, cues: this.cues }, null, 1));
    console.log(`  ${this.id}: ${this.n} frames (${(this.n / FPS).toFixed(1)} s), ${this.cues.length} sfx cues`);
  }
}
