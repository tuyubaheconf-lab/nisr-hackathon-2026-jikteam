"""
Reduce the NISR-sourced ADM2 boundaries to something a phone can load.

6.3 MB of full-precision GeoJSON becomes ~150 KB by rounding coordinates to
~50 m and dropping points that sit on a straight line between their neighbours.
District names are aligned with the WFP admin2 labels used by the price data.
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "rwa_adm2.geojson")
OUT = os.path.join(ROOT, "web", "src", "assets", "rwa-districts.json")

# geoBoundaries spells a few districts differently from WFP's admin2 column
ALIAS = {
    "Nyarugenge": "Nyarugenge",
    "Gasabo": "Gasabo",
    "Kicukiro": "Kicukiro",
}


def simplify_ring(ring, tol=0.0):
    """Keep ring endpoints, drop vertices that add no shape."""
    if len(ring) < 4:
        return ring
    out = [ring[0]]
    for i in range(1, len(ring) - 1):
        x0, y0 = out[-1]
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        # distance of the point from the line between its neighbours
        area = abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0))
        if area > tol:
            out.append(ring[i])
    out.append(ring[-1])
    return out


def round_coords(ring, nd=3):
    seen, out = None, []
    for pt in ring:
        p = [round(pt[0], nd), round(pt[1], nd)]
        if p != seen:
            out.append(p)
            seen = p
    if len(out) > 1 and out[0] != out[-1]:
        out.append(out[0])
    return out


def main():
    with open(SRC, encoding="utf-8") as fh:
        data = json.load(fh)
    feats = []
    for f in data["features"]:
        name = f["properties"].get("shapeName") or f["properties"].get("shapeISO")
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        clean = []
        for poly in polys:
            rings = []
            for ring in poly:
                r = simplify_ring(round_coords(ring), tol=1e-7)
                if len(r) >= 4:
                    rings.append(r)
            if rings:
                clean.append(rings)
        feats.append({
            "type": "Feature",
            "properties": {"name": ALIAS.get(name, name)},
            "geometry": {"type": "MultiPolygon", "coordinates": clean},
        })
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": feats}, fh,
                  separators=(",", ":"))
    kb = os.path.getsize(OUT) / 1024
    print(f"{len(feats)} districts -> {OUT} ({kb:.0f} KB)")
    print(sorted(f["properties"]["name"] for f in feats))


if __name__ == "__main__":
    main()
