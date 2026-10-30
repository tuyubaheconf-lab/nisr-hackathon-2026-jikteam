/**
 * GET /api/prices — the read path for live market prices.
 *
 * Shared by both deploy targets; the wrappers adapt it to each platform:
 *   web/netlify/functions/prices.mjs   Netlify (event, context)
 *   api/prices.mjs                     Vercel   (req, res)
 *
 * Reads from Turso over plain HTTPS. The token never leaves this process:
 * it arrives in a header, is used in one fetch, and is not echoed into any
 * response body or log line.
 *
 * Response, on success:
 *   {
 *     "ok": true,
 *     "source": "wfp" | "esoko",
 *     "as_of": "2026-08",          // newest observation in the snapshot
 *     "generated": "2026-10-27",   // date the model behind it was rebuilt
 *     "refreshed_at": "2026-10-28T03:17:00Z",
 *     "count": 152,
 *     "rows": [ { "district": "Kirehe", "crop": "maize", "price": 245.0,
 *                 "ym": "2026-08", "market": "Kirehe", "source": "wfp" } ]
 *   }
 *
 * Failure modes are explicit and typed so the frontend can fall back to the
 * static mirror without guessing: 503 not_configured / empty, 502 upstream.
 * No internal detail (URLs, SQL, tokens) ever reaches the client.
 */

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=300, stale-while-revalidate=600",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIMEOUT_MS = 8000;

function reply(status, body) {
  return { status, headers: HEADERS, body };
}

/** turso:// and libsql:// both mean the same HTTPS endpoint. */
function baseUrl() {
  const raw = (process.env.TURSO_DATABASE_URL || "").trim();
  if (!raw) return null;
  if (raw.startsWith("turso://")) return "https://" + raw.slice("turso://".length);
  if (raw.startsWith("libsql://")) return "https://" + raw.slice("libsql://".length);
  return raw.replace(/\/$/, "");
}

/**
 * Prefer a read-only token (turso db tokens create --read-only), falling back
 * to the writer token so a project that only has one still works. The API
 * never writes, so a leaked read-only token exposes nothing but public prices.
 */
function token() {
  return (
    (process.env.TURSO_READ_TOKEN || "").trim() ||
    (process.env.TURSO_AUTH_TOKEN || "").trim()
  );
}

/** Run one SQL statement over /v2/pipeline and return its result table. */
async function query(base, tok, sql) {
  const res = await fetch(base + "/v2/pipeline", {
    method: "POST",
    headers: {
      authorization: `Bearer ${tok}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql } },
        { type: "close" },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`turso http ${res.status}`);

  const payload = await res.json();
  const first = payload?.results?.[0];
  if (!first || first.type !== "ok") throw new Error("turso returned an error result");
  const result = first?.response?.result;
  if (!result) throw new Error("turso returned no result");

  const cols = (result.cols || []).map((c) => c.name);
  return (result.rows || []).map((row) => {
    const out = {};
    cols.forEach((name, i) => {
      out[name] = row[i]?.value ?? null;
    });
    return out;
  });
}

/** Rows that would mislead a farmer are dropped, not served. */
function sanitize(rows) {
  const good = [];
  let bad = 0;
  for (const r of rows) {
    const price = Number(r.price);
    const ok =
      typeof r.district === "string" &&
      r.district.length > 0 &&
      typeof r.crop === "string" &&
      r.crop.length > 0 &&
      typeof r.ym === "string" &&
      YM_RE.test(r.ym) &&
      Number.isFinite(price) &&
      price > 0 &&
      price < 20000;
    if (!ok) {
      bad += 1;
      continue;
    }
    good.push({
      district: r.district,
      crop: r.crop,
      price,
      ym: r.ym,
      market: r.market || null,
      source: r.source === "esoko" ? "esoko" : "wfp",
    });
  }
  return { good, bad };
}

export async function readPrices() {
  const base = baseUrl();
  const tok = token();
  if (!base || !tok) {
    return reply(503, { ok: false, reason: "not_configured" });
  }

  let rows, metaRows;
  try {
    rows = await query(
      base,
      tok,
      "SELECT district, crop, price, ym, market, source FROM prices_latest ORDER BY district, crop"
    );
    metaRows = await query(base, tok, "SELECT key, value FROM meta");
  } catch (err) {
    console.error("api/prices: upstream failure:", err?.message || err);
    return reply(502, { ok: false, reason: "upstream" });
  }

  const { good, bad } = sanitize(rows);
  if (rows.length === 0) {
    // Nothing published yet: a normal cold start, the client falls back.
    return reply(503, { ok: false, reason: "empty" });
  }
  if (bad > rows.length * 0.2) {
    // More than a fifth of the snapshot is malformed: the feed itself is
    // suspect, so refuse rather than serve a half-valid picture.
    console.error(`api/prices: ${bad} of ${rows.length} rows malformed`);
    return reply(502, { ok: false, reason: "corrupt" });
  }
  if (good.length === 0) {
    return reply(502, { ok: false, reason: "corrupt" });
  }

  const meta = {};
  for (const r of metaRows) meta[r.key] = r.value;

  const asOf = good.reduce((a, r) => (r.ym > a ? r.ym : a), "");
  const payload = {
    ok: true,
    source: good.some((r) => r.source === "esoko") ? "esoko" : "wfp",
    as_of: asOf,
    generated: meta.generated || "",
    refreshed_at: meta.published_at || "",
    count: good.length,
    rows: good,
  };
  if (bad > 0) payload.dropped = bad;

  return reply(200, payload);
}
