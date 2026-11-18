import { test, expect } from '@playwright/test';
import { seedBase, addMember, signIn, IDS, EMAILS } from './helpers/seed.js';

const memberForm = (suffix) => `form[action$="/members/${IDS.member}/${suffix}"]`;
const requestForm = (suffix) => `form[action="/admin/requests/${IDS.request}/${suffix}"]`;

const CASES = [
  {
    name: 'Make owner',
    user: IDS.owner,
    path: '/company/acme',
    form: memberForm('role'),
    title: 'Make owner',
    stillThere: EMAILS.member,
  },
  {
    name: 'Remove',
    user: IDS.owner,
    path: '/company/acme',
    form: memberForm('remove'),
    title: 'Remove member',
    stillThere: EMAILS.member,
  },
  {
    name: 'Approve',
    user: IDS.admin,
    path: '/admin/companies',
    form: requestForm('approve'),
    title: 'Approve request',
    stillThere: 'Globex',
  },
  {
    name: 'Reject with note',
    user: IDS.admin,
    path: '/admin/companies',
    form: requestForm('reject'),
    title: 'Reject request',
    stillThere: 'Globex',
    note: 'e2e note',
  },
];

test.beforeEach(() => seedBase());

for (const c of CASES) {
  test(`${c.name}: Cancel closes the dialog and submits nothing`, async ({ page, context }) => {
    await signIn(context, c.user);
    await page.goto(c.path);
    const posts = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') posts.push(`${r.method()} ${r.url()}`);
    });
    const urlBefore = page.url();
    const form = page.locator(c.form);
    if (c.note) await form.locator('input[name="review_note"]').fill(c.note);
    await form.locator('button[type="submit"], button:not([type])').click();

    await expect(page.locator('.confirm-backdrop')).toBeVisible();
    await expect(page.locator('.confirm-title')).toHaveText(c.title);
    await page.locator('.confirm-cancel').click();
    await expect(page.locator('.confirm-backdrop')).toBeHidden();

    expect(posts).toEqual([]);
    expect(page.url()).toBe(urlBefore);
    await page.reload();
    await expect(page.getByText(c.stillThere).first()).toBeVisible();
  });
}

test('Remove → confirm actually removes the member', async ({ page, context }) => {
  const gone = 'gone@e2e.test';
  const goneId = addMember(gone);
  await signIn(context, IDS.owner);
  await page.goto('/company/acme');
  await expect(page.getByText(gone)).toBeVisible();

  await page.locator(`form[action$="/members/${goneId}/remove"] button`).click();
  await expect(page.locator('.confirm-title')).toHaveText('Remove member');
  const isRemove = (r) => r.request().method() === 'POST' && r.url().endsWith(`/members/${goneId}/remove`);
  const isConsole = (r) =>
    r.request().isNavigationRequest() && r.request().method() === 'GET' && r.url().endsWith('/company/acme');
  const [removed, consolePage] = await Promise.all([
    page.waitForResponse(isRemove),
    page.waitForResponse(isConsole),
    page.locator('.confirm-ok').click(),
  ]);

  expect(removed.status()).toBeLessThan(400);
  expect(consolePage.status()).toBe(200);
  await expect(page).toHaveURL(/\/company\/acme$/);
  await expect(page.getByText(EMAILS.member).first()).toBeVisible();
  await expect(page.getByText(gone)).toHaveCount(0);
});
