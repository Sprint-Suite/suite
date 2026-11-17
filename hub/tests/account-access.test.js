// tests/account-access.test.js — effective Signal/RAID access as company roles
// and memberships change. Asserts through resolveEntitlement/consume, the same
// calls the dashboard and the apps make, rather than through grant rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { createOrg } from '../lib/org.js';
import { createEntitlements } from '../lib/entitlements.js';
import { createAccessRequests } from '../lib/access-requests.js';
import { createProvisioner } from '../lib/provisioning.js';

function setup() {
  const db = openDb(':memory:');
  const org = createOrg(db);
  const ent = createEntitlements(db);
  const reqs = createAccessRequests(db);
  const prov = createProvisioner(db, { inviteTtlMs: 60_000 });
  const r = reqs.createRequest({ companyName: 'Acme', contactName: 'F', email: 'f@acme.test' });
  const { company, user: founder } = prov.approve({ requestId: r.id, grantedBy: null });
  const invite = (email, role, companyId = company.id) =>
    org.inviteCompanyMember({ email, companyId, role }).user;
  const can = (userId, app) => ent.resolveEntitlement(userId, app).entitled;
  return { db, org, ent, company, founder, invite, can };
}

test('an owner invited as owner has Signal and RAID; a member beside them does not', () => {
  const { invite, can } = setup();
  const owner = invite('o@acme.test', 'owner');
  const member = invite('m@acme.test', 'member');
  assert.equal(can(owner.id, 'signal'), true);
  assert.equal(can(owner.id, 'raid'), true);
  assert.equal(can(member.id, 'signal'), false);
  assert.equal(can(member.id, 'raid'), false);
});

test('promotion grants owner access and demotion withdraws it when no explicit grant exists', () => {
  const { org, company, invite, can } = setup();
  const m = invite('m@acme.test', 'member');
  org.setCompanyMemberRole({ userId: m.id, companyId: company.id, role: 'owner' });
  assert.equal(can(m.id, 'signal'), true);
  org.setCompanyMemberRole({ userId: m.id, companyId: company.id, role: 'member' });
  assert.equal(can(m.id, 'signal'), false);
});

test('owner Signal is unlimited and owner RAID is 25 a month', () => {
  const { ent, invite } = setup();
  const owner = invite('o@acme.test', 'owner');
  assert.equal(ent.resolveEntitlement(owner.id, 'signal').quota, null);
  assert.deepEqual(ent.resolveEntitlement(owner.id, 'raid').quota, {
    limit: 25,
    period: 'month',
    remaining: 25,
  });
});

test('derived RAID quota refuses the 26th use, and two owners have separate buckets', () => {
  const { ent, invite } = setup();
  const a = invite('a@acme.test', 'owner');
  const b = invite('b@acme.test', 'owner');
  for (let i = 0; i < 25; i++) assert.equal(ent.consume(a.id, 'raid').ok, true);
  assert.deepEqual(ent.consume(a.id, 'raid'), { ok: false, reason: 'quota_exceeded' });
  assert.deepEqual(ent.consume(b.id, 'raid'), { ok: true, remaining: 24 });
});

test('RAID usage carries across demotion, an explicit grant and re-promotion', () => {
  const { org, ent, company, invite } = setup();
  const m = invite('m@acme.test', 'owner');
  for (let i = 0; i < 3; i++) ent.consume(m.id, 'raid');
  org.setCompanyMemberRole({ userId: m.id, companyId: company.id, role: 'member' });
  ent.grantEntitlement({
    app: 'raid',
    principalType: 'user',
    principalId: m.id,
    quotaLimit: 25,
    quotaPeriod: 'month',
  });
  assert.equal(ent.resolveEntitlement(m.id, 'raid').quota.remaining, 22);
  org.setCompanyMemberRole({ userId: m.id, companyId: company.id, role: 'owner' });
  assert.equal(ent.resolveEntitlement(m.id, 'raid').quota.remaining, 22);
});

test('approval no longer writes user-level grant rows for the founder', () => {
  const { db, founder, can } = setup();
  const rows = db
    .prepare("SELECT app FROM app_entitlements WHERE principal_type='user' AND principal_id=?")
    .all(founder.id);
  assert.deepEqual(rows, []);
  assert.equal(can(founder.id, 'signal'), true);
});

test('a newly provisioned founder who is demoted loses Signal', () => {
  const { org, company, founder, invite, can } = setup();
  invite('o2@acme.test', 'owner');
  org.setCompanyMemberRole({ userId: founder.id, companyId: company.id, role: 'member' });
  assert.equal(can(founder.id, 'signal'), false);
});

test('a legacy founder with explicit grants keeps them after demotion', () => {
  const { org, ent, company, founder, invite, can } = setup();
  ent.grantEntitlement({ app: 'signal', principalType: 'user', principalId: founder.id });
  invite('o2@acme.test', 'owner');
  org.setCompanyMemberRole({ userId: founder.id, companyId: company.id, role: 'member' });
  assert.equal(can(founder.id, 'signal'), true);
});

test('removal from the only company suspends Signal/RAID grants but keeps usage', () => {
  const { db, org, ent, company, invite, can } = setup();
  const m = invite('m@acme.test', 'member');
  ent.grantEntitlement({ app: 'signal', principalType: 'user', principalId: m.id });
  ent.grantEntitlement({
    app: 'raid',
    principalType: 'user',
    principalId: m.id,
    quotaLimit: 25,
    quotaPeriod: 'month',
  });
  ent.consume(m.id, 'raid');
  org.removeCompanyMember({ userId: m.id, companyId: company.id });
  assert.equal(can(m.id, 'signal'), false);
  assert.equal(can(m.id, 'raid'), false);
  const usage = db.prepare("SELECT count FROM app_usage WHERE principal_id=? AND app='raid'");
  assert.equal(usage.get(m.id).count, 1);
});

test('removal from one of two companies keeps grants; leaving the last one revokes them', () => {
  const { org, ent, company, invite, can } = setup();
  const other = org.createCompany({ name: 'Other', slug: 'other' });
  const m = invite('m@acme.test', 'member');
  invite('m@acme.test', 'member', other.id);
  ent.grantEntitlement({ app: 'signal', principalType: 'user', principalId: m.id });
  org.removeCompanyMember({ userId: m.id, companyId: company.id });
  assert.equal(can(m.id, 'signal'), true);
  org.removeCompanyMember({ userId: m.id, companyId: other.id });
  assert.equal(can(m.id, 'signal'), false);
});

test('a removed (non-last) owner loses derived access', () => {
  const { org, company, invite, can } = setup();
  const o = invite('o@acme.test', 'owner');
  org.removeCompanyMember({ userId: o.id, companyId: company.id });
  assert.equal(can(o.id, 'signal'), false);
});

test('owner derivation covers only per-member apps, not poker or retro', () => {
  const { org, can } = setup();
  const bare = org.createCompany({ name: 'Bare', slug: 'bare' });
  const o = org.inviteCompanyMember({ email: 'o@bare.test', companyId: bare.id, role: 'owner' });
  assert.equal(can(o.user.id, 'signal'), true);
  assert.equal(can(o.user.id, 'poker'), false);
  assert.equal(can(o.user.id, 'retro'), false);
});

test('removal suspends only the removed user’s Signal/RAID rows, and keeps the rows', () => {
  const { db, org, ent, company, invite, can } = setup();
  const a = invite('a@acme.test', 'member');
  const b = invite('b@acme.test', 'member');
  for (const [u, app] of [
    [a, 'signal'],
    [a, 'retro'],
    [b, 'signal'],
  ]) {
    ent.grantEntitlement({ app, principalType: 'user', principalId: u.id });
  }
  org.removeCompanyMember({ userId: a.id, companyId: company.id });
  assert.equal(can(a.id, 'retro'), true);
  assert.equal(can(b.id, 'signal'), true);
  const row = db.prepare(
    "SELECT status FROM app_entitlements WHERE principal_type='user' AND principal_id=? AND app='signal'",
  );
  assert.equal(row.get(a.id).status, 'suspended');
});

test('removal takes the user off the company’s teams, so team grants stop applying', () => {
  const { org, ent, company, invite, can } = setup();
  const m = invite('m@acme.test', 'member');
  const team = org.createTeam({ companyId: company.id, name: 'Blue' });
  org.addTeamMember({ userId: m.id, teamId: team.id, role: 'member' });
  ent.grantEntitlement({ app: 'signal', principalType: 'team', principalId: team.id });
  assert.equal(can(m.id, 'signal'), true);
  org.removeCompanyMember({ userId: m.id, companyId: company.id });
  assert.equal(can(m.id, 'signal'), false);
});

test('if revoking grants fails, the removal rolls back rather than failing open', () => {
  const { db, org, ent, company, invite } = setup();
  const m = invite('m@acme.test', 'member');
  ent.grantEntitlement({ app: 'signal', principalType: 'user', principalId: m.id });
  db.exec(
    "CREATE TRIGGER no_suspend BEFORE UPDATE ON app_entitlements BEGIN SELECT RAISE(ABORT, 'boom'); END",
  );
  assert.throws(() => org.removeCompanyMember({ userId: m.id, companyId: company.id }), /boom/);
  const still = db
    .prepare('SELECT 1 FROM company_members WHERE user_id=? AND company_id=?')
    .get(m.id, company.id);
  assert.ok(still);
});

test('owner derivation ignores inherited object keys', () => {
  const { ent, invite } = setup();
  const o = invite('o@acme.test', 'owner');
  for (const key of ['__proto__', 'constructor', 'toString']) {
    assert.equal(ent.resolveEntitlement(o.id, key).entitled, false, key);
    assert.equal(ent.consume(o.id, key).ok, false, key);
  }
});
