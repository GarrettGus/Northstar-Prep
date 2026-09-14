# Review and migration status

## Implemented

- Removed the previous cloud database/auth SDK, injected configuration, public hub paths and security-rules file.
- Added Neon Postgres with a Vercel API boundary; credentials never enter the browser bundle.
- Added household login, signed seven-day sessions, secure production cookies, database-backed login attempt limits, JSON/origin checks and fail-closed configuration handling.
- Added server-side schemas for inventory, appliances and plans; malformed backups and unsafe image URLs are rejected.
- Atomic state updates use revision checks and bounded conflict retries. Shopping purchases are idempotent and cannot partially add/delete or overwrite an inventory ID collision.
- Restore includes the family plan and retains backup record IDs; merges preserve unrelated existing records.
- Polling results carry revisions so older responses cannot replace newer data. Failed writes keep forms open; delete succeeds before closing an editor.
- Removed hardcoded family identities and legacy recovery IDs before public publication.
- Water units convert to US gallons; bottle/case sizes can be specified. Expired food/water are excluded, and expiration compares local calendar dates through the end of the expiry day.
- Fractional number inputs, prototype-safe grouping, local development API, backup URL cleanup and responsive navigation fixes retained.
- Added an installable app shell, local authenticated-state cache, bounded offline action queue and reconnect sync.
- Added configurable readiness assumptions and settings backup support.
- Added inventory search/status filters, multi-select and atomic bulk deletion.
- Added accessible names, progress semantics, save/sync/offline indicators and a database health endpoint.
- Audited text and icon-only control colors against WCAG AA contrast (4.5:1 for text, 3:1 for non-text UI components) and darkened the failing pairs (muted labels, delete/status text, macro tags, toggle states); added a regression test that pins the audited pairs' contrast ratios.
- Added Node 22 pinning and pull-request CI for tests and production builds.
- Readiness assumptions (household size, calories/water per person, survival/heat/power goals, battery usable capacity and inverter efficiency) are configurable per household, persisted with the state, and shown as plain-language assumptions on the dashboard. Fuel items can be tagged by fuel type, and heat hours are broken down per type.
- Replaced the single shared household password with individual accounts: email + scrypt-hashed password, a household membership table with owner/member roles, shareable one-time invite links (no outbound email needed), owner-only member removal (blocked for the last remaining owner), and an audit log recording who added, edited, deleted, bought, imported, or changed the plan/settings for every mutation. Session cookies now carry only a user ID; role and membership are re-checked from Postgres on every request. A one-time migration step (`HOUSEHOLD_OWNER_EMAIL` + the existing `HOUSEHOLD_PASSWORD`) creates the first owner account from an existing deployment.
- Normalized the household's single JSONB row into per-collection tables (inventory, shopping items, appliances, plan, family members, contacts, settings), each keyed by `household_id` with indexes on household+category lookups. A write now diffs the incoming state against what was last read and only inserts/updates/deletes the rows that actually changed, inside one version-guarded transaction, instead of rewriting the whole household on every edit; concurrent edits to unrelated records no longer contend. The migration script backfills the new tables from the existing JSONB row once (idempotent, safe to re-run) and leaves that row and column in place as a fallback; the GET/POST `/api/hub` contract (`{data, version}`, optimistic-concurrency retries, backup import/export) is unchanged.
- Added scheduled, encrypted household backups: a Vercel Cron job calls `/api/backup` (authorized by a `CRON_SECRET` bearer header Vercel adds automatically), which encrypts the current state with AES-256-GCM (`BACKUP_ENCRYPTION_KEY`) and records it in Postgres with a checksum and item counts, pruning beyond the most recent 30. Household settings shows the last successful backup's time/counts and recent history, including failures with their error. Restoring one is validated end-to-end before anything is applied: the auth tag and checksum must both check out and the decrypted JSON must pass the same schema used for manual imports, or the request fails with a clear error and nothing changes; a valid one reuses the existing non-destructive, record-count preview and by-ID merge already used for manual JSON backups.

- Moved inventory/shopping item images out of the Postgres state document into Vercel Blob object storage. Any base64 image data carried by an add/update/import action (including legacy backups and offline-queued edits) is uploaded server-side before the write, sniffed against its actual file signature and capped at 4 MB (PNG/JPEG/WebP only); the database only ever stores the resulting object storage URL. Images are namespaced by household and item so ownership is enforced structurally. Deleting an item, bulk-deleting, or replacing its image removes the now-orphaned object from storage as a best-effort cleanup after the save commits. A one-off `npm run db:migrate-images` script moves any pre-existing base64 images already in Postgres to object storage.
- Added the remaining inventory-management scope beyond search/filters/multi-select/duplicate detection (already shipped): atomic bulk quantity edits (set an absolute value or adjust by a delta) and bulk category changes for selected items, validated server-side and applied to only the selected IDs in one version-guarded write; optional barcode capture per item (manual text entry, with camera-based scanning via the browser's BarcodeDetector API as progressive enhancement where supported, e.g. not Safari) that also feeds duplicate detection; and recurring supply entries (a configurable replenishment interval in days from purchase date) that surface a "due for restock" banner on the Supply Hub with a one-tap action to queue the due items onto the shopping list.

## Verification

`npm test` covers import validation/merge, atomic purchases, collision protection, cookie tampering/expiration/session-secret rotation, cross-origin rejection, unauthenticated API denial, conflict retries, water conversions, local expiration dates, configurable readiness math (household size scaling, zero-need divide-by-zero guards, battery/inverter loss, fuel-type grouping, and legacy state defaulting), password hashing, invitation token validity/expiry/email-matching, owner/member permission enforcement (including last-owner and self-removal protection), audit log recording, image data-URL signature validation and object-storage cleanup, bulk quantity/category updates (including validation rejections), barcode/recurring-days schema validation, and recurring-due date math. `npm run build` compiles the production frontend. Live database and deployment results are reported in the task, not implied by unit tests. Camera-based barcode scanning cannot be exercised headlessly (it needs a real camera and a browser that implements `BarcodeDetector`); the manual barcode text field is the tested, universally-available fallback.

## Remaining limitations

- No account recovery flow (password reset) yet; a locked-out owner needs direct database access to reset a password hash. No email verification on invite acceptance beyond matching the invited address.
- No automatic migration from the old database. Import a JSON export and verify counts and household details.
- AI remains explicitly unavailable.
- Simplified calorie/power assumptions; no inverter loss, battery derating, surge or individualized nutrition model.
- Offline edits are cached in browser storage and limited to 100 queued actions; clearing site data loses unsynced edits. Keep a downloaded backup for outages.
- Power estimates account for battery usable capacity and inverter efficiency, but not surge loads or individualized nutrition models.
- Offline edits are cached in browser storage and limited to 100 queued actions; clearing site data loses unsynced edits. Keep a downloaded backup for outages.
- Accessibility regression coverage is limited to a static contrast-ratio test; no automated browser-based accessibility scan runs in CI yet. Family member/contact editing is limited to backup import; shelter editing is supported.
- Login-limit rows should be periodically purged after expiration for long-lived deployments. They store hashed IP identifiers, not raw IP addresses.
- Every mutation is recorded in the audit log, but conflicting edits to the same field still follow successful server processing order rather than a field-level merge.
- Automatic backups live in the same Postgres database as the household data they protect; they are not copied off-site, so a full database loss takes the backups with it. There is no encryption key rotation or re-encryption of existing backups if `BACKUP_ENCRYPTION_KEY` changes — older backups become unrestorable and should be treated as invalidated. Backup history is not itself covered by the audit log.

## Official references

- https://neon.com/docs/serverless/serverless-driver
- https://vercel.com/docs/functions/runtimes/node-js
