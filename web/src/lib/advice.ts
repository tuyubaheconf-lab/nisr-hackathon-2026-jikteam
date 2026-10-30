import type { DistrictCrop, PricePoint } from "./types";

/**
 * The decision rule. This mirrors `evaluate_hold` / `decision_backtest` in
 * pipeline/build.py exactly, so what the farmer sees is what was backtested.
 *
 * Two gates, both earned from the data rather than chosen by taste:
 *   1. Only consider storing when this month sits in the cheapest quarter of
 *      the year. Storing from a middling month is how smallholders lose money.
 *   2. The expected gain must clear our own measured forecast error (8%) on top
 *      of storage, interest, spoilage and transport.
 */

export const MAX_HOLD_MONTHS = 8;
export const RISK_BUFFER = 0.08;
export const MIN_MARGIN = 0.08;
export const DEFAULT_INTEREST = 0.12;

export interface Settings {
  /** RWF per kg per month */
  storage: number;
  /** annual interest or opportunity cost, e.g. 0.12 */
  interest: number;
  /** % of value lost per month of storage */
  lossPctMonth: number;
  /** RWF per kg, one-off, to move to a better market */
  transport: number;
}

export interface Option {
  months: number;
  ym: [number, number];
  expectedPrice: number;
  storage: number;
  interest: number;
  loss: number;
  transport: number;
  totalCost: number;
  netPerKg: number;
}

export type Reason =
  | "hold_pays"
  | "not_cheap_month"
  | "thin_margin"
  | "no_data";

export interface Advice {
  action: "sell" | "hold";
  reason: Reason;
  /** the model's price for the current month, RWF/kg */
  priceToday: number;
  /** best option found, whether or not it clears the gates */
  best: Option;
  options: Option[];
  thresholdPerKg: number;
  quantityKg: number;
  netForQuantity: number;
  /** the current month's position in its own year: 0 = cheapest, 1 = dearest */
  seasonalRank: number;
  /** the next month where storing could pay, if any */
  nextWindow: { ym: [number, number]; monthsAway: number } | null;
}

export function ymAdd(y: number, m: number, k: number): [number, number] {
  const t = y * 12 + (m - 1) + k;
  return [Math.floor(t / 12), (t % 12) + 1];
}

/**
 * Model price for any month: the district's annual level times the seasonal
 * multiplier for that calendar month. This is why the app can answer for any
 * month of the year, not just the next few in the forecast array.
 */
function priceAt(crop: DistrictCrop, ym: [number, number]): number | null {
  const idx = crop.index[ym[1] - 1];
  if (crop.level > 0 && idx > 0) return crop.level * idx;
  for (const [y, m, p] of crop.forecast as PricePoint[]) {
    if (y === ym[0] && m === ym[1]) return p;
  }
  return null;
}

export function defaultSettings(crop: {
  storage_rwf_kg_month: number;
  loss_pct_month: number;
  transport_rwf_kg: number;
}): Settings {
  return {
    storage: crop.storage_rwf_kg_month,
    interest: DEFAULT_INTEREST,
    lossPctMonth: crop.loss_pct_month,
    transport: 0, // no transport assumed: you sell in your own market
  };
}

export function advise(
  crop: DistrictCrop,
  settings: Settings,
  quantityKg: number,
  now: [number, number],
  /**
   * Newest observed price from the live feed, when one exists for this
   * month. A real observation beats the model's smoothed estimate for
   * "what can I get today", so it takes priority when supplied. Callers pass
   * it only for the real current month — asking about March 2027 must compare
   * against March 2027, not against today.
   */
  livePriceToday?: number
): Advice {
  const priceToday = livePriceToday ?? priceAt(crop, now) ?? crop.now;
  const options: Option[] = [];

  for (let h = 1; h <= MAX_HOLD_MONTHS; h++) {
    const ym = ymAdd(now[0], now[1], h);
    const expectedPrice = priceAt(crop, ym);
    if (expectedPrice == null) continue;
    const storage = settings.storage * h;
    const interest = priceToday * settings.interest * (h / 12);
    const loss = expectedPrice * (settings.lossPctMonth / 100) * h;
    const transport = settings.transport;
    const totalCost = storage + interest + loss + transport;
    options.push({
      months: h,
      ym,
      expectedPrice,
      storage,
      interest,
      loss,
      transport,
      totalCost,
      netPerKg: expectedPrice - priceToday - totalCost,
    });
  }

  const fallback: Option = {
    months: 0,
    ym: now,
    expectedPrice: priceToday,
    storage: 0,
    interest: 0,
    loss: 0,
    transport: 0,
    totalCost: 0,
    netPerKg: 0,
  };
  const best = options.reduce(
    (a, b) => (b.netPerKg > a.netPerKg ? b : a),
    options[0] ?? fallback
  );

  // how cheap is this month, relative to the rest of the year?
  const monthIdx = crop.index[now[1] - 1] ?? 1;
  const sorted = [...crop.index].sort((a, b) => a - b);
  const cut = sorted[3] ?? 1; // bottom third of the 12 months
  const seasonalRank = sorted.filter((v) => v < monthIdx).length / 11;

  let action: Advice["action"] = "sell";
  let reason: Reason = "thin_margin";
  const thresholdPerKg = Math.max(MIN_MARGIN, RISK_BUFFER) * priceToday;

  if (options.length === 0) {
    reason = "no_data";
  } else if (monthIdx > cut) {
    reason = "not_cheap_month";
  } else if (best.netPerKg > thresholdPerKg) {
    action = "hold";
    reason = "hold_pays";
  }

  // when is the next month that could support storing?
  let nextWindow: Advice["nextWindow"] = null;
  if (action === "sell") {
    for (let h = 1; h <= 12; h++) {
      const ym = ymAdd(now[0], now[1], h);
      if ((crop.index[ym[1] - 1] ?? 1) <= cut) {
        nextWindow = { ym, monthsAway: h };
        break;
      }
    }
  }

  return {
    action,
    reason,
    priceToday,
    best,
    options,
    thresholdPerKg,
    quantityKg,
    netForQuantity: best.netPerKg * quantityKg,
    seasonalRank,
    nextWindow,
  };
}

export function monthName(ym: [number, number], lang: "en" | "rw"): string {
  const en = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const rw = ["Mut", "Gash", "Wer", "Mat", "Gic", "Kam", "Nya", "Kan", "Nze", "Ukw", "Ugu", "Uku"];
  return `${(lang === "en" ? en : rw)[ym[1] - 1]} ${ym[0]}`;
}
