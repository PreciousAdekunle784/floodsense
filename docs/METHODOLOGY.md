# FloodSense — Data sources and GIS methodology

FloodSense estimates **flood susceptibility** — where the land's terrain, drainage, land cover and rainfall make
flooding more likely — for all 20 LGAs of Ogun State, Nigeria. It is a multi-criteria decision analysis (MCDA)
weighted overlay with weights from the Analytic Hierarchy Process (AHP). It is a **prototype**: it uses real data
and real processing, but the weights are expert judgements that have not yet been calibrated against a
flood-event inventory.

Everything here is reproducible with `pipeline/run_all.sh` (Python 3.11+, network access to AWS Open Data,
Google Cloud public buckets and GitHub).

---

## 1. Data sources

| Dataset | Provider | Native resolution | Role |
|---|---|---|---|
| geoBoundaries gbOpen NGA ADM1/ADM2 | William & Mary geoLab (CC BY 4.0) | vector | State + 20 LGA boundaries |
| Copernicus DEM GLO-90 | ESA / Airbus (AWS Open Data) | 3″ (~90 m) | Terrain & hydrology analysis |
| Copernicus DEM GLO-30 | ESA / Airbus (AWS Open Data) | 1″ (~30 m) | Display: hillshade, colour relief, 3D |
| ESA WorldCover 2021 v200 | ESA / VITO (CC BY 4.0) | 10 m | Land-cover factor, built-up exposure |
| GPM IMERG precipitation | NASA, via NASA POWER v10 Zarr (AWS) | 0.1° | Rainfall factor, monthly series |
| JRC Global Surface Water v1.4 | EC JRC / Google (Landsat 1984–2021) | 30 m | Observed-water layer and **reference only** (not an input) |
| GeoNames cities1000 | GeoNames (CC BY 4.0) via GitHub mirror | points | Town search and labels (31 in Ogun) |
| Natural Earth 10 m rivers | Natural Earth (public domain) | vector | Naming the Ogun River in the DEM-derived network |

Sources investigated but **not reachable or not integrated** in this build: CHIRPS (replaced by GPM IMERG),
HydroSHEDS/HydroRIVERS (replaced by our own DEM-derived network), OpenStreetMap extracts (online street basemap
only), Sentinel-1 SAR (planned), NIHSA/NEMA historical flood records (planned).

Documented flood context (news reports, not plotted as data): recurring flooding along the Ogun River downstream
of the Oyan Dam — Isheri, Akute, Alagbole, Magboro, Warewa and parts of Abeokuta — with state relocation
advisories during dam releases (The Guardian NG, TheCable, Leadership; links in the app).

## 2. Processing workflow

| # | Step | Implementation | Status |
|---|---|---|---|
| 1 | Acquisition | `01_acquire.py` — scripted downloads; windowed COG reads for WorldCover/JRC; Zarr subset for IMERG | Done |
| 2 | Cleaning | Ocean/void handling, nodata masks, duplicate place names removed | Done |
| 3 | CRS harmonisation | All rasters → **WGS 84 / UTM 31N (EPSG:32631)**, one 90 m grid (3,066 × 3,688 cells); Ogun (2.7–4.6 °E) lies wholly in zone 31 | Done |
| 4 | Raster/vector preparation | Mosaic, reprojection (bilinear for continuous, **mode** for land cover, **average** for fractions), LGA rasterisation | Done |
| 5 | Terrain conditioning | `fill_pits → fill_depressions → resolve_flats` (pysheds) | Done |
| 6 | Slope | Gradient of the *unconditioned* DEM, degrees | Done |
| 7 | Rainfall analysis | IMERG 2001–2020 climatology (annual + monthly) per cell; state monthly series 1998–Oct 2026 with anomalies | Done |
| 8 | Drainage & flow | D8 flow direction & accumulation; channels where upstream area ≥ **5 km²** (617 cells); Strahler order; vectorised network (9,233 segments in the domain, 2,292 within Ogun + 3 km) | Done |
| 9 | Distance to river | Euclidean distance to channel cells (m) | Done |
| 10 | Classification | Fuzzy memberships → AHP weighted linear combination → Jenks natural breaks | Done |
| 11 | Visualisation | Export to a 150 m Web-Mercator grid + vectors + Terrarium DEM tiles; MapLibre client | Done |
| 12 | Validation | Consistency check against Landsat-observed water (frequency ratio, ROC-AUC, sensitivity) | **Partial** — event-based validation still required |

The hydrological domain extends beyond the state (≈2.5–5.0 °E, 6.0–9.0 °N) so that flow accumulation includes the
upstream catchments of the Ogun, Yewa and Osun rivers in Oyo and Osun states.

## 3. Factors and membership functions

Each factor is converted to a 0–1 membership (1 = most susceptible) with piecewise-linear functions:

| Factor | Why it matters | Knots (value → membership) |
|---|---|---|
| **HAND** — height above nearest drainage, along D8 flow paths | Vertical distance water must rise to reach a place | 0 m→1, 2→0.9, 5→0.6, 10→0.3, 20→0.05, 30→0 |
| **Distance to channel** | Proximity to overbank flow and backed-up drainage | 0 m→1, 100→0.85, 250→0.6, 500→0.35, 1000→0.1, 2000→0 |
| **Slope** | Flat ground ponds; steep ground sheds water | 0°→1, 1→0.9, 2→0.7, 5→0.35, 10→0.1, 20→0 |
| **TWI** = ln(a / tan β) | Where water accumulates (large upslope area, gentle slope) | 5→0, 8→0.2, 10→0.5, 12→0.8, 15→1 |
| **Mean annual rainfall** (IMERG) | Long-term water supply | 1,100 mm→0, 2,200 mm→1 |
| **Land cover** (WorldCover) | Runoff generation / natural inundation | Built-up 1.0, herbaceous wetland 0.9, mangroves 0.8, bare 0.7, cropland 0.6, grassland 0.5, shrubland 0.4, tree cover 0.2 |

Absolute elevation is shown as a layer but deliberately **not** used as a factor: across a coastal state it mainly
encodes distance from the sea, whereas HAND measures height relative to the local drainage that actually floods.

## 4. AHP weights

Pairwise judgements (Saaty 1–9; row vs column), order HAND, DIST, SLOPE, TWI, RAIN, LULC:

|  | HAND | DIST | SLOPE | TWI | RAIN | LULC |
|---|---|---|---|---|---|---|
| HAND | 1 | 2 | 3 | 3 | 4 | 3 |
| DIST | ½ | 1 | 2 | 2 | 3 | 2 |
| SLOPE | ⅓ | ½ | 1 | 1 | 2 | 1 |
| TWI | ⅓ | ½ | 1 | 1 | 2 | 1 |
| RAIN | ¼ | ⅓ | ½ | ½ | 1 | ½ |
| LULC | ⅓ | ½ | 1 | 1 | 2 | 1 |

Principal eigenvector weights: **HAND 35.5 %, distance 21.8 %, slope 12.0 %, TWI 12.0 %, land cover 12.0 %,
rainfall 6.8 %**. λmax = 6.032, CI = 0.0065, **CR = 0.005** (< 0.10, consistent).

These are prototype judgements by the FloodSense team based on the physical roles above and the factor sets common
in Nigerian AHP flood studies. They are not taken from, and not validated as, any published weight set.
The web app lets anyone edit the matrix and re-run the model.

## 5. Classification

Index = Σ wᵢ · mᵢ (0–1). Five classes by **Jenks natural breaks** (Fisher–Jenks on a systematic sample of ~4,000
cells): breaks 0.242 · 0.367 · 0.523 · 0.693. Classes are **relative within Ogun State**. Permanent water
(WorldCover class 80 or JRC occurrence ≥ 75 %) is excluded (44 km²).

| Class | Area km² | % of state |
|---|---|---|
| Very low | 5,255 | 31.7 |
| Low | 4,562 | 27.5 |
| Moderate | 2,721 | 16.4 |
| High | 2,306 | 13.9 |
| Very high | 1,759 | 10.6 |

Computed state area 16,724 km² (published figure ≈ 16,762 km²).

## 6. Consistency check (not full validation)

**Reference:** 90 m cells where ≥ 20 % of the 30 m JRC pixels were *ever* observed as water (1984–2021),
excluding permanent water — 4,561 cells (≈37 km²) out of 2.05 million.

| Class | % of area | % of observed water | Frequency ratio |
|---|---|---|---|
| Very low | 31.7 | 0.6 | 0.02 |
| Low | 27.5 | 2.6 | 0.10 |
| Moderate | 16.4 | 4.7 | 0.29 |
| High | 13.9 | 18.9 | 1.36 |
| Very high | 10.6 | 73.1 | 6.90 |

ROC-AUC of the index = **0.914**. Single-factor AUC: HAND 0.910, distance 0.820, land cover 0.771, TWI 0.746,
slope 0.705, **rainfall 0.457**. Leave-one-out AUC: without HAND 0.874, without land cover 0.897, without the others
0.915–0.918.

**Interpretation and caveats.** The monotonic frequency ratio shows the classes are consistent with where water has
been seen. But: (a) the reference includes reservoir drawdown zones and seasonal wetlands, and misses short urban
floods and floods under cloud; (b) HAND/distance share the terrain that shapes where water is observed, so the
check is not independent; (c) removing several factors barely changes the AUC, i.e. this reference cannot
discriminate between them — they are retained for physical reasons (e.g. urban runoff), not because the proxy
rewards them. Rainfall alone scores below 0.5 because its gentle north–south gradient does not explain where water
pools; hence its low weight. **Event-based validation (Sentinel-1 flood extents, NEMA/OGSEMA incident records,
verified FloodSense reports) is required before operational use.**

## 7. Exposure indicators

Built-up area (WorldCover) inside High/Very-high cells, per LGA: Obafemi Owode 59.1 km², Ado-Odo/Ota 29.7,
Ifo 25.0, Shagamu 24.1, Ewekoro 10.2, Yewa North 7.3. The top three coincide with the documented Ogun River /
Oyan Dam corridor and the Lagos–Ogun urban fringe — the suggested first field pilot.

## 8. Web delivery

* `grid-core.bin.gz` (3.2 MB): 11 uint8 layers on a 1,447 × 1,268 Web-Mercator grid (150 m): LGA id, six factor
  memberships, baseline class, reference water, land cover, built-up %. The browser recomputes the model from these.
* `grid-detail.bin.gz` (5.2 MB, lazy): uint16 raw values (elevation, HAND, distance, slope, TWI, rainfall) for inspection.
* `dem/{z}/{x}/{y}.png`: 720 Terrarium-encoded GLO-30 tiles, z5–12 (hillshade, colour relief, 3D terrain offline).
* Vectors: LGAs, state, outside mask, drainage network (Strahler order, upstream area), GeoNames places.

The server loads the same files to compute the LGA and terrain context for every submitted report.

## 9. Limitations

1. Weights are not calibrated to flood events (see §6).
2. Copernicus DEM is a surface model (buildings, canopy) — a bare-earth DEM (FABDEM) or LiDAR would improve urban areas.
3. 90 m drainage ignores culverts, urban drains, embankments and dam operations (Oyan Dam releases are not modelled).
4. The model represents fluvial/ponding susceptibility; blocked-drain flash floods can occur in any class.
5. Rainfall is a 0.1° climatology, not a storm; recent IMERG months are provisional.
6. Susceptibility ≠ risk: population and vulnerability are only partly represented (built-up area).
7. Display grid is 150 m; the analysis grid is 90 m.

## 10. Path to operational use

1. Assemble an event inventory (NEMA/OGSEMA records, verified reports, Sentinel-1 change detection for 2018–2025 events).
2. Calibrate/validate weights (AHP vs frequency ratio / logistic regression), report accuracy with held-out events.
3. Add soils (SoilGrids), bare-earth DEM, OSM buildings/roads for exposure; model Oyan Dam release scenarios with ORBDA.
4. Integrate official NIHSA/NiMet alerts with attribution — never generate warnings.
5. Move to PostgreSQL/PostGIS (`server/sql/postgis_schema.sql`) and object storage for photos.
