# NorthStar Prep

A household preparedness tracker built with React, Vite and Tailwind, backed by Neon Postgres and Vercel Functions.

## Architecture

The browser calls same-origin `/api/session`, `/api/hub`, `/api/members`, `/api/invite`, `/api/password-reset` and `/api/password` endpoints. Only server code connects to Postgres. Individual accounts (email plus a scrypt-hashed password) sign in to create a signed, HttpOnly, SameSite=Strict session cookie (Secure in production) that carries just the user's ID; every request re-checks that user's household membership and role directly from Postgres rather than trusting a role baked into the cookie. Sessions last seven days; rotating `SESSION_SECRET` invalidates all of them. Login and password-reset attempts are rate-limited in Postgres.

This is a **single-household application** with individual accounts inside it. An owner invites others from **Household settings**, which generates a one-time shareable link (there is no outbound email — send the link yourself); members can be promoted to owner at invite time or removed later, and every add, edit, delete, purchase, import, plan and settings change is recorded with who made it. An owner can also generate a single-use, one-hour password reset link for a locked-out member the same way, and any signed-in member can change their own password after re-entering the current one. There is no anonymous access, client database SDK, or public hub-ID access. Do not use this shared-household design for unrelated households.

**Privacy note — medications:** the medications collection (person, name, dose, quantity on hand, refill date, prescriber, notes) is more sensitive than the rest of the household's data — it is protected health information about specific named people, not just a list of supplies. It is stored and backed up the same way as everything else (see [Environments](#environments) and [Backups and migration](#backups-and-migration)), which means it also inherits every rule those sections already state for household data generally, but the consequence of getting one of those rules wrong is worse here. Concretely: never seed a Preview or Development database from a production backup or Neon branch without stripping this collection (and family/contacts) first, per [Point-in-time recovery](#rollback-and-recovery); treat any environment where that has happened as carrying real PHI and restrict access to it accordingly; and prefer synthetic medication rows (fake names, fake doses) over real ones when demoing or testing against a non-production database.

Database updates use compare-and-swap revisions and bounded retries. Shopping purchases move the current stored record atomically; backups merge by ID. Devices refresh every 15 seconds and on window focus.

## Setup

1. Create a Neon Postgres database through Vercel's marketplace, using its free plan if suitable. Connect it to this Vercel project. Accept any marketplace terms in your own account.
2. Set server-only environment variables:
   - `DATABASE_URL`: Neon connection string.
   - `SESSION_SECRET`: a random value of at least 32 characters.
   - `HOUSEHOLD_OWNER_EMAIL` and `HOUSEHOLD_PASSWORD`: used **once**, by the migration script, to create the first owner account (a random password of at least 20 characters). They're safe to leave set afterward — the migration only creates an account while none exist yet.
   - `BACKUP_ENCRYPTION_KEY`: 32 random bytes, base64-encoded (`openssl rand -base64 32`), used to encrypt scheduled backups at rest. Automatic backups fail closed without it.
   - `CRON_SECRET`: a random secret (`openssl rand -hex 32`) that authorizes Vercel's Cron Jobs to trigger `/api/backup`; Vercel adds it as an `Authorization: Bearer` header automatically once both the env var and the `crons` entry in `vercel.json` are set.
   - `BLOB_READ_WRITE_TOKEN`: connect a Vercel Blob store to the project (Vercel marketplace) to set this automatically. Inventory/shopping item images are uploaded here instead of Postgres; without it, saving an image-carrying item fails closed with a 503.
   - `ALERT_WEBHOOK_URL` (optional): a JSON webhook (Slack-compatible) that receives an alert when one route sees repeated failures. Tune with `ALERT_FAILURE_THRESHOLD` (default 5), `ALERT_WINDOW_MINUTES` (default 15) and `ALERT_COOLDOWN_MINUTES` (default 60). Without it, the same alert decision is still written to the server logs as an `alert` event.
   - `METRICS_RETENTION_DAYS` (optional): how long request metrics are kept before the daily maintenance run deletes them (default 14).
   - `READINESS_HISTORY_RETENTION_DAYS` (optional): how long daily readiness snapshots are kept (default 365). Snapshots hold aggregate figures only — days of supply, totals and counts, never item contents — so they are safe to keep far longer than request metrics, and showing a year of progress is the point of keeping them at all.
3. Copy `.env.example` to `.env.local` for local development, or pull the project's development variables using Vercel CLI. Never commit credentials. No `VITE_` variables are needed. Use `DATABASE_URL_UNPOOLED` for migrations when Neon provides it; the app uses pooled `DATABASE_URL` for request traffic.
4. Run `npm ci` and `npm run db:migrate`. The migration creates the tables (household state, accounts, membership, invitations, audit history) without overwriting existing records, and creates the first owner account from `HOUSEHOLD_OWNER_EMAIL`/`HOUSEHOLD_PASSWORD` the first time it runs with no accounts yet. If upgrading a deployment that already has inventory images stored as base64 in Postgres (from before object storage was added), run `npm run db:migrate-images` once `BLOB_READ_WRITE_TOKEN` is set to move them to object storage; it's safe to re-run and leaves already-migrated rows untouched.
5. Run `npm run dev` for the frontend and API at `http://127.0.0.1:5173`. Check `GET /api/health` for an API and database health signal, and **Household settings → Service health** once signed in for failure counts and database latency. Sign in with the owner email and password from step 4, then invite other household members from **Household settings**.
6. Run `npm test` and `npm run build`, plus the browser suites described under [Testing](#testing). Pull requests run all of them through `.github/workflows/ci.yml`.

### Migrating from the shared household password

Earlier versions of this app used one `HOUSEHOLD_PASSWORD` shared by everyone. To move to individual accounts: set `HOUSEHOLD_OWNER_EMAIL` alongside the existing `HOUSEHOLD_PASSWORD`, redeploy, then re-run `npm run db:migrate` against production. That creates the first owner account from those two values — sign in with that email and the same password. The shared password stops working for login from that point on (existing household data is untouched); invite everyone else individually afterward.

## Deploy

Target repository: [GarrettGus/Northstar-Prep](https://github.com/GarrettGus/Northstar-Prep).
Target Vercel project: `garrettgus-projects/northstar-prep`.

Use the Vite preset, `npm run build`, output directory `dist`, and Node 22 or newer. Vercel discovers the `/api` functions automatically. Run the database migration before the first login, and re-run `npm run db:migrate` before deploying an upgrade — this release adds a `writer_token` column that `/api/hub` writes on every save, so saves fail with a 503 until the migration has run.

`npm run preview` previews the compiled frontend only; use `npm run dev` or a Vercel deployment to exercise API functionality.

### Environments

Preview builds must never write to production household data. Give each Vercel deployment target its own database and its own environment variables:

| Vercel target | Purpose | Database |
| --- | --- | --- |
| Production | The live `main` deployment | The production Neon branch/database |
| Preview | Every PR and non-`main` branch deployment | The [Neon Vercel integration](https://neon.tech/docs/guides/vercel) creates and tears down an isolated Neon branch per preview deployment automatically, seeded from production's schema (not its data unless you configure that) |
| Development | `vercel env pull` / local work | A separate long-lived Neon branch, never production |

Set every server-only variable from [Setup](#setup) (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `SESSION_SECRET`, `BACKUP_ENCRYPTION_KEY`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`, etc.) per target in **Vercel → Project → Settings → Environment Variables**, scoping each to Production, Preview or Development rather than "All Environments". If you use the Neon integration, it manages `DATABASE_URL`/`DATABASE_URL_UNPOOLED` for Preview automatically; set the Production and Development values yourself, pointing at their own Neon branches. `HOUSEHOLD_OWNER_EMAIL`/`HOUSEHOLD_PASSWORD` and `CRON_SECRET` should differ per target so a preview deployment cannot bootstrap or trigger backups against production. Without a `DATABASE_URL` configured for a given target, the app shows a setup message and denies data access rather than falling back to another database.

For a persistent staging environment (a fixed URL to demo against before promoting to production, distinct from ephemeral per-PR previews), add a dedicated branch (e.g. `staging`) as a second Vercel "Production" domain is not appropriate here — instead deploy it as a standing Preview deployment (Vercel keeps the latest deployment of a given branch reachable at a stable branch URL) with its own Preview-scoped overrides for that branch, and its own Neon branch, in **Settings → Git → Environment Variable overrides**.

### Migrations in CI

`scripts/migrate.js` connects with `DATABASE_URL_UNPOOLED` (falling back to `DATABASE_URL`) because Neon's pooled connection does not support the session state some migration statements need. Run it from CI against each target's own database using that target's own connection string as a workflow secret — never share one migration run across environments. `.github/workflows/ci.yml`'s `verify` job proves `scripts/migrate.js` applies cleanly and is re-runnable (against a disposable database, never a deployed one) before you run it for real; see [Before a production migration](#before-a-production-migration).

### Staging smoke test

`npm run smoke-test -- <url>` (`scripts/smoketest.js`) polls `<url>/api/health` until it reports `{"status":"ok","database":"ok"}`, retrying with backoff (`SMOKE_TEST_ATTEMPTS`, `SMOKE_TEST_DELAY_MS`) since a fresh deployment can take a moment to become reachable. The `staging-smoke-test` job in `.github/workflows/ci.yml` runs it automatically against every non-Production deployment Vercel reports (via the `deployment_status` event), so a preview or staging deployment that cannot reach its own database is caught before anyone promotes it to production. Run it manually against the staging URL as a final check before promoting.

If **Project Settings → Deployment Protection → Vercel Authentication** is enabled for previews (recommended, and on by default for non-custom domains), an unauthenticated smoke test cannot reach `/api/health` at all — it gets Vercel's authentication interstitial instead of the app, and fails with a non-JSON response. Enable **Protection Bypass for Automation** in that same settings page, then add the secret it generates as a GitHub Actions repository secret named `VERCEL_AUTOMATION_BYPASS_SECRET` (**Settings → Secrets and variables → Actions**); both `scripts/smoketest.js` and the `staging-smoke-test` job send it automatically when set. A custom domain assigned to the staging branch is exempt from this protection and needs no bypass secret.

### Rollback and recovery

**Application rollback:** Vercel keeps every deployment. From the project's **Deployments** tab, use **Instant Rollback** (or "Promote to Production" on an older deployment) to point the production domain at a previous, known-good build immediately — no rebuild or redeploy needed. This reverts code only, not the database.

**Database rollback (household data):**
1. First choice — the app's own backups: **Household settings** lists automatic encrypted daily backups (`/api/backup`, see [Backups and migration](#backups-and-migration)) and the manual JSON export/import. Restoring either previews the merge before anything is applied, so a bad write can be undone without touching the database directly.
2. Schema rollback — `scripts/migrate.js` only adds tables/columns (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) and never drops or renames one, so there is nothing destructive to roll back after running it; if a migration is ever added that changes existing columns, write and test its down-migration in the same PR.
3. Point-in-time recovery — for corruption or data loss beyond what an application backup covers, use [Neon's branch restore](https://neon.tech/docs/guides/branch-restore) to create a new branch from a timestamp before the incident, verify its contents, then repoint the affected Vercel environment's `DATABASE_URL`/`DATABASE_URL_UNPOOLED` at it (or restore the original branch in place, per Neon's docs) and redeploy.
4. Never restore a preview or staging database from a production backup or branch without stripping household PII first — see the single-household privacy note above.

Practice both paths (Instant Rollback and a backup restore) against a preview deployment periodically so the first real incident isn't the first time either has been exercised.

**Account recovery:** A member who forgot their password asks any owner for a reset link — **Household settings → Household members → Reset link** generates a single-use link, valid for one hour, that lets them set a new password without knowing the old one. A signed-in member can also change their own password from the same screen after re-entering the current one. Both invalidate any other pending reset link for that account.

**A locked-out sole owner** (the only owner, with no other owner signed in anywhere to generate them a reset link) has no self-service path — generating a reset link requires being authenticated as an owner already. Recover by connecting to Postgres directly (the `DATABASE_URL` in Vercel's environment variables) and either: update `northstar_users.password_hash` to a value produced by `hashPassword()` from `server/auth.js` (run it locally with the target password, e.g. via `node -e "import('./server/auth.js').then(a=>console.log(a.hashPassword('new-password')))"`), or insert a row directly into `northstar_password_resets` with a token you generate yourself, then visit `/?reset=<token>`. Rotating `SESSION_SECRET` afterward signs out anyone who obtained a session before the account was recovered.

## Inventory management

Supply Hub and Shopping List support search (name, category, store, unit, location), status filters (low stock, expiring, expired), multi-select and duplicate detection (matching name+category, or a matching barcode) before an item is created. Selecting items also exposes bulk actions: set a category or set/adjust quantity (by an absolute value or a +/- delta) across every selected item in one request, alongside bulk delete. Each item can carry an optional barcode, entered manually or captured with the device camera via the browser's `BarcodeDetector` API where supported (Chrome/Edge; Safari falls back to the manual field, which is always available). Items can also be marked to recur every N days from their purchase date; due items surface a "due for restock" banner with a one-tap action that queues them onto the shopping list.

Inventory items also carry an optional **storage location** (free text — go-bag, basement, vehicle, etc.) and can be assigned to a **kit**. Kits (Supply Hub → Kits) are a name, an optional purpose, and a target contents list (item name, quantity, unit) to pack against; assigning inventory items to a kit shows that kit's completeness as matched/total target rows (or a plain item count for a kit with no target list yet). The Supply Hub can be grouped by category, location or kit, and filtered by location or by kit (including "not in a kit"), independently of the existing status filter.

## Family Hub and the emergency binder

Household members, emergency contacts and primary/secondary meeting points are editable in the Family Hub alongside the existing shelter spot, and go through the same `plan` action, audit history and backup export/import as the rest of household state. The Dashboard's readiness panel replaces the old AI gap analysis with a deterministic shortfall against each goal (water gallons, calories, fuel hours, power kWh), computed from the same numbers already shown elsewhere on the Dashboard; a shortfall for water, food or power can be queued onto the shopping list as a generic item with one tap, ready to be edited into something specific. The Family Hub also tracks **medications** (person, name, dose, quantity on hand, refill date, prescriber, notes — see the privacy note in [Architecture](#architecture)); a medication whose refill date has passed surfaces on the Dashboard alongside overdue maintenance reminders. The printable emergency binder (Family Hub, or Household settings) renders the plan, meeting points, contacts, household members, medications, a readiness and inventory summary, and seasonal checklist progress as a single printable page, generated entirely from state already held in the browser so it works offline. The emergency drill button remains unavailable until a protected AI backend is added.

## Backups and migration

Export JSON from the old app and import it in **Household settings** after signing in. Supplies, shopping, appliances, reminders, checklists, kits, medications, consumption history and the plan are retained. Existing records merge by ID. Legacy records without IDs get new ones; repeated imports of such legacy files can duplicate those records. Imports never delete records absent from the backup, and an absent/null plan preserves the current plan. File limit: 2 MB; collection limits: 2,000 supplies, 2,000 shopping items, 200 appliances, 200 kits, 300 medications and 10,000 consumption events.

**Household settings** also offers CSV import/export for just the Supply Hub and Shopping List, for households that already track inventory in a spreadsheet. Export downloads one CSV covering both lists (a `collection` column of `inventory` or `shopping_list` tells them apart); importing that same CSV (or one built by hand with the same columns) goes through the same non-destructive merge-by-ID preview as a JSON backup — nothing is a separate endpoint or a separate confirmation step. Each row is validated independently through the same item schema JSON import uses, so one bad row (blank name, an unrecognized category, and so on) is skipped and reported rather than failing the whole file; every other valid row still imports. The same 2 MB file limit and 2,000-row-per-list limit apply, with excess rows reported the same way as any other invalid row.

Inventory/shopping item images are stored in object storage (Vercel Blob), never as base64 in Postgres. A legacy or imported item that still carries a base64 image is uploaded to object storage server-side the moment it's saved, and only the resulting URL is persisted; uploads are limited to 4 MB, sniffed by file signature (PNG/JPEG/WebP only, regardless of the claimed type), and namespaced by household so one household's images can never overwrite or delete another's. Deleting, bulk-deleting or replacing an item's image removes the now-orphaned object from storage as a best-effort cleanup after the save succeeds.

In addition to manual export/import, `/api/backup` is called on a schedule (see `vercel.json`'s `crons` entry, daily by default — Vercel's Hobby plan allows one run per day within an hour of the scheduled time) to encrypt the current household state (AES-256-GCM, key from `BACKUP_ENCRYPTION_KEY`) and store it in Postgres, pruning older backups beyond the most recent 30. **Household settings** shows the last successful backup's time and item counts, plus recent history including failures. Restoring an automatic backup decrypts and validates it server-side (rejecting anything corrupted, tampered with, or that fails schema validation) before showing the same non-destructive preview used for file imports — nothing is applied until you confirm the merge.

No data is retrieved automatically from the previous provider. Its cloud database is not altered or deleted. Keep the original backup until you have verified the import. The app caches the latest authenticated state locally and queues up to 100 edits while offline; queued writes sync after reconnecting and remain subject to server conflict checks.

Water units convert from US gallons, liters, mL or fluid ounces. Bottles/cases require a gallons-per-unit value; unknown units otherwise count as zero. Expired food and water do not count toward readiness. Power and food estimates still use simplified household assumptions.

Consumption entries record a date, quantity and optional note without changing the current stock quantity. Once an item has usage on at least two different dates, the app derives an average daily burn rate and projected depletion date; sparse history leaves the readiness calculations unchanged.

## Testing

| Command | Covers | Needs Postgres |
| --- | --- | --- |
| `npm test` | Validation, API behavior, readiness math, monitoring, contrast, and the migration suite | Optional (migration tests skip without it) |
| `npm run test:e2e` | Accessibility regressions against an isolated component harness | No |
| `npm run test:e2e:app` | The full signed-in app: login, add/edit/delete, shopping purchases, backup restore, two-device conflicts, offline and reconnect | Yes |
| `npm run build` | The production frontend compiles | No |

The two database-backed suites never touch a deployed database. Each one creates a uniquely named throwaway database on the server given by `TEST_DATABASE_URL` (default `postgres://postgres:postgres@127.0.0.1:5432/postgres`, matching the `postgres:16` service CI starts), runs the real `scripts/migrate.js` against it, and drops it afterwards. `npm run test:e2e:app` additionally starts the real dev server (Vite plus the `/api` handlers) on port 5183 and drives it with Chromium.

Locally, any Postgres you can create databases on will do:

```sh
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres --name northstar-test-db postgres:16
npm test && npm run test:e2e && npm run test:e2e:app
```

The serverless Neon driver normally speaks SQL over HTTP to Neon. For tests only, `tests/support/neonOverPostgres.js` swaps the driver's fetch function for one backed by a local Postgres connection. Nothing in `api/`, `server/` or `scripts/` knows about it, so the suites exercise the shipping code unmodified — the same migration script, the same `server/db.js` queries and the same API handlers a deployment runs.

### Before a production migration

Run the workflow (`Actions → Verify NorthStar Prep → Run workflow`, or rely on the run for the commit you are deploying) before running `npm run db:migrate` against production. The migration suite applies `scripts/migrate.js` to an empty database, re-applies it to prove it is re-runnable, backfills a pre-relational deployment from the old JSONB row, and then reads and writes household state through `server/db.js` — so a migration that does not apply, is not idempotent, or drifts from the columns the app queries fails in CI rather than against live household data.

## Monitoring and alerts

`GET /api/health` reports API reachability, whether Postgres answers, and the round-trip latency of that probe; it needs no login, so it works as an uptime check. Signed in, the same response adds a 24-hour summary — requests measured, failed saves, server errors, sign-in failures, rate-limited attempts and average/peak database latency — which **Household settings → Service health** renders alongside the current status.

Every API response is logged as one structured JSON line carrying a request correlation ID, route, method, status, outcome and latency. The ID comes from the caller's `x-request-id` header when it looks like an ID and is generated otherwise; it is always echoed back in the response's `x-request-id` header, and the browser sends one on every call, so a failure a household member reports can be found in the production logs directly. Failures add a second `request_failure` line with the error's type (never its message or any request body).

The same signals are aggregated into per-minute counters in Postgres, keyed only by route, outcome, status and latency. **No household contents, item names, user IDs, emails, IP addresses or request bodies are recorded** — the operational history is safe to read and retain independently of the data it describes. Counters are deleted after `METRICS_RETENTION_DAYS` (14 by default) by the daily cron that also takes the backup.

That same daily run records one **readiness snapshot** per day — water/food/power days, fuel hours, item count, low stock and expired count — which the Dashboard plots as a trend so a household can see whether it is more prepared than it was last month. Like request metrics, a snapshot holds aggregate figures only and never item contents, so the history is safe to retain independently of the data it describes. Snapshots are pruned after `READINESS_HISTORY_RETENTION_DAYS` (365 by default). The snapshot is written after the backup and cannot fail it: if the snapshot write fails, the cron still reports the backup as successful and logs a `readiness_snapshot_failure` event.

When failed writes and server errors on one route pass `ALERT_FAILURE_THRESHOLD` within `ALERT_WINDOW_MINUTES`, one alert is sent — the alert is claimed in the database first, so a burst of failures across concurrent instances produces a single notification, and the same route stays quiet for `ALERT_COOLDOWN_MINUTES` afterward. With `ALERT_WEBHOOK_URL` set, the alert is POSTed as JSON (a Slack-compatible `text` field plus route, counts, window and environment); without it, the alert is written to the logs as an `alert` event for log-based alerting. Wrong passwords are counted as sign-in failures and shown in the UI, but never alerted on — rate limiting already covers them. Metrics and alerting are best effort: if Postgres is unreachable, requests still succeed or fail on their own merits and the structured logs remain the fallback signal.

The emergency drill remains unavailable until a protected AI backend is added; meal planning and gap analysis were removed and replaced with deterministic readiness math (see [Family Hub and the emergency binder](#family-hub-and-the-emergency-binder)). See [review notes](docs/REVIEW.md) for remaining limitations.
