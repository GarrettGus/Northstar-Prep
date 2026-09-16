import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { baseURL } from './app/support/environment.js';

// The full-app suite: the real React app, the real /api handlers and a disposable Postgres
// database, driven end to end. globalSetup owns the database and the server (rather than
// Playwright's `webServer`) because the database has to exist and be migrated first.
//
// One household means one shared source of truth, so specs run serially and each resets the
// household before it starts; `npm run test:e2e` stays the fast, database-free a11y suite.
export default defineConfig({
  testDir: './app/specs',
  globalSetup: fileURLToPath(new URL('./app/globalSetup.js', import.meta.url)),
  globalTeardown: fileURLToPath(new URL('./app/globalTeardown.js', import.meta.url)),
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Pinned to the Chromium build preinstalled in this repo's CI/dev image, matching
        // tests/e2e/playwright.config.js.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],
});
