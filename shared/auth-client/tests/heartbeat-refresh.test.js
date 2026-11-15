// tests/heartbeat-refresh.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAuthClient } = require('../index.js');
const { createHubApi } = require('../lib/hub-api.js');

const T0 = 1_800_000_000_000;
const COOKIE = 'raid_session=a1';
const REVOKED = { entitled: false, teams: [], company: null };

function buildClient(t, heartbeat) {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const client = createAuthClient({
    appName: 'raid',
    hubBaseUrl: 'https://hub.test',
    hubApiKey: 'k',
    cookieName: 'raid_session',
    dbPath: ':memory:',
  });
  client._ctx.hubApi = { heartbeat };
  client._ctx.store.create({
    id: 'a1',
    userId: 'u1',
    centralSessionId: 's1',
    expiresAt: T0 + 24 * 60 * 60_000,
    entitled: true,
    teams: [{ id: 't1', name: 'Alpha', role: 'lead' }],
    company: { id: 'c1' },
  });
  return client;
}

function advance(t, ms) {
  t.mock.timers.setTime(Date.now() + ms);
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    status(s) {
      this.statusCode = s;
      return this;
    },
    json(o) {
      this.body = o;
    },
    redirect(code, location) {
      this.statusCode = code;
      this.location = location;
    },
    setHeader(n, v) {
      this.headers[n] = v;
    },
  };
}

async function runRequireAuth(client) {
  const req = { headers: { cookie: COOKIE, host: 'app.test' }, originalUrl: '/x' };
  const res = makeRes();
  let nextCalled = false;
  await client.requireAuth(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
}

test('requireAuth applies a revoked company on heartbeat', async (t) => {
  const client = buildClient(t, async () => ({ status: 'ok', context: REVOKED }));
  advance(t, 61_000);
  const { req, nextCalled } = await runRequireAuth(client);
  assert.equal(nextCalled, true);
  assert.equal(req.user.company, null);
  assert.equal(req.user.entitled, false);
  assert.deepEqual(req.user.teams, []);
  const row = client._ctx.store.get('a1');
  assert.equal(row.company, null);
  assert.equal(row.entitled, false);
  assert.deepEqual(row.teams, []);
  assert.equal(row.last_validated_at, Date.now());
});

test("an old hub's bare ok is an error: context unchanged, not re-validated", async (t) => {
  const f = async () => ({ status: 200, json: async () => ({ ok: true }) });
  const client = buildClient(t, null);
  client._ctx.hubApi = createHubApi({
    baseUrl: 'https://hub.test',
    apiKey: 'k',
    appName: 'raid',
    fetchImpl: f,
  });
  advance(t, 61_000);
  const { req, nextCalled } = await runRequireAuth(client);
  assert.equal(nextCalled, true);
  assert.deepEqual(req.user.company, { id: 'c1' });
  const row = client._ctx.store.get('a1');
  assert.deepEqual(row.company, { id: 'c1' });
  assert.equal(row.entitled, true);
  assert.equal(row.last_validated_at, T0);
});

test('unreachable hub leaves context untouched within grace', async (t) => {
  const client = buildClient(t, async () => ({ status: 'unreachable', context: null }));
  advance(t, 61_000);
  const { req, nextCalled } = await runRequireAuth(client);
  assert.equal(nextCalled, true);
  assert.deepEqual(req.user.company, { id: 'c1' });
  const row = client._ctx.store.get('a1');
  assert.deepEqual(row.company, { id: 'c1' });
  assert.equal(row.last_validated_at, T0);
});

test('handleHeartbeat refreshes context too', async (t) => {
  const client = buildClient(t, async () => ({ status: 'ok', context: REVOKED }));
  advance(t, 1_000);
  const res = makeRes();
  await client.handleHeartbeat({ method: 'POST', headers: { cookie: COOKIE } }, res);
  assert.equal(res.statusCode, 200);
  const row = client._ctx.store.get('a1');
  assert.equal(row.company, null);
  assert.equal(row.entitled, false);
  assert.equal(row.last_validated_at, Date.now());
});

test('verifySession applies a revoked company', async (t) => {
  const client = buildClient(t, async () => ({ status: 'ok', context: REVOKED }));
  advance(t, 61_000);
  const result = await client.verifySession(COOKIE);
  assert.equal(result.company, null);
  assert.equal(result.entitled, false);
  assert.equal(client._ctx.store.get('a1').company, null);
});

test('verifySession returns null on expired', async (t) => {
  const client = buildClient(t, async () => ({ status: 'expired', context: null }));
  advance(t, 61_000);
  assert.equal(await client.verifySession(COOKIE), null);
  assert.equal(client._ctx.store.get('a1'), undefined);
});

test('verifySession keeps context during an outage within grace, and returns null after grace', async (t) => {
  const client = buildClient(t, async () => ({ status: 'error', context: null }));
  advance(t, 61_000);
  const within = await client.verifySession(COOKIE);
  assert.deepEqual(within.company, { id: 'c1' });
  advance(t, 5 * 60_000);
  assert.equal(await client.verifySession(COOKIE), null);
  assert.equal(client._ctx.store.get('a1'), undefined);
});

test('hubApi.heartbeat maps a 200 body with entitlement to context', async () => {
  const fetchImpl = async () => ({
    status: 200,
    json: async () => ({
      ok: true,
      entitlement: { entitled: true },
      teams: [],
      company: { id: 'c1', name: 'C' },
    }),
  });
  const api = createHubApi({ baseUrl: 'https://hub.test', apiKey: 'k', fetchImpl });
  assert.deepEqual(await api.heartbeat('s1'), {
    status: 'ok',
    context: { entitled: true, teams: [], company: { id: 'c1', name: 'C' } },
  });
});

const ENTITLED = {
  entitled: true,
  teams: [{ id: 't1', name: 'Alpha', role: 'lead' }],
  company: { id: 'c1' },
};

function deferredHeartbeats() {
  const pending = [];
  const heartbeat = () =>
    new Promise((resolve) => {
      pending.push((context) => resolve({ status: 'ok', context }));
    });
  return { heartbeat, pending };
}

test('an older heartbeat response cannot overwrite a newer one', async (t) => {
  const { heartbeat, pending } = deferredHeartbeats();
  const client = buildClient(t, heartbeat);
  advance(t, 61_000);
  const older = client.verifySession(COOKIE);
  advance(t, 1);
  const newer = client.verifySession(COOKIE);
  assert.equal(pending.length, 2);
  pending[1](REVOKED);
  assert.equal((await newer).entitled, false);
  advance(t, 1);
  pending[0](ENTITLED);
  const result = await older;
  assert.equal(result.entitled, false);
  assert.equal(result.company, null);
  const row = client._ctx.store.get('a1');
  assert.equal(row.entitled, false);
  assert.equal(row.company, null);
  assert.equal(row.last_validated_at, T0 + 61_001);
});

test('overlapping heartbeats completing in order keep the newer result', async (t) => {
  const { heartbeat, pending } = deferredHeartbeats();
  const client = buildClient(t, heartbeat);
  advance(t, 61_000);
  const older = client.verifySession(COOKIE);
  advance(t, 1);
  const newer = client.verifySession(COOKIE);
  advance(t, 1);
  pending[0](ENTITLED);
  await older;
  advance(t, 1);
  pending[1](REVOKED);
  const result = await newer;
  assert.equal(result.entitled, false);
  assert.equal(result.company, null);
  const row = client._ctx.store.get('a1');
  assert.equal(row.entitled, false);
  assert.equal(row.company, null);
  assert.equal(row.last_validated_at, T0 + 61_001);
});

test('heartbeat fetch has a timeout', async (t) => {
  const requested = [];
  t.mock.method(AbortSignal, 'timeout', (ms) => {
    requested.push(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), 1);
    return controller.signal;
  });
  const fetchImpl = (_url, opts) =>
    new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
    });
  const api = createHubApi({ baseUrl: 'https://hub.test', apiKey: 'k', fetchImpl });
  assert.deepEqual(await api.heartbeat('s1'), { status: 'unreachable', context: null });
  assert.deepEqual(requested, [5000]);
});

function deferredOutcomes() {
  const pending = [];
  const heartbeat = () =>
    new Promise((resolve) => {
      pending.push((status, context = null) => resolve({ status, context }));
    });
  return { heartbeat, pending };
}

test('an older unreachable heartbeat returns the newer revoked state', async (t) => {
  const { heartbeat, pending } = deferredOutcomes();
  const client = buildClient(t, heartbeat);
  advance(t, 61_000);
  const older = client.verifySession(COOKIE);
  advance(t, 1);
  const newer = client.verifySession(COOKIE);
  pending[1]('ok', REVOKED);
  await newer;
  pending[0]('unreachable');
  const result = await older;
  assert.equal(result.entitled, false);
  assert.equal(result.company, null);
});

test('an older unreachable heartbeat does not revive a session a newer one expired', async (t) => {
  const { heartbeat, pending } = deferredOutcomes();
  const client = buildClient(t, heartbeat);
  advance(t, 61_000);
  const older = client.verifySession(COOKIE);
  advance(t, 1);
  const newer = client.verifySession(COOKIE);
  pending[1]('expired');
  assert.equal(await newer, null);
  pending[0]('unreachable');
  assert.equal(await older, null);
});

test('validations started in the same millisecond keep the later-started result', async (t) => {
  const { heartbeat, pending } = deferredHeartbeats();
  const client = buildClient(t, heartbeat);
  advance(t, 61_000);
  const older = client.verifySession(COOKIE);
  const newer = client.verifySession(COOKIE);
  pending[0](ENTITLED);
  await older;
  pending[1](REVOKED);
  assert.equal((await newer).entitled, false);
  assert.equal(client._ctx.store.get('a1').entitled, false);
});

test('validations started in the same millisecond reject the earlier-started result', async (t) => {
  const { heartbeat, pending } = deferredHeartbeats();
  const client = buildClient(t, heartbeat);
  advance(t, 61_000);
  const older = client.verifySession(COOKIE);
  const newer = client.verifySession(COOKIE);
  pending[1](REVOKED);
  await newer;
  pending[0](ENTITLED);
  assert.equal((await older).entitled, false);
  assert.equal(client._ctx.store.get('a1').entitled, false);
});

test('a burst of failed validations does not push freshness into the future', async (t) => {
  let outcome = 'unreachable';
  const client = buildClient(t, async () =>
    outcome === 'ok'
      ? { status: 'ok', context: ENTITLED }
      : { status: 'unreachable', context: null },
  );
  client._ctx.store.create({
    id: 'b1',
    userId: 'u2',
    centralSessionId: 's2',
    expiresAt: T0 + 24 * 60 * 60_000,
    entitled: true,
    teams: [],
    company: { id: 'c1' },
  });
  advance(t, 61_000);
  for (let i = 0; i < 1000; i++) await client.verifySession(COOKIE);
  outcome = 'ok';
  await client.verifySession('raid_session=b1');
  assert.equal(client._ctx.store.get('b1').last_validated_at, T0 + 61_000);
});
