// routes/company-invite.js — invite a member, and resend their sign-in link.
// Outcomes come back as ?notice=<key>; routes/company.js renders the fixed text.
import { createCompanyInviter } from '../lib/company-invite.js';
import { createAuditLogger } from '../lib/audit.js';
import logger from '../lib/logger.js';
import { validate } from '../lib/validate.js';
import { inviteMemberSchema } from '../schemas/company.js';

function inviteInvalid(req, res, error) {
  const fields = error.flatten().fieldErrors;
  const message = fields.email ? 'Invalid email.' : 'Invalid role.';
  return res.status(400).render('error', { title: 'Bad request', message });
}

export function mountCompanyInvite(app, { manage, emailSender }) {
  const db = app.locals.db;
  const config = app.locals.config;
  const audit = createAuditLogger(db);
  const inviter = createCompanyInviter(db, {
    emailSender,
    baseUrl: config.baseUrl,
    inviteTtlMs: config.inviteTtlMs,
  });
  const back = (req, res, notice) => res.redirect(`/company/${req.company.slug}?notice=${notice}`);

  const sendTo = (req, email, token) =>
    inviter.send({
      to: email,
      token,
      companyName: req.company.name,
      inviterEmail: req.user.email,
      log: req.log || logger,
    });

  app.post(
    '/company/:slug/members',
    ...manage,
    validate(inviteMemberSchema, { onInvalid: inviteInvalid }),
    async (req, res) => {
      const { email, role } = req.body;
      const r = inviter.addMember({ email, companyId: req.company.id, role });
      if (r.alreadyMember) return back(req, res, 'already_member');
      audit.log({
        userId: req.user.id,
        eventType: 'company_member_invited',
        metadata: { company: req.company.slug, email, role },
        ip: req.ip,
      });
      if (r.throttled) return back(req, res, 'invite_email_throttled');
      if (!r.token) return back(req, res, 'account_disabled');
      const sent = await sendTo(req, r.user.email, r.token);
      back(req, res, sent ? 'invited' : 'invite_email_failed');
    },
  );

  app.post('/company/:slug/members/:userId/resend', ...manage, async (req, res) => {
    const target = db
      .prepare(
        `SELECT u.id, u.email, u.disabled_at FROM company_members cm
         JOIN users u ON u.id = cm.user_id WHERE cm.user_id=? AND cm.company_id=?`,
      )
      .get(req.params.userId, req.company.id);
    if (!target) {
      return res
        .status(404)
        .render('error', { title: 'Not found', message: 'Not a member of this company.' });
    }
    if (target.disabled_at) return back(req, res, 'account_disabled');
    const token = inviter.mintToken(target.email);
    if (!token) return back(req, res, 'resend_throttled');
    audit.log({
      userId: req.user.id,
      eventType: 'company_invite_resent',
      metadata: { company: req.company.slug, target: target.id },
      ip: req.ip,
    });
    const sent = await sendTo(req, target.email, token);
    back(req, res, sent ? 'resent' : 'invite_email_failed');
  });
}
