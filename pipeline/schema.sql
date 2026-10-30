-- SokoRyari? live price database (Turso / libSQL)
-- Applied idempotently by pipeline/live.py before every publish.
--
-- Two tables only:
--   prices_latest  the current snapshot the public API serves
--   refresh_log    audit trail of every publish attempt, pass or fail
--
-- There is no personal data in this database. No phone numbers, no names,
-- no farm locations. See docs/SECURITY.md.

CREATE TABLE IF NOT EXISTS prices_latest (
  district   TEXT    NOT NULL,   -- one of Rwanda's 30 districts
  crop       TEXT    NOT NULL,   -- our crop id: maize, beans, ...
  price      REAL    NOT NULL,   -- RWF per kg, retail
  ym         TEXT    NOT NULL,   -- "YYYY-MM": month the price was observed
  market     TEXT,               -- market the price was measured in
  source     TEXT    NOT NULL,   -- "wfp" | "esoko"
  observed_at TEXT   NOT NULL,   -- ISO-8601 UTC: when this row was published
  PRIMARY KEY (district, crop)
);

CREATE TABLE IF NOT EXISTS refresh_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at  TEXT NOT NULL,          -- ISO-8601 UTC
  source  TEXT NOT NULL,
  status  TEXT NOT NULL,          -- "ok" | "rejected"
  rows    INTEGER NOT NULL,
  detail  TEXT NOT NULL DEFAULT ''
);

-- Key/value store for API metadata (build date, last successful publish, ...).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
