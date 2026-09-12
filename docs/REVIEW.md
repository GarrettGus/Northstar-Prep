# Review and migration status

## Implemented

- Removed the previous cloud database/auth SDK, injected configuration, public hub paths and security-rules file.
- Added Neon Postgres with a Vercel API boundary; credentials never enter the browser bundle.
- Added shared household login, signed seven-day sessions, secure production cookies, database-backed login attempt limits, JSON/origin checks and fail-closed configuration handling.
- Added server-side schemas for inventory, appliances and plans; malformed backups and unsafe image URLs are rejected.
- Atomic state updates use revision checks and bounded conflict retries. Shopping purchases are idempotent and cannot partially add/delete or overwrite an inventory ID collision.
- Restore includes the family plan and retains backup record IDs; merges preserve unrelated existing records.
- Polling results carry revisions so older responses cannot replace newer data. Failed writes keep forms open; delete succeeds before closing an editor.
- Removed hardcoded family identities and legacy recovery IDs before public publication.
- Water units convert to US gallons; bottle/case sizes can be specified. Expired food/water are excluded, and expiration compares local calendar dates through the end of the expiry day.
- Fractional number inputs, prototype-safe grouping, local development API, backup URL cleanup and responsive navigation fixes retained.

## Verification

`npm test` covers import validation/merge, atomic purchases, collision protection, cookie tampering/expiration/password rotation, cross-origin rejection, unauthenticated API denial, conflict retries, water conversions and local expiration dates. `npm run build` compiles the production frontend. Live database and deployment results are reported in the task, not implied by unit tests.

## Remaining limitations

- Single shared household password; no individual roles, invites or user audit trail. Use a strong generated password and rotate it when access should be revoked.
- No automatic migration from the old database. Import a JSON export and verify counts and household details.
- AI remains explicitly unavailable.
- Simplified calorie/power assumptions; no inverter loss, battery derating, surge or individualized nutrition model.
- Network connection required; no offline service worker or durable write queue. Keep a downloaded backup for outages.
- Modal focus trapping and some icon-button accessibility need refinement. Family member/contact editing is limited to backup import; shelter editing is supported.
- Login-limit rows should be periodically purged after expiration for long-lived deployments. They store hashed IP identifiers, not raw IP addresses.
- Stock count changes are not an audit ledger. Conflicting edits to the same field follow successful server processing order.

## Official references

- https://neon.com/docs/serverless/serverless-driver
- https://vercel.com/docs/functions/runtimes/node-js
