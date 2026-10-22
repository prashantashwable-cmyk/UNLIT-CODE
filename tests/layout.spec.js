// Mobile first: no sideways scrolling at 360, 768 and 1280 px; field touch targets ≥ 64 px.
import { test, expect } from '@playwright/test';
import { startDemo } from './helpers.js';

for (const width of [360, 768, 1280]) {
  for (const id of ['u_r1', 'u_admin', 'u_c1']) {
    test(`${width}px ${id}: no horizontal overflow on any tab`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 800 } });
      const page = await ctx.newPage();
      await startDemo(page, id, { lang: 'mr' });
      const tabs = ['today', 'map', 'chat', 'money', 'me'];
      if (id === 'u_admin') tabs.push('reports');
      for (const tab of tabs) {
        await page.getByTestId(`tab-${tab}`).click();
        await page.waitForTimeout(250);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over, `${tab}`).toBeLessThanOrEqual(0);
      }
      await page.getByTestId('tab-today').click();
      await page.locator('.project-card').first().click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await ctx.close();
    });
  }
}

test('field screens: touch targets at least 64 px even at 20% scale; primary button ≥ 30% height', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem('aiec.prefs')) localStorage.setItem('aiec.prefs', '{"autoVoice":false,"scale":20}'); });
  await startDemo(page, 'u_r1');
  const primary = await page.getByTestId('start-day').boundingBox();
  expect(primary.height).toBeGreaterThanOrEqual(760 * 0.3 - 1);
  await page.getByTestId('project-p0001').click();
  const take = await page.getByTestId('capture-lead.board').boundingBox();
  expect(take.height).toBeGreaterThanOrEqual(64);
  await ctx.close();
});

test('scale slider changes --ui-scale live', async ({ page }) => {
  await startDemo(page, 'u_admin');
  await page.getByTestId('tab-me').click();
  await page.getByTestId('scale-slider').fill('130');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim())).toBe('1.3');
  await page.getByTestId('theme-outdoor').click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('outdoor');
});
