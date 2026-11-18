# FloodSense — product demonstration video (project files)

Everything in the video is produced from this folder: the voiceover, the screen captures of the running
application, the motion graphics, the score, the edit and the encode. Nothing was assembled by hand in an editor,
so any change can be re-rendered.

| File | Role |
|---|---|
| `script.json` | Narration lines (16), scene numbers, voice and speed |
| `tts.py` | Local neural voiceover (Kokoro v1.0, ONNX) → `build/vo/*.wav`, with phoneme fixes for Yoruba place names |
| `timeline.json` | Shot list (order, narration per shot, lead/tail padding, crossfade, short-cut selection) |
| `capture/lib.mjs` | Frame-stepped recorder: deterministic camera paths, synthetic cursor, click ripples, caption overlays |
| `capture/shots.mjs` | Choreography of the 12 application shots (real interactions with the running app) |
| `graphics/graphics.html`, `graphics/render.mjs` | Data-driven motion graphics (rainfall chart, headlines, outline, logo, end card) |
| `audio.py` | Original synthesised score (pads, sub, arpeggio, rain bed) and sound effects (clicks, whooshes, reveal) |
| `assemble.py` | Crossfades, voice placement, music ducking, SFX, loudness normalisation (−16 LUFS), H.264 encode |
| `make_docs.py` | Generates `SCRIPT.md` and `STORYBOARD.md` from the edit decision lists |
| `out/` | Final MP4s and edit decision lists (`edl_*.json`) — not committed (large binaries) |

## Rebuild

Requirements: Node 22, Python 3.11+, ffmpeg, Playwright with Chromium. About 1 hour on 4 CPU cores; most of it is
rendering WebGL frames in software.

```bash
cd video && python3 -m venv .venv && . .venv/bin/activate && pip install kokoro-onnx soundfile numpy scipy pillow
```

```bash
mkdir -p assets/tts && curl -L -o assets/tts/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx && curl -L -o assets/tts/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

```bash
python tts.py
```

Start the app on port 8095 with a fresh demo database and a verifier account (from the repository root):

```bash
FLOODSENSE_DATA_DIR=/tmp/fs-capture FLOODSENSE_ADMIN_EMAIL=verifier@floodsense.local FLOODSENSE_ADMIN_NAME="Demo Verifier" FLOODSENSE_ADMIN_PASSWORD=capture-password-2026 node server/setup.js
```

```bash
FLOODSENSE_DATA_DIR=/tmp/fs-capture PORT=8095 REPORTS_PER_HOUR=100 node server/index.js
```

Then, from `video/`:

```bash
node capture/shots.mjs && node graphics/render.mjs
```

```bash
python assemble.py full && python assemble.py short && python make_docs.py
```

## Changing things

* **Human narrator** (recommended if a Nigerian voice is wanted): record each line in `SCRIPT.md` as
  `build/vo/<id>.wav`, update `build/vo/durations.json`, then re-run capture and assembly so shot lengths follow the new timing.
* **Real flood footage**: add licensed or own footage as frames in `build/frames/<new_shot>/`, add the shot to
  `timeline.json` (for example before `s1_evidence`) and re-run `assemble.py`.
* **Portrait 9:16**: the recorder takes its viewport from `capture/lib.mjs` (`W`, `H`). The app's mobile layout
  (≤ 820 px wide) can be captured at 1080 × 1920 by setting `W = 1080, H = 1920` and adapting overlay positions in
  `shots.mjs`; the phone shot already shows the mobile interface. Graphics are laid out for 16:9 and would need a
  portrait variant of `graphics.html`.
