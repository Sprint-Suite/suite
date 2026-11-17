// lib/company-invite.js — add someone to a company and email them a sign-in link.
import { randomToken, now } from './tokens.js';
import { createOrg } from './org.js';

export function createCompanyInviter(db, { emailSender, baseUrl, inviteTtlMs }) {
  const org = createOrg(db);
  const insertToken = db.prepare(
    'INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at) VALUES (?,?,?,?,?)',
  );

  function mintToken(email) {
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
    const token = r.alreadyMember || r.user.disabled_at ? null : mintToken(r.user.email);
    return { ...r, token };
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
