// lib/company-invite.js — add someone to a company and email them a sign-in link.
import { createOrg } from './org.js';
import { createLimiter } from './rate-limit.js';
import { mintMagicToken } from './magic-tokens.js';
import { trySend } from './email.js';

export function createCompanyInviter(db, { emailSender, baseUrl, inviteTtlMs }) {
  const org = createOrg(db);

  // One allowance per recipient address, shared by invite and resend, so that
  // removing and re-inviting someone cannot send them more email.
  const recipientLimiter = createLimiter({ max: 3, windowMs: 60 * 60 * 1000 });

  // A fresh token, or null when the recipient's allowance is spent.
  function mintToken(email) {
    if (!recipientLimiter.check(email)) return null;
    return mintMagicToken(db, { email, ttlMs: inviteTtlMs });
  }

  // Membership and token commit together; the email goes after, so a failed send
  // never rolls back the membership. No token for an existing member (role kept,
  // nothing sent) or a disabled account (/auth/magic would refuse it anyway).
  const addMember = db.transaction(({ email, companyId, role }) => {
    const r = org.inviteCompanyMember({ email, companyId, role });
    if (r.alreadyMember || r.user.disabled_at) return { ...r, token: null };
    const token = mintToken(r.user.email);
    return { ...r, token, throttled: !token };
  });

  // Resolves true when the provider accepted the email. Never throws.
  function send({ to, token, companyName, inviterEmail, log }) {
    const url = `${baseUrl}/auth/magic?token=${token}`;
    const fn =
      emailSender && (() => emailSender.sendCompanyInvite({ to, url, companyName, inviterEmail }));
    return trySend(log, 'company invite', fn);
  }

  return { addMember, mintToken, send };
}
