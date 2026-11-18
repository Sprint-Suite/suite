# Hub browser tests — design

2026-11-18. Approved approach: real `server.js` + seeded DB + Playwright, run in CI.

## Why

The hub's checks that need behaviour in a real browser currently sit on David's manual
to-do list. supertest proves the HTML is served; it cannot prove a click does or does
not submit, that the CSP lets a page render cleanly, or that a cookie choice survives a
reload. These tests replace the manual list so a regression is caught before merge.

**Done means:** the checks below run green locally with `npm run test:e2e` in `hub/` and
in a CI job on every PR. Anything else is a new project.

## Goals

1. **Confirm modal** (`public/js/confirm-modal.js`, forms with `data-confirm`): for each
   of Make owner (`/company/:slug`), Approve and Reject-with-note (`/admin/companies`),
   Remove (`/company/:slug`): clicking the button opens the modal with the expected title;
   **Cancel closes it and no request is sent** (assert via a request listener and
   unchanged DB/page state). One positive path: Remove → confirm → member gone, to prove
   the modal is not simply swallowing every submit.
2. **Layout at two widths** (1280 and 400 px) for `/company/:slug` and
   `/admin/companies/:slug`: page renders, no horizontal page scroll
   (`scrollWidth <= clientWidth` on the document), the member/owner table is present.
   No screenshot diffing — taste stays with David.
3. **Consent withdrawal** on `/privacy` with `GA_MEASUREMENT_ID=G-TEST`. Google hosts
   are intercepted with `page.route` and fulfilled with inert JS (so containment adds no
   console errors), and every intercepted request is recorded. Assertions:
   - **no** Google request before a choice is made;
   - Accept → a Google script/collect request **is** intercepted; reload → no bar, and a
     request is intercepted again (granted branch);
   - seed `_ga` / `_ga_TEST` cookies, click "Change your analytics choice" → Reject →
     immediately `window['ga-disable-G-TEST'] === true`, a queued
     `consent update analytics_storage:'denied'` in `dataLayer`, the `_ga*` cookies are
     deleted, `ss_consent=denied`;
   - reload twice → bar hidden and **no** Google request on either load.
   The positive request assertions are what make this discriminating: deleting the
   `applyConsent` call in `choose()` must fail the test, not only a missing cookie.
4. **CSP-clean pages**: the 9 views de-inlined in `1423cbb` (admin/users, check-email,
   company/console, company/team, confirm, error, legal, login, request-received). Each
   case asserts it reached the **intended** view, not merely a clean page: expected
   document status, final URL, and a distinctive visible marker of that view; the
   response carries an enforced `Content-Security-Policy` matching that route's policy:
   the default policy (`script-src 'self'` only) for eight views, and the marketing
   policy for `request-received` (rendered by `POST /request` under
   `marketingMiddleware`), where `https://*.googletagmanager.com` is the one permitted
   extra script source and is asserted present. `style-src` is `'self'`-only and
   `unsafe-inline` is forbidden on every view. Then zero `securitypolicyviolation`
   events (init script), zero `console` errors and zero `pageerror` events. Seed what each
   view needs to render its populated state (a team for company/team, a valid magic token
   for confirm, rows so conditional forms appear). For `error.eta` only, ignore the single
   resource error whose URL and status are the **document's own**; script/stylesheet
   failures there still fail the test.

## Non-goals / anti-goals

- No contact with Resend at all. The server gets `RESEND_BASE_URL=http://127.0.0.1:9`
  (the Resend SDK reads it; port 9 refuses), so even an accidental send fails locally.
  Flows that send email (Approve confirm-through, invite, resend, login with a known
  email) are still only exercised up to **Cancel**.
- No visual-regression snapshots.
- No product-code changes. If a test can't be written without one, stop and raise it.
- Not testing prod (that is `infrastructure/smoke-sprintsuite.sh`).
- Poker/retro's floating `^1.59.1` Playwright pin is noted, not fixed here.

## Setup

- `hub/playwright.config.js` modelled on scrumpoker's: `testDir: './tests/e2e'`,
  `workers: 1`, `fullyParallel: false`, `webServer` runs `node server.js` on port
  **3067**, waits on `/healthz`, `reuseExistingServer: false`.
- Env for the server: `PORT=3067`, `NODE_ENV=production` (prod error handler and
  view caching — the session cookie's Secure flag only applies to the magic-link login,
  which tests never use), `BASE_URL=http://127.0.0.1:3067` (so the CSRF Origin guard accepts
  the browser), `DB_PATH` under `tests/e2e/.data/` (gitignored), dummy `RESEND_API_KEY`,
  `FROM_EMAIL`, `COOKIE_SECRET`, `ALLOWED_APP_DOMAINS`, the five `HUB_API_KEY_*`, and
  `GA_MEASUREMENT_ID=G-TEST`.
- Seeding: a helper opens the same `DB_PATH` with the hub's own `openDb()` (so
  migrations are the real ones) and inserts an admin, a company with an owner and a
  member, and a pending access request, a team, a valid magic token, plus a `central_sessions` row per user. Tests
  set the `hub_session` cookie for the role they need. Seeding must leave each spec
  independent: a spec that mutates (Remove) seeds its own rows.
- `@playwright/test` added to hub devDependencies at an **exact** version (the one
  already installed at `~/.cache/ms-playwright` if compatible). Script
  `"test:e2e": "playwright test"`. `npm test` is unchanged (its glob is
  `tests/*.test.js`, so `tests/e2e/*.spec.js` is not picked up).

## CI

A separate job `e2e` in `.github/workflows/ci.yml`: `npm ci` in `hub`,
`npx playwright install --with-deps chromium`, `npm run test:e2e`; upload the
`test-results/` trace on failure. Chromium only. `retries: 0` — a flaky test is a
defect to fix, not to retry past. *Builder's call:* `main` has no branch protection,
so like the existing `checks` job it reports rather than blocks; the triggers are the
existing ones (PRs into `main`, pushes to `main`/`feature/**`/`fix/**`). The working
branch is named `feature/hub-browser-tests` so pushes run it before the PR.

## Left to the builder

File split across specs, selector choices, the exact DB-wait for "the DB file exists
before seeding" vs seeding in `globalSetup` after the server migrates, and whether the
seed helper is ESM (the hub is `"type": "module"`).
