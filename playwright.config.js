// Playwright (the only dev dependency). Run: npx playwright test
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  fullyParallel: false,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: 0, // a flaky test is a bug to fix, not to retry
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Pixel 5'],
    browserName: 'chromium',
    permissions: ['geolocation'],
    geolocation: { latitude: 18.5913, longitude: 73.7389 },
    serviceWorkers: 'allow',
  },
  webServer: {
    command: 'node tools/serve.mjs 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
  },
});
