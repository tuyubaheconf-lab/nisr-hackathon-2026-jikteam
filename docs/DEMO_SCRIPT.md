# Demo video script — 3 minutes

Record at 1280×720 or a phone-sized window. Everything below is real, from the
shipped dataset. Do not read the screen; speak to the judge.

---

## 0:00–0:25 — The hook

> "A maize farmer in Kirehe has a few bags to sell after harvest. School fees are due, labour is due,
> a debt is due — so she sells now, like everyone else around her, and the market is full. In Kirehe's
> own measured prices, maize is cheapest in March at about 430 RWF a kilo and dearest in November at
> about 715 — two-thirds higher. She will have nothing left to sell by then. The trader with a store
> keeps the difference. Nationally, that same gap is 42%."

Nothing on screen yet, or the home page with the tagline.

## 0:25–0:50 — Show the cycle is real, not a story

Go to **My advice**. Crop: **Maize**. District: **Kirehe**.

> "This is 13 years of measured market prices — 76,933 observations from the World Food Programme,
> ending August 2026. The line is not a guess: the same seasonal shape returns every year. Kirehe is
> cheapest in March and dearest in November — a 71% gap. Nationally, maize swings 42%."

Point at the chart. Then click the month chips: **Mar 2027**.

> "Asked in March, the tool says HOLD for eight months."

The verdict turns green. Read the two numbers out loud.

## 0:50–1:25 — The money, not the model

Scroll to **Where the money goes**.

> "Everyone can say 'prices go up'. The question is whether waiting pays. Storage, interest on the
> money you cannot touch, spoilage, transport — we subtract all of it. After that, this is what is
> left per kilo, and this is what it is worth for her 500 kilos."

Change the district to **Kamonyi** and the month to **Apr 2027**. It says HOLD, worth +86 RWF per kg.
Now drag the **interest** slider from 12% up to 24%.

> "Watch what changes: not the crop, not the prices, not the warehouse — only the cost of the money.
> At 12%, a SACCO rate, it says hold, +86 RWF a kilo. At 24%, a microfinance rate, that same hold no
> longer clears its own risk and the verdict flips to sell. Across the whole country, going from 12%
> to 24% takes the number of crop-district-month cases worth storing from 210 down to 128, and flips
> 82 of them outright. The binding constraint in Rwanda is not storage space. It is the cost of
> waiting."

## 1:25–1:50 — The phone

Go to the **Feature phone** tab. Set the demo clock to **Feb 2027**, press **CALL**, then **1** (maize),
**1** (the first district), **3** (one tonne).

> "Most of these farmers do not have a smartphone and do not use the internet. So this is the product:
> a short code, a keypad, and one sentence back — in Kinyarwanda if she prefers. No data, no app."

Read the USSD screen. Then point at the SMS bubble underneath.

> "And the same advice as a single text message, in Kinyarwanda, that lands on any phone."

Say this once, plainly, because it is true and a judge will check: *"the short code itself is not
bought — that is a telecom agreement — but the menu, the logic and the message are the same engine you
just saw, on the same data."*

## 1:50–2:20 — The honest part (this is what wins)

Go to **Method & evidence**. Scroll to the decision table.

> "We did not stop at forecast accuracy. We replayed 1,230 real decisions from 2023 onward, using
> only what was known at the time, and charged the real costs. Maize: 34 holds, +72.8 RWF per kilo
> after costs, 86% of them profitable."

Then point at the bottom rows.

> "Rice and beans: it does not pay. Our own tool tells those farmers to sell. We kept that in the app
> because a storage advisor that always says 'hold' is not an advisor."

Point at the 8.1%.

> "It says hold in 8% of cases. That restraint is the product."

## 2:20–2:45 — The planner view

Go to **Planner board**. Click through a few months so the map changes colour.

> "The same model at national scale. In October, sell everywhere — price is already at the top of the
> year. Through January, February and March the map turns green where storing pays; February is the
> widest window of the year in our data, 45 of 149 crop-district cases. A cooperative or MINAGRI can
> plan grain hub intake from this instead of guessing."

## 2:45–3:00 — Close

> "SokoRyari. It does not build a warehouse. It tells you when a warehouse is worth paying for — and
> when it is not. Thank you."

---

## Before you record

1. Run `python pipeline/build.py` then `cd web && npm run build`.
2. Open the deployed URL, not localhost, so the address bar shows your real link.
3. Set the browser zoom so text is legible; hide bookmarks.
4. Have the month chips and the interest slider already proven — rehearse the Kamonyi Apr 2027 flip twice.
5. Check the **EN/RW** toggle: show one Kinyarwanda screen for three seconds. It is a scoring point.

## Questions the judges will ask

- *"Is 34 holds enough to claim 86%?"* — No. Say: "Indicative, and labelled as such. The overall
  figure across all crops is 100 holds." Never oversell a small sample; they will respect the answer.
- *"Why retail prices and not farmgate?"* — Because farmgate series are not published monthly for
  Rwanda. We use retail as the shape of the opportunity and say so in the limitations.
- *"What happens when two districts disagree?"* — They are separate panels; the district's own shape
  is shrunk toward the national one by how much data it has.
- *"Is this just eSoko?"* — eSoko publishes prices. It does not price the wait, cannot tell you the
  break-even, and does not work on a feature phone.
