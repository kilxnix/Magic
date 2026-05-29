#!/usr/bin/env node
/*
 * Browser UI playtest for real scry/surveil choice prompts in /play.
 *
 * It seeds the same cached import shape the Play page already uses, starts a
 * practice game through the actual UI, casts Opt and Consider, and verifies the
 * top/bottom and top/graveyard lane controls resolve cleanly.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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
const ARTIFACT_DIR = path.resolve(process.env.UI_PLAYTEST_ARTIFACT_DIR || 'playtest-artifacts/library-choice');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');

fs.mkdirSync(path.join(ARTIFACT_DIR, RUN_ID), { recursive: true });

function artifact(name) {
  return path.join(ARTIFACT_DIR, RUN_ID, name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchCardData() {
  const seedDeck = [
    'Commander',
    '1 Talrand, Sky Summoner',
    'Deck',
    '1 Opt',
    '1 Consider',
    ...Array.from({ length: 97 }, () => '1 Island'),
  ].join('\n');
  const response = await fetch(`${BASE_URL}/shelector-api/import-deck`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decklist_text: seedDeck }),
  });
  if (!response.ok) {
    throw new Error(`Could not fetch seed card data: ${response.status} ${await response.text()}`);
  }
  const imported = await response.json();
  return {
    commander: 'Talrand, Sky Summoner',
    cards: [
      ...Array.from({ length: 22 }, () => 'Opt'),
      ...Array.from({ length: 22 }, () => 'Consider'),
      ...Array.from({ length: 5 }, () => "Talrand's Invocation"),
    ],
    lands: Array.from({ length: 50 }, () => 'Island'),
    sideboard: [],
    card_data: imported.card_data,
    total: 100,
    valid: true,
    errors: [],
    warnings: ['QA seeded duplicate cantrips to deterministically exercise scry and surveil UI.'],
    filled_cards: [],
  };
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
  throw new Error(`Timed out waiting for ${needle}. Last body: ${lastBody.replace(/\s+/g, ' ').slice(0, 1800)}`);
}

async function clickButtonExact(page, name, timeout = 15000) {
  const button = page.getByRole('button', { name, exact: true }).first();
  await button.waitFor({ state: 'visible', timeout });
  await button.click();
  await page.waitForTimeout(350);
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

function chooseAction(actions, mode, castStarted) {
  const wantedSpell = mode === 'scry' ? /^Cast Opt\b/i : /^Cast Consider\b/i;
  const priorities = castStarted ? [
    /^Don't Respond$/i,
    /^Do it$/i,
    /^Pass\b/i,
    /^Skip Rest of Turn\b/i,
  ] : [
    /^Play Island\b/i,
    /^Tap All\b/i,
    /^Tap Island for U\b/i,
    wantedSpell,
    /^Don't Respond$/i,
    /^Do it$/i,
    /^Skip Rest of Turn\b/i,
    /^Pass\b/i,
  ];
  for (const pattern of priorities) {
    const found = actions.find(action => pattern.test(action.text));
    if (found) return found;
  }
  return actions[0] || null;
}

async function resolveLibraryModal(page, mode) {
  const titleNeedle = mode === 'scry' ? 'Scry' : 'Surveil';
  const moveButtonName = mode === 'scry' ? /Move to Bottom/i : /Move to Graveyard/i;

  await waitBodyIncludes(page, titleNeedle, 10000);
  await screenshot(page, `${mode}-choice-open.png`);
  const moveButtons = page.getByRole('button', { name: moveButtonName });
  assert(await moveButtons.count() > 0, `${titleNeedle} modal did not expose a move button`);
  await moveButtons.first().click();
  await page.waitForTimeout(250);
  await screenshot(page, `${mode}-choice-moved.png`);
  await clickButtonExact(page, 'Confirm', 10000);
  await page.getByRole('button', { name: moveButtonName }).first().waitFor({ state: 'hidden', timeout: 30000 }).catch(async () => {
    const body = await page.locator('body').innerText();
    if (body.toLowerCase().includes(`${titleNeedle.toLowerCase()} 1`)) {
      throw new Error(`${titleNeedle} modal did not close after confirming. Body: ${body.replace(/\s+/g, ' ').slice(0, 1600)}`);
    }
  });
}

async function castUntilChoice(page, mode) {
  const trace = [];
  let castStarted = false;
  for (let step = 0; step < 70; step += 1) {
    await dismissOverlays(page);
    const body = await page.locator('body').innerText();
    if (body.toLowerCase().includes(mode === 'scry' ? 'scry 1' : 'surveil 1')) {
      await resolveLibraryModal(page, mode);
      return trace;
    }

    const actions = await visibleActionButtons(page);
    const selected = chooseAction(actions, mode, castStarted);
    if (!selected) {
      await page.waitForTimeout(700);
      continue;
    }
    trace.push({ step, action: selected.text });
    if ((mode === 'scry' && /^Cast Opt\b/i.test(selected.text)) || (mode === 'surveil' && /^Cast Consider\b/i.test(selected.text))) {
      castStarted = true;
    }
    await selected.button.click();
    await page.waitForTimeout(850);
  }
  throw new Error(`Could not reach ${mode} library-choice prompt. Trace: ${JSON.stringify(trace.slice(-20))}`);
}

(async () => {
  const importResult = await fetchCardData();
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1360, height: 920 } });
  const page = await context.newPage();

  try {
    await page.addInitScript(result => {
      const ttl = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem('mtg_guided_first_game_prompt_seen', JSON.stringify({ data: true, expires: ttl }));
      localStorage.setItem('mtg_last_deck_result', JSON.stringify({ data: result, expires: ttl }));
      localStorage.setItem('mtg_last_deck_text', JSON.stringify({ data: 'QA duplicate cantrip deck', expires: ttl }));
    }, importResult);

    await page.goto(`${BASE_URL}/play?libraryChoiceQa=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await waitBodyIncludes(page, 'Talrand, Sky Summoner', 20000);
    await screenshot(page, '01-seeded-import.png');
    await clickButtonExact(page, 'Choose Opponent', 15000);
    await waitBodyIncludes(page, 'Opponent Setup', 30000);
    await clickButtonExact(page, 'Start 1v1', 120000);
    await waitBodyIncludes(page, 'Keep', 180000);
    await screenshot(page, '02-opening-hand.png');
    await clickButtonExact(page, 'Keep', 30000);

    const scryTrace = await castUntilChoice(page, 'scry');
    const surveilTrace = await castUntilChoice(page, 'surveil');
    await screenshot(page, '05-after-library-choices.png');

    const result = {
      ok: true,
      baseUrl: BASE_URL,
      scryTrace,
      surveilTrace,
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
    artifactDir: path.join(ARTIFACT_DIR, RUN_ID),
    error: error.stack || error.message,
  };
  fs.writeFileSync(artifact('result.json'), JSON.stringify(result, null, 2));
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
