#!/usr/bin/env bash
# Rebuild every FloodSense GIS layer from the original open datasets.
# Requires network access to AWS Open Data, Google Cloud public buckets and GitHub.
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv .venv 2>/dev/null || true
. .venv/bin/activate
pip install -q -r requirements.txt
python 01_acquire.py
python 02_terrain.py
python 03_factors.py
python 04_model.py
python 05_web_export.py
echo "Done. Web layers written to ../public/data"
