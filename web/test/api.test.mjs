/**
 * Tests for the /api/prices read path (server/prices.mjs).
 *
 *    node --experimental-strip-types test/api.test.mjs
 *
 * fetch is stubbed, so this runs with no network and no credentials. What is
 * being proved: the token never reaches the body, malformed rows are dropped
 * rather than served, and every failure mode returns a typed reason the
 * frontend can fall back on instead of an opaque 500.
 */

import assert from "node:assert/strict";
import test from "node:test";

const mod = await import("../../server/prices.mjs");
const { readPrices } = mod;

const ENV_KEYS = [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "TURSO_READ_TOKEN",
];
const savedEnv = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

const realFetch = globalThis.fetch;

function tursoResult(cols, rows) {
  return {
    baton: null,
    base_url: null,
    results: [
      {
        type: "ok",
        response: {
          type: "execute",
          result: {
            cols: cols.map((name) => ({ name, decltype: "TEXT" })),
            rows,
            affected_row_count: 0,
            last_insert_rowid: null,
          },
        },
      },
      { type: "ok", response: { type: "close" } },
    ],
  };
}

function text(v) {
  return { type: "text", value: v };
}

/** rows as [district, crop, price, ym, market, source] */
function priceTable(rows) {
  return tursoResult(
    ["district", "crop", "price", "ym", "market", "source"],
    rows.map((r) => [
      text(r[0]),
      text(r[1]),
      { type: "float", value: String(r[2]) },
      text(r[3]),
      text(r[4] || ""),
      text(r[5] || "wfp"),
    ])
  );
}

const META_TABLE = tursoResult(["key", "value"], [
  [text("generated"), text("2026-10-27")],
  [text("published_at"), text("2026-10-28T03:17:00Z")],
]);

function stubFetch(payloads, capture) {
  let i = 0;
  globalThis.fetch = async (url, init) => {
    capture?.push({ url: String(url), init });
    const payload = payloads[Math.min(i++, payloads.length - 1)];
    if (payload instanceof Error) throw payload;
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    };
  };
}

function withEnv(values, fn) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, values);
  return fn().finally(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });
}

const GOOD = [
  ["Kirehe", "maize", 245, "2026-08", "Kirehe", "wfp"],
  ["Ngoma", "beans", 498, "2026-07", "Kabuye", "wfp"],
];

test("unconfigured database -> 503 not_configured", () =>
  withEnv({}, async () => {
    const r = await readPrices();
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { ok: false, reason: "not_configured" });
  }));

test("turso/libsql schemes normalise to https and the token rides the header", () =>
  withEnv({ TURSO_DATABASE_URL: "turso://db-org.turso.io", TURSO_AUTH_TOKEN: "tok-123" }, async () => {
    const seen = [];
    stubFetch([priceTable(GOOD), META_TABLE], seen);
    try {
      const r = await readPrices();
      assert.equal(r.status, 200);
      assert.equal(seen[0].url, "https://db-org.turso.io/v2/pipeline");
      assert.equal(seen[0].init.headers.authorization, "Bearer tok-123");
      // token must not appear in the request body, let alone the response
      assert.ok(!seen[0].init.body.includes("tok-123"));
      assert.ok(!JSON.stringify(r.body).includes("tok-123"));
    } finally {
      globalThis.fetch = realFetch;
    }
  }));

test("read-only token is preferred when both are set", () =>
  withEnv(
    {
      TURSO_DATABASE_URL: "https://db-org.turso.io",
      TURSO_AUTH_TOKEN: "write-tok",
      TURSO_READ_TOKEN: "read-tok",
    },
    async () => {
      const seen = [];
      stubFetch([priceTable(GOOD), META_TABLE], seen);
      try {
        await readPrices();
        assert.equal(seen[0].init.headers.authorization, "Bearer read-tok");
      } finally {
        globalThis.fetch = realFetch;
      }
    }
  ));

test("snapshot is served with freshness metadata", () =>
  withEnv({ TURSO_DATABASE_URL: "https://x.turso.io", TURSO_AUTH_TOKEN: "t" }, async () => {
    stubFetch([priceTable(GOOD), META_TABLE]);
    try {
      const r = await readPrices();
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.count, 2);
      assert.equal(r.body.as_of, "2026-08");
      assert.equal(r.body.generated, "2026-10-27");
      assert.equal(r.body.refreshed_at, "2026-10-28T03:17:00Z");
      assert.equal(r.body.source, "wfp");
      assert.equal(r.headers["cache-control"], "public, max-age=300, stale-while-revalidate=600");
      assert.equal(r.headers["x-content-type-options"], "nosniff");
    } finally {
      globalThis.fetch = realFetch;
    }
  }));

test("rows that would mislead a farmer are dropped, not served", () =>
  withEnv({ TURSO_DATABASE_URL: "https://x.turso.io", TURSO_AUTH_TOKEN: "t" }, async () => {
    // 10 clean rows, 2 bad ones (16.7% < the 20% tolerance): serve the good.
    const clean = [
      ["Kirehe", "maize", 245, "2026-08", "Kirehe", "wfp"],
      ["Ngoma", "beans", 498, "2026-07", "Kabuye", "wfp"],
      ["Rutsiro", "sorghum", 300, "2026-08", "Rutsiro", "wfp"],
      ["Karongi", "potatoes", 210, "2026-07", "Karongi", "wfp"],
      ["Gisagara", "rice_local", 700, "2026-08", "Gisagara", "wfp"],
      ["Nyagatare", "maize", 260, "2026-08", "Nyagatare", "wfp"],
      ["Huye", "beans", 470, "2026-06", "Huye", "wfp"],
      ["Musanze", "potatoes", 195, "2026-07", "Musanze", "wfp"],
      ["Rubavu", "cassava_flour", 330, "2026-08", "Rubavu", "wfp"],
      ["Gatsibo", "sorghum", 280, "2026-07", "Gatsibo", "wfp"],
    ];
    const dirty = [
      ...clean,
      ["Kirehe", "maize", "not-a-number", "2026-08", "Kirehe", "wfp"], // bad price
      ["Rutsiro", "sorghum", -5, "2026-08", "?", "wfp"], // negative
    ];
    stubFetch([priceTable(dirty), META_TABLE]);
    try {
      const r = await readPrices();
      assert.equal(r.status, 200);
      assert.equal(r.body.count, 10, "only the clean rows survive");
      assert.equal(r.body.dropped, 2);
      for (const row of r.body.rows) assert.ok(Number.isFinite(row.price) && row.price > 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  }));

test("more than a fifth malformed -> 502 corrupt, nothing served", () =>
  withEnv({ TURSO_DATABASE_URL: "https://x.turso.io", TURSO_AUTH_TOKEN: "t" }, async () => {
    stubFetch([priceTable([["", "maize", -1, "bad", "", "wfp"]]), META_TABLE]);
    try {
      const r = await readPrices();
      assert.equal(r.status, 502);
      assert.deepEqual(r.body, { ok: false, reason: "corrupt" });
    } finally {
      globalThis.fetch = realFetch;
    }
  }));

test("upstream failure -> 502 upstream with no internals leaked", () =>
  withEnv({ TURSO_DATABASE_URL: "https://x.turso.io", TURSO_AUTH_TOKEN: "t" }, async () => {
    stubFetch([new Error("connect ECONNREFUSED 1.2.3.4:443")]);
    try {
      const r = await readPrices();
      assert.equal(r.status, 502);
      assert.deepEqual(r.body, { ok: false, reason: "upstream" });
      assert.ok(!JSON.stringify(r.body).includes("ECONNREFUSED"));
    } finally {
      globalThis.fetch = realFetch;
    }
  }));

test("empty snapshot -> 503 empty so the client falls back", () =>
  withEnv({ TURSO_DATABASE_URL: "https://x.turso.io", TURSO_AUTH_TOKEN: "t" }, async () => {
    stubFetch([priceTable([]), META_TABLE]);
    try {
      const r = await readPrices();
      assert.equal(r.status, 503);
      assert.deepEqual(r.body, { ok: false, reason: "empty" });
    } finally {
      globalThis.fetch = realFetch;
    }
  }));

test("no credential ever appears in any response body", () =>
  withEnv({ TURSO_DATABASE_URL: "https://x.turso.io", TURSO_AUTH_TOKEN: "super-secret" }, async () => {
    stubFetch([priceTable(GOOD), META_TABLE]);
    try {
      const r = await readPrices();
      assert.ok(!JSON.stringify(r.body).includes("super-secret"));
    } finally {
      globalThis.fetch = realFetch;
    }
  }));

test("esoko rows are identified as such in the payload", () =>
  withEnv({ TURSO_DATABASE_URL: "https://x.turso.io", TURSO_AUTH_TOKEN: "t" }, async () => {
    stubFetch([
      priceTable([["Kirehe", "maize", 245, "2026-10", "Kirehe", "esoko"]]),
      META_TABLE,
    ]);
    try {
      const r = await readPrices();
      assert.equal(r.body.source, "esoko");
      assert.equal(r.body.as_of, "2026-10");
    } finally {
      globalThis.fetch = realFetch;
    }
  }));
