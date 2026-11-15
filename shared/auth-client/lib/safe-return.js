// lib/safe-return.js

// Same-host absolute URL -> its path and query; anything else -> "/".
// A path starting "//" or containing "\" would be read as another host.
function safeReturnPath(returnTo, host) {
  if (typeof returnTo !== 'string' || !host) return '/';
  let u;
  try {
    u = new URL(returnTo);
  } catch {
    return '/';
  }
  const path = u.pathname + u.search;
  if (u.host !== host || path.startsWith('//') || path.includes('\\')) return '/';
  return path;
}

module.exports = { safeReturnPath };
