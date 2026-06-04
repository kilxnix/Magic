import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.DECKREPS_E2E_BASE_URL || 'https://deckreps.app';
const browserChannel = process.env.PLAYWRIGHT_CHANNEL || 'chrome';

export default defineConfig({
  testDir: './e2e',
  workers: Number(process.env.PLAYWRIGHT_WORKERS || 1),
  timeout: 180_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    channel: browserChannel,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: browserChannel,
      },
    },
  ],
});
