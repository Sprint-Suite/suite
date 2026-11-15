// handlers/heartbeat.js
const { parseCookies, clearSessionCookie } = require('../lib/cookies.js');
const { applyHeartbeatOk } = require('../lib/validate-session.js');

function createHeartbeatHandler(ctx) {
  return async function handleHeartbeat(req, res) {
    const cookieVal = parseCookies(req.headers.cookie)[ctx.cookieName];
    if (!cookieVal) return res.status(401).json({ error: 'no_session' });
    const sess = ctx.store.get(cookieVal);
    if (!sess) return res.status(401).json({ error: 'no_session' });
    const stamp = ctx.store.beginValidation();
    const { status, context } = await ctx.hubApi.heartbeat(sess.central_session_id);
    if (status === 'ok' && applyHeartbeatOk(ctx.store, sess, context, stamp)) {
      return res.status(200).json({ ok: true });
    }
    if (status === 'ok' || status === 'expired') {
      ctx.store.delete(cookieVal);
      clearSessionCookie(res, { name: ctx.cookieName, domain: ctx.cookieDomain });
      return res.status(401).json({ error: 'expired' });
    }
    return res.status(503).json({ error: 'hub_unreachable' });
  };
}

module.exports = { createHeartbeatHandler };
