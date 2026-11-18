"""
Original score + sound design for the FloodSense video (synthesised; no third-party music or samples).
Called by assemble.py with the timeline; returns a stereo 48 kHz mix (voice + music + SFX).
"""
import numpy as np
from scipy import signal

SR = 48000


def _t(sec):
    return np.arange(int(sec * SR)) / SR


def _lp(x, hz, order=2):
    b, a = signal.butter(order, hz / (SR / 2), 'low')
    return signal.lfilter(b, a, x, axis=0)


def _bp(x, lo, hi):
    b, a = signal.butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band')
    return signal.lfilter(b, a, x, axis=0)


def _reverb(x, seconds=2.8, mix=0.32, seed=3):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    ir = rng.standard_normal((n, 2)) * np.exp(-np.linspace(0, 7, n))[:, None]
    ir = _lp(ir, 5000)
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    wet = np.stack([signal.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], axis=1)
    return (1 - mix) * x + mix * wet * 3.0


def note_hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def pad_chord(midis, dur, att=2.5, rel=3.0, bright=900, seed=0):
    t = _t(dur)
    out = np.zeros((len(t), 2))
    rng = np.random.default_rng(seed)
    for m in midis:
        f = note_hz(m)
        for ch, det in ((0, -0.11), (1, 0.13)):
            for d in (det, -det * 0.6, 0.0):
                ph = rng.random() * 2 * np.pi
                ff = f * 2 ** (d / 12)
                saw = 2 * ((ff * t + ph / (2 * np.pi)) % 1) - 1
                out[:, ch] += saw * 0.18 + np.sin(2 * np.pi * ff * t + ph) * 0.5
    out = _lp(out, bright)
    env = np.minimum(1, t / att) * np.minimum(1, (dur - t) / rel).clip(0, 1)
    return out * env[:, None] / max(len(midis), 1)


def pluck(midi, dur=0.9, amp=0.4):
    t = _t(dur)
    f = note_hz(midi)
    x = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)) * np.exp(-t * 5.5)
    x *= np.minimum(1, t / 0.004)
    return np.stack([x, x], axis=1) * amp


def place(buf, clip, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf) or i + len(clip) <= 0:
        return
    a = max(0, -i)
    j = min(len(buf), i + len(clip))
    buf[max(i, 0):j] += clip[a: a + (j - max(i, 0))] * gain


# ------------------------------------------------------------------ sfx
def sfx_click():
    t = _t(0.06)
    x = np.sin(2 * np.pi * 2600 * t) * np.exp(-t * 140) * 0.5 + np.random.default_rng(1).standard_normal(len(t)) * np.exp(-t * 400) * 0.15
    return np.stack([x, x], axis=1) * 0.55


def sfx_whoosh(dur=0.9, seed=2):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    x = rng.standard_normal((n, 2))
    t = np.linspace(0, 1, n)
    out = np.zeros_like(x)
    # swept band-pass in blocks
    blocks = 24
    for k in range(blocks):
        a, b = k * n // blocks, (k + 1) * n // blocks
        c = 300 + 2600 * np.sin(np.pi * (k + 0.5) / blocks) ** 2
        out[a:b] = _bp(x[a:b], c * 0.6, c * 1.5)
    env = np.sin(np.pi * t) ** 2
    return out * env[:, None] * 0.22


def sfx_reveal():
    t = _t(3.2)
    boom = np.sin(2 * np.pi * (70 * np.exp(-t * 1.2) + 34) * t) * np.exp(-t * 1.6) * 0.8
    shimmer = sum(np.sin(2 * np.pi * f * t + i) for i, f in enumerate((1318.5, 1760, 2637))) * np.exp(-t * 1.1) * 0.05 * np.minimum(1, t / 0.4)
    x = boom + shimmer
    return _reverb(np.stack([x, x * 0.96], axis=1), 2.5, 0.35)


# ------------------------------------------------------------------ score
def score(total, sections):
    """sections: dict of section-start times: intro(s2), product(s3), close(s7)."""
    music = np.zeros((int(total * SR) + SR, 2))
    # A minor colour: Am(add9) - Fmaj7 - C(add9) - G(sus4)  (MIDI)
    chords = [[45, 57, 60, 64, 71], [41, 53, 57, 60, 64], [48, 55, 60, 64, 62 + 12], [43, 55, 60, 62, 67]]
    bar = 7.2
    t = 0.0
    k = 0
    while t < total + bar:
        bright = 700 if t < sections['intro'] else (1100 if t < sections['close'] else 900)
        c = pad_chord(chords[k % 4], bar + 3.0, att=2.2, rel=3.0, bright=bright, seed=k)
        place(music, c, t, 0.9)
        # sub
        root = chords[k % 4][0] - 12
        tt = _t(bar + 2)
        sub = np.sin(2 * np.pi * note_hz(root) * tt) * np.minimum(1, tt / 1.5) * np.minimum(1, (bar + 2 - tt) / 1.5).clip(0, 1) * 0.22
        place(music, np.stack([sub, sub], 1), t)
        t += bar
        k += 1
    # gentle arpeggio pulse through the product sections (84 bpm eighths)
    step = 60 / 84 / 2
    arp_start, arp_end = sections['product'], sections['close'] - 1.0
    i = 0
    tt = arp_start
    while tt < arp_end:
        k = int(tt // bar) % 4
        ch = chords[k]
        notes = [ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 12]
        fade = min(1, (tt - arp_start) / 6) * min(1, (arp_end - tt) / 3)
        place(music, pluck(notes[i % 4], 0.8, 0.16 * fade * (1.0 if i % 2 == 0 else 0.7)), tt)
        tt += step
        i += 1
    # rain bed in the opening (matches the rain in the first shot)
    rng = np.random.default_rng(7)
    rb = _lp(rng.standard_normal((int(sections['intro'] * SR) + SR, 2)), 3500) - _lp(rng.standard_normal((int(sections['intro'] * SR) + SR, 2)), 300)
    e = np.minimum(1, _t(len(rb) / SR) / 2.0) * np.clip((sections['intro'] + 0.6 - _t(len(rb) / SR)) / 2.0, 0, 1)
    place(music, rb * e[:, None] * 0.05, 0)
    music = _reverb(music, 3.2, 0.3)
    # end: fade out over the final 3 s
    n = int(total * SR)
    music = music[:n]
    fe = np.clip((total - _t(total)) / 3.0, 0, 1)
    music *= fe[:, None]
    return music / (np.abs(music).max() + 1e-9)


def duck_envelope(total, vo_spans, floor=0.42, ramp=0.25):
    t = _t(total)
    g = np.ones(len(t))
    for a, b in vo_spans:
        inside = np.clip(np.minimum((t - (a - ramp)) / ramp, ((b + ramp) - t) / ramp), 0, 1)
        g = np.minimum(g, 1 - (1 - floor) * inside)
    return g
