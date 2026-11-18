"""Builds SCRIPT.md and STORYBOARD.md from script.json + the edit decision lists produced by assemble.py."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
script = {l['id']: l for l in json.load(open(os.path.join(HERE, 'script.json')))['lines']}
SCENES = {1: 'The problem', 2: 'Introducing FloodSense', 3: 'The geospatial map', 4: 'Community flood reporting', 5: 'Verification and dashboard', 6: 'The bigger picture', 7: 'Final message'}

SHOTS = {
    's1_terrain': ('Real terrain b-roll', 'Copernicus DEM 3D terrain of the Ogun River valley rendered by the FloodSense map (UI hidden), with the DEM-derived drainage network and Landsat-observed water. Slow aerial drift. Stylised rain overlay. Tag: "Ogun River valley".', 'Real data · rain overlay is a motion-graphic effect'),
    's1_evidence': ('Data card → headlines', 'Animated bar chart of monthly rainfall over Ogun State, Jan–Oct 2026 (NASA GPM IMERG) against the 2001–2020 average; June called out at +41%. Then three quoted news headlines about relocation advisories (The Guardian Nigeria, TheCable) and the communities named in them.', 'Real data and real quoted headlines'),
    's1_question': ('The question', 'Ogun State outline and LGA boundaries draw in (geoBoundaries), drainage fades in. Text: "Where is the risk?" / "What is happening on the ground?"', 'Real geometry'),
    's2_intro': ('Brand reveal', 'Logo mark draws, "FloodSense" wordmark and tagline. Logo rises; three cards: Geographic intelligence + Community intelligence → Decision support.', 'Motion graphics'),
    's3_overview': ('App: map overview', 'Real FloodSense map (dark theme) — all 20 LGAs, susceptibility layer, drainage, reports, layer panel and overview panel. Slow push-in. Lower third: "All 20 LGAs of Ogun State".', 'Real app'),
    's3_layers': ('App: terrain & drainage', 'Cursor turns susceptibility off and Elevation on; camera moves to the Abeokuta / Ogun valley. Lower third: "Water follows the terrain".', 'Real app'),
    's3_model': ('App: the model', 'Elevation off, susceptibility on. Six factor chips appear in sync with the narration, then their AHP weights (35.5 / 21.8 / 12.0 / 12.0 / 6.8 / 12.0 %), CR 0.005. Camera flies to the lower Ogun corridor.', 'Real app · weights are the real model weights'),
    's3_inspect': ('App: point inspection', 'Cursor clicks a Very-high cell beside the Ogun River in Ifo LGA; the inspector explains the class and factor contributions (height above drainage < 1 m). Inspector scrolls to observed-water and guidance.', 'Real app · real model values'),
    's3_validate': ('App: observed-water check', 'Observed surface water layer switched on; camera pulls back. Stat card: 10.6 % of land in Very-high → 73 % of Landsat-observed water; AUC 0.91, "a consistency check — not a forecast".', 'Real app · real validation figures'),
    's4_phone': ('App on a phone: reporting', 'Real FloodSense running at phone size inside a phone frame: drop pin beside the Ogun River (Ifo), Continue, severity "Moderate", type description, skip optional photo/contact, review, Send → reference code. Right-hand step list and safeguard notes.', 'Real app · the report is a demo submission made for the video'),
    's4_pending': ('App: pending on the map', 'Desktop map at the report location; the new report shows as a pending marker. Click → "Unverified report" panel (text hidden, ~110 m precision).', 'Real app'),
    's5_verify': ('App: verification console', 'Signed-in demo verifier opens the new report: exact location, GIS consistency check (class, HAND, distance, observed water), nearby reports, flags. Types a note and clicks Verify → status Verified.', 'Real app · "Demo Verifier" is a demo account'),
    's5_dashboard': ('App: dashboard', 'Insights page computed live from the database; cursor on "Verified incidents"; page scrolls to activity and LGA charts. Lower third discloses the 24 synthetic demo reports.', 'Real app · includes labelled synthetic demo reports'),
    's6_scenario': ('App: change the model', 'Model page: AHP matrix and preview map. Click "Urban runoff" preset, "Apply scenario to map" — the state is re-classified in the browser.', 'Real app'),
    's6_bigger': ('Real terrain b-roll', '3D terrain over the lower Ogun corridor with susceptibility classes, drainage and report markers. Text: "Not a forecast. Not a warning system." then "For residents · local governments · emergency managers".', 'Real app data'),
    's7_close': ('Close', 'The DEM-derived drainage network of Ogun State draws in; logo, FLOODSENSE, tagline; credits and data sources; fade to black.', 'Real geometry · motion graphics'),
}


def mmss(t):
    return f'{int(t // 60)}:{t % 60:04.1f}'


def main():
    lines = ['# FloodSense demo video — voiceover script', '',
             'Voice: Kokoro v1.0 neural TTS, voice `af_heart`, speed 0.94, generated locally (no cloud service).',
             'Yoruba place names use phoneme overrides: Ogun (oh-GOON), Oyan (OH-yahn), Isheri (ee-SHEH-ree), Akute (ah-KOO-teh), Magboro (MAG-bo-ro), Ifo (EE-faw).',
             'To replace the synthetic voice with a human narrator, record each line below as a separate file named `<id>.wav` into `video/build/vo/` and re-run `assemble.py` (timings adapt to the new lengths after re-capture).', '']
    for sc in range(1, 8):
        lines.append(f'## Scene {sc} — {SCENES[sc]}')
        lines.append('')
        for l in script.values():
            if l['scene'] == sc:
                lines.append(f"**{l['id']}** — {l['text']}")
                lines.append('')
    open(os.path.join(HERE, 'SCRIPT.md'), 'w').write('\n'.join(lines))

    sb = ['# FloodSense demo video — storyboard', '']
    for cut in ('full', 'short'):
        p = os.path.join(HERE, 'out', f'edl_{cut}.json')
        if not os.path.exists(p):
            continue
        edl = json.load(open(p))
        sb += [f'## {"Full version" if cut == "full" else "Short version (presentation)"} — {mmss(edl["total"])}', '',
               '| Time | Shot | Picture | Narration | Source |', '|---|---|---|---|---|']
        for s in edl['shots']:
            title, pic, src = SHOTS[s['id']]
            vo = ' '.join(f'“{script[v]["text"]}”' for v in s['vo'])
            sb.append(f'| {mmss(s["start"])}–{mmss(s["start"] + s["duration"])} | {title} | {pic} | {vo} | {src} |')
        sb.append('')
    open(os.path.join(HERE, 'STORYBOARD.md'), 'w').write('\n'.join(sb))
    print('wrote SCRIPT.md and STORYBOARD.md')


if __name__ == '__main__':
    main()
