import { chromium } from '@playwright/test';

const base = 'http://localhost:5173';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  const responses = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 600)); });
  page.on('response', async (r) => {
    if (r.url().includes('/api/hr/employees')) {
      let body = '';
      try { body = JSON.stringify(await r.json()).slice(0, 500); } catch {}
      responses.push(`${r.request().method()} ${r.url().replace(base, '').split('?')[0]} -> ${r.status()} ${body}`);
    }
  });

  await page.goto(base + '/');
  await page.getByPlaceholder('Enter your username').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('Admin@12345');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.locator('nav.sidebar-nav').waitFor({ state: 'visible', timeout: 15000 });

  await page.goto(base + '/hr/employees');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '+ New Employee' }).click();
  const modal = page.locator('.modal-overlay');
  await modal.waitFor({ state: 'visible' });

  const group = (label) => modal.getByText(label, { exact: false }).last().locator('..');

  const name = `Repro ${Date.now()}`;
  await modal.getByPlaceholder('e.g. John Doe').fill(name);
  await group('Email').locator('input').fill('repro@test.local');
  await group('Mobile').locator('input').fill('01711111111');
  await group('Gender').locator('select').selectOption({ label: 'Male' });
  await group('Marital Status').locator('select').selectOption({ label: 'Married' });
  await group('Blood Group').locator('select').selectOption({ label: 'B+' });
  await group('Contract Type').locator('select').selectOption({ label: 'Permanent' });
  await group('Joining Date').locator('input').fill('2026-01-15');
  await group('Contract End Date').locator('input').fill('2027-01-15');
  await group('Date of Birth').locator('input').fill('2001-05-31');
  await group('Department').locator('select').selectOption({ index: 1 });
  await group('Sub Department').locator('select').selectOption({ index: 1 });
  await group('Position').locator('select').selectOption({ index: 1 });
  await group('Employee Type').locator('select').selectOption({ index: 1 });
  await group('Setup Rule').locator('select').selectOption({ index: 1 });

  await modal.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForTimeout(2500);

  console.log('=== responses ===');
  for (const r of responses) console.log(r);
  console.log('=== console errors ===');
  console.log(consoleErrors.join('\n---\n'));
  const modalText = await modal.innerText().catch(() => '');
  console.log('=== modal text ===');
  console.log(modalText.slice(0, 600));
  await browser.close();
})();
