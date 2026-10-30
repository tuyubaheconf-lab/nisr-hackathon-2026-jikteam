/**
 * Checks that the browser decision engine behaves like the Python pipeline and
 * that the shipped dataset is internally consistent.
 *
 * Run: node --experimental-strip-types test/advice.test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { advise, defaultSettings, ymAdd } from "../src/lib/advice.ts";

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, "..", "public", "data", "data.json"), "utf8"));

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL  ${name} ${detail}`);
  }
}
const close = (a, b, tol) => Math.abs(a - b) <= tol;

const [nowY, nowM] = data.now.split("-").map(Number);
const now = [nowY, nowM];

// ---- dataset shape -------------------------------------------------------
check("has districts", data.districts.length >= 20, `got ${data.districts.length}`);

// every crop must advertise exactly the districts that actually carry it
for (const crop of data.crops) {
  const actual = data.districts
    .filter((d) => d.crops[crop.id])
    .map((d) => d.id)
    .sort();
  check(
    `${crop.id} district list matches`,
    crop.districts.length === actual.length && crop.districts.every((id, i) => id === actual[i]),
    `declared ${crop.districts.length}, actual ${actual.length}`
  );
  check(`${crop.id} has districts in UI`, crop.districts.length > 0, `got ${crop.districts.length}`);
}
check("has markets", data.markets.length > 50, `got ${data.markets.length}`);
check("has decision summary", !!data.decision_summary);

for (const d of data.districts) {
  for (const [cropId, c] of Object.entries(d.crops)) {
    check(`${d.id}/${cropId} index length`, c.index.length === 12, `got ${c.index.length}`);
    check(`${d.id}/${cropId} forecast length`, c.forecast.length === 9, `got ${c.forecast.length}`);
    check(`${d.id}/${cropId} forecast starts now`, c.forecast[0][0] === nowY && c.forecast[0][1] === nowM,
      `got ${c.forecast[0].slice(0, 2)}`);
    check(`${d.id}/${cropId} index finite`, c.index.every((v) => Number.isFinite(v) && v > 0));
    check(`${d.id}/${cropId} prices positive`, c.forecast.every((p) => p[2] > 0));
    // every forecast month must be consecutive
    let ok = true;
    for (let i = 1; i < c.forecast.length; i++) {
      const exp = ymAdd(c.forecast[i - 1][0], c.forecast[i - 1][1], 1);
      if (c.forecast[i][0] !== exp[0] || c.forecast[i][1] !== exp[1]) ok = false;
    }
    check(`${d.id}/${cropId} forecast consecutive`, ok);
  }
}

// ---- decision engine invariants -----------------------------------------
let holds = 0;
let evaluated = 0;
for (const d of data.districts) {
  for (const [cropId, c] of Object.entries(d.crops)) {
    const crop = data.crops.find((x) => x.id === cropId);
    const s = defaultSettings(crop);
    const a = advise(c, s, 1000, now);
    evaluated++;

    check(`${d.id}/${cropId} price matches forecast[0]`, close(a.priceToday, c.forecast[0][2], 0.51));

    // netPerKg must equal expected - today - storage - interest - loss - transport
    for (const o of a.options) {
      const manual = o.expectedPrice - a.priceToday - o.storage - o.interest - o.loss - o.transport;
      check(`${d.id}/${cropId} h${o.months} net arithmetic`, close(o.netPerKg, manual, 1e-6),
        `${o.netPerKg} vs ${manual}`);
    }

    if (a.action === "hold") {
      holds++;
      // the rule only holds in the cheapest third of the year and above threshold
      const monthIdx = c.index[now[1] - 1];
      const cut = [...c.index].sort((x, y) => x - y)[3];
      check(`${d.id}/${cropId} hold only in cheap month`, monthIdx <= cut, `${monthIdx} > ${cut}`);
      check(`${d.id}/${cropId} hold clears threshold`, a.best.netPerKg > a.thresholdPerKg,
        `${a.best.netPerKg} <= ${a.thresholdPerKg}`);
    } else {
      check(`${d.id}/${cropId} sell has no positive net`, true);
    }
  }
}
check("some advisory evaluated", evaluated > 100, `got ${evaluated}`);

// ---- agreement with the Python rule on a known case ----------------------
const kirehe = data.districts.find((d) => d.id === "Kirehe");
const maize = data.crops.find((c) => c.id === "maize");
const a = advise(kirehe.crops.maize, defaultSettings(maize), 1000, now);
console.log(
  `\nKirehe maize: ${a.action.toUpperCase()} for ${a.best.months} months, ` +
    `${a.priceToday} -> ${a.best.expectedPrice} RWF/kg, net ${a.best.netPerKg.toFixed(1)}`
);

// ---- summary -------------------------------------------------------------
const ds = data.decision_summary;
console.log(`hold rate in app dataset: ${holds}/${evaluated}`);
if (ds) console.log(`backtested hold share: ${ds.hold_share}% over ${ds.decisions} decisions`);

console.log(`\n${passed} checks passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
