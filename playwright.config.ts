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
    /*
     * `prepare-e2e` builds first, in the same command, and this matters: the
     * web server is started before globalSetup runs, so a rebuild done in
     * globalSetup lands in .next *after* `next start` has already read it. The
     * script existed for this and was never wired up, which is why a CSS change
     * could be tested against the previous build and pass.
     */
    command: `npx tsx scripts/prepare-e2e.ts && npx dotenv-cli -e .env.e2e -- next start -p ${PORT}`,
    url: `${BASE_URL}/login`,
    // Always start fresh: a reused server may hold the previous build.
    reuseExistingServer: false,
    timeout: 240_000,
    env: { APP_URL: BASE_URL },
  },
});
