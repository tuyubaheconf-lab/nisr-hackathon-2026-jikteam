# How this project was made, including the AI assistance

The hackathon rules require us to disclose the use of AI tools, and to be fully responsible
for what we submit. This page is that disclosure, in the repository itself, so a judge does
not have to take it from the submission form alone.

## What we used

Our own decisions and our own verification throughout, with a **large language model coding
assistant** used as a tool inside that process — for drafting code, writing tests,
debugging, and drafting documentation text.

Concretely, the assistant was used to:

- draft and refactor source code across `pipeline/` and `web/src/`,
- write the test suites in `web/test/` and `pipeline/test_live.py`,
- debug the database publish path (three real bugs in the Turso wire format were found by
  probing the live API and are pinned by `test_argument_types_match_the_wire_contract`),
- draft the wording of the documents in `docs/`, and the interface text in `web/src/lib/i18n.ts`.

It was not used to produce any number. Every figure on the website and in the documents is
computed by `pipeline/build.py` from the raw WFP extract, and can be regenerated in one
command. Where a document and the code disagree, the code is right — that rule is written at
the bottom of `docs/PROJECT_EXPLAINED.md`.

## What is ours

- **The problem and its framing.** Reading the Auditor General's findings as a *decision*
  problem rather than only a construction problem, and aiming the product at the farmer who
  must choose a selling month.
- **The dataset choices.** WFP VAM over eSoko, 2014 onward, the five source-error corrections,
  and the decision to keep aggregate-flagged rows and publish the sensitivity that shows what
  that choice does to the bean result.
- **The model and the two gates.** Level × seasonal shape, shrinkage by `n/(n+16)`, the cheapest-third
  entry gate and the 8%-of-price margin gate — including the two failed versions that preceded
  them (a −5.3 RWF/kg first backtest, and a rule without the entry gate that produced noise).
- **The backtests.** Rolling-origin accuracy scoring, and the economic replay of 1,230 past
  decisions with all four costs charged.
- **Every interpretation.** Advising sell for rice and beans, labelling cassava a coin flip,
  publishing the +100.7 expected versus +27.0 realised gap, and saying plainly that cheap
  working capital — not warehouses — is the binding constraint.
- **The product and the pitch.** Four surfaces, the cost sliders, the `est` badge, the USSD
  session, the business models, and everything in `docs/`.

## How to check us rather than believe us

```bash
python pipeline/fetch_data.py     # re-download the public WFP extract
python pipeline/build.py          # rebuild data.json, the seasonality, the backtests
cd web && node --experimental-strip-types test/sensitivity.mjs   # the 210 / 128 / 73 sweep
cd web && node --experimental-strip-types test/holdmonths.mjs    # what the advice says each month
```

If any published figure does not survive those commands, the figure is wrong and we want to
know. Contact details are in the README.

## What we are responsible for

All of it. A tool can draft a function; it cannot be accountable for telling a farmer to hold
grain. We reviewed what we submit, we can explain each component, and we stand behind the
limits we have written down — including the ones that cost us points.
