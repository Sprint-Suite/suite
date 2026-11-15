import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createLogger, safeUrl } from '../lib/logger.js';

function capture() {
  const chunks = [];
  const stream = new Writable({
    write(c, _e, cb) {
      chunks.push(c.toString());
      cb();
    },
  });
  const records = () =>
    chunks
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  return { stream, records };
}

test('respects the configured level', () => {
  const cap = capture();
  const log = createLogger({ level: 'warn', stream: cap.stream });
  log.info('ignored');
  log.warn('kept');
  const recs = cap.records();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].msg, 'kept');
});

test('emits JSON with base service field', () => {
  const cap = capture();
  const log = createLogger({ level: 'info', stream: cap.stream });
  log.info('hello');
  assert.equal(cap.records()[0].service, 'hub');
});

test('redacts token and password at top level and one nesting level', () => {
  const cap = capture();
  const log = createLogger({ level: 'info', stream: cap.stream });
  log.info({ token: 'abc', password: 'pw', nested: { token: 'zzz' } }, 'm');
  const rec = cap.records()[0];
  assert.equal(rec.token, '[redacted]');
  assert.equal(rec.password, '[redacted]');
  assert.equal(rec.nested.token, '[redacted]');
});

test('safeUrl masks sensitive query params but keeps the path', () => {
  const out = safeUrl('/auth/magic?token=topsecretvalue&x=1');
  assert.ok(!out.includes('topsecretvalue'));
  assert.ok(out.startsWith('/auth/magic'));
  assert.ok(out.includes('x=1'));
  assert.ok(out.includes('token=[redacted]')); // key kept, sentinel readable (not %5B…%5D)
  assert.equal(safeUrl('/plain'), '/plain');
  assert.ok(!safeUrl('/x?password=topsecretpw').includes('topsecretpw'));
  assert.equal(safeUrl('/p?token=abc#frag'), '/p?token=[redacted]#frag');
});

test('safeUrl does not throw on malformed percent-encoding', () => {
  assert.equal(typeof safeUrl('/login?%=x'), 'string');
  const out = safeUrl('/x?%E0=1&token=abc');
  assert.equal(out, '/x?%E0=1&token=[redacted]');
});

test('safeUrl masks the launch state param', () => {
  const state = 'a'.repeat(64);
  const out = safeUrl(`/launch/signal?state=${state}&return_to=x`);
  assert.equal(out, '/launch/signal?state=[redacted]&return_to=x');
});

test('safeUrl redacts central session ids in session API paths', () => {
  assert.equal(safeUrl('/api/sessions/abc123/heartbeat'), '/api/sessions/[redacted]/heartbeat');
  assert.equal(safeUrl('/api/sessions/abc123'), '/api/sessions/[redacted]');
  assert.equal(safeUrl('/api/sessions/abc123?x=1'), '/api/sessions/[redacted]?x=1');
  assert.equal(safeUrl('/api/sessions/exchange'), '/api/sessions/exchange');
});

test('safeUrl masks state nested inside return_to', () => {
  const state = 'a'.repeat(64);
  const out = safeUrl(`/login?return_to=%2Flaunch%2Fsignal%3Fstate%3D${state}`);
  assert.ok(!out.includes('a'.repeat(64)));
  assert.ok(out.includes('[redacted]'));
});

test('safeUrl masks credentials nested inside an absolute return_to', () => {
  const hex = 'ab12'.repeat(16);
  const out = safeUrl(`/login?return_to=https%3A%2F%2Fsprintsignal.uk%2Fx%3Fstate%3D${hex}`);
  assert.ok(!out.includes(hex));
  assert.ok(out.includes('[redacted]'));
});

test('safeUrl leaves a return_to without sensitive params unchanged', () => {
  const url = '/login?return_to=%2Flaunch%2Fsignal%3Fx%3D1&y=2';
  assert.equal(safeUrl(url), url);
  assert.equal(safeUrl('/login?return_to=%E0%A4%A'), '/login?return_to=%E0%A4%A');
});
