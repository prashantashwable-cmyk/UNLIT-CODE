// Phase 9 – low-end Android: Chrome CPU throttled 4× and "slow 3G" (400 ms latency, 500 kbit/s).
// First visit must show the welcome screen quickly; once installed (service worker cache) the app
// must open to Today fast even with the slow network.
import { test, expect } from '@playwright/test';

const SLOW_3G = { offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 };

async function throttle(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', SLOW_3G);
  return cdp;
}

test('first visit on slow 3G + 4× CPU: welcome screen fast, only what it needs is downloaded', async ({ page }) => {
  test.setTimeout(120000);
  await throttle(page);
  const bytes = [];
  page.on('requestfinished', async (rq) => { const s = await rq.sizes().catch(() => null); bytes.push({ url: rq.url(), n: (s?.responseBodySize || 0) + (s?.responseHeadersSize || 0) }); });
  const t0 = Date.now();
  await page.goto('/');
  await expect(page.getByTestId('start-demo')).toBeVisible({ timeout: 60000 });
  const ms = Date.now() - t0;
  const kb = Math.round(bytes.filter((b) => !b.url.includes('/vendor/') || b.url.includes('/fonts/')).reduce((s, b) => s + b.n, 0) / 1024);
  console.log(`first paint of welcome: ${ms} ms, ${kb} KB transferred before the background cache`);
  expect(ms).toBeLessThan(5000);
  expect(kb).toBeLessThan(250);
});

test('installed app (service worker) on slow 3G + 4× CPU opens to Today fast', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Let the service worker finish its precache, then the user logs in once.
  await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('shell-')) && (await (await caches.open((await caches.keys()).find((k) => k.startsWith('shell-')))).keys()).length > 50, null, { timeout: 120000 });
  await page.getByTestId('start-demo').click();
  await page.getByTestId('demo-user-u_sr1').click();
  await expect(page.getByTestId('tab-today')).toBeVisible();
  await throttle(page);
  const t0 = Date.now();
  await page.reload();
  await expect(page.getByTestId('next-step')).toBeVisible({ timeout: 60000 });
  const today = Date.now() - t0;
  const t1 = Date.now();
  await page.getByTestId('tab-money').click();
  await expect(page.getByTestId('money-total')).toBeVisible({ timeout: 30000 });
  const money = Date.now() - t1;
  const t2 = Date.now();
  await page.goto('/#/project/p0009');
  await expect(page.getByTestId('install-panel')).toBeVisible({ timeout: 30000 });
  const project = Date.now() - t2;
  console.log(`installed: Today ${today} ms, Money tab ${money} ms, project ${project} ms`);
  expect(today).toBeLessThan(6000);
  expect(money).toBeLessThan(3000);
  expect(project).toBeLessThan(4000);
});
