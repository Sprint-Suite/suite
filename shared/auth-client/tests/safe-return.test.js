// tests/safe-return.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { safeReturnPath } = require('../lib/safe-return.js');
const { createAuthClient } = require('../lib/factory.js');

test('safeReturnPath keeps a same-host path and query', () => {
  assert.equal(safeReturnPath('https://app.test/dashboard?x=1', 'app.test'), '/dashboard?x=1');
});

for (const [returnTo, host] of [
  ['https://app.test//evil.test/x', 'app.test'],
  ['https://app.test/\\evil.test', 'app.test'],
  ['https://evil.test/', 'app.test'],
  ['/dashboard', 'app.test'],
  ['::', 'app.test'],
  [undefined, 'app.test'],
  [42, 'app.test'],
  ['https://app.test/a', undefined],
]) {
  test(`safeReturnPath falls back to / for ${String(returnTo)} on ${host}`, () => {
    assert.equal(safeReturnPath(returnTo, host), '/');
  });
}

test('handleLaunch redirects to / for a protocol-relative return_to', async () => {
  const client = createAuthClient({
    appName: 'raid',
    hubBaseUrl: 'https://hub',
    hubApiKey: 'k',
    cookieName: 'raid_session',
    dbPath: ':memory:',
  });
  client._ctx.hubApi = { exchange: async () => ({ user: { id: 'u1' }, central_session_id: 'c1' }) };
  const app = express();
  app.get('/launch', client.handleLaunch);
  const res = await request(app)
    .get('/launch?token=t&return_to=https%3A%2F%2Fapp.test%2F%2Fevil.test%2Fx')
    .set('Host', 'app.test');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');
});
