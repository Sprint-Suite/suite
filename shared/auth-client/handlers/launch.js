// handlers/launch.js
const {
  parseCookies,
  setSessionCookie,
  stateCookieName,
  setStateCookie,
  clearStateCookie,
} = require('../lib/cookies.js');
const { safeReturnPath } = require('../lib/safe-return.js');
const { newState, statesMatch } = require('../lib/launch-state.js');
const { randomBytes } = require('node:crypto');

const LAUNCH_FAILED =
  'Sign-in could not be completed. Please return to the Sprint Suite dashboard and try again.';

function rejectLaunch(res) {
  res.status(400).type('text/plain').send(LAUNCH_FAILED);
}

function restartViaHub(ctx, req, res) {
  const state = newState();
  setStateCookie(res, { cookieName: ctx.cookieName, value: state });
  const returnTo = req.query.return_to;
  const suffix = typeof returnTo === 'string' ? `&return_to=${encodeURIComponent(returnTo)}` : '';
  res.redirect(302, `${ctx.hubBaseUrl}/launch/${ctx.appName}?state=${state}${suffix}`);
}

// Returns true when the request carries a state matching this browser's cookie.
// Otherwise it has already answered: a 400, or a restart through the hub.
function checkLaunchState(ctx, req, res) {
  const cookieState = parseCookies(req.headers.cookie)[stateCookieName(ctx.cookieName)];
  const queryState = req.query.state;
  if (queryState === undefined && cookieState === undefined) {
    restartViaHub(ctx, req, res);
    return false;
  }
  clearStateCookie(res, { cookieName: ctx.cookieName });
  if (queryState !== undefined && statesMatch(queryState, cookieState)) return true;
  rejectLaunch(res);
  return false;
}

function createSession(ctx, res, info) {
  const sessionId = randomBytes(32).toString('hex');
  ctx.store.create({
    id: sessionId,
    userId: info.user.id,
    centralSessionId: info.central_session_id,
    expiresAt: Date.now() + ctx.sessionMaxMs,
    entitled: info.entitlement?.entitled === true,
    teams: info.teams || [],
    company: info.company || null,
  });
  setSessionCookie(res, { name: ctx.cookieName, value: sessionId, domain: ctx.cookieDomain });
}

function createLaunchHandler(ctx) {
  return async function handleLaunch(req, res) {
    const token = req.query?.token;
    if (!token || typeof token !== 'string') {
      clearStateCookie(res, { cookieName: ctx.cookieName });
      return res.status(400).send('Missing launch token');
    }
    if (!checkLaunchState(ctx, req, res)) return;
    let info;
    try {
      info = await ctx.hubApi.exchange(token);
    } catch {
      return res.status(400).send('Sign-in link expired or invalid. Please try again.');
    }
    createSession(ctx, res, info);
    res.redirect(302, safeReturnPath(req.query.return_to, req.headers.host));
  };
}

module.exports = { createLaunchHandler };
