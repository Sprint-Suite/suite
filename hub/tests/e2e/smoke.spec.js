import { test, expect } from '@playwright/test';
import { seedBase, signIn, IDS, EMAILS } from './helpers/seed.js';

test('owner reaches the company console', async ({ page, context }) => {
  seedBase();
  await signIn(context, IDS.owner);
  const res = await page.goto('/company/acme');
  expect(res.status()).toBe(200);
  expect(page.url()).toMatch(/\/company\/acme$/);
  await expect(page.getByText(EMAILS.member)).toBeVisible();
});
