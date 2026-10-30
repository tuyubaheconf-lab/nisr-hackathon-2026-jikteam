# Are the prices reliable? And why not eSoko?

This is the question a judge is most likely to use to test whether you understand
your own project. The short answer, then the evidence.

**Short answer.** The prices are real, published, licensed observations from the
UN World Food Programme's market monitoring, downloaded from HDX. They are
reliable for *shape* — the month-of-year cycle — in every district we cover, and
reliable for *level* only where a market still reports. That is true in 6 of
Rwanda's 30 districts. In the other 23 the app shows an estimate, labels it,
and says how old the underlying observation is. eSoko is the better long-term
source and the obvious partner; it is not the dataset this build could ingest and
backtest in the time available, for reasons set out below.

---

## 1. What we actually use

| | |
|---|---|
| Source | WFP VAM (Vulnerability Analysis and Mapping) Rwanda food prices, distributed on HDX, the UN OCHA humanitarian data exchange |
| Licence | CC-BY — reuse with attribution, which the site does |
| File | one CSV, ~20 MB, 153,204 rows |
| Fields we trust | `date`, `admin1`/`admin2`, `market`, `commodity`, `unit`, `pricetype`, `priceflag`, `currency`, `price` |
| Filters applied | `pricetype = Retail`, `unit = KG`, `currency = RWF`, `price > 0`, year ≥ 2014 |
| Usable after filters | **76,933 observations** |
| Markets with enough history to model | **91** |
| Markets still reporting in 2026 | **27** |
| Districts with a 2026 price | **6** (Kirehe, Gatsibo, Gisagara, Nyamagabe, Karongi, Nyarugenge) |
| Districts that can be modelled at all | **29 of 30** |

Reproduce every number above with:

```bash
python pipeline/build.py
```

## 2. What "reliable" means here — and where it stops

WFP's price database is the dataset used by FEWS NET, FAO, the World Bank's food
price estimates and most published market analyses on Rwanda. It is not a
scraped blog. Three honest qualifications apply:

**(a) Monitoring has thinned, sharply.** 54 of the 91 markets in the dataset last
reported in **2015**. The number of Rwandan markets WFP still prices each month
is 27, concentrated in six districts. This is visible in our own file: 106 of the
149 district-crop cells end in December 2015.

**(b) Those are retail prices, not farmgate.** A farmer selling at the gate gets
less than the market retail price. We use retail because farmgate series are not
published monthly for Rwanda. Every number on the site is therefore the *shape
and direction* of the opportunity, not a payout promise. This is stated on the
Method page and in the limits section.

**(c) WFP flags its own records, and we must tell you which ones we use.** Each
row carries `priceflag` = `actual`, `aggregate`, or `actual,aggregate`. Of the
observations we use, **8,157 (10.6%) are aggregate-flagged**. Aggregate rows are
WFP's own summary of several collections rather than a single market visit.

We keep them, for two reasons: they are WFP's published price for that market-month
(not our interpolation), and excluding them removes four of the markets that
still report in 2026. But we publish the consequence rather than hide the choice:

| If we exclude aggregate-flagged rows | Kept (shipped) | Excluded |
|---|---|---|
| Observations | 76,933 | 68,776 |
| Markets | 91 | 87 |
| Markets reporting in 2026 | 27 | 23 |
| Maize seasonal swing | 42.4% | 34.8% |
| Maize holds / realised per kg | 34 / +72.8 | 32 / +75.1 |
| **Beans** holds / realised per kg | 20 / **−21.8** | 27 / **+96.6** |
| Rice holds / realised per kg | 7 / −114.5 | 12 / −54.2 |
| Sorghum | 10 / +123.1 | 10 / +123.1 |
| Potatoes | 11 / +48.3 | 11 / +48.3 |
| Cassava flour | 18 / +6.7 | 18 / +6.7 |

**Read this as: the maize, sorghum and potato conclusions are stable. The bean
conclusion is not.** Said out loud, that is stronger than a claim that every
number is perfect: it shows you tested the choice instead of inheriting it.

To reproduce the right-hand column, add one line to `pipeline/build.py` in
`load_rows()`, rebuild, and compare:

```python
if "aggregate" in r["priceflag"]:
    continue
```

## 3. How the app handles a district that stopped reporting

This is the part that keeps the product honest, and it is worth understanding
before you are asked.

1. **The seasonal shape stays local.** A district's month-of-year index comes from
   its own history, pulled toward the national shape in proportion to how little
   data it has (`shrink()` in `build.py`). A district with two years of data does
   not get to claim a 75% swing.
2. **The level is re-anchored, not frozen.** We do not show a 2015 price in 2026.
   We compute the district's price *relative to the national level* at the time it
   last reported, clamp that ratio to 0.6–1.6, and re-apply it to today's national
   level. So "Kirehe is 5% cheaper than the country" survives; "maize cost 250
   RWF" does not.
3. **The screen says so.** Districts carry `estimated: true` and their real
   `as_of` date. The farmer page shows an amber banner with the date, the district
   picker labels each entry `measured 2026-08` or `est. 2015-12`, and the Method
   page states the coverage in plain numbers.
4. **The map dims them.** Estimated districts are drawn at 45% opacity, with the
   legend entry "Estimated (no recent data)".

## 4. Data defects we found in the source and corrected

The WFP extract mislabels five markets. Left alone, they produced a district
called **"Administrative unit not available"** (a literal string in the file) and
hid four real districts from the map. We correct them explicitly in
`MARKET_FIX` in `pipeline/build.py`:

| Market | Filed as | Correct district | Evidence |
|---|---|---|---|
| Gisenyi | `Administrative unit not available` | Rubavu | Gisenyi is the town in Rubavu district |
| Muhanga | Huye | Muhanga | Muhanga is a district town in Muhanga |
| Nyanza | Huye | Nyanza | Market named for the district |
| Ngororero | Nyabihu | Ngororero | Ngororero and Kabaya both trade at 200 RWF/kg; Nyabihu is higher |
| Kimironko | Gatsibo (Eastern) | Gasabo (Kigali) | Kigali price level (300 RWF/kg) vs its listed Gatsibo neighbours (183) |

After correction: **29 of 30 districts** are modelled. **Nyaruguru** is the one
gap — its only market, Miko, last reported in 2012, and we will not invent a
price for it. The app says so rather than quietly omitting the district.

Other cleaning already in the pipeline: monthly medians rather than means (one
mistyped price cannot move a month), dropping points more than 3.5× away from the
local five-month median (keying errors such as 500 typed as 5000), and bridging
only gaps of one to three months so that a real discontinuity stays visible.

## 5. Why not eSoko?

eSoko (`esoko.rw`) is Rwanda's own agricultural market information system under
MINAGRI, run with e-AgroExport. It is the *right* source politically and in the
long run: it is national, it is official, and researchers use it for exactly this
kind of price analysis.

We did not build on it for this submission, for three practical reasons:

1. **No public machine-readable feed that we could verify.** The public site is a
   price-trend dashboard ("view prices"); its analytics portal sits behind a
   login. We found no documented open API, bulk CSV, or licence statement on the
   public pages that we could point a pipeline at. Research that uses eSoko price
   data obtains it through MINAGRI or partner arrangements, not by download.
2. **The model needs ten years of monthly history, not today's price.** Our
   headline evidence is a seasonal index estimated from 2014–2026 and a backtest
   that replays past decisions. A current-price portal does not give you that
   without an agreement and an export.
3. **Licence and attribution must be unambiguous for a public submission.**
   WFP/HDX states CC-BY in the file itself, so we can redistribute the derived
   dataset with the site. That matters when the submission is a public GitHub
   repository.

None of this is a claim that eSoko's numbers are worse. It is a claim about
ingestibility tonight. The correct next step is a data partnership, and the
architecture is already shaped for it:

- `pipeline/fetch_data.py` downloads the raw file; swap the URL and it becomes
  the eSoko export.
- `pipeline/build.py` reads `prices_raw.csv` with a fixed schema. Any source that
  can produce `date, admin1, admin2, market, commodity, unit, pricetype, price,
  currency` drops straight in — no other code changes.
- Nothing in the web app knows where the data came from; it reads `data.json`.

If a judge asks "why not the government's own system?", the answer above is the
one to give, and it ends with an offer rather than an excuse: *"eSoko has better
coverage than WFP now. We built the method on the data we could obtain and
backtest; give us the eSoko export and the model improves with no rewrite."*

## 6. What would make this wrong, and how we would notice

| Risk | How it shows up | What we do |
|---|---|---|
| A district resumes reporting | `as_of` moves past 2025, `estimated` flips to false | Advice sharpens automatically on the next monthly rebuild |
| A market is mis-coded in a future release | A district with an implausible level vs its neighbours | The 0.6–1.6 relative clamp flags it; re-check `MARKET_FIX` |
| Prices move outside the seasonal pattern (drought, import ban) | Backtest error rises above the 8% risk buffer | The rule stops advising holds; the buffer is what protects the farmer |
| A source disappears | `fetch_data.py` fails loudly, build aborts | Last good `data.json` stays deployed; no silent staleness |

## 7. Sources

- WFP food prices, Rwanda — HDX: `https://data.humdata.org/dataset/wfp-food-prices-for-rwanda`
- WFP market analysis (method): `https://www.wfp.org/market-analysis`
- eSoko, Rwanda: `https://esoko.rw/` and the analytics portal `https://analytics.esoko.rw/`
- eSoko described as MINAGRI's system, used in research: IFPRI Rwanda,
  `https://rwanda.ifpri.info/2024/06/28/...`
- NISR producer price index (the official price series, national aggregates
  only — no market-level detail): `https://statistics.gov.rw/statistical-publications/economy-agriculture-infrastructure/price-indices/producer-price-index`
- District boundaries: geoBoundaries gbOpen RWA ADM2, sourced from NISR
