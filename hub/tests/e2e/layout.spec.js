import { test, expect } from '@playwright/test';
import { seedBase, signIn, IDS, EMAILS } from './helpers/seed.js';

const PAGES = [
  { name: 'company console', user: IDS.owner, path: '/company/acme' },
  { name: 'admin company page', user: IDS.admin, path: '/admin/companies/acme' },
];
const WIDTHS = [1280, 400];

test.beforeEach(() => seedBase());

for (const p of PAGES) {
  for (const width of WIDTHS) {
    test(`${p.name} at ${width}px: renders and does not overflow`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 900 });
      await signIn(context, p.user);
      const response = await page.goto(p.path);
      expect(response.status()).toBe(200);

      await expect(page.locator('table').filter({ hasText: EMAILS.owner }).first()).toBeVisible();
      const fits = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(fits).toBe(true);
    });
  }
}
