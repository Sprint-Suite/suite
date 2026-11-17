// tests/admin-onboarding.test.js — approve outcomes, owner resend, the read-only
// admin company page, and the admin users table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp, post } from './helpers.js';
import { now, randomToken } from '../lib/tokens.js';
import { createAccessRequests } from '../lib/access-requests.js';
import { createOrg } from '../lib/org.js';

function recordingSender({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async sendAccessApproved(msg) {
      sent.push(msg);
      if (fail) throw new Error('email send failed');
    },
  };
}

async function setup({ isAdmin = true, fail = false, noSender = false } = {}) {
  const { app, db, config } = await buildTestApp();
  const sender = recordingSender({ fail });
  const emailSender = noSender ? undefined : sender;
  const { mountAdmin } = await import('../routes/admin.js?t=' + Date.now());
  const { mountCompany } = await import('../routes/company.js?t=' + Date.now());
  mountAdmin(app, { emailSender });
  mountCompany(app, {});
  db.prepare(
    'INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)',
  ).run('admin1', 'admin@test', 'Admin', isAdmin ? 1 : 0, now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'admin1', now(), now(), now() + 60_000);
  return { app, db, config, sid, sender, org: createOrg(db) };
}

const auth = (t) => ['Cookie', `hub_session=${t.sid}`];
const get = (t, path) =>
  request(t.app)
    .get(path)
    .set(...auth(t));
const send = (t, path, body = {}) =>
  post(t.app, path)
    .type('form')
    .set(...auth(t))
    .send(body);
const count = (t, table) => t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const tokensFor = (t, email) =>
  t.db.prepare('SELECT token FROM magic_link_tokens WHERE email=?').all(email);

function requestAccess(t, companyName = 'IBM', email = 'james@ibm.com') {
  return createAccessRequests(t.db).createRequest({ companyName, contactName: 'James', email });
}

async function approved(t) {
  const r = requestAccess(t);
  await send(t, `/admin/requests/${r.id}/approve`);
  return t.db.prepare("SELECT id FROM users WHERE email='james@ibm.com'").get().id;
}

// ── approve outcomes ─────────────────────────────────────────────────────────

test('a delivered approval says so', async () => {
  const t = await setup();
  const r = requestAccess(t);
  const res = await send(t, `/admin/requests/${r.id}/approve`);
  assert.equal(res.headers.location, '/admin/companies?notice=approved');
  assert.equal(t.sender.sent.length, 1);
});

test('a failed approval email keeps the approval and lands on the company page', async () => {
  const t = await setup({ fail: true });
  const r = requestAccess(t);
  const res = await send(t, `/admin/requests/${r.id}/approve`);
  assert.equal(res.headers.location, '/admin/companies/ibm?notice=approved_email_failed');
  assert.equal(createAccessRequests(t.db).getRequest(r.id).status, 'approved');
  const page = await get(t, res.headers.location);
  assert.match(page.text, /class="notice notice-err"[^>]*>[^<]*email could not be sent/);
});

test('with no email sender an approval is reported as not emailed', async () => {
  const t = await setup({ noSender: true });
  const r = requestAccess(t);
  const res = await send(t, `/admin/requests/${r.id}/approve`);
  assert.equal(res.headers.location, '/admin/companies/ibm?notice=approved_email_failed');
});

// ── owner resend ─────────────────────────────────────────────────────────────

test('resend emails a fresh link to the owner and provisions nothing', async () => {
  const t = await setup();
  const ownerId = await approved(t);
  const before = ['companies', 'company_members', 'app_entitlements'].map((x) => count(t, x));
  const res = await send(t, `/admin/companies/ibm/owners/${ownerId}/resend`);
  assert.equal(res.headers.location, '/admin/companies/ibm?notice=resent');
  const after = ['companies', 'company_members', 'app_entitlements'].map((x) => count(t, x));
  assert.deepEqual(after, before);
  const toks = tokensFor(t, 'james@ibm.com');
  assert.equal(toks.length, 2);
  const last = t.sender.sent.at(-1);
  assert.equal(last.to, 'james@ibm.com');
  assert.equal(last.url, `${t.config.baseUrl}/auth/magic?token=${toks[1].token}`);
});

test('resend is audited with admin, recipient and outcome, never the token', async () => {
  const t = await setup();
  const ownerId = await approved(t);
  await send(t, `/admin/companies/ibm/owners/${ownerId}/resend`);
  const ev = t.db
    .prepare("SELECT user_id, metadata FROM audit_events WHERE event_type='owner_link_resent'")
    .get();
  assert.equal(ev.user_id, 'admin1');
  const meta = JSON.parse(ev.metadata);
  assert.deepEqual(meta, { company: 'ibm', target: ownerId, sent: true });
  for (const { token } of tokensFor(t, 'james@ibm.com')) assert.ok(!ev.metadata.includes(token));
});

test('a failed resend says so', async () => {
  const t = await setup();
  const ownerId = await approved(t);
  t.sender.sendAccessApproved = async () => {
    throw new Error('email send failed');
  };
  const res = await send(t, `/admin/companies/ibm/owners/${ownerId}/resend`);
  assert.equal(res.headers.location, '/admin/companies/ibm?notice=resend_failed');
});

test('resend refuses a non-owner member and an owner of another company (404)', async () => {
  const t = await setup();
  await approved(t);
  const ibm = t.org.getCompanyBySlug('ibm');
  t.db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('m1', 'm@ibm', now());
  t.org.addCompanyMember({ userId: 'm1', companyId: ibm.id, role: 'member' });
  const other = t.org.createCompany({ name: 'Other', slug: 'other' });
  t.db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('o1', 'o@x', now());
  t.org.addCompanyMember({ userId: 'o1', companyId: other.id, role: 'owner' });
  const sentBefore = t.sender.sent.length;
  assert.equal((await send(t, '/admin/companies/ibm/owners/m1/resend')).status, 404);
  assert.equal((await send(t, '/admin/companies/ibm/owners/o1/resend')).status, 404);
  assert.equal(t.sender.sent.length, sentBefore);
});

test('resend to a disabled owner sends nothing', async () => {
  const t = await setup();
  const ownerId = await approved(t);
  t.db.prepare('UPDATE users SET disabled_at=? WHERE id=?').run(now(), ownerId);
  const sentBefore = t.sender.sent.length;
  const res = await send(t, `/admin/companies/ibm/owners/${ownerId}/resend`);
  assert.equal(res.headers.location, '/admin/companies/ibm?notice=account_disabled');
  assert.equal(t.sender.sent.length, sentBefore);
});

test('a non-admin can neither resend nor view the admin company page', async () => {
  const t = await setup({ isAdmin: false });
  const ibm = t.org.createCompany({ name: 'IBM', slug: 'ibm' });
  t.org.addCompanyMember({ userId: 'admin1', companyId: ibm.id, role: 'owner' });
  assert.equal((await get(t, '/admin/companies/ibm')).status, 403);
  assert.equal((await send(t, '/admin/companies/ibm/owners/admin1/resend')).status, 403);
  assert.equal(t.sender.sent.length, 0);
});

// ── read-only admin company page ─────────────────────────────────────────────

test('an admin who is not a member can view the company page but not manage it', async () => {
  const t = await setup();
  const ownerId = await approved(t);
  const ibm = t.org.getCompanyBySlug('ibm');
  const team = t.org.createTeam({ companyId: ibm.id, name: 'Squad A' });
  t.org.addTeamMember({ userId: ownerId, teamId: team.id, role: 'member' });
  const res = await get(t, '/admin/companies/ibm');
  assert.equal(res.status, 200);
  assert.match(res.text, /james@ibm\.com/);
  assert.match(res.text, />Owner</);
  assert.match(res.text, /Squad A/);
  assert.match(res.text, />Never signed in</);
  assert.match(res.text, /across all their companies/);
  assert.match(res.text, new RegExp(`owners/${ownerId}/resend`));
  assert.doesNotMatch(res.text, /action="\/company\//);
  assert.equal((await get(t, '/company/ibm')).status, 403);
  const members = count(t, 'company_members');
  const mutate = await send(t, '/company/ibm/members', { email: 'x@y.z', role: 'owner' });
  assert.equal(mutate.status, 403);
  assert.equal(count(t, 'company_members'), members);
});

test('the admin company page is 404 for an unknown slug', async () => {
  const t = await setup();
  assert.equal((await get(t, '/admin/companies/nope')).status, 404);
});

test('a plain member row on the admin page offers no resend', async () => {
  const t = await setup();
  await approved(t);
  const ibm = t.org.getCompanyBySlug('ibm');
  t.db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('m1', 'm@ibm', now());
  t.org.addCompanyMember({ userId: 'm1', companyId: ibm.id, role: 'member' });
  const res = await get(t, '/admin/companies/ibm');
  assert.doesNotMatch(res.text, /owners\/m1\/resend/);
});

// ── companies list: drill-down, approve confirm, reject note ────────────────

test('the companies list links to the admin company page', async () => {
  const t = await setup();
  await approved(t);
  const res = await get(t, '/admin/companies');
  assert.match(res.text, /href="\/admin\/companies\/ibm"/);
  assert.doesNotMatch(res.text, /href="\/company\//);
});

test('approve asks for confirmation that names the new company and the owner', async () => {
  const t = await setup();
  const r = requestAccess(t, 'Acme <b>', 'boss@acme.test');
  const res = await get(t, '/admin/companies');
  const form = res.text.split('<form').find((f) => f.includes(`/admin/requests/${r.id}/approve`));
  assert.match(form, /data-confirm="[^"]*NEW company[^"]*Acme &lt;b&gt;[^"]*boss@acme\.test/);
  assert.match(form, /data-confirm="[^"]*do not change this/);
});

test('reject takes an optional internal note and stores it', async () => {
  const t = await setup();
  const r = requestAccess(t);
  const page = await get(t, '/admin/companies');
  assert.match(page.text, /name="review_note"/);
  await send(t, `/admin/requests/${r.id}/reject`, { review_note: '  spam  ' });
  assert.equal(createAccessRequests(t.db).getRequest(r.id).review_note, 'spam');
});

// ── users table ──────────────────────────────────────────────────────────────

test('enabling a user is audited', async () => {
  const t = await setup();
  t.db
    .prepare('INSERT INTO users (id,email,created_at,disabled_at) VALUES (?,?,?,?)')
    .run('u2', 'u2@test', now(), now());
  await send(t, '/admin/users/u2/enable');
  const ev = t.db
    .prepare("SELECT user_id, metadata FROM audit_events WHERE event_type='user_enabled'")
    .get();
  assert.equal(ev.user_id, 'admin1');
  assert.deepEqual(JSON.parse(ev.metadata), { target: 'u2' });
});

test('the users table lists every company and role for each user', async () => {
  const t = await setup();
  const ownerId = await approved(t);
  const other = t.org.createCompany({ name: 'Zeta', slug: 'zeta' });
  t.org.addCompanyMember({ userId: ownerId, companyId: other.id, role: 'member' });
  const res = await get(t, '/admin');
  const row = res.text.split('<tr>').find((r) => r.includes('<td>james@ibm.com</td>'));
  assert.match(row, /IBM \(owner\), Zeta \(member\)/);
});

test('Add user always creates a site admin, whatever the form says', async () => {
  const t = await setup();
  const page = await get(t, '/admin');
  assert.match(page.text, /Add site admin/);
  assert.doesNotMatch(page.text, /name="is_admin"/);
  await send(t, '/admin/users', { email: 'a@test.com', is_admin: '0' });
  await send(t, '/admin/users', { email: 'b@test.com' });
  const rows = t.db
    .prepare("SELECT is_admin FROM users WHERE email IN ('a@test.com','b@test.com')")
    .all();
  assert.deepEqual(
    rows.map((r) => r.is_admin),
    [1, 1],
  );
});
