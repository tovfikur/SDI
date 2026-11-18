import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page, username: string) {
  await page.goto('/login');
  await page.locator('.form-control-clay[type=text]').fill(username);
  await page.locator('.form-control-clay[type=password]').fill('Admin@12345');
  await page.getByRole('button', { name: /sign in|login/i }).first().click();
  await page.waitForURL('**/');
  await page.waitForTimeout(2500);
}

test('sidebar: Settings -> Appearance opens theme page', async ({ page }) => {
  await login(page, 'admin');
  await page.locator('.nav-group-toggle', { hasText: 'Settings' }).click();
  await page.locator('.nav-child', { hasText: 'Appearance' }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await expect(page.locator('.theme-options')).toBeVisible();
  await expect(page.locator('.settings-nav-link', { hasText: 'Appearance' })).toHaveClass(/active/);
});

test('settings subnav: Appearance link opens theme page', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/settings/software-setup');
  await page.locator('.settings-nav-link', { hasText: 'Appearance' }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await expect(page.locator('.theme-options')).toBeVisible();
});

test('direct URL + refresh keep the page open', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/settings/appearance');
  await expect(page.locator('.theme-options')).toBeVisible();
  await page.reload();
  await expect(page.locator('.theme-options')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('theme switching: Light / Dark / System apply instantly', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/settings/appearance');

  await page.locator('.theme-option', { hasText: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.theme-option', { hasText: 'Dark' })).toHaveClass(/active/);

  await page.locator('.theme-option', { hasText: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.locator('.theme-option', { hasText: 'System' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.theme-resolved-hint')).toContainText('Light');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('employee can change own appearance but not admin settings', async ({ page }) => {
  await login(page, 'emp.field');
  await page.locator('.nav-group-toggle', { hasText: 'Settings' }).click();
  await expect(page.locator('.nav-child', { hasText: 'Appearance' })).toBeVisible();
  await expect(page.locator('.nav-child', { hasText: 'Software Setup' })).toHaveCount(0);
  await page.locator('.nav-child', { hasText: 'Appearance' }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await expect(page.locator('.theme-options')).toBeVisible();

  await page.goto('/settings/software-setup');
  await expect(page.locator('.access-denied')).toBeVisible();
});

test('admin still sees admin-only settings', async ({ page }) => {
  await login(page, 'admin');
  await page.locator('.nav-group-toggle', { hasText: 'Settings' }).click();
  await expect(page.locator('.nav-child', { hasText: 'Software Setup' })).toBeVisible();
  await page.locator('.nav-child', { hasText: 'Software Setup' }).click();
  await expect(page).toHaveURL(/\/settings\/software-setup$/);
});