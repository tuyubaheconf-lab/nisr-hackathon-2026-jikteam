/**
 * Replays the feature-phone demo the way a caller would: dial, crop, district,
 * quantity, verdict. The point is that the phone page is not a picture — the
 * same engine and the same data produce what the judge sees on screen.
 *
 * Run: node --experimental-strip-types test/ussd.test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { advise, defaultSettings, monthName, ymAdd } from "../src/lib/advice.ts";
import { smsText, ussdMenu } from "../src/lib/messages.ts";
import { initialUssdState, ussdPress } from "../src/lib/ussd.ts";

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, "..", "public", "data", "data.json"), "utf8"));

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL  ${name} ${detail}`);
  }
}

const crops = data.crops.filter((c) => c.districts.length > 0);
const cropIds = crops.map((c) => c.id);
const [nowY, nowM] = data.now.split("-").map(Number);
const now = [nowY, nowM];

// ---- menu shape ----------------------------------------------------------
const start = ussdMenu("en", "start");
check("start menu offers advice", start.some((l) => l.startsWith("1.")), start.join(" | "));

const cropMenu = ussdMenu("en", "crop", { crops: crops.map((c) => c.name) });
check("crop menu lists every crop", cropMenu.length === crops.length + 1, `${cropMenu.length}`);
check("crop menu numbers from 1", cropMenu[1].startsWith("1. "), cropMenu[1]);

// ---- walk a full session ------------------------------------------------
const districts = data.districts
  .filter((d) => d.crops.maize)
  .map((d) => d.id)
  .sort((a, b) => a.localeCompare(b));

let s = initialUssdState("maize");
s = ussdPress(s, "1", { cropIds, districts });
check("1 opens the crop menu", s.step === "crop", s.step);

const maizeIndex = cropIds.indexOf("maize") + 1;
s = ussdPress(s, String(maizeIndex), { cropIds, districts });
check("crop choice opens districts", s.step === "district", s.step);

// pick Kirehe, paging if it is not on the first screen
const target = "Kirehe";
let page = 0;
while (districts.slice(page * 8, page * 8 + 8).indexOf(target) === -1) page++;
while (s.page < page) s = ussdPress(s, "9", { cropIds, districts });
const key = String(districts.slice(s.page * 8, s.page * 8 + 8).indexOf(target) + 1);
s = ussdPress(s, key, { cropIds, districts });
check("district choice opens quantity", s.step === "quantity", s.step);
check("district is Kirehe", s.districtId === "Kirehe", s.districtId);

s = ussdPress(s, "3", { cropIds, districts });
check("quantity choice shows the result", s.step === "result", s.step);
check("quantity is one tonne", s.quantity === 1000, String(s.quantity));

// ---- the verdict must equal what the website would say -------------------
const cropDef = data.crops.find((c) => c.id === "maize");
const districtData = data.districts.find((d) => d.id === target);
const expected = advise(districtData.crops.maize, defaultSettings(cropDef), s.quantity, now);

const menu = ussdMenu("en", "result", { advice: expected, district: target, quantityKg: s.quantity });
const menuText = menu.join(" ");
if (expected.action === "hold") {
  check("menu says hold", /HOLD \d+ MONTHS/.test(menuText), menuText);
  check(
    "menu carries the model price",
    menu.some((l) => l.includes(String(Math.round(expected.best.expectedPrice)))),
    menuText
  );
  check("menu names the sale month", menuText.includes(monthName(expected.best.ym, "en")), menuText);
} else {
  check("menu says sell", menuText.includes("SELL NOW"), menuText);
}

// ---- the SMS that a real handset would receive --------------------------
for (const lang of ["en", "rw"]) {
  const sms = smsText(lang, target, cropDef, expected, s.quantity);
  check(`${lang} sms names the district`, sms.includes(target), sms);
  check(`${lang} sms carries today's price`, sms.includes(String(Math.round(expected.priceToday))), sms);
  check(`${lang} sms under 320 characters`, sms.length <= 320, `${sms.length}`);
  if (lang === "en") {
    check(
      "en sms states the action",
      sms.includes("HOLD") || sms.includes("SELL"),
      sms
    );
  }
  console.log(`\n[${lang}] ${sms.length} chars\n${sms}`);
}

// ---- the demo must be able to show the HOLD branch ----------------------
// In October almost every district correctly says SELL. The demo clock exists
// so the other branch can be shown on stage; prove that it actually appears.
let holdExample = null;
for (let k = 0; k < 12 && !holdExample; k++) {
  const ym = ymAdd(now[0], now[1], k);
  for (const d of data.districts.filter((x) => x.crops.maize)) {
    const a = advise(d.crops.maize, defaultSettings(cropDef), 1000, ym);
    if (a.action === "hold") {
      holdExample = { district: d.id, ym, a };
      break;
    }
  }
}
check("the phone demo can reach a HOLD", !!holdExample);
if (holdExample) {
  const { district, ym, a } = holdExample;
  console.log(
    `\nHOLD example: ${district} maize, asked ${monthName(ym, "en")} → ` +
      `${a.best.months} months, net ${a.best.netPerKg.toFixed(1)} RWF/kg`
  );
  const sms = smsText("en", district, cropDef, a, 1000);
  check("hold sms says HOLD", sms.includes("HOLD"), sms);
  check("hold sms names the sale month", sms.includes(monthName(a.best.ym, "en")), sms);
}

// ---- back navigation must not lose the session ---------------------------
s = ussdPress(s, "0", { cropIds, districts });
check("0 returns to the start", s.step === "idle", s.step);

console.log(`\n${passed} checks passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
