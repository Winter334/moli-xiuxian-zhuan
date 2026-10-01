import { defineConfig, devices } from '@playwright/test';

const testDatabase = process.env.TEST_DATABASE_URL
  ?? 'postgres://moli_test:moli_test_only@127.0.0.1:54329/moli_test';
const parsed = new URL(testDatabase);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/moli_test') {
  throw new Error('E2E requires the isolated local moli_test database.');
}
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    {
      command: 'node --import tsx server/main.ts',
      url: 'http://127.0.0.1:3002/api/health',
      env: { DATABASE_URL: testDatabase, API_PORT: '3002', DEV_AUTH: 'true', NODE_ENV: 'test' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'node node_modules/vite/bin/vite.js',
      url: 'http://127.0.0.1:5174',
      env: { API_PORT: '3002', WEB_PORT: '5174' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
