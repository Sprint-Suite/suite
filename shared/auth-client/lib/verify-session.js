// lib/verify-session.js — connection-layer session check (e.g. WebSocket upgrade).
// Returns { userId, entitled, teams, company } or null.
const { parseCookies } = require('./cookies.js');
const { validateSession } = require('./validate-session.js');

function context(sess) {
  return {
    userId: sess.user_id,
    entitled: !!sess.entitled,
    teams: sess.teams || [],
    company: sess.company ?? null,
  };
}

function createVerifySession(ctx) {
  // On a null result the caller is responsible for clearing the session cookie (this has no res).
  return async function verifySession(cookieHeader) {
    const cookieVal = parseCookies(cookieHeader)[ctx.cookieName];
    const { outcome, sess } = await validateSession(ctx, cookieVal);
    return outcome === 'valid' ? context(sess) : null;
  };
}

module.exports = { createVerifySession };
