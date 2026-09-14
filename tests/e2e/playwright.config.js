import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const port = 4174;
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --config tests/e2e/vite.config.js --port ${port} --strictPort`,
    cwd: repoRoot,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Pinned to the Chromium build preinstalled in this repo's CI/dev image
        // (see PLAYWRIGHT_BROWSERS_PATH) instead of the version @playwright/test
        // would otherwise try to download.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],
});
