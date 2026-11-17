// lib/magic-tokens.js — issue a single-use sign-in token for /auth/magic.
import { randomToken, now } from './tokens.js';

export function mintMagicToken(db, { email, ttlMs, returnTo = null }) {
  const token = randomToken();
  const t = now();
  db.prepare(
    'INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(token, email, returnTo, t, t + ttlMs);
  return token;
}
