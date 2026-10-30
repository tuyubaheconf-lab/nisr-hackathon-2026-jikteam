import { readFileSync } from "node:fs";
import { advise, defaultSettings, ymAdd, monthName } from "../src/lib/advice.ts";
const data = JSON.parse(readFileSync(new URL("../public/data/data.json", import.meta.url), "utf8"));
const [y,m] = data.now.split("-").map(Number);
for (let i=0;i<12;i++){
  const ym = ymAdd(y,m,i);
  let holds=0, total=0, best=null;
  for (const d of data.districts) for (const [cid,c] of Object.entries(d.crops)) {
    const crop = data.crops.find(x=>x.id===cid);
    const a = advise(c, defaultSettings(crop), 1000, ym);
    total++; if (a.action==="hold"){holds++; if(!best||a.best.netPerKg>best.net) best={district:d.id,crop:cid,net:a.best.netPerKg,h:a.best.months};}
  }
  console.log(`${monthName(ym,"en").padEnd(9)} holds ${String(holds).padStart(3)}/${total}`, best?`best: ${best.district} ${best.crop} +${best.net.toFixed(0)}/kg in ${best.h}mo`:"");
}
