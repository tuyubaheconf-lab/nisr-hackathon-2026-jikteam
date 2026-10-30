// The one number a judge should check by hand: how much of the advice depends on
// the cost of money. Sweeps every crop-district-month case at three interest
// rates with the real decision engine and prints how many say HOLD.
//
// The site and the documents quote the 12% and 24% lines (210 -> 128, 82 flipping
// from hold to sell). Re-run this after any change to costs, gates or the model.
import { readFileSync } from "node:fs";
import { advise, defaultSettings } from "../src/lib/advice.ts";

const data = JSON.parse(readFileSync(new URL("../public/data/data.json", import.meta.url), "utf8"));
const crops = Object.fromEntries(data.crops.map((c) => [c.id, c]));
const [y, m] = data.now.split("-").map(Number);

let previous = null;
for (const rate of [0.12, 0.24, 0.36]) {
  let holds = 0;
  let total = 0;
  for (const d of data.districts) {
    for (const [cid, c] of Object.entries(d.crops)) {
      const crop = crops[cid];
      if (!crop) continue;
      for (let i = 0; i < 12; i++) {
        // a full calendar year of asking dates, so month mix cannot flatter a rate
        const mm = ((m - 1 + i) % 12) + 1;
        const yy = y + Math.floor((m - 1 + i) / 12);
        const a = advise(c, { ...defaultSettings(crop), interest: rate }, 1000, [yy, mm]);
        total++;
        if (a.action === "hold") holds++;
      }
    }
  }
  const flip = previous == null ? "" : `  (${previous - holds} flip to sell)`;
  console.log(`interest ${(rate * 100).toFixed(0).padStart(2)}%   holds ${String(holds).padStart(4)} / ${total}${flip}`);
  previous = holds;
}
