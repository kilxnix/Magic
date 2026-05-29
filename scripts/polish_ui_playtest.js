#!/usr/bin/env node
/*
 * Cross-cutting polish verification: recovery affordances, diagnostics, request
 * IDs, mobile overflow, and safe ops status.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findPlaywrightPackage() {
  try {
    return require('playwright');
  } catch {
    // Search the npx cache used by the other UI playtests.
  }
  const candidates = [
    process.env.PLAYWRIGHT_NODE_MODULES,
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
  ].filter(Boolean);
  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      const packageJson = path.join(current, 'node_modules', 'playwright', 'package.json');
      if (fs.existsSync(packageJson)) return require(path.join(current, 'node_modules', 'playwright'));
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) stack.push(path.join(current, entry.name));
      }
    }
  }
  throw new Error('Playwright is not importable. Run `npx playwright --version` once or install Playwright.');
}

const { chromium } = findPlaywrightPackage();

const BASE_URL = (process.env.DECKREPS_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const HEADLESS = process.env.HEADLESS !== '0';
const ARTIFACT_DIR = path.resolve(process.env.UI_PLAYTEST_ARTIFACT_DIR || 'playtest-artifacts/polish');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
fs.mkdirSync(path.join(ARTIFACT_DIR, RUN_ID), { recursive: true });

function artifact(name) {
  return path.join(ARTIFACT_DIR, RUN_ID, name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function screenshot(page, name) {
  await page.screenshot({ path: artifact(name), fullPage: false });
}

async function apiJson(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    requestId: response.headers.get('x-request-id'),
    body: text ? JSON.parse(text) : null,
  };
}

async function dismissOverlays(page) {
  for (const name of ['Decline Ads', 'Allow Ads', 'Dismiss', 'Close']) {
    const button = page.getByRole('button', { name, exact: true });
    if ((await button.count()) > 0 && (await button.first().isVisible().catch(() => false))) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(200);
    }
  }
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();

  try {
    const ops = await apiJson('/api/ops/status');
    assert(ops.ok && ops.body.status === 'ok', 'ops status is not healthy');

    const event = await apiJson('/api/ops/client-events', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'recovery',
        severity: 'info',
        message: 'Polish UI playtest diagnostic event',
        page: '/polish-ui-playtest?token=hidden',
        details: { surface: 'playtest', password: 'must-redact' },
      }),
    });
    assert(event.ok && event.body.ok === true, 'client diagnostic event was not accepted');
    assert(event.requestId, 'client diagnostic response is missing X-Request-ID');

    const missing = await apiJson('/api/multiplayer/rooms/not-a-real-room');
    assert(missing.status === 404, 'missing room should return 404');
    assert(missing.requestId, 'error response is missing X-Request-ID');

    await page.goto(`${BASE_URL}/events?polishqa=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await page.waitForLoadState('load');
    await page.keyboard.press('Tab');
    await page.getByText('Skip to main content').waitFor({ timeout: 5000 });
    await screenshot(page, 'desktop-events-polish.png');

    await context.setOffline(true);
    await page.getByText('Offline. Actions will retry after the connection returns.').waitFor({ timeout: 8000 });
    await screenshot(page, 'offline-recovery-banner.png');
    await context.setOffline(false);
    await page.locator('div').filter({ hasText: /^Connection restored\.$/ }).last().waitFor({ timeout: 8000 });

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const mobile = await mobileContext.newPage();
    await mobile.goto(`${BASE_URL}/multiplayer?polishmobile=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(mobile);
    await mobile.waitForLoadState('load');
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 4, `mobile multiplayer page has horizontal overflow of ${overflow}px`);
    await screenshot(mobile, 'mobile-multiplayer-polish.png');
    await mobileContext.close();

    console.log(`Polish UI playtest passed. Artifacts: ${path.join(ARTIFACT_DIR, RUN_ID)}`);
  } finally {
    await context.setOffline(false).catch(() => {});
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
