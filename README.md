# NorthStar Prep

React household preparedness tracker, prepared for Vercel with Vite and Tailwind CSS.

## Local development

1. Run `npm install`.
2. Copy `.env.example` to `.env.local` and populate the Firebase web configuration and hub ID.
3. Enable Firebase Anonymous Authentication and Firestore in your existing project.
4. Review `firestore.rules` before applying it to your existing database. These rules require a membership document at `artifacts/HUB_ID/members/FIREBASE_AUTH_UID`, provisioned by an administrator. Hub IDs do not grant access.
5. Run `npm run dev`; run `npm run build` to check production output.

Anonymous authentication is retained from the original app. Membership must be provisioned separately for each browser UID; clearing browser storage can lose that identity. Persistent sign-in and household invitations remain production follow-up work. Do not open database rules to all anonymous users.

## GitHub and Vercel

The workspace already contains an empty Git repository. Use a private repository because the source includes household-specific text.

After authenticating GitHub CLI:

```sh
git add .
git commit -m "Prepare NorthStar Prep for Vercel"
gh repo create northstar-prep --private --source=. --remote=origin --push
```

Import that repository in Vercel, choose Vite, build with `npm run build`, and publish `dist`. Add `VITE_FIREBASE_CONFIG` and `VITE_HUB_ID` in the appropriate Vercel environment before building. Add the deployment domain in Firebase Authentication's authorized domains. No Gemini key belongs in a VITE variable; these values are bundled into the browser.

AI functionality is explicitly unavailable until an authenticated, rate-limited backend is implemented. No production deployment or database rule changes have been performed.

## Backups

Exports include supplies, shopping, appliances and the family plan. Imports merge records by exported ID and restore the plan; they do not delete existing records. Legacy records without IDs receive new IDs and repeat imports can duplicate those legacy records. Imports are limited to 5 MB and 450 records for a single atomic batch.

See `docs/REVIEW.md` for findings and remaining limitations.
