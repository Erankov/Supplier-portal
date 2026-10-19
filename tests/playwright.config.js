// Runs the site's user flows on a phone and a desktop screen.
// Local/CI: serves ../site and runs everything against the built-in demo data.
// LIVE_URL=https://...: runs the same checks against the deployed site. They only use the
// demo mode and block calls to the real server, so no real data is created.
const { defineConfig, devices } = require('@playwright/test');

const live = process.env.LIVE_URL;
const chromium = process.env.CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } } : {};

module.exports = defineConfig({
  testDir: './specs',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['json', { outputFile: 'results/results.json' }]],
  use: {
    baseURL: live || 'http://localhost:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ...chromium,
  },
  outputDir: 'results/artifacts',
  projects: [
    { name: 'טלפון', use: { ...devices['iPhone 13'], browserName: 'chromium', ...chromium } },
    { name: 'מחשב', use: { viewport: { width: 1366, height: 850 }, ...chromium } },
  ],
  webServer: live ? undefined : {
    command: 'python3 -m http.server 4173 --directory ../site',
    url: 'http://localhost:4173/config.js',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
