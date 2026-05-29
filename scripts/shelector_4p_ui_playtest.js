#!/usr/bin/env node
/*
 * Browser UI playtest for /play in 1v1v1v1 mode.
 *
 * This drives the rendered practice flow: choose a starter deck, select the
 * four-player setup, generate three Shelector opponents, keep the opening hand,
 * and take visible human actions while the in-browser AI loop advances the pod.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function findPlaywrightPackage() {
  try {
    return require('playwright');
  } catch {
    // Fall through to the local npx cache scan used by the room playtests.
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
      if (fs.existsSync(packageJson)) {
        return require(path.join(current, 'node_modules', 'playwright'));
      }
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          stack.push(path.join(current, entry.name));
        }
      }
    }
  }

  throw new Error('Playwright is not importable. Run `npx playwright --version` once or install Playwright.');
}

const { chromium } = findPlaywrightPackage();

const BASE_URL = (process.env.DECKREPS_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const HEADLESS = process.env.HEADLESS !== '0';
const ARTIFACT_DIR = path.resolve(process.env.UI_PLAYTEST_ARTIFACT_DIR || 'playtest-artifacts/shelector-4p');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const STARTER_DECK = process.env.SHELECTOR_4P_STARTER || 'Green Big Creatures';
const HUMAN_ACTIONS = Number(process.env.SHELECTOR_4P_ACTIONS || 28);

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
    if ((await button.count()) > 0 && await button.first().isVisible().catch(() => false)) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(250);
    }
  }
}

async function waitBodyIncludes(page, needle, timeout = 15000) {
  const started = Date.now();
  let lastBody = '';
  while (Date.now() - started < timeout) {
    lastBody = await page.locator('body').innerText();
    if (lastBody.toLowerCase().includes(needle.toLowerCase())) return lastBody;
    await page.waitForTimeout(500);
  }
  const excerpt = lastBody.replace(/\s+/g, ' ').slice(0, 2000);
  throw new Error(`Timed out waiting for visible text: ${needle}. Last visible body: ${excerpt}`);
}

async function clickButtonByName(page, name, timeout = 15000) {
  const button = page.getByRole('button', { name, exact: true }).first();
  await button.waitFor({ state: 'visible', timeout });
  await button.click();
  await page.waitForTimeout(350);
}

async function clickText(page, text, timeout = 15000) {
  const locator = page.getByText(text, { exact: true }).first();
  await locator.waitFor({ state: 'visible', timeout });
  await locator.click();
  await page.waitForTimeout(350);
}

async function clickButtonByPattern(page, pattern, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const buttons = page.getByRole('button');
    const count = await buttons.count();
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      if (!(await button.isVisible().catch(() => false))) continue;
      if (!(await button.isEnabled().catch(() => false))) continue;
      const text = (await button.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (pattern.test(text)) {
        await button.click();
        await page.waitForTimeout(350);
        return text;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for button matching ${pattern}`);
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

async function resolveBlockingGamePrompt(page) {
  const promptActions = [
    { label: 'Confirm', locator: page.getByRole('button', { name: 'Confirm', exact: true }) },
    { label: 'Pick selected', locator: page.getByRole('button', { name: 'Pick selected', exact: true }) },
    { label: 'Keep All Top', locator: page.getByRole('button', { name: 'Keep All Top', exact: true }) },
    { label: 'Decline sacrifice', locator: page.getByRole('button', { name: 'Decline sacrifice', exact: true }) },
    { label: 'Cancel search', locator: page.getByRole('button', { name: 'Cancel search', exact: true }) },
  ];

  for (const action of promptActions) {
    const count = await action.locator.count();
    for (let index = 0; index < count; index += 1) {
      const button = action.locator.nth(index);
      if (!(await button.isVisible().catch(() => false))) continue;
      if (!(await button.isEnabled().catch(() => false))) continue;
      await button.click();
      await page.waitForTimeout(600);
      return action.label;
    }
  }

  return null;
}

function chooseHumanAction(actions) {
  const priorities = [
    /^Play\b/i,
    /^Tap All\b/i,
    /^Tap\b/i,
    /^Cast\b/i,
    /^Declare\b/i,
    /^Attack\b/i,
    /^Do it$/i,
    /^Skip Attacks\b/i,
    /^Skip Empty\b/i,
    /^Pass Empty\b/i,
    /^Skip Rest of Turn\b/i,
    /^Pass\b/i,
  ];
  for (const pattern of priorities) {
    const found = actions.find(action => pattern.test(action.text));
    if (found) return found;
  }
  return actions[0] || null;
}

async function driveHumanActions(page, maxActions) {
  const trace = [];
  let idleLoops = 0;

  for (let index = 0; index < maxActions; index += 1) {
    await dismissOverlays(page);
    const promptResolution = await resolveBlockingGamePrompt(page);
    if (promptResolution) {
      trace.push({
        index,
        action: `Resolve prompt: ${promptResolution}`,
        at: new Date().toISOString(),
      });
      continue;
    }

    const actions = await visibleActionButtons(page);
    const selected = chooseHumanAction(actions);

    if (!selected) {
      idleLoops += 1;
      if (idleLoops > 20) break;
      await page.waitForTimeout(1000);
      continue;
    }

    idleLoops = 0;
    trace.push({
      index,
      action: selected.text,
      at: new Date().toISOString(),
    });
    await selected.button.click();
    await page.waitForTimeout(900);
    const followupPromptResolution = await resolveBlockingGamePrompt(page);
    if (followupPromptResolution) {
      trace.push({
        index,
        action: `Resolve prompt: ${followupPromptResolution}`,
        at: new Date().toISOString(),
      });
    }
  }

  return trace;
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1360, height: 920 } });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/play?shelector4pqa=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await waitBodyIncludes(page, 'Beginner Starter Decks', 20000);
    await screenshot(page, '01-play-start.png');

    await clickText(page, STARTER_DECK, 30000);
    await waitBodyIncludes(page, 'Opponent Setup', 45000);
    await clickButtonByPattern(page, /^1v1v1v1\b/i, 15000);
    await screenshot(page, '02-four-player-selected.png');

    await clickButtonByPattern(page, /^Start 1v1v1v1\b/i, 15000);
    await waitBodyIncludes(page, 'Keep', 180000);
    await screenshot(page, '03-opening-hand.png');

    const openingText = await page.locator('body').innerText();
    assert(/AI 1/i.test(openingText), 'AI 1 was not visible after setup');
    assert(/AI 2/i.test(openingText), 'AI 2 was not visible after setup');
    assert(/AI 3/i.test(openingText), 'AI 3 was not visible after setup');

    await clickButtonByName(page, 'Keep', 30000);
    await waitBodyIncludes(page, 'Game actions', 30000).catch(() => {});

    const actions = await driveHumanActions(page, HUMAN_ACTIONS);
    await screenshot(page, '04-after-actions.png');
    const finalText = await page.locator('body').innerText();
    const errors = finalText
      .split(/\r?\n/)
      .filter(line => /\bfailed\b|\berror\b|commander not found|\bunsupported\b/i.test(line))
      .slice(0, 12);

    assert(actions.length > 0, 'No visible human game actions were available after keeping the hand');
    assert(!/Commander not found/i.test(finalText), 'Commander lookup failed during 1v1v1v1 Shelector setup');

    const result = {
      ok: true,
      baseUrl: BASE_URL,
      starterDeck: STARTER_DECK,
      humanActionsRequested: HUMAN_ACTIONS,
      humanActionsTaken: actions.length,
      actions,
      visibleWarnings: errors,
      artifactDir: path.join(ARTIFACT_DIR, RUN_ID),
    };
    fs.writeFileSync(artifact('result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => {
  const result = {
    ok: false,
    baseUrl: BASE_URL,
    starterDeck: STARTER_DECK,
    artifactDir: path.join(ARTIFACT_DIR, RUN_ID),
    error: error.stack || error.message,
  };
  fs.writeFileSync(artifact('result.json'), JSON.stringify(result, null, 2));
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
