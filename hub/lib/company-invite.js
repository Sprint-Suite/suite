// lib/company-invite.js — add someone to a company and email them a sign-in link.
import { randomToken, now } from './tokens.js';
import { createOrg } from './org.js';
import { createLimiter } from './rate-limit.js';

export function createCompanyInviter(db, { emailSender, baseUrl, inviteTtlMs }) {
  const org = createOrg(db);
  const insertToken = db.prepare(
    'INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at) VALUES (?,?,?,?,?)',
  );

  // One allowance per recipient address, shared by invite and resend, so that
  // removing and re-inviting someone cannot send them more email.
  const recipientLimiter = createLimiter({ max: 3, windowMs: 60 * 60 * 1000 });

  // A fresh token, or null when the recipient's allowance is spent.
  function mintToken(email) {
    if (!recipientLimiter.check(email)) return null;
    const token = randomToken();
    const t = now();
    insertToken.run(token, email, null, t, t + inviteTtlMs);
    return token;
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
  async function send({ to, token, companyName, inviterEmail, log }) {
    if (!emailSender) return false;
    try {
      const url = `${baseUrl}/auth/magic?token=${token}`;
      await emailSender.sendCompanyInvite({ to, url, companyName, inviterEmail });
      return true;
    } catch (err) {
      log.error({ err }, 'company invite email send failed');
      return false;
    }
  }

  return { addMember, mintToken, send };
}
