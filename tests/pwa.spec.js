// Installable PWA + works offline after first load.
import { test, expect } from '@playwright/test';

test('manifest and service worker make the app installable', async ({ page, context }) => {
  await page.goto('/');
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).active);
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.display_override).toEqual(['fullscreen', 'standalone']);
  expect(manifest.orientation).toBe('portrait');
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
});

test('works offline after the first load', async ({ page, context }) => {
  await page.addInitScript(() => { localStorage.setItem('aiec.lang', 'en'); localStorage.setItem('aiec.prefs', '{"autoVoice":false}'); });
  await page.goto('/');
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).active);
  // Make sure every shell file is in the cache.
  await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('shell-')));
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await page.getByTestId('start-demo').click();
  await page.getByTestId('demo-user-u_tech1').click();
  for (const tab of ['chat', 'money', 'me', 'today']) await page.getByTestId(`tab-${tab}`).click();
  await page.locator('.project-card').first().click();
  await expect(page.getByTestId('gate')).toBeVisible();
  await expect(page.getByTestId('offline-badge')).toBeVisible();
});

test('real mode outside the installed app shows the install screen', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('aiec.lang', 'en'); localStorage.setItem('aiec.prefs', '{"autoVoice":false}'); });
  await page.goto('/');
  await page.getByTestId('start-real').click();
  await expect(page.locator('.install-screen')).toBeVisible();
  await expect(page.locator('.pic-step')).toHaveCount(6);
  await page.goto('/#/today');
  await expect(page.locator('.install-screen')).toBeVisible();
});
