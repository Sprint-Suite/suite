// middleware.js
const { parseCookies, clearSessionCookie } = require('./lib/cookies.js');
const { validateSession } = require('./lib/validate-session.js');

function createRequireAuth(ctx) {
  const { cookieName, cookieDomain, hubBaseUrl } = ctx;

  return async function requireAuth(req, res, next) {
    const cookieVal = parseCookies(req.headers.cookie)[cookieName];
    const { outcome, sess } = await validateSession(ctx, cookieVal);
    if (outcome === 'valid') {
      attachUser(req, sess);
      return next();
    }
    if (sess) clearSessionCookie(res, { name: cookieName, domain: cookieDomain });
    return bounceToHub(req, res);
  };

  function bounceToHub(req, res) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const returnTo = encodeURIComponent(`${proto}://${host}${req.originalUrl || req.url || '/'}`);
    res.redirect(302, `${hubBaseUrl}/login?return_to=${returnTo}`);
  }

  function attachUser(req, sess) {
    req.user = {
      id: sess.user_id,
      entitled: !!sess.entitled,
      teams: sess.teams || [],
      company: sess.company ?? null,
    };
    req.appSessionId = sess.id;
    req.centralSessionId = sess.central_session_id;
  }
}

module.exports = { createRequireAuth };
