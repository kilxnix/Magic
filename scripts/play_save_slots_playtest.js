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

async function openGameSaves(page) {
  await page.getByRole('button', { name: 'Open game menu' }).click();
  await page.getByRole('button', { name: /^Saves\b/ }).click();
}

async function openReview(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reviewButton = page.getByRole('button', { name: 'Review', exact: true });
    if ((await reviewButton.count()) > 0 && (await reviewButton.first().isVisible().catch(() => false))) {
      await reviewButton.first().click();
      return;
    }
    const closeSaveSlots = page.getByRole('button', { name: 'Close save slots', exact: true });
    if ((await closeSaveSlots.count()) > 0 && (await closeSaveSlots.first().isVisible().catch(() => false))) {
      await closeSaveSlots.first().click();
      await page.waitForTimeout(150);
    }
    await page.getByRole('button', { name: 'Open game menu' }).click();
    await page.waitForTimeout(150);
  }
  throw new Error('Could not open the game review from the menu');
}

async function readSavedSlot(page, slot) {
  return page.evaluate(targetSlot => new Promise((resolve, reject) => {
    const request = indexedDB.open('deckreps_play_saves_v1', 1);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('slots', 'readonly');
      const store = tx.objectStore('slots');
      const get = store.get(targetSlot);
      get.onerror = () => reject(get.error || new Error('IndexedDB read failed'));
      get.onsuccess = () => resolve(get.result || null);
      tx.oncomplete = () => db.close();
    };
  }), slot);
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
    const firstAction = page.getByRole('button', { name: /Skip Rest of Turn|End Phase|Done|Pass/i }).first();
    await firstAction.waitFor({ timeout: 15000 });
    await firstAction.click();
    await page.waitForTimeout(500);
    await openGameSaves(page);
    await page.getByRole('button', { name: 'Save Here' }).first().click();
    await page.getByText('Saved slot 1').waitFor({ timeout: 10000 });
    const savedSlot = await readSavedSlot(page, 1);
    assert(savedSlot?.snapshot?.engineEventLogInitialState, 'save slot is missing the audit replay initial state');
    assert(Array.isArray(savedSlot?.snapshot?.engineEventLog), 'save slot is missing the audit event log array');
    assert(savedSlot.snapshot.engineEventLog.length > 0, 'save slot did not persist any authority action audit records');
    assert(Object.keys(savedSlot.snapshot.engineEventLogSeeds || {}).length > 0, 'save slot is missing per-record audit seeds');
    await page.getByText(/Audit OK|Audit ready/).first().waitFor({ timeout: 10000 });
    await page.screenshot({ path: artifact('play-save-slots-game.png'), fullPage: false });
    await openReview(page);
    await page.getByText(/Replay audit passed/).first().waitFor({ timeout: 10000 });
    await page.screenshot({ path: artifact('play-save-slots-review-audit.png'), fullPage: false });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await page.getByText('Game Saves', { exact: true }).waitFor({ timeout: 10000 });
    await page.waitForFunction(() => document.body.innerText.includes('Goreclaw, Terror of Qal Sisma'), null, { timeout: 10000 });
    await page.getByRole('button', { name: 'Load' }).first().click();
    await page.getByRole('button', { name: 'Open game menu' }).waitFor({ timeout: 15000 });
    await openGameSaves(page);
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
