/**
 * The live price feed client.
 *
 * Two endpoints, tried in order:
 *   1. ./api/prices        the serverless function reading Turso (real-time)
 *   2. ./data/live.json    the mirror the pipeline writes on every publish
 *
 * Both return the same shape, so the UI never knows which one it got; if both
 * fail we return null and the app falls back to the static data.json it has
 * always used. A dead feed degrades the freshness of the numbers, never the
 * page.
 */

export interface LiveRow {
  district: string;
  crop: string;
  price: number;
  ym: string;
  market: string | null;
  /** how many markets in the district contributed to this median */
  markets?: number;
  source: string;
}

export interface LiveFeed {
  source: string;
  as_of: string;
  generated: string;
  refreshed_at: string;
  count: number;
  rows: LiveRow[];
}

const ENDPOINTS = ["./api/prices", "./data/live.json"];
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function usable(payload: unknown): payload is LiveFeed {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return p.ok === true && Array.isArray(p.rows) && p.rows.length > 0;
}

export async function fetchLive(timeoutMs = 4000): Promise<LiveFeed | null> {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const payload: unknown = await res.json();
      if (usable(payload)) {
        payload.rows = payload.rows.filter(
          (r) =>
            r &&
            typeof r.district === "string" &&
            r.district.length > 0 &&
            typeof r.crop === "string" &&
            r.crop.length > 0 &&
            typeof r.price === "number" &&
            Number.isFinite(r.price) &&
            r.price > 0 &&
            r.price < 20000 &&
            typeof r.ym === "string" &&
            YM_RE.test(r.ym)
        );
        return payload.rows.length > 0 ? payload : null;
      }
    } catch {
      // offline, blocked, timed out, or a JSON parse error: try the next one
    }
  }
  return null;
}

/** "2026-08" lookup for a district+crop, e.g. get("Kirehe|maize"). */
export function liveIndex(feed: LiveFeed | null): Map<string, LiveRow> {
  const index = new Map<string, LiveRow>();
  if (!feed) return index;
  for (const row of feed.rows) {
    index.set(`${row.district}|${row.crop}`, row);
  }
  return index;
}

/** ISO timestamp -> "2026-10-28 03:17 UTC", or an em dash when absent. */
export function formatRefresh(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/**
 * May this observation replace the model's own price for "what can I get
 * today"?
 *
 * Only when it is **strictly newer** than anything the model has seen. For a
 * month the model already holds, its number is a deliberate, documented
 * smoothing (level x seasonal index) built from that same observation, and
 * the app would otherwise show two different prices for one month — a live
 * median in the badge and a fitted value in the verdict.
 *
 * The day a source publishes a month the extract has not reached yet — the
 * real-time case — this returns the fresh observed price, and the verdict
 * uses what the market actually paid rather than a model extrapolation.
 *
 * Estimated districts are excluded: while the model is still carrying a
 * district forward, one fresh row must not silently contradict the amber
 * "no market has reported" warning beside it. The daily rebuild absorbs the
 * observation, clears the flag, and the price starts flowing from then on.
 */
export function livePriceFor(
  row: LiveRow | null | undefined,
  crop: { as_of: string; estimated: boolean } | null | undefined
): number | undefined {
  if (!row || !crop) return undefined;
  if (crop.estimated) return undefined;
  const price = row.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return undefined;
  if (typeof row.ym !== "string" || !YM_RE.test(row.ym)) return undefined;
  // YYYY-MM compares correctly as a string: "2026-10" > "2026-08".
  if (!(row.ym > crop.as_of)) return undefined;
  return price;
}
