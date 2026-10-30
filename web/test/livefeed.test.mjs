/**
 * Tests for the live feed client (web/src/lib/live.ts).
 *
 *    node --experimental-strip-types test/livefeed.test.mjs
 *
 * The heart of this file is livePriceFor(): the guard that decides when a
 * fresh observation may replace the model's own number in the verdict. It
 * exists because the model's price is a deliberate smoothing (level x
 * seasonal index) and the feed's price is a raw monthly median — for one
 * district-month they differed by 43%, and a page showing two prices for the
 * same month is worse than a page showing one.
 */

import assert from "node:assert/strict";
import test from "node:test";

const { fetchLive, liveIndex, livePriceFor, formatRefresh } = await import(
  "../src/lib/live.ts"
);

const row = (over = {}) => ({
  district: "Kirehe",
  crop: "maize",
  price: 450,
  ym: "2026-10",
  market: "Kiyanzi",
  markets: 1,
  source: "esoko",
  ...over,
});

const crop = (over = {}) => ({ as_of: "2026-08", estimated: false, ...over });

// ---------------------------------------------------------------- livePriceFor

test("strictly newer observation replaces the model price (the real-time case)", () => {
  assert.equal(livePriceFor(row({ ym: "2026-10", price: 470 }), crop({ as_of: "2026-08" })), 470);
  // month-level, not day-level: any newer month counts
  assert.equal(livePriceFor(row({ ym: "2027-01" }), crop({ as_of: "2026-12" })), 450);
});

test("same month never replaces: the model already smoothed that observation", () => {
  assert.equal(
    livePriceFor(row({ ym: "2026-08", price: 712 }), crop({ as_of: "2026-08" })),
    undefined,
    "same month must not override, even when the raw median differs"
  );
});

test("stale observation never replaces", () => {
  assert.equal(livePriceFor(row({ ym: "2026-07" }), crop({ as_of: "2026-08" })), undefined);
  // an estimated district's as_of can be years old; its rows are older still
  assert.equal(
    livePriceFor(row({ ym: "2015-12" }), crop({ as_of: "2015-12", estimated: true })),
    undefined
  );
});

test("estimated districts keep the estimate, even with a fresh row", () => {
  // the amber warning says "no market has reported" — a single live row must
  // not silently contradict it; the daily rebuild clears the flag first
  assert.equal(
    livePriceFor(row({ ym: "2026-10" }), crop({ as_of: "2015-12", estimated: true })),
    undefined
  );
});

test("missing, empty or implausible inputs are all refused", () => {
  assert.equal(livePriceFor(null, crop()), undefined);
  assert.equal(livePriceFor(undefined, crop()), undefined);
  assert.equal(livePriceFor(row(), null), undefined);
  assert.equal(livePriceFor(row({ price: 0 }), crop()), undefined);
  assert.equal(livePriceFor(row({ price: -3 }), crop()), undefined);
  assert.equal(livePriceFor(row({ price: NaN }), crop()), undefined);
  assert.equal(livePriceFor(row({ price: "450" }), crop()), undefined, "string price refused");
  assert.equal(livePriceFor(row({ ym: "2026-13" }), crop()), undefined, "impossible month");
  assert.equal(livePriceFor(row({ ym: "nonsense" }), crop()), undefined);
});

test("year boundaries compare correctly as strings", () => {
  assert.equal(livePriceFor(row({ ym: "2026-12" }), crop({ as_of: "2026-09" })), 450);
  assert.equal(livePriceFor(row({ ym: "2026-02" }), crop({ as_of: "2026-10" })), undefined);
  assert.equal(livePriceFor(row({ ym: "2027-02" }), crop({ as_of: "2026-10" })), 450);
  // but only a well-formed YYYY-MM is compared at all: "2026-9" would sort
  // above "2026-08" lexicographically while not being a real month stamp
  assert.equal(livePriceFor(row({ ym: "2026-9" }), crop({ as_of: "2026-08" })), undefined);
});

// ---------------------------------------------------------------- fetchLive

function stubFetch(responses) {
  let i = 0;
  globalThis.fetch = async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return { ok: r.ok !== false, status: r.status ?? 200, json: async () => r.body };
  };
}

const realFetch = globalThis.fetch;
const payload = (over = {}) => ({
  ok: true,
  source: "esoko",
  as_of: "2026-10",
  generated: "2026-10-27",
  refreshed_at: "2026-10-28T03:17:00Z",
  count: 1,
  rows: [row()],
  ...over,
});

test("API success is used as-is", async () => {
  stubFetch([{ body: payload() }]);
  try {
    const feed = await fetchLive();
    assert.equal(feed.source, "esoko");
    assert.equal(feed.rows.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("API down -> falls back to the static mirror", async () => {
  stubFetch([new Error("ECONNREFUSED"), { body: payload({ source: "wfp" }) }]);
  try {
    const feed = await fetchLive();
    assert.ok(feed, "mirror must be reached");
    assert.equal(feed.source, "wfp");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("API 503 not_configured -> mirror", async () => {
  stubFetch([
    { ok: false, status: 503, body: { ok: false, reason: "not_configured" } },
    { body: payload() },
  ]);
  try {
    assert.ok(await fetchLive());
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("both endpoints dead -> null, and the app keeps working on data.json", async () => {
  stubFetch([new Error("network down"), new Error("network down")]);
  try {
    assert.equal(await fetchLive(), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("non-JSON (SPA fallback HTML) does not crash the client", async () => {
  const notJson = {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  };
  stubFetch([notJson, notJson]);
  try {
    assert.equal(await fetchLive(), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("malformed rows are filtered; a payload of only-bad rows is rejected", async () => {
  stubFetch([
    {
      body: payload({
        rows: [row(), row({ price: -1 }), row({ ym: "bad" }), row({ district: "" })],
        count: 4,
      }),
    },
  ]);
  try {
    const feed = await fetchLive();
    assert.equal(feed.rows.length, 1, "only the clean row survives");
  } finally {
    globalThis.fetch = realFetch;
  }

  stubFetch([
    { ok: false, status: 404 },
    { body: payload({ rows: [row({ price: NaN })] }) },
  ]);
  try {
    assert.equal(await fetchLive(), null, "all-bad payload falls through");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("empty rows array is not a feed", async () => {
  stubFetch([{ ok: false, status: 404 }, { body: payload({ rows: [] }) }]);
  try {
    assert.equal(await fetchLive(), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------------------------------------------------------- helpers

test("liveIndex keys rows by district|crop", () => {
  const feed = payload({ rows: [row(), row({ district: "Ngoma", price: 500 })] });
  const idx = liveIndex(feed);
  assert.equal(idx.get("Kirehe|maize").price, 450);
  assert.equal(idx.get("Ngoma|maize").price, 500);
  assert.equal(idx.size, 2);
  assert.equal(liveIndex(null).size, 0);
});

test("formatRefresh renders UTC, or an em dash when absent", () => {
  assert.equal(formatRefresh("2026-10-28T03:17:00Z"), "2026-10-28 03:17 UTC");
  assert.equal(formatRefresh(""), "—");
  assert.equal(formatRefresh(undefined), "—");
  assert.equal(formatRefresh("not-a-date"), "not-a-date");
});
