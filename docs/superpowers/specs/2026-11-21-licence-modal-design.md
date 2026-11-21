# Licence popup — design

Date: 2026-11-21. Status: agreed with ChatGPT (design-final, round 2); awaiting
David's approval.

## Intent

Clicking "License" inside an app today navigates away to a separate page, with no
way back but the browser's Back button. In Poker that can mean leaving a live
room. Instead, the licence opens in a popup over the tool: the app behind it
blurs and cannot be used, the popup takes focus, and a Close button returns the
app exactly as it was. Every app behaves the same way. The full-page licence
stays on the Hub, linked from the Suite front page.

## Goals

- One popup, shared by Poker, Retro, Signal and RAID, opened from each app's
  existing "License" link.
- It shows the **Hub's Suite-wide licence** (v1.0, 4 June 2026) — David's choice.
- One copy of the licence wording across the Suite, Hub page included.

## Non-goals

- Privacy note, Terms, or any other popup.
- Sprintplan and the marketing site: neither has a licence link today.
- Changing the licence wording.

## Anti-goals

- Anything that loses a Poker or Retro room's state when the licence is read.
- Loosening any app's Content-Security-Policy, or adding routes to serve it.

## Approaches

1. **Shared popup in `suite/shared/theme`, licence text synced into every
   surface** — chosen by David. Same pipeline as the CSS and fonts. Cost: a
   licence edit means re-sync, then redeploy every surface and restart the Hub.
2. **Fetch the text live from the Hub** — rejected: needs CSP and CORS changes on
   five surfaces, and the popup breaks whenever the Hub is down.
3. **A popup written separately in each app** — rejected: four copies that
   drift, the same problem as the two licences that exist today.

## Design

- **Two new theme assets**, both added to `manifest.mjs` with `destDir: 'js'`.
  `/js/` is already served by every app, so no routes change.
  - `licence-text.js`: an ES module with no DOM dependencies, exporting the
    licence body HTML, its version, and its effective date. The body moves out of
    `hub/views/license.eta`. Its privacy link becomes absolute
    (`https://sprintsuite.uk/privacy`) and opens in a new tab.
  - `licence-modal.js`: statically imports `licence-text.js`. If
    `HTMLDialogElement.prototype.showModal` exists, it hooks every
    `a[data-licence-modal]`. On click it prevents navigation and opens a native
    `<dialog>` with `showModal()`.
- **Popup behaviour:**
  - The page behind becomes inert, Esc closes, and `::backdrop` blurs and dims.
  - Named with `aria-labelledby` on its heading. The heading has `tabindex="-1"`
    and gets focus on open; there is no `aria-describedby`.
  - It closes on the Close button, on Esc, or on a backdrop click. On close,
    focus returns to the explicitly captured trigger link.
  - It is centred (`margin:auto` restored against the `.ins *` reset; see Retro
    `98f3e61`) and height-bounded with an internal scroll, so it works on small
    screens.
  - All styles are in `instrument-core.css`, none inline: Signal and the Hub
    have no `'unsafe-inline'` in `style-src`.
- **Fallback:** each License link gets `data-licence-modal` and
  `href="https://sprintsuite.uk/license"`. If either module fails to load, or the
  browser has no `showModal`, the link works as a normal link.
- **Pages:** Poker `index`/`join`, Retro's four, Signal's four, RAID `index`.
  Each one loads `/js/licence-modal.js` as a module.
- **Old per-app licences retired:** delete each app's `license.html`. Every URL
  currently served for it gets a 301 to the Hub's page: `/license` everywhere,
  `/licence` on Poker and Signal, and `/license.html` on Poker and RAID.
- **Hub:** `routes/legal.js` imports the synced `public/js/licence-text.js` and
  passes it to `license.eta`. The full page is otherwise unchanged. Node caches
  the import, so a wording change needs a Hub restart.

## Tests

- **Theme:** the manifest and drift tests cover the new assets.
- **Every app:** repurpose its existing licence test so it checks behaviour on a
  real tool page (RAID authenticated `/`). Click License, then expect an open
  dialog showing the licence heading and a distinctive line of the body text.
  Esc then closes it. The tests being repurposed are `return-to-suite` in Poker,
  Retro and Signal, Signal's `header-waves`, and RAID's `license-band`.
- **Poker (deeper):** keyboard focus on open and restore on close, backdrop
  dismissal, repeated open, and a live room surviving an open-and-close cycle.
- **Redirects:** a route test for each alias's 301.
- **Hub:** `/license` still renders the canonical wording. Update the licence
  fixture in `hub/tests/no-inline-style.test.js`.

## Left to the builder

- The exact blur, dim and popup size, within the Instrument tokens.
- Deploy order. A Poker restart wipes live rooms, so time it around sessions.

## Calls I made (David to check)

- The popup also closes on a backdrop click, not only Close and Esc.
- The old per-app licence pages are deleted and redirected, not kept.
- Each app's link points at the Hub's page as the no-script fallback.
