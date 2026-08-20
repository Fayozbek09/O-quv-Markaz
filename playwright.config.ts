import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the production build on a dedicated port and a
 * dedicated database, so they never touch development data.
 */
const PORT = 3222;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx dotenv-cli -e .env.e2e -- next start -p ${PORT}`,
    url: `${BASE_URL}/login`,
    // Always start fresh: a reused server may hold the previous build.
    reuseExistingServer: false,
    timeout: 120_000,
    env: { APP_URL: BASE_URL },
  },
});
