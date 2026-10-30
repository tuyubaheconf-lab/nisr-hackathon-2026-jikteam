# SokoRyari?

**"Sell now, or is it worth waiting?"** — a price-timing and storage advisor for Rwandan grain and pulse farmers.

NISR Big Data Hackathon 2026 · **Track 1: Agricultural Productivity**

---

## Start here

| Read | What it is |
|---|---|
| **[docs/SUBMISSION.md](docs/SUBMISSION.md)** | For the judges: the five evaluation criteria, and the exact place in the project where each one is evidenced. Also the declaration and the pre-submission checklist. |
| **[docs/PROJECT_EXPLAINED.md](docs/PROJECT_EXPLAINED.md)** | The whole project in plain words: the problem, the four tabs, where the numbers come from, how the forecast and the decision rule work, what the backtest found, the honest limits, and a glossary. Start with this. |
| **[docs/BUSINESS_PROCESSES.md](docs/BUSINESS_PROCESSES.md)** | The business: who pays, the farmer's process before and after, the monthly operating cycle, the seasonal calendar, three revenue models, unit economics, risks and rollout. |
| **[docs/DATA_RELIABILITY.md](docs/DATA_RELIABILITY.md)** | Are the prices trustworthy? Why WFP and not eSoko, what is estimated and what is measured, the five source errors we corrected, and a sensitivity test on the one data choice that changes a verdict. |
| **[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)** | The 3-minute demo: exact clicks, what to say, and pre-written answers to the questions judges ask. |
| **[docs/TURSO_SETUP.md](docs/TURSO_SETUP.md)** | Full Turso walkthrough: create the database, mint the tokens, set them locally, on Netlify and in GitHub Actions, then verify `/api/prices`. |
| **[docs/REALTIME_DATA.md](docs/REALTIME_DATA.md)** | How prices become current without a streaming feed: the refresh path, the 7 publish guards, and the six things to ask eSoko for in an agreement. |
| **[docs/SECURITY.md](docs/SECURITY.md)** | Threat model, the permission matrix (who may read whose data), the privacy notice, and Rwanda's Law 058/2021 mapped to what we build next. |
| **[docs/AI_ASSISTANCE.md](docs/AI_ASSISTANCE.md)** | Disclosure: the AI assistant we used, what it did and did not do, and how to verify every figure yourself. |

---

## The problem in one paragraph

Rwandan farmers sell their harvest in the week they harvest it, because they have nowhere to store it and no cash to wait. That is the week when every market in the country is full and the price is at its lowest of the year. Three months later the price is high — but the farmer has nothing left to sell. The trader with a store keeps the difference. NST2 promises to cut post-harvest losses below 5% by 2029, and the Auditor General's audit reported to Parliament in March 2026 explains why that is hard: mechanised drying reaches only **18%** of the maize harvest, storage holds only **33%** of all harvests, and a third of the drying equipment is broken. The country physically cannot dry and store most of what it grows. SokoRyari? addresses the part that does not need concrete: **knowing when storing is worth the money, and knowing when it is not.**

## What it does

1. **Forecasts the price path** for a crop in a district, month by month, from 13 years of measured market prices (2014–2026).
2. **Prices the wait honestly.** It subtracts storage, interest (the cost of money tied up), spoilage and transport from the expected future price.
3. **Gives one instruction** — *sell now* or *hold until month M* — in English and Kinyarwanda, and delivers it to a feature phone: the **Feature phone** tab is a working USSD session with an SMS preview, computed by the same engine on the same data.
4. **Refuses to guess.** When the numbers do not clear the model's own measured error, it says sell. In backtesting it advised holding in only **8.1%** of month-crop cases. For most crop, district and month combinations the correct advice is to sell, and the tool gives it.

## The evidence (all numbers regenerate from the code)

| Result | Value | Where it comes from |
|---|---|---|
| Price observations used | **76,933** (2014–2026) | WFP VAM via HDX |
| Markets / districts / crops | 91 / 29 / 6 | cleaned panels |
| Maize seasonal swing (peak ÷ trough) | **42%** | month-of-year index |
| Beans / potatoes / sorghum swing | 30% / 42% / 23% | same |
| Rice swing | 10% | imports dampen the cycle — the method does not invent seasonality |
| Forecast error (MAPE), seasonal model | **8.3%** | rolling-origin backtest |
| Forecast error, seasonal-naive benchmark | 13.7% | same test |
| Decisions replayed 2023→2026 | **1,230** | economic backtest |
| Holds advised | 100 (**8.1%**) | after both gates |
| Mean realised gain when holding | **+27.0 RWF/kg** after costs | same |
| Profitable holds | 58.6% | same |
| **Maize specifically** | **34 holds, +72.8 RWF/kg, 86% profitable** | same |

The last row is the headline. The row after it matters just as much: **rice and beans storage does not pay** under realistic costs, and the app tells those farmers to sell. A tool that said "hold" every month would be worse than no tool.

## Architecture

```
prices_raw.csv ─┐
markets_raw.csv ┴─► pipeline/build.py ─► web/public/data/data.json ─► web/ (React)
                    │                     (144 KB)
                    ├─ cleaning, outlier removal, monthly panels
                    ├─ seasonal decomposition per district (shrunk to national)
                    ├─ 3 forecasters + rolling-origin backtest
                    └─ economic backtest of the decision rule

pipeline/sources.py ─► pipeline/live.py ─► Turso DB ─► /api/prices ─┐
 (WFP today, eSoko      (publish guard:     (schema.sql,   (serverless  │
  when signed)           7 checks, reject     refresh_log)   function,   │
                         bad batches, keep                              │
                         last good snapshot)                            │
                                                                       ▼
                     web/public/data/live.json  ◄── mirror, same shape, 5-min cache
                              │                                          │
                              └──────────► web/ ◄────────────────────────┘
                                            fetch order: ./api/prices
                                                         → ./data/live.json
                                                         → ./data/data.json
```
```

- **`pipeline/`** — pure Python standard library. No pandas, no numpy, no build step. Runs in ~40 s.
- **`web/`** — Vite + React + TypeScript. Charts and the map are hand-written SVG, so there is no chart library to break on stage. Ships as static files.

### Why the data pipeline has no dependencies

The machine this was built on had no pandas wheel for Python 3.14, and a submitted project should build anywhere in one command. Every statistic — seasonal index, ridge regression, Gaussian elimination, rolling backtest — is implemented in the standard library. It is also why the model is auditable: there is no black box.

## Run it

```bash
# 1. get the public data (not committed: 20 MB)
python pipeline/fetch_data.py

# 2. build the dataset and the backtests
python pipeline/build.py

# 3. validate and publish the live snapshot (works with no credentials:
#    writes web/public/data/live.json only; add TURSO_* to publish)
python pipeline/live.py --no-db

# 4. build the site
cd web
npm install
npm run build      # -> web/dist/
npm run preview    # http://localhost:4173
```

Development server: `npm run dev`.

### Tests

```bash
cd web
node --experimental-strip-types test/advice.test.mjs    # 2,401 assertions
node --experimental-strip-types test/ussd.test.mjs      # 21: the phone session, end to end
node --experimental-strip-types test/permissions.test.mjs  # 11: the access-control truth table
node --experimental-strip-types test/api.test.mjs       # 10: the live API, token hygiene
node --experimental-strip-types test/livefeed.test.mjs  # 15: when a live price may override the model
node --experimental-strip-types test/holdmonths.mjs     # what the advice says each month
cd ..
python pipeline/test_live.py                            # 27: the publish guard
node --experimental-strip-types test/sensitivity.mjs    # prints the interest sweep the site quotes
```

The test suite checks that:
- every crop's district list matches the districts that actually carry it,
- every forecast is consecutive and positive,
- `net = expected − today − storage − interest − spoilage − transport` holds for every option,
- the rule **never** advises holding outside the cheapest third of the year or below its error threshold,
- the browser engine and the Python engine agree (the app recomputes the decision live; the backtest used Python).

## The data

| Dataset | Use | Licence |
|---|---|---|
| **WFP VAM — Rwanda food prices** (HDX) | the entire price model | CC-BY |
| **NISR district boundaries** (geoBoundaries `gbOpen` RWA ADM2, sourced from NISR's geodata portal) | the map, matching official district names | CC-BY 4.0 |
| **NST2 2024–2029** | the policy target measured against (PA-03, losses < 5% by 2029) | public document |
| **OAG audit, reported to Parliament March 2026** | why the loss rate is stuck | public record |

### Honest coverage note

Rwanda has **30 districts**. The app models **29**. Market monitoring has thinned: only **27 markets** still report in 2026, in six districts (Gatsibo, Gisagara, Karongi, Kirehe, Nyamagabe, Nyarugenge), and **23 of the 29 districts have no price at all since 2025**. For those, the app carries the last observed price forward using the **national price level** and the district's own historical position relative to it, and marks the result `est` with the date of the last real observation. We never present a stale price as live. **Nyaruguru** is the one district we cannot model: its only market, Miko, last reported in 2012, and we will not invent a price for it.

The WFP extract also mislabels five markets, which is how a district literally named `Administrative unit not available` ended up in the first build. Those are corrected explicitly in `MARKET_FIX` (`pipeline/build.py`) and documented in [docs/DATA_RELIABILITY.md](docs/DATA_RELIABILITY.md).

## Method

A price is `level × seasonal shape × noise`.

- **Level** — median of recent deseasonalised prices.
- **Seasonal shape** — for every complete year, each month's price divided by that year's mean; then averaged by calendar month, recent years weighted up. This removes inflation and trend, leaving the shape of the year.
- **Shrinkage** — a district's shape is pulled toward the national shape by `n/(n+16)`. Without this, a district with two years of data claims a 75% swing that is really noise.
- **Forecasters compared** — seasonal-naive (benchmark), level × shape, and a ridge regression on log-returns with lag features. The winner per series is chosen on held-out months only.

The **decision rule** has two gates, both learned from the data:

1. Only consider storing when the current month is in the **cheapest third of the year**. Storing from a middling month is how smallholders lose money.
2. The expected gain must clear **8% of the price** — roughly our own median backtest error — on top of all costs.

## Limitations

- **Retail, not farmgate.** A farmer selling at the gate gets less than market retail. Treat figures as the shape and direction of the opportunity, not a payout promise.
- **Costs vary enormously and are yours.** At 12% interest, **210** crop-district-month cases are worth holding; at 24%, what a microfinance loan costs, **128**, and 82 of them flip outright from hold to sell (at 36%, 73 remain). The binding constraint is the cost of money, not the number of warehouses.
- **Small samples** on some crops; read percentages as indicative where the hold count is low.
- **One season of shape.** The model does not anticipate drought, import bans or elections.
- **Not a credit product.** It prices the wait; it does not finance it.
- **Kinyarwanda text** is plain and needs a native speaker's proofread before the final round.

## Deploy

`web/dist/` is a plain static site with relative asset paths, so it runs anywhere.

- **Fastest:** drag `web/dist` onto <https://app.netlify.com/drop> — no account needed to get a live URL.
- **Vercel:** import the repo, set root directory `web`, build command `npm run build`, output `dist`.
- **GitHub Pages:** push `web/dist` to a `gh-pages` branch.

### Live prices (optional — the site works without it)

The app reads the newest published observation in this order, and degrades to the
static file at every step:

1. `GET /api/prices` — a serverless function reading Turso (`api/prices.mjs` on
   Vercel, `web/netlify/functions/prices.mjs` on Netlify)
2. `./data/live.json` — the mirror `pipeline/live.py` writes on every publish
3. `./data/data.json` — the model dataset, always present

Set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (and ideally a read-only
`TURSO_READ_TOKEN`) in the host's environment, then run
`python pipeline/live.py` locally or let the daily GitHub Actions job do it.
Copy `.env.example` for the names. Full story, including the eSoko agreement
checklist: [docs/REALTIME_DATA.md](docs/REALTIME_DATA.md).

### Security

Security headers (CSP, HSTS, framing, referrer, permissions) ship in
`web/public/_headers` (Netlify + drag-and-drop) and `vercel.json` (Vercel).
Access rules for future farmer records live in `web/src/lib/permissions.ts`,
fail-closed and tested as a truth table. There is no login and no personal
data today; the threat model and privacy notice are in
[docs/SECURITY.md](docs/SECURITY.md).

## Team

| Member | University | Role |
|---|---|---|
| _name_ | _university_ | application and deployment, data pipeline |
| _name_ | _university_ | data validation and model review, field testing, Kinyarwanda |

Built for the **NISR Big Data Hackathon 2026**, Track 1: Agricultural Productivity.

## Disclosure

We used an AI coding assistant during this project, and we say so in full in
[docs/AI_ASSISTANCE.md](docs/AI_ASSISTANCE.md): what it drafted, what it did not, and the
commands that regenerate every number on the site. The problem framing, the dataset choices,
the model and its two gates, the backtests, and every interpretation of the results are ours.
