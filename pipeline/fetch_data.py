"""
Download the two public datasets the pipeline needs.

They are not committed to the repository (20 MB of CSV), so run this once
before `python pipeline/build.py`.

    python pipeline/fetch_data.py
"""

import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

FILES = [
    (
        "prices_raw.csv",
        "https://data.humdata.org/dataset/a4a84c1c-81d1-491b-9fbe-1955ae736508/"
        "resource/8c22eeb5-cc2e-46bc-8a0d-08b7486b2486/download/wfp_food_prices_rwa.csv",
    ),
    (
        "markets_raw.csv",
        "https://data.humdata.org/dataset/a4a84c1c-81d1-491b-9fbe-1955ae736508/"
        "resource/31d038ef-416e-4c66-906f-54de20794918/download/wfp_markets_rwa.csv",
    ),
    (
        "rwa_adm2.geojson",
        "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/"
        "gbOpen/RWA/ADM2/geoBoundaries-RWA-ADM2.geojson",
    ),
]


def download(name, url):
    dest = os.path.join(ROOT, name)
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        print(f"  {name} already present ({os.path.getsize(dest):,} bytes)")
        return
    print(f"  downloading {name} ...")
    try:
        with urllib.request.urlopen(url, timeout=120) as resp, open(dest, "wb") as fh:
            fh.write(resp.read())
    except Exception as exc:  # noqa: BLE001
        print(f"  FAILED {name}: {exc}")
        return
    print(f"  {name}: {os.path.getsize(dest):,} bytes")


if __name__ == "__main__":
    print("Fetching public data (WFP VAM via HDX, geoBoundaries/NISR):")
    for name, url in FILES:
        download(name, url)
    missing = [n for n, _ in FILES if not os.path.exists(os.path.join(ROOT, n))]
    if missing:
        sys.exit(f"Missing: {', '.join(missing)}")
    print("Done. Now run: python pipeline/build.py")
