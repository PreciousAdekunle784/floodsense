# FloodSense — live demonstration guide (FUNAAB World GIS Day)

**Duration:** 8–10 minutes. **Presenter laptop:** run FloodSense locally — it does not need the internet.

## Before the session (15 minutes earlier)

```bash
npm run build
```

```bash
FLOODSENSE_ADMIN_PASSWORD='choose-a-strong-password' npm run setup
```

```bash
npm start
```

1. Open `http://localhost:8080` in Chrome. Press **F11** for full screen.
2. Optional: `npm run demo:reset` to restore the original synthetic reports (genuine reports are kept).
3. Sign in once at **Verify** to check the password, then sign out.
4. Keep a phone on the same Wi-Fi as a prop for the reporting step (open `http://<laptop-ip>:8080`).
   GPS needs HTTPS, so on the phone use "tap the map" or search instead of "Use my location".
5. If the venue has internet, the **Streets** and **Satellite** basemaps work; otherwise FloodSense automatically
   falls back to the offline terrain basemap. Every FloodSense layer is local.

Click **Guided demo** (top bar) to get presenter cards with talking points for each step below. It moves the map
and switches layers for you.

## The journey

| # | Do | Say |
|---|---|---|
| 1 | Open the map (Ogun State overview). | "FloodSense covers all 20 LGAs of Ogun State. The panel on the right is computed from our GIS model: 24 % of the land is High or Very-high susceptibility, with 207 km² of built-up land inside it." |
| 2 | Layers → turn on **Elevation**, off Susceptibility. Zoom to Abeokuta. | "This is the Copernicus 30 m elevation model, served from local tiles. The Ogun River valley cuts through Abeokuta." |
| 3 | Turn on **Drainage network**. | "We derived the drainage network ourselves: sink filling, D8 flow direction, flow accumulation, channels above 5 km², ordered by Strahler order." |
| 4 | Turn **Flood susceptibility** back on. Zoom to the lower Ogun River (Isheri/Akute area). | "Six factors — height above drainage, distance to channel, slope, wetness index, rainfall, land cover — combined with AHP weights. This is susceptibility, a property of the land; it is not a forecast." |
| 5 | Click a red cell near the river. | "The panel explains *why*: 0.5 m above the nearest channel, 177 m away, nearly flat. It also shows the satellite water record, nearby reports and preparedness advice for this kind of place." |
| 6 | Turn on **Observed surface water**. | "Cyan is where Landsat has seen water since 1984. The Very-high class holds 73 % of it on 11 % of the land — AUC 0.91. We call this a consistency check, not validation." |
| 7 | (Optional) **3D terrain**. | "You can see why the valley floor is red." |
| 8 | **Report flooding** → tap the map → Moderate → description → (photo) → Send. | "Anyone can report from a phone. It appears immediately — but as *pending*: text hidden, location rounded to 110 m." Show the reference code. |
| 9 | **Verify** → sign in → open the new report. | "The verifier sees the exact location, the GIS consistency check, nearby corroborating reports and automated spam flags." Press **Verify**. |
| 10 | **Insights**. | "Verified count went up by one — computed from the database, not hard-coded. Untick demo data to see genuine reports only." Point at reports vs susceptibility and the IMERG rainfall anomaly. |
| 11 | **Model** → press **Rainfall** preset → **Apply**. | "Planners can test assumptions. Emphasising rainfall lowers agreement with observed water from 0.911 to 0.881, which is why rainfall has a low weight." Press **Reset to baseline**. |
| 12 | **Data**. | "We are explicit about what is real, modelled, synthetic or not yet integrated, and about the limitations. Next step: an Ogun River corridor pilot with event-based validation." |

## If something goes wrong

* **Map blank:** refresh. Check the terminal for `FloodSense running at …`. Data loads from `public/data`.
* **Online basemap fails:** FloodSense switches to the offline terrain basemap and shows a message. Continue.
* **"That was very fast":** the anti-bot timer needs about 4 seconds on the form. Press Send again.
* **"Too many reports from this device":** the rate limit is 5 per hour per device. Restart the server with
  `REPORTS_PER_HOUR=50 npm start` before the session.
* **Forgot the admin password:** stop the server, delete `data/floodsense.db`, and run the setup again (demo data is re-seeded).

## Short technical explanation for judges

> FloodSense is a GIS flood-intelligence prototype for Ogun State. A Python pipeline (rasterio, GeoPandas, pysheds,
> xarray) downloads open data — Copernicus DEM, ESA WorldCover, NASA GPM IMERG rainfall, JRC Global Surface Water and
> geoBoundaries — and puts it on a single 90 m grid in UTM zone 31N. From the DEM we condition the terrain, compute D8
> flow direction and accumulation, extract the drainage network, and derive height above nearest drainage, distance to
> channel, slope and the topographic wetness index. Six factors are converted to 0–1 scores and combined with AHP weights
> (consistency ratio 0.005), then classed with Jenks natural breaks. We check the result against 37 years of
> Landsat-observed water: the Very-high class holds 73 % of observed water on 11 % of the land (AUC 0.91). We are clear
> that this is a consistency check: event-based validation is the next step.
>
> The web app is React with MapLibre. The model layers are shipped as compact binary rasters, so the browser can
> re-run the weighted overlay when a planner changes the AHP judgements. Community reports go to a Node.js API with
> SQLite (PostGIS schema provided for production). Every report is checked against the Ogun boundary, tagged with its
> LGA and terrain context, and protected by signed form tokens, a honeypot, rate limits and automated quality flags.
> Reports stay pending until a signed-in verifier checks them using that GIS context; only verified reports are
> published in full. Contact details are consent-based, visible only to verifiers and deleted after 30 days; photo
> metadata is stripped. Everything runs offline on a laptop.

## Likely questions

* **Are the weights validated?** No — they are documented, consistent expert judgements. We measure agreement with
  observed water (AUC 0.91) and run a sensitivity analysis. Calibration needs a flood-event inventory, which is our pilot plan.
* **Why not CHIRPS?** It was not reachable from our build environment; we used NASA GPM IMERG (0.1°), which also
  gives monthly data up to October 2026.
* **Is this an early-warning system?** No. FloodSense shows susceptibility, community reports and observed water, and
  points people to NIHSA, NiMet and Ogun State agencies for warnings.
* **How do you stop false reports?** Pending status by default, form tokens with a minimum fill time, honeypot,
  per-device rate limits, automated flags (links, repeated text, implausible locations), GIS consistency signals,
  duplicate merging, an audit trail and human verification.
* **Why HAND instead of elevation?** Across a coastal state, absolute elevation mostly measures distance from the sea.
  HAND measures height above the local channel, which is what determines whether rising water reaches a place.
* **Resolution?** Analysis at 90 m. The web display uses 150 m to keep downloads small (3 MB). Hillshade/3D uses the 30 m DEM.
