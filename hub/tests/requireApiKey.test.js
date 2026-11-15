// tests/requireApiKey.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequireApiKey } from '../middleware/requireApiKey.js';

const mw = createRequireApiKey({ apiKeys: { signal: 'signal-key', raid: 'raid-key' } });

function run(authorization) {
  const req = { headers: { authorization } };
  const res = {
    status(s) {
      this.statusCode = s;
      return this;
    },
    json(body) {
      this.body = body;
    },
    setHeader() {},
  };
  let nextCalled = false;
  mw(req, res, () => (nextCalled = true));
  return { req, res, nextCalled };
}

for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
  test(`inherited property name "${key}" is not an API key`, () => {
    const { res, nextCalled } = run(`Bearer ${key}`);
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'invalid_auth' });
  });
}

test('a configured key authenticates as its app', () => {
  const { req, nextCalled } = run('Bearer raid-key');
  assert.equal(nextCalled, true);
  assert.equal(req.callingApp, 'raid');
});
