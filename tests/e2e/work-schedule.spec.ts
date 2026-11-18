import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page, username: string) {
  await page.goto('/login');
  await page.locator('.form-control-clay[type=text]').fill(username);
  await page.locator('.form-control-clay[type=password]').fill('Admin@12345');
  await page.getByRole('button', { name: /sign in|login/i }).first().click();
  await page.waitForURL('**/');
  await page.waitForTimeout(2500);
}

test('admin: Work Schedule visible in Settings, opens page', async ({ page }) => {
  await login(page, 'admin');
  await page.locator('.nav-group-toggle', { hasText: 'Settings' }).click();
  const children = await page.locator('.nav-group-children .nav-child').allTextContents();
  expect(children.join('|')).toContain('Work Schedule');
  expect(children.join('|')).not.toContain('Setup Rules');
  await page.locator('.nav-child', { hasText: 'Work Schedule' }).click();
  await expect(page).toHaveURL(/\/hr\/setup-rules$/);
  await expect(page.locator('.page-title', { hasText: 'Work Schedule' })).toBeVisible();
});

test('employee: Work Schedule hidden (RBAC preserved)', async ({ page }) => {
  await login(page, 'emp.field');
  await page.locator('.nav-group-toggle', { hasText: 'Settings' }).click();
  const children = await page.locator('.nav-group-children .nav-child').allTextContents();
  expect(children).not.toContain('Work Schedule');
  await expect(page.locator('.nav-child', { hasText: 'Work Schedule' })).toHaveCount(0);
});