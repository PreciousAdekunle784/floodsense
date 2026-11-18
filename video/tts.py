"""Synthesise each narration line with Kokoro (local neural TTS) -> video/build/vo/<id>.wav + durations.json"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'build', 'vo')
os.makedirs(OUT, exist_ok=True)
script = json.load(open(os.path.join(HERE, sys.argv[1] if len(sys.argv) > 1 else 'script.json')))
k = Kokoro(os.path.join(HERE, 'assets/tts/kokoro-v1.0.onnx'), os.path.join(HERE, 'assets/tts/voices-v1.0.bin'))
durations = {}
from kokoro_onnx.tokenizer import Tokenizer
tok = Tokenizer()
# Yoruba place names: espeak's English guesses are wrong (e.g. Ogun -> "AH-gun"); substitute closer phonemes.
FIX = {'ˈɑːɡʌn': 'oʊɡˈuːn', 'ˈɔɪən': 'ˈoʊjɑːn', 'ˈɪʃɚɹi': 'iʃˈɛɹi', 'ˈækjuːt': 'ɑːkˈuːteɪ', 'mˈæɡbɚɹˌoʊ': 'mˈɑɡbɔːɹoʊ', 'ˈaɪfoʊ': 'ˈiːfɔ'}
for line in script['lines']:
    ph = tok.phonemize(line['text'], 'en-us')
    for a, b in FIX.items():
        ph = ph.replace(a, b)
    line['phonemes'] = ph
    samples, sr = k.create(ph, voice=script['voice'], speed=script['speed'], lang='en-us', is_phonemes=True)
    samples = np.asarray(samples, dtype=np.float32)
    # trim leading/trailing silence, keep 60 ms margins
    thr = 0.01 * np.max(np.abs(samples))
    nz = np.flatnonzero(np.abs(samples) > thr)
    a, b = max(nz[0] - int(0.06 * sr), 0), min(nz[-1] + int(0.06 * sr), len(samples))
    samples = samples[a:b]
    sf.write(os.path.join(OUT, f"{line['id']}.wav"), samples, sr)
    durations[line['id']] = round(len(samples) / sr, 3)
    print(line['id'], durations[line['id']], 's')
json.dump({'phonemes': {l['id']: l['phonemes'] for l in script['lines']}, 'sample_rate': sr, 'durations': durations, 'total': round(sum(durations.values()), 2)}, open(os.path.join(OUT, 'durations.json'), 'w'), indent=1)
print('total', round(sum(durations.values()), 1), 's')
