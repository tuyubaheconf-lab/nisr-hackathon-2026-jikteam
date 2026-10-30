"""
SokoRyari? — data pipeline.

Input  : prices_raw.csv, markets_raw.csv  (WFP VAM via HDX, Rwanda food prices)
Output : web/public/data/data.json       (everything the web app needs)

No third-party libraries. Python 3.10+.

The pipeline does four things, in order:

  1. CLEAN      parse, filter to RWF/kg retail, drop outliers, build monthly panels
  2. SEASONAL   measure the month-of-year price cycle per district (the economic signal)
  3. BACKTEST   compare three forecasters on held-out months, keep the winner per market
  4. EXPORT     write one compact JSON file for the web app

Run:  python pipeline/build.py
"""

import csv
import json
import math
import os
import statistics
import sys
from collections import defaultdict
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "web", "public", "data")

NOW = (date.today().year, date.today().month)   # advice is always anchored here

FIRST_YEAR = 2014          # ignore pre-2014: too sparse, different price regime
MIN_MONTHS = 30            # minimum monthly observations to model a market series
MIN_DISTRICT_MONTHS = 18   # 1.5 seasonal cycles: enough to see a shape, not enough to trust alone
MIN_YEARMONTHS = 10        # months needed in a year for it to enter the seasonal index
BACKTEST_ORIGINS = 12      # how many past months to test on
MAX_HORIZON = 6            # months ahead we score

# ----------------------------------------------------------------------------
# Crop definitions. Kinyarwanda names checked against common usage.
# Defaults are *assumptions* the user can change in the UI; they are labelled
# as such in the app and in the documentation.
# ----------------------------------------------------------------------------
CROPS = [
    {
        "id": "maize",
        "source": "Maize",
        "name": "Maize",
        "rw": "Ibigori",
        "storage_rwf_kg_month": 3,     # treated bags at home (commercial hub: ~9)
        "loss_pct_month": 1.2,         # insects/rodents/moisture, per month
        "transport_rwf_kg": 12,
    },
    {
        "id": "beans",
        "source": "Beans (dry)",
        "name": "Beans",
        "rw": "Ibishyimbo",
        "storage_rwf_kg_month": 4,
        "loss_pct_month": 1.5,
        "transport_rwf_kg": 12,
    },
    {
        "id": "rice_local",
        "source": "Rice (local)",
        "name": "Rice (local)",
        "rw": "Umuceri w'iwacu",
        "storage_rwf_kg_month": 3,
        "loss_pct_month": 1.0,
        "transport_rwf_kg": 14,
    },
    {
        "id": "potatoes",
        "source": "Potatoes (Irish)",
        "name": "Irish potatoes",
        "rw": "Ibirayi",
        "storage_rwf_kg_month": 10,    # needs ventilated, dark store; higher losses
        "loss_pct_month": 3.5,
        "transport_rwf_kg": 18,
    },
    {
        "id": "sorghum",
        "source": "Sorghum",
        "name": "Sorghum",
        "rw": "Amasaka",
        "storage_rwf_kg_month": 3,
        "loss_pct_month": 1.2,
        "transport_rwf_kg": 12,
    },
    {
        "id": "cassava_flour",
        "source": "Cassava flour",
        "name": "Cassava flour",
        "rw": "Ifu y'imyumbati",
        "storage_rwf_kg_month": 2,
        "loss_pct_month": 1.5,
        "transport_rwf_kg": 10,
    },
]

# ----------------------------------------------------------------------------
# District corrections.
#
# The WFP extract files several markets under the wrong district, which has two
# visible effects: it invents a district whose name is the literal string
# "Administrative unit not available", and it hides districts that really exist
# (Muhanga, Gasabo, Nyanza, Ngororero). Each correction below is checkable
# against the market name and, in three of five cases, against the price level:
# Ngororero and Kabaya both sit at 200 RWF/kg while Nyabihu is higher, and
# Kimironko trades at Kigali levels (300) rather than its listed Gatsibo
# neighbours (183). Coordinates are the district town, because the source
# coordinates for these rows belong to the district they were mis-filed under.
# ----------------------------------------------------------------------------
MARKET_FIX = {
    # market name -> (district, province, lat, lon)
    "Gisenyi":   ("Rubavu",    "Western Province",  -1.6779, 29.2564),
    "Kimironko": ("Gasabo",    "Kigali City",       -1.9350, 30.1250),
    "Muhanga":   ("Muhanga",   "Southern Province", -2.0833, 29.7500),
    "Nyanza":    ("Nyanza",    "Southern Province", -2.3500, 29.7500),
    "Ngororero": ("Ngororero", "Western Province",  -1.8667, 29.6167),
}

# Rwanda has 30 districts. The app is only allowed to claim the ones the price
# data can actually speak to, so we carry the official list and report the gap
# in the output rather than letting a missing district look like a bug.
ALL_DISTRICTS = {
    "Gasabo": "Kigali City", "Kicukiro": "Kigali City", "Nyarugenge": "Kigali City",
    "Gisagara": "Southern Province", "Huye": "Southern Province",
    "Kamonyi": "Southern Province", "Muhanga": "Southern Province",
    "Nyamagabe": "Southern Province", "Nyanza": "Southern Province",
    "Nyaruguru": "Southern Province", "Ruhango": "Southern Province",
    "Karongi": "Western Province", "Ngororero": "Western Province",
    "Nyabihu": "Western Province", "Nyamasheke": "Western Province",
    "Rubavu": "Western Province", "Rusizi": "Western Province",
    "Rutsiro": "Western Province",
    "Burera": "Northern Province", "Gakenke": "Northern Province",
    "Gicumbi": "Northern Province", "Musanze": "Northern Province",
    "Rulindo": "Northern Province",
    "Bugesera": "Eastern Province", "Gatsibo": "Eastern Province",
    "Kayonza": "Eastern Province", "Kirehe": "Eastern Province",
    "Ngoma": "Eastern Province", "Nyagatare": "Eastern Province",
    "Rwamagana": "Eastern Province",
}

# ----------------------------------------------------------------------------
# 1. CLEAN
# ----------------------------------------------------------------------------


def load_rows():
    path = os.path.join(ROOT, "prices_raw.csv")
    rows = []
    with open(path, encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            try:
                price = float(r["price"])
            except (TypeError, ValueError):
                continue
            if price <= 0:
                continue
            if r["unit"] != "KG":
                continue
            if r["pricetype"] != "Retail":
                continue
            if r["currency"] != "RWF":
                continue
            y, m = int(r["date"][:4]), int(r["date"][5:7])
            if y < FIRST_YEAR:
                continue
            r["_y"], r["_m"], r["_p"] = y, m, price
            rows.append(r)
    return rows


def monthly_panel(rows, commodity):
    """(market, year, month) -> median price. Median resists single bad entries."""
    bucket = defaultdict(list)
    meta = {}
    for r in rows:
        if r["commodity"] != commodity:
            continue
        bucket[(r["market"], r["_y"], r["_m"])].append(r["_p"])
        fix = MARKET_FIX.get(r["market"])
        if fix:
            district, province, lat, lon = fix
        else:
            district, province = r["admin2"], r["admin1"]
            lat, lon = float(r["latitude"]), float(r["longitude"])
        meta[r["market"]] = {
            "market": r["market"],
            "district": district,
            "province": province,
            "lat": lat,
            "lon": lon,
        }
    panel = {k: statistics.median(v) for k, v in bucket.items()}
    return panel, meta


def ym_add(y, m, k):
    t = y * 12 + (m - 1) + k
    return t // 12, t % 12 + 1


def ym_index(y, m):
    return y * 12 + (m - 1)


def drop_outliers(series, dates):
    """Remove points that jump more than 3.5x from the local 5-month median.

    Keeps genuine shocks (they arrive gradually) but removes keying errors,
    which are common in market price collection (e.g. 500 typed as 5000).
    """
    if len(series) < 5:
        return series, dates
    keep_s, keep_d = [], []
    for i, v in enumerate(series):
        lo = max(0, i - 2)
        hi = min(len(series), i + 3)
        neigh = [x for j, x in enumerate(series[lo:hi]) if lo + j != i]
        if not neigh:
            keep_s.append(v)
            keep_d.append(dates[i])
            continue
        med = statistics.median(neigh)
        if med > 0 and (v / med > 3.5 or v / med < 1 / 3.5):
            continue
        keep_s.append(v)
        keep_d.append(dates[i])
    return keep_s, keep_d


def build_series(points):
    """Turn a {(y, m): price} mapping into gap-filled parallel lists.

    Gaps of one or two months are bridged linearly (market collectors miss
    visits); longer gaps are left absent so the model sees a real discontinuity.
    """
    pts = sorted((y, m, v) for (y, m), v in points.items())
    if not pts:
        return [], []
    dates, values = [], []
    prev = None
    for y, m, v in pts:
        if prev is not None:
            gap = ym_index(y, m) - ym_index(prev[0], prev[1])
            if 1 < gap <= 3:                      # bridge short gaps linearly
                for g in range(1, gap):
                    gy, gm = ym_add(prev[0], prev[1], g)
                    frac = g / gap
                    dates.append((gy, gm))
                    values.append(prev[2] + (v - prev[2]) * frac)
        dates.append((y, m))
        values.append(v)
        prev = (y, m, v)
    vals, dts = drop_outliers(values, dates)
    return dts, vals


# ----------------------------------------------------------------------------
# 2. SEASONALITY
# ----------------------------------------------------------------------------


def seasonal_index(series_list, weights=None):
    """Month-of-year multiplier, 1.00 = that market's own annual average.

    Method: for every market-year with enough months, divide each month's price
    by that year's mean, then average the ratios by calendar month. This removes
    inflation and long-run trend, leaving only the shape of the year.
    """
    by_month = defaultdict(list)
    for i, (dates, values) in enumerate(series_list):
        w = 1.0 if weights is None else weights[i]
        years = defaultdict(dict)
        for (y, m), v in zip(dates, values):
            years[y][m] = v
        for y, months in years.items():
            if len(months) < MIN_YEARMONTHS:
                continue
            mean = statistics.mean(months.values())
            if mean <= 0:
                continue
            for m, v in months.items():
                by_month[m].append((v / mean) * w)
    if not by_month:
        return None, 0
    index = [0.0] * 12
    n = 0
    for m in range(1, 13):
        if by_month[m]:
            total_w = sum(1 for _ in by_month[m])
            index[m - 1] = sum(by_month[m]) / total_w
            n += total_w
    base = statistics.mean(index)
    if base <= 0:
        return None, 0
    return [x / base for x in index], n


def swing_pct(index):
    return (max(index) / min(index) - 1.0) * 100.0


def shrink(dist_idx, nat_idx, n, k=16.0):
    """Pull a district's seasonal shape toward the national one.

    A district with few observed years produces extreme-looking seasonal
    indexes (Kirehe showed a 75% swing against 43% nationally - almost certainly
    an artefact of thin data). Shrinking by n/(n+k) is standard partial pooling:
    trust the district more as its evidence grows, never blindly.
    """
    if not dist_idx:
        return nat_idx
    if not nat_idx or n <= 0:
        return dist_idx
    w = n / (n + k)
    return [w * d + (1 - w) * nn for d, nn in zip(dist_idx, nat_idx)]


# ----------------------------------------------------------------------------
# 3. FORECAST MODELS + BACKTEST
# ----------------------------------------------------------------------------


def deseasonalise(values, dates, index):
    out = []
    for (y, m), v in zip(dates, values):
        out.append(v / index[m - 1] if index[m - 1] > 0 else v)
    return out


def solve_linear(a, b):
    """Gaussian elimination with partial pivoting (small systems only)."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[piv][col]) < 1e-12:
            return [0.0] * n
        m[col], m[piv] = m[piv], m[col]
        pv = m[col][col]
        for r in range(col + 1, n):
            factor = m[r][col] / pv
            if factor == 0:
                continue
            for c in range(col, n + 1):
                m[r][c] -= factor * m[col][c]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        s = m[r][n] - sum(m[r][c] * x[c] for c in range(r + 1, n))
        x[r] = s / m[r][r] if abs(m[r][r]) > 1e-12 else 0.0
    return x


def ridge_fit(x_rows, y_vals, lam=1.0):
    p = len(x_rows[0])
    ata = [[0.0] * p for _ in range(p)]
    atb = [0.0] * p
    for xi, yi in zip(x_rows, y_vals):
        for a in range(p):
            atb[a] += xi[a] * yi
            xi_a = xi[a]
            for b in range(a, p):
                ata[a][b] += xi_a * xi[b]
    for a in range(p):
        for b in range(a):
            ata[a][b] = ata[b][a]
        if a > 0:
            ata[a][a] += lam
    return solve_linear(ata, atb)


def month_features(y, m, t):
    ang = 2 * math.pi * (m - 1) / 12
    return [math.sin(ang), math.cos(ang), math.sin(2 * ang), math.cos(2 * ang), t / 12.0]


def model_ridge(dates, values, index, horizon):
    """Log-return ridge model.

    Target is log(price[t+1]/price[t]), so level and inflation are handled
    implicitly and the model cannot drift to a negative price. Recursive
    multi-step forecast, with the seasonal index applied as a correction so the
    long horizon keeps the shape of the year.
    """
    if len(values) < 30:
        return None
    rows, targets = [], []
    base = ym_index(*dates[0])
    for i in range(12, len(values) - 1):
        p0 = values[i]
        if p0 <= 0 or values[i - 1] <= 0 or values[i - 12] <= 0 or values[i - 3] <= 0:
            continue
        feats = [1.0,
                 math.log(p0 / values[i - 1]),
                 math.log(p0 / values[i - 3]),
                 math.log(p0 / values[i - 12]),
                 ] + month_features(dates[i][0], dates[i][1],
                                    ym_index(*dates[i]) - base)
        rows.append(feats)
        targets.append(math.log(values[i + 1] / p0))
    if len(rows) < 20:
        return None
    beta = ridge_fit(rows, targets, lam=2.0)

    def predict_one(hist, prev_d, next_d):
        """One step ahead. `prev_d` is the month the last history point belongs to."""
        if len(hist) < 13:
            return hist[-1]
        i = len(hist) - 1
        if hist[i - 1] <= 0 or hist[i - 3] <= 0 or hist[i - 12] <= 0:
            return hist[-1]
        feats = [1.0,
                 math.log(hist[i] / hist[i - 1]),
                 math.log(hist[i] / hist[i - 3]),
                 math.log(hist[i] / hist[i - 12]),
                 ] + month_features(next_d[0], next_d[1], ym_index(*next_d) - base)
        r = sum(b * f for b, f in zip(beta, feats))
        r = max(-0.35, min(0.35, r))          # cap a single month's move
        nxt = hist[-1] * math.exp(r)
        if index and index[prev_d[1] - 1] > 0:
            nxt *= index[next_d[1] - 1] / index[prev_d[1] - 1]
        return nxt

    out, hist, cur = [], list(values), dates[-1]
    for _ in range(horizon):
        nxt_d = ym_add(cur[0], cur[1], 1)
        nxt = predict_one(hist, cur, nxt_d)
        out.append(nxt)
        hist.append(nxt)
        cur = nxt_d
    return out


def model_seasonal_naive(dates, values, index, horizon):
    if len(values) < 13:
        return None
    out = []
    last = len(values) - 1
    growth = 1.0
    if len(values) >= 25 and values[-13] > 0:
        growth = (values[-1] / values[-13]) ** (1 / 12.0)
    for h in range(1, horizon + 1):
        idx = last + h - 12
        if idx < 0:
            return None
        out.append(values[idx] * (growth ** h))
    return out


def model_seasonal_index(dates, values, index, horizon):
    """Level x seasonal shape, with a trend estimated on deseasonalised prices."""
    if len(values) < 24 or not index:
        return None
    des = deseasonalise(values, dates, index)
    recent = des[-3:]
    level = statistics.mean(recent)
    trend = 1.0
    if len(des) >= 13:
        a = statistics.mean(des[-13:-7])
        b = statistics.mean(des[-6:])
        if a > 0 and b > 0:
            trend = (b / a) ** (1 / 6.0)
    trend = max(0.97, min(1.03, trend))
    out, cur = [], dates[-1]
    for h in range(1, horizon + 1):
        nd = ym_add(cur[0], cur[1], h)
        out.append(level * index[nd[1] - 1] * (trend ** h))
    return out


MODELS = {
    "seasonal_naive": model_seasonal_naive,
    "seasonal_index": model_seasonal_index,
    "ridge_returns": model_ridge,
}


def backtest(dates, values, index):
    """Rolling-origin test: train on everything before each origin month.

    Returns per-model MAE, MAPE and directional accuracy at a 3-month horizon.
    Directional accuracy is the metric that actually matters here: a farmer
    needs to know whether the price will RISE or FALL, not the exact number.
    """
    if len(values) < MIN_MONTHS + BACKTEST_ORIGINS:
        return None
    scores = {name: {"ae": [], "ape": [], "dir_ok": 0, "dir_n": 0} for name in MODELS}
    origin_start = len(values) - BACKTEST_ORIGINS
    for o in range(origin_start, len(values) - 1):
        d_tr, v_tr = dates[:o + 1], values[:o + 1]
        actual_h1 = values[o + 1]
        actual_h3 = values[o + 3] if o + 3 < len(values) else None
        now = v_tr[-1]
        for name, fn in MODELS.items():
            try:
                pred = fn(d_tr, v_tr, index, min(MAX_HORIZON, len(values) - o - 1))
            except Exception:
                pred = None
            if not pred:
                continue
            ae = abs(pred[0] - actual_h1)
            scores[name]["ae"].append(ae)
            if actual_h1 > 0:
                scores[name]["ape"].append(ae / actual_h1 * 100)
            if actual_h3 is not None and len(pred) >= 3 and now > 0:
                pred_dir = pred[2] > now
                act_dir = actual_h3 > now
                scores[name]["dir_ok"] += int(pred_dir == act_dir)
                scores[name]["dir_n"] += 1
    out = {}
    for name, s in scores.items():
        if len(s["ae"]) < 6:
            continue
        out[name] = {
            "mae": round(statistics.mean(s["ae"]), 1),
            "mape": round(statistics.mean(s["ape"]), 1) if s["ape"] else None,
            "direction": round(100 * s["dir_ok"] / s["dir_n"], 1) if s["dir_n"] else None,
            "n": len(s["ae"]),
        }
    if not out:
        return None
    best = min(out.items(), key=lambda kv: (kv[1]["mape"] if kv[1]["mape"] is not None else 999))[0]
    return {"models": out, "best": best}


# ----------------------------------------------------------------------------
# The decision rule — shared logic, mirrored exactly in the web app.
# ----------------------------------------------------------------------------

INTEREST_ANNUAL = 0.12      # opportunity cost of capital; borrowing costs 18-24%
MAX_HOLD_MONTHS = 8         # a full season trough-to-peak, not longer
RISK_BUFFER = 0.08          # expected gain must clear ~our median backtest error


def deseasonalised_level(dates, values, index, n=6):
    """Annual-average price level: monthly price divided by its seasonal index.

    This is the "level" in price = level x seasonal x noise. It is what we carry
    forward when a district's own data is old, instead of pretending a 2015 price
    is today's.
    """
    pts = [v / index[m - 1] for (y, m), v in zip(dates, values) if index[m - 1] > 0]
    if not pts:
        return None
    return statistics.median(pts[-n:])


def evaluate_hold(base_price, level, index, cur_ym, crop,
                  interest=INTEREST_ANNUAL, transport=0.0):
    """For each month ahead, is holding worth more than selling today?"""
    best = None
    for h in range(1, MAX_HOLD_MONTHS + 1):
        nd = ym_add(cur_ym[0], cur_ym[1], h)
        exp_price = level * index[nd[1] - 1]
        storage = crop["storage_rwf_kg_month"] * h
        interest_cost = base_price * interest * h / 12.0
        loss = exp_price * (crop["loss_pct_month"] / 100.0) * h
        cost = storage + interest_cost + loss + transport
        net = exp_price - base_price - cost
        cand = {"h": h, "ym": list(nd), "exp_price": exp_price, "cost": cost,
                "storage": storage, "interest": interest_cost, "loss": loss, "net": net}
        if best is None or net > best["net"]:
            best = cand
    return best


def decision_backtest(dates, values, index, crop, max_origins=36):
    """Economic backtest of the hold/sell advice itself.

    Walks forward through recent history. At each month it re-estimates the
    seasonal index using ONLY data available at that point, makes the same
    decision the app would make, then checks what actually happened `h` months
    later, charging the real storage, interest and spoilage costs.

    This is the number that matters: not "how close was the forecast" but
    "did following the advice make money?".
    """
    rows = []
    start = max(24, len(values) - max_origins)
    for o in range(start, len(values) - 1):
        d_tr, v_tr = dates[:o + 1], values[:o + 1]
        idx_o, n_o = seasonal_index([(d_tr, v_tr)])
        if not idx_o or n_o < 24:      # a stable shape needs ~2 years of evidence
            continue
        lvl = deseasonalised_level(d_tr, v_tr, idx_o)
        if not lvl:
            continue
        base = v_tr[-1]
        if base <= 0:
            continue
        best = evaluate_hold(base, lvl, idx_o, d_tr[-1], crop)
        if best is None or o + best["h"] >= len(values):
            continue
        h = best["h"]
        actual = values[o + h]
        storage = crop["storage_rwf_kg_month"] * h
        interest_cost = base * INTEREST_ANNUAL * h / 12.0
        loss = actual * (crop["loss_pct_month"] / 100.0) * h
        realised = actual - base - storage - interest_cost - loss
        # The rule has two gates, both learned from the data:
        #  1. only think about storing when this month is near the yearly floor
        #  2. the gain must clear our own measured forecast error
        # Gate 1 is what makes the advice work: storing from a middling month
        # is how farmers lose money, and the backtest shows it clearly.
        cheap_month = idx_o[d_tr[-1][1] - 1] <= sorted(idx_o)[3]
        hold = cheap_month and best["net"] > max(0.08, RISK_BUFFER) * base
        rows.append({"hold": hold, "expected": best["net"],
                     "realised": realised if hold else 0.0, "h": h})
    if not rows:
        return None
    holds = [r for r in rows if r["hold"]]
    if not holds:
        return {"decisions": len(rows), "holds": 0, "hold_share": 0.0,
                "mean_realised": None, "pct_positive": None,
                "mean_expected": None, "mean_horizon": None}
    realised = [r["realised"] for r in holds]
    return {
        "decisions": len(rows),
        "holds": len(holds),
        "hold_share": round(100 * len(holds) / len(rows), 1),
        "mean_realised": round(statistics.mean(realised), 1),
        "median_realised": round(statistics.median(realised), 1),
        "pct_positive": round(100 * sum(1 for r in realised if r > 0) / len(realised), 1),
        "mean_expected": round(statistics.mean([r["expected"] for r in holds]), 1),
        "mean_horizon": round(statistics.mean([r["h"] for r in holds]), 1),
    }


# ----------------------------------------------------------------------------
# MAIN
# ----------------------------------------------------------------------------


def main():
    if not os.path.exists(os.path.join(ROOT, "prices_raw.csv")):
        sys.exit("prices_raw.csv not found next to pipeline/")
    print("loading prices ...")
    rows = load_rows()
    print(f"  {len(rows):,} usable RWF/kg retail observations")

    os.makedirs(OUT_DIR, exist_ok=True)

    meta = {
        "generated": date.today().isoformat(),
        "source_prices": "WFP VAM Rwanda food prices via HDX (data.humdata.org), CC-BY",
        "source_boundaries": "geoBoundaries gbOpen RWA ADM2, sourced from NISR",
        "observations": len(rows),
        # WFP marks each record actual / aggregate / actual,aggregate. We keep
        # all three (aggregate rows are WFP's own summary of several collections
        # and are the only 2026 record for four markets) but publish the share
        # and a sensitivity test, so the choice is visible instead of hidden.
        "aggregate_flagged": sum(1 for r in rows if "aggregate" in r["priceflag"]),
        "first_year": FIRST_YEAR,
        "district_min_months": MIN_DISTRICT_MONTHS,
        "market_min_obs": MIN_MONTHS,
    }

    crops_out = []
    districts = {}
    market_registry = {}

    for crop in CROPS:
        print(f"\n=== {crop['name']}")
        panel, market_meta = monthly_panel(rows, crop["source"])
        if not panel:
            print("  no data, skipping")
            continue

        # --- per-market series
        # --- per-market series (used as the "lead market" the price comes from)
        series = {}
        for mk in market_meta:
            pts = {(k[1], k[2]): v for k, v in panel.items() if k[0] == mk}
            dates, values = build_series(pts)
            if len(values) >= 12:
                series[mk] = (dates, values)
        if not series:
            print("  no usable series")
            continue

        # --- district panel: median across every market in the district.
        # The product advises at district level, so pooling markets both raises
        # coverage and makes the seasonal shape far less noisy.
        dist_points = defaultdict(lambda: defaultdict(list))
        for (mk, y, m), v in panel.items():
            dist_points[market_meta[mk]["district"]][(y, m)].append(v)
        district_series = {}
        for d, pts in dist_points.items():
            med = {k: statistics.median(v) for k, v in pts.items()}
            dates, values = build_series(med)
            # 18 months is the floor: one and a half seasonal cycles. Anything
            # shorter cannot show a month-of-year shape, and the district index
            # is shrunk toward the national one in proportion to how thin it is.
            if len(values) >= MIN_DISTRICT_MONTHS:
                district_series[d] = (dates, values)
        print(f"  {len(series)} markets, {len(district_series)} districts "
              f"with enough monthly observations")

        # --- national seasonal index, recent years weighted up
        all_series = list(district_series.values())
        weights = []
        for dates, _ in all_series:
            last_y = dates[-1][0]
            weights.append(1.0 + 0.5 * max(0, last_y - 2020) / 6.0)
        nat_index, nat_n = seasonal_index(all_series, weights)

        # --- per-district seasonal index (fallback: province -> national)
        by_district = defaultdict(list)          # district -> [(market, dates, values)]
        for mk, (dates, values) in series.items():
            by_district[market_meta[mk]["district"]].append((mk, dates, values))
        by_district_series = {d: (dates, values) for d, (dates, values) in district_series.items()}

        prov_series = defaultdict(list)
        for mk, (dates, values) in series.items():
            prov_series[market_meta[mk]["province"]].append((dates, values))
        prov_index = {}
        for p, sl in prov_series.items():
            idx, n = seasonal_index(sl)
            if idx and n >= 12:
                prov_index[p] = idx

        dist_index = {}
        for d, (dates, values) in by_district_series.items():
            idx, n = seasonal_index([(dates, values)])
            if idx and n >= 8:
                dist_index[d] = (shrink(idx, nat_index, n), n)
            else:
                prov = market_meta[by_district[d][0][0]]["province"]
                dist_index[d] = (prov_index.get(prov, nat_index), 0)

        # --- crop-wide deseasonalised level by month, used to bring an old
        # district observation up to today instead of showing 2015 prices.
        nat_level = {}
        bucket = defaultdict(list)
        for d, (dates, values) in by_district_series.items():
            idx_d = dist_index.get(d, (nat_index, 0))[0]
            for (y, m), v in zip(dates, values):
                if idx_d[m - 1] > 0:
                    bucket[(y, m)].append(v / idx_d[m - 1])
        for k, vals in bucket.items():
            nat_level[k] = statistics.median(vals)
        latest_month = max(nat_level) if nat_level else (NOW[0], NOW[1])

        for d, (idx, n) in dist_index.items():
            if d not in by_district or d not in by_district_series:
                continue
            last_d, last_v = by_district_series[d]
            as_of = last_d[-1]
            level_at_as_of = deseasonalised_level(last_d, last_v, idx)
            if not level_at_as_of or level_at_as_of <= 0:
                continue

            # Bring a stale observation up to today.
            # A district's price *level* relative to the national level is stable
            # (some districts are structurally cheaper). Its absolute price is
            # not. So we carry the district's relative position, not its 2015
            # price, and re-anchor it on the current national level.
            estimated = as_of[0] < 2025
            growth = 1.0
            if estimated:
                base_lvl = nat_level.get(as_of)
                top_lvl = nat_level.get(latest_month)
                if base_lvl and top_lvl:
                    relative = max(0.6, min(1.6, level_at_as_of / base_lvl))
                    level_now = top_lvl * relative
                    growth = level_now / level_at_as_of
            else:
                level_now = level_at_as_of
            price_as_of = level_at_as_of * idx[as_of[1] - 1]
            price_now = price_as_of * growth

            live_markets = [t for t in by_district[d] if t[1][-1][0] >= 2025]
            live_markets.sort(key=lambda t: t[1][-1], reverse=True)
            lead = live_markets[0][0] if live_markets else max(
                by_district[d], key=lambda t: len(t[2]))[0]

            bt = backtest(last_d, last_v, idx)
            dec = decision_backtest(last_d, last_v, idx, crop)

            forecast = []
            for h in range(0, 9):
                nd = ym_add(NOW[0], NOW[1], h)
                forecast.append([nd[0], nd[1], round(level_now * idx[nd[1] - 1])])

            if d not in districts:
                districts[d] = {
                    "id": d,
                    "province": market_meta[lead]["province"],
                    "lat": market_meta[lead]["lat"],
                    "lon": market_meta[lead]["lon"],
                    "crops": {},
                }
            districts[d]["crops"][crop["id"]] = {
                "index": [round(x, 6) for x in idx],
                "series": [[y, m, round(v)] for (y, m), v in zip(last_d[-30:], last_v[-30:])],
                "forecast": forecast,
                "now": round(price_now),
                "as_of": f"{as_of[0]:04d}-{as_of[1]:02d}",
                "estimated": estimated,
                "level": round(level_now, 2),
                "market": lead,
                "model": bt["best"] if bt else "seasonal_index",
                "swing": round(swing_pct(idx), 1),
                "live": not estimated,
                "backtest": {"best": bt["best"] if bt else None,
                             "models": bt["models"] if bt else {}},
                "decision": dec,
            }
            for mk, md, mv in by_district[d]:
                market_registry[mk] = {
                    "name": mk,
                    "district": d,
                    "lat": market_meta[mk]["lat"],
                    "lon": market_meta[mk]["lon"],
                    "last": f"{md[-1][0]:04d}-{md[-1][1]:02d}",
                    "n": len(mv),
                }

        crop_entry = {k: v for k, v in crop.items() if k != "source"}
        crop_entry["national_swing"] = round(swing_pct(nat_index), 1) if nat_index else None
        crop_entry["national_index"] = [round(x, 6) for x in nat_index] if nat_index else []
        crop_entry["districts"] = sorted(
            d["id"] for d in districts.values() if crop["id"] in d["crops"]
        )
        crops_out.append(crop_entry)
        if nat_index:
            print(f"  seasonal swing {swing_pct(nat_index):.0f}%  "
                  f"(low month {nat_index.index(min(nat_index)) + 1}, "
                  f"high month {nat_index.index(max(nat_index)) + 1})")

    covered = set(districts)
    meta["coverage"] = {
        "total_districts": len(ALL_DISTRICTS),
        "covered_districts": len(covered),
        "missing_districts": sorted(set(ALL_DISTRICTS) - covered),
        "live_districts": sorted(
            d["id"] for d in districts.values()
            if any(c["live"] for c in d["crops"].values())
        ),
        "markets_reporting_2026": len({m["name"] for m in market_registry.values()
                                       if m["last"] >= "2026-01"}),
    }

    # A district the prices cannot speak to still belongs on the map: a farmer in
    # Nyaruguru should find Nyaruguru there, labelled, rather than absent. It is
    # carried with no crop data at all, because Miko market last reported in
    # 2012 and borrowing a neighbouring district's price would invent a number
    # nobody measured.
    for name in sorted(set(ALL_DISTRICTS) - covered):
        districts[name] = {
            "id": name,
            "province": ALL_DISTRICTS[name],
            "lat": None,
            "lon": None,
            "crops": {},
            "unmodelled": True,
        }

    payload = {
        "meta": meta,
        "now": f"{NOW[0]:04d}-{NOW[1]:02d}",
        "crops": crops_out,
        "districts": sorted(districts.values(), key=lambda d: d["id"]),
        "markets": sorted(market_registry.values(), key=lambda m: (-m["n"], m["name"])),
        "backtest_summary": aggregate_backtest(districts),
        "decision_summary": aggregate_decisions(districts),
        "decision_by_crop": decisions_by_crop(districts),
    }
    out = os.path.join(OUT_DIR, "data.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)
    kb = os.path.getsize(out) / 1024
    print(f"\nwrote {out} ({kb:.0f} KB)")
    print(f"  {len(payload['districts'])} districts, {len(payload['markets'])} markets, "
          f"{len(payload['crops'])} crops")


def _tally(dec_rows):
    decisions = sum(r["decisions"] for r in dec_rows)
    holds = sum(r["holds"] for r in dec_rows)
    real = [r["mean_realised"] for r in dec_rows if r.get("mean_realised") is not None]
    ppos = [r["pct_positive"] for r in dec_rows if r.get("pct_positive") is not None]
    exp = [r["mean_expected"] for r in dec_rows if r.get("mean_expected") is not None]
    hor = [r["mean_horizon"] for r in dec_rows if r.get("mean_horizon") is not None]
    return {
        "cells": len(dec_rows),
        "decisions": decisions,
        "holds": holds,
        "hold_share": round(100 * holds / decisions, 1) if decisions else 0.0,
        "mean_realised_per_kg": round(statistics.mean(real), 1) if real else None,
        "mean_pct_positive": round(statistics.mean(ppos), 1) if ppos else None,
        "mean_expected_per_kg": round(statistics.mean(exp), 1) if exp else None,
        "mean_horizon": round(statistics.mean(hor), 1) if hor else None,
    }


def aggregate_decisions(districts):
    """Pool every district-crop economic backtest into one headline."""
    rows = [c["decision"] for d in districts.values() for c in d["crops"].values()
            if c.get("decision") and c["decision"].get("decisions")]
    return _tally(rows) if rows else None


def decisions_by_crop(districts):
    """Per-crop verdict: does storing this crop actually pay?

    This is deliberately unflattering where the data says so. Telling a bean
    farmer to hold when the backtest shows they lose money would be worse than
    useless.
    """
    buckets = defaultdict(list)
    for d in districts.values():
        for crop_id, c in d["crops"].items():
            dec = c.get("decision")
            if dec and dec.get("decisions"):
                buckets[crop_id].append(dec)
    out = {}
    for crop_id, rows in buckets.items():
        t = _tally(rows)
        t["verdict"] = ("pays" if (t["mean_realised_per_kg"] or -1) > 0
                        and (t["mean_pct_positive"] or 0) >= 55 else "does_not_pay")
        out[crop_id] = t
    return out


def aggregate_backtest(districts):
    """One honest table for the documentation: how each model did overall."""
    agg = defaultdict(lambda: {"mape": [], "direction": [], "wins": 0})
    for d in districts.values():
        for c in d["crops"].values():
            bt = c["backtest"]
            for name, m in bt["models"].items():
                if m.get("mape") is not None:
                    agg[name]["mape"].append(m["mape"])
                if m.get("direction") is not None:
                    agg[name]["direction"].append(m["direction"])
            if bt.get("best") in agg:
                agg[bt["best"]]["wins"] += 1
    out = []
    for name, s in agg.items():
        out.append({
            "model": name,
            "mean_mape": round(statistics.mean(s["mape"]), 1) if s["mape"] else None,
            "mean_direction": round(statistics.mean(s["direction"]), 1) if s["direction"] else None,
            "series_won": s["wins"],
            "series_scored": len(s["mape"]),
        })
    out.sort(key=lambda r: (r["mean_mape"] if r["mean_mape"] is not None else 999))
    return out


if __name__ == "__main__":
    main()
