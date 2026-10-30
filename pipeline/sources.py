"""
Source adapters for the live price feed.

Every source must produce the same row shape, so the publisher and the API
never need to know where a price came from:

    {"district": str,   # one of Rwanda's 30 districts, post MARKET_FIX
     "crop": str,       # our crop id: maize, beans, ...
     "price": float,    # RWF per kg, retail
     "ym": "YYYY-MM",   # month the price was observed
     "market": str,     # market the price was measured in
     "source": str}     # "wfp" | "esoko"

Two sources exist:

  wfp    the WFP/HDX extract already in this repo (prices_raw.csv). This is
         what runs today; it is monthly and lags by a few months.
  esoko  an eSoko export (CSV/JSON file or API payload), enabled the day an
         agreement is signed. See docs/REALTIME_DATA.md for the contract we
         ask for. Same cleaning rules, same district fixes.

Stdlib only, like the rest of the pipeline. Nothing here writes anywhere:
publishing is live.py's job, after validation.
"""

import csv
import io
import json
import os
import statistics
import urllib.request

import build  # noqa: E402  (same directory; run as a script, not a package)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# source name as it appears in the WFP extract -> our crop id
CROP_BY_SOURCE = {c["source"]: c["id"] for c in build.CROPS}

# Tolerant aliases for an eSoko export, which names commodities its own way.
# Matching is done on a normalised string, so "Beans (dry)", "beans dry" and
# "BEANS" all resolve. Anything unmatched is dropped and reported, never
# guessed — a mistyped commodity must not silently become another crop.
#
# Deliberately absent: bare "Rice" (local or imported? we cannot tell), bare
# "Cassava" (fresh root is not cassava flour — different price level) and bare
# "Potatoes" (Irish or sweet?). If a real eSoko export shows us they use those
# names, add them here with evidence, and only then.
CROP_ALIASES = {
    "maize": "maize",
    "corn": "maize",
    "beans": "beans",
    "beans dry": "beans",
    "dry beans": "beans",
    "rice local": "rice_local",
    "local rice": "rice_local",
    "irish potatoes": "potatoes",
    "irish potato": "potatoes",
    "sorghum": "sorghum",
    "cassava flour": "cassava_flour",
}


class SourceError(Exception):
    """The source could not be read at all (missing file, bad HTTP, no rows)."""


def _norm(s):
    return " ".join(str(s or "").lower().replace("(", "").replace(")", "").split())


def crop_id_for(name, allow_alias=True):
    """Map a commodity name from a source to our crop id, or None.

    allow_alias=False is exact-match only. load_wfp() uses that mode: the live
    feed must cover exactly the commodities the model was built on, so the
    price a farmer sees and the price the forecast was fitted to can never be
    two different things."""
    if not name:
        return None
    if name in CROP_BY_SOURCE:
        return CROP_BY_SOURCE[name]
    if allow_alias:
        return CROP_ALIASES.get(_norm(name))
    return None


def resolve_district(market, admin2):
    """Apply the same district corrections build.py uses, so the live feed and
    the model can never disagree about which district a market is in."""
    fix = build.MARKET_FIX.get(market)
    if fix:
        return fix[0]
    return admin2


def _latest_ym(bucket):
    """bucket: {(district, crop, ym): [(market, price), ...]}
    -> one row per (district, crop), taking the most recent month.

    The price is the median across every market in that district for that
    month — the identical pooling build.py uses for its district series, so
    the feed and the model always describe the same number. The median, not
    the mean, for the same reason build.py uses it: one bad entry in a market
    report should not move the number the farmer acts on.

    `market` names the market with the most rows that month (a representative,
    as build.py names a "lead market"), and `markets` records how many markets
    actually contributed, so the UI can say "3 markets" instead of attributing
    a district median to one arbitrary market."""
    best = {}
    for (district, crop, ym), entries in bucket.items():
        key = (district, crop)
        if key not in best or ym > best[key][0]:
            best[key] = (ym, entries)
    rows = []
    for (district, crop), (ym, entries) in sorted(best.items()):
        prices = [p for _, p in entries]
        counts = {}
        for market, _ in entries:
            if market:
                counts[market] = counts.get(market, 0) + 1
        dominant = max(counts, key=counts.get) if counts else None
        rows.append(
            {
                "district": district,
                "crop": crop,
                "price": round(statistics.median(prices), 1),
                "ym": f"{ym[0]:04d}-{ym[1]:02d}",
                "market": dominant,
                "markets": len(counts),
                "source": "wfp",
            }
        )
    return rows


def load_wfp(path=None):
    """Latest price per (district, crop) from the WFP extract in the repo.

    Reuses build.load_rows(), so all the cleaning — retail only, RWF/kg,
    positive prices, post-2014 — is the identical code path the model used."""
    path = path or os.path.join(ROOT, "prices_raw.csv")
    if not os.path.exists(path):
        raise SourceError(f"missing {path} — run: python pipeline/fetch_data.py")

    bucket = {}
    for r in build.load_rows():
        crop = crop_id_for(r["commodity"], allow_alias=False)
        if not crop:
            continue
        district = resolve_district(r["market"], r["admin2"])
        if district not in build.ALL_DISTRICTS:
            continue
        key = (district, crop, (r["_y"], r["_m"]))
        bucket.setdefault(key, []).append((r["market"], r["_p"]))

    rows = _latest_ym(bucket)
    for row in rows:
        row["source"] = "wfp"
    return rows


def load_esoko(path):
    """Latest price per (district, crop) from an eSoko export.

    Accepts CSV or JSON. Expected fields (the contract we ask eSoko for is in
    docs/REALTIME_DATA.md):

        date       "YYYY-MM-DD" or "YYYY-MM"  when the price was observed
        market     market name
        admin2     district name              (optional if market is known)
        commodity  crop name
        price      numeric, RWF/kg
        unit       "KG"                        (optional)
        currency   "RWF"                       (optional)

    Anything that fails the contract is dropped and counted, not guessed."""
    if not path or not os.path.exists(path):
        raise SourceError(
            "esoko export not found — set SOKO_ESOKO_PATH. "
            "Until an agreement is signed there is no file to read."
        )

    with open(path, encoding="utf-8-sig") as fh:
        text = fh.read()
    stripped = text.lstrip()
    if stripped[:1] in "[{":
        records = json.loads(text)
        if isinstance(records, dict):
            records = records.get("prices") or records.get("data") or []
    else:
        records = list(csv.DictReader(io.StringIO(text)))

    dropped = {"bad_price": 0, "bad_date": 0, "unknown_crop": 0, "unknown_district": 0}
    bucket = {}
    for rec in records:
        try:
            price = float(rec.get("price"))
        except (TypeError, ValueError):
            dropped["bad_price"] += 1
            continue
        if price <= 0:
            dropped["bad_price"] += 1
            continue

        raw_date = str(rec.get("date") or rec.get("ym") or "")
        y, m = _parse_ym(raw_date)
        if y is None:
            dropped["bad_date"] += 1
            continue

        crop = crop_id_for(rec.get("commodity") or rec.get("crop"))
        if not crop:
            dropped["unknown_crop"] += 1
            continue

        market = str(rec.get("market") or "")
        district = resolve_district(market, rec.get("admin2") or rec.get("district") or "")
        if district not in build.ALL_DISTRICTS:
            dropped["unknown_district"] += 1
            continue

        unit = str(rec.get("unit") or "KG").upper()
        if unit not in ("KG", "KGS", "KILOGRAM"):
            continue  # a 25kg basket price must not become a kg price
        currency = str(rec.get("currency") or "RWF").upper()
        if currency != "RWF":
            continue

        bucket.setdefault((district, crop, (y, m)), []).append((market, price))

    rows = _latest_ym(bucket)
    for row in rows:
        row["source"] = "esoko"
    if not rows:
        raise SourceError(f"esoko export produced no usable rows: {dropped}")
    return rows, dropped


def _parse_ym(s):
    s = str(s or "").strip()
    if len(s) >= 7 and s[4] == "-":
        try:
            return int(s[:4]), int(s[5:7])
        except ValueError:
            return None, None
    if len(s) == 4 and s.isdigit():
        return int(s), 1
    return None, None


def load(source):
    """Dispatch on the requested source. Returns (rows, info)."""
    if source == "wfp":
        return load_wfp(), {}
    if source == "esoko":
        path = os.environ.get("SOKO_ESOKO_PATH")
        rows, dropped = load_esoko(path)
        return rows, {"dropped": dropped}
    raise SourceError(f"unknown source: {source}")
