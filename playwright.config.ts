import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1280, height: 800 }, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run build && node scripts/browser-demo.ts', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
