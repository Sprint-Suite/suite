import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, 'tests', 'e2e', '.data');
const BASE = 'http://127.0.0.1:3067';

// Workers re-load this file; only the runner may reset the data dir.
if (!process.env.TEST_WORKER_INDEX) {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 30 * 1000,
  use: { baseURL: BASE, headless: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'node server.js',
    url: `${BASE}/healthz`,
    reuseExistingServer: false,
    env: {
      PORT: '3067',
      NODE_ENV: 'production',
      BASE_URL: BASE,
      DB_PATH: path.join(dataDir, 'hub.db'),
      RESEND_API_KEY: 're_test',
      RESEND_BASE_URL: 'http://127.0.0.1:9',
      FROM_EMAIL: 'hub@e2e.test',
      COOKIE_SECRET: 'e2e-cookie-secret',
      ALLOWED_APP_DOMAINS: BASE,
      HUB_API_KEY_RAID: 'test-raid',
      HUB_API_KEY_SIGNAL: 'test-signal',
      HUB_API_KEY_RETRO: 'test-retro',
      HUB_API_KEY_POKER: 'test-poker',
      HUB_API_KEY_PLAN: 'test-plan',
      GA_MEASUREMENT_ID: 'G-TEST',
      LOG_LEVEL: 'warn',
    },
  },
});
