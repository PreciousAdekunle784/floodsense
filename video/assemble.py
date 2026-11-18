"""
Edit + mix + encode.
  python assemble.py full    -> out/FloodSense_demo_1080p.mp4
  python assemble.py short   -> out/FloodSense_demo_short_1080p.mp4
Shots (frame sequences from capture/ and graphics/) are joined with crossfades; narration is placed at each
shot's lead time; the score is generated to the final length and ducked under the voice; SFX follow cues.
"""
import json
import os
import shutil
import subprocess
import sys

import numpy as np
import soundfile as sf
from PIL import Image

import audio

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, 'build')
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)
tl = json.load(open(os.path.join(HERE, 'timeline.json')))
FPS = tl['fps']
XF = int(round(tl['xfade'] * FPS))
vo = json.load(open(os.path.join(BUILD, 'vo', 'durations.json')))['durations']

cut = sys.argv[1] if len(sys.argv) > 1 else 'full'
ids = [s['id'] for s in tl['shots']] if cut == 'full' else tl['short'] if cut == 'short' else sys.argv[2:]
shots = [next(s for s in tl['shots'] if s['id'] == i) for i in ids]
for s in shots:
    s['meta'] = json.load(open(os.path.join(BUILD, 'frames', s['id'], 'meta.json')))
    s['frames'] = s['meta']['frames']

# ------------------------------------------------------------------ video frames
starts = []
pos = 0
for k, s in enumerate(shots):
    starts.append(pos)
    pos += s['frames'] - (XF if k < len(shots) - 1 else 0)
total_frames = pos
total = total_frames / FPS
fdir = os.path.join(BUILD, f'out_{cut}')
shutil.rmtree(fdir, ignore_errors=True)
os.makedirs(fdir)
src = lambda s, i: os.path.join(BUILD, 'frames', s['id'], f'{i:05d}.jpg')
for k, s in enumerate(shots):
    for i in range(s['frames']):
        g = starts[k] + i
        dst = os.path.join(fdir, f'{g:05d}.jpg')
        nxt = shots[k + 1] if k + 1 < len(shots) else None
        if nxt is not None and i >= s['frames'] - XF:
            j = i - (s['frames'] - XF)
            a = Image.open(src(s, i))
            b = Image.open(src(nxt, j))
            p = (j + 1) / (XF + 1)
            p = p * p * (3 - 2 * p)
            Image.blend(a, b, p).save(dst, quality=93)
        elif k > 0 and i < XF:
            continue  # written by the previous shot's crossfade
        else:
            os.link(src(s, i), dst)
print(f'{cut}: {total_frames} frames = {total:.1f} s')

# ------------------------------------------------------------------ audio
n = int(total * audio.SR)
voice = np.zeros((n, 2))
spans = []
for k, s in enumerate(shots):
    t = starts[k] / FPS + s['lead']
    for v in s['vo']:
        x, sr = sf.read(os.path.join(BUILD, 'vo', f'{v}.wav'))
        if sr != audio.SR:
            from scipy.signal import resample_poly
            x = resample_poly(x, audio.SR, sr)
        x = np.stack([x, x], axis=1)
        audio.place(voice, x, t)
        spans.append((t, t + vo[v]))
        t += vo[v] + 0.35
section = lambda pref: next((starts[k] / FPS for k, s in enumerate(shots) if s['id'].startswith(pref)), 0.0)
sections = {'intro': section('s2'), 'product': section('s3') or section('s4'), 'close': section('s7')}
music = audio.score(total, sections)
music *= audio.duck_envelope(total, spans, floor=0.36)[:, None]
sfx = np.zeros((n, 2))
for k, s in enumerate(shots):
    for c in s['meta'].get('cues', []):
        at = (starts[k] + c['frame']) / FPS
        if c['type'] == 'click':
            audio.place(sfx, audio.sfx_click(), at, 0.5)
        elif c['type'] == 'reveal':
            audio.place(sfx, audio.sfx_reveal(), at, 0.9)
    # whoosh on scene changes (not between consecutive shots of the same scene)
    if k > 0 and s['id'][:2] != shots[k - 1]['id'][:2]:
        audio.place(sfx, audio.sfx_whoosh(0.9, seed=k), starts[k] / FPS - 0.45, 0.9)
vpk = np.abs(voice).max() + 1e-9
mix = voice / vpk * 0.80 + music * 0.20 + sfx * 0.5
mix = np.tanh(mix * 1.1) / np.tanh(1.1)  # soft limiter
wav = os.path.join(BUILD, f'mix_{cut}.wav')
sf.write(wav, mix.astype(np.float32), audio.SR, subtype='PCM_24')

# ------------------------------------------------------------------ encode
name = {'full': 'FloodSense_demo_1080p.mp4', 'short': 'FloodSense_demo_short_1080p.mp4'}.get(cut, f'{cut}.mp4')
out = os.path.join(OUT, name)
cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(fdir, '%05d.jpg'), '-i', wav,
       '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
       '-profile:v', 'high', '-level', '4.1', '-r', str(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
       '-movflags', '+faststart', '-shortest', out]
subprocess.run(cmd, check=True)
json.dump({'cut': cut, 'shots': [{'id': s['id'], 'start': round(starts[k] / FPS, 2), 'duration': round(s['frames'] / FPS, 2), 'vo': s['vo']} for k, s in enumerate(shots)],
           'total': round(total, 2)}, open(os.path.join(OUT, f'edl_{cut}.json'), 'w'), indent=1)
print('wrote', out, f'{os.path.getsize(out) / 1e6:.1f} MB')
