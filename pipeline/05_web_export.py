"""
FloodSense GIS pipeline — Stage 5: export for the web application (public/data).

  * grid.bin + grid.json  : multi-layer raster on a Web Mercator (EPSG:3857) grid, 150 m.
        uint8 layers  : lga, m_hand, m_dist, m_slope, m_twi, m_rain, m_lulc, cls, ref, lc, builtup
        uint16 layers : elev (m + 100), hand (dm), dist (m), slope (centi-deg), twi (x100), rain (mm)
    The browser recomputes the weighted overlay from the m_* membership layers, so users
    can change AHP weights and see the result instantly.
  * lgas.geojson, state.geojson, mask.geojson, drainage.geojson, places.geojson
  * dem/{z}/{x}/{y}.png   : Terrarium-encoded Copernicus GLO-30 elevation tiles (z5-z12)
  * model.json, processing_log.json
"""
import gzip
import json
import math
import os

import geopandas as gpd
import numpy as np
import rasterio
from PIL import Image
from rasterio.merge import merge
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

from common import ANALYSIS_CRS, DOMAIN_TRANSFORM, PROC, RAW, WEB, read

WEB_CELL = 150.0
R = 6378137.0


def merc(lon, lat):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def round_coords(geom, nd=5):
    def rc(c):
        if isinstance(c[0], (float, int)):
            return [round(c[0], nd), round(c[1], nd)]
        return [rc(x) for x in c]
    g = mapping(geom)
    return {"type": g["type"], "coordinates": rc(g["coordinates"])}


def write_fc(path, feats):
    with open(path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, separators=(",", ":"))


def main():
    os.makedirs(WEB, exist_ok=True)
    lgas = gpd.read_file(os.path.join(PROC, "lgas.geojson"))
    adm1 = gpd.read_file(os.path.join(RAW, "NGA_ADM1.geojson"))
    ogun = adm1[adm1.shapeName == "Ogun"]
    model = json.load(open(os.path.join(PROC, "model_results.json")))
    lga_stats = {l["lga_id"]: l for l in model["lgas"]}

    # ---- web grid ------------------------------------------------------------
    lon0, lat0, lon1, lat1 = ogun.total_bounds
    pad = 0.02
    x0, y0 = merc(lon0 - pad, lat0 - pad)
    x1, y1 = merc(lon1 + pad, lat1 + pad)
    W = int(math.ceil((x1 - x0) / WEB_CELL))
    H = int(math.ceil((y1 - y0) / WEB_CELL))
    wtr = from_origin(x0, y1, WEB_CELL, WEB_CELL)
    print("web grid", W, H, W * H)

    def to_web(arr, nearest=False, nodata=np.nan):
        out = np.full((H, W), nodata, dtype="float32")
        reproject(arr.astype("float32"), out, src_transform=DOMAIN_TRANSFORM, src_crs=ANALYSIS_CRS,
                  dst_transform=wtr, dst_crs="EPSG:3857",
                  resampling=Resampling.nearest if nearest else Resampling.bilinear,
                  src_nodata=nodata, dst_nodata=nodata)
        return out

    lga = to_web(np.nan_to_num(read("lga_id"), nan=0), nearest=True, nodata=0)
    inside = lga > 0
    cls = to_web(np.nan_to_num(read("susc_class"), nan=0), nearest=True, nodata=0)
    lc = to_web(np.nan_to_num(read("landcover"), nan=0), nearest=True, nodata=0)
    occ = read("gsw_occurrence")
    ever = read("gsw_ever_frac")
    ref90 = np.zeros_like(occ)
    ref90[np.nan_to_num(ever) >= 0.2] = 1
    ref90[(np.nan_to_num(occ) >= 75)] = 2
    ref = to_web(ref90, nearest=True, nodata=0)

    raw = {k: read(n) for k, n in (("hand", "hand"), ("dist", "dist_drainage"), ("slope", "slope"),
                                    ("twi", "twi"), ("rain", "rain_annual"), ("elev", "dem"),
                                    ("builtup", "builtup_frac"))}
    web_raw = {k: to_web(np.nan_to_num(v, nan=0)) for k, v in raw.items()}

    # memberships computed on the web grid from the same knots as stage 4
    facs = {f["key"]: f for f in model["factors"]}
    mem = {}
    for k in ("hand", "dist", "slope", "twi", "rain"):
        xs, ys = zip(*facs[k]["knots"])
        mem[k] = np.interp(web_raw[k], xs, ys)
    lut = np.zeros(256)
    for c, v in model["lulc_classes"].items():
        lut[int(c)] = v["membership"]
    lut[0] = 0.5
    mem["lulc"] = lut[lc.astype(int)]

    def u8(a):
        return np.clip(np.round(a), 0, 255).astype("uint8")

    def u16(a):
        return np.clip(np.round(a), 0, 65535).astype("uint16")

    valid = inside & (cls >= 1) & (cls <= 5)
    layers8 = {
        "lga": u8(lga),
        "m_hand": u8(np.where(valid, mem["hand"] * 255, 0)),
        "m_dist": u8(np.where(valid, mem["dist"] * 255, 0)),
        "m_slope": u8(np.where(valid, mem["slope"] * 255, 0)),
        "m_twi": u8(np.where(valid, mem["twi"] * 255, 0)),
        "m_rain": u8(np.where(valid, mem["rain"] * 255, 0)),
        "m_lulc": u8(np.where(valid, mem["lulc"] * 255, 0)),
        "cls": u8(np.where(inside, cls, 0)),
        "ref": u8(np.where(inside, ref, 0)),
        "lc": u8(np.where(inside, lc, 0)),
        "builtup": u8(np.where(inside, web_raw["builtup"] * 100, 0)),
    }
    layers16 = {
        "elev": u16(np.where(inside, web_raw["elev"] + 100, 0)),
        "hand": u16(np.where(inside, web_raw["hand"] * 10, 0)),
        "dist": u16(np.where(inside, web_raw["dist"], 0)),
        "slope": u16(np.where(inside, web_raw["slope"] * 100, 0)),
        "twi": u16(np.where(inside, web_raw["twi"] * 100, 0)),
        "rain": u16(np.where(inside, web_raw["rain"], 0)),
    }
    # two bundles: "core" (uint8, needed to render + recompute the model) and
    # "detail" (uint16 raw values for point inspection, loaded lazily). Stored gzip-compressed.
    index = []
    sizes = {}
    for bundle, layers in (("core", layers8), ("detail", layers16)):
        buf = bytearray()
        for name, a in layers.items():
            index.append({"name": name, "bundle": bundle, "type": str(a.dtype), "offset": len(buf)})
            buf += a.astype("<u2").tobytes() if a.dtype == np.uint16 else a.tobytes()
        gz = gzip.compress(bytes(buf), 9)
        with open(os.path.join(WEB, f"grid-{bundle}.bin.gz"), "wb") as f:
            f.write(gz)
        sizes[bundle] = len(gz)
        print(f"grid-{bundle}", round(len(buf) / 1e6, 1), "MB raw,", round(len(gz) / 1e6, 2), "MB gzip")
    for old in ("grid.bin",):
        if os.path.exists(os.path.join(WEB, old)):
            os.remove(os.path.join(WEB, old))
    with open(os.path.join(WEB, "grid.json"), "w") as f:
        json.dump({
            "crs": "EPSG:3857", "cell_m": WEB_CELL, "width": W, "height": H,
            "origin": [x0, y1], "bounds_merc": [x0, y0, x0 + W * WEB_CELL, y1 - H * WEB_CELL],
            "layers": index, "bundle_bytes_gz": sizes,
            "encoding": {"m_*": "membership x255", "elev": "metres + 100", "hand": "decimetres",
                         "dist": "metres", "slope": "degrees x100", "twi": "x100", "rain": "mm/yr",
                         "builtup": "percent of cell", "ref": "0 none, 1 observed intermittent water, 2 permanent water",
                         "cls": "1-5 susceptibility class, 6 permanent water"},
        }, f, indent=1)

    # ---- vectors ------------------------------------------------------------------
    feats = []
    for _, r in lgas.iterrows():
        s = lga_stats[int(r.lga_id)]
        g = r.geometry.simplify(0.0004, preserve_topology=True)
        feats.append({"type": "Feature", "id": int(r.lga_id),
                      "properties": {"lga_id": int(r.lga_id), "name": r.shapeName,
                                     "label": [round(r.geometry.representative_point().x, 4), round(r.geometry.representative_point().y, 4)],
                                     "high_pct": s["high_or_very_high_pct"], "area_km2": s["area_km2"]},
                      "geometry": round_coords(g)})
    write_fc(os.path.join(WEB, "lgas.geojson"), feats)
    og = unary_union(ogun.geometry).simplify(0.0003)
    write_fc(os.path.join(WEB, "state.geojson"),
             [{"type": "Feature", "properties": {"name": "Ogun State"}, "geometry": round_coords(og)}])
    world = box(-20, -10, 30, 25)
    write_fc(os.path.join(WEB, "mask.geojson"),
             [{"type": "Feature", "properties": {}, "geometry": round_coords(world.difference(og.buffer(0)), 4)}])

    # drainage network: clip to Ogun + 3 km, simplify, name Ogun River from Natural Earth
    dr = gpd.read_file(os.path.join(PROC, "drainage_utm.geojson")).set_crs(ANALYSIS_CRS, allow_override=True)
    og_utm = gpd.GeoSeries([og], crs=4326).to_crs(ANALYSIS_CRS).iloc[0].buffer(3000)
    dr = dr[dr.intersects(og_utm)].copy()
    dr["geometry"] = dr.geometry.intersection(og_utm).simplify(45)
    dr = dr[~dr.geometry.is_empty]
    ne = gpd.read_file(os.path.join(RAW, "ne_10m_rivers.geojson"))
    ne_ogun = ne[ne["name"] == "Ogun"].to_crs(ANALYSIS_CRS)
    ne_buf = unary_union(ne_ogun.geometry).buffer(2500)
    dr["name"] = None
    big = dr["upstream_km2"] >= 1000
    near = dr.geometry.apply(lambda g: g.intersection(ne_buf).length / max(g.length, 1) > 0.6)
    dr.loc[big & near, "name"] = "Ogun River"
    dr = dr.to_crs(4326)
    feats = []
    for _, r in dr.iterrows():
        geoms = [r.geometry] if r.geometry.geom_type == "LineString" else list(getattr(r.geometry, "geoms", []))
        for g in geoms:
            if g.geom_type != "LineString" or g.length == 0:
                continue
            p = {"order": int(r["order"]), "upstream_km2": float(r["upstream_km2"])}
            if r["name"]:
                p["name"] = r["name"]
            feats.append({"type": "Feature", "properties": p, "geometry": round_coords(g, 5)})
    write_fc(os.path.join(WEB, "drainage.geojson"), feats)
    print("drainage features", len(feats), "named", int((dr["name"] == "Ogun River").sum()))

    # places (GeoNames, pop > 1000) inside Ogun State
    cities = json.load(open(os.path.join(RAW, "cities_geonames.json")))
    pts = gpd.GeoDataFrame(
        [{"name": c["name"]} for c in cities if c["country"] == "NG"],
        geometry=gpd.points_from_xy([float(c["lng"]) for c in cities if c["country"] == "NG"],
                                    [float(c["lat"]) for c in cities if c["country"] == "NG"]), crs=4326)
    pts = gpd.sjoin(pts, lgas[["lga_id", "shapeName", "geometry"]], predicate="within")
    feats = []
    seen = set()
    for _, r in pts.iterrows():
        key = (r["name"], round(r.geometry.x, 2), round(r.geometry.y, 2))
        if key in seen or r["name"].lower().startswith("river"):
            continue
        seen.add(key)
        feats.append({"type": "Feature", "properties": {"name": r["name"], "lga": r["shapeName"], "lga_id": int(r["lga_id"])},
                      "geometry": {"type": "Point", "coordinates": [round(r.geometry.x, 5), round(r.geometry.y, 5)]}})
    write_fc(os.path.join(WEB, "places.geojson"), feats)
    print("places", len(feats))

    # ---- model + log -------------------------------------------------------------
    with open(os.path.join(WEB, "model.json"), "w") as f:
        json.dump(model, f, separators=(",", ":"))
    with open(os.path.join(PROC, "processing_log.json")) as f:
        log = json.load(f)
    with open(os.path.join(WEB, "processing_log.json"), "w") as f:
        json.dump(log, f, indent=1)

    if os.environ.get("SKIP_TILES") != "1":
        dem_tiles(ogun)


def tile_bounds(z, x, y):
    n = 2 ** z
    size = 2 * math.pi * R / n
    minx = -math.pi * R + x * size
    maxy = math.pi * R - y * size
    return minx, maxy - size, minx + size, maxy


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def dem_tiles(ogun, zmin=5, zmax=12):
    """Terrarium-encoded elevation tiles from Copernicus GLO-30 for MapLibre raster-dem."""
    import glob
    srcs = [rasterio.open(p) for p in sorted(glob.glob(os.path.join(RAW, "cop30", "*.tif")))]
    mosaic, mtr = merge(srcs)
    crs = srcs[0].crs
    for s in srcs:
        s.close()
    dem = mosaic[0].astype("float32")
    lon0, lat0, lon1, lat1 = ogun.total_bounds
    out_dir = os.path.join(WEB, "dem")
    count = 0
    total = 0
    for z in range(zmin, zmax + 1):
        pad = 0.05 if z >= 11 else 0.4
        xa, ya = lonlat_to_tile(lon0 - pad, lat1 + pad, z)
        xb, yb = lonlat_to_tile(lon1 + pad, lat0 - pad, z)
        for x in range(xa, xb + 1):
            for y in range(ya, yb + 1):
                b = tile_bounds(z, x, y)
                tr = from_origin(b[0], b[3], (b[2] - b[0]) / 256, (b[3] - b[1]) / 256)
                out = np.full((256, 256), np.nan, dtype="float32")
                reproject(dem, out, src_transform=mtr, src_crs=crs, dst_transform=tr, dst_crs="EPSG:3857",
                          resampling=Resampling.bilinear if z >= 10 else Resampling.average,
                          src_nodata=None, dst_nodata=np.nan)
                if np.isnan(out).all():
                    continue
                out = np.nan_to_num(out, nan=0.0)
                # quantise to 0.5 m: improves PNG compression, far below DEM vertical accuracy
                v = np.round(out * 2) / 2 + 32768.0
                rch = np.floor(v / 256)
                gch = np.floor(v - rch * 256)
                bch = np.floor((v - np.floor(v)) * 256)
                rgb = np.dstack([rch, gch, bch]).astype("uint8")
                d = os.path.join(out_dir, str(z), str(x))
                os.makedirs(d, exist_ok=True)
                p = os.path.join(d, f"{y}.png")
                Image.fromarray(rgb, "RGB").save(p, optimize=True)
                count += 1
                total += os.path.getsize(p)
    print("dem tiles", count, round(total / 1e6, 1), "MB")


if __name__ == "__main__":
    main()
