"""Shared constants and helpers for the FloodSense GIS pipeline."""
import json
import os
from datetime import datetime, timezone

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "data", "raw")
PROC = os.path.join(HERE, "data", "processed")
WEB = os.path.join(HERE, "..", "public", "data")  # served by the app
os.makedirs(PROC, exist_ok=True)
os.makedirs(WEB, exist_ok=True)

# Analysis CRS: WGS 84 / UTM zone 31N - metric, conformal; Ogun State (2.7-4.6 E)
# lies entirely inside zone 31 (0-6 E), so distances/slopes are computed in metres.
ANALYSIS_CRS = CRS.from_epsg(32631)
CELL = 90.0  # metres — matches the native GLO-90 spacing (3 arc-seconds)

# Hydrological domain in UTM31N (covers Ogun State plus upstream catchments
# reaching into Oyo/Osun states and downstream to the Lagos lagoon).
# Approx lon 2.5-5.0 E, lat 6.0-9.0 N.
DOMAIN = (445_000.0, 663_000.0, 721_000.0, 995_000.0)  # xmin, ymin, xmax, ymax
DOMAIN_W = int((DOMAIN[2] - DOMAIN[0]) / CELL)
DOMAIN_H = int((DOMAIN[3] - DOMAIN[1]) / CELL)
DOMAIN_TRANSFORM = from_origin(DOMAIN[0], DOMAIN[3], CELL, CELL)

LOG_PATH = os.path.join(PROC, "processing_log.json")


def profile(dtype="float32", nodata=-9999.0):
    return dict(driver="GTiff", width=DOMAIN_W, height=DOMAIN_H, count=1, dtype=dtype,
                crs=ANALYSIS_CRS, transform=DOMAIN_TRANSFORM, nodata=nodata,
                compress="deflate", tiled=True, blockxsize=256, blockysize=256)


def write(name, arr, dtype="float32", nodata=-9999.0):
    path = os.path.join(PROC, f"{name}.tif")
    with rasterio.open(path, "w", **profile(dtype, nodata)) as dst:
        dst.write(arr.astype(dtype), 1)
    return path


def read(name):
    with rasterio.open(os.path.join(PROC, f"{name}.tif")) as src:
        a = src.read(1).astype("float64")
        nd = src.nodata
    if nd is not None:
        a[a == nd] = np.nan
    return a


def log_step(step, **info):
    log = {}
    if os.path.exists(LOG_PATH):
        with open(LOG_PATH) as f:
            log = json.load(f)
    info["completed_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    log[step] = info
    with open(LOG_PATH, "w") as f:
        json.dump(log, f, indent=2, default=float)
