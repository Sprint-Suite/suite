import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { Writable } from 'node:stream';
import { buildTestApp, post } from './helpers.js';
import { mountLogin } from '../routes/login.js';
import { createLogger } from '../lib/logger.js';
import { mountRequest } from '../routes/request.js';
import { mountAdmin } from '../routes/admin.js';
import { createEmailSender } from '../lib/email.js';
import { createAccessRequests } from '../lib/access-requests.js';

// A throwing email sender exercises the catch block (best-effort logging path).
const throwingSender = {
  async sendMagicLink() {
    throw new Error('smtp down');
  },
};

test('login still succeeds when the magic-link email send throws', async () => {
  const { app, db } = await buildTestApp();
  // Insert shape mirrors tests/login.test.js (users.id is a required column).
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,?)').run(
    'u1',
    'known@test.com',
    Date.now(),
  );
  mountLogin(app, { emailSender: throwingSender });
  // The magic-link send only fires for an existing user, so this hits the catch.
  const res = await post(app, '/login').type('form').send({ email: 'known@test.com' });
  // Existing behaviour: always render check-email (no user enumeration), 200.
  assert.equal(res.status, 200);
  assert.ok(res.text.length > 0);
});

function capture() {
  const chunks = [];
  const stream = new Writable({
    write(c, _e, cb) {
      chunks.push(c.toString());
      cb();
    },
  });
  return {
    stream,
    records: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
  };
}
const tick = () => new Promise((r) => setImmediate(r));

test('login logs a structured error (via req.log) when the email send throws', async () => {
  const cap = capture();
  // The capture logger goes into the shell: it IS the app's request logger, not a
  // second one layered on top (pino-http keeps the first req.log it finds).
  const { app, db } = await buildTestApp({
    logger: createLogger({ level: 'info', stream: cap.stream }),
  });
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,?)').run(
    'u2',
    'k2@test.com',
    Date.now(),
  );
  mountLogin(app, { emailSender: throwingSender });
  await post(app, '/login').type('form').send({ email: 'k2@test.com' });
  await tick();
  assert.ok(cap.records().some((r) => r.msg === 'magic link send failed'));
});

test('request route logs a structured error when the notification email throws', async () => {
  const cap = capture();
  const { app } = await buildTestApp({
    env: { ADMIN_EMAIL: 'op@test' },
    logger: createLogger({ level: 'info', stream: cap.stream }),
  });
  const sender = {
    async sendAccessRequestNotification() {
      throw new Error('smtp down');
    },
  };
  mountRequest(app, { emailSender: sender });
  // Fields use snake_case to match the real route handler. Honeypot (website) left absent.
  const res = await post(app, '/request').type('form').send({
    company_name: 'Acme',
    contact_name: 'Jo',
    email: 'jo@acme.com',
    job_title: 'PM',
    team_size: '5',
    apps: 'poker',
    message: 'hi',
  });
  await tick();
  assert.ok(res.status === 200 || res.status === 302);
  assert.ok(cap.records().some((r) => r.msg === 'access request notification failed'));
});

// The real sender over a provider that RETURNS an error, as Resend does for API and
// network failures. A throwing fake would pass even if that shape were ignored.
const returningErrorSender = () =>
  createEmailSender({
    from: 'x@test',
    client: { emails: { send: async () => ({ data: null, error: { message: 'bad from' } }) } },
  });

test('login logs a provider error that is returned rather than thrown', async () => {
  const cap = capture();
  const { app, db } = await buildTestApp({
    logger: createLogger({ level: 'info', stream: cap.stream }),
  });
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,?)').run(
    'u3',
    'k3@test.com',
    Date.now(),
  );
  mountLogin(app, { emailSender: returningErrorSender() });
  const res = await post(app, '/login').type('form').send({ email: 'k3@test.com' });
  await tick();
  assert.equal(res.status, 200);
  const rec = cap.records().find((r) => r.msg === 'magic link send failed');
  assert.match(rec.err.message, /email send failed/);
});

// A provider can echo the request back in its error text. Whatever it says, the
// magic-link token must never reach the logs.
for (const [label, send] of [
  ['returned', async (m) => ({ data: null, error: { name: 'x', message: m.html } })],
  [
    'thrown',
    async (m) => {
      throw new Error(`fetch failed for ${m.html}`);
    },
  ],
]) {
  test(`a ${label} provider error does not leak the magic-link token into logs`, async () => {
    const cap = capture();
    const { app, db } = await buildTestApp({
      logger: createLogger({ level: 'info', stream: cap.stream }),
    });
    db.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,?)').run(
      'u4',
      'k4@test.com',
      Date.now(),
    );
    mountLogin(app, {
      emailSender: createEmailSender({ from: 'x@test', client: { emails: { send } } }),
    });
    await post(app, '/login').type('form').send({ email: 'k4@test.com' });
    await tick();
    const token = db
      .prepare('SELECT token FROM magic_link_tokens WHERE email=?')
      .get('k4@test.com').token;
    assert.ok(cap.records().some((r) => r.msg === 'magic link send failed'));
    assert.equal(JSON.stringify(cap.records()).includes(token), false);
  });
}

test('approve still redirects and logs when the approval email fails', async () => {
  const cap = capture();
  const { app, db } = await buildTestApp({
    logger: createLogger({ level: 'info', stream: cap.stream }),
  });
  const t = Date.now();
  db.prepare('INSERT INTO users (id,email,is_admin,created_at) VALUES (?,?,1,?)').run(
    'adm',
    'adm@test',
    t,
  );
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run('sid-adm', 'adm', t, t, t + 60_000);
  const r = createAccessRequests(db).createRequest({
    companyName: 'IBM',
    contactName: 'J',
    email: 'j@ibm.test',
  });
  mountAdmin(app, { emailSender: returningErrorSender() });
  const res = await post(app, `/admin/requests/${r.id}/approve`).set(
    'Cookie',
    'hub_session=sid-adm',
  );
  await tick();
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/admin/companies/ibm?notice=approved_email_failed');
  assert.equal(createAccessRequests(db).getRequest(r.id).status, 'approved');
  assert.ok(cap.records().some((x) => x.msg === 'access-approved email send failed'));
});
