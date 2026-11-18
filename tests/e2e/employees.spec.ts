import { expect, test } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByPlaceholder('Enter your username').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('Admin@12345');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.locator('nav.sidebar-nav')).toBeVisible();
}

test('Employee create via UI modal succeeds and persists', async ({ page }) => {
  const name = `E2E Create ${Date.now()}`;

  await login(page);
  await page.goto('/hr/employees');
  await expect(page.getByPlaceholder('Search by name, employee ID or email...')).toBeVisible();

  await page.getByRole('button', { name: '+ New Employee' }).click();
  const modal = page.locator('.modal-overlay');
  await expect(modal.getByText('New Employee', { exact: true })).toBeVisible();

  await modal.getByPlaceholder('e.g. John Doe').fill(name);
  await modal.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(modal).toHaveCount(0);

  // Search the new record and confirm it appears.
  await page.getByPlaceholder('Search by name, employee ID or email...').fill(name);
  const row = page.locator('tr', { hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText('active', { ignoreCase: true });

  // Delete it again (soft delete) to keep data clean.
  await row.locator('.icon-btn-danger').click();
  await expect(page.getByText('Delete Employee')).toBeVisible();
  await page.locator('.modal-overlay').getByRole('button', { name: 'Delete' }).click();
  await page.getByPlaceholder('Search by name, employee ID or email...').fill('');
  await expect(page.locator('tr', { hasText: name })).toHaveCount(0);
});
