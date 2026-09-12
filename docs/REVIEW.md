# Code review

Reviewed the supplied single-file React prototype. Severity reflects deployment and household-data consequences. The original attachment is unchanged.

## Findings addressed

- **P0 — Startup crash:** `__firebase_config` is undefined on Vercel. Added environment configuration with a visible setup error and Vite/Tailwind entry points.
- **P1 — Stale household data:** switching hubs retained inventory, shopping, appliances and a previous plan. Clear state before subscriptions and clear absent plans. Invalid hub IDs are rejected before constructing paths.
- **P1 — Backup restore:** import discarded the plan and generated new IDs for all documents. Preserve exported IDs, restore the plan, validate collection shape and cap batch/file size. Existing records are merged, not replaced wholesale.
- **P1 — Shopping move:** independent add/delete calls could duplicate inventory after partial failure. Use an atomic batch with the shopping record ID as the inventory ID.
- **P1 — Authentication failure:** failed login left an infinite loading screen. Show the error and stop loading; also report failures from shopping/appliance/plan subscriptions.
- **P1 — Broken AI:** `smartSuggestItem` and `smartSuggestAppliance` were undefined. Direct AI calls had an empty key and swallowed failures. Replaced with explicit unavailable behavior pending a protected server integration.
- **P2 — Lost form values:** failed additions reset the form. Retain form data when add returns false. Plan saves now await success and synchronize the editor with loaded plan data.
- **P2 — Incorrect heat estimate:** all fuel measured in pounds implicitly received four hours per pound, including explicit zero values. Removed the unsupported fallback.
- **P2 — Fractional input:** number fields used the browser default integer step. Allow decimal quantities/costs and prohibit negative values through native form validation.
- **P2 — Grouping crash:** store/category names such as `constructor` collide with normal object properties. Use a dictionary without inherited properties.
- **P2 — Minor robustness:** prevent document data from overriding Firestore IDs, revoke backup blob URLs, tolerate blocked localStorage, avoid NaN from missing appliance values, reduce bottom-nav overflow.

## Outstanding before production use

- **P1 — Access control:** original source contains no database rules; existing deployed permissions cannot be inferred. Supplied membership rules are an undeployed baseline, not evidence the existing database is secure. Persistent sign-in and membership provisioning need integration. Anonymous sign-in alone does not identify household members.
- **P1 — Water calculation:** quantity is treated as gallons regardless of unit. Bottles/liters/cases give wrong readiness results. Until unit conversion is implemented, enter water quantities only in US gallons.
- **P1 — Readiness assumptions:** expired food/water still contributes to totals; calorie needs are fixed at 8,000/day and power runtime ignores conversion losses, usable capacity and surge loads. Estimates are not validated preparedness guidance.
- **P2 — Write errors and repeated clicks:** update/delete controls lack consistent error handling and pending-state locks. Some edit/delete flows retain stale forms. Atomic purchase prevents partial moves but should additionally guard overlapping edits.
- **P2 — Import schema:** shape checks do not fully validate all numeric fields, dates, images or plan structure. Add a shared schema and enforce it in database rules/backend before accepting untrusted backups.
- **P2 — Date handling:** UTC parsing of date-only expiry values marks some items expired early; use household-local calendar dates and define end-of-day semantics.
- **P2 — Loading state:** inventory alone determines ready/synced state; other subscriptions may still be loading or failing. Aggregate per-collection readiness and errors.
- **P2 — Privacy and usability:** remove hardcoded family names, ages and legacy recovery IDs; add accessible names to icon controls, associated form labels, modal focus management, keyboard interaction and empty-plan editing.
- **P2 — Offline resilience:** no service worker or explicit offline database cache is configured. A preparedness app should be tested without connectivity.

## Verification scope

Build results are reported separately in the task response. Live Firestore behavior, security-rule emulator tests, browser flows and Vercel deployment require further verification. No existing Firebase data or rules were modified.

## Official references

- https://vercel.com/docs/frameworks/frontend/vite
- https://firebase.google.com/docs/rules/basics
- https://firebase.google.com/docs/rules/insecure-rules
