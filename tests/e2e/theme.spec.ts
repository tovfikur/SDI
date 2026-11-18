import { test, expect } from '@playwright/test';

test.describe('Theme system', () => {
  test('Light -> Dark -> persistence -> System resolution', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/login');
    await page.locator('.form-control-clay[type=text]').fill('admin');
    await page.locator('.form-control-clay[type=password]').fill('Admin@12345');
    await page.getByRole('button', { name: /sign in|login/i }).first().click();

    await page.waitForURL('**/');
    await expect(page.locator('.app-sidebar')).toBeVisible();

    await page.goto('/settings/appearance');
    await expect(page.locator('.theme-options')).toBeVisible();

    await page.locator('.theme-option', { hasText: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.locator('.theme-option', { hasText: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.locator('.theme-option', { hasText: 'System' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.locator('.theme-option', { hasText: 'System' }).click();
    await expect(page.locator('.theme-resolved-hint')).toContainText('Light');

    await context.close();
  });

  test('System mode follows OS preference change live', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();

    await page.goto('/login');
    await page.locator('.form-control-clay[type=text]').fill('admin');
    await page.locator('.form-control-clay[type=password]').fill('Admin@12345');
    await page.getByRole('button', { name: /sign in|login/i }).first().click();
    await page.waitForURL('**/');

    await page.goto('/settings/appearance');
    await page.locator('.theme-option', { hasText: 'System' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 5000 });

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light', { timeout: 5000 });

    await context.close();
  });

  test('Dark mode surfaces render on dashboard', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();

    await page.goto('/login');
    await page.locator('.form-control-clay[type=text]').fill('admin');
    await page.locator('.form-control-clay[type=password]').fill('Admin@12345');
    await page.getByRole('button', { name: /sign in|login/i }).first().click();
    await page.waitForURL('**/');

    await page.goto('/settings/appearance');
    await page.locator('.theme-option', { hasText: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.goto('/');
    await expect(page.locator('.stat-card-clay').first()).toBeVisible();
    const bg = await page.locator('.stat-card-clay').first().evaluate(
      (el) => getComputedStyle(el).backgroundColor
    );
    expect(bg).not.toBe('rgb(255, 255, 255)');

    await page.goto('/hr/employees');
    await expect(page.locator('.data-table-clay').first()).toBeVisible();

    await page.goto('/hr/field-tracking');
    await expect(page.locator('.map-shell').first()).toBeVisible();

    await context.close();
  });
});
