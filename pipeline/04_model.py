"""
FloodSense GIS pipeline — Stage 4: multi-criteria flood susceptibility model.

1. Rasterise Ogun State + LGA boundaries onto the 90 m analysis grid
2. Transform each factor to a 0-1 susceptibility membership (piecewise-linear, documented knots)
3. Derive factor weights with the Analytic Hierarchy Process (principal eigenvector) and
   check the consistency ratio (CR must be < 0.10)
4. Weighted linear combination -> susceptibility index (0-1)
5. Classify into 5 classes with Jenks natural breaks (relative within Ogun State)
6. Consistency check against JRC Global Surface Water (Landsat-observed intermittent water):
   frequency ratio per class, ROC-AUC, single-factor and leave-one-out sensitivity
7. Zonal statistics per LGA (class shares, built-up exposure, terrain, rainfall)

IMPORTANT: the pairwise judgements below are prototype expert judgements made by the
FloodSense team from the factor roles described in flood-susceptibility literature.
They are NOT calibrated against flood-event inventories. See docs/METHODOLOGY.md.
"""
import json
import os

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.warp import Resampling, reproject

from common import (ANALYSIS_CRS, CELL, DOMAIN_H, DOMAIN_TRANSFORM, DOMAIN_W, PROC, RAW,
                    log_step, read, write)

FACTORS = [
    # key, label, unit, knots (value -> membership)
    ("hand", "Height above nearest drainage", "m",
     [[0, 1.0], [2, 0.9], [5, 0.6], [10, 0.3], [20, 0.05], [30, 0.0]]),
    ("dist", "Distance to drainage channel", "m",
     [[0, 1.0], [100, 0.85], [250, 0.6], [500, 0.35], [1000, 0.1], [2000, 0.0]]),
    ("slope", "Slope", "deg",
     [[0, 1.0], [1, 0.9], [2, 0.7], [5, 0.35], [10, 0.1], [20, 0.0]]),
    ("twi", "Topographic wetness index", "",
     [[5, 0.0], [8, 0.2], [10, 0.5], [12, 0.8], [15, 1.0]]),
    ("rain", "Mean annual rainfall", "mm/yr",
     [[1100, 0.0], [2200, 1.0]]),
    ("lulc", "Land cover (runoff / retention)", "class", None),
]

# ESA WorldCover class -> membership (higher = more runoff / more naturally inundated)
LULC = {
    10: ("Tree cover", 0.2), 20: ("Shrubland", 0.4), 30: ("Grassland", 0.5),
    40: ("Cropland", 0.6), 50: ("Built-up", 1.0), 60: ("Bare / sparse vegetation", 0.7),
    70: ("Snow and ice", 0.0), 80: ("Permanent water bodies", 1.0),
    90: ("Herbaceous wetland", 0.9), 95: ("Mangroves", 0.8), 100: ("Moss and lichen", 0.3),
}

# Saaty pairwise comparison matrix, upper triangle (row factor vs column factor)
# order: hand, dist, slope, twi, rain, lulc
PAIRWISE_UPPER = {
    ("hand", "dist"): 2, ("hand", "slope"): 3, ("hand", "twi"): 3, ("hand", "rain"): 4, ("hand", "lulc"): 3,
    ("dist", "slope"): 2, ("dist", "twi"): 2, ("dist", "rain"): 3, ("dist", "lulc"): 2,
    ("slope", "twi"): 1, ("slope", "rain"): 2, ("slope", "lulc"): 1,
    ("twi", "rain"): 2, ("twi", "lulc"): 1,
    ("rain", "lulc"): 0.5,
}
RI = {1: 0, 2: 0, 3: 0.58, 4: 0.90, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45}
CLASS_NAMES = ["Very low", "Low", "Moderate", "High", "Very high"]


def ahp(keys):
    n = len(keys)
    A = np.ones((n, n))
    for (a, b), v in PAIRWISE_UPPER.items():
        i, j = keys.index(a), keys.index(b)
        A[i, j] = v
        A[j, i] = 1.0 / v
    vals, vecs = np.linalg.eig(A)
    k = int(np.argmax(vals.real))
    w = np.abs(vecs[:, k].real)
    w = w / w.sum()
    lam = float(vals[k].real)
    ci = (lam - n) / (n - 1)
    cr = ci / RI[n]
    return A, w, lam, ci, cr


def jenks(values, k):
    """Jenks natural breaks (Fisher-Jenks DP) on a 1-D sample. Returns k+1 break values."""
    x = np.sort(np.asarray(values, dtype="float64"))
    n = len(x)
    mat1 = np.zeros((n + 1, k + 1), dtype=np.int64)
    mat2 = np.full((n + 1, k + 1), np.inf)
    mat1[1, 1:] = 1
    mat2[1, 1:] = 0.0
    for l in range(2, n + 1):
        s1 = s2 = w = 0.0
        v = 0.0
        for m in range(1, l + 1):
            i3 = l - m + 1
            val = x[i3 - 1]
            s2 += val * val
            s1 += val
            w += 1
            v = s2 - (s1 * s1) / w
            i4 = i3 - 1
            if i4 != 0:
                for j in range(2, k + 1):
                    if mat2[l, j] >= v + mat2[i4, j - 1]:
                        mat1[l, j] = i3
                        mat2[l, j] = v + mat2[i4, j - 1]
        mat1[l, 1] = 1
        mat2[l, 1] = v
    breaks = [0.0] * (k + 1)
    breaks[k] = x[-1]
    breaks[0] = x[0]
    kk = n
    for j in range(k, 1, -1):
        idx = int(mat1[kk, j] - 2)
        breaks[j - 1] = x[idx]
        kk = int(mat1[kk, j] - 1)
    return breaks


def auc(score, label):
    """ROC AUC via the Mann-Whitney U statistic."""
    order = np.argsort(score, kind="mergesort")
    ranks = np.empty(len(score), dtype="float64")
    ranks[order] = np.arange(1, len(score) + 1)
    # average ties
    s_sorted = score[order]
    _, first, counts = np.unique(s_sorted, return_index=True, return_counts=True)
    for f, c in zip(first, counts):
        if c > 1:
            ranks[order[f:f + c]] = (2 * f + c + 1) / 2.0
    pos = label.astype(bool)
    n1, n0 = pos.sum(), (~pos).sum()
    return float((ranks[pos].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def main():
    # 1. boundaries ------------------------------------------------------------
    adm1 = gpd.read_file(os.path.join(RAW, "NGA_ADM1.geojson"))
    ogun = adm1[adm1.shapeName == "Ogun"].to_crs(ANALYSIS_CRS)
    adm2 = gpd.read_file(os.path.join(RAW, "NGA_ADM2.geojson"))
    rp = adm2.copy()
    rp["geometry"] = adm2.representative_point()
    inside = gpd.sjoin(rp, adm1[adm1.shapeName == "Ogun"][["geometry"]], predicate="within").index
    lgas = adm2.loc[inside].sort_values("shapeName").reset_index(drop=True).to_crs(ANALYSIS_CRS)
    lgas["lga_id"] = np.arange(1, len(lgas) + 1)
    lga_r = rasterize(((g, i) for g, i in zip(lgas.geometry, lgas.lga_id)), out_shape=(DOMAIN_H, DOMAIN_W),
                      transform=DOMAIN_TRANSFORM, fill=0, dtype="uint8")
    state = rasterize(((g, 1) for g in ogun.geometry), out_shape=(DOMAIN_H, DOMAIN_W),
                      transform=DOMAIN_TRANSFORM, fill=0, dtype="uint8").astype(bool)
    # cells inside the state but in an LGA gap (boundary mismatch): nearest LGA
    gap = state & (lga_r == 0)
    if gap.any():
        from scipy import ndimage
        _, (ri, ci) = ndimage.distance_transform_edt(lga_r == 0, return_indices=True)
        lga_r[gap] = lga_r[ri[gap], ci[gap]]
    lga_r[~state] = 0
    write("lga_id", lga_r, dtype="uint8", nodata=255)

    # 2. factors -> memberships -------------------------------------------------
    raw = {
        "hand": read("hand"), "dist": read("dist_drainage"), "slope": read("slope"),
        "twi": read("twi"), "rain": read("rain_annual"),
    }
    lc = read("landcover")
    lc = np.nan_to_num(lc, nan=0).astype("int32")
    occ = read("gsw_occurrence")
    ever = read("gsw_ever_frac")
    builtup = read("builtup_frac")

    perm_water = state & ((lc == 80) | (np.nan_to_num(occ) >= 75))
    valid = state & ~perm_water
    for k in ("hand", "dist", "slope", "twi", "rain"):
        valid &= np.isfinite(raw[k])

    mem = {}
    for key, label, unit, knots in FACTORS:
        if key == "lulc":
            lut = np.zeros(256, dtype="float64")
            for c, (_, m) in LULC.items():
                lut[c] = m
            lut[0] = 0.5  # unknown -> neutral
            mem[key] = lut[np.clip(lc, 0, 255)]
        else:
            xs, ys = zip(*knots)
            mem[key] = np.interp(raw[key], xs, ys)
        mem[key] = np.where(valid, mem[key], np.nan)

    # 3. AHP --------------------------------------------------------------------
    keys = [f[0] for f in FACTORS]
    A, w, lam, ci, cr = ahp(keys)
    print("AHP weights", dict(zip(keys, np.round(w, 3))), "CR", round(cr, 4))
    assert cr < 0.10, "AHP judgements inconsistent"

    # 4. weighted linear combination ------------------------------------------
    idx = np.zeros((DOMAIN_H, DOMAIN_W))
    for k, wk in zip(keys, w):
        idx += wk * np.nan_to_num(mem[k])
    idx = np.where(valid, idx, np.nan)
    write("susc_index", np.nan_to_num(idx, nan=-9999))

    # 5. Jenks classification (deterministic systematic sample) -----------------
    vals = idx[valid]
    step = max(1, len(vals) // 4000)
    sample = np.sort(vals)[::step]
    breaks = jenks(sample, 5)
    breaks[0], breaks[-1] = float(vals.min()), float(vals.max())
    cls = np.zeros((DOMAIN_H, DOMAIN_W), dtype="uint8")
    inner = np.array(breaks[1:-1])
    cls[valid] = (np.digitize(idx[valid], inner, right=True) + 1).astype("uint8")
    cls[perm_water] = 6
    write("susc_class", cls, dtype="uint8", nodata=0)
    print("Jenks breaks", np.round(breaks, 4))

    # 6. consistency check vs JRC GSW --------------------------------------------
    ref = valid & (np.nan_to_num(ever) >= 0.2)  # observed (intermittent) water at least once
    cell_km2 = (CELL / 1000) ** 2
    class_stats = []
    n_valid = valid.sum()
    n_ref = ref.sum()
    for c in range(1, 6):
        m = cls == c
        a = (m & valid).sum()
        r = (m & ref).sum()
        pa, pr = a / n_valid, (r / n_ref if n_ref else 0)
        class_stats.append({"class": c, "name": CLASS_NAMES[c - 1], "area_km2": round(a * cell_km2, 1),
                            "area_pct": round(100 * pa, 2), "ref_pct": round(100 * pr, 2),
                            "frequency_ratio": round(pr / pa, 3) if pa else None})
    # AUC on a deterministic subsample of valid cells (all positives + every k-th negative)
    rng_idx = np.flatnonzero(valid.ravel())
    lab = ref.ravel()[rng_idx]
    pos_i = rng_idx[lab]
    neg_i = rng_idx[~lab][:: max(1, (~lab).sum() // 200000)]
    sel = np.concatenate([pos_i, neg_i])
    label = np.concatenate([np.ones(len(pos_i)), np.zeros(len(neg_i))])
    auc_model = auc(idx.ravel()[sel], label)
    single = {k: round(auc(np.nan_to_num(mem[k]).ravel()[sel], label), 3) for k in keys}
    loo = {}
    for j, k in enumerate(keys):
        w2 = np.delete(w, j)
        w2 = w2 / w2.sum()
        s = np.zeros(len(sel))
        for kk, ww in zip([x for x in keys if x != k], w2):
            s += ww * np.nan_to_num(mem[kk]).ravel()[sel]
        loo[k] = round(auc(s, label), 3)
    print("AUC", round(auc_model, 3), "single", single, "LOO", loo)

    # 7. LGA zonal statistics ------------------------------------------------------
    with rasterio.open(os.path.join(PROC, "rain_monthly_clim_native.tif")) as src:
        mclim = src.read().astype("float32")
        mtr, mcrs = src.transform, src.crs
    monthly = np.zeros((12, DOMAIN_H, DOMAIN_W), dtype="float32")
    for i in range(12):
        reproject(mclim[i], monthly[i], src_transform=mtr, src_crs=mcrs, dst_transform=DOMAIN_TRANSFORM,
                  dst_crs=ANALYSIS_CRS, resampling=Resampling.bilinear)
    days = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
    dem = read("dem")
    streams = read("streams") == 1
    lga_stats = []
    for _, row in lgas.iterrows():
        m = lga_r == row.lga_id
        mv = m & valid
        n = m.sum()
        hi = mv & (cls >= 4)
        cs = [round(100 * ((cls == c) & mv).sum() / max(mv.sum(), 1), 1) for c in range(1, 6)]
        lga_stats.append({
            "lga_id": int(row.lga_id), "name": row.shapeName,
            "area_km2": round(n * cell_km2, 1),
            "class_pct": cs,
            "high_or_very_high_pct": round(cs[3] + cs[4], 1),
            "mean_index": round(float(np.nanmean(idx[mv])), 4),
            "builtup_km2": round(float(np.nansum(builtup[m])) * cell_km2, 2),
            "builtup_in_high_km2": round(float(np.nansum(builtup[hi])) * cell_km2, 2),
            "elev_min_m": round(float(np.nanmin(dem[m])), 0), "elev_mean_m": round(float(np.nanmean(dem[m])), 0),
            "elev_max_m": round(float(np.nanmax(dem[m])), 0),
            "rain_annual_mm": round(float(np.nanmean(raw["rain"][m])), 0),
            "rain_monthly_mm": [round(float(np.nanmean(monthly[i][m])) * days[i], 0) for i in range(12)],
            "channel_km": round(float((streams & m).sum()) * CELL / 1000, 0),
            "observed_water_km2": round(float(ref[m].sum()) * cell_km2, 2),
            "permanent_water_km2": round(float(perm_water[m].sum()) * cell_km2, 2),
        })

    # state monthly rainfall series (cells of the 0.1 deg cube whose centre is in Ogun)
    meta = json.load(open(os.path.join(PROC, "rain_ts_meta.json")))
    cube = np.load(os.path.join(PROC, "rain_ts_cube.npy"))
    from rasterio.transform import Affine
    ttr = Affine(*meta["transform"])
    ogun4326 = adm1[adm1.shapeName == "Ogun"]
    cmask = rasterize(((g, 1) for g in ogun4326.geometry), out_shape=cube.shape[1:], transform=ttr,
                      fill=0, dtype="uint8").astype(bool)
    series = []
    for t, frame in zip(meta["times"], cube):
        v = frame[cmask]
        if np.isfinite(v).all():
            y, mo = int(t[:4]), int(t[5:7])
            series.append({"month": t[:7], "mm": round(float(v.mean()) * days[mo - 1] if mo != 2 else float(v.mean()) * (29 if y % 4 == 0 else 28), 1)})
    clim_by_month = {}
    for s in series:
        y, mo = int(s["month"][:4]), int(s["month"][5:7])
        if 2001 <= y <= 2020:
            clim_by_month.setdefault(mo, []).append(s["mm"])
    clim = {mo: float(np.mean(v)) for mo, v in clim_by_month.items()}
    for s in series:
        mo = int(s["month"][5:7])
        s["clim_mm"] = round(clim[mo], 1)
        s["anomaly_pct"] = round(100 * (s["mm"] - clim[mo]) / clim[mo], 1) if clim[mo] > 0 else None

    out = {
        "factors": [{"key": k, "label": l, "unit": u, "knots": kn,
                     "weight": round(float(wk), 4)} for (k, l, u, kn), wk in zip(FACTORS, w)],
        "lulc_classes": {str(c): {"name": n, "membership": m} for c, (n, m) in LULC.items()},
        "ahp": {"order": keys, "matrix": np.round(A, 4).tolist(), "lambda_max": round(lam, 4),
                "ci": round(ci, 4), "cr": round(cr, 4), "ri": RI[len(keys)]},
        "classification": {"method": "Jenks natural breaks (Fisher-Jenks) on a systematic sample of ~4,000 cells",
                           "breaks": [round(float(b), 4) for b in breaks], "names": CLASS_NAMES},
        "class_stats": class_stats,
        "validation": {
            "reference": "JRC Global Surface Water v1.4 (Landsat 1984-2021): 90 m cells where >=20% of 30 m pixels "
                         "were ever observed as water, excluding permanent water (occurrence >=75% or WorldCover class 80)",
            "n_reference_cells": int(n_ref), "n_valid_cells": int(n_valid),
            "auc": round(auc_model, 3), "single_factor_auc": single, "leave_one_out_auc": loo,
            "caveat": "Observed intermittent surface water is a partial proxy for flooding (includes reservoir "
                      "drawdown zones and seasonal wetlands; misses short-lived urban flooding and floods under cloud). "
                      "HAND and distance-to-drainage are derived from the same terrain that shapes where water is "
                      "observed, so this is a consistency check, not an independent validation.",
        },
        "lgas": lga_stats,
        "rainfall_series": series,
        "state": {"area_km2": round(state.sum() * cell_km2, 1),
                  "permanent_water_km2": round(perm_water.sum() * cell_km2, 1)},
    }
    with open(os.path.join(PROC, "model_results.json"), "w") as f:
        json.dump(out, f, indent=1)
    lgas.to_crs(4326).to_file(os.path.join(PROC, "lgas.geojson"), driver="GeoJSON")
    log_step("model", weights=dict(zip(keys, [round(float(x), 4) for x in w])), cr=round(cr, 4),
             breaks=[round(float(b), 4) for b in breaks], auc=round(auc_model, 3))


if __name__ == "__main__":
    main()
