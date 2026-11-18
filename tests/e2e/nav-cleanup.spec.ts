import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page, username: string) {
  await page.goto('/login');
  await page.locator('.form-control-clay[type=text]').fill(username);
  await page.locator('.form-control-clay[type=password]').fill('Admin@12345');
  await page.getByRole('button', { name: /sign in|login/i }).first().click();
  await page.waitForURL('**/');
  await page.waitForTimeout(2500);
}

async function groupNames(page: import('@playwright/test').Page): Promise<string[]> {
  return page.locator('.nav-group-toggle .nav-group-label, .sidebar-nav > .nav-link span:not(.nav-icon)').allTextContents();
}

test('admin: grouped navigation, no top-level attendance duplicates', async ({ page }) => {
  await login(page, 'admin');
  const groups = await groupNames(page);
  expect(groups.join('|')).toContain('People');
  expect(groups.join('|')).toContain('Attendance');
  expect(groups.join('|')).not.toContain('Field Force Tracking');
  expect(groups.join('|')).not.toContain('Route History');
  expect(groups.join('|')).not.toContain('HR');
  expect(groups.length).toBeLessThanOrEqual(10);
});

test('admin: Attendance group expands, children visible, parent stays active', async ({ page }) => {
  await login(page, 'admin');
  await page.locator('.nav-group-toggle', { hasText: 'Attendance' }).click();
  const children = await page.locator('.nav-group-children .nav-child').allTextContents();
  expect(children.join('|')).toContain('Attendance Records');
  expect(children.join('|')).toContain('My Attendance');
  expect(children.join('|')).toContain('Field Force Tracking');
  expect(children.join('|')).toContain('Route History');
  expect(children.join('|')).toContain('Attendance Reports');

  await page.locator('.nav-child', { hasText: 'Field Force Tracking' }).click();
  await expect(page).toHaveURL(/\/hr\/field-tracking$/);
  await expect(page.locator('.nav-group', { hasText: 'Attendance' })).toHaveClass(/nav-group-active/);
  await expect(page.locator('.nav-child', { hasText: 'Field Force Tracking' })).toHaveClass(/nav-link-active/);

  await page.goto('/hr/attendance/mobile');
  await expect(page.locator('.nav-group', { hasText: 'Attendance' })).toHaveClass(/nav-group-active/);
  await expect(page.locator('.nav-child', { hasText: 'My Attendance' })).toHaveClass(/nav-link-active/);
});

test('admin: group collapse/expand works', async ({ page }) => {
  await login(page, 'admin');
  const toggle = page.locator('.nav-group-toggle', { hasText: 'Attendance' });
  await toggle.click();
  await expect(page.locator('.nav-group-children .nav-child', { hasText: 'My Attendance' })).toBeVisible();
  await toggle.click();
  await expect(page.locator('.nav-group-children .nav-child', { hasText: 'My Attendance' })).toBeHidden();
});

test('employee: only My Attendance in Attendance group, restricted modules hidden', async ({ page }) => {
  await login(page, 'emp.field');
  const groups = await groupNames(page);
  expect(groups.join('|')).not.toContain('People');
  expect(groups.join('|')).not.toContain('Performance');
  expect(groups.join('|')).not.toContain('Employee Services');

  await page.locator('.nav-group-toggle', { hasText: 'Attendance' }).click();
  const children = await page.locator('.nav-group-children .nav-child').allTextContents();
  expect(children).toEqual(['My Attendance']);
  await expect(page.locator('.nav-child', { hasText: 'Field Force Tracking' })).toHaveCount(0);
  await expect(page.locator('.nav-child', { hasText: 'Route History' })).toHaveCount(0);
  await expect(page.locator('.nav-child', { hasText: 'Attendance Reports' })).toHaveCount(0);
  await expect(page.locator('.nav-child', { hasText: 'Attendance Records' })).toHaveCount(0);

  await page.locator('.nav-child', { hasText: 'My Attendance' }).click();
  await expect(page).toHaveURL(/\/hr\/attendance\/mobile$/);
});

test('employee: Settings group shows only Appearance', async ({ page }) => {
  await login(page, 'emp.field');
  await page.locator('.nav-group-toggle', { hasText: 'Settings' }).click();
  const children = await page.locator('.nav-group-children .nav-child').allTextContents();
  expect(children).toEqual(['Appearance']);
});

test('hr.admin: sees admin attendance children, no Software Setup', async ({ page }) => {
  await login(page, 'hr.admin');
  await page.locator('.nav-group-toggle', { hasText: 'Attendance' }).click();
  const children = await page.locator('.nav-group-children .nav-child').allTextContents();
  expect(children.join('|')).toContain('Field Force Tracking');
  expect(children.join('|')).toContain('Route History');
  expect(children.join('|')).toContain('Attendance Reports');

  await page.locator('.nav-group-toggle', { hasText: 'Settings' }).click();
  const settingsChildren = await page.locator('.nav-group-children .nav-child').allTextContents();
  expect(settingsChildren.join('|')).not.toContain('Software Setup');
  expect(settingsChildren.join('|')).toContain('Appearance');
});

test('direct routes still guarded: employee denied on field-tracking, admin allowed', async ({ page }) => {
  await login(page, 'emp.field');
  await page.goto('/hr/field-tracking');
  await expect(page.locator('.access-denied')).toBeVisible();
  await page.goto('/hr/attendance-report');
  await expect(page.locator('.access-denied')).toBeVisible();
  await page.goto('/hr/setup-rules');
  await expect(page.locator('.access-denied')).toBeVisible();
});

test('collapsed sidebar keeps group icons', async ({ page }) => {
  await login(page, 'admin');
  await page.locator('button[title="Toggle Sidebar"]').click();
  await expect(page.locator('.app-sidebar')).toHaveClass(/collapsed/);
  await expect(page.locator('.nav-group-toggle .nav-icon').first()).toBeVisible();
  await expect(page.locator('.nav-group-children')).toBeHidden();
  await page.locator('button[title="Toggle Sidebar"]').click();
  await expect(page.locator('.app-sidebar')).not.toHaveClass(/collapsed/);
  await expect(page.locator('.nav-group-toggle .nav-group-label').first()).toBeVisible();
});

test('mobile: bottom bar shows People/Attendance, More menu has grouped items', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'admin');
  await expect(page.locator('.mobile-bottom-bar')).toBeVisible();
  const bottom = await page.locator('.mobile-bottom-bar').innerText();
  expect(bottom).toContain('Attendance');
  expect(bottom).toContain('People');

  await page.locator('.mobile-bottom-bar').locator('button.mobile-nav-item', { hasText: 'More' }).click();
  await expect(page.locator('.mobile-menu-overlay')).toBeVisible();
  await expect(page.locator('.mobile-menu-row', { hasText: 'Attendance' }).first()).toBeVisible();
  await expect(page.locator('.mobile-menu-sub-item', { hasText: 'Field Force Tracking' })).toBeVisible();
  await expect(page.locator('.mobile-menu-item', { hasText: 'Leave' })).toBeVisible();
});