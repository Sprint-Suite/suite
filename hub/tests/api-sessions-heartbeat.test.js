// tests/api-sessions-heartbeat.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from './helpers.js';
import { now, randomToken } from '../lib/tokens.js';

async function setup() {
  const { app, db, config } = await buildTestApp();
  const { mountApiSessions } = await import('../routes/api-sessions.js?t=' + Date.now());
  mountApiSessions(app);
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('u1', 'a@b.c', now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'u1', now(), now(), now() + 24 * 60 * 60 * 1000);
  return { app, db, sid };
}

test('heartbeat updates last_heartbeat_at and returns 200', async () => {
  const { app, db, sid } = await setup();
  const before = db.prepare('SELECT last_heartbeat_at FROM central_sessions WHERE id = ?').get(sid);
  await new Promise((r) => setTimeout(r, 5));
  const res = await request(app)
    .post(`/api/sessions/${sid}/heartbeat`)
    .set('Authorization', 'Bearer k-raid');
  assert.equal(res.status, 200);
  const after = db.prepare('SELECT last_heartbeat_at FROM central_sessions WHERE id = ?').get(sid);
  assert.ok(after.last_heartbeat_at > before.last_heartbeat_at);
});

test('heartbeat on unknown session returns 404', async () => {
  const { app } = await setup();
  const res = await request(app)
    .post(`/api/sessions/nope/heartbeat`)
    .set('Authorization', 'Bearer k-raid');
  assert.equal(res.status, 404);
});

test('heartbeat on idle-expired session returns 404', async () => {
  const { app, db, sid } = await setup();
  const longAgo = now() - 60 * 60 * 1000;
  db.prepare('UPDATE central_sessions SET last_heartbeat_at = ? WHERE id = ?').run(longAgo, sid);
  const res = await request(app)
    .post(`/api/sessions/${sid}/heartbeat`)
    .set('Authorization', 'Bearer k-raid');
  assert.equal(res.status, 404);
});

test('delete session removes row, future heartbeat returns 404', async () => {
  const { app, db, sid } = await setup();
  const del = await request(app)
    .delete(`/api/sessions/${sid}`)
    .set('Authorization', 'Bearer k-raid');
  assert.equal(del.status, 204);
  const row = db.prepare('SELECT * FROM central_sessions WHERE id = ?').get(sid);
  assert.equal(row, undefined);
});

async function joinCompanyWithRaid(db) {
  const { createOrg } = await import('../lib/org.js?t=' + Date.now());
  const { createEntitlements } = await import('../lib/entitlements.js?t=' + Date.now());
  const org = createOrg(db);
  const co = org.createCompany({ name: 'Acme', slug: 'acme' });
  org.addCompanyMember({ userId: 'u1', companyId: co.id, role: 'member' });
  const team = org.createTeam({ companyId: co.id, name: 'Squad' });
  org.addTeamMember({ userId: 'u1', teamId: team.id, role: 'member' });
  const ent = createEntitlements(db);
  const target = { app: 'raid', principalType: 'user', principalId: 'u1' };
  ent.grantEntitlement({ ...target, grantedBy: null });
  return { org, ent, co, target };
}

function beat(app, sid) {
  return request(app).post(`/api/sessions/${sid}/heartbeat`).set('Authorization', 'Bearer k-raid');
}

test('heartbeat returns the current company and entitlement', async () => {
  const { app, db, sid } = await setup();
  const { co } = await joinCompanyWithRaid(db);
  const res = await beat(app, sid);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.company.id, co.id);
  assert.equal(res.body.entitlement.entitled, true);
  assert.equal(res.body.teams.length, 1);
});

test('heartbeat reflects removal from the company', async () => {
  const { app, db, sid } = await setup();
  const { org, co } = await joinCompanyWithRaid(db);
  org.removeCompanyMember({ userId: 'u1', companyId: co.id });
  const res = await beat(app, sid);
  assert.equal(res.body.company, null);
  assert.deepEqual(res.body.teams, []);
});

test('heartbeat reflects a revoked entitlement', async () => {
  const { app, db, sid } = await setup();
  const { ent, target } = await joinCompanyWithRaid(db);
  ent.revokeEntitlement(target);
  const res = await beat(app, sid);
  assert.equal(res.body.entitlement.entitled, false);
});
