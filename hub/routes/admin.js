// routes/admin.js
import { createRequireSession } from '../middleware/requireSession.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { randomId, now } from '../lib/tokens.js';
import { createAuditLogger } from '../lib/audit.js';
import { deleteCentralSession, deleteCentralSessionsForUser } from '../lib/sessions.js';
import { deleteUser } from '../lib/users.js';
import { validate } from '../lib/validate.js';
import { createUserSchema } from '../schemas/admin.js';
import { mountAdminCompanies } from './admin-companies.js';

// "IBM (owner), Zeta (member)" per user id, for the users table.
function membershipsByUser(db) {
  const rows = db
    .prepare(
      `SELECT cm.user_id, c.name, cm.role FROM company_members cm
       JOIN companies c ON c.id = cm.company_id ORDER BY c.name`,
    )
    .all();
  const out = {};
  for (const r of rows) (out[r.user_id] ||= []).push(`${r.name} (${r.role})`);
  return out;
}

export function mountAdmin(app, { emailSender } = {}) {
  const db = app.locals.db;
  const requireSession = createRequireSession(db);
  const audit = createAuditLogger(db);
  const admin = [requireSession, requireAdmin];

  app.get('/admin', requireSession, requireAdmin, (req, res) => {
    const users = db
      .prepare(
        `
      SELECT u.id, u.email, u.display_name, u.is_admin, u.disabled_at,
             (SELECT COUNT(*) FROM central_sessions cs WHERE cs.user_id = u.id) AS session_count
      FROM users u ORDER BY u.email
    `,
      )
      .all();
    const companies = membershipsByUser(db);
    res.render('admin/users', { user: req.user, users, companies });
  });

  app.post(
    '/admin/users',
    requireSession,
    requireAdmin,
    validate(createUserSchema, {
      onInvalid: (req, res) =>
        res.status(400).render('error', { title: 'Bad request', message: 'Invalid email.' }),
    }),
    (req, res) => {
      // Site admins only: ordinary users join through a company invite, which emails them.
      const { email, display_name: displayName } = req.body;
      try {
        const id = randomId();
        db.prepare(
          'INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)',
        ).run(id, email, displayName, 1, now());
        audit.log({
          userId: req.user.id,
          eventType: 'user_created',
          metadata: { email, is_admin: true },
          ip: req.ip,
        });
      } catch (e) {
        if (/UNIQUE/.test(e.message)) {
          return res.status(400).render('error', {
            title: 'Already exists',
            message: 'A user with that email already exists.',
          });
        }
        throw e;
      }
      res.redirect('/admin');
    },
  );

  app.post('/admin/users/:id/disable', requireSession, requireAdmin, (req, res) => {
    const id = req.params.id;
    db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(now(), id);
    deleteCentralSessionsForUser(db, id);
    audit.log({
      userId: req.user.id,
      eventType: 'user_disabled',
      metadata: { target: id },
      ip: req.ip,
    });
    res.redirect('/admin');
  });

  app.post('/admin/users/:id/enable', requireSession, requireAdmin, (req, res) => {
    db.prepare('UPDATE users SET disabled_at = NULL WHERE id = ?').run(req.params.id);
    audit.log({
      userId: req.user.id,
      eventType: 'user_enabled',
      metadata: { target: req.params.id },
      ip: req.ip,
    });
    res.redirect('/admin');
  });

  app.post('/admin/users/:id/delete', requireSession, requireAdmin, (req, res) => {
    const id = req.params.id;
    if (id === req.user.id)
      return res
        .status(400)
        .render('error', { title: "Can't delete self", message: 'Use another admin account.' });
    deleteUser(db, id);
    audit.log({
      userId: req.user.id,
      eventType: 'user_deleted',
      metadata: { target: id },
      ip: req.ip,
    });
    res.redirect('/admin');
  });

  app.get('/admin/sessions', requireSession, requireAdmin, (req, res) => {
    const sessions = db
      .prepare(
        `
      SELECT cs.id, cs.created_at, cs.last_heartbeat_at, cs.ip, u.email
      FROM central_sessions cs JOIN users u ON u.id = cs.user_id
      ORDER BY cs.last_heartbeat_at DESC
    `,
      )
      .all();
    res.render('admin/sessions', { user: req.user, sessions });
  });

  app.post('/admin/sessions/:id/kill', requireSession, requireAdmin, (req, res) => {
    deleteCentralSession(db, req.params.id);
    audit.log({
      userId: req.user.id,
      eventType: 'session_killed',
      metadata: { target: req.params.id },
      ip: req.ip,
    });
    res.redirect('/admin/sessions');
  });

  app.get('/admin/audit', requireSession, requireAdmin, (req, res) => {
    const events = db
      .prepare(
        `
      SELECT ae.id, ae.user_id, ae.event_type, ae.app, ae.ip, ae.created_at, u.email
      FROM audit_events ae LEFT JOIN users u ON u.id = ae.user_id
      ORDER BY ae.id DESC LIMIT 200
    `,
      )
      .all();
    res.render('admin/audit', { user: req.user, events });
  });

  mountAdminCompanies(app, { admin, emailSender });
}
