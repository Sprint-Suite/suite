// routes/admin-companies.js — access requests, approval, and the read-only
// company view for site admins. Company management stays membership-based in
// routes/company.js: nothing here mutates a company after it is provisioned.
import { createAuditLogger } from '../lib/audit.js';
import { createOrg } from '../lib/org.js';
import { createEntitlements } from '../lib/entitlements.js';
import { createAccessRequests } from '../lib/access-requests.js';
import { createProvisioner } from '../lib/provisioning.js';
import { mintMagicToken } from '../lib/magic-tokens.js';
import { trySend } from '../lib/email.js';
import { pickNotice } from '../lib/notices.js';
import { APPS } from '../lib/apps.js';
import logger from '../lib/logger.js';
import { validate } from '../lib/validate.js';
import { rejectRequestSchema } from '../schemas/admin.js';

const NOTICES = {
  approved: { ok: true, text: 'Approved. A sign-in link is on its way to the new owner.' },
  approved_email_failed: {
    ok: false,
    text: 'Approved, but the sign-in email could not be sent. Use "Resend sign-in link" below.',
  },
  resent: { ok: true, text: 'A new sign-in link is on its way.' },
  resend_failed: { ok: false, text: 'The sign-in email could not be sent. Try again shortly.' },
  account_disabled: { ok: false, text: 'That account is disabled, so no sign-in link was sent.' },
};

const norm = (s) => (s || '').trim().toLowerCase();

function safeAppsLabel(json) {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) && arr.length ? arr.join(', ') : null;
  } catch {
    return null;
  }
}

// Flag likely duplicates so the operator doesn't provision a second company for
// the same person or name. Flags only: approval always creates a new company.
function flagRequests(pending, companies) {
  const emailCounts = new Map();
  for (const r of pending) {
    const k = norm(r.email);
    if (k) emailCounts.set(k, (emailCounts.get(k) || 0) + 1);
  }
  const existingNames = new Set(companies.map((c) => norm(c.name)));
  return pending.map((r) => ({
    ...r,
    appsLabel: r.apps_interest ? safeAppsLabel(r.apps_interest) : null,
    dupeEmail: !!norm(r.email) && emailCounts.get(norm(r.email)) > 1,
    existingCompany: !!norm(r.company_name) && existingNames.has(norm(r.company_name)),
  }));
}

export function mountAdminCompanies(app, { admin, emailSender }) {
  const db = app.locals.db;
  const config = app.locals.config;
  const audit = createAuditLogger(db);
  const org = createOrg(db);
  const ent = createEntitlements(db);
  const reqs = createAccessRequests(db);
  const provisioner = createProvisioner(db, { inviteTtlMs: config.inviteTtlMs });

  const notFound = (res, message) =>
    res.status(404).render('error', { title: 'Not found', message });

  function sendOwnerLink(req, to, token) {
    const url = `${config.baseUrl}/auth/magic?token=${token}`;
    const fn = emailSender && (() => emailSender.sendAccessApproved({ to, url }));
    return trySend(req.log || logger, 'access-approved', fn);
  }

  // Everyone who can reach this app through any grant or open listing. Grants
  // are not company-scoped, so this is access across all of the user's companies.
  const appsFor = (userId) =>
    APPS.filter((a) => a.open || ent.resolveEntitlement(userId, a.key).entitled).map((a) => a.name);

  app.get('/admin/companies', ...admin, (req, res) => {
    const companies = org.listAllCompanies();
    const appsByCompany = {};
    for (const c of companies) appsByCompany[c.id] = ent.listCompanyApps(c.id);
    const requests = flagRequests(reqs.listByStatus('pending'), companies);
    const notice = pickNotice(NOTICES, req.query.notice);
    res.render('admin/companies', { user: req.user, companies, appsByCompany, requests, notice });
  });

  app.get('/admin/companies/:slug', ...admin, (req, res) => {
    const company = org.getCompanyBySlug(req.params.slug);
    if (!company) return notFound(res, 'No such company.');
    const members = org.listCompanyMembers(company.id).map((m) => ({
      ...m,
      teams: org.teamsForUser(m.userId, company.id).map((t) => t.name),
      apps: appsFor(m.userId),
    }));
    res.render('admin/company', {
      user: req.user,
      company,
      members,
      teams: org.listTeams(company.id),
      companyApps: ent.listCompanyApps(company.id),
      notice: pickNotice(NOTICES, req.query.notice),
    });
  });

  app.post('/admin/requests/:id/approve', ...admin, async (req, res) => {
    const result = provisioner.approve({ requestId: req.params.id, grantedBy: req.user.id });
    if (!result.ok) {
      const message =
        result.reason === 'not_pending'
          ? 'That request has already been handled.'
          : 'Request not found.';
      return res.status(400).render('error', { title: "Can't approve", message });
    }
    audit.log({
      userId: req.user.id,
      eventType: 'access_request_approved',
      metadata: { company: result.company.slug, email: result.user.email },
      ip: req.ip,
    });
    const sent = await sendOwnerLink(req, result.user.email, result.token);
    if (sent) return res.redirect('/admin/companies?notice=approved');
    res.redirect(`/admin/companies/${result.company.slug}?notice=approved_email_failed`);
  });

  app.post('/admin/requests/:id/reject', ...admin, validate(rejectRequestSchema), (req, res) => {
    const r = reqs.getRequest(req.params.id);
    if (!r || r.status !== 'pending') {
      return res.status(400).render('error', {
        title: "Can't reject",
        message: 'That request has already been handled.',
      });
    }
    const note = req.body.review_note;
    reqs.markReviewed({ id: r.id, status: 'rejected', reviewedBy: req.user.id, note });
    audit.log({
      userId: req.user.id,
      eventType: 'access_request_rejected',
      metadata: { email: r.email },
      ip: req.ip,
    });
    res.redirect('/admin/companies');
  });

  // A fresh link for one named owner. Never re-provisions: no company,
  // membership or grant is touched.
  app.post('/admin/companies/:slug/owners/:userId/resend', ...admin, async (req, res) => {
    const company = org.getCompanyBySlug(req.params.slug);
    if (!company) return notFound(res, 'No such company.');
    const owner = db
      .prepare(
        `SELECT u.id, u.email, u.disabled_at FROM company_members cm JOIN users u ON u.id = cm.user_id
         WHERE cm.user_id = ? AND cm.company_id = ? AND cm.role = 'owner'`,
      )
      .get(req.params.userId, company.id);
    if (!owner) return notFound(res, 'Not an owner of this company.');
    const back = (notice) => res.redirect(`/admin/companies/${company.slug}?notice=${notice}`);
    if (owner.disabled_at) return back('account_disabled');
    const token = mintMagicToken(db, { email: owner.email, ttlMs: config.inviteTtlMs });
    const sent = await sendOwnerLink(req, owner.email, token);
    audit.log({
      userId: req.user.id,
      eventType: 'owner_link_resent',
      metadata: { company: company.slug, target: owner.id, sent },
      ip: req.ip,
    });
    back(sent ? 'resent' : 'resend_failed');
  });
}
