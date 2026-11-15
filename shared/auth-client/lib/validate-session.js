// lib/validate-session.js — the one cache / heartbeat / grace decision for a stored session.
// Returns { outcome: 'valid'|'invalid', sess }. On 'invalid', sess is the session that was
// deleted, or null when there was none to begin with.

// A response older than the last applied validation is dropped in favour of the stored row,
// which is undefined if a newer validation deleted the session.
function applyHeartbeatOk(store, sess, context, startedAt) {
  if (store.refresh(sess.id, context, startedAt)) return { ...sess, ...context };
  return store.get(sess.id);
}

async function validateSession(ctx, cookieVal) {
  const sess = cookieVal ? ctx.store.get(cookieVal) : undefined;
  if (!sess) return { outcome: 'invalid', sess: null };

  const age = Date.now() - sess.last_validated_at;
  if (age < ctx.cacheTtlMs) return { outcome: 'valid', sess };

  const startedAt = Date.now();
  const { status, context } = await ctx.hubApi.heartbeat(sess.central_session_id);
  if (status === 'ok') {
    const current = applyHeartbeatOk(ctx.store, sess, context, startedAt);
    return current ? { outcome: 'valid', sess: current } : { outcome: 'invalid', sess };
  }
  if (status !== 'expired' && age < ctx.cacheTtlMs + ctx.graceMs) return { outcome: 'valid', sess };
  ctx.store.delete(cookieVal);
  return { outcome: 'invalid', sess };
}

module.exports = { validateSession, applyHeartbeatOk };
