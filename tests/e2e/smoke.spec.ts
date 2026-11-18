import { expect, test } from '@playwright/test';

test('SPA shell loads the SDI login screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Self Development Initiative')).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

test('SPA refresh on a nested route returns the app shell', async ({ page }) => {
  await page.goto('/hr/dashboard');
  await expect(page.getByText('Self Development Initiative')).toBeVisible();
});