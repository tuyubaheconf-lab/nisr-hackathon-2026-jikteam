"""
Tests for the publish guard in pipeline/live.py.

    python pipeline/test_live.py

The guard is the only thing standing between a bad feed and the number a
farmer acts on, so every check it claims to make is exercised here, plus the
wire format of the Turso publish (with the network call stubbed out).
"""

import os
import sys
import unittest
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import build  # noqa: E402
import live  # noqa: E402
import sources  # noqa: E402

TODAY = datetime(2026, 10, 28, tzinfo=timezone.utc)
CROPS = ["maize", "beans", "sorghum", "potatoes", "rice_local", "cassava_flour"]
ALL_DISTRICTS = sorted(build.ALL_DISTRICTS)


def row(district="Kirehe", crop="maize", price=250.0, ym="2026-08"):
    return {"district": district, "crop": crop, "price": price, "ym": ym,
            "market": "Kirehe", "source": "wfp"}


def batch(n_pairs=100, districts=None, **kw):
    """n_pairs distinct (district, crop) rows, all recent unless ym is given."""
    ds = districts or ALL_DISTRICTS
    rows, i = [], 0
    while len(rows) < n_pairs:
        d = ds[i % len(ds)]
        c = CROPS[(i // len(ds)) % len(CROPS)]
        rows.append(row(district=d, crop=c, price=100 + i, **kw))
        i += 1
    return rows


class ValidateAccepts(unittest.TestCase):
    def test_clean_batch_passes(self):
        self.assertEqual(live.validate(batch(), "wfp", today=TODAY), [])

    def test_source_wfp_allows_six_month_lag(self):
        self.assertGreaterEqual(live.MAX_AGE_MONTHS["wfp"], 6)

    def test_real_extract_passes(self):
        rows, _ = sources.load("wfp")
        self.assertEqual(live.validate(rows, "wfp", today=TODAY), [])


class ValidateRejects(unittest.TestCase):
    def check(self, rows, fragment, **kw):
        problems = live.validate(rows, "wfp", today=TODAY, **kw)
        self.assertTrue(problems, "expected the guard to reject this batch")
        self.assertTrue(
            any(fragment in p for p in problems),
            f"expected a problem mentioning {fragment!r}, got: {problems[:3]}",
        )

    def test_empty(self):
        self.check([], "no rows")

    def test_missing_field(self):
        r = row()
        del r["price"]
        self.check([r] + batch()[1:], "missing price")

    def test_non_numeric_price(self):
        rows = batch()
        rows[0]["price"] = "abc"
        self.check(rows, "not a number")

    def test_negative_price(self):
        rows = batch()
        rows[0]["price"] = -5
        self.check(rows, "not positive")

    def test_implausible_price(self):
        # A 25kg-basket price published as a kg price, or the wrong currency.
        rows = batch()
        rows[0]["price"] = 90000
        self.check(rows, "ceiling")

    def test_unknown_district(self):
        rows = batch()
        rows[0]["district"] = "Administrative unit not available"
        self.check(rows, "30")

    def test_unknown_crop(self):
        rows = batch()
        rows[0]["crop"] = "tobacco"
        self.check(rows, "unknown crop")

    def test_bad_ym(self):
        rows = batch()
        rows[0]["ym"] = "August 2026"
        self.check(rows, "YYYY-MM")

    def test_future_ym(self):
        rows = batch()
        rows[0]["ym"] = "2027-01"
        self.check(rows, "future")

    def test_stale_wfp(self):
        # every row old, not just one: the feed as a whole is stale
        rows = batch(100, ym="2025-06")   # 16 months before TODAY
        self.check(rows, "months old")

    def test_stale_esoko_tighter(self):
        # eSoko collects weekly; 4 months old means the feed is broken.
        rows = batch(100, ym="2026-06")
        problems = live.validate(rows, "esoko", today=TODAY)
        self.assertTrue(any("months old" in p for p in problems), problems[:3])

    def test_too_few_pairs(self):
        self.check(batch(20), "pairs")

    def test_too_few_districts(self):
        # 100 pairs across only 17 districts: pairs floor is met, districts
        # floor (18) must still bite.
        rows = batch(100, districts=ALL_DISTRICTS[:17])
        self.check(rows, "districts")

    def test_duplicate_pair(self):
        rows = batch()
        rows[1] = dict(rows[0])
        self.check(rows, "duplicate")

    def test_collapse_against_live(self):
        # Live has grown to 300 (an eSoko era); a 95-pair batch clears both
        # absolute floors but is a lost feed, not a real change.
        self.check(batch(95), "live", live_pairs=300)


class SourceGuards(unittest.TestCase):
    def test_wfp_is_exact_match_only(self):
        # Fresh cassava root must not become cassava flour in the WFP feed.
        self.assertIsNone(sources.crop_id_for("Cassava", allow_alias=False))
        self.assertEqual(sources.crop_id_for("Maize"), "maize")
        self.assertEqual(sources.crop_id_for("Beans (dry)"), "beans")

    def test_ambiguous_names_stay_unmapped_for_esoko(self):
        for name in ("Rice", "Potatoes", "Cassava"):
            self.assertIsNone(sources.crop_id_for(name), name)

    def test_esoko_missing_file_raises(self):
        os.environ.pop("SOKO_ESOKO_PATH", None)
        with self.assertRaises(sources.SourceError):
            sources.load("esoko")

    def test_district_fix_applies_to_live_feed(self):
        # Gisenyi is mis-filed in the WFP extract; the live feed must file it
        # under Rubavu, exactly as the model does.
        self.assertEqual(
            sources.resolve_district("Gisenyi", "Administrative unit not available"),
            "Rubavu",
        )
        self.assertEqual(sources.resolve_district("Ruhuha", "Bugesera"), "Bugesera")

    def test_live_feed_covers_exactly_the_model(self):
        rows, _ = sources.load("wfp")
        pairs = {(r["district"], r["crop"]) for r in rows}
        self.assertEqual(len(pairs), len(rows), "duplicate pairs leaked through")
        for r in rows:
            self.assertIn(r["district"], build.ALL_DISTRICTS)
            self.assertIn(r["crop"], CROPS)


class PublishWire(unittest.TestCase):
    """The Turso request body, with urllib stubbed out."""

    def setUp(self):
        self.sent = []
        self._urlopen = live.urllib.request.urlopen
        self._env = {k: os.environ.get(k)
                     for k in ("TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "SOKO_REQUIRE_DB")}
        os.environ["TURSO_DATABASE_URL"] = "turso://soko-abc.turso.io"
        os.environ["TURSO_AUTH_TOKEN"] = "secret-token"
        os.environ.pop("SOKO_REQUIRE_DB", None)

        class Resp:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *a):
                return False

            def read(self_inner):
                import json as _json
                n = len(self.sent[-1][0].get("requests", []))
                return _json.dumps({"results": [{"type": "ok"}] * n}).encode()

        def fake_urlopen(req, timeout=None):
            import json as _json
            self.sent.append((_json.loads(req.data.decode()), req))
            return Resp()

        live.urllib.request.urlopen = fake_urlopen

    def tearDown(self):
        live.urllib.request.urlopen = self._urlopen
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_publish_sends_snapshot_in_one_request(self):
        rows = batch(3)
        live.publish(rows, "wfp", {"as_of": "2026-08", "pairs": 3})
        self.assertEqual(len(self.sent), 1)
        body, req = self.sent[0]
        sqls = [r["stmt"]["sql"] for r in body["requests"] if r["type"] == "execute"]
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS prices_latest" in s for s in sqls))
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS refresh_log" in s for s in sqls))
        self.assertIn("BEGIN", sqls)
        self.assertIn("COMMIT", sqls)
        self.assertIn("DELETE FROM prices_latest", sqls)
        self.assertEqual(sum(1 for s in sqls if s.startswith("INSERT INTO prices_latest")), 3)
        self.assertEqual(sum(1 for s in sqls if s.startswith("INSERT INTO refresh_log")), 1)
        self.assertEqual(sum(1 for s in sqls if s == "close"), 1)
        # token travels in the header, never in the body
        self.assertEqual(req.get_header("Authorization"), "Bearer secret-token")
        self.assertNotIn("secret-token", req.data.decode())

    def test_no_credentials_skips_unless_required(self):
        os.environ.pop("TURSO_DATABASE_URL")
        self.assertFalse(live.publish(batch(3), "wfp", {}))
        self.assertEqual(self.sent, [])
        os.environ["SOKO_REQUIRE_DB"] = "1"
        with self.assertRaises(RuntimeError):
            live.publish(batch(3), "wfp", {})

    def test_schema_statements_parse(self):
        stmts = live._schema_statements()
        self.assertTrue(any("prices_latest" in s for s in stmts))
        self.assertTrue(any("refresh_log" in s for s in stmts))
        for s in stmts:
            self.assertNotIn("--", s, "comment leaked into a statement")


if __name__ == "__main__":
    unittest.main(verbosity=2)
