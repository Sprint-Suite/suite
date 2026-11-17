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

// Resend returns API and network failures as { error } rather than throwing, so
// unwrap them into a rejection that callers' catch blocks can see and log.
async function deliver(client, message) {
  const result = await client.emails.send(message);
  if (result?.error) {
    throw new Error(`email send failed: ${result.error.message || result.error.name}`);
  }
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
