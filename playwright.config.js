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
  projects: [
    // The app on its own (every phone keeps its data on the phone).
    { name: 'app', testIgnore: /server\.spec\.js/ },
    // The app served by the AIEC server: many phones, one shared database (fresh, in memory).
    { name: 'server', testMatch: /server\.spec\.js/, use: { baseURL: 'http://localhost:4174' } },
  ],
  webServer: [
    { command: 'node tools/serve.mjs 4173', url: 'http://localhost:4173', reuseExistingServer: true },
    {
      command: 'node server/main.mjs 4174',
      url: 'http://localhost:4174/api/info',
      reuseExistingServer: false,
      env: { AIEC_DB: ':memory:', AIEC_SECRET: 'test-secret-not-for-production' },
    },
  ],
});
