// routes/company.js
import { createRequireSession } from '../middleware/requireSession.js';
import { createRequireCompanyRole } from '../middleware/requireCompanyRole.js';
import { createOrg } from '../lib/org.js';
import { createAuditLogger } from '../lib/audit.js';
import { validate } from '../lib/validate.js';
import { memberRoleSchema, teamNameSchema, teamMemberSchema } from '../schemas/company.js';
import { mountCompanyInvite } from './company-invite.js';
import { pickNotice } from '../lib/notices.js';

// Fixed text for ?notice=<key>. Never render the query value itself.
const NOTICES = {
  invited: { ok: true, text: 'Added. A sign-in link is on its way to them.' },
  resent: { ok: true, text: 'A new sign-in link is on its way.' },
  already_member: { ok: true, text: 'They are already a member. Nothing was changed or sent.' },
  invite_email_failed: {
    ok: false,
    text: 'The member is added, but the sign-in email could not be sent. Try "Resend link" shortly.',
  },
  invite_email_throttled: {
    ok: false,
    text: 'The member is added, but too many links went to that address in the last hour, so none was sent.',
  },
  account_disabled: { ok: false, text: 'That account is disabled, so no sign-in link was sent.' },
  resend_throttled: {
    ok: false,
    text: 'Too many links sent to that person in the last hour. Try again later.',
  },
};

export function mountCompany(app, { emailSender } = {}) {
  const db = app.locals.db;
  const requireSession = createRequireSession(db);
  const companyRole = createRequireCompanyRole(db);
  const org = createOrg(db);
  const audit = createAuditLogger(db);
  const manage = [requireSession, companyRole(['owner'])];

  const badReq = (title, message) => (_req, res) =>
    res.status(400).render('error', { title, message });

  // Resolve a team that must belong to req.company; render 404 otherwise.
  function loadTeam(req, res) {
    const team = org.getTeam(req.params.teamId);
    if (!team || team.company_id !== req.company.id) {
      res.status(404).render('error', { title: 'Not found', message: 'No such team.' });
      return null;
    }
    return team;
  }

  app.get('/company/:slug/teams/:teamId', ...manage, (req, res) => {
    const team = loadTeam(req, res);
    if (!team) return;
    const teamMembers = org.listTeamMembers(team.id);
    const memberIds = new Set(teamMembers.map((m) => m.userId));
    const availableMembers = org
      .listCompanyMembers(req.company.id)
      .filter((m) => !memberIds.has(m.userId));
    res.render('company/team', {
      user: req.user,
      company: req.company,
      team,
      teamMembers,
      availableMembers,
    });
  });

  app.get('/company/:slug', ...manage, (req, res) => {
    const members = org.listCompanyMembers(req.company.id).map((m) => ({
      ...m,
      teams: org.teamsForUser(m.userId, req.company.id).map((t) => t.name),
    }));
    const teams = org.listTeams(req.company.id);
    const notice = pickNotice(NOTICES, req.query.notice);
    res.render('company/console', {
      user: req.user,
      company: req.company,
      members,
      teams,
      notice,
    });
  });

  mountCompanyInvite(app, { manage, emailSender });

  app.post(
    '/company/:slug/members/:userId/role',
    ...manage,
    validate(memberRoleSchema, { onInvalid: badReq('Bad request', 'Invalid role.') }),
    (req, res) => {
      const { role } = req.body;
      const targetId = req.params.userId;
      const target = db
        .prepare('SELECT role FROM company_members WHERE user_id=? AND company_id=?')
        .get(targetId, req.company.id);
      if (!target) {
        return res
          .status(404)
          .render('error', { title: 'Not found', message: 'Not a member of this company.' });
      }
      try {
        org.setCompanyMemberRole({ userId: targetId, companyId: req.company.id, role });
      } catch (e) {
        if (e.message === 'last_owner') {
          return res.status(400).render('error', {
            title: "Can't change role",
            message: 'A company must keep at least one owner.',
          });
        }
        throw e;
      }
      audit.log({
        userId: req.user.id,
        eventType: 'company_member_role_changed',
        metadata: { company: req.company.slug, target: targetId, role },
        ip: req.ip,
      });
      res.redirect('/company/' + req.company.slug);
    },
  );

  app.post(
    '/company/:slug/teams',
    ...manage,
    validate(teamNameSchema, { onInvalid: badReq('Bad request', 'Team name is required.') }),
    (req, res) => {
      const { name } = req.body;
      let team;
      try {
        team = org.createTeam({ companyId: req.company.id, name });
      } catch (e) {
        if (/UNIQUE/.test(e.message)) {
          return res.status(400).render('error', {
            title: 'Bad request',
            message: 'A team with that name already exists.',
          });
        }
        throw e;
      }
      audit.log({
        userId: req.user.id,
        eventType: 'team_created',
        metadata: { company: req.company.slug, team: team.id, name },
        ip: req.ip,
      });
      res.redirect('/company/' + req.company.slug);
    },
  );

  app.post(
    '/company/:slug/teams/:teamId/rename',
    ...manage,
    validate(teamNameSchema, { onInvalid: badReq('Bad request', 'Team name is required.') }),
    (req, res) => {
      const team = loadTeam(req, res);
      if (!team) return;
      const { name } = req.body;
      try {
        org.renameTeam(team.id, name);
      } catch (e) {
        if (/UNIQUE/.test(e.message)) {
          return res.status(400).render('error', {
            title: 'Bad request',
            message: 'A team with that name already exists.',
          });
        }
        throw e;
      }
      audit.log({
        userId: req.user.id,
        eventType: 'team_renamed',
        metadata: { company: req.company.slug, team: team.id, name },
        ip: req.ip,
      });
      res.redirect(`/company/${req.company.slug}/teams/${team.id}`);
    },
  );

  app.post(
    '/company/:slug/teams/:teamId/members',
    ...manage,
    validate(teamMemberSchema, {
      onInvalid: badReq("Can't add", 'That person is not a member of this company.'),
    }),
    (req, res) => {
      const team = loadTeam(req, res);
      if (!team) return;
      const { userId } = req.body;
      try {
        org.addTeamMember({ userId, teamId: team.id, role: 'member' });
      } catch (e) {
        if (e.message === 'not_company_member') {
          return res.status(400).render('error', {
            title: "Can't add",
            message: 'That person is not a member of this company.',
          });
        }
        if (/UNIQUE/.test(e.message)) {
          return res.status(400).render('error', {
            title: "Can't add",
            message: 'That person is already on this team.',
          });
        }
        throw e;
      }
      audit.log({
        userId: req.user.id,
        eventType: 'team_member_added',
        metadata: { company: req.company.slug, team: team.id, target: userId },
        ip: req.ip,
      });
      res.redirect(`/company/${req.company.slug}/teams/${team.id}`);
    },
  );

  app.post('/company/:slug/teams/:teamId/members/:userId/remove', ...manage, (req, res) => {
    const team = loadTeam(req, res);
    if (!team) return;
    org.removeTeamMember({ userId: req.params.userId, teamId: team.id });
    audit.log({
      userId: req.user.id,
      eventType: 'team_member_removed',
      metadata: { company: req.company.slug, team: team.id, target: req.params.userId },
      ip: req.ip,
    });
    res.redirect(`/company/${req.company.slug}/teams/${team.id}`);
  });

  app.post('/company/:slug/members/:userId/remove', ...manage, (req, res) => {
    const targetId = req.params.userId;
    const target = db
      .prepare('SELECT role FROM company_members WHERE user_id=? AND company_id=?')
      .get(targetId, req.company.id);
    if (!target) {
      return res
        .status(404)
        .render('error', { title: 'Not found', message: 'Not a member of this company.' });
    }
    try {
      org.removeCompanyMember({ userId: targetId, companyId: req.company.id });
    } catch (e) {
      if (e.message === 'last_owner') {
        return res.status(400).render('error', {
          title: "Can't remove",
          message: 'A company must keep at least one owner.',
        });
      }
      throw e;
    }
    audit.log({
      userId: req.user.id,
      eventType: 'company_member_removed',
      metadata: { company: req.company.slug, target: targetId },
      ip: req.ip,
    });
    res.redirect('/company/' + req.company.slug);
  });
}
