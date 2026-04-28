import { test, expect } from '@playwright/test';
import path from 'node:path';

const DEMO_ID = process.env.DEMO_ID ?? 'example-demo';
const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://localhost:3000';
const OUT_DIR = path.join(process.cwd(), 'demo', 'demos', DEMO_ID, 'output');

test.describe(`Demo Foundry capture: ${DEMO_ID}`, () => {
  test.use({
    viewport: { width: 1440, height: 1000 },
    timezoneId: 'America/New_York',
    video: 'on',
    trace: 'retain-on-failure',
  });

  test('captures opening dashboard', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveTitle(/.*/);

    // Prefer stable test IDs in real projects:
    // await expect(page.getByTestId('dashboard-root')).toBeVisible();

    await page.screenshot({
      path: path.join(OUT_DIR, 'screenshots', 'scene-01-dashboard.png'),
      fullPage: true,
    });
  });
});
