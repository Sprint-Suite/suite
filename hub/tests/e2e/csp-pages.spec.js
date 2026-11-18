import { test, expect } from '@playwright/test';
import { seedBase, signIn, mintToken, IDS, EMAILS } from './helpers/seed.js';

const GA = /googletagmanager\.com|google-analytics\.com/;
const heading = (name) => (page) => page.getByRole('heading', { name, exact: true });
const text = (value) => (page) => page.getByText(value, { exact: true }).first();

async function submitLogin(page) {
  await page.goto('/login');
  await page.fill('#email', 'nobody@e2e.test');
  return Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/login')),
    page.getByRole('button').first().click(),
  ]).then(([response]) => response);
}

async function submitRequest(page) {
  await page.goto('/request');
  await page.fill('[name=company_name]', 'Initech');
  await page.fill('[name=contact_name]', 'Ian');
  await page.fill('[name=email]', 'ian@e2e.test');
  return Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/request')),
    page.getByRole('button', { name: 'Request access' }).click(),
  ]).then(([response]) => response);
}

const go = (path) => (page) => page.goto(path);
const as = (user, path) => async (page, context) => {
  await signIn(context, user);
  return page.goto(path);
};

const CASES = [
  { view: 'login', reach: go('/login'), status: 200, url: '/login', marker: heading('Sign in to Sprint Suite') },
  { view: 'check-email', reach: submitLogin, status: 200, url: '/login', marker: text('nobody@e2e.test') },
  {
    view: 'confirm',
    reach: (page) => page.goto('/auth/magic?token=' + mintToken(EMAILS.member)),
    status: 200,
    url: '/auth/magic',
    marker: heading('Confirm sign in'),
  },
  { view: 'error', reach: go('/auth/magic?token=bogus'), status: 400, url: '/auth/magic', marker: heading('Link expired') },
  { view: 'legal', reach: go('/terms'), status: 200, url: '/terms', marker: heading('Terms') },
  {
    view: 'request-received',
    reach: submitRequest,
    status: 200,
    url: '/request',
    marker: heading('Request received'),
    marketing: true,
  },
  { view: 'admin/users', reach: as(IDS.admin, '/admin'), status: 200, url: '/admin', marker: text(EMAILS.owner) },
  {
    view: 'company/console',
    reach: as(IDS.owner, '/company/acme'),
    status: 200,
    url: '/company/acme',
    marker: text(EMAILS.member),
  },
  {
    view: 'company/team',
    reach: as(IDS.owner, '/company/acme/teams/t-alpha'),
    status: 200,
    url: '/company/acme/teams/t-alpha',
    marker: heading('Alpha'),
  },
];

function directive(csp, name) {
  return csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' '));
}

function watch(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const { url } = m.location();
    errors.push(`${m.text()} @ ${url}`);
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

function assertPolicy(csp, marketing) {
  expect(csp).toBeTruthy();
  expect(csp).toContain("style-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
  const script = directive(csp, 'script-src');
  if (marketing) expect(script).toContain('https://*.googletagmanager.com');
  else expect(script).toBe("script-src 'self'");
}

test.beforeEach(() => seedBase());

for (const c of CASES) {
  test(`${c.view}: right view, right policy, no CSP violations`, async ({ page, context }) => {
    await context.route(GA, (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
    );
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        window.__csp.push(e.violatedDirective + ' ' + e.blockedURI),
      );
    });
    const errors = watch(page);

    const response = await c.reach(page, context);

    expect(response.status()).toBe(c.status);
    await expect(page).toHaveURL(new RegExp(c.url.replace(/\//g, '\\/') + '(\\?|$)'));
    await expect(c.marker(page)).toBeVisible();
    assertPolicy(response.headers()['content-security-policy'], c.marketing);
    expect(await page.evaluate(() => window.__csp)).toEqual([]);
    const own = (m) => c.status === 400 && m.includes('status of 400') && m.includes(page.url());
    expect(errors.filter((m) => !own(m))).toEqual([]);
  });
}
