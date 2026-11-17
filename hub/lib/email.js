// lib/email.js
import { Eta } from 'eta';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resend } from 'resend';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const eta = new Eta({ views: path.join(__dirname, '../views'), cache: false });

export async function renderMagicLinkEmail({ url }) {
  return await eta.renderAsync('emails/magic-link', { url });
}

export async function renderAccessApprovedEmail({ url }) {
  return await eta.renderAsync('emails/access-approved', { url });
}

export async function renderAccessRequestNotificationEmail({ request, reviewUrl }) {
  return await eta.renderAsync('emails/access-request-notification', { request, reviewUrl });
}

// Resend returns API and network failures as { error } rather than throwing. Both
// that and a thrown failure become one fixed message: provider text can echo the
// request, and the request carries the magic-link token. Only an allowlisted name
// and the HTTP status travel with it.
function safeFailure(detail) {
  const err = new Error('email send failed');
  if (typeof detail?.name === 'string' && /^[a-z_]{1,64}$/.test(detail.name)) {
    err.provider = detail.name;
  }
  if (Number.isInteger(detail?.statusCode)) err.statusCode = detail.statusCode;
  return err;
}

async function deliver(client, message) {
  let result;
  try {
    result = await client.emails.send(message);
  } catch {
    throw safeFailure(null);
  }
  if (result?.error) throw safeFailure(result.error);
  return result;
}

export function createEmailSender({ apiKey, from, client = new Resend(apiKey) }) {
  const resend = { emails: { send: (message) => deliver(client, message) } };
  return {
    async sendMagicLink({ to, url }) {
      const html = await renderMagicLinkEmail({ url });
      return await resend.emails.send({
        from,
        to,
        subject: 'Your Sprint Suite sign-in link',
        html,
      });
    },
    async sendAccessApproved({ to, url }) {
      const html = await renderAccessApprovedEmail({ url });
      return await resend.emails.send({
        from,
        to,
        subject: "You're approved — sign in to Sprint Suite",
        html,
      });
    },
    async sendAccessRequestNotification({ to, request, reviewUrl }) {
      const html = await renderAccessRequestNotificationEmail({ request, reviewUrl });
      return await resend.emails.send({
        from,
        to,
        subject: `New Sprint Suite access request — ${request.companyName}`,
        html,
      });
    },
  };
}
