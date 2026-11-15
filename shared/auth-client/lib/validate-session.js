// lib/validate-session.js — the one cache / heartbeat / grace decision for a stored session.
// Returns { outcome: 'valid'|'invalid', sess }. On 'invalid', sess is the session that was
// deleted, or null when there was none to begin with.

// A response older than the last applied validation is dropped in favour of the stored row,
// which is undefined if a newer validation deleted the session.
function applyHeartbeatOk(store, sess, context, stamp) {
  if (store.refresh(sess.id, context, stamp)) return { ...sess, ...context };
  return store.get(sess.id);
}

// Grace is judged on the row as it stands once the heartbeat returns, so a newer validation's
// revocation or deletion wins over this one's stale snapshot.
function applyHeartbeatFailure(ctx, cookieVal, status) {
  const current = ctx.store.get(cookieVal);
  if (!current) return { outcome: 'invalid', sess: null };
  const age = Date.now() - current.last_validated_at;
  if (status !== 'expired' && age < ctx.cacheTtlMs + ctx.graceMs)
    return { outcome: 'valid', sess: current };
  ctx.store.delete(cookieVal);
  return { outcome: 'invalid', sess: current };
}

async function validateSession(ctx, cookieVal) {
  const sess = cookieVal ? ctx.store.get(cookieVal) : undefined;
  if (!sess) return { outcome: 'invalid', sess: null };
  if (Date.now() - sess.last_validated_at < ctx.cacheTtlMs) return { outcome: 'valid', sess };

  const stamp = ctx.store.beginValidation();
  const { status, context } = await ctx.hubApi.heartbeat(sess.central_session_id);
  if (status !== 'ok') return applyHeartbeatFailure(ctx, cookieVal, status);
  const current = applyHeartbeatOk(ctx.store, sess, context, stamp);
  return current ? { outcome: 'valid', sess: current } : { outcome: 'invalid', sess };
}

module.exports = { validateSession, applyHeartbeatOk };
