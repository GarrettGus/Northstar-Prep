# NorthStar Prep

A household preparedness tracker built with React, Vite and Tailwind, backed by Neon Postgres and Vercel Functions.

## Architecture

The browser calls same-origin `/api/session` and `/api/hub` endpoints. Only server code connects to Postgres. A shared household passphrase creates a signed, HttpOnly, SameSite=Strict session cookie (Secure in production). All household data requires a valid session. Sessions last seven days; rotating either secret invalidates existing sessions. Login attempts are rate-limited in Postgres.

This is a **single-household application**. Anyone with the household password can read and modify that household. There is no anonymous access, client database SDK, or public hub-ID access. Do not use this shared-login design for unrelated households.

Database updates use compare-and-swap revisions and bounded retries. Shopping purchases move the current stored record atomically; backups merge by ID. Devices refresh every 15 seconds and on window focus.

## Setup

1. Create a Neon Postgres database through Vercel's marketplace, using its free plan if suitable. Connect it to this Vercel project. Accept any marketplace terms in your own account.
2. Set server-only environment variables:
   - `DATABASE_URL`: Neon connection string.
   - `HOUSEHOLD_PASSWORD`: a random password of at least 20 characters, shared only with household members.
   - `SESSION_SECRET`: an independent random value of at least 32 characters.
3. Copy `.env.example` to `.env.local` for local development, or pull the project's development variables using Vercel CLI. Never commit credentials. No `VITE_` variables are needed. Use `DATABASE_URL_UNPOOLED` for migrations when Neon provides it; the app uses pooled `DATABASE_URL` for request traffic.
4. Run `npm ci` and `npm run db:migrate`. The migration creates the tables and an empty household without overwriting existing records.
5. Run `npm run dev` for the frontend and API at `http://127.0.0.1:5173`. Check `GET /api/health` for a database health signal.
6. Run `npm test` and `npm run build`. Pull requests also run both checks through `.github/workflows/ci.yml`.

## Deploy

Target repository: [GarrettGus/Northstar-Prep](https://github.com/GarrettGus/Northstar-Prep).
Target Vercel project: `garrettgus-projects/northstar-prep`.

Use the Vite preset, `npm run build`, output directory `dist`, and Node 22 or newer. Vercel discovers the `/api` functions automatically. Run the database migration before the first login. Configure separate Neon branches/databases and environment variables for development, preview and production so preview builds cannot write household production data. Without configuration the app shows a setup message and denies data access.

`npm run preview` previews the compiled frontend only; use `npm run dev` or a Vercel deployment to exercise API functionality.

## Backups and migration

Export JSON from the old app and import it in **Household settings** after signing in. Supplies, shopping, appliances and the plan are retained. Existing records merge by ID. Legacy records without IDs get new ones; repeated imports of such legacy files can duplicate those records. Imports never delete records absent from the backup, and an absent/null plan preserves the current plan. File limit: 2 MB; collection limits: 2,000 supplies, 2,000 shopping items, 200 appliances.

No data is retrieved automatically from the previous provider. Its cloud database is not altered or deleted. Keep the original backup until you have verified the import. The app caches the latest authenticated state locally and queues up to 100 edits while offline; queued writes sync after reconnecting and remain subject to server conflict checks.

Water units convert from US gallons, liters, mL or fluid ounces. Bottles/cases require a gallons-per-unit value; unknown units otherwise count as zero. Expired food and water do not count toward readiness. Power and food estimates still use simplified household assumptions.

AI features remain unavailable until a protected backend is added. See [review notes](docs/REVIEW.md) for remaining limitations.
