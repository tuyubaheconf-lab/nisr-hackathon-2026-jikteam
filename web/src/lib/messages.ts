// Explicit .ts extensions: these modules are also imported by the Node tests,
// which run the TypeScript sources directly with --experimental-strip-types.
import { monthName, type Advice } from "./advice.ts";
import { num, signed } from "./format.ts";
import type { Lang } from "./types";

/**
 * The text a farmer actually receives. Kept in one place so the SMS preview on
 * the advice page and the feature-phone demo can never disagree with each
 * other, and both stay inside the ~160 character budget of a single SMS.
 */

export interface CropWord {
  name: string;
  rw: string;
}

const cropWord = (crop: CropWord, lang: Lang) => (lang === "rw" ? crop.rw : crop.name);

export function smsText(
  lang: Lang,
  district: string,
  crop: CropWord,
  advice: Advice,
  quantityKg: number
): string {
  const month = monthName(advice.best.ym, lang);
  const bags = Math.max(1, Math.round(quantityKg / 100));
  const cropName = cropWord(crop, lang);

  if (advice.action === "hold") {
    const total = signed(Math.round(advice.netForQuantity));
    if (lang === "rw") {
      return (
        `${district}: TEGEREZA ${cropName} amezi ${advice.best.months}, ugurishe muri ${month}.\n` +
        `Ubu ${num(advice.priceToday)} RWF/kg, noneho biteganyijwe ${num(advice.best.expectedPrice)}.\n` +
        `Inyungu ${signed(Math.round(advice.best.netPerKg))} RWF/kg, ni ${total} RWF kuri ${bags} amasaho.`
      );
    }
    return (
      `${district}: HOLD your ${cropName} ${advice.best.months} months, sell in ${month}.\n` +
      `Now ${num(advice.priceToday)} RWF/kg, expected ${num(advice.best.expectedPrice)}.\n` +
      `Gain ${signed(Math.round(advice.best.netPerKg))} RWF/kg, about ${total} RWF on ${bags} bags.`
    );
  }

  if (lang === "rw") {
    return (
      `${district}: GURISHA ${cropName} UBU kuri ${num(advice.priceToday)} RWF/kg.\n` +
      `Kubika ntibyishyura uku kwezi.` +
      (advice.nextWindow ? `\nIgihe cyo kubika: ${monthName(advice.nextWindow.ym, "rw")}.` : "")
    );
  }
  return (
    `${district}: SELL your ${cropName} NOW at ${num(advice.priceToday)} RWF/kg.\n` +
    `Storing does not pay this month.` +
    (advice.nextWindow ? `\nNext storage window: ${monthName(advice.nextWindow.ym, "en")}.` : "")
  );
}

/** Menu text for the step the caller is on. Lines are what the SIM shows. */
export function ussdMenu(
  lang: Lang,
  step: "start" | "crop" | "district" | "quantity" | "result",
  opts: {
    crops?: string[];
    districts?: string[];
    page?: number;
    advice?: Advice;
    district?: string;
    quantityKg?: number;
  } = {}
): string[] {
  const rw = lang === "rw";

  if (step === "start") {
    return [
      rw ? "SokoRyari?" : "SokoRyari?",
      rw ? "1. Inama ku gihingwa" : "1. Advice for my harvest",
      rw ? "2. Ibiciro by'isoko" : "2. Market prices",
      rw ? "3. Ububiko" : "3. Shared storage",
    ];
  }

  if (step === "crop") {
    return [
      rw ? "Hitamo igihingwa:" : "Choose your crop:",
      ...(opts.crops ?? []).map((c, i) => `${i + 1}. ${c}`),
    ];
  }

  if (step === "district") {
    const list = opts.districts ?? [];
    const page = opts.page ?? 0;
    const slice = list.slice(page * 8, page * 8 + 8);
    const lines = [rw ? "Hitamo akarere:" : "Choose your district:"];
    slice.forEach((d, i) => lines.push(`${i + 1}. ${d}`));
    if (list.length > (page + 1) * 8) lines.push(`9. ${rw ? "Ibindi" : "More"}`);
    lines.push(`0. ${rw ? "Subira" : "Back"}`);
    return lines;
  }

  if (step === "quantity") {
    return [
      rw ? "Ufite ibingaga?" : "How much do you have?",
      rw ? "1. 100 kg" : "1. 100 kg (1 bag)",
      rw ? "2. 500 kg" : "2. 500 kg (5 bags)",
      rw ? "3. 1 tonne" : "3. 1 tonne",
      rw ? "4. 5 tonnes" : "4. 5 tonnes",
      `0. ${rw ? "Subira" : "Back"}`,
    ];
  }

  const a = opts.advice!;
  if (rw) {
    return a.action === "hold"
      ? [
          `INAMA: TEGEREZA amezi ${a.best.months}`,
          `Ugurishe muri ${monthName(a.best.ym, "rw")},`,
          `${num(a.best.expectedPrice)} RWF/kg.`,
          `Ubu ni ${num(a.priceToday)} RWF/kg.`,
          `Inyungu ${signed(Math.round(a.best.netPerKg))} RWF/kg`,
          `kuri ${Math.round((opts.quantityKg ?? 0) / 100)} amasaho.`,
          "0. Subira",
        ]
      : [
          "INAMA: GURISHA UBU",
          `${num(a.priceToday)} RWF/kg.`,
          "Kubika ntibyishyura uku kwezi.",
          a.nextWindow ? `Bika mu ${monthName(a.nextWindow.ym, "rw")}.` : "",
          "0. Subira",
        ].filter(Boolean);
  }
  return a.action === "hold"
    ? [
        `ADVICE: HOLD ${a.best.months} MONTHS`,
        `Sell in ${monthName(a.best.ym, "en")}`,
        `at ${num(a.best.expectedPrice)} RWF/kg.`,
        `Today: ${num(a.priceToday)} RWF/kg.`,
        `Gain ${signed(Math.round(a.best.netPerKg))} RWF/kg`,
        `on ${Math.round((opts.quantityKg ?? 0) / 100)} bags.`,
        "0. Back",
      ]
    : [
        "ADVICE: SELL NOW",
        `${num(a.priceToday)} RWF/kg.`,
        "Storing does not pay this month.",
        a.nextWindow ? `Store in ${monthName(a.nextWindow.ym, "en")}.` : "",
        "0. Back",
      ].filter(Boolean);
}
