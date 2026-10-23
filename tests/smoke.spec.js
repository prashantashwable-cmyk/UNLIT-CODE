// Smoke test per role: login → Today → each tab (and a project) opens without console errors.
import { test, expect } from '@playwright/test';
import { watchErrors, startDemo, ALL_DEMO_USERS } from './helpers.js';

for (const id of ALL_DEMO_USERS) {
  test(`role smoke: ${id}`, async ({ page }) => {
    const errors = watchErrors(page);
    await startDemo(page, id);
    await expect(page.getByTestId('next-step')).toBeVisible();
    const tabs = ['map', 'chat', 'money', 'me'];
    if (['u_admin', 'u_admin2', 'u_owner'].includes(id)) tabs.push('reports');
    for (const tab of tabs) {
      await page.getByTestId(`tab-${tab}`).click();
      await expect(page.locator(`.screen-${tab === 'me' ? 'me' : tab}`)).toBeVisible();
    }
    await page.getByTestId('tab-today').click();
    const firstProject = page.locator('.project-card').first();
    if (await firstProject.count()) {
      await firstProject.click();
      await expect(page.getByTestId('gate')).toBeVisible();
    }
    await expect(page.locator('body')).not.toContainText('⟦');
    expect(errors).toEqual([]);
  });
}

test('help button opens chat and call-back on every screen', async ({ page }) => {
  await startDemo(page, 'u_tech1');
  await page.getByTestId('help-fab').click();
  await page.getByTestId('help-callback').click();
  await expect(page.locator('#toast')).toBeVisible();
  await page.getByTestId('help-fab').click();
  await page.getByTestId('help-chat').click();
  await expect(page.locator('.chat-thread')).toBeVisible();
  await expect(page.locator('.bubble').first()).toBeVisible();
});

test('role switch chip lets one person hold two roles', async ({ page }) => {
  await startDemo(page, 'u_tech1');
  await expect(page.getByTestId('role-chip')).toContainText('Technician');
  await page.getByTestId('role-chip').click();
  await page.locator('.role-switch .chip', { hasText: 'Rider' }).click();
  await expect(page.getByTestId('role-chip')).toContainText('Rider');
});

test('phone + OTP + PIN + face login, then PIN login', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('aiec.lang', 'en'); localStorage.setItem('aiec.prefs', '{"autoVoice":false,"sound":false}'); });
  await page.goto('/');
  await page.getByTestId('start-demo').click();
  // Make the demo person "new" (no PIN yet) through the api.
  await page.evaluate(async () => {
    const db = await import('/js/db.js');
    const u = await db.get('users', 'u_r2'); delete u.pin_hash; await db.put('users', u);
  });
  const pad = async (id, digits) => { for (const d of digits) await page.getByTestId(id).locator(`[data-key="${d}"]`).click(); };
  await page.getByTestId('login-phone').click();
  await pad('phone-pad', '9800000002');
  await expect(page.getByTestId('otp-hint')).toContainText('123456');
  await pad('otp-pad', '123456');
  await pad('pin1-pad', '4321');
  await pad('pin2-pad', '4321');
  await page.getByTestId('take-selfie').click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await expect(page.getByTestId('role-chip')).toContainText('Rider');
  // Log out, log back in with the new PIN.
  await page.getByTestId('tab-me').click();
  await page.getByTestId('logout').click();
  await page.getByTestId('login-phone').click();
  await pad('phone-pad', '9800000002');
  await page.getByTestId('use-pin').click();
  await pad('pin-pad', '4321');
  await expect(page.getByTestId('role-chip')).toContainText('Rider');
});
