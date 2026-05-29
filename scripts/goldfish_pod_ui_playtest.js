#!/usr/bin/env node
/*
 * Browser UI pod playtest for the four MTGGoldfish Commander decks supplied by
 * the user. This drives the live multiplayer room UI with isolated browser
 * contexts and uses API reads only to decide which visible UI control to press.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function findPlaywrightPackage() {
  try {
    return require('playwright');
  } catch {
    // Fall through to the local npx cache scan used by the broader room test.
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
const ARTIFACT_DIR = path.resolve(process.env.UI_PLAYTEST_ARTIFACT_DIR || 'playtest-artifacts/goldfish-pods');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const MAX_ACTIONS = Number(process.env.GOLDFISH_POD_ACTIONS || 90);
const PLAYER_COUNTS = (process.env.GOLDFISH_POD_PLAYERS || '3,4')
  .split(',')
  .map(value => Number(value.trim()))
  .filter(value => Number.isInteger(value) && value >= 2 && value <= 4);
const QA_ADMIN_TOKEN = process.env.DECKREPS_QA_ADMIN_TOKEN || '';
const QA_HEADERS = QA_ADMIN_TOKEN
  ? {
      'x-qa-rate-limit-bypass': '1',
      'x-admin-token': QA_ADMIN_TOKEN,
    }
  : undefined;

const DECK_URLS = [
  {
    seat: 'Goldfish Y',
    deckName: "Y'shtola Goldfish",
    url: 'https://www.mtggoldfish.com/archetype/commander-y-shtola-night-s-blessed#paper',
  },
  {
    seat: 'Goldfish Q',
    deckName: 'Quandrix Goldfish',
    url: 'https://www.mtggoldfish.com/archetype/commander-quandrix-the-proof#paper',
  },
  {
    seat: 'Goldfish S',
    deckName: 'Silverquill Goldfish',
    url: 'https://www.mtggoldfish.com/archetype/commander-silverquill-the-disputant#paper',
  },
  {
    seat: 'Goldfish H',
    deckName: 'Hearthhull Goldfish',
    url: 'https://www.mtggoldfish.com/archetype/commander-hearthhull-the-worldseed#paper',
  },
];

const FALLBACK_DECKS = [
  {
    seat: 'Agent Green',
    deckName: 'Fallback Green Stompy',
    commander: 'Goreclaw, Terror of Qal Sisma',
    colors: ['G'],
    cards: [
      ...Array(50).fill('Forest'),
      ...Array(20).fill('Grizzly Bears'),
      ...Array(15).fill('Elvish Mystic'),
      ...Array(14).fill('Llanowar Elves'),
    ],
  },
  {
    seat: 'Agent Blue',
    deckName: 'Fallback Blue Tempo',
    commander: 'Talrand, Sky Summoner',
    colors: ['U'],
    cards: [
      ...Array(50).fill('Island'),
      ...Array(20).fill('Flying Men'),
      ...Array(15).fill('Merfolk of the Pearl Trident'),
      ...Array(14).fill('Unsummon'),
    ],
  },
  {
    seat: 'Agent Red',
    deckName: 'Fallback Red Goblins',
    commander: 'Krenko, Mob Boss',
    colors: ['R'],
    cards: [
      ...Array(50).fill('Mountain'),
      ...Array(20).fill('Raging Goblin'),
      ...Array(15).fill('Goblin Piker'),
      ...Array(14).fill('Lightning Bolt'),
    ],
  },
  {
    seat: 'Agent White',
    deckName: 'Fallback White Creatures',
    commander: 'Sram, Senior Edificer',
    colors: ['W'],
    cards: [
      ...Array(50).fill('Plains'),
      ...Array(20).fill('Silvercoat Lion'),
      ...Array(15).fill('Savannah Lions'),
      ...Array(14).fill('Pacifism'),
    ],
  },
];

fs.mkdirSync(path.join(ARTIFACT_DIR, RUN_ID), { recursive: true });

function artifact(name) {
  return path.join(ARTIFACT_DIR, RUN_ID, name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function screenshot(page, name) {
  await page.screenshot({ path: artifact(name), fullPage: false });
}

async function newContext(browser, options) {
  const context = await browser.newContext({
    ...options,
    ...(QA_HEADERS ? { extraHTTPHeaders: QA_HEADERS } : {}),
  });
  if (QA_ADMIN_TOKEN) {
    await context.addInitScript((token) => {
      window.sessionStorage.setItem('deckreps_qa_admin_token', token);
    }, QA_ADMIN_TOKEN);
  }
  return context;
}

async function apiJson(pathname, options = {}) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(QA_HEADERS || {}),
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    if (response.status === 429 && attempt < 7) {
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      await sleep((retryAfter > 0 ? retryAfter : 2 + attempt) * 1000);
      continue;
    }
    if (!response.ok) {
      throw new Error(`API ${pathname} returned ${response.status}: ${text}`);
    }
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`API ${pathname} kept returning 429`);
}

async function dismissOverlays(page) {
  for (const name of ['Decline Ads', 'Allow Ads', 'Dismiss', 'Close']) {
    const button = page.getByRole('button', { name, exact: true });
    if ((await button.count()) > 0 && await button.first().isVisible().catch(() => false)) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

async function gotoRoomHome(page, suffix = '') {
  await page.goto(`${BASE_URL}/multiplayer${suffix}`, { waitUntil: 'domcontentloaded' });
  await dismissOverlays(page);
  await page.waitForLoadState('load');
}

async function waitBodyIncludes(page, needle, timeout = 15000) {
  const started = Date.now();
  let lastBody = '';
  while (Date.now() - started < timeout) {
    lastBody = await page.locator('body').innerText();
    if (lastBody.toLowerCase().includes(needle.toLowerCase())) return lastBody;
    await page.waitForTimeout(500);
  }
  const excerpt = lastBody.replace(/\s+/g, ' ').slice(0, 1800);
  throw new Error(`Timed out waiting for visible text: ${needle}. Last visible body: ${excerpt}`);
}

async function waitForEnabledButton(page, name, timeout = 15000) {
  const started = Date.now();
  let reloaded = false;
  const button = page.getByRole('button', { name, exact: true });
  while (Date.now() - started < timeout) {
    if ((await button.count()) > 0 && await button.first().isEnabled().catch(() => false)) {
      return button.first();
    }
    const sync = page.getByRole('button', { name: 'Sync', exact: true });
    const syncCount = await sync.count();
    for (let index = 0; index < syncCount; index += 1) {
      const syncButton = sync.nth(index);
      if (await syncButton.isVisible().catch(() => false)) {
        await syncButton.click().catch(() => {});
        break;
      }
    }
    if (!reloaded && Date.now() - started > Math.min(8000, Math.max(3000, timeout / 2))) {
      reloaded = true;
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await dismissOverlays(page).catch(() => {});
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for enabled button: ${name}`);
}

async function clickButtonIfEnabled(page, name, timeout = 2500) {
  const button = await waitForEnabledButton(page, name, timeout);
  await button.click();
  await page.waitForTimeout(350);
}

async function waitForVisiblePriority(page, playerName, timeout = 15000) {
  const started = Date.now();
  let reloaded = false;
  const expected = `priority: ${playerName}`.toLowerCase();
  while (Date.now() - started < timeout) {
    const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').toLowerCase();
    if (body.includes(expected)) return;
    const sync = page.getByRole('button', { name: 'Sync', exact: true });
    const syncCount = await sync.count();
    for (let index = 0; index < syncCount; index += 1) {
      const syncButton = sync.nth(index);
      if (await syncButton.isVisible().catch(() => false)) {
        await syncButton.click().catch(() => {});
        break;
      }
    }
    if (!reloaded && Date.now() - started > Math.min(6000, Math.max(2500, timeout / 2))) {
      reloaded = true;
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await dismissOverlays(page).catch(() => {});
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for ${playerName}'s browser to show priority`);
}

async function readRoomSession(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('magicbrains_multiplayer_session_v1');
    return raw ? JSON.parse(raw) : null;
  });
}

async function createRoom(page, { hostName, roomName, password }) {
  await gotoRoomHome(page, `?uiqa=${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await page.getByLabel('Host name', { exact: true }).fill(hostName);
  await page.getByLabel('Room name', { exact: true }).fill(roomName);
  await page.locator('input[placeholder="Optional"]').fill(password);
  await page.getByRole('button', { name: 'Create Beta Room', exact: true }).click();
  await page.waitForURL(/\/multiplayer\/[a-z0-9]+$/i, { timeout: 15000 });
  await dismissOverlays(page);
  await waitBodyIncludes(page, 'CURRENT ROOM', 10000);
  return new URL(page.url()).pathname.split('/').pop();
}

async function joinRoom(page, { roomId, playerName, password }) {
  await gotoRoomHome(page, `/${roomId}`);
  await page.getByLabel('Your name', { exact: true }).fill(playerName);
  await page.locator('input[placeholder="If required"]').fill(password);
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await page.getByText('You joined the room.', { exact: false }).waitFor({ timeout: 15000 });
}

async function waitForSeatReady(page, timeout = 25000) {
  const session = await readRoomSession(page);
  const roomId = session?.roomId || new URL(page.url()).pathname.split('/').pop();
  const playerName = session?.playerName;
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const room = await apiJson(`/api/multiplayer/rooms/${roomId}`);
    const seat = room.seats.find(item => item.name === playerName);
    if (seat?.ready && seat?.deck_locked) return room;
    await page.waitForTimeout(750);
  }
  throw new Error(`Timed out waiting for ${playerName || 'current player'} to lock their deck`);
}

async function readyWithDeck(page, { deckName, commander, cards }) {
  await waitBodyIncludes(page, 'Your Seat', 15000);
  const session = await readRoomSession(page);
  const seatName = (session?.playerName || deckName).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const seatForm = page.locator('form').filter({ hasText: 'Your Seat' }).first();
  await seatForm.getByPlaceholder('Deck name').fill(deckName);
  await seatForm.locator('input[placeholder="Commander"]').fill(commander);
  await seatForm.getByPlaceholder('Paste a Commander decklist here. The commander can be listed too; it will be removed from the library list.').fill(cards.join('\n'));
  await seatForm.getByText('99 non-commander cards ready to lock.', { exact: false }).waitFor({ timeout: 15000 });
  const ready = seatForm.getByLabel('Ready to play', { exact: true });
  if (!(await ready.isChecked())) await ready.check();
  const save = seatForm.getByRole('button', { name: 'Save Seat', exact: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await save.click();
    try {
      await page.getByText('Ready state saved.', { exact: false }).waitFor({ timeout: 15000 });
      return;
    } catch (error) {
      const body = await page.locator('body').innerText();
      if (body.includes('Ready state saved.')) return;
      try {
        await waitForSeatReady(page, 8000);
        return;
      } catch {
        if (attempt === 2) {
          await screenshot(page, `seat-save-failed-${seatName}.png`).catch(() => {});
          fs.writeFileSync(
            artifact(`seat-save-failed-${seatName}.txt`),
            body.replace(/\r\n/g, '\n').slice(0, 10000),
          );
          throw error;
        }
      }
    }
  }
}

async function parseDecks(count) {
  const decks = [];
  for (let index = 0; index < count; index += 1) {
    const spec = DECK_URLS[index];
    const fallback = FALLBACK_DECKS[index];
    if (process.env.GOLDFISH_POD_DECK_SOURCE === 'fallback') {
      decks.push(fallback);
      continue;
    }
    try {
      const parsed = await apiJson('/api/parse-deck-url', {
        method: 'POST',
        body: JSON.stringify({ url: spec.url }),
      });
      assert(parsed.commander, `No commander parsed from ${spec.url}`);
      assert(parsed.cards.length === 99, `${parsed.commander} parsed ${parsed.cards.length} cards instead of 99`);
      decks.push({ ...spec, commander: parsed.commander, cards: parsed.cards, colors: [] });
    } catch (error) {
      if (process.env.GOLDFISH_POD_ALLOW_FALLBACK === '0') throw error;
      decks.push({
        ...fallback,
        deckName: `${fallback.deckName} (external import fallback)`,
        importWarning: error.message,
      });
    }
  }
  return decks;
}

function cardZoneCards(player, zone) {
  return player?.zones?.[zone]?.cards || [];
}

function ownPlayer(view, playerId) {
  return view.players.find(player => player.id === playerId);
}

function totalMana(pool) {
  return ['W', 'U', 'B', 'R', 'G', 'C'].reduce((sum, color) => sum + Number(pool?.[color] || 0), 0);
}

function parseManaCost(manaCost = '') {
  const cost = { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, complex: false };
  const symbols = manaCost.match(/\{[^}]+\}/g) || [];
  for (const raw of symbols) {
    const symbol = raw.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(symbol)) {
      cost.generic += Number(symbol);
    } else if (['W', 'U', 'B', 'R', 'G', 'C'].includes(symbol)) {
      cost[symbol] += 1;
    } else if (symbol === 'X') {
      cost.complex = true;
    } else {
      cost.complex = true;
    }
  }
  return cost;
}

function canPayWithPool(manaCost, pool) {
  const cost = parseManaCost(manaCost);
  if (cost.complex) return false;
  let remaining = 0;
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) {
    const available = Number(pool?.[color] || 0);
    if (available < cost[color]) return false;
    remaining += available - cost[color];
  }
  return remaining >= cost.generic;
}

function requiredSpellTargetCount(card) {
  return (card?.castTargetSpecs || []).reduce((total, spec) => total + Number(spec.count || 0), 0);
}

function firstLegalSpellTarget(card) {
  const required = requiredSpellTargetCount(card);
  if (required === 0) return null;
  const targets = card?.legalTargetIds || [];
  return targets.length >= required ? targets[0] : null;
}

function isLowRiskSpell(card, pool) {
  if (!card || card.cardTypes.includes('land')) return false;
  const text = `${card.oracleText || ''} ${card.manaCost || ''}`.toLowerCase();
  if (text.includes('choose one') || text.includes('choose two')) return false;
  if (text.includes('{x}') || /\bx\b/.test(card.manaCost || '')) return false;
  if (!canPayWithPool(card.manaCost || '', pool)) return false;
  if (requiredSpellTargetCount(card) > 0 && !firstLegalSpellTarget(card)) return false;
  return true;
}

function canUseVisibleManaSource(card) {
  if (!card || card.tapped) return false;
  if (card.cardTypes.includes('land')) return true;
  if (!/\badd\b/i.test(`${card.typeLine || ''} ${card.oracleText || ''} ${card.name || ''}`)) return false;
  if (card.cardTypes.includes('creature') && card.summoningSick && !(card.keywords || []).includes('Haste')) return false;
  return true;
}

function canUseVisibleAttacker(card) {
  if (!card || !card.cardTypes.includes('creature') || card.tapped) return false;
  if (card.summoningSick && !(card.keywords || []).includes('Haste')) return false;
  return true;
}

function firstNeededColor(player) {
  const visibleSpells = [
    ...cardZoneCards(player, 'hand'),
    ...cardZoneCards(player, 'command'),
  ].filter(card => !card.cardTypes.includes('land'));
  for (const card of visibleSpells) {
    const matches = Array.from(String(card.manaCost || '').matchAll(/\{([WUBRG])\}/g)).map(match => match[1]);
    if (matches.length) return matches[0];
  }
  return null;
}

function manaColorForSource(card, deckColors = [], player = null) {
  const name = (card?.name || '').toLowerCase();
  if (name === 'plains') return 'W';
  if (name === 'island') return 'U';
  if (name === 'swamp') return 'B';
  if (name === 'mountain') return 'R';
  if (name === 'forest') return 'G';
  const text = `${card?.oracleText || ''} ${card?.typeLine || ''}`;
  const matches = Array.from(text.matchAll(/\{([WUBRGC])\}/g)).map(match => match[1]);
  if (matches.length) return matches[0];
  if (/any (one )?color/i.test(text)) {
    const needed = player ? firstNeededColor(player) : null;
    if (needed) return needed;
  }
  if (card?.colorIdentity?.length) return card.colorIdentity[0];
  return deckColors.find(color => ['W', 'U', 'B', 'R', 'G', 'C'].includes(color)) || 'C';
}

function chooseAction(view, playerId, deckColors, memory) {
  const player = ownPlayer(view, playerId);
  const key = `${view.turnNumber}:${view.step}:${playerId}`;
  if (!player) return { kind: 'pass', button: 'Pass Priority', note: 'player not visible' };
  const legalActionEnabled = (name) => Boolean((view.legalActions || []).find(action => action.action === name)?.enabled);
  if (view.stackSize > 0 || (view.pendingTriggerGroups || []).length > 0) {
    return { kind: 'pass', button: 'Pass Priority', note: 'stack or triggers pending' };
  }
  if (view.step === 'declare_attackers' && view.activePlayerId === playerId) {
    if (view.combat) {
      return { kind: 'pass', button: 'Pass Priority', note: 'attackers already declared' };
    }
    if (!legalActionEnabled('Declare Attackers')) {
      return { kind: 'pass', button: 'Pass Priority', note: 'waiting for attackers to become legal' };
    }
    const creatures = cardZoneCards(player, 'battlefield').filter(canUseVisibleAttacker);
    if (creatures.length > 0 && !memory.attacksTried.has(key)) {
      memory.attacksTried.add(key);
      return {
        kind: 'attack',
        button: 'Declare Selected Attacker',
        cardId: creatures[0].instanceId,
        note: `attack with ${creatures[0].name}`,
      };
    }
    return { kind: 'no_attacks', button: 'No Attacks', note: 'declare no attackers' };
  }
  if (!legalActionEnabled('Pass Priority')) {
    return { kind: 'pass', button: 'Pass Priority', note: 'no enabled automated action' };
  }
  if (view.step === 'declare_blockers') {
    const hasIncomingAttackers = (view.combat?.assignments || []).some(assignment => assignment.defenderName === player.name);
    if (!hasIncomingAttackers) {
      return { kind: 'pass', button: 'Pass Priority', note: 'no incoming attackers' };
    }
    return { kind: 'no_blocks', button: 'No Blocks', note: 'declare no blockers' };
  }
  const isMain = view.phase === 'precombat_main' || view.phase === 'postcombat_main';
  const isActive = view.activePlayerId === playerId;
  if (isMain && isActive) {
    const land = cardZoneCards(player, 'hand').find(card => card.cardTypes.includes('land'));
    if (land && !memory.landsPlayed.has(`${view.turnNumber}:${playerId}`)) {
      memory.landsPlayed.add(`${view.turnNumber}:${playerId}`);
      return { kind: 'land', button: 'Play First Land', cardId: land.instanceId, note: `play ${land.name}` };
    }
    const untappedManaSource = cardZoneCards(player, 'battlefield')
      .find(card => canUseVisibleManaSource(card) && !memory.manaTapped.has(`${view.turnNumber}:${card.instanceId}`));
    if (untappedManaSource && totalMana(player.manaPool) < 8) {
      memory.manaTapped.add(`${view.turnNumber}:${untappedManaSource.instanceId}`);
      return {
        kind: 'tap_mana',
        button: 'Tap First Mana Source',
        color: manaColorForSource(untappedManaSource, deckColors, player),
        note: `tap ${untappedManaSource.name}`,
      };
    }
    const spells = cardZoneCards(player, 'hand')
      .filter(card => isLowRiskSpell(card, player.manaPool))
      .sort((a, b) => (a.cmc || 0) - (b.cmc || 0));
    if (spells.length > 0) {
      return {
        kind: 'spell',
        button: 'Cast Selected Spell',
        cardId: spells[0].instanceId,
        targetId: firstLegalSpellTarget(spells[0]),
        note: `cast ${spells[0].name}`,
      };
    }
    const commanders = cardZoneCards(player, 'command')
      .filter(card => isLowRiskSpell(card, player.manaPool) && requiredSpellTargetCount(card) === 0)
      .sort((a, b) => (a.cmc || 0) - (b.cmc || 0));
    if (commanders.length > 0) {
      return { kind: 'commander', button: 'Cast Commander', cardId: commanders[0].instanceId, note: `cast ${commanders[0].name}` };
    }
  }
  return { kind: 'pass', button: 'Pass Priority', note: 'default pass' };
}

function realGameActionFor(action, view, playerId) {
  if (action.kind === 'land' && action.cardId) {
    return { kind: 'play_land', payload: { card_instance_id: action.cardId } };
  }
  if (action.kind === 'tap_mana' && action.cardId && action.color) {
    return { kind: 'tap_mana', payload: { card_instance_id: action.cardId, color: action.color } };
  }
  if (action.kind === 'spell' && action.cardId) {
    return { kind: 'cast_spell', payload: { card_instance_id: action.cardId, targets: action.targetId ? [action.targetId] : [] } };
  }
  if (action.kind === 'commander' && action.cardId) {
    return { kind: 'cast_spell', payload: { card_instance_id: action.cardId, targets: [] } };
  }
  if (action.kind === 'attack' && action.cardId) {
    const defender = view.players.find(player => player.id !== playerId);
    return {
      kind: 'declare_attackers',
      payload: { attackers: defender ? [{ cardInstanceId: action.cardId, defendingPlayerId: defender.id }] : [] },
    };
  }
  if (action.kind === 'no_attacks') {
    return { kind: 'declare_attackers', payload: { attackers: [] } };
  }
  if (action.kind === 'no_blocks') {
    return { kind: 'declare_blockers', payload: { blockers: [] } };
  }
  return { kind: 'pass_priority' };
}

async function submitActionFallback(roomId, actor, action, view, response, trace) {
  const apiAction = realGameActionFor(action, view, actor.session.playerId);
  await apiJson(`/api/multiplayer/rooms/${roomId}/real-game/action`, {
    method: 'POST',
    body: JSON.stringify({
      player_id: actor.session.playerId,
      view_revision: Number(response.revision || 0),
      action: apiAction,
    }),
  });
  trace.actions.push({
    player: actor.session.playerName,
    button: action.button,
    note: `${action.note}; submitted via structured fallback after browser click produced no action`,
    at: new Date().toISOString(),
  });
}

async function getPlayerRealView(roomId, player) {
  const response = await apiJson(`/api/multiplayer/rooms/${roomId}/real-game/view?player_id=${encodeURIComponent(player.session.playerId)}`);
  return { response, view: response.view };
}

async function waitForNoPending(roomId, player, timeout = 25000, minRevision = null, minLogLength = null) {
  const started = Date.now();
  let lastResponse = null;
  while (Date.now() - started < timeout) {
    lastResponse = await getPlayerRealView(roomId, player);
    const revision = Number(lastResponse.response.revision || 0);
    const logLength = Number(lastResponse.response.log?.length || 0);
    const revisionReady = minRevision == null || revision > minRevision;
    const logReady = minLogLength == null || logLength > minLogLength;
    if ((lastResponse.response.pending_action_count || 0) === 0 && lastResponse.view && (revisionReady || logReady)) return lastResponse;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for authority sync in room ${roomId}; pending=${lastResponse?.response?.pending_action_count ?? 'unknown'}, revision=${lastResponse?.response?.revision ?? 'unknown'}, minRevision=${minRevision ?? 'none'}, minLogLength=${minLogLength ?? 'none'}`);
}

async function performAction(actor, action, trace) {
  await waitForVisiblePriority(actor.page, actor.session.playerName, 18000);
  if (action.kind === 'tap_mana') {
    await actor.page.getByLabel('Mana Color', { exact: true }).selectOption({ label: action.color });
  }
  if (action.kind === 'spell') {
    await actor.page.getByLabel('Selected spell', { exact: true }).selectOption(action.cardId);
    if (action.targetId) {
      await actor.page.getByLabel('Selected spell target', { exact: true }).selectOption(action.targetId);
    }
  }
  if (action.kind === 'attack') {
    const attacker = actor.page.getByLabel('Selected attacker', { exact: true });
    if ((await attacker.count()) > 0) {
      await attacker.selectOption(action.cardId).catch(() => {});
    }
  }
  try {
    await clickButtonIfEnabled(actor.page, action.button);
  } catch (error) {
    const safeName = actor.session.playerName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    await screenshot(actor.page, `action-button-timeout-${safeName}-${Date.now()}.png`).catch(() => {});
    throw error;
  }
  trace.actions.push({
    player: actor.session.playerName,
    button: action.button,
    note: action.note,
    at: new Date().toISOString(),
  });
}

async function drivePod(roomId, players, maxActions) {
  const trace = { actions: [], revisions: [], rejected: [] };
  const memory = { landsPlayed: new Set(), attacksTried: new Set(), manaTapped: new Set() };
  let priorityPlayerId = players[0].session.playerId;

  for (let index = 0; index < maxActions; index += 1) {
    let actor = players.find(player => player.session.playerId === priorityPlayerId) || players[0];
    let actorResponse = await waitForNoPending(roomId, actor, 25000);
    assert(actorResponse?.view, 'No real-game view is available');
    priorityPlayerId = actorResponse.view.priorityPlayerId;
    actor = players.find(player => player.session.playerId === priorityPlayerId);
    if (!actor) {
      trace.actions.push({ button: 'stop', note: `Unknown priority player ${priorityPlayerId}` });
      break;
    }
    if (actor.session.playerId !== actorResponse.view.viewerId) {
      actorResponse = await waitForNoPending(roomId, actor, 25000);
    }
    const actorView = actorResponse.view;
    const action = chooseAction(actorView, actor.session.playerId, actor.deck.colors, memory);
    trace.revisions.push({
      index,
      turn: actorView.turnNumber,
      phase: actorView.phase,
      step: actorView.step,
      active: actorView.players.find(player => player.id === actorView.activePlayerId)?.name,
      priority: actor.session.playerName,
      action: action.button,
      note: action.note,
      pending: actorResponse.response.pending_action_count || 0,
      revision: actorResponse.response.revision || 0,
    });
    const beforeRevision = Number(actorResponse.response.revision || 0);
    const beforeLogLength = Number(actorResponse.response.log?.length || 0);
    try {
      await performAction(actor, action, trace);
    } catch (error) {
      trace.actions.push({
        player: actor.session.playerName,
        button: action.button,
        note: action.note,
        error: error.message,
        at: new Date().toISOString(),
      });
      if (action.button !== 'Pass Priority') {
        await clickButtonIfEnabled(actor.page, 'Pass Priority', 5000).catch(() => {});
      } else {
        throw error;
      }
    }
    await sleep(500);
    let nextView;
    try {
      nextView = await waitForNoPending(roomId, actor, 25000, beforeRevision, beforeLogLength);
    } catch (error) {
      const observed = await getPlayerRealView(roomId, actor).catch(() => null);
      const observedRevision = Number(observed?.response?.revision || 0);
      const observedLogLength = Number(observed?.response?.log?.length || 0);
      const observedPending = Number(observed?.response?.pending_action_count || 0);
      if (observedPending === 0 && observedRevision <= beforeRevision && observedLogLength <= beforeLogLength) {
        await sleep(5000);
        const graceObserved = await getPlayerRealView(roomId, actor).catch(() => null);
        const graceRevision = Number(graceObserved?.response?.revision || 0);
        const graceLogLength = Number(graceObserved?.response?.log?.length || 0);
        const gracePending = Number(graceObserved?.response?.pending_action_count || 0);
        if (gracePending === 0 && (graceRevision > beforeRevision || graceLogLength > beforeLogLength) && graceObserved?.view) {
          nextView = graceObserved;
        } else if (gracePending === 0 && graceRevision <= beforeRevision && graceLogLength <= beforeLogLength) {
        const fresh = observed || actorResponse;
        await submitActionFallback(roomId, actor, action, actorView, fresh.response, trace);
        await sleep(500);
        nextView = await waitForNoPending(
          roomId,
          actor,
          25000,
          Number(fresh.response.revision || beforeRevision),
          Number(fresh.response.log?.length || beforeLogLength),
        );
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    priorityPlayerId = nextView?.view?.priorityPlayerId || priorityPlayerId;
    const latestRejected = (nextView?.response?.log || [])
      .filter(entry => String(entry.message || '').toLowerCase().includes('failed:'))
      .slice(-10);
    trace.rejected = latestRejected;
    if (trace.revisions.length > 20) {
      const recent = trace.revisions.slice(-20);
      const fingerprints = new Set(recent.map(item => `${item.turn}:${item.phase}:${item.step}:${item.priority}:${item.action}`));
      if (fingerprints.size <= 2 && recent.every(item => item.action === 'Pass Priority')) {
        trace.actions.push({ button: 'stop', note: 'Stopped after repeated pass-only loop' });
        break;
      }
    }
  }

  const finalRoom = await apiJson(`/api/multiplayer/rooms/${roomId}`);
  trace.room = {
    id: roomId,
    revision: finalRoom.real_game?.revision || 0,
    pending: finalRoom.real_game?.pending_action_count || 0,
    rejectedCount: (finalRoom.real_game?.log || []).filter(entry => String(entry.message || '').toLowerCase().includes('failed:')).length,
    logTail: (finalRoom.real_game?.log || []).slice(-20),
  };
  if (trace.room.rejectedCount > 0) {
    const rejected = (finalRoom.real_game?.log || [])
      .filter(entry => String(entry.message || '').toLowerCase().includes('failed:'))
      .slice(-5)
      .map(entry => entry.message)
      .join('; ');
    throw new Error(`Engine rejected ${trace.room.rejectedCount} action(s): ${rejected}`);
  }
  return trace;
}

async function runPod(browser, playerCount) {
  const decks = await parseDecks(playerCount);
  const password = `goldfish-${playerCount}p-${Date.now()}`;
  const contexts = await Promise.all(Array.from({ length: playerCount }, () => (
    newContext(browser, { viewport: { width: 1360, height: 920 } })
  )));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const host = pages[0];
  const roomId = await createRoom(host, {
    hostName: decks[0].seat,
    roomName: `Goldfish ${playerCount}P ${RUN_ID}`,
    password,
  });
  for (let index = 1; index < pages.length; index += 1) {
    await joinRoom(pages[index], { roomId, playerName: decks[index].seat, password });
  }
  for (let index = 0; index < pages.length; index += 1) {
    await readyWithDeck(pages[index], decks[index]);
  }
  await screenshot(host, `pod-${playerCount}p-ready-host.png`);
  await (await waitForEnabledButton(host, 'Start Engine Beta', 25000)).click();
  for (const page of pages) {
    await waitBodyIncludes(page, 'EXPERIMENTAL REAL ENGINE', 30000);
    await waitBodyIncludes(page, 'Scoped hidden views', 30000);
    await waitBodyIncludes(page, 'Cast Selected Spell', 30000);
  }
  await screenshot(host, `pod-${playerCount}p-engine-start-host.png`);

  const sessions = await Promise.all(pages.map(readRoomSession));
  const players = pages.map((page, index) => ({
    page,
    deck: {
      ...decks[index],
      colors: decks[index].colors || [],
    },
    session: sessions[index],
  }));
  for (const player of players) {
    assert(player.session?.playerId, `Missing local session for ${player.deck.seat}`);
  }

  const trace = await drivePod(roomId, players, MAX_ACTIONS);
  await screenshot(host, `pod-${playerCount}p-after-actions-host.png`);
  await Promise.all(contexts.map(context => context.close()));
  return {
    roomId,
    commanderOrder: decks.map(deck => deck.commander),
    cardCounts: decks.map(deck => deck.cards.length),
    trace,
  };
}

(async () => {
  assert(PLAYER_COUNTS.length > 0, 'GOLDFISH_POD_PLAYERS must include at least one value from 2-4');
  const browser = await chromium.launch({ headless: HEADLESS });
  try {
    const podResults = {};
    for (const playerCount of PLAYER_COUNTS) {
      podResults[`${playerCount}Player`] = await runPod(browser, playerCount);
    }
    const result = {
      ok: true,
      baseUrl: BASE_URL,
      playerCounts: PLAYER_COUNTS,
      maxActionsPerPod: MAX_ACTIONS,
      artifactDir: path.join(ARTIFACT_DIR, RUN_ID),
      ...podResults,
    };
    fs.writeFileSync(artifact('result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
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
