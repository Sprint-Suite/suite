import { test, expect } from '@playwright/test';

const GA = /googletagmanager\.com|google-analytics\.com/;
const BAR = '.consent';
const ORIGIN = 'http://127.0.0.1:3067';

function trackGoogle(context) {
  const hits = [];
  context.route(GA, (route) => {
    hits.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
  });
  return hits;
}

function trackErrors(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function consentCookie(context) {
  const all = await context.cookies(ORIGIN);
  return all.find((c) => c.name === 'ss_consent')?.value;
}

async function gaCookieNames(context) {
  const all = await context.cookies(ORIGIN);
  return all.map((c) => c.name).filter((n) => n === '_ga' || n === '_ga_TEST');
}

async function acceptConsent(page, context, hits) {
  await page.goto('/privacy');
  await expect(page.locator(BAR)).toBeVisible();
  expect(hits).toHaveLength(0);
  await page.locator('.consent-yes').click();
  await expect(page.locator(BAR)).toBeHidden();
  await expect.poll(() => hits.length).toBeGreaterThan(0);
  expect(await consentCookie(context)).toBe('granted');
}

async function reloadStillGranted(page, hits) {
  const before = hits.length;
  await page.reload();
  await expect(page.locator(BAR)).toBeHidden();
  await expect.poll(() => hits.length).toBeGreaterThan(before);
}

async function withdraw(page, context) {
  await context.addCookies([
    { name: '_ga', value: 'GA1.1.1.1', url: ORIGIN },
    { name: '_ga_TEST', value: 'GS1.1.1.1', url: ORIGIN },
  ]);
  expect(await gaCookieNames(context)).toHaveLength(2);
  await page.getByText('Change your analytics choice').click();
  await expect(page.locator(BAR)).toBeVisible();
  await page.locator('.consent-no').click();
}

async function expectAnalyticsOff(page, context) {
  expect(await page.evaluate(() => window['ga-disable-G-TEST'])).toBe(true);
  const denied = await page.evaluate(() =>
    window.dataLayer.some(
      (a) => a[0] === 'consent' && a[1] === 'update' && a[2].analytics_storage === 'denied',
    ),
  );
  expect(denied).toBe(true);
  expect(await gaCookieNames(context)).toEqual([]);
  expect(await consentCookie(context)).toBe('denied');
}

async function reloadsStayQuiet(page, hits) {
  hits.length = 0;
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await expect(page.locator(BAR)).toBeHidden();
  }
  expect(hits).toEqual([]);
}

test('withdrawal stops analytics and survives two reloads', async ({ page, context }) => {
  const hits = trackGoogle(context);
  const errors = trackErrors(page);
  await acceptConsent(page, context, hits);
  await reloadStillGranted(page, hits);
  await withdraw(page, context);
  await expectAnalyticsOff(page, context);
  await reloadsStayQuiet(page, hits);
  expect(errors).toEqual([]);
});
