#!/usr/bin/env node
/*
 * DeckReps Archidekt certification runner.
 *
 * This is intentionally both UI and engine-facing:
 * - drives /play through a browser for each supplied Archidekt URL
 * - imports the same URL through the backend
 * - sweeps every unique imported card through focused engine actions
 *
 * The output is a JSON report per run under playtest-artifacts/archidekt-cert.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function findPlaywrightPackage() {
  try {
    return require('playwright');
  } catch {
    // Fall through to the local npx cache scan used by the other UI playtests.
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
const API_BASE_URL = (process.env.DECKREPS_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const HEADLESS = process.env.HEADLESS !== '0';
const ARTIFACT_DIR = path.resolve(process.env.UI_PLAYTEST_ARTIFACT_DIR || 'playtest-artifacts/archidekt-cert');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const HUMAN_ACTIONS = Number(process.env.ARCHIDEKT_CERT_ACTIONS || 18);
const SELECTED_DECK = process.env.ARCHIDEKT_CERT_DECK || '';

const DECKS = [
  {
    slug: 'storms-typhoon',
    url: 'https://archidekt.com/decks/10024261/storms_typhoon',
  },
  {
    slug: 'league-of-legendaries',
    url: 'https://archidekt.com/decks/6060588/league_of_legendaries',
  },
  {
    slug: 'ff-recursion',
    url: 'https://archidekt.com/decks/11964597/ff_recursion_bullshit',
  },
  {
    slug: 'birbs',
    url: 'https://archidekt.com/decks/15529421/birbs',
  },
].filter(deck => !SELECTED_DECK || deck.slug === SELECTED_DECK || deck.url.includes(SELECTED_DECK));

const runDir = path.join(ARTIFACT_DIR, RUN_ID);
fs.mkdirSync(runDir, { recursive: true });

function artifact(name) {
  return path.join(runDir, name);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function apiJson(pathname, options = {}) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API ${pathname} returned ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

function decklistFromParsed(parsed) {
  const lines = [];
  if (parsed.commander) {
    lines.push('Commander');
    lines.push(`1 ${parsed.commander}`);
    lines.push('Deck');
  }
  for (const card of parsed.cards || []) {
    lines.push(`1 ${card}`);
  }
  return lines.join('\n');
}

async function importDeck(url) {
  const parsed = await apiJson('/api/parse-deck-url', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  const decklistText = decklistFromParsed(parsed);
  const imported = await apiJson('/shelector-api/import-deck', {
    method: 'POST',
    body: JSON.stringify({
      decklist_text: decklistText,
      bracket: 3,
      fill_missing: true,
    }),
  });
  return { parsed, imported, decklistText };
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

async function screenshot(page, deckSlug, name) {
  await page.screenshot({ path: artifact(`${deckSlug}-${name}.png`), fullPage: false });
}

async function waitBodyIncludes(page, needle, timeout = 20000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeout) {
    last = await page.locator('body').innerText().catch(() => '');
    if (last.toLowerCase().includes(needle.toLowerCase())) return last;
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for visible text "${needle}". Last body: ${last.replace(/\s+/g, ' ').slice(0, 1800)}`);
}

async function clickVisibleButton(page, name, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const button = page.getByRole('button', { name, exact: true });
    const count = await button.count();
    for (let index = 0; index < count; index += 1) {
      const item = button.nth(index);
      if (await item.isVisible().catch(() => false)) {
        if (await item.isEnabled().catch(() => false)) {
          await item.click();
          await page.waitForTimeout(500);
          return;
        }
      }
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`Timed out waiting for button "${name}"`);
}

async function clickButtonByPattern(page, pattern, timeout = 20000) {
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
        await page.waitForTimeout(500);
        return text;
      }
    }
    await page.waitForTimeout(400);
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
      const item = action.locator.nth(index);
      if (!(await item.isVisible().catch(() => false))) continue;
      if (!(await item.isEnabled().catch(() => false))) continue;
      await item.click();
      await page.waitForTimeout(600);
      return action.label;
    }
  }

  const closeButtons = page.getByRole('button', { name: 'Close', exact: true });
  for (let index = 0; index < await closeButtons.count(); index += 1) {
    const button = closeButtons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    if (!(await button.isEnabled().catch(() => false))) continue;
    await button.click();
    await page.waitForTimeout(400);
    return 'Close modal';
  }

  return null;
}

function chooseHumanAction(actions) {
  const priorities = [
    /^Do it$/i,
    /^Play\b/i,
    /^Tap All\b/i,
    /^Tap\b/i,
    /^Cast\b/i,
    /^Activate\b/i,
    /^Equip\b/i,
    /^Declare\b/i,
    /^Attack\b/i,
    /^Skip Attacks\b/i,
    /^Skip Empty\b/i,
    /^Skip Rest of Turn\b/i,
    /^End Phase\b/i,
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
      trace.push({ index, action: `Resolve prompt: ${promptResolution}`, at: new Date().toISOString() });
      continue;
    }
    const actions = await visibleActionButtons(page);
    const selected = chooseHumanAction(actions);
    if (!selected) {
      idleLoops += 1;
      if (idleLoops > 12) break;
      await page.waitForTimeout(900);
      continue;
    }
    idleLoops = 0;
    trace.push({ index, action: selected.text, at: new Date().toISOString() });
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

async function runUiDeckPass(browser, deck, imported) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 920 } });
  const page = await context.newPage();
  const result = {
    ok: false,
    deck: deck.slug,
    screenshots: [],
    humanActions: [],
    visibleWarnings: [],
  };
  try {
    await page.goto(`${BASE_URL}/play?archidekt-cert=${deck.slug}-${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await waitBodyIncludes(page, 'Import Your Deck', 20000);

    const urlBox = page.getByRole('textbox', { name: 'https://www.moxfield.com/decks/...', exact: true });
    await urlBox.fill(deck.url);
    await clickVisibleButton(page, 'Import Deck', 30000);
    await waitBodyIncludes(page, imported.commander || '100 cards', 80000);
    await waitBodyIncludes(page, '100 cards', 80000);
    await screenshot(page, deck.slug, '01-imported');
    result.screenshots.push(`${deck.slug}-01-imported.png`);

    await clickVisibleButton(page, 'Choose Opponent', 30000);
    await waitBodyIncludes(page, 'Opponent Setup', 30000);
    await clickButtonByPattern(page, /^Start 1v1\b/i, 30000);
    await waitBodyIncludes(page, 'Keep', 180000);
    await screenshot(page, deck.slug, '02-opening-hand');
    result.screenshots.push(`${deck.slug}-02-opening-hand.png`);

    const firstHandCard = page.locator('button').filter({ hasText: /^.+\{?.*$/ }).first();
    if ((await firstHandCard.count()) > 0) {
      await firstHandCard.hover().catch(() => {});
      await page.waitForTimeout(750);
      await screenshot(page, deck.slug, '03-hover-check');
      result.screenshots.push(`${deck.slug}-03-hover-check.png`);
    }

    await clickVisibleButton(page, 'Keep', 30000);
    result.humanActions = await driveHumanActions(page, HUMAN_ACTIONS);
    await screenshot(page, deck.slug, '04-after-actions');
    result.screenshots.push(`${deck.slug}-04-after-actions.png`);

    const finalText = await page.locator('body').innerText();
    result.visibleWarnings = finalText
      .split(/\r?\n/)
      .filter(line => /\bfailed\b|\berror\b|commander not found|\bunsupported\b|cannot\b/i.test(line))
      .slice(0, 20);
    result.ok = result.humanActions.length > 0 && !/Commander not found/i.test(finalText);
    return result;
  } catch (error) {
    result.error = error.stack || error.message;
    await screenshot(page, deck.slug, 'error').catch(() => {});
    return result;
  } finally {
    await context.close();
  }
}

function cardDataToScryfall(name, data) {
  return {
    id: data.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: data.name || name,
    type_line: data.type_line || '',
    oracle_text: data.oracle_text || '',
    mana_cost: data.mana_cost || '',
    cmc: Number(data.cmc || 0),
    colors: data.colors || [],
    color_identity: data.color_identity || [],
    keywords: data.keywords || [],
    power: data.power ?? null,
    toughness: data.toughness ?? null,
    legalities: { commander: 'legal' },
  };
}

function importedToGeneratedDeck(imported) {
  const commanderIdentity = imported.commander_data?.color_identity || [];
  return {
    commander: imported.commander,
    list: [...(imported.cards || []), ...(imported.lands || [])],
    colors: commanderIdentity,
    sideboard: imported.sideboard || [],
  };
}

function setHugeMana(state, playerId) {
  const player = state.players.find(item => item.id === playerId);
  if (player) player.manaPool = { W: 20, U: 20, B: 20, R: 20, G: 20, C: 20 };
}

function forceMainPriority(state) {
  state.activePlayerIndex = 0;
  state.priorityPlayerIndex = 0;
  state.phase = 'precombat_main';
  state.step = 'main';
  state.stack = [];
  state.hasPriorityPassed = state.players.map(() => false);
  const player = state.players[0];
  if (player) {
    player.hasPlayedLand = false;
    player.landsPlayedThisTurn = 0;
  }
  setHugeMana(state, 'human');
  return state;
}

function cardsByName(state, playerId, name) {
  return [...state.cards.values()].filter(card => {
    if (card.ownerId !== playerId) return false;
    const def = state.cardDefinitions.get(card.definitionId);
    return def?.name === name;
  });
}

function moveCard(state, instanceId, zone) {
  const card = state.cards.get(instanceId);
  if (!card) return null;
  const next = { ...card, zone, tapped: false, summoningSick: false, damage: 0 };
  state.cards.set(instanceId, next);
  return next;
}

function seedBattlefieldTargets(state, skipName) {
  for (const playerId of ['human', 'ai1']) {
    const wanted = new Set(['creature', 'artifact', 'enchantment', 'planeswalker', 'land']);
    for (const card of [...state.cards.values()]) {
      if (card.ownerId !== playerId || card.zone !== 'library') continue;
      const def = state.cardDefinitions.get(card.definitionId);
      if (!def || def.name === skipName) continue;
      const match = def.card_types.find(type => wanted.has(type));
      if (!match) continue;
      moveCard(state, card.instanceId, 'battlefield');
      wanted.delete(match);
      if (wanted.size === 0) break;
    }
  }
}

function resolveStackFully(engine, state, limit = 12) {
  let current = state;
  const resolutions = [];
  for (let index = 0; index < limit && current.stack.length > 0; index += 1) {
    const top = current.stack[current.stack.length - 1];
    resolutions.push(top.kind);
    current = engine.resolveTopOfStack(current);
  }
  return { state: current, resolutions };
}

function firstOkManaTap(engine, state, playerId, cardId) {
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) {
    const result = engine.tryTapLandForMana(state, playerId, cardId, color);
    if (result.ok) return { color, result };
  }
  return null;
}

async function runEngineSweep(deck) {
  const importPath = artifact(`${deck.slug}-import.json`);
  const reportPath = artifact(`${deck.slug}-engine-report.json`);
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd', 'test', '--', 'src/__tests__/archidekt-certification.test.ts']
    : ['test', '--', 'src/__tests__/archidekt-certification.test.ts'];
  const result = spawnSync(command, args, {
    cwd: path.resolve('engine'),
    encoding: 'utf8',
    env: {
      ...process.env,
      ARCHIDEKT_IMPORT_JSON: path.resolve(importPath),
      ARCHIDEKT_ENGINE_REPORT_JSON: path.resolve(reportPath),
    },
  });
  const report = fs.existsSync(reportPath)
    ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    : {
        commander: null,
        totalUniqueCards: 0,
        passed: 0,
        failures: [{ name: deck.slug, stage: 'test_runner', error: result.error?.message || result.stderr || result.stdout || 'No engine report written' }],
        passes: [],
      };
  report.ok = result.status === 0 && report.failures.length === 0;
  report.stdout = result.stdout;
  report.stderr = result.stderr;
  return report;
}

(async () => {
  assert(DECKS.length > 0, 'No decks selected for certification');
  const browser = await chromium.launch({ headless: HEADLESS });
  const reports = [];
  try {
    for (const deck of DECKS) {
      console.log(`\n=== ${deck.slug} ===`);
      const importedInfo = await importDeck(deck.url);
      const { parsed, imported } = importedInfo;
      const deckReport = {
        deck,
        parsed: {
          commander: parsed.commander,
          sourceCardCount: parsed.cards.length,
        },
        imported: {
          commander: imported.commander,
          total: imported.total,
          valid: imported.valid,
          cardCount: imported.cards.length,
          landCount: imported.lands.length,
          filledCards: imported.filled_cards || [],
          errors: imported.errors || [],
          warnings: imported.warnings || [],
        },
      };
      fs.writeFileSync(artifact(`${deck.slug}-import.json`), JSON.stringify(importedInfo, null, 2));

      deckReport.ui = await runUiDeckPass(browser, deck, imported);
      deckReport.engine = await runEngineSweep(deck, imported);
      deckReport.ok = Boolean(imported.valid && deckReport.ui.ok && deckReport.engine.ok);
      reports.push(deckReport);
      fs.writeFileSync(artifact(`${deck.slug}-report.json`), JSON.stringify(deckReport, null, 2));
      console.log(JSON.stringify({
        deck: deck.slug,
        ok: deckReport.ok,
        uiOk: deckReport.ui.ok,
        sourceCardCount: deckReport.parsed.sourceCardCount,
        filledCards: deckReport.imported.filledCards,
        engineFailures: deckReport.engine.failures.length,
        firstFailures: deckReport.engine.failures.slice(0, 8),
      }, null, 2));
    }
  } finally {
    await browser.close();
  }

  const summary = {
    ok: reports.every(report => report.ok),
    runId: RUN_ID,
    artifactDir: runDir,
    reports: reports.map(report => ({
      deck: report.deck.slug,
      commander: report.imported.commander,
      ok: report.ok,
      uiOk: report.ui.ok,
      engineOk: report.engine.ok,
      engineFailures: report.engine.failures.length,
      filledCards: report.imported.filledCards,
    })),
  };
  fs.writeFileSync(artifact('summary.json'), JSON.stringify({ ...summary, fullReports: reports }, null, 2));
  console.log(`\nSUMMARY ${JSON.stringify(summary, null, 2)}`);
  process.exit(summary.ok ? 0 : 1);
})().catch(error => {
  const result = {
    ok: false,
    artifactDir: runDir,
    error: error.stack || error.message,
  };
  fs.writeFileSync(artifact('fatal.json'), JSON.stringify(result, null, 2));
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
