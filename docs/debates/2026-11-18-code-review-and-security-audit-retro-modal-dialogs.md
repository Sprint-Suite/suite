# Debate: Code review and security audit: retro modal dialogs centred again (retrospective 98f3e61)

- Id: 2026-11-18-code-review-and-security-audit-retro-modal-dialogs
- Opened: 2026-11-18T08:41:18.560Z
- Model: gpt-6.1-sol
- Max rounds: 3

## Round 1/3 — Claude

Stage: fix retro's modal dialogs opening pinned to the top-left corner. Repo /var/www/retrospective, branch fix/dialog-centring, single commit 98f3e61 on main d9f8c53 (pushed to origin Sprint-Suite/retrospective2).

Cause: public/css/instrument-core.css has the reset `.ins *{box-sizing:border-box; margin:0;}` (since 2026-06-03). Specificity (0,1,0) beats the UA rule `dialog:modal{margin:auto}`, which is how browsers centre a modal dialog inside its fixed inset:0 box. public/css/retro.css `.ins .action-dialog{...}` never restored it. All three dialogs (note, action, instructions) carry class action-dialog.

Fix (1 line): add `margin:auto;` to `.ins .action-dialog` in public/css/retro.css.

Test: new tests/e2e/dialog-centring.spec.js signs in through the existing seed/_auth helpers, creates a board, clicks `.column-add[data-column="well"]`, and asserts the #note-dialog box is within 2px of centre on both axes at 1280x800. Watched it fail first (x off by 430px), pass after. Retro: 85 unit + 9 e2e green.

Scope: I checked the other apps — hub, signal, scrumpoker and raid have no <dialog> in markup, views or JS (no createElement('dialog')/showModal), so the bug is retro-only. No JS, server, auth or data change; no security surface. Deploy: pull + restart retrospective (static CSS, no npm change). Please check the diagnosis, whether margin:auto can break the instructions dialog (max-height + overflow:auto) or narrow viewports, and whether one dialog in the test is enough given the shared class.

## Round 1/3 — ChatGPT: AGREE

I independently inspected commit 98f3e61 on fix/dialog-centring. No blocking correctness or security findings.

public/css/instrument-core.css:45 resets descendant margins. One correction to the diagnosis: author styles override normal browser styles because of cascade origin, not selector specificity. Restoring margin:auto in public/css/retro.css:394 correctly restores native modal centring.

All three dialogs in public/retrospective.html share action-dialog and use showModal() in public/client.js. Their specialised rules do not override margins. The instructions dialog’s max-height and overflow:auto remain compatible with centring; its viewport-based width and height limits preserve space around the scrollable dialog on narrow screens.

The new test exercises the actual note-opening flow and checks both axes. One dialog adequately guards this shared-rule regression. A narrow-viewport instructions test would improve coverage but is not required for this fix.

The diff changes only CSS and test code, introducing no authentication, server or data changes. Syntax and commit whitespace checks passed. I could not independently rerun database-writing unit/e2e suites in this read-only environment. The local origin tracking ref matches 98f3e61; no project server is running.

## Outcome: AGREED

**Agreed solution, in ChatGPT's words:**

Accept 98f3e61: restore margin:auto on .ins .action-dialog and retain the note-dialog centring regression test. This fixes all three native retrospective dialogs while preserving their existing size and scrolling constraints.

