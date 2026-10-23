// Renders the PNG app icons from the SVGs (dev only): node tools/make-icons.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const jobs = [['icons/logo.svg', 'icons/icon-192.png', 192], ['icons/logo.svg', 'icons/icon-512.png', 512], ['icons/maskable.svg', 'icons/icon-maskable-512.png', 512]];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out, size] of jobs) {
  const svg = fs.readFileSync(src, 'utf8').replace(/width="96" height="96"/, `width="${size}" height="${size}"`);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.locator('svg').screenshot({ path: out, omitBackground: true });
}
await browser.close();
