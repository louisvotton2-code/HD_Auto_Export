import { defineConfig } from '@playwright/test';

const live = process.env.ADMIN_LIVE_TEST === '1';
if (process.env.ADMIN_LIVE_ORIGIN) throw new Error('Write tests may only run against the isolated 3319/3322 environment.');

export default defineConfig({
  testDir: './tests',
  testMatch: live ? 'live.spec.ts' : 'admin.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3319',
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm preview --port 3319',
    url: 'http://127.0.0.1:3319/admin/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
