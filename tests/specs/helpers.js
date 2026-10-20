const fs = require('fs');
const path = require('path');
const base = require('@playwright/test');

// The version the site in this repo should show, read from the built bundle.
function siteVersion() {
  const dir = path.join(__dirname, '..', '..', 'site', 'assets');
  for (const f of fs.readdirSync(dir)) {
    const m = fs.readFileSync(path.join(dir, f), 'utf8').match(/\bei="(\d+\.\d+)"/);
    if (m) return m[1];
  }
  throw new Error('version string not found in site/assets');
}

// Every test fails if the page throws a JavaScript error.
const test = base.test.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await use(page);
    base.expect(errors, 'שגיאות JavaScript בדף').toEqual([]);
  },
});

// Opens the demo (fake data kept in this browser only) as a supplier or a store.
async function openDemo(page, role, hash = '') {
  // try: the script also runs on about:blank, where sessionStorage is off limits.
  // Sets the role once per openDemo call, so a reload after the demo's own role switcher keeps the new role.
  await page.addInitScript(r => {
    try { if (sessionStorage.getItem('demo_init') !== r) { sessionStorage.setItem('demo_role', r); sessionStorage.setItem('demo_init', r); } } catch {}
  }, role);
  await page.goto('/?demo' + (hash ? '#/' + hash : ''));
  await base.expect(page.locator('.demo-bar')).toBeVisible();
}

// Blocks every call to the real server, recording the ones that were attempted.
async function blockServer(page) {
  const calls = [];
  await page.route(/supabase\.co/, r => {
    calls.push(r.request().url());
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return calls;
}

const shekels = s => Number(String(s).replace(/[^\d.]/g, ''));
const isPhone = testInfo => testInfo.project.name === 'טלפון';

module.exports = { test, expect: base.expect, siteVersion, openDemo, blockServer, shekels, isPhone };
