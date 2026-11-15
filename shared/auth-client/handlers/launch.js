// handlers/launch.js
const { setSessionCookie } = require('../lib/cookies.js');
const { safeReturnPath } = require('../lib/safe-return.js');
const { randomBytes } = require('node:crypto');

function createLaunchHandler(ctx) {
  return async function handleLaunch(req, res) {
    const token = req.query?.token;
    if (!token || typeof token !== 'string') {
      return res.status(400).send('Missing launch token');
    }
    let info;
    try {
      info = await ctx.hubApi.exchange(token);
    } catch {
      return res.status(400).send('Sign-in link expired or invalid. Please try again.');
    }
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
    const dest = safeReturnPath(req.query.return_to, req.headers.host);
    res.redirect(302, dest);
  };
}

module.exports = { createLaunchHandler };
