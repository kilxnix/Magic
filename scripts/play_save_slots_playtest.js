#!/usr/bin/env node
/*
 * Exercises /play save slots through the rendered UI: starter deck load,
 * game start, manual save, reload, and save-slot load.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findPlaywrightPackage() {
  try {
    return require('playwright');
  } catch {}
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
const ARTIFACT_DIR = path.resolve(process.env.UI_PLAYTEST_ARTIFACT_DIR || 'playtest-artifacts/play-saves');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
fs.mkdirSync(path.join(ARTIFACT_DIR, RUN_ID), { recursive: true });

function artifact(name) {
  return path.join(ARTIFACT_DIR, RUN_ID, name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function dismissOverlays(page) {
  for (const name of ['Decline Ads', 'Allow Ads', 'Close guided practice prompt', 'Close']) {
    const button = page.getByRole('button', { name, exact: true });
    if ((await button.count()) > 0 && (await button.first().isVisible().catch(() => false))) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(150);
    }
  }
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/play?savesqa=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await page.getByText('Game Saves', { exact: true }).waitFor({ timeout: 10000 });
    await page.getByText('Slot 1').waitFor({ timeout: 10000 });
    await page.screenshot({ path: artifact('play-save-slots-setup.png'), fullPage: false });

    await page.getByText('Green Big Creatures', { exact: true }).click();
    await page.getByText('Opponent Setup', { exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Start 1v1' }).click();
    await page.getByText('Keep', { exact: true }).waitFor({ timeout: 60000 });
    await page.getByText('Keep', { exact: true }).click();
    await page.getByRole('button', { name: 'Open game saves' }).click();
    await page.getByRole('button', { name: 'Save Here' }).first().click();
    await page.getByText('Saved slot 1').waitFor({ timeout: 10000 });
    await page.screenshot({ path: artifact('play-save-slots-game.png'), fullPage: false });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await page.getByText('Game Saves', { exact: true }).waitFor({ timeout: 10000 });
    await page.waitForFunction(() => document.body.innerText.includes('Goreclaw, Terror of Qal Sisma'), null, { timeout: 10000 });
    await page.getByRole('button', { name: 'Load' }).first().click();
    await page.getByRole('button', { name: 'Open game saves' }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Open game saves' }).click();
    await page.getByText('Loaded slot 1.').waitFor({ timeout: 10000 });
    await page.screenshot({ path: artifact('play-save-slots-restored.png'), fullPage: false });

    const slotCount = await page.getByText('Slot 1').count();
    assert(slotCount > 0, 'save slots are not visible after restore');
    console.log(JSON.stringify({ ok: true, artifacts: path.join(ARTIFACT_DIR, RUN_ID) }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
