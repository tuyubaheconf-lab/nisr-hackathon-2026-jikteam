# Security & privacy — SokoRyari?

**One sentence:** the app today holds **no personal data and no accounts**, so the
security work that matters right now is (a) hardening the public site, (b) refusing to
publish bad data, and (c) defining — and testing — the access rules that farmer records
will live under the day they exist.

---

## 1. What exists today, honestly

| | Today | When farmer records arrive |
|---|---|---|
| Accounts / login | none — everyone sees the same public data | required; see §4 |
| Personal data stored | **none** (no names, phones, locations) | farmer name, phone, district, holdings |
| Cookies / localStorage of user data | none | session token only, httpOnly |
| Database | public market prices only, no PII by schema | same DB, plus a farmer table |
| Who can read what | one audience: the public | the matrix in §3 |

This table is the answer to *"can a farmer on the web access only farmer data?"*:
**right now there is exactly one kind of data — public market data — and every visitor
may read it.** The access rules that separate farmer data from officer data are written
and tested *before* the data exists, so the feature lands as a configuration, not a
rewrite.

## 2. Threat model (what we protect, from whom)

**Assets**

1. *The advice numbers* — a wrong or tampered price makes a farmer sell at a loss.
2. *The database credentials* — a write token would let an attacker publish false
   prices to every visitor.
3. *Farmer records* (future) — phone, location, holdings.
4. *The site's integrity* — injected script on a page a farmer trusts.

**Actors and mitigations**

| Actor | Threat | Mitigation (implemented) |
|---|---|---|
| Anyone on the internet | tampering with prices in transit | TLS only; HSTS header; API speaks HTTPS to Turso |
| Anyone | XSS / script injection / clickjacking | CSP `default-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `object-src 'none'`, `base-uri 'none'` — in `_headers` and `vercel.json` |
| Anyone | reading data we never intended to publish | no personal data exists; API returns a fixed public shape; server errors return typed reasons only (`502 upstream`), never SQL, URLs or tokens |
| Corrupt or truncated source feed | a bad batch reaching farmers | publish guard: 7 checks, all-or-nothing, previous snapshot keeps serving (`pipeline/live.py`) |
| Compromised DB token | writing false prices | browser **never** holds a token; the API prefers `TURSO_READ_TOKEN` (read-only) and only falls back to the write token; token travels in a header, asserted absent from every request body and response in `web/test/api.test.mjs` |
| Future authenticated attacker | reading another farmer's records | fail-closed `can()` in `web/src/lib/permissions.ts`, tested as a truth table (§3) |
| SQL injection | — | the API's SQL is a constant string with **no user input interpolated anywhere**; the only variable part of a request is nothing — paths are fixed, methods fixed |

**Not mitigated, and stated plainly:** no WAF, no rate limiting, no bot protection, no
dependency scanning in CI, no penetration test. For a static site serving public data
these are low-priority; revisit before scaling.

## 3. The permission matrix (executable)

Roles × actions. Source of truth: `web/src/lib/permissions.ts`, enforced by
`web/test/permissions.test.mjs` (11 tests, including the full truth table).

| Action | visitor | farmer | coop clerk | district officer | admin |
|---|:--:|:--:|:--:|:--:|:--:|
| `market_price.read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `advice.read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `district_aggregate.read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `farmer_record.read` | ❌ | **own only** | own coop | own district | ✅ |
| `farmer_record.write` | ❌ | **own only** | ❌ | ❌ | ✅ |
| `farmer_record.export` | ❌ | ❌ | ❌ | ❌ | ✅ |
| `system.configure` | ❌ | ❌ | ❌ | ❌ | ✅ |

Rules the tests pin down:

- **A farmer reads their own records and nobody else's** — not with another farmer's
  ID, not with their own district attached to the request, not when the record has no
  owner at all.
- **Fail closed**: null actor, unknown role, unknown action, missing scope, missing
  identity → denied. `toString` as an action is denied because it is not in `ACTIONS`.
- **Least privilege**: clerks and officers are read-only; bulk export of personal data
  is admin-only, and the design calls for it to be audited.
- **Hiding UI is not security.** When records exist, the *server* must call `can()`
  before any row is returned. `filterFarmerRecords()` is the helper for scoping query
  results so a missing `WHERE` clause cannot widen access.

## 4. Privacy notice (for the site, and for the judges)

> **What we collect:** nothing about you. No account, no cookies, no analytics, no
> tracking, no personal data. The site loads a public price file and a public price
> API. Your quantity and cost settings are computed in your browser and never sent
> anywhere.

**Why there is no login yet:** an account system that exists only to protect public
data would add personal data to a project that has none. Access control becomes real
the day farmer records exist — and then this applies:

**Rwanda Law N° 058/2021 on Personal Data Protection and Privacy** (administered by the
NCSA). The obligations we have designed for, when records arrive:

1. **Lawful basis & consent** — a farmer must knowingly agree to their name, phone,
   district and holdings being stored for advice delivery; consent recorded with
   timestamp, withdrawable.
2. **Registration with NCSA** — data controllers/processors register before collecting
   personal data; this is an organisational step, not a code change, and it must
   precede go-live with records.
3. **Purpose limitation & minimisation** — store only what delivers the advice
   (phone for SMS/USSD, district for the model). No ID numbers, no national IDs.
4. **Storage limitation** — a retention window and deletion procedure, defined before
   collection starts.
5. **Security measures** — the law asks for "appropriate technical and organisational
   measures": TLS, access control (§3), hashed/encrypted contact data, audit log for
   exports, and least-privilege DB tokens (§2).
6. **Data subject rights** — access, correction, deletion, on request.

Until records exist, obligations 1–6 are **not applicable yet**, and the honest
statement to make to a judge is: *"we have not collected a single farmer's data, so
there is nothing to breach. Here is the design for when we do."*

## 5. What we shipped in this round

| Item | Where |
|---|---|
| CSP, HSTS, framing, MIME-sniffing, referrer, permissions, COOP headers | `web/public/_headers` (Netlify + drag-and-drop), `vercel.json` (Vercel) |
| Publish guard: 7 checks, atomic replace, audit trail of rejects | `pipeline/live.py`, `pipeline/schema.sql` |
| Read-path API with typed failures, token never exposed | `server/prices.mjs` |
| Fail-closed RBAC + `filterFarmerRecords` | `web/src/lib/permissions.ts` |
| Truth-table tests for the matrix | `web/test/permissions.test.mjs` |
| Guard tests (26) and API tests (10) | `pipeline/test_live.py`, `web/test/api.test.mjs` |
| Live-feed client that degrades to a static mirror | `web/src/lib/live.ts` |

## 6. How to verify all of this yourself

```bash
python pipeline/test_live.py                      # 26: the publish guard
cd web
node --experimental-strip-types test/permissions.test.mjs   # 11: RBAC truth table
node --experimental-strip-types test/api.test.mjs           # 10: API + token hygiene
npx tsc --noEmit
```

Then, against a deployed instance:

```bash
curl -sI https://<your-site>/ | grep -iE 'content-security|strict-transport|x-frame'
curl -s https://<your-site>/api/prices | head -c 300
```

Expected: the headers present, and either a price snapshot or
`{"ok":false,"reason":"not_configured"}` — never a stack trace.
