# Supplier ordering site

`site/` is the built site (Vite/React bundle, no source). Netlify (supplier-orders.netlify.app, formerly capable-boba-6868ba) deploys
`site/` on every push to `main`; there is no build step.

## Making a change
- Edit the bundle in `site/assets/` directly: JS in `index-CADbcqXc.js`, styles in `index-CKMdGbwq.css`
  (theme overrides are appended at the end). Keep file names; other chunks import them by name.
- Bump the version string `ei="X.Y"` in `index-CADbcqXc.js` for every release. The tests read it.
- Demo mode: open `/?demo` and set `sessionStorage.demo_role` to `admin` or `store` (fake data in localStorage).

## Before every push to main
Run the tests and push only if they pass:

    cd tests && npm ci && CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test
    node report.js ../דוח-בדיקות.md "לפני העלאה (עותק מקומי)=results/results.json"

Add a test for each new feature or fixed bug. GitHub Actions (`.github/workflows/tests.yml`) runs the
same tests again on the repo copy and on the live site after each push and commits `דוח-בדיקות.md`.

## Netlify and commit authors
The repo must stay public. On Netlify's free plan a private repo only deploys commits authored by the
owner and blocks the rest with "Unrecognized Git contributor".
