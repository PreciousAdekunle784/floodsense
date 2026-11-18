"""
FloodSense GIS pipeline — Stage 1: data acquisition.

Downloads open datasets for Ogun State into pipeline/data/raw.
Every source is public and requires no API key.

  * geoBoundaries gbOpen NGA ADM1 / ADM2 (state + LGA boundaries)
  * Copernicus DEM GLO-90 and GLO-30 (AWS Open Data, COG)
  * ESA WorldCover 2021 v200 10 m land cover (AWS Open Data, COG) - read later as windows
  * JRC Global Surface Water v1.4 occurrence (Google Cloud public bucket) - read later as windows
  * NASA POWER / GPM IMERG precipitation climatology (AWS Open Data, Zarr)
  * GeoNames populated places (>1000 pop) via a public GitHub mirror
  * Natural Earth 10 m river centrelines (river names)

Run:  python 01_acquire.py
"""
import json
import os
import sys
import urllib.request

RAW = os.path.join(os.path.dirname(__file__), "data", "raw")
os.makedirs(RAW, exist_ok=True)

GB = "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/NGA/{L}/geoBoundaries-NGA-{L}.geojson"
COP90 = "https://copernicus-dem-90m.s3.amazonaws.com/Copernicus_DSM_COG_30_{lat}_00_{lon}_00_DEM/Copernicus_DSM_COG_30_{lat}_00_{lon}_00_DEM.tif"
COP30 = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM/Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM.tif"

# Hydrological domain: Ogun State plus upstream catchments of the Ogun, Yewa and
# Osun rivers that drain into the state from Oyo/Osun states.
HYDRO_LATS = [6, 7, 8]
HYDRO_LONS = [2, 3, 4]
# Visual (hillshade) domain: Ogun State only
VIS_LATS = [6, 7]
VIS_LONS = [2, 3, 4]


def fetch(url, dest, min_bytes=1000):
    if os.path.exists(dest) and os.path.getsize(dest) > min_bytes:
        print("  cached", os.path.basename(dest))
        return True
    print("  GET", url)
    try:
        with urllib.request.urlopen(url, timeout=300) as r, open(dest + ".part", "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
        os.replace(dest + ".part", dest)
        return True
    except Exception as e:  # tile may not exist (ocean) or host unreachable
        print("   !", e)
        if os.path.exists(dest + ".part"):
            os.remove(dest + ".part")
        return False


def main():
    manifest = {"sources": []}
    print("geoBoundaries")
    for L in ("ADM1", "ADM2"):
        fetch(GB.format(L=L), os.path.join(RAW, f"NGA_{L}.geojson"))

    print("Copernicus DEM GLO-90 (hydrological domain)")
    os.makedirs(os.path.join(RAW, "cop90"), exist_ok=True)
    for la in HYDRO_LATS:
        for lo in HYDRO_LONS:
            lat, lon = f"N{la:02d}", f"E{lo:03d}"
            fetch(COP90.format(lat=lat, lon=lon), os.path.join(RAW, "cop90", f"{lat}{lon}.tif"))

    print("Copernicus DEM GLO-30 (visual hillshade domain)")
    os.makedirs(os.path.join(RAW, "cop30"), exist_ok=True)
    for la in VIS_LATS:
        for lo in VIS_LONS:
            lat, lon = f"N{la:02d}", f"E{lo:03d}"
            fetch(COP30.format(lat=lat, lon=lon), os.path.join(RAW, "cop30", f"{lat}{lon}.tif"))

    print("GeoNames places + Natural Earth rivers")
    fetch("https://raw.githubusercontent.com/lutangar/cities.json/master/cities.json",
          os.path.join(RAW, "cities_geonames.json"))
    fetch("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson",
          os.path.join(RAW, "ne_10m_rivers.geojson"))
    print("done. WorldCover, JRC GSW and IMERG are streamed (windowed reads) in later stages.")


if __name__ == "__main__":
    sys.exit(main())
