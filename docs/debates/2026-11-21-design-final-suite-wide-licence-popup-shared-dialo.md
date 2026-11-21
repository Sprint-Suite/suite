# Debate: design-final: Suite-wide licence popup (shared <dialog> modal synced via the theme) replacing per-app licence pages

- Id: 2026-11-21-design-final-suite-wide-licence-popup-shared-dialo
- Opened: 2026-11-21T17:48:25.510Z
- Model: gpt-6.1-sol
- Max rounds: 3

## Round 1/3 — Claude

The spec is at /var/www/suite/docs/superpowers/specs/2026-11-21-licence-modal-design.md. Please read it, then the files it touches.

David's request: clicking "License" in any app (Poker, Retro, Signal, RAID) should open the licence in a modal over the tool, with the background blurred and unfocusable, and a Close button that restores the page. The Hub's full /license page stays. David chose to show the Hub's Suite-wide licence (v1.0, 4 June 2026) rather than the older per-app texts, and chose approach 1: a shared modal in suite/shared/theme, synced into every surface by the existing sync-theme/manifest pipeline.

My position, and the reasons for it:
1. Each app runs on its own domain (e.g. sprintpoker.uk vs the hub at sprintsuite.uk). Every app's CSP is connect-src 'self', and the hub sends frame-ancestors 'none' / X-Frame-Options DENY. So a live fetch or iframe from the hub would need security-header changes on five surfaces. Syncing a static HTML fragment (theme/licence.html -> public/legal/licence.html) and fetching it same-origin needs no CSP change.
2. Native <dialog>.showModal() gives inert background, focus trap, Esc-to-close and a ::backdrop we can blur. Focus returns to the trigger link on close.
3. Progressive enhancement: links get data-licence-modal plus href=https://sprintsuite.uk/license, so a no-JS or failed-script click still reaches the full page.
4. The old per-app license.html files are deleted and their /license routes 301 to the hub, removing the stale second licence.
5. Hub license.eta renders the same synced fragment, so the wording exists exactly once.
6. Tests are proportional: drift/manifest tests cover the assets; one Poker Playwright test for the behaviour (Poker is where losing the page loses a live room); one route test per app for the 301.

Please challenge: correctness of the dialog/inert/focus approach, the fragment injection (it is our own static file, inserted as HTML — is that an injection concern?), CSP fit (style-src allows 'unsafe-inline'; script-src 'self'), the redirect choice, the absolute privacy link, the test scope, and anything missing.

Relevant files: /var/www/suite/shared/theme/manifest.mjs, /var/www/suite/shared/theme/README.md, /var/www/suite/hub/routes/legal.js, /var/www/suite/hub/views/license.eta, /var/www/scrumpoker/lib/httpApp.js, /var/www/scrumpoker/middleware/securityHeaders.js, /var/www/scrumpoker/public/index.html, /var/www/raid/server.js, /var/www/retrospective/server.js, /var/www/signal/lib/httpApp.js.

## Round 1/3 — ChatGPT: OBJECT

I support the shared-theme architecture, but the design needs these concrete corrections before approval.

1. The fragment needs explicit public serving routes. Signal only mounts /css, /js, /fonts and /illos (signal/lib/httpApp.js:103); RAID similarly exposes selected directories (raid/server.js:54); Retro rejects all remaining .html requests (retrospective/server.js:767). Add GET /legal/licence.html to each app, before Retro’s HTML blocker, without widening access to protected pages. Syncing the file alone will leave three apps showing the failure message.

2. The proposed tests miss those integration failures. Keep the detailed behaviour suite in Poker, but test fragment and module availability in every app and verify every intended shell includes the trigger and module. Test fetch failure, keyboard navigation, backdrop dismissal and repeated opening in Poker. Update existing tests that read deleted license.html files: tests/return-to-suite.test.js in Poker, Retro and Signal, Signal’s tests/e2e/header-waves.spec.js, and RAID’s tests/e2e/license-band.spec.js. The theme manifest test also explicitly rejects both .html and legal/ (suite/shared/theme/tests/manifest.test.mjs:8). Add a Hub rendering assertion that the canonical wording remains present.

3. Specify accessible naming and initial focus for this long document. Use aria-labelledby and initially focus a heading with tabindex=-1; avoid describing the whole document through aria-describedby. This follows the [W3C dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Native showModal() supplies modal inertness, but does not choose an appropriate reading position or provide an accessible name. Capture the invoking link explicitly for restoration. Prefer opening immediately with loading content, then populating it, so a pending fetch cannot later steal focus or reopen a dismissed dialog. Restore margin:auto explicitly: Retro commit 98f3e61 fixes precisely the centring regression caused by instrument-core.css’s .ins * margin reset. Bound height and allow scrolling on small screens.

4. Preserve existing URL aliases. Poker and Signal serve /licence as well as /license; Poker also currently serves /license.html through static middleware. Redirect all currently supported licence URLs, including RAID’s /license.html. A permanent 301 is appropriate for this retirement.

The security approach is sound: a fixed, repository-controlled fragment may be inserted as HTML without adding a sanitizer dependency, provided no user-controlled content enters it and unsuccessful responses are rejected. Same-origin fetching and external module/CSS assets require no CSP relaxation. However, Signal and the Hub use style-src 'self' without unsafe-inline, so all styling must remain in the stylesheet. The absolute Hub privacy URL is correct; opening links out of the modal in a new tab would preserve the active tool. Preserve the licence version/date too: they currently sit outside the body in hub/views/license.eta:1.

Verification was read-only: the current manifest test and drift checks across all seven surfaces pass. No files changed, commit or push made, or server started.

## Round 2/3 — Claude

I checked your points against the code. Point 1 is confirmed: Signal and RAID mount only selected directories, and Retro 404s every *.html request. I agree the design as written would fail in three apps. But I don't think new routes are the right fix. Every surface already serves /js/ (it is where oscilloscope.js lands: Signal and RAID mount /js, and Retro serves it through its final express.static). So the counter-proposal is this:

- Ship the licence body as an ES module, theme/licence-text.js → public/js/licence-text.js, exporting a constant HTML string (plus the version and date, which addresses your point that they currently sit in the eta header). licence-modal.js imports it statically. That means no fetch, no new routes, nothing near Retro's HTML blocker, no loading state, no failure state, and no risk of focus being stolen asynchronously. The manifest test's .js/js constraint holds unchanged. The Hub is "type": "module", so routes/legal.js imports the synced public/js/licence-text.js and license.eta renders it. The wording still exists once.
- Is there a cost I'm missing? The text adds roughly 4 KB to a module that loads only on pages with the link. It's loaded via an import, not on page load, if we use a dynamic import() on first click. I'd keep it static for simplicity unless you see a reason otherwise.

I concede the rest:
- aria-labelledby on the heading; the heading gets tabindex=-1 and initial focus; no aria-describedby.
- The trigger is captured explicitly and focus restored to it.
- margin:auto is restored against the .ins * reset (Retro 98f3e61); bounded max-height with an internal scroll; small-screen sizing.
- No inline styles anywhere, because Signal and the Hub have no 'unsafe-inline'.
- The privacy link opens in a new tab.
- 301 for every currently served alias: /license, /licence and /license.html where they exist today.
- The existing tests that read the deleted license.html get updated: return-to-suite in Poker, Retro and Signal; Signal header-waves; RAID license-band. Plus a Hub rendering assertion on the canonical wording.

On per-app tests, I'd rather not assert that each shell's HTML contains a script tag. That checks how the source is spelled, and it misses the real failure (asset 404, wrong path). Instead, each app's existing licence-related e2e/test gets repurposed into one behavioural check: click License → a dialog with the licence heading is open → Esc closes it. That catches exactly the class of failure you found. Poker keeps the deeper suite: keyboard, backdrop dismissal, repeated open, room survives. Fetch-failure testing goes away with the fetch. Agree?

## Round 2/3 — ChatGPT: AGREE

The module proposal resolves the routing problem cleanly. I verified that all four apps serve /js/, and suite/hub/package.json declares type: module, so the same DOM-free licence-text.js can serve browsers and be imported by hub/routes/legal.js. It also fits the existing manifest constraints.

Choose static imports. The small text module loads with licence-modal.js on page load; clicks then require no asynchronous work. If either module fails to load, initialization never intercepts the link and the ordinary Hub href remains usable. Check showModal support before intercepting clicks too. Dynamic import would reintroduce loading, rejection and focus-management concerns without a worthwhile saving here.

The revised behavioural checks are better evidence than script-tag assertions, so I withdraw that particular requirement. Each app’s check should run against its actual tool page, including authenticated RAID '/', and assert distinctive licence body text as well as the heading. Poker’s deeper coverage and the alias redirect tests remain appropriate.

The accepted accessibility, sizing, centring and CSP corrections address my other objections. Repository-controlled HTML remains an acceptable trust boundary. One operational cost: Node caches the Hub’s imported module, so publishing revised wording requires restarting the Hub. Update the license fixture in hub/tests/no-inline-style.test.js when the template starts receiving imported data.

## Outcome: AGREED

**Agreed solution, in ChatGPT's words:**

Store the canonical Suite licence HTML, version and effective date in shared/theme/licence-text.js, with no browser-specific dependencies. Sync it and licence-modal.js through the existing manifest. The browser modal statically imports the text; the Hub imports its synced copy and renders the same content server-side. Use a named native dialog with heading focus, explicit trigger restoration, bounded scrolling, centred positioning and a blurred backdrop. Keep all styling external. Preserve the Hub href as progressive fallback, open privacy in a new tab, and permanently redirect existing per-app licence URLs. Verify each app through a real modal interaction, retain deeper Poker interaction and room-preservation tests, update retired-page tests, and check Hub rendering and theme drift.

