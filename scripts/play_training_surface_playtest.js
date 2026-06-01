#!/usr/bin/env node
/*
 * Exercises the /play training surfaces that serious rep users touch:
 * focused Xenagos launch, complex-turn overview, drill bookmarks, save-slot
 * Drill Lab, and the dedicated Xenagos review panel on desktop and mobile.
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
      let entries = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) stack.push(path.join(current, entry.name));
      }
    }
  }
  throw new Error('Playwright is not installed. Run npm exec playwright install or set PLAYWRIGHT_NODE_MODULES.');
}

const { chromium } = findPlaywrightPackage();
const BASE_URL = process.env.DECKREPS_BASE_URL || 'http://127.0.0.1:5173';
const HEADLESS = process.env.HEADLESS !== '0';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = path.join(process.cwd(), 'playtest-artifacts', 'training-surfaces', RUN_ID);
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

function artifact(name) {
  return path.join(ARTIFACT_DIR, name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function dismissOverlays(page) {
  for (const pattern of [/Bring My Deck/i, /Decline Ads/i, /Got it/i, /Dismiss/i]) {
    const button = page.getByRole('button', { name: pattern }).first();
    if ((await button.count()) > 0 && (await button.isVisible().catch(() => false))) {
      await button.click().catch(() => {});
      await page.waitForTimeout(250);
    }
  }
}

async function clickButton(page, pattern, timeout = 30000) {
  const button = page.getByRole('button', { name: pattern }).first();
  await button.waitFor({ timeout });
  await button.scrollIntoViewIfNeeded().catch(() => {});
  await button.click();
}

async function waitForText(page, textOrPattern, timeout = 30000) {
  if (typeof textOrPattern === 'string') {
    const needle = textOrPattern.toLowerCase();
    await page.waitForFunction(
      target => document.body.innerText.toLowerCase().includes(target),
      needle,
      { timeout },
    );
    return;
  }
  await page.getByText(textOrPattern).first().waitFor({ timeout });
}

async function openGameMenu(page) {
  const menu = page.getByRole('button', { name: /Open game menu/i }).first();
  await menu.waitFor({ timeout: 30000 });
  await menu.click();
}

async function closeSavePanelIfOpen(page) {
  const close = page.getByRole('button', { name: /Close save slots/i }).first();
  if ((await close.count()) > 0 && (await close.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
  }
  if ((await close.count()) > 0 && (await close.isVisible().catch(() => false))) {
    await page.mouse.click(8, 8).catch(() => {});
    await page.waitForTimeout(250);
  }
}

async function startFocusedXenagosRep(page) {
  await dismissOverlays(page);
  await clickButton(page, /Start Clean Xenagos Rep/i, 30000);
  await waitForText(page, 'Xenagos, God of Revels', 60000);
  const keep = page.getByRole('button', { name: /^Keep$/i }).first();
  await keep.waitFor({ timeout: 60000 });
  await keep.click();
  await page.getByRole('button', { name: /Open game menu/i }).first().waitFor({ timeout: 30000 });
}

async function createBookmarkAndOpenDrillLab(page, label) {
  await waitForText(page, 'Complex Turn Overview', 30000);
  await waitForText(page, 'Practice Focus', 30000);
  await clickButton(page, /Bookmark This Moment/i, 30000);
  await page.waitForTimeout(750);
  await openGameMenu(page);
  await clickButton(page, /Saves/i, 30000);
  await waitForText(page, 'Drill Lab', 30000);
  await waitForText(page, /SaveManager primary/i, 30000);
  await page.screenshot({ path: artifact(`${label}-drill-lab.png`), fullPage: false });
}

async function openReviewAndVerifyXenagos(page, label) {
  await closeSavePanelIfOpen(page);
  await openGameMenu(page);
  await clickButton(page, /^Review$/i, 30000);
  await waitForText(page, 'Xenagos Practice Review', 30000);
  await waitForText(page, 'Tutor/Ramp Line', 30000);
  await waitForText(page, 'ETB Damage Line', 30000);
  await waitForText(page, 'Combat Branch', 30000);
  await page.screenshot({ path: artifact(`${label}-xenagos-review.png`), fullPage: false });
}

async function runViewport(browser, label, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    window.localStorage.setItem('guided_first_game_prompt_seen', '1');
    window.localStorage.setItem('deckreps_ads_consent_v1', 'declined');
  });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/play?trainingsurface=${label}-${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await startFocusedXenagosRep(page);
    await createBookmarkAndOpenDrillLab(page, label);
    await openReviewAndVerifyXenagos(page, label);
  } catch (error) {
    await page.screenshot({ path: artifact(`${label}-failure.png`), fullPage: true }).catch(() => {});
    const body = await page.locator('body').innerText().catch(() => '');
    fs.writeFileSync(artifact(`${label}-failure-body.txt`), body);
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  try {
    await runViewport(browser, 'desktop', { width: 1280, height: 850 });
    await runViewport(browser, 'mobile', { width: 390, height: 844 });
    console.log(JSON.stringify({ ok: true, artifacts: ARTIFACT_DIR }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
