# Turso setup — full walkthrough

The site works with **zero** configuration: it falls back to `web/public/data/live.json`
and then `data.json`. Connecting Turso turns on the live path — `GET /api/prices` —
and lets the daily GitHub job publish fresh observations.

Budget: **about 15 minutes.** Copy-paste or button-clicks.

> **Which route?** The Turso CLI (`turso db create` …) does not work on this
> project's machine: Turso ships **no Windows build**, and this network blocks the
> installer host `get.tur.so`. Everything the CLI would do is done here through the
> **web dashboard** instead. Your machine only ever needs two strings — a URL and a
> token — because `pipeline/live.py` talks to Turso over plain HTTPS.
> (On macOS/Linux with a normal network the CLI route still works; the commands are
> in the appendix.)

---

## What you are creating

| Thing | Who uses it | Why it exists |
|---|---|---|
| A Turso database `sokoryari` | `pipeline/live.py` (write) | holds `prices_latest`, the current snapshot, plus `refresh_log` and `meta` |
| **Write** token | only your machine + the GitHub Action | nothing on the public website can ever use it |
| **Read-only** token | the `/api/prices` function | if it leaks, an attacker can read public prices and nothing else |

There is no personal data in this database — no names, no phone numbers, no farm
locations (see [SECURITY.md](SECURITY.md)).

---

## Step 1 — Create the account and the database (browser)

Open **<https://app.turso.tech/signup>** and sign up with GitHub, Google, or email.
Take the free plan — **do not add a payment card.**

Then, in the dashboard:

1. **"Create database"** (the *+ New database* button).
2. Name it exactly **`sokoryari`** — the config expects this name.
3. Pick the default region, or the nearest offered. Region only affects latency,
   not correctness. **Pick carefully: the region cannot be changed later** — you
   would have to create a new database. Nearest to Rwanda beats furthest, e.g.
   `eu-west-1` over `ap-northeast-1`.
4. Create.

## Step 2 — Copy the database URL

Open the database → **"Connect"** (or "Overview"). You will see something like:

```
libsql://sokoryari-<your-org>.turso.io
https://sokoryari-<your-org>.turso.io
```

Either form works; `pipeline/live.py` rewrites `turso://` and `libsql://` to
`https://` itself.

## Step 3 — Create the two tokens

Database → **"Tokens"** tab (or Settings → Tokens):

1. **Write token** — "Create token" with access level **Full access** (sometimes the
   default *Plain token*). Used only by your machine and the GitHub Action.
2. **Read-only token** — "Create token" with access level **Read only**. This is the
   one the website gets.

You will likely see URL and token paste together as one string — harmless; split at
the end of `.turso.io`. Copy each token **immediately**; you may not see it again.

## Step 4 — Connect your machine

```bash
cd /d/sokoryari              # the project root
cp .env.example .env         # Windows: copy .env.example .env
```

Fill the three lines in `.env`:

```dotenv
TURSO_DATABASE_URL=https://<your-db>.turso.io
TURSO_AUTH_TOKEN=<the Full-access (write) token>
TURSO_READ_TOKEN=<the read-only token>
```

`.env` is already in `.gitignore` — it can never be committed.

> **How the pipeline picks these up:** `live.py` reads the process environment, not
> the file, so source it before running (Git Bash, works on macOS/Linux too):
>
> ```bash
> set -a; source .env; set +a
> python pipeline/live.py
> ```

## Step 5 — Verify the connection before publishing

Three probes, all cheap:

```bash
set -a; source .env; set +a
python pipeline/live.py --dry-run     # validates only: "ok: 152 pairs, 29 districts"
python pipeline/live.py --no-db       # writes the mirror, skips the database
```

If the dry run passes, the source and the 7 publish guards are happy.

## Step 6 — First publish

```bash
set -a; source .env; set +a
python pipeline/live.py
```

What you should see, in order:

1. `ok: 152 pairs, 29 districts, newest 2026-08` — source loaded and validated,
2. `wrote …/web/public/data/live.json (17,779 bytes)` — mirror written first,
3. `published 152 rows to Turso` — schema applied, snapshot inserted, logged.

**If any guard rejects the batch** the command exits non-zero, nothing is
overwritten (the mirror is already written, so the site keeps serving), and the
printed reasons are written for a human.

Verify the database directly — three questions: *is it there, is it logged, does the
read token behave?*

```bash
python - <<'PY'
import json, urllib.request
env = dict(l.split("=",1) for l in (x.strip() for x in open(".env",encoding="utf-8"))
           if l and not l.startswith("#") and "=" in l)
def q(sql, tok=None):
    r = urllib.request.Request(env["TURSO_DATABASE_URL"] + "/v2/pipeline",
        data=json.dumps({"requests":[{"type":"execute","stmt":{"sql":sql}}]}).encode(),
        headers={"Authorization": "Bearer " + (tok or env["TURSO_AUTH_TOKEN"]),
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=20) as resp: out = json.loads(resp.read())
    res = out["results"][0]
    if res["type"] == "error": return "error: " + res["error"]["message"][:120]
    return [[c["value"] for c in row] for row in res["response"]["result"]["rows"]]
print("tables :", q("SELECT name FROM sqlite_master WHERE type='table'"))
print("rows   :", q("SELECT count(*) FROM prices_latest"))
print("audit  :", q("SELECT run_at, status, rows, detail FROM refresh_log ORDER BY id DESC LIMIT 2"))
print("read ok:", q("SELECT count(*) FROM prices_latest", env["TURSO_READ_TOKEN"]))
print("write  :", q("DELETE FROM prices_latest", env["TURSO_READ_TOKEN"]))  # must be BLOCKED
PY
```

Expected: the three tables, `152`, an `ok` audit row, a count, and a
`SQL write operations are forbidden` error on the last line — that error is the
security property working.

## Step 7 — Test the API function

`vite preview` has no serverless runtime, so call the real handler the way a
platform would:

```bash
cd /d/sokoryari
set -a; source .env; set +a
node --input-type=module -e "
const { readPrices } = await import('./server/prices.mjs');
const r = await readPrices();
console.log('status:', r.status, '| body:', String(r.body).slice(0, 220));
"
```

Expected: `status: 200` and `{"ok":true,"source":"wfp","as_of":"2026-08",…}`.
Removing the tokens and calling again must give `503 {"ok":false,"reason":"not_configured"}` —
a typed failure the browser understands, never a stack trace.

## Step 8 — Set the variables on your host

**Netlify** — Site settings → Environment variables → Add:

| Name | Value |
|---|---|
| `TURSO_DATABASE_URL` | the URL from Step 2 |
| `TURSO_READ_TOKEN` | the read-only token from Step 3 |

(The write token is **not** needed on Netlify; the site only ever reads.)

**Vercel** — Project → Settings → Environment Variables: same two names.

**GitHub Actions** — repo → Settings → Secrets and variables → Actions → New
repository secret:

| Secret | Value |
|---|---|
| `TURSO_DATABASE_URL` | same URL |
| `TURSO_AUTH_TOKEN` | the **write** token |

That is what the nightly job (`.github/workflows/refresh.yml`) uses to publish. The
job sets `SOKO_REQUIRE_DB=1`, so it **fails loudly** instead of silently skipping
when a secret is missing or wrong.

Redeploy after setting them — Netlify/Vercel only apply new variables to new
deploys. Environment variables are read at **runtime**, so no data rebuild is needed.

> ⚠️ Never put a token in the repository, in `vercel.json`, in `netlify.toml`, or in
> any committed file. Copy them out of `.env` by hand into the host's UI.

## Step 9 — Verify on the deployed site

```bash
curl -s https://YOUR-DEPLOYED-URL/api/prices | head -c 400
```

- `{"ok":true,…}` → live path is on. Done.
- HTML → the SPA fallback answered, meaning the function isn't deployed yet (Netlify
  needs `netlify/functions/` to be picked up, and the variables need a redeploy).
- `{"ok":false,"reason":"not_configured"}` → the function runs but is missing a
  variable; check Step 8.

Then trigger the nightly job once by hand: **Actions → Refresh prices → Run
workflow**, and confirm it goes green and commits `data.json` + `live.json`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Turso not configured` from `live.py` | `.env` not sourced into the shell | `set -a; source .env; set +a` first |
| `Turso HTTP 401` | write token wrong or revoked | make a new token in the dashboard, update `.env` |
| `JSON parse error: invalid type: string "495.7", expected f64` | a float encoded as a string | `_arg("float", …)` must emit a JSON **number** — see the appendix |
| `JSON parse error: invalid type: integer 152, expected a borrowed string` | an integer encoded as a number | `_arg("integer", …)` must emit a JSON **string** — see the appendix |
| `SQL string could not be parsed: near ID, "Some("close")"` | `close` sent as a statement | it is a request **type**: `{"type":"close"}`, not `{"type":"execute",…}` |
| Guard rejects every publish | source extract changed shape | read the printed problems; `python pipeline/build.py`, then retry |
| `/api/prices` returns HTML | no serverless runtime / function missing | deploy, don't just `npm run preview`; see Step 9 |
| GitHub job red at the publish step | secrets not set in the repo | add the two secrets from Step 8, re-run |

## Appendix A — the wire format (verified against a live database)

`pipeline/live.py` posts to `POST <url>/v2/pipeline`. The API deserialises bound
arguments **strictly and asymmetrically**, and the errors only ever appear against a
real database — which is why they cost three failed publishes to discover. Probed
answers:

| intended type | correct JSON | rejected with |
|---|---|---|
| `float` | `{"type":"float","value":495.7}` (number) | string → `expected f64` |
| `integer` | `{"type":"integer","value":"152"}` (**string**) | number → `expected a borrowed string` |
| `text` | `{"type":"text","value":"Kirehe"}` | — |
| close | `{"type":"close"}` as a **request**, not a statement | as SQL → `SQL_PARSE_ERROR` |

`test_argument_types_match_the_wire_contract` in `pipeline/test_live.py` pins this
down so it cannot silently regress.

## Appendix B — CLI route (macOS/Linux only)

```bash
curl -sSfL https://get.tur.so/install.sh | bash    # or: brew install tursodatabase/tap/turso
turso auth signup
turso db create sokoryari
turso db show sokoryari --url                      # → TURSO_DATABASE_URL
turso db tokens create sokoryari                   # → TURSO_AUTH_TOKEN (write)
turso db tokens create sokoryari --read-only       # → TURSO_READ_TOKEN
turso db shell sokoryari                           # interactive checks
```

Everything after that is identical to the dashboard route.

## Cost and teardown

The free tier covers this comfortably — one small database, ~152 rows, one write a
day. To remove everything: `turso db drop sokoryari` (or *Delete database* in the
dashboard). The site keeps working forever on the static mirror path, because that
fallback is the design, not an error state.
