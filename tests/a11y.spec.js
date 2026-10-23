// Phase 9 – accessibility: every visible control has a name, every image an alt, every input a
// label, and all text meets contrast ≥ 4.5:1 (3:1 for large text) – on key screens of every role,
// in the default theme and the outdoor (sunlight) and dark themes.
import { test, expect } from '@playwright/test';
import { startDemo } from './helpers.js';
import { auditPage } from './audit.js';

const SCREENS = [
  ['u_r1', '/#/today'], ['u_r1', '/#/money'], ['u_c1', '/#/project/p0009'], ['u_sr1', '/#/project/p0009'],
  ['u_qc2', '/#/today'], ['u_s1', '/#/today'], ['u_admin', '/#/today'], ['u_admin', '/#/payouts'], ['u_admin', '/#/rules'],
  ['u_owner', '/#/today'], ['u_app1', '/#/today'], ['u_neg', '/#/today'], ['u_tech1', '/#/me'], ['u_c1', '/#/chat/p0009/main'],
];

for (const theme of ['light-glass', 'outdoor', 'dark']) {
  test(`a11y: names, labels, alt text and contrast – ${theme}`, async ({ page }) => {
    test.setTimeout(120000);
    const all = [];
    let first = true;
    for (const [who, route] of SCREENS) {
      if (first) {
        await startDemo(page, who); first = false;
        await page.evaluate(async (th) => (await import('/js/theme.js')).setTheme(th), theme);
      } else await page.evaluate(async (id) => (await import('/js/api.js')).demoLogin(id), who);
      await page.goto(route);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
      await page.waitForTimeout(500);
      const problems = await page.evaluate(`(${auditPage.toString()})()`);
      all.push(...problems.map((p) => `${who} ${route}: ${p}`));
    }
    expect(all, all.join('\n')).toEqual([]);
  });
}

test('a11y: public screens (welcome, login, join, resident form)', async ({ page }) => {
  const all = [];
  await page.goto('/');
  await page.waitForTimeout(400);
  all.push(...(await page.evaluate(`(${auditPage.toString()})()`)).map((p) => `welcome: ${p}`));
  await page.getByTestId('start-demo').click();
  await page.waitForTimeout(400);
  all.push(...(await page.evaluate(`(${auditPage.toString()})()`)).map((p) => `login: ${p}`));
  for (const r of ['/#/join', '/#/amc/p0012']) {
    await page.goto(r);
    await page.waitForTimeout(400);
    all.push(...(await page.evaluate(`(${auditPage.toString()})()`)).map((p) => `${r}: ${p}`));
  }
  expect(all, all.join('\n')).toEqual([]);
});
