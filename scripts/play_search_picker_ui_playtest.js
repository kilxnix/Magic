#!/usr/bin/env node
/*
 * Focused /play browser check for MTGA-style search picker metadata.
 *
 * It imports a search-heavy mono-green Commander deck through the real UI,
 * starts a practice game, drives actions until a library-search prompt opens,
 * and asserts that the rendered picker tells the player availability,
 * destination, tapped/reveal state, and searchable card text.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function findPlaywrightPackage() {
  try {
    return require('playwright');
  } catch {
    // Fall through to npx cache lookup.
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
const ARTIFACT_DIR = path.resolve(process.env.UI_PLAYTEST_ARTIFACT_DIR || 'playtest-artifacts/search-picker');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');

fs.mkdirSync(path.join(ARTIFACT_DIR, RUN_ID), { recursive: true });

function artifact(name) {
  return path.join(ARTIFACT_DIR, RUN_ID, name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildSearchDeck() {
  const cards = [
    ...Array.from({ length: 38 }, () => '1 Forest'),
    '1 Sol Ring',
    '1 Arcane Signet',
    '1 Llanowar Elves',
    '1 Elvish Mystic',
    '1 Fyndhorn Elves',
    '1 Birds of Paradise',
    '1 Rampant Growth',
    '1 Farseek',
    "1 Nature's Lore",
    '1 Three Visits',
    '1 Cultivate',
    "1 Kodama's Reach",
    '1 Skyshroud Claim',
    '1 Explosive Vegetation',
    '1 Circuitous Route',
    '1 Migration Path',
    "1 Nissa's Pilgrimage",
    '1 Into the North',
    '1 Sakura-Tribe Elder',
    '1 Wood Elves',
    '1 Farhaven Elf',
    '1 Yavimaya Dryad',
    '1 Solemn Simulacrum',
    '1 Myriad Landscape',
    '1 Evolving Wilds',
    '1 Terramorphic Expanse',
    '1 Prismatic Vista',
    '1 Windswept Heath',
    '1 Wooded Foothills',
    '1 Misty Rainforest',
    '1 Verdant Catacombs',
    '1 Harrow',
    '1 Traverse the Outlands',
    "1 Nylea's Intervention",
    '1 Sylvan Scrying',
    '1 Expedition Map',
    "1 Wayfarer's Bauble",
    '1 Burnished Hart',
    '1 Springbloom Druid',
    '1 Reclamation Sage',
    '1 Acidic Slime',
    '1 Colossal Dreadmaw',
    '1 Terra Stomper',
    '1 Balduvian Bears',
    '1 Bear Cub',
    '1 Brushstrider',
    '1 Canopy Spider',
    '1 Elvish Warrior',
    '1 Grizzly Bears',
    '1 Kalonian Tusker',
    '1 Runeclaw Bear',
    '1 Swordwise Centaur',
    '1 Terrain Elemental',
    '1 Alpine Grizzly',
    '1 Centaur Courser',
    '1 Colossodon Yearling',
    '1 Nessian Courser',
    '1 Trained Armodon',
    '1 Axebane Beast',
  ];

  return ['Commander', '1 Goreclaw, Terror of Qal Sisma', 'Deck', ...cards].join('\n');
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

async function assertHoverPreview(page) {
  const hoverTarget = page.getByText('Forest', { exact: true }).first();
  await hoverTarget.waitFor({ state: 'visible', timeout: 30000 });
  await hoverTarget.hover();
  const preview = page.locator('div.pointer-events-none.fixed').filter({ hasText: /Forest|Basic Land|Tap/i }).first();
  await preview.waitFor({ state: 'visible', timeout: 5000 });
  const text = (await preview.innerText()).replace(/\s+/g, ' ');
  await screenshot(page, '03-hover-preview.png');
  assert(/Forest/i.test(text), 'Hover preview did not show the card name');
  assert(/Basic Land|Land/i.test(text), 'Hover preview did not show card type information');
  return text.slice(0, 500);
}

function chooseAction(actions) {
  const priorities = [
    /^Play\b/i,
    /^Tap All\b/i,
    /^Tap\b/i,
    /^Cast (Rampant Growth|Farseek|Nature's Lore|Three Visits|Cultivate|Kodama's Reach|Skyshroud Claim|Explosive Vegetation|Circuitous Route|Migration Path|Nissa's Pilgrimage|Into the North)\b/i,
    /^Cast\b/i,
    /^Activate (Evolving Wilds|Terramorphic Expanse|Myriad Landscape|Expedition Map|Wayfarer's Bauble|Burnished Hart|Sakura-Tribe Elder)\b/i,
    /^Do it$/i,
    /^Skip Rest of Turn\b/i,
    /^Skip Empty\b/i,
    /^Pass\b/i,
  ];
  for (const pattern of priorities) {
    const found = actions.find(action => pattern.test(action.text));
    if (found) return found;
  }
  return actions[0] || null;
}

async function assertSearchPicker(page) {
  const pickButton = page.getByRole('button', { name: 'Pick selected', exact: true }).first();
  if ((await pickButton.count()) === 0 || !(await pickButton.isVisible().catch(() => false))) {
    return null;
  }

  const body = await page.locator('body').innerText();
  const normalized = body.replace(/\s+/g, ' ');
  const hasAvailability = /\b(Selectable|Unavailable)\b/i.test(normalized);
  const hasDestination = /\b(To (hand|battlefield|graveyard|top of library|bottom of library|exile|command zone)|Destination choice)\b/i.test(normalized);
  const hasRevealState = /\b(Reveal|Hidden pick)\b/i.test(normalized);
  const hasReason = /\b(Matches|Legal library choice)\b/i.test(normalized);

  await screenshot(page, 'search-picker-open.png');

  assert(hasAvailability, 'Search picker did not show availability metadata');
  assert(hasDestination, 'Search picker did not show destination metadata');
  assert(hasRevealState, 'Search picker did not show reveal/hidden metadata');
  assert(hasReason, 'Search picker did not show why the card is selectable');

  return {
    hasAvailability,
    hasDestination,
    hasRevealState,
    hasReason,
    excerpt: normalized.slice(0, 1200),
  };
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1360, height: 920 } });
  const page = await context.newPage();
  const trace = [];

  try {
    await page.goto(`${BASE_URL}/play?searchPickerQa=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await waitBodyIncludes(page, 'Import Your Deck', 20000);
    await clickButtonExact(page, 'Paste Decklist', 15000);
    await page.locator('textarea').first().fill(buildSearchDeck());
    await screenshot(page, '01-import-text.png');
    await clickButtonExact(page, 'Import Deck', 30000);
    await waitBodyIncludes(page, 'Choose Opponent', 90000);
    await clickButtonExact(page, 'Choose Opponent', 15000);
    await waitBodyIncludes(page, 'Opponent Setup', 30000);
    await clickButtonExact(page, 'Start 1v1', 120000);
    await waitBodyIncludes(page, 'Keep', 180000);
    await screenshot(page, '02-opening-hand.png');
    const hoverPreviewExcerpt = await assertHoverPreview(page);
    await clickButtonExact(page, 'Keep', 30000);

    let pickerResult = null;
    for (let step = 0; step < 90; step += 1) {
      await dismissOverlays(page);
      pickerResult = await assertSearchPicker(page);
      if (pickerResult) break;

      const confirm = page.getByRole('button', { name: 'Confirm', exact: true }).first();
      if ((await confirm.count()) > 0 && await confirm.isVisible().catch(() => false) && await confirm.isEnabled().catch(() => false)) {
        await confirm.click();
        trace.push({ step, action: 'Confirm' });
        await page.waitForTimeout(700);
        continue;
      }

      const actions = await visibleActionButtons(page);
      const selected = chooseAction(actions);
      if (!selected) {
        await page.waitForTimeout(900);
        continue;
      }
      trace.push({ step, action: selected.text });
      await selected.button.click();
      await page.waitForTimeout(900);
    }

    assert(pickerResult, `No search picker opened. Trace: ${JSON.stringify(trace.slice(-20))}`);

    const result = {
      ok: true,
      baseUrl: BASE_URL,
      trace,
      hoverPreviewExcerpt,
      pickerResult,
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
