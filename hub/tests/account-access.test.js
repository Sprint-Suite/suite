// tests/account-access.test.js — effective app access as company roles and
// memberships change. Signal and RAID belong to every user whatever their role. Asserts through resolveEntitlement/consume, the same
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

test('owners, members, demoted and removed users all hold Signal and RAID', () => {
  const { org, company, founder, invite, can } = setup();
  const owner = invite('o@acme.test', 'owner');
  const member = invite('m@acme.test', 'member');
  invite('keeper@acme.test', 'owner');
  org.setCompanyMemberRole({ userId: founder.id, companyId: company.id, role: 'member' });
  org.removeCompanyMember({ userId: owner.id, companyId: company.id });
  for (const u of [owner, member, founder]) {
    assert.equal(can(u.id, 'signal'), true, u.email);
    assert.equal(can(u.id, 'raid'), true, u.email);
  }
});

test('Signal is unlimited and RAID is 25 a month for a plain member', () => {
  const { ent, invite } = setup();
  const m = invite('m@acme.test', 'member');
  assert.equal(ent.resolveEntitlement(m.id, 'signal').quota, null);
  assert.deepEqual(ent.resolveEntitlement(m.id, 'raid').quota, {
    limit: 25,
    period: 'month',
    remaining: 25,
  });
});

test('RAID refuses the 26th use, and two members have separate buckets', () => {
  const { ent, invite } = setup();
  const a = invite('a@acme.test', 'member');
  const b = invite('b@acme.test', 'member');
  for (let i = 0; i < 25; i++) assert.equal(ent.consume(a.id, 'raid').ok, true);
  assert.deepEqual(ent.consume(a.id, 'raid'), { ok: false, reason: 'quota_exceeded' });
  assert.deepEqual(ent.consume(b.id, 'raid'), { ok: true, remaining: 24 });
});

test('RAID usage carries across promotion, removal and an explicit grant', () => {
  const { org, ent, company, invite } = setup();
  const m = invite('m@acme.test', 'member');
  for (let i = 0; i < 3; i++) ent.consume(m.id, 'raid');
  org.setCompanyMemberRole({ userId: m.id, companyId: company.id, role: 'owner' });
  ent.grantEntitlement({
    app: 'raid',
    principalType: 'user',
    principalId: m.id,
    quotaLimit: 25,
    quotaPeriod: 'month',
  });
  org.setCompanyMemberRole({ userId: m.id, companyId: company.id, role: 'member' });
  invite('o2@acme.test', 'owner');
  assert.equal(ent.resolveEntitlement(m.id, 'raid').quota.remaining, 22);
});

test('approval writes no user-level grant rows for the founder', () => {
  const { db, founder, can } = setup();
  const rows = db
    .prepare("SELECT app FROM app_entitlements WHERE principal_type='user' AND principal_id=?")
    .all(founder.id);
  assert.deepEqual(rows, []);
  assert.equal(can(founder.id, 'signal'), true);
});

test('per-user access covers only Signal and RAID, not poker or retro', () => {
  const { org, can } = setup();
  const bare = org.createCompany({ name: 'Bare', slug: 'bare' });
  const o = org.inviteCompanyMember({ email: 'o@bare.test', companyId: bare.id, role: 'owner' });
  assert.equal(can(o.user.id, 'signal'), true);
  assert.equal(can(o.user.id, 'poker'), false);
  assert.equal(can(o.user.id, 'retro'), false);
});

test('removal keeps the user’s own grant rows active', () => {
  const { db, org, ent, company, invite, can } = setup();
  const a = invite('a@acme.test', 'member');
  ent.grantEntitlement({ app: 'retro', principalType: 'user', principalId: a.id });
  org.removeCompanyMember({ userId: a.id, companyId: company.id });
  assert.equal(can(a.id, 'retro'), true);
  const row = db.prepare(
    "SELECT status FROM app_entitlements WHERE principal_type='user' AND principal_id=? AND app='retro'",
  );
  assert.equal(row.get(a.id).status, 'active');
});

test('removal takes the user off the company’s teams, so team grants stop applying', () => {
  const { org, ent, company, invite, can } = setup();
  const m = invite('m@acme.test', 'member');
  const other = org.createCompany({ name: 'Other', slug: 'other' });
  invite('m@acme.test', 'member', other.id);
  const team = org.createTeam({ companyId: company.id, name: 'Blue' });
  org.addTeamMember({ userId: m.id, teamId: team.id, role: 'member' });
  ent.grantEntitlement({ app: 'poker', principalType: 'team', principalId: team.id });
  assert.equal(can(m.id, 'poker'), true);
  org.removeCompanyMember({ userId: m.id, companyId: company.id });
  assert.equal(can(m.id, 'poker'), false);
});

test('per-user access ignores inherited object keys', () => {
  const { ent, invite } = setup();
  const m = invite('m@acme.test', 'member');
  for (const key of ['__proto__', 'constructor', 'toString']) {
    assert.equal(ent.resolveEntitlement(m.id, key).entitled, false, key);
    assert.equal(ent.consume(m.id, key).ok, false, key);
  }
});
