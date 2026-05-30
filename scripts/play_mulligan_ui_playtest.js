#!/usr/bin/env node
/*
 * Browser UI playtest for selected-card opening mulligans in /play.
 *
 * It seeds a deterministic imported deck, starts a 1v1 practice game through
 * the rendered UI, selects a card to mulligan, confirms the redraw requires a
 * bottom choice, then keeps after choosing the bottom card.
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

async function clickButton(page, name, timeout = 30000) {
  const button = page.getByRole('button', { name }).first();
  await button.waitFor({ state: 'visible', timeout });
  await button.click();
  await page.waitForTimeout(300);
}

async function dismissOverlays(page) {
  for (const name of ['Decline Ads', 'Allow Ads', 'Close guided practice prompt', 'Dismiss', 'Close']) {
    const button = page.getByRole('button', { name, exact: true });
    if ((await button.count()) > 0 && await button.first().isVisible().catch(() => false)) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(150);
    }
  }
}

async function waitBodyIncludes(page, needle, timeout = 60000) {
  const started = Date.now();
  let body = '';
  while (Date.now() - started < timeout) {
    body = await page.locator('body').innerText();
    if (body.toLowerCase().includes(needle.toLowerCase())) return body;
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for ${needle}. Last body: ${body.replace(/\s+/g, ' ').slice(0, 1600)}`);
}

async function fetchCardData() {
  const seedDeck = [
    'Commander',
    '1 Talrand, Sky Summoner',
    'Deck',
    ...Array.from({ length: 99 }, () => '1 Island'),
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
    cards: [],
    lands: Array.from({ length: 99 }, () => 'Island'),
    sideboard: [],
    card_data: imported.card_data,
    total: 100,
    valid: true,
    errors: [],
    warnings: ['QA seeded all-Island deck to exercise selected-card mulligan UI.'],
    filled_cards: [],
  };
}

(async () => {
  const importResult = await fetchCardData();
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();

  try {
    await page.addInitScript(result => {
      const ttl = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem('mtg_guided_first_game_prompt_seen', JSON.stringify({ data: true, expires: ttl }));
      localStorage.setItem('mtg_last_deck_result', JSON.stringify({ data: result, expires: ttl }));
      localStorage.setItem('mtg_last_deck_text', JSON.stringify({ data: 'QA mulligan deck', expires: ttl }));
    }, importResult);

    await page.goto(`${BASE_URL}/play?mulliganQa=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await waitBodyIncludes(page, 'Talrand, Sky Summoner');
    await clickButton(page, 'Choose Opponent');
    await waitBodyIncludes(page, 'Opponent Setup');
    await clickButton(page, 'Start 1v1', 120000);
    await waitBodyIncludes(page, 'Keep');
    await dismissOverlays(page);

    await page.getByRole('button', { name: /Island/i }).first().click();
    await waitBodyIncludes(page, 'Mulligan 1');
    await clickButton(page, 'Mulligan 1');
    await waitBodyIncludes(page, 'Choose 1 to bottom');
    await page.getByRole('button', { name: /Island/i }).first().click();
    await waitBodyIncludes(page, 'Keep Selected');
    await clickButton(page, 'Keep Selected');
    const body = await waitBodyIncludes(page, 'Choose an action');

    if (body.includes('Choose 1 to bottom')) {
      throw new Error('Mulligan bottom prompt remained open after keeping selected cards.');
    }

    console.log(JSON.stringify({
      ok: true,
      baseUrl: BASE_URL,
      verification: 'selected mulligan redraw required and accepted a bottom choice before game actions appeared',
    }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    baseUrl: BASE_URL,
    error: error.stack || error.message,
  }, null, 2));
  process.exit(1);
});
