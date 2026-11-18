"""
FloodSense GIS pipeline — Stage 3: environmental factors on the analysis grid.

  * ESA WorldCover 2021 v200 (10 m) -> dominant class + built-up fraction at 90 m
  * JRC Global Surface Water v1.4 occurrence (Landsat 1984-2021, 30 m)
      -> mean occurrence and 'ever-observed-water' fraction at 90 m (validation reference)
  * GPM IMERG precipitation climatology 2001-2020 (0.1 deg, NASA POWER v10)
      -> mean annual rainfall (mm/yr), bilinear to 90 m
  * GPM IMERG monthly series (state mean) -> rainfall_monthly.json

All rasters are harmonised to EPSG:32631, 90 m (same grid as stage 2).
"""
import json
import os

import fsspec
import numpy as np
import rasterio
import xarray as xr
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

from common import ANALYSIS_CRS, DOMAIN_H, DOMAIN_TRANSFORM, DOMAIN_W, PROC, log_step, write

WC = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif"
GSW = "https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/occurrence_0E_10Nv1_4_2021.tif"
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "5")
os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")

# lon/lat window of the analysis domain (+ margin)
LON0, LON1, LAT0, LAT1 = 2.45, 5.05, 5.95, 9.05


def read_window(url, lon0, lon1, lat0, lat1, overview_level=None):
    kw = {} if overview_level is None else {"overview_level": overview_level}
    with rasterio.open("/vsicurl/" + url, **kw) as src:
        win = rasterio.windows.from_bounds(lon0, lat0, lon1, lat1, src.transform)
        win = win.round_offsets().round_lengths()
        win = win.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
        arr = src.read(1, window=win)
        tr = src.window_transform(win)
        return arr, tr, src.crs


def landcover():
    lc = np.zeros((DOMAIN_H, DOMAIN_W), dtype="uint8")
    built = np.zeros((DOMAIN_H, DOMAIN_W), dtype="float32")
    for tile, (lo0, lo1) in (("N06E000", (LON0, 3.0)), ("N06E003", (3.0, LON1))):
        # overview level 1 = 40 m: adequate for a 90 m dominant-class aggregation
        arr, tr, crs = read_window(WC.format(t=tile), lo0, lo1, LAT0, LAT1, overview_level=1)
        print("  worldcover", tile, arr.shape)
        tmp = np.zeros_like(lc)
        reproject(arr, tmp, src_transform=tr, src_crs=crs, dst_transform=DOMAIN_TRANSFORM,
                  dst_crs=ANALYSIS_CRS, resampling=Resampling.mode, src_nodata=0, dst_nodata=0)
        lc = np.where(tmp > 0, tmp, lc)
        b = np.zeros_like(built)
        reproject((arr == 50).astype("float32"), b, src_transform=tr, src_crs=crs,
                  dst_transform=DOMAIN_TRANSFORM, dst_crs=ANALYSIS_CRS,
                  resampling=Resampling.average, src_nodata=None, dst_nodata=-1)
        built = np.where(b >= 0, np.maximum(built, b), built)
    write("landcover", lc, dtype="uint8", nodata=0)
    write("builtup_frac", built)
    classes, counts = np.unique(lc, return_counts=True)
    return {int(c): int(n) for c, n in zip(classes, counts)}


def surface_water():
    # only needed over Ogun State (validation), keep the read small
    arr, tr, crs = read_window(GSW, 2.6, 4.75, 6.2, 8.05)
    print("  gsw", arr.shape)
    arr = arr.astype("float32")
    arr[arr > 100] = np.nan  # 255 = no data
    occ = np.full((DOMAIN_H, DOMAIN_W), np.nan, dtype="float32")
    reproject(arr, occ, src_transform=tr, src_crs=crs, dst_transform=DOMAIN_TRANSFORM,
              dst_crs=ANALYSIS_CRS, resampling=Resampling.average, src_nodata=np.nan, dst_nodata=np.nan)
    ever = np.full((DOMAIN_H, DOMAIN_W), np.nan, dtype="float32")
    reproject((arr > 0).astype("float32"), ever, src_transform=tr, src_crs=crs,
              dst_transform=DOMAIN_TRANSFORM, dst_crs=ANALYSIS_CRS,
              resampling=Resampling.average, src_nodata=None, dst_nodata=np.nan)
    write("gsw_occurrence", np.nan_to_num(occ, nan=-9999))
    write("gsw_ever_frac", np.nan_to_num(ever, nan=-9999))


def rainfall():
    clim = xr.open_zarr(fsspec.get_mapper(
        "s3://nasa-power/imerg/spatial/power_imerg_climatology_spatial_utc.zarr", anon=True)).IMERG_PRECTOT
    sub = clim.sel(lat=slice(LAT0 - 0.2, LAT1 + 0.2), lon=slice(LON0 - 0.2, LON1 + 0.2)).load()
    lats, lons = sub.lat.values, sub.lon.values
    monthly_clim = sub.isel(time=slice(0, 12)).values  # mm/day per calendar month
    annual = sub.isel(time=12).values * 365.25  # mm/yr
    # north-up array + transform (cell centres -> edges)
    res = float(lons[1] - lons[0])
    arr = annual[::-1, :].astype("float32")
    tr = from_origin(lons[0] - res / 2, lats[-1] + res / 2, res, res)
    out = np.zeros((DOMAIN_H, DOMAIN_W), dtype="float32")
    reproject(arr, out, src_transform=tr, src_crs="EPSG:4326", dst_transform=DOMAIN_TRANSFORM,
              dst_crs=ANALYSIS_CRS, resampling=Resampling.bilinear)
    write("rain_annual", out)

    # monthly climatology on the same native grid (for LGA zonal stats later)
    mc = monthly_clim[:, ::-1, :].astype("float32")
    with rasterio.open(os.path.join(PROC, "rain_monthly_clim_native.tif"), "w", driver="GTiff",
                       width=mc.shape[2], height=mc.shape[1], count=12, dtype="float32",
                       crs="EPSG:4326", transform=tr) as dst:
        dst.write(mc)

    # monthly time series, Ogun State bounding box mean (zonal means are done in stage 4)
    ts = xr.open_zarr(fsspec.get_mapper(
        "s3://nasa-power/imerg/temporal/power_imerg_monthly_temporal_utc.zarr", anon=True)).IMERG_PRECTOT
    tsub = ts.sel(lat=slice(6.2, 8.0), lon=slice(2.65, 4.65)).load()
    tsub_arr = tsub.values  # time, lat, lon
    tr_ts = from_origin(float(tsub.lon.values[0]) - 0.05, float(tsub.lat.values[-1]) + 0.05, 0.1, 0.1)
    np.save(os.path.join(PROC, "rain_ts_cube.npy"), tsub_arr[:, ::-1, :])
    times = [str(t)[:10] for t in tsub.time.values]
    with open(os.path.join(PROC, "rain_ts_meta.json"), "w") as f:
        json.dump({"times": times, "transform": list(tr_ts)[:6], "shape": list(tsub_arr.shape)}, f)
    return float(np.nanmin(out)), float(np.nanmax(out))


def main():
    print("land cover")
    lc_counts = landcover()
    print("surface water")
    surface_water()
    print("rainfall")
    rmin, rmax = rainfall()
    log_step("factors",
             landcover="ESA WorldCover 2021 v200, read at 40 m overview, mode-resampled to 90 m",
             landcover_class_cells=lc_counts,
             surface_water="JRC Global Surface Water v1.4 occurrence 1984-2021, averaged to 90 m",
             rainfall="GPM IMERG (NASA POWER v10) climatology 2001-2020, 0.1 deg, bilinear to 90 m",
             rain_annual_range_mm=[rmin, rmax])


if __name__ == "__main__":
    main()
