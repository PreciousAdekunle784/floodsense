"""
FloodSense GIS pipeline — Stage 2: terrain and drainage analysis.

Input : Copernicus DEM GLO-90 tiles (EPSG:4326, 3 arc-second)
Steps :
  1. Mosaic tiles and reproject to the analysis grid (EPSG:32631, 90 m, bilinear)
  2. Hydrological conditioning: fill pits -> fill depressions -> resolve flats
  3. D8 flow direction and flow accumulation (upstream contributing cells)
  4. Drainage network extraction (upstream area >= STREAM_KM2) + Strahler order
  5. Slope (degrees) from the *unconditioned* DEM
  6. Height Above Nearest Drainage (HAND) along D8 flow paths
  7. Euclidean distance to the drainage network
  8. Topographic Wetness Index  TWI = ln(a / tan(beta))
Output: GeoTIFFs in data/processed + drainage network GeoJSON.
"""
import glob
import json
import os

import numpy as np

if not hasattr(np, "in1d"):  # NumPy >= 2.4 removed in1d; pysheds still calls it
    np.in1d = lambda a, b, **kw: np.isin(np.ravel(a), b, **kw)

import rasterio
from pysheds.grid import Grid
from rasterio.merge import merge
from rasterio.warp import Resampling, reproject
from scipy import ndimage

from common import (CELL, DOMAIN_H, DOMAIN_TRANSFORM, DOMAIN_W, ANALYSIS_CRS, PROC, RAW,
                    log_step, write)

STREAM_KM2 = 5.0      # minimum upstream area defining a drainage channel
CELL_KM2 = (CELL / 1000) ** 2
STREAM_CELLS = int(round(STREAM_KM2 / CELL_KM2))
DIRMAP = (64, 128, 1, 2, 4, 8, 16, 32)


def main():
    # 1. mosaic + reproject -------------------------------------------------
    tiles = sorted(glob.glob(os.path.join(RAW, "cop90", "*.tif")))
    srcs = [rasterio.open(t) for t in tiles]
    mosaic, mtrans = merge(srcs)
    src_crs = srcs[0].crs
    for s in srcs:
        s.close()
    dem = np.full((DOMAIN_H, DOMAIN_W), np.nan, dtype="float32")
    reproject(mosaic[0], dem, src_transform=mtrans, src_crs=src_crs,
              dst_transform=DOMAIN_TRANSFORM, dst_crs=ANALYSIS_CRS,
              resampling=Resampling.bilinear, dst_nodata=np.nan)
    # GLO DEM encodes sea surface ~0 m; clamp tiny negatives (lagoon noise)
    dem = np.where(np.isnan(dem), 0, dem)
    dem = np.maximum(dem, -2.0)
    write("dem", dem)
    print("DEM", dem.shape, float(np.nanmin(dem)), float(np.nanmax(dem)))

    # 2-4. hydrology with pysheds -------------------------------------------
    dem_path = os.path.join(PROC, "dem.tif")
    grid = Grid.from_raster(dem_path)
    r = grid.read_raster(dem_path)
    pits = grid.fill_pits(r)
    flooded = grid.fill_depressions(pits)
    inflated = grid.resolve_flats(flooded)
    fdir = grid.flowdir(inflated, dirmap=DIRMAP)
    acc = grid.accumulation(fdir, dirmap=DIRMAP)
    acc_np = np.asarray(acc, dtype="float64")
    write("flowacc", acc_np)
    streams = acc > STREAM_CELLS
    streams_np = np.asarray(streams)
    write("streams", streams_np.astype("uint8"), dtype="uint8", nodata=255)
    order = grid.stream_order(fdir, streams, dirmap=DIRMAP)
    write("strahler", np.asarray(order), dtype="int16", nodata=-1)
    print("streams cells", int(streams_np.sum()), "threshold cells", STREAM_CELLS)

    # vector network
    branches = grid.extract_river_network(fdir, streams, dirmap=DIRMAP)
    order_np = np.asarray(order)
    feats = []
    inv = ~DOMAIN_TRANSFORM
    for b in branches["features"]:
        coords = b["geometry"]["coordinates"]
        if len(coords) < 2:
            continue
        # attribute by the downstream-most cell
        x, y = coords[-1]
        c, rr = inv * (x, y)
        rr, c = int(min(max(rr, 0), DOMAIN_H - 1)), int(min(max(c, 0), DOMAIN_W - 1))
        # sample upstream area & order at the second-last vertex (inside channel)
        x2, y2 = coords[-2]
        c2, r2 = inv * (x2, y2)
        r2, c2 = int(min(max(r2, 0), DOMAIN_H - 1)), int(min(max(c2, 0), DOMAIN_W - 1))
        feats.append({
            "type": "Feature",
            "properties": {
                "order": int(max(order_np[r2, c2], 1)),
                "upstream_km2": round(float(acc_np[rr, c] * CELL_KM2), 1),
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        })
    with open(os.path.join(PROC, "drainage_utm.geojson"), "w") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f)

    # 5. slope (from original DEM, not conditioned) ---------------------------
    gy, gx = np.gradient(dem.astype("float64"), CELL)
    slope_rad = np.arctan(np.hypot(gx, gy))
    write("slope", np.degrees(slope_rad))

    # 6. HAND ---------------------------------------------------------------
    hand = grid.compute_hand(fdir, inflated, streams, dirmap=DIRMAP)
    hand_np = np.asarray(hand, dtype="float64")
    hand_np[~np.isfinite(hand_np)] = np.nan
    hand_np = np.clip(hand_np, 0, None)
    write("hand", hand_np)

    # 7. Euclidean distance to drainage (metres) ------------------------------
    dist = ndimage.distance_transform_edt(~streams_np) * CELL
    write("dist_drainage", dist)

    # 8. TWI ----------------------------------------------------------------
    a = (acc_np + 1.0) * CELL  # specific catchment area (m^2 per m contour width)
    tanb = np.maximum(np.tan(slope_rad), 0.001)
    twi = np.log(a / tanb)
    write("twi", twi)

    log_step("terrain", dem_source="Copernicus DEM GLO-90 (DSM), 9 tiles N06-N08 E002-E004",
             crs="EPSG:32631", cell_m=CELL, grid=[DOMAIN_W, DOMAIN_H],
             conditioning="fill_pits -> fill_depressions -> resolve_flats (pysheds)",
             flow_model="D8", stream_threshold_km2=STREAM_KM2, stream_threshold_cells=STREAM_CELLS,
             hand_reference="D8 flow path to nearest channel cell",
             twi="ln((acc+1)*cell / max(tan(slope),0.001))",
             n_channel_segments=len(feats))


if __name__ == "__main__":
    main()
