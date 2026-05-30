#!/usr/bin/env node
/*
 * Browser UI certification for the included beginner decks.
 *
 * Loads each starter deck from /play, starts a 1v1 practice game, keeps the
 * opening hand, and drives real visible actions for a short deterministic pass.
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
const ARTIFACT_DIR = path.resolve(process.env.UI_PLAYTEST_ARTIFACT_DIR || 'playtest-artifacts/starter-decks');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const STARTERS = [
  { name: 'Green Big Creatures', commander: 'Goreclaw, Terror of Qal Sisma' },
  { name: 'Red Goblin Swarm', commander: 'Krenko, Mob Boss' },
  { name: 'Blue Spell Practice', commander: 'Talrand, Sky Summoner' },
];

fs.mkdirSync(path.join(ARTIFACT_DIR, RUN_ID), { recursive: true });

function artifact(name) {
  return path.join(ARTIFACT_DIR, RUN_ID, name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function dismissOverlays(page) {
  for (const name of ['Decline Ads', 'Allow Ads', 'Close guided practice prompt', 'Dismiss', 'Close']) {
    const button = page.getByRole('button', { name, exact: true });
    if ((await button.count()) > 0 && (await button.first().isVisible().catch(() => false))) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(150);
    }
  }
}

async function visibleActionButtons(page) {
  const result = [];
  const docks = page.locator('[aria-label="Game actions"], [aria-label="Phase controls"]');
  for (let dockIndex = 0; dockIndex < await docks.count(); dockIndex += 1) {
    const dock = docks.nth(dockIndex);
    if (!(await dock.isVisible().catch(() => false))) continue;
    const buttons = dock.getByRole('button');
    for (let index = 0; index < await buttons.count(); index += 1) {
      const button = buttons.nth(index);
      if (!(await button.isVisible().catch(() => false))) continue;
      if (!(await button.isEnabled().catch(() => false))) continue;
      const text = (await button.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (text) result.push({ button, text });
    }
  }
  return result;
}

function chooseAction(actions) {
  const priorities = [
    /^Play\b/i,
    /^Tap All\b/i,
    /^Tap\b/i,
    /^Cast\b/i,
    /^Activate\b/i,
    /^Attack\b/i,
    /^Block\b/i,
    /^Do it$/i,
    /^Confirm$/i,
    /^Skip Rest of Turn\b/i,
    /^Pass\b/i,
    /^Done\b/i,
  ];
  for (const pattern of priorities) {
    const found = actions.find(action => pattern.test(action.text));
    if (found) return found;
  }
  return actions[0] || null;
}

function collectBadLines(body) {
  return body
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => /commander not found|unsupported save|could not start|rules invariant failed|error:/i.test(line));
}

async function handleOpenPrompt(page, trace, step) {
  const pickButton = page.getByRole('button', { name: 'Pick selected', exact: true }).first();
  if ((await pickButton.count()) > 0 && await pickButton.isVisible().catch(() => false) && await pickButton.isEnabled().catch(() => false)) {
    await pickButton.click();
    trace.push({ step, action: 'Pick selected' });
    await page.waitForTimeout(500);
    return true;
  }

  const keepSelected = page.getByRole('button', { name: 'Keep Selected', exact: true }).first();
  if ((await keepSelected.count()) > 0 && await keepSelected.isVisible().catch(() => false) && await keepSelected.isEnabled().catch(() => false)) {
    await keepSelected.click();
    trace.push({ step, action: 'Keep Selected' });
    await page.waitForTimeout(500);
    return true;
  }

  const confirm = page.getByRole('button', { name: 'Confirm', exact: true }).first();
  if ((await confirm.count()) > 0 && await confirm.isVisible().catch(() => false) && await confirm.isEnabled().catch(() => false)) {
    await confirm.click();
    trace.push({ step, action: 'Confirm' });
    await page.waitForTimeout(500);
    return true;
  }

  return false;
}

async function certifyStarter(browser, starter, index) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();
  const trace = [];
  try {
    await page.goto(`${BASE_URL}/play?starterDeckQa=${index}-${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await page.getByText('Game Saves', { exact: true }).waitFor({ timeout: 10000 });
    await page.getByText(starter.name, { exact: true }).click();
    await page.getByText('Opponent Setup', { exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Start 1v1' }).click();
    await page.getByText('Keep', { exact: true }).waitFor({ timeout: 60000 });
    await page.getByText(starter.commander, { exact: true }).first().waitFor({ timeout: 10000 });
    await page.getByText('Keep', { exact: true }).click();

    for (let step = 0; step < 14; step += 1) {
      await dismissOverlays(page);
      if (await handleOpenPrompt(page, trace, step)) continue;
      const actions = await visibleActionButtons(page);
      const selected = chooseAction(actions);
      if (!selected) {
        await page.waitForTimeout(500);
        continue;
      }
      trace.push({ step, action: selected.text });
      await selected.button.click();
      await page.waitForTimeout(650);
    }

    const body = await page.locator('body').innerText();
    const badLines = collectBadLines(body);
    assert(badLines.length === 0, `${starter.name} surfaced errors: ${badLines.join(' | ')}`);
    await page.screenshot({ path: artifact(`${String(index + 1).padStart(2, '0')}-${starter.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`), fullPage: false });
    return { starter: starter.name, commander: starter.commander, trace };
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  try {
    const results = [];
    for (let index = 0; index < STARTERS.length; index += 1) {
      results.push(await certifyStarter(browser, STARTERS[index], index));
    }
    const result = { ok: true, baseUrl: BASE_URL, results, artifactDir: path.join(ARTIFACT_DIR, RUN_ID) };
    fs.writeFileSync(artifact('result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  const result = { ok: false, baseUrl: BASE_URL, artifactDir: path.join(ARTIFACT_DIR, RUN_ID), error: error.stack || error.message };
  fs.writeFileSync(artifact('result.json'), JSON.stringify(result, null, 2));
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
