// lib/cookies.js
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Appends so a response can carry several cookie writes (e.g. session set + state cleared).
function appendCookie(res, { name, value, maxAgeSec, domain, secure }) {
  const attrs = [`${name}=${value}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (domain) attrs.push(`Domain=${domain}`);
  if (secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function setSessionCookie(
  res,
  { name, value, domain, secure = true, maxAgeSec = 60 * 60 * 24 * 30 },
) {
  appendCookie(res, { name, value, maxAgeSec, domain, secure });
}

function clearSessionCookie(res, { name, domain }) {
  appendCookie(res, { name, value: '', maxAgeSec: 0, domain, secure: false });
}

// __Host- cookies must be Secure, Path=/ and carry no Domain, or browsers reject the write.
function stateCookieName(cookieName) {
  return `__Host-${cookieName}_state`;
}

function setStateCookie(res, { cookieName, value }) {
  appendCookie(res, { name: stateCookieName(cookieName), value, maxAgeSec: 120, secure: true });
}

function clearStateCookie(res, { cookieName }) {
  appendCookie(res, { name: stateCookieName(cookieName), value: '', maxAgeSec: 0, secure: true });
}

module.exports = {
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  stateCookieName,
  setStateCookie,
  clearStateCookie,
};
