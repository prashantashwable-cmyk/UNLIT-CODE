// Screenshot pass: key screens for every role at phone (360), tablet (768) and desktop (1280) width.
// Each shot fails the test on sideways scroll or a raw translation key. Pictures go to
// screenshots/latest/, and contact-sheet.png puts them all on one page for a quick visual review.
// Run: npx playwright test tests/screens.spec.js
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { startDemo, api, watchErrors } from './helpers.js';

const OUT = path.resolve('screenshots/latest');
const WIDTHS = { phone: { width: 360, height: 780 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1280, height: 860 } };

// [file name, demo person or null (public), route]
const SHOTS = [
  ['login', null, '/'],
  ['join', null, '/#/join'],
  ['amc-resident', null, '/#/amc/p0012'],
  ['rider-today', 'u_r1', '/#/today'],
  ['rider-map', 'u_r1', '/#/map'],
  ['rider-money', 'u_r1', '/#/money'],
  ['negotiator-desk', 'u_neg', '/#/today'],
  ['customer-today', 'u_c1', '/#/today'],
  ['customer-project', 'u_c1', '/#/project/p0009'],
  ['customer-amc', 'u_c2', '/#/project/p0012'],
  ['tech-today', 'u_sr1', '/#/today'],
  ['tech-install', 'u_sr1', '/#/project/p0009'],
  ['tech-container', 'u_tech1', '/#/project/p0008'],
  ['trainee-me', 'u_t1', '/#/me'],
  ['qc-today', 'u_qc2', '/#/today'],
  ['qc-surprise', 'u_qc2', '/#/project/p0011'],
  ['supplier-today', 'u_s1', '/#/today'],
  ['nbfc-today', 'u_nbfc', '/#/today'],
  ['applicant-today', 'u_app1', '/#/today'],
  ['admin-today', 'u_admin', '/#/today'],
  ['admin-map', 'u_admin', '/#/map'],
  ['admin-payouts', 'u_admin', '/#/payouts'],
  ['admin-rules', 'u_admin', '/#/rules'],
  ['admin-reports', 'u_admin', '/#/reports'],
  ['admin-project', 'u_admin', '/#/project/p0010'],
  ['owner-today', 'u_owner', '/#/today'],
  ['chat', 'u_c1', '/#/chat/p0009/main'],
];
// Tablet and desktop: the screens with the most layout.
const WIDE = new Set(['login', 'admin-today', 'admin-map', 'admin-reports', 'tech-install', 'owner-today', 'customer-project', 'join']);

fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ mode: 'serial' });

for (const [name, who, route] of SHOTS) {
  for (const [size, vp] of Object.entries(WIDTHS)) {
    if (size !== 'phone' && !WIDE.has(name)) continue;
    test(`screen ${name} @ ${size}`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.setViewportSize(vp);
      await page.addInitScript(() => localStorage.setItem('aiec.aiMode', 'pass'));
      if (who) {
        await startDemo(page, who);
        await page.goto(route);
      } else {
        await page.addInitScript(() => {
          if (!sessionStorage.getItem('shot')) { sessionStorage.setItem('shot', '1'); localStorage.setItem('aiec.lang', 'en'); localStorage.setItem('aiec.prefs', JSON.stringify({ autoVoice: false, sound: false })); }
        });
        await page.goto('/');
        await page.getByTestId('start-demo').click();
        if (route !== '/') await page.goto(route);
      }
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(400);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const text = await page.locator('#app').innerText();
      await page.screenshot({ path: path.join(OUT, `${name}@${size}.png`), fullPage: size === 'phone' });
      expect(sideways, `${name} @ ${size} scrolls sideways`).toBeLessThanOrEqual(1);
      expect(text, `${name} @ ${size} shows a raw key`).not.toContain('⟦');
      expect(errors, `${name} @ ${size}`).toEqual([]);
    });
  }
}

// One page with every phone shot (top part) – look at this after each change.
test('contact sheet', async ({ page }) => {
  const files = fs.readdirSync(OUT).filter((f) => f.endsWith('@phone.png')).sort();
  const imgs = files.map((f) => `<figure><img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, f)).toString('base64')}"><figcaption>${f.replace('@phone.png', '')}</figcaption></figure>`).join('');
  await page.setViewportSize({ width: 1800, height: 1200 });
  await page.setContent(`<style>body{margin:8px;font:12px sans-serif;background:#ddd}main{display:grid;grid-template-columns:repeat(9,1fr);gap:6px}
    figure{margin:0;background:#fff}img{width:100%;height:420px;object-fit:cover;object-position:top;display:block}figcaption{padding:2px 4px}</style><main>${imgs}</main>`);
  await page.screenshot({ path: path.join(OUT, 'contact-sheet.png'), fullPage: true });
  expect(files.length).toBeGreaterThan(20);
});
