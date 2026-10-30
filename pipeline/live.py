"""
SokoRyari? - live price publisher.

    python pipeline/live.py                 # validate + publish to Turso
    python pipeline/live.py --dry-run       # validate only, touch nothing
    python pipeline/live.py --source esoko  # once an agreement exists

Input  : whatever sources.load() returns (WFP extract today, eSoko later)
Output : Turso database served by the /api/prices serverless function,
         plus web/public/data/live.json as an offline mirror

The publish guard, in one sentence: nothing reaches the database or the
mirror until every check passes, and a rejected batch is logged as rejected
while the previous good snapshot keeps serving.

Checks before publish (any failure -> reject):
  1. shape        every row has all six fields, right types, ym is YYYY-MM
  2. range        price > 0 and below a sane ceiling (RWF/kg)
  3. known keys   district is one of Rwanda's 30, crop is one of our six
  4. currency     ym is not in the future
  5. staleness    newest observation is within the source's max age
  6. coverage     enough (district, crop) pairs and districts to serve
  7. no collapse  the batch did not shrink below half of what is live now

Stdlib only, like the rest of the pipeline. Reads TURSO_DATABASE_URL and
TURSO_AUTH_TOKEN from the environment; never hardcodes them.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import build  # noqa: E402
import sources  # noqa: E402

OUT_PATH = os.path.join(ROOT, "web", "public", "data", "live.json")

# How stale the newest observation may be, in months, before we refuse to
# publish. WFP's extract lands monthly but ships late, so it gets more slack
# than eSoko, whose collectors visit markets weekly. Failing this check is
# the whole point of the guard: better to keep serving a dated snapshot with
# an honest "as of" than to publish a number that quietly ages.
MAX_AGE_MONTHS = {"wfp": 6, "esoko": 2}

# Coverage floors, set from the current extract (152 pairs, 29 districts)
# at roughly 60%. A feed that collapses below these has lost coverage, not
# shifted; publishing it would make districts silently turn to estimates.
MIN_PAIRS = 90
MIN_DISTRICTS = 18

PRICE_CEILING = 20000  # RWF/kg; above this a unit or currency is wrong


def _now():
    return datetime.now(timezone.utc)


def _ym_parts(ym):
    y, m = str(ym).split("-")
    return int(y), int(m)


def _months_between(y, m, today):
    return (today.year - y) * 12 + (today.month - m)


def validate(rows, source, live_pairs=None, today=None):
    """Return a list of problems. Empty list means the batch is publishable."""
    today = today or _now()
    problems = []
    if not rows:
        return ["source returned no rows"]

    seen = set()
    newest = None
    districts = set()
    for i, r in enumerate(rows):
        tag = f"row {i} ({r.get('district')}/{r.get('crop')})" if isinstance(r, dict) else f"row {i}"
        if not isinstance(r, dict):
            problems.append(f"{tag}: not an object")
            continue
        missing = [k for k in ("district", "crop", "price", "ym") if k not in r]
        if missing:
            problems.append(f"{tag}: missing {', '.join(missing)}")
            continue

        try:
            price = float(r["price"])
        except (TypeError, ValueError):
            problems.append(f"{tag}: price is not a number")
            continue
        if price <= 0:
            problems.append(f"{tag}: price {price} is not positive")
        elif price > PRICE_CEILING:
            problems.append(f"{tag}: price {price} RWF/kg is above the ceiling - unit or currency is wrong")

        if r["district"] not in build.ALL_DISTRICTS:
            problems.append(f"{tag}: district is not one of Rwanda's 30")
        if r["crop"] not in {c["id"] for c in build.CROPS}:
            problems.append(f"{tag}: unknown crop id")
        districts.add(r["district"])

        try:
            y, m = _ym_parts(r["ym"])
            if not (1 <= m <= 12):
                raise ValueError
        except (ValueError, AttributeError):
            problems.append(f"{tag}: ym '{r.get('ym')}' is not YYYY-MM")
            continue
        if (y, m) > (today.year, today.month):
            problems.append(f"{tag}: ym {y}-{m:02d} is in the future")
        age = _months_between(y, m, today)
        if newest is None or age < newest:
            newest = age

        key = (r["district"], r["crop"])
        if key in seen:
            problems.append(f"{tag}: duplicate (district, crop)")
        seen.add(key)

    # staleness
    max_age = MAX_AGE_MONTHS.get(source, 3)
    if newest is not None and newest > max_age:
        problems.append(
            f"newest observation is {newest} months old; {source} allows {max_age}. "
            "Refusing to publish - keeping the previous snapshot."
        )

    # coverage
    if len(seen) < MIN_PAIRS:
        problems.append(f"only {len(seen)} (district, crop) pairs, need {MIN_PAIRS}")
    if len(districts) < MIN_DISTRICTS:
        problems.append(f"only {len(districts)} districts, need {MIN_DISTRICTS}")

    # collapse against what is live now
    if live_pairs is not None and len(seen) < live_pairs * 0.5:
        problems.append(
            f"batch has {len(seen)} pairs, live has {live_pairs} - "
            "a drop this large means lost coverage, not a real change"
        )

    return problems


# ---------------------------------------------------------------------------- Turso

def _base_url():
    url = os.environ.get("TURSO_DATABASE_URL", "").strip()
    if not url:
        return None
    for scheme in ("turso://", "libsql://"):
        if url.startswith(scheme):
            url = "https://" + url[len(scheme) :]
    return url.rstrip("/")


def _token():
    return os.environ.get("TURSO_AUTH_TOKEN", "").strip()


def _arg(kind, value):
    """Turso wants scalar argument values as JSON strings, to avoid float
    precision loss in JSON implementations that round to 64 bits."""
    if kind == "float":
        return {"type": "float", "value": str(float(value))}
    if kind == "integer":
        return {"type": "integer", "value": str(int(value))}
    return {"type": "text", "value": str(value)}


def _execute(sql, args=None):
    stmt = {"sql": sql}
    if args:
        stmt["args"] = args
    return {"type": "execute", "stmt": stmt}


def _post(base, token, requests):
    body = json.dumps({"requests": requests}).encode("utf-8")
    req = urllib.request.Request(
        base + "/v2/pipeline",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"Turso HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Turso unreachable: {exc.reason}") from exc

    for i, res in enumerate(payload.get("results", [])):
        if res.get("type") != "ok":
            raise RuntimeError(f"statement {i} failed: {json.dumps(res)[:300]}")
    return payload


def _schema_statements():
    """schema.sql is the source of truth; strip comments (including trailing
    ones on a column line), split on ';'."""
    with open(os.path.join(HERE, "schema.sql"), encoding="utf-8") as fh:
        text = fh.read()
    out = []
    for chunk in text.split(";"):
        lines = []
        for ln in chunk.splitlines():
            if "--" in ln:
                ln = ln.split("--", 1)[0]
            if ln.strip():
                lines.append(ln.rstrip())
        if lines:
            out.append("\n".join(lines).strip())
    return out


def publish(rows, source, meta, dry_run=False):
    """Apply schema, replace the snapshot, log the run. One request, so a
    failure mid-way leaves the previous snapshot intact."""
    base, token = _base_url(), _token()
    if not base or not token:
        if os.environ.get("SOKO_REQUIRE_DB") == "1":
            raise RuntimeError("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN not set and SOKO_REQUIRE_DB=1")
        print("  ! Turso not configured (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN) - "
              "skipping database publish, writing live.json only")
        return False

    stamp = _now().isoformat(timespec="seconds").replace("+00:00", "Z")
    reqs = [_execute(sql) for sql in _schema_statements()]
    reqs.append(_execute("BEGIN"))
    reqs.append(_execute("DELETE FROM prices_latest"))
    for r in rows:
        reqs.append(
            _execute(
                "INSERT INTO prices_latest (district, crop, price, ym, market, source, observed_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    {"type": "text", "value": r["district"]},
                    {"type": "text", "value": r["crop"]},
                    _arg("float", r["price"]),
                    {"type": "text", "value": r["ym"]},
                    {"type": "text", "value": r.get("market") or ""},
                    {"type": "text", "value": r["source"]},
                    {"type": "text", "value": stamp},
                ],
            )
        )
    for key, value in meta.items():
        reqs.append(
            _execute(
                "INSERT INTO meta (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [{"type": "text", "value": key}, {"type": "text", "value": str(value)}],
            )
        )
    reqs.append(
        _execute(
            "INSERT INTO refresh_log (run_at, source, status, rows, detail) VALUES (?, ?, ?, ?, ?)",
            [
                {"type": "text", "value": stamp},
                {"type": "text", "value": source},
                {"type": "text", "value": "ok"},
                _arg("integer", len(rows)),
                {"type": "text", "value": meta.get("detail", "")},
            ],
        )
    )
    reqs.append(_execute("COMMIT"))
    reqs.append(_execute("close"))

    if dry_run:
        print(f"  dry-run: would send {len(reqs)} statements ({len(rows)} rows)")
        return True

    _post(base, token, reqs)
    print(f"  published {len(rows)} rows to Turso")
    return True


def log_rejection(source, problems):
    """Best effort: record a rejected run so the audit trail shows the miss."""
    base, token = _base_url(), _token()
    if not base or not token:
        return
    stamp = _now().isoformat(timespec="seconds").replace("+00:00", "Z")
    detail = "; ".join(problems)[:800]
    try:
        _post(
            base,
            token,
            [
                # ensure every table exists before logging the rejection
                *[_execute(sql) for sql in _schema_statements()],
                _execute(
                    "INSERT INTO refresh_log (run_at, source, status, rows, detail) VALUES (?, ?, ?, ?, ?)",
                    [
                        {"type": "text", "value": stamp},
                        {"type": "text", "value": source},
                        {"type": "text", "value": "rejected"},
                        {"type": "integer", "value": "0"},
                        {"type": "text", "value": detail},
                    ],
                ),
                _execute("close"),
            ],
        )
    except Exception as exc:  # noqa: BLE001 - audit logging must not mask the real failure
        print(f"  ! could not log rejection: {exc}")


def _write_mirror(path, rows, source, meta):
    payload = {
        "ok": True,
        "source": source,
        "generated": meta.get("generated", ""),
        "as_of": meta.get("as_of", ""),
        "refreshed_at": meta.get("published_at", ""),
        "count": len(rows),
        "rows": rows,
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)  # atomic: readers never see a half-written mirror
    print(f"  wrote {path} ({os.path.getsize(path):,} bytes)")


def _build_generated():
    path = os.path.join(ROOT, "web", "public", "data", "data.json")
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh).get("meta", {}).get("generated", "")
    except (OSError, ValueError):
        return ""


def _live_pair_count():
    """How many (district, crop) pairs are live right now, for the collapse
    check. Read from the mirror if it exists, else None."""
    try:
        with open(OUT_PATH, encoding="utf-8") as fh:
            return len(json.load(fh).get("rows", []))
    except (OSError, ValueError):
        return None


def main(argv=None):
    ap = argparse.ArgumentParser(description="Validate and publish the live price snapshot")
    ap.add_argument("--source", default=os.environ.get("SOKO_SOURCE", "wfp"),
                    choices=["wfp", "esoko"], help="which feed to read (default: wfp)")
    ap.add_argument("--dry-run", action="store_true", help="validate only; write nothing")
    ap.add_argument("--no-db", action="store_true", help="write live.json only, skip Turso")
    ap.add_argument("--out", default=OUT_PATH, help="mirror path")
    args = ap.parse_args(argv)

    print(f"SokoRyari live publish - source={args.source}")
    try:
        rows, info = sources.load(args.source)
    except sources.SourceError as exc:
        print(f"  REJECTED: {exc}")
        log_rejection(args.source, [str(exc)])
        return 1

    if info.get("dropped"):
        print(f"  dropped at source: {info['dropped']}")

    problems = validate(rows, args.source, live_pairs=_live_pair_count())
    if problems:
        print(f"  REJECTED ({len(problems)} problems):")
        for p in problems[:12]:
            print(f"    - {p}")
        if len(problems) > 12:
            print(f"    ... and {len(problems) - 12} more")
        if not args.dry_run:
            log_rejection(args.source, problems)
        return 1

    newest = max(r["ym"] for r in rows)
    print(f"  ok: {len(rows)} pairs, {len({r['district'] for r in rows})} districts, newest {newest}")

    meta = {
        "as_of": newest,
        "generated": _build_generated(),
        "published_at": _now().isoformat(timespec="seconds").replace("+00:00", "Z"),
        "pairs": len(rows),
        "detail": f"{args.source}:{newest}",
    }

    if args.dry_run:
        print("  dry-run: nothing written")
        return 0

    _write_mirror(args.out, rows, args.source, meta)
    if not args.no_db:
        try:
            publish(rows, args.source, meta)
        except Exception as exc:  # noqa: BLE001
            # The mirror is already written, so the site still has fresh data;
            # report the database failure loudly and let CI surface it.
            print(f"  ! Turso publish failed: {exc}")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
