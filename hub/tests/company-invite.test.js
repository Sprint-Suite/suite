// tests/company-invite.test.js — invite email, resend, and the console notices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp, post } from './helpers.js';
import { now, randomToken } from '../lib/tokens.js';
import { createOrg } from '../lib/org.js';

function recordingSender(db, { fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async sendCompanyInvite(msg) {
      const user = db.prepare('SELECT id FROM users WHERE email=?').get(msg.to);
      const member =
        user && db.prepare('SELECT 1 FROM company_members WHERE user_id=?').get(user.id);
      sent.push({ ...msg, memberAtSendTime: !!member });
      if (fail) throw new Error('email send failed');
    },
  };
}

async function build({ role = 'owner', fail = false, noSender = false } = {}) {
  const { app, db, config } = await buildTestApp();
  const sender = recordingSender(db, { fail });
  const { mountCompany } = await import('../routes/company.js?t=' + Date.now());
  mountCompany(app, { emailSender: noSender ? undefined : sender });
  const org = createOrg(db);
  const company = org.createCompany({ name: 'Acme', slug: 'acme' });
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run(
    'u1',
    'owner@b.c',
    now(),
  );
  org.addCompanyMember({ userId: 'u1', companyId: company.id, role });
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'u1', now(), now(), now() + 60_000);
  return { app, db, org, company, sid, config, sender };
}

const cookie = (sid) => `hub_session=${sid}`;
const invite = (t, email, role = 'member') =>
  post(t.app, '/company/acme/members')
    .type('form')
    .send({ email, role })
    .set('Cookie', cookie(t.sid));
const resend = (t, userId) =>
  post(t.app, `/company/acme/members/${userId}/resend`).set('Cookie', cookie(t.sid));
const tokensFor = (db, email) =>
  db.prepare('SELECT * FROM magic_link_tokens WHERE email=?').all(email);

function addMember(t, userId, { companyId = t.company.id, disabled = false } = {}) {
  t.db
    .prepare('INSERT INTO users (id,email,created_at,disabled_at) VALUES (?,?,?,?)')
    .run(userId, userId + '@b.c', now(), disabled ? now() : null);
  t.org.addCompanyMember({ userId, companyId, role: 'member' });
}

test('invite emails a 7-day sign-in link after the membership is committed', async () => {
  const t = await build();
  const res = await invite(t, 'New@B.C');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/company/acme?notice=invited');
  const [tok] = tokensFor(t.db, 'new@b.c');
  assert.ok(tok, 'token minted for the invitee');
  assert.equal(tok.expires_at - tok.created_at, t.config.inviteTtlMs);
  assert.equal(t.sender.sent.length, 1);
  const msg = t.sender.sent[0];
  assert.equal(msg.to, 'new@b.c');
  assert.equal(msg.url, `${t.config.baseUrl}/auth/magic?token=${tok.token}`);
  assert.equal(msg.companyName, 'Acme');
  assert.equal(msg.inviterEmail, 'owner@b.c');
  assert.equal(msg.memberAtSendTime, true);
});

test('inviting an existing member keeps their role, mints nothing, sends nothing', async () => {
  const t = await build();
  addMember(t, 'mem');
  const res = await invite(t, 'mem@b.c', 'owner');
  assert.equal(res.headers.location, '/company/acme?notice=already_member');
  assert.equal(tokensFor(t.db, 'mem@b.c').length, 0);
  assert.equal(t.sender.sent.length, 0);
  const m = t.db.prepare('SELECT role FROM company_members WHERE user_id=?').get('mem');
  assert.equal(m.role, 'member');
});

test('a failed send keeps the membership and says the email did not go', async () => {
  const t = await build({ fail: true });
  const res = await invite(t, 'new@b.c');
  assert.equal(res.headers.location, '/company/acme?notice=invite_email_failed');
  const u = t.db.prepare('SELECT id FROM users WHERE email=?').get('new@b.c');
  assert.ok(t.db.prepare('SELECT 1 FROM company_members WHERE user_id=?').get(u.id));
});

test('with no email sender configured the invite reports the email as not sent', async () => {
  const t = await build({ noSender: true });
  const res = await invite(t, 'new@b.c');
  assert.equal(res.headers.location, '/company/acme?notice=invite_email_failed');
});

test('inviting a disabled account adds them but sends no link', async () => {
  const t = await build();
  t.db
    .prepare('INSERT INTO users (id,email,created_at,disabled_at) VALUES (?,?,?,?)')
    .run('d1', 'gone@b.c', now(), now());
  const res = await invite(t, 'gone@b.c');
  assert.equal(res.headers.location, '/company/acme?notice=account_disabled');
  assert.equal(tokensFor(t.db, 'gone@b.c').length, 0);
  assert.equal(t.sender.sent.length, 0);
});

test('resend mints a fresh link and emails it', async () => {
  const t = await build();
  addMember(t, 'mem');
  const res = await resend(t, 'mem');
  assert.equal(res.headers.location, '/company/acme?notice=resent');
  const toks = tokensFor(t.db, 'mem@b.c');
  assert.equal(toks.length, 1);
  assert.equal(t.sender.sent[0].url, `${t.config.baseUrl}/auth/magic?token=${toks[0].token}`);
});

test('resend is throttled per target after three sends an hour', async () => {
  const t = await build();
  addMember(t, 'mem');
  for (let i = 0; i < 3; i++) await resend(t, 'mem');
  const res = await resend(t, 'mem');
  assert.equal(res.headers.location, '/company/acme?notice=resend_throttled');
  assert.equal(t.sender.sent.length, 3);
  assert.equal(tokensFor(t.db, 'mem@b.c').length, 3);
});

test('a failed resend says so', async () => {
  const t = await build({ fail: true });
  addMember(t, 'mem');
  const res = await resend(t, 'mem');
  assert.equal(res.headers.location, '/company/acme?notice=invite_email_failed');
});

test('resend to a disabled member sends nothing', async () => {
  const t = await build();
  addMember(t, 'mem', { disabled: true });
  const res = await resend(t, 'mem');
  assert.equal(res.headers.location, '/company/acme?notice=account_disabled');
  assert.equal(t.sender.sent.length, 0);
});

test('resend to a member of another company is 404 and sends nothing', async () => {
  const t = await build();
  const other = t.org.createCompany({ name: 'Other', slug: 'other' });
  addMember(t, 'stranger', { companyId: other.id });
  const res = await resend(t, 'stranger');
  assert.equal(res.status, 404);
  assert.equal(t.sender.sent.length, 0);
  assert.equal(tokensFor(t.db, 'stranger@b.c').length, 0);
});

test('a plain member cannot resend (403)', async () => {
  const t = await build({ role: 'member' });
  addMember(t, 'mem');
  const res = await resend(t, 'mem');
  assert.equal(res.status, 403);
  assert.equal(t.sender.sent.length, 0);
});

test('the console shows a known notice and ignores an unknown one', async () => {
  const t = await build();
  const ok = await request(t.app)
    .get('/company/acme?notice=invite_email_failed')
    .set('Cookie', cookie(t.sid));
  assert.match(ok.text, /class="notice notice-err"[^>]*>[^<]*could not be sent/);
  const junk = await request(t.app)
    .get('/company/acme?notice=zz%3Cimg%3E')
    .set('Cookie', cookie(t.sid));
  assert.doesNotMatch(junk.text, /class="notice/);
  assert.doesNotMatch(junk.text, /zz<img>|zz&lt;img/);
  const proto = await request(t.app)
    .get('/company/acme?notice=__proto__')
    .set('Cookie', cookie(t.sid));
  assert.equal(proto.status, 200);
  assert.doesNotMatch(proto.text, /class="notice/);
});

// The row's cells, in column order, for one member's email.
async function rowFor(t, email) {
  const res = await request(t.app).get('/company/acme').set('Cookie', cookie(t.sid));
  const row = res.text.split('<tr>').find((r) => r.includes(`<td>${email}</td>`));
  assert.ok(row, `row for ${email}`);
  return row;
}

test('a member row states role, teams and sign-in history, with explicit actions', async () => {
  const t = await build();
  addMember(t, 'mem');
  const team = t.org.createTeam({ companyId: t.company.id, name: 'Squad A' });
  t.org.addTeamMember({ userId: 'mem', teamId: team.id, role: 'member' });
  const row = await rowFor(t, 'mem@b.c');
  assert.match(row, />Member</);
  assert.match(row, /name="role" value="owner"[\s\S]*>Make owner</);
  assert.doesNotMatch(row, /\/apps\//);
  assert.match(row, /Squad A/);
  assert.match(row, />Never signed in</);
  assert.match(row, /members\/mem\/resend/);
});

test('a signed-in member has no resend', async () => {
  const t = await build();
  addMember(t, 'mem');
  t.db
    .prepare('INSERT INTO audit_events (user_id,event_type,created_at) VALUES (?,?,?)')
    .run('mem', 'session_created', now());
  const row = await rowFor(t, 'mem@b.c');
  assert.match(row, />Signed in</);
  assert.doesNotMatch(row, /resend/);
});

test('an owner row offers Make member and no per-app actions', async () => {
  const t = await build();
  const row = await rowFor(t, 'owner@b.c');
  assert.match(row, />Owner</);
  assert.match(row, /name="role" value="member"[\s\S]*>Make member</);
  assert.doesNotMatch(row, /\/apps\//);
});

test('remove and re-invite cannot get past the per-recipient limit', async () => {
  const t = await build();
  addMember(t, 'mem');
  for (let i = 0; i < 3; i++) await resend(t, 'mem');
  await post(t.app, '/company/acme/members/mem/remove').set('Cookie', cookie(t.sid));
  const res = await invite(t, 'mem@b.c');
  assert.equal(res.headers.location, '/company/acme?notice=invite_email_throttled');
  assert.ok(t.db.prepare('SELECT 1 FROM company_members WHERE user_id=?').get('mem'));
  assert.equal(t.sender.sent.length, 3);
  assert.equal(tokensFor(t.db, 'mem@b.c').length, 3);
});
