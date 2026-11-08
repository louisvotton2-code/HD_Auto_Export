import { defineConfig } from '@playwright/test';

const externalBaseURL = process.env.E2E_BASE_URL;
const fixtureOrigin = 'http://127.0.0.1:3327';
if (!externalBaseURL) process.env.PUBLIC_FIXTURE_API_URL = fixtureOrigin;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: externalBaseURL || 'http://127.0.0.1:3100',
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: externalBaseURL
    ? undefined
    : [
        {
          command: 'node tests/fixtures/public-api.mjs --port 3327',
          url: `${fixtureOrigin}/__fixtures/health`,
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          command: 'pnpm preview --port 3100',
          url: 'http://127.0.0.1:3100',
          env: { VEHICLE_API_BASE_URL: fixtureOrigin },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
