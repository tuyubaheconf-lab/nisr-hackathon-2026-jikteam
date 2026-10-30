# SokoRyari? — the business processes

*This document is about money, people and process: who this is for, what they do on which day, who pays, what it costs, and how it would be run after the hackathon. Read `docs/PROJECT_EXPLAINED.md` first for what the product is.*

**One caution before you read.** Everything in sections 1–8 about **measurement** (seasonal swings, backtest results, per-crop verdicts) comes out of our own data and code and is verifiable. Everything about **business design** (who pays, rollout, cost per farmer) is a **proposal** — reasoned and based on our measured numbers, but not yet tested with a customer. Where we estimate, we say so. Please do not present an estimate as a measured fact to a judge.

---

## 1. Who this is for, and what each one buys

We are not selling "an app". We are selling **a decision**. Four different people pay for that decision for four different reasons.

| Customer | The pain they have today | What they pay for | Would they pay? |
|---|---|---|---|
| **The farmer** (maize, sorghum, beans, potatoes) | Sells at the worst price of the year because cash and storage are missing | "Should I sell today or wait, and how much is waiting worth?" | In most models below, **nothing**. Free to the farmer, funded by someone who benefits. |
| **The co-operative / union** (already aggregates, stores, and buys from members) | Members sell in a rush, which crashes the local price the co-op itself has to pay or resell at; storage is used at the wrong times | A yes/no signal for timing, made per district and per month, plus the **planner board** for their own purchasing and storage calendar | Yes — a per-member, per-season fee. This is the easiest first sale. |
| **The district / programme manager** (district agriculture officer, ministry, development programme) | Needs to know **where** storage is worth promoting this month, and what an intervention is worth in RWF, to justify the budget | The **map + month calendar + impact calculator**: a planning and reporting tool for the whole district or programme | Yes, plausibly out of extension or programme budget — it produces the numbers they need to report upward. |
| **The financier** (SACCO, microfinance bank, warehouse-receipt/warrantage scheme, miller or trader advancing cash against future delivery) | Lends money to hold grain without understanding **which hold is worth financing**. Blanket lending to storage loses money. | A **credit-risk signal**: "this crop, district and month clears costs by X after spoilage" → which storage loans to write | This is the strongest commercial model, and we explain why in section 9. |

**The order matters.** The district officer buys credibility for us. The co-operative proves day-to-day use. The financier is where the money is. Our hackathon deliverable speaks to the first two and lays out the design for the third.

---

## 2. The farmer's process — as it is today, and as it becomes

### 2.1 Today (the as-is process)

| Step | What happens | What it costs the farmer |
|---|---|---|
| 1. Harvest | Maize/sorghum come in over a few weeks | — |
| 2. Dry and bag | Incomplete: mechanised drying reaches only **18%** of the maize harvest (Office of the Auditor General, reported to Parliament, March 2026) | Risk of mould; forced to sell damp grain at a discount |
| 3. **The forced decision** | Cash is needed now: school fees, labour, a debt, medicine. Storage available for only **33%** of harvests nationally | **Sells in the week when every market is at its lowest** |
| 4. Sell at the gate or nearby market | Price is the retail-minus-discount farmgate price, at the seasonal floor | Receives the floor price of the year |
| 5. Three months later | Price is at, or near, the seasonal peak (maize: **42%** above the floor) | The margin goes to whoever could wait |

The farmer is not making a bad decision. **Given no cash and no store, selling now is the only rational decision.** That is why the tool cannot fix the problem alone, and why sections 8 and 9 matter.

### 2.2 With SokoRyari? (the to-be process)

The new step is inserted at the moment of decision — before the bag is sold, not after:

| Step | Action | Who |
|---|---|---|
| 1 | Harvest, and **begin drying properly** — because now there is a reason to hold, the farmer has an incentive to dry to a sellable standard | Farmer |
| 2 | **Ask the question.** Website, SMS reply, or USSD menu: crop, district, quantity | Farmer (or the farmer-promoter, co-op clerk, or extension officer on their behalf) |
| 3a | **Answer: SELL.** The tool explains why in one sentence, and tells them when to come back | Farmer sells, and knows to plan a store and cash for next season |
| 3b | **Answer: HOLD until [month].** The tool shows the arithmetic: expected price, storage, interest, spoilage, transport, net gain per kg and in total RWF | Farmer acts |
| 4 | **Store safely** — own store, co-op store, or a warehouse-receipt scheme; treat the grain, keep it dry, record the bags | Farmer / co-op |
| 5 | **Cover the wait** — either the farmer has cash, borrows against the stored grain, or sells part now and holds the rest | Farmer / co-op / financier |
| 6 | **Sell in the advised month**, in the best nearby market (transport cost is in the calculation) | Farmer / co-op |
| 7 | **Measure.** Did it pay? Feed the result back so the public scoreboard stays honest | Us / co-op |

Note step 5. **The tool is only half the product.** Our own measured result makes this explicit: raising the cost of money from 12% to 24% cuts the number of months worth holding from **210 to 128** (and at 36%, to 73). So a tool that says *"hold, it is worth 158 RWF/kg"* while the farmer has no cash and must borrow at 24% is telling them to do something they can barely afford — the gain shrinks from +158 to +124 RWF/kg. **That gap is exactly the business insight, not a defect** (see section 9).

---

## 3. The monthly operating cycle (how the service is run)

Two different cycles run at the same time: a **monthly national cycle** that produces the advice for everyone, and a **continuous seasonal cycle** where farmers ask questions.

### 3.1 The monthly national cycle (5–10 working days of work per month)

| When | Step | Command / action | Who |
|---|---|---|---|
| Days 1–3 | Refetch the public price data | `python pipeline/fetch_data.py` | Data ops |
| Days 3–4 | Rebuild: clean, re-estimate the seasonal shape, re-bench the three forecasters, re-run both backtests | `python pipeline/build.py` (~40 seconds) | Data ops |
| Day 4 | **Quality gate — do not publish if any of these fail:** how many markets reported this month; how many districts dropped to `est`; does the seasonal shape still hold; how did last month's forecast actually score | run `web/test/advice.test.mjs` + `web/test/holdmonths.mjs`; read the new live-score line | Data ops + reviewer |
| Day 5 | Publish: build and redeploy the static site, and issue the monthly national planning view | `npm run build` → deploy `web/dist` | Ops |
| Day 5 | Send the district view to officers and co-ops (a one-page, per-district "this month" note) | PDF or link | Partnership lead |
| During the month | Farmers ask questions through the app / SMS / USSD; answers are computed live | — | Automatic |
| End of month | **Publish the honest scoreboard**: what the tool said, what actually happened, and the running comparison of expected vs realised | — | Data ops |

**Why this is cheap to run:** the whole product is a static site plus one data file. There is no database, no server to fall over on stage, no chart library to break. The monthly job is a 40-second script run and a redeploy. **The cost of the service is not computing — it is the messaging channel and the human follow-up.**

### 3.2 The seasonal cycle (the calendar we measured)

The tool's own behaviour, from `web/test/holdmonths.mjs` — this *is* the operating calendar:

| Month | Combinations saying HOLD | What the field team does |
|---|---|---|
| **October – December** | **1–2 of 149** | Prices are at the top of the year. Message: *sell now, and plan cash and storage for next season.* Also: the time to arrange storage and credit **before** the next harvest lands. |
| **January** | 39 of 149 | Advice starts flipping. Push the answer out as the new harvest moves. |
| **February** | **45 of 149** — the widest window of the year | Peak advisory month. This is the month the tool earns its keep. |
| **March** | 39 of 149, strongest single case (**Kirehe maize: +158 RWF/kg for an 8-month hold**) | Verify stored grain is sound; confirm the hold is still on. |
| **April – May** | 20–27 of 149 | Hold windows narrow; start preparing farmers to sell. |
| **June – September** | 6–11 of 149 | Close out positions; measure realised results; feed the scoreboard. |

**If you only remember one operational fact from this document:** October–December is the month with **no** advice to hold, and February is the month with the **most**. A programme manager who knows that will schedule storage credit and extension visits accordingly.

---

## 4. The delivery channels and their processes

| Channel | Reaches | Process | Status |
|---|---|---|---|
| **Website** (four tabs) | Smartphone users, co-op clerks, officers, judges | Open the page, choose crop/district/quantity/month, read the verdict. No login, no data cost beyond the page. | **Built and tested** |
| **SMS reply** | Any phone | Farmer texts `MAIZE KIREHE 500`; receives a short reply: verdict, month, net RWF/kg, and one line of why. Message templates are drafted in both English and Kinyarwanda. | Designed; requires a telecom/shortcode partner |
| **USSD menu** | Any phone, no smartphone, no data | Farmer dials a code; presses: 1 crop → 2 district → 3 quantity → reads the verdict on screen. Volume and month can be simplified to a one-screen answer. | Designed; requires a telecom partner |
| **Farmer-promoter / extension officer** | The least-connected farmers | The officer asks on their behalf on the website and delivers the answer face to face, and uses the **month calendar** to plan their own visits | Built (the planner board) |
| **Co-operative clerk** | All co-op members at once | The co-op runs the board for its whole area, and uses the calendar to schedule its own purchases and store use | Built |

**Written down and honest:** SMS and USSD tariffs and shortcode costs are set by the telecom operator and must be quoted by them. We have not invented a price for them.

---

## 5. How the money flows — three candidate models

### Model A — Public good (funded, free to the farmer)

```
Ministry / district / development programme
        │ pays for extension & advisory (as they already do)
        ▼
SokoRyari? service  ──►  free advice to farmers, officer tools included
```

- **Pros:** aligns with NST2 (post-harvest losses below 5% by 2029) and with the fact that the tool's value is a **public** benefit — a district where nobody dumps grain in one week has a smoother local price for everyone. Farmers pay nothing, so there is no barrier to the poorest.
- **Cons:** depends on a budget cycle, not on customers; no market pressure to stay accurate; "another donor project".
- **Realistic first customer:** the district officer / programme manager, because the planner board produces exactly the numbers they must report upward.

### Model B — Co-operative subscription

```
Co-operative / union  ──pays per member, per season──►  SokoRyari?
        ▲                                                │
        └── its members get the advice; the co-op gets───┘
            the planner board + its own storage calendar
```

- **Why this works:** a co-op already does the things the advice needs — aggregation, storage, purchase, transport. It can **act** on the advice as a single decision for hundreds of farmers, which means one subscription changes behaviour at scale. It also directly protects the co-op's own margin: if members dump grain in one week, the local price the co-op faces collapses.
- **Pricing logic:** a per-member, per-season fee. We deliberately do not quote a number here — a defensible fee depends on a pilot with a real co-op, and the value per member is measurable with our own method (section 6).
- **Cons:** co-op capacity varies widely; needs training and a local champion; payment collection for a small fee is fiddly.

### Model C — Embedded in storage credit (the strongest commercial fit)

```
Financier (SACCO / bank / warrantage scheme / miller)
        │  needs: which storage loan is worth writing?
        ▼
SokoRyari?  ──►  credit signal  ──►  loan against stored grain
        │                                    │
        └── farmer gets cash to wait ────────┘
                         │
              sells in the advised month, repays, keeps the margin
```

- **Why this is the right one:** recall the honest numbers — maize storage pays **+72.8 RWF/kg on average but only 28% of what the model expected**, beans and rice *lose money*, and every point of interest cost closes hold windows (210 → 128 from 12% to 24%). **A lender with a blanket "finance storage" policy is taking on exactly the losses our backtest measures.** Our tool is precisely the filter that tells a lender which holds clear their own cost of capital and which do not.
- **Who pays, and out of what:** the financier earns interest on a loan they would otherwise have made blind, and avoids the losses it would have made. Paying for a decision signal out of the loan margin is a straightforward proposition.
- **The alignment and the conflict:** the same model, run without care, could push farmers to borrow in order to speculate. **Rule we hold ourselves to: the advice is free to the farmer and never conditioned on taking credit, and the tool must be able to say "sell" — the 92% of sell-advice is the proof it can.** Any funder is disclosed publicly, exactly as this document does.

---

## 6. Unit economics — what one farmer is worth

Using our **measured** per-kilogram results (they already include storage, interest, spoilage and transport):

| | Conservative | Backtested average | Best measured case |
|---|---|---|---|
| Basis | realised ≈ 27% of expected (our own honest discount) | maize holds: **+72.8 RWF/kg** | Kirehe maize asked in March: **+158 RWF/kg** for 8 months |
| 500 kg of maize held | ≈ **+14,000 RWF** | ≈ **+36,400 RWF** | ≈ **+79,500 RWF** |
| 1,000 kg of maize held | ≈ +27,000 RWF | ≈ +72,800 RWF | ≈ +158,000 RWF |

**Read that table carefully — the spread between columns is the honest part.** We are not claiming the best case; we are showing what the tool's own promise (+158) narrows to when the unexpected happens (+14 to +36 as a realistic expectation). For a household selling 500 kg, the **conservative** case is still a meaningful sum of money — roughly a season's school supplies — and that is the number to use when talking to a farmer or an investor.

**Value per district, for a programme manager:** our impact calculator does this arithmetic openly. If a district programme reaches *N* farmers holding *q* kg of maize in an advised hold, the measured average (+72.8/kg) times *N* × *q* is the expected gross value, and the calculator shows the assumptions rather than a single impressive total. Deliverable: an officer can put **their** numbers in and get a defensible figure for a budget request.

**Cost side — the part we have to be honest about:**

| Cost to run the service | Honest estimate |
|---|---|
| Hosting | **Effectively zero.** It is a static site and one 144 KB file; free tiers of Netlify/Vercel/GitHub Pages cover it. |
| Data | **Zero.** WFP VAM prices (CC-BY) and NISR boundaries are public. |
| The monthly rebuild | ~40 seconds of computing, plus half a day of a data person's time for the quality gate and the scoreboard. |
| SMS / USSD delivery | **Unknown until a telecom quotes it.** This is the dominant marginal cost per farmer, and we refuse to invent it. |
| Farmer support, training, follow-up | The real cost, and the one that cannot be automated: someone must explain the answer, in Kinyarwanda, to a farmer who has never been told "hold" before. |

**Conclusion that drives the whole design:** the marginal cost per farmer is dominated by **the channel and the human follow-up, not by the software**. So the software's job is to be as close to free as possible — which is why it is a static site with no database, and why it builds in one command from public data.

---

## 7. How the service would be operated after the hackathon

**Minimum viable operation (one small team):**

| Role | Time | Responsibility |
|---|---|---|
| Data ops | ~1 day/month | Refetch, rebuild, run the quality gate, publish, keep the honest scoreboard |
| Analyst | ~1–2 days/month | Review forecast accuracy against what actually happened; flag a regime change (a drought, an import policy) |
| Partnership lead | Part-time | Co-operatives, district officers, telecom, financier |
| Field support | In-season | Training farmers and farmer-promoters; Kinyarwanda materials |

**Technical operation, in one line:** *no servers, no database, one monthly script run and one redeploy.* Nothing can page you at 2am.

**Governance and ethics rules we would hold:**

1. The advice is **free to the farmer** and never bundled with a loan or a purchase obligation.
2. Any funder or buyer is **disclosed publicly** — no silent buyer funding advice on the crop they buy.
3. **Farmer data is not a product.** The tool does not need names, phone-verified identities or farm locations to answer; it needs crop, district, quantity.
4. **The tool must be able to say "sell".** Measured proof: 92% of its advice is sell.
5. **Errors are published.** The monthly scoreboard compares expected with realised, including the bad months.

---

## 8. Risks, and what we do about them

| Risk | How serious | Response |
|---|---|---|
| **The farmer has no cash to hold** — the constraint is money, not information | **Highest.** Our own finding: each point of interest cost closes hold windows (210 windows at 12% → 128 at 24% → 73 at 36%), and Kirehe maize asked in March is worth +158 RWF/kg at 12% but only +124 at 24% | Position the tool inside storage credit (Model C), and make the cost sliders honest so a farmer sees the truth before borrowing. Cheaper working capital is the real intervention; we make it targetable. |
| **No storage available** (only 33% of harvests nationally) | High | The advice still helps: it tells a farmer to sell *without regret* and to plan. Bundled with co-op storage and warehouse-receipt schemes in the pilot. |
| **Thin price coverage** — only 27 markets still report in 2026, in 6 districts | High, and it is our data's biggest weakness | We mark every computed price as `est`; we refuse to present a stale price as live; a pilot targets districts with live reporting; we publish a "please report prices" note to partners. |
| **Regime change the model cannot see** (drought, import ban, election) | Medium | The model deliberately uses only the seasonal shape plus a level; the 8% gate and the 92% sell-rate mean a wrong model mostly produces *conservative* advice; the monthly scoreboard catches drift early. |
| **Adverse selection** — only the farmers already in a cheap month ask | Medium | It is a feature: the advice only opens the window when it is worth it. Reported as a share of queries, not hidden. |
| **Conflicted funding** | Medium | Rule 2 above: public disclosure of every funder. |
| **Language and literacy** | Medium | Kinyarwanda first, short sentences, USSD designed for feature phones; a native speaker proofreads the text before the final round. |
| **Small sample on some crops** (single-digit hold counts) | Low–medium | Percentages flagged as indicative; crops with a losing verdict are labelled *does not pay* and the app tells those farmers to sell. |

---

## 9. The business thesis in one paragraph

**Rwanda does not have a warehousing problem before it has a working-capital problem.** Our backtest says it plainly: maize storage returns **+72.8 RWF/kg** on average, and every percentage point of interest cost closes hold windows — from 210 windows at a 12% cost of money down to 128 at 24% and 73 at 36% — while beans and rice lose money at any realistic cost. So the scarce resource is not a shed — it is *the ability to know, per crop, per district, per month, and per cost of money, which hold is worth financing.* That knowledge is exactly what we built, it is measured, it is honest about where it fails, and it is cheap enough to give away to the farmer. **The business is selling that decision to the people who own the constraint: co-operatives and lenders — not to the farmer.**

---

## 10. Rollout plan

| Phase | What we do | Evidence it produces |
|---|---|---|
| **Phase 0 — now (hackathon)** | The working product, this document, the deployable site, the reproducible pipeline | A method that is measured, and honest where it fails |
| **Phase 1 — one-season pilot (3–5 districts with live price reporting)** | Partner with **one co-operative**: 100–200 farmers, one crop (maize), one season. Train the clerk; run the monthly cycle; publish the scoreboard | **Realised** gain per kg for real farmers against a control group that did not receive advice. This is the only evidence that counts. |
| **Phase 2 — channel + credit** | Add SMS/USSD with a telecom; integrate the credit signal with one SACCO or warehouse-receipt scheme | Cost per farmer through a real channel, and loan-loss data proving the signal filters bad holds |
| **Phase 3 — national** | Scale the planner board to every district officer; add crops as reporting allows; widen the price-coverage request to NISR/market partners | District-level behaviour change, measured in RWF, reported upward |

---

## 11. How success is measured (KPIs)

| KPI | Why it matters | Source |
|---|---|---|
| **Advice delivered** (queries per month, by district and crop) | Adoption; and it tells us which districts need price reporting | App / SMS logs |
| **Share of advice that is "hold"** | Should stay low (ours is **8.1%**). If it climbs, we have loosened a gate and are gambling with farmers' money | Backtest + live |
| **Realised vs expected gain** | Our own discipline metric: expected **+100.7**, realised **+27.0 RWF/kg** today. This gap is published monthly | Scoreboard |
| **Share of holds that were profitable** | Currently **58.6%** overall; **86%** for maize | Scoreboard |
| **Districts with live price reporting** | The thing that most limits accuracy. 5 of 27 today | Pipeline output |
| **Farmer-reported income change** | The only outcome that ultimately matters | Pilot survey, Phase 1 |
| **Cost per farmer per year** | Must be dominated by the channel, not the code | Ops records |

---

## 12. What the hackathon deliverable proves, and what a business still needs

| Proved now | Still needed for a real business |
|---|---|
| The method works on 13 years of real prices (76,933 observations, 2014–2026), and the forecast beats the benchmark (8.3% vs 13.7% error) | Field validation with real farmers in a real season |
| The economic backtest is honest — including the crops where storage loses money | A channel (telecom) and a quoted cost per message |
| The advice is free to the farmer and can say "sell" 92% of the time | A first paying customer: one co-operative, or one lender |
| The product runs at effectively zero hosting cost from public data | A small team and a budget for the human follow-up |
| The business models, unit economics and risks are written down | A pilot's realised numbers — the only thing that turns this document from a proposal into a case |

---

*Measurement in this document (swings, backtests, verdicts, the month-by-month calendar) regenerates by running `python pipeline/build.py`. Business design is a proposal and is labelled as such.*
