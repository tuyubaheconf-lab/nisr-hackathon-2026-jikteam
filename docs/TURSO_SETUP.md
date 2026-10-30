# Turso setup — full walkthrough

The site works with **zero** configuration: it falls back to `web/public/data/live.json`
and then `data.json`. Connecting Turso turns on the live path — `GET /api/prices` —
and lets the daily GitHub job publish fresh observations.

Budget: **about 15 minutes.** Everything below is copy-paste.

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

## Step 1 — Install the CLI and log in

You are on Windows, so run this in **Git Bash**:

```bash
curl -sSfL https://get.tur.so/install.sh | bash
```

(macOS/Linux users: `brew install tursodatabase/tap/turso` — same thing.)

Then create a free account and log in:

```bash
turso auth signup     # or: turso auth login
```

A browser window opens. Confirm with:

```bash
turso auth show
```

## Step 2 — Create the database

```bash
turso db create sokoryari
```

Confirm it exists and get its URL (you need this value in Step 3):

```bash
turso db show sokoryari --url
# => https://<something>-<something>.turso.io
```

## Step 3 — Mint the two tokens

```bash
# write token — for pipeline/live.py only
turso db tokens create sokoryari
# => eyJhbGciOi...   (copy this exactly)

# read-only token — for the website's API function
turso db tokens create sokoryari --read-only
# => eyJhbGciOi...   (copy this exactly)
```

You will never see the write token again after this screen — paste it straight
into the next step. If you lose it, just run the command again (old tokens keep
working until you delete them with `turso db tokens delete`).

## Step 4 — Connect your machine

```bash
cd /d/sokoryari        # the project root
cp .env.example .env   # Windows: copy .env.example .env
```

Open `.env` and fill in the three lines:

```dotenv
TURSO_DATABASE_URL=https://<something>-<something>.turso.io
TURSO_AUTH_TOKEN=<the write token from Step 3>
TURSO_READ_TOKEN=<the read-only token from Step 3>
```

`.env` is already in `.gitignore` — it will never be committed.

> **How the pipeline picks these up:** `pipeline/live.py` reads the variables from
> the process environment, not from the file, so on Windows you set them like this
> before running (Git Bash):
>
> ```bash
> set -a; source .env; set +a
> python pipeline/live.py
> ```
>
> On macOS/Linux, `set -a; source .env; set +a` works identically.

## Step 5 — First publish

```bash
set -a; source .env; set +a
python pipeline/live.py
```

What you should see, in order:

1. the source adapter loads rows (WFP),
2. `publish guard: ok` — all 7 checks passed,
3. `schema applied` — `prices_latest`, `refresh_log`, `meta` created,
4. `published N rows` (around 150),
5. `web/public/data/live.json` rewritten.

Verify the database directly:

```bash
turso db shell sokoryari
```

```sql
SELECT count(*) FROM prices_latest;
SELECT * FROM refresh_log ORDER BY id DESC LIMIT 3;
SELECT * FROM meta;
.exit
```

You want a non-zero count and one `status = 'ok'` row in `refresh_log`.

**If the guard rejects the batch** the command exits non-zero, nothing is
overwritten, and the previous good snapshot keeps serving. Read the printed
reasons; they are written for a human.

## Step 6 — Test the API locally

```bash
cd web
npm run preview          # http://localhost:4173
curl -s http://localhost:4173/api/prices | head -c 400
```

Expected:

```json
{"ok":true,"source":"wfp","as_of":"2026-08", ... "count": 152, "rows":[ ... ]}
```

If instead you get HTML, the fallback kicked in — that is not an error, it means
the function could not read the database. Check `TURSO_DATABASE_URL` and
`TURSO_READ_TOKEN` in the environment the function process sees.

Open <http://localhost:4173> and the **Live** badge under the header should read
*Live prices · WFP · refreshed …*.

## Step 7 — Set the variables on your host

**Netlify** (Site settings → Environment variables → Add a variable), add all three:

| Name | Value |
|---|---|
| `TURSO_DATABASE_URL` | the URL from Step 2 |
| `TURSO_AUTH_TOKEN` | *(optional — only if you trigger publishes from Netlify)* |
| `TURSO_READ_TOKEN` | the read-only token from Step 3 |

**Vercel** (Project → Settings → Environment Variables): the same three names.

Then redeploy (or hit *Retry build*). Environment variables are read at runtime by
the serverless function, so no rebuild of the data is needed — but Netlify only
applies new variables to new deploys.

**GitHub Actions** (repo → Settings → Secrets and variables → Actions → New
repository secret), add:

| Secret | Value |
|---|---|
| `TURSO_DATABASE_URL` | same URL |
| `TURSO_AUTH_TOKEN` | the **write** token |

That is what the nightly job (`.github/workflows/refresh.yml`) uses to publish. The
job sets `SOKO_REQUIRE_DB=1`, so a run **fails loudly** instead of silently skipping
when the secrets are missing or wrong.

> ⚠️ Never put a token in the repository, in `vercel.json`, in `netlify.toml`, or in
> any file that gets committed. The publish step reads them from the environment
> only.

## Step 8 — Verify on the deployed site

```bash
curl -s https://YOUR-DEPLOYED-URL/api/prices | head -c 400
```

- `{"ok":true,...}` → live path is on. Done.
- HTML or `{"ok":false,...}` → the site is still on the mirror path. It works, it
  is just not live yet. The response body of a failure says which variable is
  missing (the function never leaks the value itself).

Then trigger the daily job once by hand: repo → **Actions → Refresh prices →
Run workflow**, and check that it goes green and commits
`data.json` + `live.json`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Turso not configured` from `live.py` | `.env` not sourced into the shell | `set -a; source .env; set +a` first |
| `Turso HTTP 401` | write token wrong or revoked | `turso db tokens create sokoryari` again, update `.env` |
| Guard rejects every publish | source extract changed shape | read the printed problems; `python pipeline/build.py` then retry |
| `/api/prices` returns HTML | function can't reach the DB | check `TURSO_DATABASE_URL` / `TURSO_READ_TOKEN` in the host env, redeploy |
| `/api/prices` returns `{"ok":false,"error":"no rows"}` | schema exists but nothing published yet | run Step 5, then re-verify Step 8 |
| GitHub job red at the publish step | secrets not set in the repo | add the two secrets from Step 7, re-run |

## Cost and teardown

The free tier covers this comfortably — one small database, ~150 rows, one write a
day. To remove everything: `turso db drop sokoryari`. The site keeps working
forever on the static mirror path, because that fallback is the design, not an
error state.
