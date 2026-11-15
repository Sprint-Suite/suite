# Auth Launch Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three shared-auth security Majors from the 2026-11-15 Signal review: open redirect after launch, login CSRF on launch, and stale company/entitlement after revocation. Every app on `@suite/auth-client` benefits.

**Architecture:** `handleLaunch` builds its redirect only from a validated same-origin path. A launch is accepted only with a `state` value matching a short-lived, HttpOnly state cookie that the app set itself. A launch without state (hub dashboard tiles, magic links) is not exchanged; the app restarts it through `${hub}/launch/<app>?state=…` from the browser's own hub session. The hub passes `state` through unchanged. The heartbeat answers with the user's current entitlement, teams and company for the calling app, and the client overwrites its stored copy on every successful heartbeat.

**Tech Stack:** Node 20; hub is ESM Express 5 + better-sqlite3 (`hub/`); auth-client is CommonJS (`shared/auth-client/`); `node --test` + supertest.

**Spec:** `/var/www/signal/docs/debates/2026-11-15-code-review-and-security-audit-signal-security-aut.md` (findings 2, 3, 6 and the agreed solution).

## Global Constraints

- Work on a branch `fix/auth-launch-hardening` off `main` in `/var/www/suite`; ship by PR.
- Hub routes, response bodies and status codes not named here stay unchanged. A new field in a JSON response is allowed; a removed or renamed one is not.
- **Deploy order:** hub first, then restart every app that loads `@suite/auth-client` (Signal, Retrospective, Scrum Poker, RAID). The client tolerates an old hub's heartbeat. An old hub drops `state`, so the client's launch flow then fails closed with the 400 below, never a loop.
- State: 32 random bytes as 64 lowercase hex chars; cookie `__Host-${cookieName}_state`, `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=120`, and **never** a `Domain` attribute, whatever `cookieDomain` is. The `__Host-` prefix stops a sibling subdomain planting it. Compared with `crypto.timingSafeEqual`. Cleared on every launch outcome.
- Every cookie write in `lib/cookies.js` **appends** a `Set-Cookie` header (`res.append`) instead of replacing one. A launch that sets the session and clears the state must emit both headers.
- Revocation bound: about `cacheTtlMs` (60 s) while the hub is reachable, up to `cacheTtlMs + graceMs` (about 6 min) while it is not. **Not covered:** WebSocket connections that are already open (Retrospective, Scrum Poker) keep their context until they reconnect. That is a recorded limitation for a follow-up, not part of this plan.
- Hub accepts `state` only if it matches `/^[a-f0-9]{64}$/`; anything else is dropped, not echoed.
- Launch failure copy, exact: `Sign-in could not be completed. Please return to the Sprint Suite dashboard and try again.` (status 400, text/plain).
- Verify with `npm test` in `hub/` and in `shared/auth-client/`, then `npm test` in `/var/www/signal` (it loads the client through its symlink). All must pass before each commit.
- Code meets `/var/www/CodingStandards/core/THRESHOLDS.md` (30-line functions, cyclomatic 10, 4 params). The standard is not wired in this repo; hold to it by hand.

## Review Focus

1. **Stale state cookie, then a dashboard-tile launch** within 120 s of an abandoned attempt: one 400, cookie cleared, the next tile click succeeds. Pinned in Task 4.
2. **Attacker token + attacker state** sent to a victim: 400 and no exchange call. Pinned in Task 4.
3. **`return_to` shapes:** `//evil/x`, `/\evil`, `https://app//evil`, `https://other-host/`, a relative path and garbage all redirect to `/`, or to the safe path. Pinned in Task 1.
4. **Member removed from their company, then the app's next heartbeat:** `req.user.company` becomes `null` and `entitled` reflects the hub. Pinned in Tasks 2 and 3.
5. **Hub unreachable during a heartbeat:** the stored context is left untouched (grace behaviour unchanged). Pinned in Task 3.

---

### Task 1: Safe post-launch redirect (auth-client)

**Files:**
- Create: `shared/auth-client/lib/safe-return.js`
- Modify: `shared/auth-client/handlers/launch.js:28-35`
- Test: `shared/auth-client/tests/safe-return.test.js`

**Interfaces:**
- Produces: `safeReturnPath(returnTo: unknown, host: string|undefined) => string`. Returns `u.pathname + u.search` when `returnTo` parses as an absolute URL whose `host === host`, the pathname starts with exactly one `/`, and it contains no `\`. Otherwise returns `"/"`.

- [ ] **Step 1: Write failing tests** `safeReturnPath`:
  - `("https://app.test/dashboard?x=1", "app.test") === "/dashboard?x=1"`
  - `"/"` for: `"https://app.test//evil.test/x"`, `"https://app.test/\\evil.test"`, `"https://evil.test/"`, `"/dashboard"` (not absolute), `"::"`, `undefined`, `42`, and `("https://app.test/a", undefined)`.
  - `handleLaunch redirects to / for a protocol-relative return_to`: build a client with a fake `hubApi.exchange` via `client._ctx.hubApi`, call `?token=t&return_to=https%3A%2F%2Fapp.test%2F%2Fevil.test%2Fx` through supertest with `Host: app.test`, and assert `location === "/"`. Task 4 changes this test so it sends a matching state.
- [ ] **Step 2:** `cd shared/auth-client && node --test tests/safe-return.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement it, and use it in `handleLaunch` in place of the inline `URL` block.
- [ ] **Step 4:** Run the auth-client `npm test` and the Signal `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**: `fix(auth-client): reject protocol-relative return_to after launch`

### Task 2: Heartbeat returns current context (hub)

**Files:**
- Modify: `hub/routes/api-sessions.js`: extract `launchContext(deps, userId, app) => { entitlement, teams, company }` from `exchangeSession`, then use it in both `exchangeSession` and `heartbeat`.
- Test: `hub/tests/api-sessions-heartbeat.test.js`

**Interfaces:**
- Produces: `POST /api/sessions/:id/heartbeat` returns `200 { ok: true, entitlement, teams, company }` for `req.callingApp`, in the same shapes the exchange returns. The 404 path is unchanged.

- [ ] **Step 1: Write failing tests**, extending the existing `setup()`:
  - `heartbeat returns the current company and entitlement`: add the user to a company with a grant for the calling app. Assert `company.id` and `entitlement.entitled === true`.
  - `heartbeat reflects removal from the company`: after `org.removeCompanyMember`, the next heartbeat returns `company === null` and `teams` deep-equal to `[]`.
  - `heartbeat reflects a revoked entitlement`: after `revokeEntitlement` for the user, the result is `entitlement.entitled === false`.
- [ ] **Step 2:** `cd hub && node --test tests/api-sessions-heartbeat.test.js`. Expected: FAIL (the body is only `{ok:true}`).
- [ ] **Step 3:** Implement it. The heartbeat reads `user_id` from `central_sessions` after the guarded `UPDATE` succeeds.
- [ ] **Step 4:** Run the hub `npm test`. Expected: PASS, including the existing exchange tests, unchanged.
- [ ] **Step 5: Commit**: `feat(hub): heartbeat returns current entitlement, teams and company`

### Task 3: Client refreshes context on heartbeat (auth-client)

**Files:**
- Create: `shared/auth-client/lib/validate-session.js`. This is the one freshness/heartbeat/grace decision, replacing the hand-synced copies in `middleware.js` and `lib/verify-session.js`.
- Modify: `shared/auth-client/lib/hub-api.js` (`heartbeat`), `middleware.js`, `lib/verify-session.js`, `handlers/heartbeat.js`, `lib/sessions-db.js` (add `refresh`)
- Test: `shared/auth-client/tests/heartbeat-refresh.test.js`

**Interfaces:**
- Consumes: the Task 2 response body.
- Produces:
  - `hubApi.heartbeat(id) => { status: "ok"|"expired"|"error"|"unreachable", context: {entitled, teams, company} | null }`. `context` is non-null only on `ok` when the body carries `entitlement`; `entitled` is `entitlement?.entitled === true`.
  - `store.refresh(id, { entitled, teams, company })` updates those three columns and `last_validated_at`.
  - `validateSession(ctx, cookieVal) => { outcome: "valid"|"invalid", sess }`. It applies today's cache, heartbeat and grace rules. On a heartbeat `ok` it calls `store.refresh` when `context` is non-null and `store.touch` otherwise, and the returned `sess` carries the refreshed values. It deletes the stored session on `expired`, and on an outage once grace has run out.
  - `requireAuth` and `verifySession` both delegate to `validateSession`. `requireAuth` keeps its redirect and cookie-clearing behaviour, and `verifySession` keeps returning a context or `null`. `handleHeartbeat` (which always heartbeats) applies the same `refresh`/`touch` rule.

- [ ] **Step 1: Write failing tests**. Use a store on `:memory:` and a fake `hubApi` injected through `client._ctx`, with the session's `last_validated_at` older than `cacheTtlMs`:
  - `requireAuth applies a revoked company on heartbeat`: the stored company is `{id:"c1"}`, and the fake returns `{status:"ok", context:{entitled:false, teams:[], company:null}}`. Afterwards `req.user.company === null`, `req.user.entitled === false`, and the stored row matches.
  - `an old hub's bare ok keeps the stored context`: the fake returns `{status:"ok", context:null}`. The context is unchanged and `last_validated_at` has advanced.
  - `unreachable hub leaves context untouched within grace`.
  - `handleHeartbeat refreshes context too`: the same assertion via `POST` to the handler.
  - `verifySession applies a revoked company`: returns `company: null`, `entitled: false`.
  - `verifySession returns null on expired`. The fake returns `{status:"expired", context:null}`; it returns `null` and the stored row is gone.
  - `verifySession keeps context during an outage within grace, and returns null after grace`.
  - `hubApi.heartbeat maps a 200 body with entitlement to context`: a `fetchImpl` stub returns `200 {ok:true, entitlement:{entitled:true}, teams:[], company:{id:"c1",name:"C"}}`.
- [ ] **Step 2:** `node --test tests/heartbeat-refresh.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run the auth-client `npm test` and the Signal `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**: `fix(auth-client): refresh company and entitlement on every heartbeat`

### Task 4: Browser-bound launch state (hub pass-through + auth-client)

**Files:**
- Modify: `hub/routes/launch.js`. Append `&state=<state>` to the redirect when `req.query.state ?? req.body?.state` matches the Global Constraints pattern.
- Create: `shared/auth-client/lib/launch-state.js`
- Modify: `shared/auth-client/handlers/launch.js`, `shared/auth-client/lib/cookies.js` (generic `setCookie`/`clearCookie` with a `path` option, or two state-cookie helpers)
- Test: `hub/tests/launch.test.js`, `shared/auth-client/tests/launch-state.test.js`

**Interfaces:**
- Produces (`lib/launch-state.js`):
  - `newState() => string` (64 hex).
  - `statesMatch(a: unknown, b: unknown) => boolean`. It returns false unless both are 64-hex strings, then compares with `timingSafeEqual`.
- `handleLaunch` decision, in this order and before any `exchange` call:
  1. `state` query present: clear the state cookie. If it doesn't match the cookie, send 400 with the exact copy. Otherwise continue to exchange as today, then redirect via `safeReturnPath`.
  2. `state` absent and a state cookie present: clear it and send 400 with the exact copy.
  3. `state` absent and no cookie: set a new state cookie and 302 to `${hubBaseUrl}/launch/${appName}?state=<s>`, adding `&return_to=<encoded original return_to>` when one was given. Do not exchange the token.

- [ ] **Step 1: Write failing tests.**
  - Hub (`launch.test.js`):
    - `launch passes a valid state through`: `GET /launch/signal?state=<64hex>` redirects to a `location` that contains `&state=<same>`.
    - `launch drops a malformed state`: `state=../x` gives a `location` without `state=`.
    - `POST launch passes state from the body`.
  - Client (`launch-state.test.js`), with a counting fake `exchange`:
    - `stateless launch restarts via the hub without exchanging`: 302 to `https://hub/launch/<app>?state=` plus 64 hex chars, and an exchange count of 0. It emits a `Set-Cookie` that starts `__Host-<cookieName>_state=` with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` and `Max-Age=120`, and with **no** `Domain`, even when the client was built with `cookieDomain: "example.test"`.
    - `restart preserves return_to`.
    - `matching state exchanges and clears the cookie`: 302 to the safe path and an exchange count of 1. There are **two** `Set-Cookie` headers: the session cookie, and the deletion of `__Host-<cookieName>_state` with `Max-Age=0`, `Secure` and `Path=/`, and no `Domain`. Browsers ignore a `__Host-` deletion that lacks `Secure`, and today's `clearSessionCookie` omits it. Every 400 path asserts the same deletion attributes.
    - `attacker token with mismatched state is rejected without exchange`: 400 with the exact copy and an exchange count of 0.
    - `stateless launch with a stale state cookie fails once`: 400 and the cookie cleared. A second stateless request with no cookie restarts (302).
    - `state param without any cookie is rejected`: 400.
- [ ] **Step 2:** Run both new test files. Expected: FAIL.
- [ ] **Step 3:** Implement the hub pass-through, then the client.
- [ ] **Step 4:** Run the hub `npm test`, the auth-client `npm test`, and the Signal `npm test`. Expected: PASS. In Signal, update any test that drives `/auth/launch` directly so it sends a matching state cookie and parameter.
- [ ] **Step 5: Commit**: `fix(auth): bind app launches to a browser-held state`

## Post-deploy smoke check (manual, real browsers, after the hub then the apps are deployed)

Record each result (pass/fail, date, browser) in the PR before the rollout counts as verified. Scope: HTTP requests and new WebSocket connections. Revoking access on WebSockets that are already open is a separate follow-up.

Run each check against Signal and against one WebSocket app (Retrospective):

1. Hub dashboard tile → the app opens signed in (one extra redirect hop).
2. Sign out, request a magic link, open it in a **different** browser → the app opens signed in there.
3. In browser A, start a launch from the tile and, with DevTools set to preserve the log, copy both `/auth/launch` URLs:
   - **3a.** Copy the second one, which carries `state=`, into browser B. B shows the 400 copy.
   - **3b.** Copy the first one, which has no `state`, into browser B. B restarts through its own hub session (sign-in, or B's own account). B must **never** end up signed in as A.
4. A stale tab: abandon a launch, then within 2 minutes click a tile → one 400, then the next tile click works.
5. In the hub console, remove a test member from a company. Within about 60 s the member's next app request has no company (Signal: "No company is associated with your session").
