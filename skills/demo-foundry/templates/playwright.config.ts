import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './demo/demos',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { outputFolder: 'demo/output/playwright-report' }], ['list']],
  use: {
    baseURL: process.env.DEMO_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
