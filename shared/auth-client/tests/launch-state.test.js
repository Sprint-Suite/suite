// tests/launch-state.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createAuthClient } = require('../lib/factory.js');
const { newState, statesMatch } = require('../lib/launch-state.js');

const COPY =
  'Sign-in could not be completed. Please return to the Sprint Suite dashboard and try again.';
const STATE_COOKIE = '__Host-raid_session_state';

function build() {
  const client = createAuthClient({
    appName: 'raid',
    hubBaseUrl: 'https://hub',
    hubApiKey: 'k',
    cookieName: 'raid_session',
    cookieDomain: 'example.test',
    dbPath: ':memory:',
  });
  const counter = { exchanges: 0 };
  client._ctx.hubApi = {
    exchange: async () => {
      counter.exchanges += 1;
      return { user: { id: 'u1' }, central_session_id: 'c1' };
    },
  };
  const app = express();
  app.get('/auth/launch', client.handleLaunch);
  return { app, counter };
}

function cookies(res) {
  return res.headers['set-cookie'] || [];
}

function assertStateCleared(res) {
  const del = cookies(res).find((c) => c.startsWith(`${STATE_COOKIE}=`));
  assert.ok(del, 'state cookie deletion header missing');
  assert.match(del, /Max-Age=0/);
  assert.match(del, /; Secure/);
  assert.match(del, /; Path=\//);
  assert.doesNotMatch(del, /Domain=/i);
}

function assertRejected(res) {
  assert.equal(res.status, 400);
  assert.match(res.headers['content-type'], /^text\/plain/);
  assert.equal(res.text, COPY);
  assertStateCleared(res);
}

test('newState is 64 lowercase hex and differs per call', () => {
  const s = newState();
  assert.match(s, /^[a-f0-9]{64}$/);
  assert.notEqual(s, newState());
});

test('statesMatch accepts only equal 64-hex strings', () => {
  const s = newState();
  assert.equal(statesMatch(s, s), true);
  assert.equal(statesMatch(s, newState()), false);
  assert.equal(statesMatch(s.toUpperCase(), s.toUpperCase()), false);
  assert.equal(statesMatch('abc', 'abc'), false);
  assert.equal(statesMatch(undefined, undefined), false);
  assert.equal(statesMatch([s], [s]), false);
});

test('stateless launch restarts via the hub without exchanging', async () => {
  const { app, counter } = build();
  const res = await request(app).get('/auth/launch?token=t').set('Host', 'app.test');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /^https:\/\/hub\/launch\/raid\?state=[a-f0-9]{64}$/);
  assert.equal(counter.exchanges, 0);
  const set = cookies(res).find((c) => c.startsWith(`${STATE_COOKIE}=`));
  assert.ok(set, 'state cookie not set');
  for (const attr of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=120']) {
    assert.ok(set.split('; ').includes(attr), `missing ${attr} in ${set}`);
  }
  assert.doesNotMatch(set, /Domain=/i);
  const value = set.split(';')[0].split('=')[1];
  assert.equal(res.headers.location, `https://hub/launch/raid?state=${value}`);
});

test('restart preserves return_to', async () => {
  const { app } = build();
  const returnTo = 'https://app.test/page?x=1';
  const res = await request(app)
    .get(`/auth/launch?token=t&return_to=${encodeURIComponent(returnTo)}`)
    .set('Host', 'app.test');
  assert.equal(res.status, 302);
  assert.match(
    res.headers.location,
    new RegExp(
      `^https://hub/launch/raid\\?state=[a-f0-9]{64}&return_to=${encodeURIComponent(returnTo)}$`,
    ),
  );
});

test('matching state exchanges and clears the cookie', async () => {
  const { app, counter } = build();
  const s = newState();
  const res = await request(app)
    .get(`/auth/launch?token=t&state=${s}&return_to=${encodeURIComponent('https://app.test/p')}`)
    .set('Host', 'app.test')
    .set('Cookie', `${STATE_COOKIE}=${s}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/p');
  assert.equal(counter.exchanges, 1);
  assert.equal(cookies(res).length, 2);
  assert.ok(cookies(res).some((c) => c.startsWith('raid_session=')));
  assertStateCleared(res);
});

test('attacker token with mismatched state is rejected without exchange', async () => {
  const { app, counter } = build();
  const res = await request(app)
    .get(`/auth/launch?token=attacker&state=${newState()}`)
    .set('Host', 'app.test')
    .set('Cookie', `${STATE_COOKIE}=${newState()}`);
  assertRejected(res);
  assert.equal(counter.exchanges, 0);
});

test('stateless launch with a stale state cookie fails once', async () => {
  const { app, counter } = build();
  const first = await request(app)
    .get('/auth/launch?token=t')
    .set('Host', 'app.test')
    .set('Cookie', `${STATE_COOKIE}=${newState()}`);
  assertRejected(first);
  const second = await request(app).get('/auth/launch?token=t').set('Host', 'app.test');
  assert.equal(second.status, 302);
  assert.match(second.headers.location, /^https:\/\/hub\/launch\/raid\?state=/);
  assert.equal(counter.exchanges, 0);
});

test('state param without any cookie is rejected', async () => {
  const { app, counter } = build();
  const res = await request(app)
    .get(`/auth/launch?token=t&state=${newState()}`)
    .set('Host', 'app.test');
  assertRejected(res);
  assert.equal(counter.exchanges, 0);
});
