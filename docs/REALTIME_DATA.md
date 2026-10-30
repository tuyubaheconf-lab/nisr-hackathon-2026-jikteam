# Real-time prices: what is actually possible, and what we built

**Question this document answers:** *if we sign an agreement with eSoko and they let us
fetch data that changes over time, how do the prices become "real-time" in the app?*

The short answer: **nobody in Rwanda sells a tick-by-tick price feed, because nobody
collects prices that way — but "real-time" for this product does not need one.** What
we built is a path where a newer observation reaches the farmer as soon as the source
publishes it, with the date of that observation always visible.

---

## 1. What the sources actually do

| Source | What it collects | Cadence | Coverage |
|---|---|---|---|
| **eSoko** (the likely partner) | market prices collected by enumerators who visit markets | regular visits, published continuously to the portal; studies call it *high-frequency* and analyse it weekly-to-monthly | **106 food items in 68 markets** |
| **WFP VAM via HDX** (what we use today) | monthly retail price series | monthly extract, ships with a lag (our extract ends 2026-08) | 91 markets, 27 still reporting in 2026 |

Evidence for the eSoko figures, since a judge will ask:

- The SSA Food Security Portal's Rwanda brief states eSoko **"tracks prices for 106 food
  items in 68 markets across the country"** and that researchers **"aggregated market
  prices to district prices"** before analysis (Jun 2024) —
  <https://ssa.foodsecurityportal.org/node/2859>
- A 2025 CGIAR study is titled **"Deploying high-frequency market data to estimate the
  cost of…"** and explicitly utilises **"Rwanda's eSoko data platform"** for its
  high-frequency, spatially explicit data —
  <https://cgspace.cgiar.org/items/8dcc578d-3690-42c0-a5ef-4fd350e62ea4>
- eSoko's own model is enumerator-based: collectors **"go into each large market"** on
  a regular basis (ICTworks profile) —
  <https://www.integrallc.com/ictworks-profile-of-esoko-bringing-the-market-to-africas-fingertips/>
- In Ghana the same company collected **58 commodities in 42 markets daily** —
  <https://odimpact.org/case-ghanas-esoko.html>

**The honest conclusion about frequency:** a price in Rwanda is a *survey observation*,
not a trade print. It is as fresh as the last enumerator visit — days to weeks, not
seconds. Any provider claiming "real-time" means "refreshed frequently with a visible
timestamp". We say the same thing in the app: the badge shows **when the number was
observed**, so a stale price is never presented as a live one.

## 2. Why daily-or-better latency is already more than this product needs

The decision the app makes is **"store for N months, or sell now"**. The window it
recommends is 1–8 months wide. A price that is hours old and a price that is three days
old make no difference to a decision measured in seasons. What *does* matter:

1. **Freshness you can see** — the observation date next to the number (done: the
   `Live prices` strip and the footer both print it).
2. **Coverage** — more markets than WFP's 27 (eSoko: 68).
3. **Trust** — validated before publication, never silently guessed (done: the publish
   guard).

So the correct target is *"newest published observation, surfaced within minutes of it
appearing"*, not streaming. That is what the next section implements.

## 3. The path a price travels (what we built)

```
 eSoko export / WFP extract                     pipeline/live.py
        │                                             │
        │  1. adapters normalise every source to      │  2. publish guard:
        │     one row shape (sources.py)              │     shape, range, districts,
        │                                             │     staleness, coverage, collapse
        ▼                                             ▼
   ┌────────────┐   rejected? keep the previous  ┌──────────────┐
   │  source    │ ─────────────────────────────► │  last good   │  (nothing is served
   └────────────┘   snapshot, log the rejection  │  snapshot    │   from a bad batch)
                                                 └──────┬───────┘
                                                        │ 3. one transaction:
                                                        │    schema, replace, audit row
                                                        ▼
                                              ┌──────────────────┐
                                              │  Turso (Postgres- │
                                              │  compatible DB)   │
                                              └────────┬─────────┘
                                                       │ 4. GET /api/prices
                                                       │    (serverless function,
                                                       │     read-only token)
                                                       ▼
                 browser ──► ./api/prices ──► ./data/live.json ──► ./data/data.json
                            (live API)        (mirror, same          (model + history,
                                               shape, 5-min           the thing that
                                               cache)                 always works)
```

Every step of that path exists as code:

| Step | File | Tested by |
|---|---|---|
| source adapters (WFP today, eSoko when signed) | `pipeline/sources.py` | `pipeline/test_live.py` |
| publish guard (7 checks, refuses bad batches) | `pipeline/live.py` | `pipeline/test_live.py` (26 tests) |
| database schema + audit trail | `pipeline/schema.sql` | applied idempotently on publish |
| live read API | `server/prices.mjs` + `api/prices.mjs` + `web/netlify/functions/prices.mjs` | `web/test/api.test.mjs` (10 tests) |
| frontend fallback chain + freshness badge | `web/src/lib/live.ts`, `App.tsx`, `FarmerView.tsx` | typecheck + headless render |
| scheduled refresh | `.github/workflows/refresh.yml` | runs the same commands as §5 |

### The 4-minute runbook

```bash
# local, no credentials: validate and write the mirror only
python pipeline/live.py --no-db

# validate only, write nothing
python pipeline/live.py --dry-run

# against the real database
export TURSO_DATABASE_URL="turso://<db>-<org>.turso.io"   # or https://...
export TURSO_AUTH_TOKEN="<write-token>"                    # keep it a secret
export TURSO_READ_TOKEN="<read-only-token>"                # what the API prefers
python pipeline/live.py
```

The API itself is then `GET /api/prices` — no token in the browser, ever: the function
holds the credential and returns only public market prices.

### The 7 publish guards

A batch is **rejected in full** if any of these fail (previous snapshot keeps serving,
and the rejection is written to `refresh_log`):

1. **shape** — all fields present, right types, `ym` is `YYYY-MM`
2. **range** — price positive and below 20 000 RWF/kg (catches a 25 kg basket priced
   as a kilo, or the wrong currency)
3. **known districts** — must be one of Rwanda's 30, so the string
   `Administrative unit not available` can never come back
4. **known crops** — must be one of our six
5. **staleness** — newest observation within 6 months (WFP) / 2 months (eSoko)
6. **coverage** — at least 90 (district, crop) pairs and 18 districts
7. **no collapse** — the batch must not fall below half of what is live now

## 4. The agreement to negotiate with eSoko

Ask for these six things; everything else in this codebase is already waiting for them:

1. **A bulk export or a pull endpoint**, not a dashboard: CSV or JSON, one row per
   observation, with the fields we already consume:
   `date, market, admin2 (district), commodity, price, unit, currency`.
   *Unit must be per kg and currency RWF* — the adapter drops anything else rather
   than guessing (tests: `test_esoko_*`).
2. **Frequency**: daily or weekly pull is plenty. We refresh on a schedule
   (`.github/workflows/refresh.yml`, default daily); if they can offer a webhook, the
   same publisher runs on that event with no other change.
3. **Depth of history**: our seasonal model needs **the full history, not just the
   latest file** — 10+ years if available, else the shape is fitted on WFP history and
   eSoko supplies the current level. The adapter merges either way.
4. **Coverage list**: the 68 markets with their districts, so we can map them to the
   30 districts and tell which of the 23 estimated districts become live.
5. **Licence for redistribution** of derived numbers (we publish price *levels* and
   forecasts, not their raw file). WFP's extract is CC-BY; we need the equivalent
   statement from eSoko.
6. **A named contact and change notice** — if a field is renamed, our adapter must not
   silently start dropping rows; the guard would catch it as a collapse, but a human
   notice is faster.

Nothing in this list requires eSoko to change how they collect. It is an access and
format agreement, not a data-collection commitment.

## 5. What changes the day eSoko connects

| | Today (WFP) | With eSoko |
|---|---|---|
| markets feeding the app | 27 still reporting | up to 68 |
| districts with a *recent* price | 6 this month | potentially all 30 (Nyaruguru depends on Miko reporting) |
| freshness of the badge | months behind (extract ends 2026-08) | days to weeks |
| districts shown as `est.` | 23 | shrinks as markets come back |
| how it connects | `python pipeline/live.py --source esoko` with `SOKO_ESOKO_PATH` set | same command, no other code change |

The verdict may also change, under one rule: **a live observation replaces the model's
price only when it is strictly newer than anything the model has seen.**

Why the restriction exists, with numbers: for Kirehe potatoes in 2026-07 the model's
price (a deseasonalised level times the seasonal index) is 498 RWF/kg while the raw
monthly median across the district's markets is 712 — 43% apart. Both are defensible
for the same month, but a page showing two prices for one month is worse than a page
showing one, and the backtest's own base is the raw value, so the smoothed model value
wins until the data genuinely moves on. `livePriceFor()` in `web/src/lib/live.ts`
enforces exactly three conditions: the district is reporting (not `estimated`), the
row's `ym` is a well-formed month, and `ym > crop.as_of`.

So today, with WFP: no pair is newer than the model, verdicts are identical to the
shipped app, and the badge reports freshness. The day a source publishes a month the
extract has not reached, that observation becomes "what you can get today", the
forecast keeps the fitted seasonal shape, and the daily rebuild absorbs it properly.
The badge always names the observation it used, and `Method` still states the model's
rebuild date.

## 6. What we deliberately did not build

- **Streaming / WebSockets** — no source produces second-level data; it would add a
  failing connection to a page that must open on a farmer's phone.
- **A second copy of the model in the database** — the forecast comes from
  `data.json`, rebuilt by the audited pipeline. The live layer supplies *observations*,
  not predictions; only one code path produces advice, so the website, the phone demo
  and the backtest can never disagree.
- **Client-held credentials** — the browser only ever sees `/api/prices` or the public
  mirror. The database token lives in server environment variables.
