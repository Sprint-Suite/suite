// lib/validate-session.js — the one cache / heartbeat / grace decision for a stored session.
// Returns { outcome: 'valid'|'invalid', sess }. On 'invalid', sess is the session that was
// deleted, or null when there was none to begin with.

function applyHeartbeatOk(store, cookieVal, sess, context) {
  if (!context) {
    store.touch(cookieVal);
    return sess;
  }
  store.refresh(cookieVal, context);
  return { ...sess, ...context };
}

async function validateSession(ctx, cookieVal) {
  const sess = cookieVal ? ctx.store.get(cookieVal) : undefined;
  if (!sess) return { outcome: 'invalid', sess: null };

  const age = Date.now() - sess.last_validated_at;
  if (age < ctx.cacheTtlMs) return { outcome: 'valid', sess };

  const { status, context } = await ctx.hubApi.heartbeat(sess.central_session_id);
  if (status === 'ok') {
    return { outcome: 'valid', sess: applyHeartbeatOk(ctx.store, cookieVal, sess, context) };
  }
  if (status !== 'expired' && age < ctx.cacheTtlMs + ctx.graceMs) return { outcome: 'valid', sess };
  ctx.store.delete(cookieVal);
  return { outcome: 'invalid', sess };
}

module.exports = { validateSession, applyHeartbeatOk };
