import { expect, test } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByPlaceholder('Enter your username').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('Admin@12345');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.locator('nav.sidebar-nav')).toBeVisible();
}

test('Employee Performance page loads data without NetworkError', async ({ page }) => {
  await login(page);
  await page.goto('/hr/performance');

  await expect(page.getByText('Track performance reviews, scores and evaluator notes.')).toBeVisible();
  await expect(page.getByText('Total Reviews')).toBeVisible();
  await expect(page.getByText('Average Score')).toBeVisible();

  // The error panel with Retry must NOT appear when the API is healthy.
  await expect(page.getByText('Unable to load employee performance records.')).toHaveCount(0);

  // Records render in the table (2 seeded records exist).
  await expect(page.locator('.report-table-scroll tbody tr')).toHaveCount(2);
});
test('Employee Performance create then delete a record', async ({ page }) => {
  const evaluator = `PW ${Date.now()}`;

  await login(page);
  await page.goto('/hr/performance');

  await expect(page.getByText('Track performance reviews, scores and evaluator notes.')).toBeVisible();

  await page.getByRole('button', { name: '+ New Performance Record' }).click();
  const modal = page.locator('.modal-overlay');
  await expect(modal.getByText('New Performance Record', { exact: true })).toBeVisible();

  // First employee is pre-selected; fill evaluator + date + criterion.
  const group = (label: string) => modal.getByText(label, { exact: false }).locator('..');
  await group('Evaluation Date').locator('input').fill('2026-08-16');
  await group('Evaluator').locator('input').fill(evaluator);
  await modal.getByPlaceholder('e.g. Teamwork').fill('Communication');
  await modal.getByRole('button', { name: 'Create', exact: true }).click();

  // Record should appear in the list.
  const row = page.locator('tr', { hasText: evaluator });
  await expect(row).toBeVisible();

  // Delete it again to keep data clean.
  await row.locator('.icon-btn-danger').click();
  await expect(page.getByText('Delete Performance Record')).toBeVisible();
  await page.locator('.modal-overlay').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('tr', { hasText: evaluator })).toHaveCount(0);
});
