#!/usr/bin/env node
/*
 * Browser UI playtest for modal spell choices in /play.
 *
 * Loads a DEV-only QA state with two Abrades, an opposing creature, and an
 * opposing artifact. It then casts one Abrade through the damage mode and one
 * through the destroy-artifact mode using the same visible action dock players
 * use during practice.
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
const ARTIFACT_DIR = path.resolve(process.env.UI_PLAYTEST_ARTIFACT_DIR || 'playtest-artifacts/modal-choice');
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

async function dismissOverlays(page) {
  for (const name of ['Decline Ads', 'Allow Ads', 'Close guided practice prompt', 'Dismiss', 'Close']) {
    const button = page.getByRole('button', { name, exact: true });
    if ((await button.count()) > 0 && (await button.first().isVisible().catch(() => false))) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(150);
    }
  }
}

async function waitBodyIncludes(page, needle, timeout = 15000) {
  const started = Date.now();
  let body = '';
  while (Date.now() - started < timeout) {
    body = await page.locator('body').innerText();
    if (body.toLowerCase().includes(needle.toLowerCase())) return body;
    await page.waitForTimeout(400);
  }
  throw new Error(`Timed out waiting for ${needle}. Last body: ${body.replace(/\s+/g, ' ').slice(0, 1800)}`);
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
      if (text && !/^Undo\b/i.test(text)) result.push({ button, text });
    }
  }
  return result;
}

async function clickActionMatching(page, predicate, label) {
  const started = Date.now();
  let lastActions = [];
  while (Date.now() - started < 20000) {
    await dismissOverlays(page);
    const actions = await visibleActionButtons(page);
    lastActions = actions.map(action => action.text);
    const found = actions.find(action => predicate(action.text));
    if (found) {
      await found.button.click();
      await page.waitForTimeout(700);
      return found.text;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Could not find ${label}. Visible actions: ${JSON.stringify(lastActions)}`);
}

async function resolveStack(page, trace) {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const actions = await visibleActionButtons(page);
    const selected = actions.find(action => /^Don't Respond$/i.test(action.text))
      || actions.find(action => /^Pass\b/i.test(action.text))
      || actions.find(action => /^Do it$/i.test(action.text));
    if (!selected) return;
    if (selected) {
      trace.push(selected.text);
      await selected.button.click();
      await page.waitForTimeout(700);
      continue;
    }
    await page.waitForTimeout(500);
  }
  const body = await page.locator('body').innerText();
  throw new Error(`Modal spell stack did not resolve. Body: ${body.replace(/\s+/g, ' ').slice(0, 1600)}`);
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1360, height: 920 } });
  const page = await context.newPage();
  const trace = [];

  try {
    await page.goto(`${BASE_URL}/play?qa=modal-choice&modalQa=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await waitBodyIncludes(page, 'Abrade', 20000);
    await screenshot(page, '01-modal-qa-loaded.png');

    trace.push(await clickActionMatching(
      page,
      text => /^Cast Abrade\b/i.test(text) && /damage|Grizzly Bears/i.test(text),
      'Abrade damage mode',
    ));
    await screenshot(page, '02-damage-mode-on-stack.png');
    await resolveStack(page, trace);
    await screenshot(page, '03-after-damage-mode.png');

    trace.push(await clickActionMatching(
      page,
      text => /^Cast Abrade\b/i.test(text) && /artifact|Sol Ring|Destroy/i.test(text),
      'Abrade destroy-artifact mode',
    ));
    await screenshot(page, '04-artifact-mode-on-stack.png');
    await resolveStack(page, trace);
    const body = await waitBodyIncludes(page, 'Opponent Graveyard: 2', 20000);
    await screenshot(page, '05-after-artifact-mode.png');

    assert(/Abrade/i.test(body), 'Abrade was not visible in the resolved modal QA game log');
    assert(/No permanents/i.test(body), 'Sol Ring still appears to be on the opponent battlefield after Abrade artifact mode');
    assert(/Your Graveyard:\s*2/i.test(body), 'Both modal Abrades did not end in the pilot graveyard');
    const result = { ok: true, baseUrl: BASE_URL, trace, artifactDir: path.join(ARTIFACT_DIR, RUN_ID) };
    fs.writeFileSync(artifact('result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => {
  const result = { ok: false, baseUrl: BASE_URL, artifactDir: path.join(ARTIFACT_DIR, RUN_ID), error: error.stack || error.message };
  fs.writeFileSync(artifact('result.json'), JSON.stringify(result, null, 2));
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
