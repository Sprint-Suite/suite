# Hub Browser Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Playwright tests that drive the real hub in Chromium and replace David's manual browser checks, run locally and in CI.

**Architecture:** `playwright.config.js` starts the real `hub/server.js` against a throwaway SQLite DB. Specs seed rows through one helper that uses the hub's own `openDb()`, then authenticate by setting the unsigned `hub_session` cookie. No product code changes.

**Tech Stack:** `@playwright/test` 1.59.1 (exact; same version as poker/retro, browsers already cached), Chromium, Node 24, ESM (`hub` is `"type": "module"`).

**Spec:** `docs/superpowers/specs/2026-11-18-hub-browser-tests-design.md`

## Global Constraints

- No product-code changes. If a test cannot be written without one, stop and report.
- No contact with Resend or Google: server env `RESEND_BASE_URL=http://127.0.0.1:9`, no `ADMIN_EMAIL`; Google hosts are intercepted in every page that loads GA.
- Never confirm an action that sends email (Approve, invite, resend, login with a **known** email). Cancel only.
- `@playwright/test` pinned `"1.59.1"` (no caret). `retries: 0`. Chromium only.
- `npm test` must stay unchanged and green (its glob `tests/*.test.js` must not pick up `tests/e2e/*.spec.js`).
- Each spec's discriminating power is proven by a **mutation step**: temporarily break the behaviour under test, see the spec go red, revert. Mutations are never committed.
- Code held to `/var/www/CodingStandards/core/THRESHOLDS.md` (30-line functions, 400-line files). Comments only for what a reader needs now.

## Review Focus

1. **Port 3067 already in use** (a leftover server) → `reuseExistingServer: false` makes Playwright fail loudly; do not change it to `true`, which would silently test a stale server.
2. **Stale DB between runs** → the config deletes `tests/e2e/.data/` at load, before the server starts; a run must not depend on a previous run's rows.
3. **Session idle cutoff (30 min) and rate limiters** → sessions are minted per test via `sessionFor()`, never shared across a long run; only one `POST /login` per run.
4. **Modal "Cancel" passes because the click never reached the form** → every cancel test first asserts the dialog is visible with the form's exact `data-confirm-title`, so a missing modal fails rather than passes.
5. **GA interception silently not applied** → the consent spec asserts at least one intercepted Google request after Accept; an un-routed request would hit the network and the positive assertion would still be checked against the recorded list, so routing is installed before `goto`.

---

### Task 1: Harness — config, seed helper, smoke spec

**Files:**
- Modify: `hub/package.json` (devDependency `"@playwright/test": "1.59.1"`, script `"test:e2e": "playwright test"`), `hub/package-lock.json`
- Modify: `.gitignore` (add `hub/tests/e2e/.data/`, `hub/test-results/`, `hub/playwright-report/`)
- Create: `hub/playwright.config.js`
- Create: `hub/tests/e2e/helpers/seed.js`
- Create: `hub/tests/e2e/smoke.spec.js`

**Interfaces:**
- Produces (`helpers/seed.js`, ESM):
  - `const IDS = { admin: 'u-admin', owner: 'u-owner', member: 'u-member', company: 'c-acme', slug: 'acme', team: 't-alpha', request: 'r-pending' }`
  - `const EMAILS = { admin: 'admin@e2e.test', owner: 'owner@e2e.test', member: 'member@e2e.test' }`
  - `seedBase(): void` — idempotent (`INSERT OR IGNORE`): admin user (`is_admin=1`); company `Acme` / slug `acme`; owner + member in `company_members` (roles `owner`, `member`); team `Alpha` with the member in `team_members`; one `pending` access request (company `Globex`, contact `Gina`, email `gina@e2e.test`).
  - `addMember(email: string): string` — inserts a user + `member` row in Acme, returns the user id.
  - `sessionFor(userId: string): string` — inserts a `central_sessions` row (expires +1h, heartbeat now), returns the sid.
  - `mintToken(email: string): string` — wraps `mintMagicToken` from `hub/lib/magic-tokens.js`, 15-min TTL.
  - `signIn(context, userId): Promise<void>` — `sessionFor` + `context.addCookies([{ name: 'hub_session', value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }])`.
  - `DB_PATH`, `BASE` (`http://127.0.0.1:3067`).
  - Opens the DB with the hub's `openDb(DB_PATH)` (real migrations; WAL makes it safe alongside the server).

- [ ] **Step 1: Install** `cd hub && npm install --save-dev --save-exact @playwright/test@1.59.1`. Expected: `package.json` shows `"1.59.1"` without `^`.
- [ ] **Step 2: Write `playwright.config.js`** modelled on `/var/www/scrumpoker/playwright.config.js`, ESM, with: `testDir: './tests/e2e'`, `workers: 1`, `fullyParallel: false`, `retries: 0`, `reporter: 'list'`, `use: { baseURL: BASE, headless: true, trace: 'retain-on-failure' }`, a top-level `fs.rmSync(dataDir, { recursive: true, force: true })` + `mkdirSync`, and `webServer: { command: 'node server.js', url: BASE + '/healthz', reuseExistingServer: false, env }` where `env` sets: `PORT=3067`, `NODE_ENV=production`, `BASE_URL=http://127.0.0.1:3067`, `DB_PATH`, `RESEND_API_KEY=re_test`, `RESEND_BASE_URL=http://127.0.0.1:9`, `FROM_EMAIL=hub@e2e.test`, `COOKIE_SECRET=e2e-cookie-secret`, `ALLOWED_APP_DOMAINS=http://127.0.0.1:3067`, `HUB_API_KEY_{RAID,SIGNAL,RETRO,POKER,PLAN}=test-<app>`, `GA_MEASUREMENT_ID=G-TEST`, `LOG_LEVEL=warn`.
- [ ] **Step 3: Write the seed helper** to the interface above.
- [ ] **Step 4: Write `smoke.spec.js`**: `test('owner reaches the company console')` — `seedBase()`, `signIn(context, IDS.owner)`, `goto('/company/acme')` → response status 200, URL ends `/company/acme`, `getByText(EMAILS.member)` visible.
- [ ] **Step 5: Run** `cd hub && npm run test:e2e`. Expected: 1 passed. Mutation: sign in as `IDS.member` instead → red (redirect / 4xx). Revert.
- [ ] **Step 6: Run** `cd hub && npm test`. Expected: same count as before (491), all green.
- [ ] **Step 7: Commit** the files above: `test(hub): Playwright harness against the real server`.

### Task 2: Confirm modal

**Files:** Create `hub/tests/e2e/confirm-modal.spec.js`

**Interfaces:** Consumes `seedBase, addMember, signIn, IDS, EMAILS` from Task 1. Modal DOM (from `public/js/confirm-modal.js`): `.confirm-backdrop` (hidden via `hidden` attr), `.confirm-title`, `.confirm-cancel`, `.confirm-ok`.

- [ ] **Step 1: Write a table-driven cancel test** over four cases `{ name, user, path, form (locator for the form by its action), title }`:
  - Make owner — owner, `/company/acme`, form action `…/members/u-member/role`, title `Make owner`
  - Remove — owner, `/company/acme`, `…/members/u-member/remove`, `Remove member`
  - Approve — admin, `/admin/companies`, `/admin/requests/r-pending/approve`, `Approve request`
  - Reject with note — admin, `/admin/companies`, `/admin/requests/r-pending/reject`, `Reject request` — fill the `review_note` input with `e2e note` before clicking.

  Each: record every non-GET request via `page.on('request')`; click the form's submit button; assert `.confirm-backdrop` visible and `.confirm-title` has exact text `title`; click `.confirm-cancel`; assert backdrop hidden; assert the recorded POST list is empty and `page.url()` unchanged; reload and assert the member/request row is still present (member email visible / `Globex` visible).
- [ ] **Step 2: Write `test('Remove → confirm actually removes the member')`**: `addMember('gone@e2e.test')`, owner signs in, click that member's Remove, click `.confirm-ok`, wait for navigation; assert `gone@e2e.test` is not visible on `/company/acme`.
- [ ] **Step 3: Run** `npm run test:e2e -- confirm-modal`. Expected: 5 passed.
- [ ] **Step 4: Mutation**: in `confirm-modal.js` make the cancel listener call `accept` instead of `close` → the four cancel tests go red. Revert; run again green.
- [ ] **Step 5: Commit**: `test(hub): browser test that confirm-modal Cancel never submits`.

### Task 3: Layout at two widths

**Files:** Create `hub/tests/e2e/layout.spec.js`

**Interfaces:** Consumes Task 1 helpers.

- [ ] **Step 1: Write tests** for each of `{ owner, '/company/acme' }` and `{ admin, '/admin/companies/acme' }` × viewport widths `[1280, 400]` (height 900): status 200; a `table` is visible containing `EMAILS.owner`; `await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)` is `true`.
- [ ] **Step 2: Run**. Expected: 4 passed.
- [ ] **Step 3: Mutation**: inject `page.addStyleTag({ content: 'main{min-width:900px}' })` in a scratch copy of one 400px case → red. Discard.
- [ ] **Step 4: Commit**: `test(hub): company pages fit desktop and phone width`.

### Task 4: Consent activation and withdrawal

**Files:** Create `hub/tests/e2e/consent.spec.js`

**Interfaces:** No session needed (`/privacy` is public). Consent cookie `ss_consent`; GA cookies `_ga`, `_ga_TEST`; opt-out flag `window['ga-disable-G-TEST']`; denied update is a `dataLayer` entry whose args are `['consent','update',{analytics_storage:'denied'}]`.

- [ ] **Step 1: Write a route helper** in the spec: `context.route(/googletagmanager\.com|google-analytics\.com/, r => { hits.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); })`, installed before the first `goto`. Collect `console` errors and `pageerror` into an array asserted empty at the end.
- [ ] **Step 2: Write `test('withdrawal stops analytics and survives two reloads')`** as one sequential test:
  1. `goto('/privacy')` → consent bar visible; `hits` empty.
  2. click Accept → bar hidden; `hits.length > 0`; `ss_consent=granted`.
  3. reload → bar not visible; `hits` grew (granted branch reloads GA).
  4. `context.addCookies` `_ga` and `_ga_TEST` on `127.0.0.1`; click "Change your analytics choice" → bar visible; click Reject.
  5. Immediately: `window['ga-disable-G-TEST'] === true`; `dataLayer` contains the denied update; `_ga` and `_ga_TEST` absent from `context.cookies()`; `ss_consent=denied`.
  6. clear `hits`; reload; reload → bar not visible, `hits` empty both times.
- [ ] **Step 3: Run**. Expected: 1 passed.
- [ ] **Step 4: Mutation**: delete the `applyConsent(value, gaId)` line in `choose()` in `consent-banner.js` → red at step 2 or 5. Revert; green.
- [ ] **Step 5: Commit**: `test(hub): consent withdrawal really stops analytics`.

### Task 5: The nine de-inlined views under the real CSP

**Files:** Create `hub/tests/e2e/csp-pages.spec.js`

**Interfaces:** Consumes Task 1 helpers. A `cspIsClean(page)` init script: `page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); })`.

- [ ] **Step 1: Write a table of nine cases** `{ view, reach(page, context) → Response, status, urlPattern, marker, policy }`:

| view | how to reach | status | marker | policy |
|---|---|---|---|---|
| login | `goto('/login')` | 200 | email input | default |
| check-email | on `/login` fill `nobody@e2e.test` (unknown → no send), submit | 200 | text `nobody@e2e.test` | default |
| confirm | `goto('/auth/magic?token=' + mintToken(EMAILS.member))` | 200 | the sign-in submit button | default |
| error | `goto('/auth/magic?token=bogus')` | 400 | error page heading | default |
| legal | `goto('/terms')` | 200 | heading `Terms` | default |
| request-received | `goto('/request')`, fill the required fields with `Initech` / `Ian` / `ian@e2e.test`, submit | 200 | received-page heading | marketing |
| admin/users | admin, `goto('/admin')` | 200 | text `EMAILS.owner` | default |
| company/console | owner, `goto('/company/acme')` | 200 | text `EMAILS.member` | default |
| company/team | owner, `goto('/company/acme/teams/t-alpha')` | 200 | text `Alpha` | default |

  Exact marker text comes from the view file; pick one string unique to that view.
- [ ] **Step 2: For each case assert**: document `response.status()`, URL, marker visible; `response.headers()['content-security-policy']` exists, contains `style-src 'self'`, has no `unsafe-inline`; for **default** its `script-src` directive is exactly `'self'`; for **marketing** `script-src` contains `https://*.googletagmanager.com`. Then `window.__csp` is empty, no `pageerror`, no console errors — except on `error`, ignore only the console message that names the document's own URL with status 400.
- [ ] **Step 3: Run**. Expected: 9 passed.
- [ ] **Step 4: Mutation**: add `style="color:red"` to one element in `views/legal.eta` and restart via the run → `legal` red with a CSP violation. Revert; green.
- [ ] **Step 5: Commit**: `test(hub): nine de-inlined views are CSP-clean in a real browser`.

### Task 6: CI job

**Files:** Modify `.github/workflows/ci.yml`

- [ ] **Step 1: Add job `e2e`** (`name: Hub browser tests`, `runs-on: ubuntu-latest`, `permissions: contents: read`, same `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env, same checkout/setup-node@v6 Node 24 with npm cache on `hub/package-lock.json`). Steps: `npm ci` in `hub`; `npx playwright install --with-deps chromium` in `hub`; `npm run test:e2e` in `hub`; on `failure()` `actions/upload-artifact@v4` with `hub/test-results/`, `retention-days: 7`. Same triggers as the existing workflow.
- [ ] **Step 2: Run the full local suite** `cd hub && npm test && npm run test:e2e`. Expected: 491 + 20 passed.
- [ ] **Step 3: Commit and push** `feature/hub-browser-tests`: `ci: run hub browser tests`. Expected: both CI jobs green on GitHub (`gh run list --branch feature/hub-browser-tests --limit 2`).
