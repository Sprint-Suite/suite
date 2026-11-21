# Licence Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every app's "License" link opens the Suite-wide licence in a blurred-backdrop `<dialog>` over the tool, instead of navigating away.

**Architecture:** Two DOM-free/browser ES modules live in `suite/shared/theme` and sync into every surface's `public/js/` via the existing manifest. The licence wording lives once, in `licence-text.js`. The Hub renders it server-side, and each app imports it into the popup. The old per-app `license.html` pages are deleted and their URLs 301 to the Hub.

**Tech Stack:** Vanilla ES modules, native `HTMLDialogElement`, Express, Eta (Hub), `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-licence-modal-design.md` (Suite repo)

## Global Constraints

- Licence version `1.0`, effective date `4 June 2026`, wording copied verbatim from `hub/views/license.eta` (no edits).
- Privacy link inside the text: `https://sprintsuite.uk/privacy`, `target="_blank" rel="noopener"`.
- Link fallback href on every app: `https://sprintsuite.uk/license`; trigger attribute `data-licence-modal`.
- No inline styles or inline scripts anywhere (Signal and Hub CSP have no `'unsafe-inline'`); no CSP changes.
- All popup CSS lives in `shared/theme/instrument-core.css`; edit theme files **only** in `suite/shared/theme`, then run `node /var/www/suite/shared/theme/sync-theme.mjs <repo>`.
- Retired URLs return **301** to `https://sprintsuite.uk/license`.
- One branch + PR per repo, named `feat/licence-modal`, cut from that repo's up-to-date default branch (`main`; RAID `master`). **Signal is currently checked out on `feat/suite-auth` and Poker on `docs/delegated-host-debate`. Cut from the default branch, not from those.**
- Verify with each repo's own scripts: `npm test`, `npm run test:e2e`, plus `node /var/www/suite/shared/theme/check-theme-drift.mjs <repo>`.

## Review Focus

1. **Clicking License mid-vote in a live Poker room** — the room, the votes and the WebSocket must be untouched after closing. Pinned in Task 3.
2. **Opening, closing and reopening** — the second open must show the text once (not duplicated), and focus must still land on the heading. Pinned in Task 3.
3. **Narrow phone viewport (375×667)** — the dialog fits on screen, the Close button is reachable, and the body scrolls inside the dialog rather than the page. Pinned in Task 3.
4. **A link inside the licence text** — the privacy link opens a new tab and leaves the tool page in place. Pinned in Task 1 (attribute) and Task 3 (no navigation).
5. **Old bookmark `/licence` or `/license.html`** — it lands on the Hub page, not a 404. Pinned per app in Tasks 3–6.

---

### Task 1: Theme — licence text, popup module, styles (Suite repo)

**Files:**
- Create: `shared/theme/licence-text.js`, `shared/theme/licence-modal.js`
- Modify: `shared/theme/manifest.mjs` (`STATIC_ASSETS`), `shared/theme/instrument-core.css`
- Test: `shared/theme/tests/licence-text.test.mjs`

**Interfaces:**
- Produces (`licence-text.js`, no DOM use): `export const LICENCE_VERSION = '1.0'`, `export const LICENCE_EFFECTIVE = '4 June 2026'`, `export const LICENCE_TITLE = 'Free Use Licence'`, `export const LICENCE_HTML` (string: the `<p class="legal-meta">…` through section 11 from `license.eta`).
- Produces (`licence-modal.js`): side-effect module. On load, if `typeof HTMLDialogElement === 'function' && 'showModal' in HTMLDialogElement.prototype`, it binds one delegated click listener on `document` for `a[data-licence-modal]`. It builds a single `<dialog class="licence-modal" aria-labelledby="licence-modal-title">` lazily, then reuses it. The dialog contains `<h2 id="licence-modal-title" tabindex="-1">`, a `.licence-modal__meta` line ("Version 1.0 · Effective 4 June 2026"), a scrollable `.licence-modal__body` holding `LICENCE_HTML`, and a `<button type="button" class="btn licence-modal__close">Close</button>`.
- Manifest entries: `{ src: 'licence-text.js', destDir: 'js' }`, `{ src: 'licence-modal.js', destDir: 'js' }`.

- [ ] **Step 1: Write the failing test** `tests/licence-text.test.mjs`:
  - `LICENCE_VERSION === '1.0'` and `LICENCE_EFFECTIVE === '4 June 2026'`.
  - `LICENCE_HTML` includes `'1. Grant of licence.'` and `'11. Governing law.'`.
  - `LICENCE_HTML` matches `/href="https:\/\/sprintsuite\.uk\/privacy"[^>]*target="_blank"[^>]*rel="noopener"/`.
  - `LICENCE_HTML` does not match `/\sstyle=|<script/i`.
  - `ASSETS` contains both new `src` entries with `destDir: 'js'`.
- [ ] **Step 2: Run** `node --test shared/theme/tests/*.test.mjs`. Expected: the new test fails (module not found). The others pass.
- [ ] **Step 3: Create `licence-text.js`** by moving the section body out of `hub/views/license.eta`. Leave the `.eta` untouched until Task 2. Add the manifest entries.
- [ ] **Step 4: Create `licence-modal.js`.**
  - On click: `preventDefault`, remember the trigger, call `showModal()`, then focus the heading.
  - On the dialog's `close` event: focus the remembered trigger.
  - A click whose `event.target === dialog` (the backdrop) calls `close()`. The Close button calls `close()`. Esc is native.
- [ ] **Step 5: Add CSS to `instrument-core.css`** using the existing tokens:
  - `.ins dialog.licence-modal`: `margin:auto` (restoring the `.ins *` reset, as in Retro `98f3e61`), `max-width:min(760px, calc(100vw - 32px))`, `max-height:calc(100dvh - 32px)`, flex column, and the panel, radius and shadow tokens.
  - `.licence-modal__body`: `overflow:auto`.
  - `.ins dialog.licence-modal::backdrop`: `backdrop-filter:blur(6px)` plus a translucent ink dim.
- [ ] **Step 6: Run** the theme tests. Expected: all pass, including the `instrument-core-css` test.
- [ ] **Step 7: Commit** on `feat/licence-modal` in `/var/www/suite`: `feat(theme): shared licence popup and canonical licence text`. In the same branch, move `/var/www/scrumpoker/docs/debates/2026-11-21-design-final-suite-wide-licence-popup-shared-dialo.md` to `suite/docs/debates/`. Remove it from the Poker branch `docs/delegated-host-debate` in a separate Poker commit.

### Task 2: Hub renders the shared text (Suite repo)

**Files:**
- Modify: `hub/routes/legal.js`, `hub/views/license.eta`, `hub/tests/no-inline-style.test.js` (its licence fixture)
- Sync: `node shared/theme/sync-theme.mjs /var/www/suite/hub` and `.../suite/marketing`, which writes `hub/public/js/licence-*.js`
- Test: `hub/tests/legal.test.js`

**Interfaces:**
- Consumes: `LICENCE_HTML`, `LICENCE_VERSION`, `LICENCE_EFFECTIVE` from `../public/js/licence-text.js`. Import the synced copy, never `shared/theme` directly, so a deployed Hub reads its own committed asset.
- `res.render('license', { licence: { html, version, effective } })`. The `.eta` band `sub` becomes `` `Version ${it.licence.version} · Effective ${it.licence.effective}` `` and the section body becomes `<%~ it.licence.html %>`.

- [ ] **Step 1: Add the failing assertion** to `legal.test.js`. `GET /license` returns 200, its text includes `'Version 1.0 · Effective 4 June 2026'` and `'11. Governing law.'`, and it includes `href="https://sprintsuite.uk/privacy"`.
- [ ] **Step 2: Run** `cd hub && npm test`. Expected: the privacy-href assertion fails.
- [ ] **Step 3: Implement** the route and template change, update the `no-inline-style` fixture, and run the sync for `hub` and `marketing`.
- [ ] **Step 4: Run** `npm test`, then the drift check for `/var/www/suite/hub` and `/var/www/suite/marketing`. Expected: all green.
- [ ] **Step 5: Commit:** `feat(hub): render the licence from the shared theme text`. Then push and open the Suite PR.

### Task 3: Poker (scrumpoker repo)

**Files:**
- Sync: `node /var/www/suite/shared/theme/sync-theme.mjs /var/www/scrumpoker`
- Modify:
  - `public/index.html`, `public/join.html`: the footer link becomes `<a href="https://sprintsuite.uk/license" data-licence-modal>License Terms</a>`, plus `<script type="module" src="/js/licence-modal.js"></script>`.
  - `lib/httpApp.js:104`: `['/license', '/licence', '/license.html']` → `res.redirect(301, 'https://sprintsuite.uk/license')`. This must be registered before the static middleware.
  - `public/css/poker.css`: delete the `.license-wrap` block (lines 296–302).
  - `tests/return-to-suite.test.js`: drop `license.html` from the loop.
- Delete: `public/license.html`
- Test: `tests/licence-redirect.test.js`, `tests/e2e/licence-modal.spec.js`

- [ ] **Step 1: Write the failing tests.**
  - Unit: each of `/license`, `/licence` and `/license.html` returns 301 with `location === 'https://sprintsuite.uk/license'`.
  - E2E: use the seeded session and room set-up from `scrum-poker-smoke.spec.js`. Each test asserts that no `pageerror` fired. The tests:
    - `opens over the room and restores focus`: click License, then `dialog.licence-modal` is open, the `#licence-modal-title` heading is focused, and the text `'1. Grant of licence.'` is visible. `page.url()` is unchanged. Esc closes it and the License link is focused.
    - `backdrop click and Close both close it`.
    - `reopening shows the text once`: open, close, open, then `'1. Grant of licence.'` appears exactly once.
    - `a live room survives`: two users and a cast vote. One user opens and closes the licence, then the vote count and participant list are unchanged and the other user still sees that user.
    - `fits a 375×667 viewport`: the dialog bounding box is inside the viewport and Close is visible without scrolling the page.
    - `privacy link opens a new tab`: the anchor has `target="_blank"`.
- [ ] **Step 2: Run** `npm test`, then `npm run test:e2e -- licence-modal`. Expected: both fail.
- [ ] **Step 3: Implement** the file list above.
- [ ] **Step 4: Run** `npm test`, the full `npm run test:e2e`, and the drift check. Expected: all green, with the 236 or more unit tests still passing.
- [ ] **Step 5: Commit** `feat: open the licence in a popup instead of a separate page`. Then push and open the PR.

### Task 4: Retro (retrospective repo)

Same shape as Task 3.

- **Links:** the four pages `lobby`, `join`, `actions` and `retrospective`.
- **Redirect:** at `server.js:730` (`/license`). Register it before the `.html` blocker at `:767`.
- **Test registration:** add the new unit test file to the explicit `test` script in `package.json`.
- **Other changes:** drop `license.html` from `tests/return-to-suite.test.js`. Delete `public/license.html` and the licence CSS in `public/css/retro.css`.
- **E2E:** `tests/e2e/licence-modal.spec.js` reuses the `retro-smoke` set-up. Click License on the lobby, then a dialog shows the heading and `'1. Grant of licence.'`, and Esc closes it.
- **Commit:** `feat: open the licence in a popup instead of a separate page`.

### Task 5: Signal (signal repo)

Same shape as Task 3.

- **Branch:** cut `feat/licence-modal` from `origin/main`, not `feat/suite-auth`.
- **Links:** the four pages `survey`, `respond`, `admin` and `dashboard`.
- **Redirect:** at `lib/httpApp.js:122-123` (`/license`, `/licence`).
- **Other changes:** drop `license.html` from `tests/return-to-suite.test.js`. In `tests/e2e/header-waves.spec.js`, replace the `/license` page case with `/respond` (or delete the case if `/respond` needs a token). Delete `public/license.html` and its CSS in `public/css/signal.css`.
- **E2E:** `licence-modal.spec.js` uses `_auth.js` on the dashboard and makes the same three assertions as Task 4.

### Task 6: RAID (raid repo)

Same shape as Task 3.

- **Link:** `public/index.html:68`.
- **Redirect:** at `server.js:63`, `/license.html` becomes a 301. Also add `/license` and `/licence` as 301s, since the fallback href makes them reachable.
- **New e2e auth helper:** RAID has none today. Add `tests/e2e/helpers/seed.js`, modelled on Poker's `tests/e2e/helpers/seed.js`, against `/tmp/raid-e2e-sessions.db` (from `playwright.config.js`). Take the cookie name from RAID's auth-client config.
- **E2E:** replace `tests/e2e/license-band.spec.js` with `licence-modal.spec.js`. On an authenticated `/`, it asserts the band still renders (keep the existing `.waves svg` poll), then makes the same three popup assertions as Task 4.
- **Other changes:** delete `public/license.html` and its CSS in `public/css/raid.css`.
- **Commit:** `feat: open the licence in a popup instead of a separate page`.

### Task 7: Plan (plan repo)

**Files:**
- Sync: `node /var/www/suite/shared/theme/sync-theme.mjs /var/www/plan`. This writes the CSS and the two JS files. Plan has no licence link, so the files are unused, but they keep the drift check green.

- [ ] **Step 1: Run** the sync, then `npm test`, then the drift check for `/var/www/plan`. Expected: green.
- [ ] **Step 2: Commit** `chore: sync theme (licence popup assets)`. Then push and open the PR.

### Task 8: Stage review and deploy order

- [ ] **Step 1:** Run the TagTeam stage-review, topic "Code review and security audit: licence popup". Give it the five PRs, the files touched and the purpose. Answer every defect.
- [ ] **Step 2: Merge and deploy.** The Suite (Hub) goes first, so the fallback and redirect target already shows the shared text. Then Retro, Signal and RAID. Poker goes last, timed around live sessions, because a restart wipes rooms. Every app restart is handed to David one command at a time.
