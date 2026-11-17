// tests/email.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderMagicLinkEmail,
  renderAccessApprovedEmail,
  createEmailSender,
} from '../lib/email.js';

test('renderMagicLinkEmail produces HTML with the URL', async () => {
  const html = await renderMagicLinkEmail({ url: 'https://sprintsuite.uk/auth/magic?token=abc' });
  assert.match(html, /Sign in to Sprint Suite/);
  assert.match(html, /https:\/\/sprintsuite\.uk\/auth\/magic\?token=abc/);
});

test('renderAccessApprovedEmail includes the sign-in url', async () => {
  const html = await renderAccessApprovedEmail({ url: 'https://test/auth/magic?token=abc' });
  assert.match(html, /auth\/magic\?token=abc/);
  assert.match(html, /Sprint Suite/);
});

// Resend reports API and network failures as a returned { error }, not a throw.
// The sender must turn that into a rejection, or every caller's catch-and-log is
// skipped and a failed send reads as delivered.
function fakeClient(result) {
  return { emails: { send: async () => result } };
}

test('a returned provider error rejects the send', async () => {
  const sender = createEmailSender({
    from: 'x@test',
    client: fakeClient({ data: null, error: { name: 'validation_error', message: 'bad from' } }),
  });
  await assert.rejects(sender.sendMagicLink({ to: 'a@test', url: 'https://t/x' }), {
    message: 'email send failed',
    provider: 'validation_error',
  });
  await assert.rejects(sender.sendAccessApproved({ to: 'a@test', url: 'https://t/x' }));
  await assert.rejects(
    sender.sendAccessRequestNotification({
      to: 'ops@test',
      request: { companyName: 'A' },
      reviewUrl: 'https://t/admin',
    }),
  );
});

test('a successful provider reply resolves with its data', async () => {
  const sender = createEmailSender({
    from: 'x@test',
    client: fakeClient({ data: { id: 'em_1' }, error: null }),
  });
  assert.deepEqual(await sender.sendMagicLink({ to: 'a@test', url: 'https://t/x' }), {
    data: { id: 'em_1' },
    error: null,
  });
});
