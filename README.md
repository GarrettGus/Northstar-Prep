# NorthStar Prep

A household preparedness tracker built with React, Vite and Tailwind, backed by Neon Postgres and Vercel Functions.

## Architecture

The browser calls same-origin `/api/session`, `/api/hub`, `/api/members` and `/api/invite` endpoints. Only server code connects to Postgres. Individual accounts (email plus a scrypt-hashed password) sign in to create a signed, HttpOnly, SameSite=Strict session cookie (Secure in production) that carries just the user's ID; every request re-checks that user's household membership and role directly from Postgres rather than trusting a role baked into the cookie. Sessions last seven days; rotating `SESSION_SECRET` invalidates all of them. Login attempts are rate-limited in Postgres.

This is a **single-household application** with individual accounts inside it. An owner invites others from **Household settings**, which generates a one-time shareable link (there is no outbound email — send the link yourself); members can be promoted to owner at invite time or removed later, and every add, edit, delete, purchase, import, plan and settings change is recorded with who made it. There is no anonymous access, client database SDK, or public hub-ID access. Do not use this shared-household design for unrelated households.

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
3. Copy `.env.example` to `.env.local` for local development, or pull the project's development variables using Vercel CLI. Never commit credentials. No `VITE_` variables are needed. Use `DATABASE_URL_UNPOOLED` for migrations when Neon provides it; the app uses pooled `DATABASE_URL` for request traffic.
4. Run `npm ci` and `npm run db:migrate`. The migration creates the tables (household state, accounts, membership, invitations, audit history) without overwriting existing records, and creates the first owner account from `HOUSEHOLD_OWNER_EMAIL`/`HOUSEHOLD_PASSWORD` the first time it runs with no accounts yet. If upgrading a deployment that already has inventory images stored as base64 in Postgres (from before object storage was added), run `npm run db:migrate-images` once `BLOB_READ_WRITE_TOKEN` is set to move them to object storage; it's safe to re-run and leaves already-migrated rows untouched.
5. Run `npm run dev` for the frontend and API at `http://127.0.0.1:5173`. Check `GET /api/health` for a database health signal. Sign in with the owner email and password from step 4, then invite other household members from **Household settings**.
6. Run `npm test` and `npm run build`. Pull requests also run both checks through `.github/workflows/ci.yml`.

### Migrating from the shared household password

Earlier versions of this app used one `HOUSEHOLD_PASSWORD` shared by everyone. To move to individual accounts: set `HOUSEHOLD_OWNER_EMAIL` alongside the existing `HOUSEHOLD_PASSWORD`, redeploy, then re-run `npm run db:migrate` against production. That creates the first owner account from those two values — sign in with that email and the same password. The shared password stops working for login from that point on (existing household data is untouched); invite everyone else individually afterward.

## Deploy

Target repository: [GarrettGus/Northstar-Prep](https://github.com/GarrettGus/Northstar-Prep).
Target Vercel project: `garrettgus-projects/northstar-prep`.

Use the Vite preset, `npm run build`, output directory `dist`, and Node 22 or newer. Vercel discovers the `/api` functions automatically. Run the database migration before the first login. Configure separate Neon branches/databases and environment variables for development, preview and production so preview builds cannot write household production data. Without configuration the app shows a setup message and denies data access.

`npm run preview` previews the compiled frontend only; use `npm run dev` or a Vercel deployment to exercise API functionality.

## Inventory management

Supply Hub and Shopping List support search (name, category, store, unit), status filters (low stock, expiring, expired), multi-select and duplicate detection (matching name+category, or a matching barcode) before an item is created. Selecting items also exposes bulk actions: set a category or set/adjust quantity (by an absolute value or a +/- delta) across every selected item in one request, alongside bulk delete. Each item can carry an optional barcode, entered manually or captured with the device camera via the browser's `BarcodeDetector` API where supported (Chrome/Edge; Safari falls back to the manual field, which is always available). Items can also be marked to recur every N days from their purchase date; due items surface a "due for restock" banner with a one-tap action that queues them onto the shopping list.

## Backups and migration

Export JSON from the old app and import it in **Household settings** after signing in. Supplies, shopping, appliances and the plan are retained. Existing records merge by ID. Legacy records without IDs get new ones; repeated imports of such legacy files can duplicate those records. Imports never delete records absent from the backup, and an absent/null plan preserves the current plan. File limit: 2 MB; collection limits: 2,000 supplies, 2,000 shopping items, 200 appliances.

Inventory/shopping item images are stored in object storage (Vercel Blob), never as base64 in Postgres. A legacy or imported item that still carries a base64 image is uploaded to object storage server-side the moment it's saved, and only the resulting URL is persisted; uploads are limited to 4 MB, sniffed by file signature (PNG/JPEG/WebP only, regardless of the claimed type), and namespaced by household so one household's images can never overwrite or delete another's. Deleting, bulk-deleting or replacing an item's image removes the now-orphaned object from storage as a best-effort cleanup after the save succeeds.

In addition to manual export/import, `/api/backup` is called on a schedule (see `vercel.json`'s `crons` entry, daily by default — Vercel's Hobby plan allows one run per day within an hour of the scheduled time) to encrypt the current household state (AES-256-GCM, key from `BACKUP_ENCRYPTION_KEY`) and store it in Postgres, pruning older backups beyond the most recent 30. **Household settings** shows the last successful backup's time and item counts, plus recent history including failures. Restoring an automatic backup decrypts and validates it server-side (rejecting anything corrupted, tampered with, or that fails schema validation) before showing the same non-destructive preview used for file imports — nothing is applied until you confirm the merge.

No data is retrieved automatically from the previous provider. Its cloud database is not altered or deleted. Keep the original backup until you have verified the import. The app caches the latest authenticated state locally and queues up to 100 edits while offline; queued writes sync after reconnecting and remain subject to server conflict checks.

Water units convert from US gallons, liters, mL or fluid ounces. Bottles/cases require a gallons-per-unit value; unknown units otherwise count as zero. Expired food and water do not count toward readiness. Power and food estimates still use simplified household assumptions.

AI features remain unavailable until a protected backend is added. See [review notes](docs/REVIEW.md) for remaining limitations.
