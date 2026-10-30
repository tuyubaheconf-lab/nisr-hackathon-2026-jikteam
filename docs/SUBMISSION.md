# Submission pack — NISR Big Data Hackathon 2026

Everything the judges ask for, where it lives, and what to say about it.
Deadline: **30 October 2026, 23:59**. Read this file last, before you press submit.

---

## 0. Fill these in before submitting

| What | Where it goes |
|---|---|
| **Team members** (2, at least one Rwandan citizen) — name, university, role | README §Team, and the registration form |
| **Student card** for each member | uploaded with the submission |
| **Public GitHub URL** | the form, and README |
| **Deployed app URL** | the form, and README |

The competition requires three things: **a public GitHub link, a deployed app link, and
documentation.** All three are covered below.

---

## 1. The five criteria, and where our evidence sits

100 points, 20 each. For every criterion: what we claim, and the exact thing a judge can
open to check it.

### 1. Problem understanding & relevance — 20 pts

**We claim:** the binding constraint on Rwandan grain farmers is not storage capacity but
*the decision* — whether waiting pays after the cost of waiting. The country cannot build
its way out before 2029, and even with perfect warehouses a farmer still has to choose the
month.

| Evidence | Where |
|---|---|
| The measured seasonal gap: maize cheapest month 0.83 of the annual average, dearest 1.20 → **42%** swing; potatoes 42%, beans 30%, sorghum 23%; rice 10% (imports dampen it) | website **Method → the data**; `web/public/data/data.json` |
| **NST2 PA-03** — post-harvest losses below 5% by 2029, the target we measure against | `docs/PROJECT_EXPLAINED.md` §2, site Method tab |
| **OAG audit reported to Parliament, March 2026** — mechanised drying reaches 18% of the maize harvest, storage covers 33% of harvests, a third of drying equipment is broken. This is *why* the loss target is stuck | same |
| **Track fit:** Track 1, agricultural productivity, post-harvest handling — the track hint names "post-harvest collection and storage" explicitly | README header, opening paragraph |

**Say this:** *"We read the Auditor General's finding as a decision problem, not only a
construction problem. 18% of maize is dried mechanically and 33% of harvests have storage —
so for the other two thirds the question is not 'where is the warehouse', it is 'is it worth
finding one this month, at my cost of money'."*

### 2. Data use & methodology — 20 pts

**We claim:** 76,933 measured observations from 2014–2026, cleaned with documented rules,
three forecasters compared on unseen months, and the winner chosen per series. Then a second
backtest that asks the only question that matters: *would following the advice have made
money after real costs?*

| Evidence | Where |
|---|---|
| WFP VAM Rwanda food prices via HDX, CC-BY — 153,204 raw rows → **76,933** kept, 91 markets, 29 districts, 6 crops | `pipeline/fetch_data.py`, `pipeline/build.py` |
| Five known source errors corrected explicitly (`MARKET_FIX`, the `Administrative unit not available` district, aggregate-flagged rows) | `pipeline/build.py`, `docs/DATA_RELIABILITY.md` |
| Method: level × seasonal shape × noise; district shape shrunk to national by `n/(n+16)`; shrinkage is what turned a −5.3 RWF/kg result into a positive one | `docs/PROJECT_EXPLAINED.md` §6 |
| Accuracy on **unseen** months: **8.3% MAPE** vs **13.7%** seasonal-naive — and we do *not* claim to win everywhere: 22 series to ours, 11 to ridge, 3 to naive, of 36 | site **Method → forecast accuracy** |
| Economic backtest: **1,230** decisions replayed 2023→2026, **100 holds (8.1%)**, **+27.0 RWF/kg** realised against +100.7 expected, 58.6% profitable | site **Method** |
| Per-crop honesty: maize +72.8 (86% profitable), sorghum +123.1 (95%), potatoes +48.3 (60%), cassava +6.7 (38%), beans −21.8, rice −114.5 | site **Method** table |
| Sensitivity on the one assumption that changes verdicts: interest 12%→24% drops hold windows **210→128** (82 flip), at 36% only **73** | `node --experimental-strip-types web/test/sensitivity.mjs` |
| Aggregates sensitivity: excluding WFP *aggregate*-flagged rows moves beans from −22 to +97 RWF/kg, so we call beans fragile and maize stable | `docs/DATA_RELIABILITY.md`, site Method |

**This is the criterion people lose by over-claiming.** We publish the two crops where
storage loses money, the forecast error we cannot beat on 14 of 36 series, and the fact that
the model delivered only 27% of what it predicted. A judge can re-run every number.

### 3. Tech innovation — 20 pts

| What | Why it is not a wrapper | Where |
|---|---|---|
| **A decision rule, not a forecast.** Two gates learned from the data: only store from the cheapest third of the year, and only if the gain clears 8% of the price (our own measured error) on top of storage, interest, spoilage and transport | the gates came from backtests that lost money without them | `pipeline/build.py`, `web/src/lib/advice.ts` |
| **Cost sliders that change the verdict live** — the tool prices the farmer's own cost of money, so the same crop can be *hold* at 12% and *sell* at 24% | most tools assume one cost structure for everyone | site **My advice** |
| **USSD session + SMS text, computed by the same engine** — a working feature-phone tab, not a mockup; a test replays the whole keypad session and checks the verdict matches the website | reaches farmers with no smartphone, which is most of them | `web/src/lib/ussd.ts`, `web/test/ussd.test.mjs` |
| **Live data path that cannot corrupt itself** — 7 publish guards reject a bad batch and keep the last good snapshot; read-only token for the website, write token only for the pipeline and CI | a data product that silently publishes nonsense is worse than a static one | `pipeline/live.py`, `docs/REALTIME_DATA.md` |
| **Zero dependencies in the pipeline** — ridge regression, seasonal decomposition, rolling backtest all in the Python standard library, so it builds anywhere in one command | and it is auditable: no black box to take on faith | `pipeline/build.py` |
| **Hand-written SVG** for the chart and the district map; no chart library to break during a demo | | `web/src/components/` |

**Say this:** *"The innovation is the gate, not the model. We built three forecasters, and
the honest answer is that seasonality is most of it. What is new is deciding whether the
forecast is worth acting on — the second gate refuses to gamble on a margin thinner than our
own error, which is why we advise holding in only 8% of cases."*

### 4. Usability & design — 20 pts

| What | Where |
|---|---|
| Four surfaces for four users: farmer, district officer, judge, feature phone | the four tabs |
| One instruction — **SELL** or **HOLD UNTIL [month]** — plus the full arithmetic in RWF/kg and total money | **My advice** |
| **Bilingual, English + Kinyarwanda**, switchable everywhere | every tab |
| A 30-district map coloured for the selected month, a month-by-month calendar, and an impact calculator whose assumptions are visible and consistent with the advice | **Planner board** |
| Estimates marked `est` with the date of the last real observation — a stale price is never shown as live | everywhere, and the coverage note |
| Mobile-friendly, works offline after first load, degrades to a static file if the API is slow | `web/dist`, fetch order in README |
| Access rules for future farmer records fail closed and are tested as a truth table | `web/src/lib/permissions.ts`, 11 checks |

**Say this, and mean it:** *"23 of our 29 districts have no price reported since 2025. We
could have hidden that. Instead the interface shows an `est` badge and the date of the last
real market observation, because an officer who finds out later that the number was stale
stops trusting the whole page."*

### 5. Tangible impact — 20 pts

| Evidence | Where |
|---|---|
| Per-kilogram gain measured, not projected: maize **+72.8 RWF/kg** over 8 months on a realistic hold | backtest |
| At-scale arithmetic with adjustable assumptions (farmers × kg × gain), per crop, shown only where the tool actually advises holding | **Planner board → impact** |
| **Three revenue models and unit economics** — advisory inside storage credit, per-extension-officer licence, co-operative subscription | `docs/BUSINESS_PROCESSES.md` §9 |
| The finding that matters for policy: **cheap working capital, not warehouses, is the binding constraint** — 210 hold windows at 12% interest, 128 at 24%, 73 at 36% | site Method, `sensitivity.mjs` |
| A named route to scale: USSD short code via a telecom, extension officers as the distribution channel, eSoko integration checklist | `docs/REALTIME_DATA.md`, `docs/BUSINESS_PROCESSES.md` |
| Honest about what is not proven: no field validation with farmers yet, Kinyarwanda needs a native proofread, retail ≠ farmgate | site Method → *what this cannot do* | 

---

## 2. Declaration of originality and use of AI

The competition rules require both: the work must be your own and never submitted elsewhere,
and **AI assistance must be disclosed** — *"AI tools may be used as assistants, but
participants must disclose their use and are fully responsible for the submitted work.
Failure to do so will result in disqualification."*

Disclose it in the submission form, in these words or your own (adjust to what is true):

> **Use of AI tools.** We used an AI coding assistant (a large language model agent) during
> this project, as a programming and writing assistant: it helped draft source code, tests
> and documentation text, and it helped debug the data pipeline. The problem statement,
> scope, dataset choices, model design, the two decision gates, the backtest design, the
> interface decisions and every interpretation of the results are ours. We reviewed the code,
> re-ran every figure in this repository from the raw data, and we are fully responsible for
> the submission. Every number quoted in the documents and on the website is produced by
> running the code here (`python pipeline/build.py`), not written by hand, and any judge can
> reproduce it.

Three reasons this is the right move and not a risk:

1. **Disclosure is a condition of entry.** An undisclosed submission is disqualified on
   inspection; a disclosed one is judged on its merits. The rule exists so judges know what
   they are scoring, and it explicitly *permits* AI as an assistant.
2. **You can defend the work, which is the real test.** The coaching phase is hands-on: you
   will be asked to explain the shrinkage term, why the second gate exists, why beans lose
   money and maize does not. Section 4 below is your preparation for exactly that.
3. **The evidence is reproducible.** Anything a judge checks — 76,933 observations, 8.3%
   MAPE, 210/128/73 hold windows — regenerates from a command in the README. That is the
   opposite of an answer that came out of a chat window.

---

## 3. Two minutes before you submit

- [x] `web/dist` deployed to production: **<https://sokoryari.netlify.app>**
- [x] The live URL opens, all four tabs work, the default advice shows a verdict (checked in a
      headless browser against the deployed site, not localhost)
- [x] `curl https://sokoryari.netlify.app/api/prices` returns `{"ok":true,…,"count":152}` with the
      5-minute cache header on `./data/live.json` (both fallbacks return 200)
- [ ] GitHub repository is **public**, contains `README.md`, `docs/`, `pipeline/`, `web/src/`
- [ ] `.env` is **not** in the repository (it is gitignored — confirm with `git log --all -- .env`)
- [ ] Team section in the README has both names, universities and roles
- [ ] Student cards ready for upload
- [ ] AI disclosure written into the form
- [ ] `docs/AI_ASSISTANCE.md` present in the repo (the same disclosure, in the artefact itself)

---

## 4. The six questions you will actually be asked

Answers are in `docs/DEMO_SCRIPT.md`; these are the ones that decide the score.

1. **"Is the 8.3% error good?"** It is 39% better than seasonal-naive (13.7%), and it is the
   number that sets the second gate. We do not claim it is good enough to trade on margins
   under 8%.
2. **"Why should I believe +72.8 RWF/kg?"** Because it is the *realised* result of replaying
   1,230 past decisions with all four costs charged, not a projection — and because the same
   test says beans lose 21.8 and rice loses 114.5.
3. **"Your model expected +100.7 and delivered +27. That is a 73% miss."** Yes. That gap is
   why the gate exists, and it is published on the site rather than buried.
4. **"Most districts have no recent price. Is this not just a national average?"** For 23 of
   29, the level is national and the *shape* is the district's own, shrunk by how much
   evidence it has; the app marks those `est` with the last observation date. Nyaruguru is
   excluded rather than invented.
5. **"Would a farmer trust a phone menu?"** That is why the USSD tab is a working session
   with the SMS text, not a slide — and why the business document routes distribution
   through extension officers and co-operatives rather than direct acquisition.
6. **"What is missing?"** Field validation with real farmers, a telecom short code, a signed
   eSoko feed, and a native Kinyarwanda proofread. All four are named in the repo.

---

## 5. Submitting

- Track: **Track 1 — Agricultural Productivity**
- Repository: the public GitHub URL
- Deployed app: the public URL of `web/dist`
- Documentation: `README.md` (start), `docs/PROJECT_EXPLAINED.md` (the whole project in plain
  words), plus `BUSINESS_PROCESSES.md`, `DATA_RELIABILITY.md`, `DEMO_SCRIPT.md`,
  `REALTIME_DATA.md`, `SECURITY.md`, `AI_ASSISTANCE.md`
- Declaration: originality + AI disclosure, as in §2

Keep the repository link stable after submission — the review window is 1–5 November and the
shortlist is announced on 13 November.
