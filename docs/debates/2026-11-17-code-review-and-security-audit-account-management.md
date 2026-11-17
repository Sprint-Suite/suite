# Debate: Code review and security audit: account-management part 2 (company console invite email, resend, explicit actions)

- Id: 2026-11-17-code-review-and-security-audit-account-management
- Opened: 2026-11-17T17:19:22.773Z
- Model: gpt-6.1-sol
- Max rounds: 3

## Round 1/3 — Claude

Stage: commit c764e88 on branch feat/company-console-ux (range 3a565b9..c764e88). Purpose: implement the agreed part 2 of the company console (docs/debates/2026-11-17-account-management-review-part-2-3-company-console.md).

What changed:
- hub/lib/company-invite.js (new): addMember() is a db.transaction wrapping org.inviteCompanyMember plus a 7-day magic_link_tokens insert (config.inviteTtlMs). No token for an existing member (role kept) or a disabled account. send() posts the email only AFTER the transaction returns, catches every failure (thrown or returned provider error, which lib/email.js deliver() already converts to a fixed 'email send failed'), logs it, and returns false. A missing emailSender also returns false.
- hub/routes/company-invite.js (new): POST /company/:slug/members (moved from company.js) and POST /company/:slug/members/:userId/resend. Both use the same owner-only `manage` middleware chain (requireSession + requireCompanyRole(['owner'])). Resend checks the target is a member of req.company (404 otherwise, cross-tenant), refuses disabled accounts, and is rate-limited to 3 per hour keyed on target user id (in-memory limiter, per process). Outcomes redirect to /company/:slug?notice=<key>.
- hub/routes/company.js: GET renders a notice ONLY from a fixed NOTICES map, looked up with Object.hasOwn on a string query, so the query value is never rendered. Each member gets teams from org.teamsForUser scoped to the company. mountCompany now takes { emailSender }. Dead companyRole branches removed.
- hub/app.js passes emailSender to mountCompany. tests/app.test.js proves the wiring through the real createApp (and it fails if the argument is dropped).
- hub/views/company/console.eta: role text with a "Make owner" (data-confirm explaining owners get every app) or "Make member" button; "Signal: on/off" with an "Enable/Disable Signal" button; a Teams column; "Signed in"/"Never signed in" plus a "Resend link" button on never-signed-in rows.
- hub/views/emails/company-invite.eta + sendCompanyInvite in lib/email.js: names the company and the inviter. Eta's <%= escapes the company name (tested).

Tests: hub/tests/company-invite.test.js (15) cover send-after-commit, token TTL and URL, already-member no-op, failed send, no sender, disabled account, resend success/throttle/failure/disabled/cross-company 404/member 403, notice allow-list including __proto__ and markup, and the row rendering. The full hub suite is 471/471.

Things I judged acceptable, so please challenge them: (1) the resend limiter is in-memory, so a restart resets it, matching login.js. (2) The initial invite is not rate-limited beyond owner-only. An owner can invite many addresses, each getting one email, and that is the same exposure as before plus the email. (3) The audit event for an invite is logged before the send result is known. (4) An invite to an existing user who is a member of another company still sends them a link, which only signs them in.

Please check correctness, auth and access control, input handling, injection, secrets in logs, and error paths. Start with the files listed.

## Round 1/3 — ChatGPT: OBJECT

I inspected c764e88 independently. One security issue needs fixing: the recipient throttle can be bypassed without restarting the process.

hub/routes/company-invite.js:70 checks resendLimiter only for /resend. The initial-invite handler at lines 43–52 sends without consulting it. An owner can exhaust the resend allowance, remove the target through company.js, then repeatedly reinvite and remove that same address. Each reinvite creates another token and sends another email. Using the actual route handlers and an in-memory database, I reproduced 4 emails before throttling, followed by 6 additional emails and tokens through remove/reinvite cycles. Therefore assumption (2)—each address gets one initial email—is false. Owner authorization does not prevent a malicious or compromised owner from flooding a recipient through the Suite sender.

Apply a shared recipient limit to initial invitations and resends before minting tokens and sending. Preserve membership creation and duplicate-invite no-op behavior, and report when membership succeeds but emailing is throttled. Add a regression that exhausts resends, removes/reinvites the target, and verifies no additional token or email is produced.

The other reviewed protections look sound: owner authorization, company-scoped resend lookup, parameterized SQL, notice allow-listing, template escaping, disabled-account checks, and provider-error sanitization. I verified email runs outside the membership transaction. Audit-before-send is acceptable as a membership invitation event, without implying delivery; existing-user links confer no additional identity privilege.

Syntax checks, diff checks, and focused email/org/limiter tests passed. I could not independently confirm 471/471: HTTP tests encounter sandbox listen EPERM failures. No files were changed.

## Round 2/3 — Claude

Conceded. Your remove/re-invite cycle defeats the limit, and my assumption (2) was false. Fixed in 7a0cd4e (on top of c764e88):

- The limiter moved into lib/company-invite.js as ONE per-recipient allowance (3/hour, keyed on the lowercased email address) inside createCompanyInviter. mintToken(email) checks it first and returns null when it is spent, so no token row is written and no email goes. Both the invite path (addMember, inside the transaction, after the membership insert) and the resend path go through mintToken. There is no longer a separate resend limiter in the route.
- Invite still creates the membership when throttled, and redirects with ?notice=invite_email_throttled ("The member is added, but too many links went to that address in the last hour, so none was sent."). The already-member no-op and the disabled-account path return before mintToken, so they consume no allowance.
- Regression test in hub/tests/company-invite.test.js: "remove and re-invite cannot get past the per-recipient limit". It exhausts 3 resends, removes the member, re-invites, and asserts the membership exists, the notice is invite_email_throttled, and there are still exactly 3 emails and 3 tokens. It failed before the fix and passes after. Full hub suite: 472/472.

Residual, stated plainly: the limiter is in-memory and per process, so a restart resets it (same as login.js). Because one inviter is built per mount, the allowance is shared across all companies in the process, which is the right scope for "per recipient". Agreed?

## Round 2/3 — ChatGPT: AGREE

The checkout contains this fix as 24e37fd; 7a0cd4e is unavailable locally. I inspected the actual changes and exercised the route handlers: initial invite plus resends exhausted one shared allowance; six remove/reinvite cycles and an invitation into another company produced no additional emails or tokens, while preserving memberships. Duplicate-member and disabled-account paths bypass token minting as intended. Current routes supply normalized stored email addresses. Syntax checks, diff checks, and focused email/org/limiter tests passed. HTTP-suite verification remains blocked by sandbox listen restrictions. The explicitly acknowledged per-process, restart-reset limitation is acceptable for this scope.

## Outcome: AGREED

**Agreed solution, in ChatGPT's words:**

Use one recipient allowance shared across company invitations and resends, checked before token creation. Permit three token issuances per hour across companies, preserve membership when throttled, show accurate feedback, and retain duplicate-invite and disabled-account behavior. Keep the remove/reinvite regression test.

