// Language toggle changes 100% of visible text: no raw keys, no stray English words.
import { test, expect } from '@playwright/test';
import { startDemo, watchErrors } from './helpers.js';

// Latin words allowed inside Marathi/Hindi screens: brand, codes and common acronyms.
const ALLOWED = new Set(['AIEC', 'PUN', 'QC', 'GPS', 'AMC', 'EMI', 'NOC', 'KYC', 'SMS', 'OTP', 'PIN', 'WhatsApp', 'Manager', 'OpenStreetMap', 'Leaflet', 'EP', 'LIC', 'CNT', 'UTC', 'IST', 'English']);

async function strayWords(page) {
  const text = await page.locator('#app').innerText();
  expect(text).not.toContain('⟦');
  return [...new Set((text.match(/[A-Za-z]{2,}/g) || []).filter((w) => !ALLOWED.has(w)))];
}

for (const lang of ['mr', 'hi']) {
  for (const id of ['u_r1', 'u_tech1', 'u_c1', 'u_admin', 'u_owner', 'u_s1', 'u_qc1', 'u_app1', 'u_neg']) {
    test(`${lang}: every tab fully translated for ${id}`, async ({ page }) => {
      const errors = watchErrors(page);
      await startDemo(page, id, { lang });
      const stray = { today: await strayWords(page) };
      const tabs = ['map', 'chat', 'money', 'me'];
      if (['u_admin', 'u_owner'].includes(id)) tabs.push('reports');
      for (const tab of tabs) {
        await page.getByTestId(`tab-${tab}`).click();
        await page.waitForTimeout(300);
        stray[tab] = await strayWords(page);
      }
      await page.getByTestId('tab-today').click();
      const card = page.locator('.project-card').first();
      if (await card.count()) {
        await card.click();
        await expect(page.getByTestId('gate')).toBeVisible();
        stray.project = await strayWords(page);
      }
      for (const [k, v] of Object.entries(stray)) expect(v, `${lang} ${id} ${k}`).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test('globe button cycles English → मराठी → हिंदी on the same screen', async ({ page }) => {
  await startDemo(page, 'u_r1');
  await expect(page.getByTestId('tab-today')).toContainText('Today');
  await page.locator('.lang-btn').click();
  await expect(page.getByTestId('tab-today')).toContainText('आज');
  await expect(page.getByTestId('next-step')).toContainText('पुढचे काम');
  await page.locator('.lang-btn').click();
  await expect(page.getByTestId('next-step')).toContainText('अगला काम');
  expect(await strayWords(page)).toEqual([]);
});
