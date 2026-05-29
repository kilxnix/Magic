#!/usr/bin/env node
/*
 * Full UI playtest for DeckReps multiplayer rooms.
 *
 * This intentionally drives the live React UI with two isolated browser
 * contexts. API checks are only supplemental where no UI control exists.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function findPlaywrightPackage() {
  try {
    return require('playwright');
  } catch {
    // npx playwright is commonly available in the npm cache on the desktop box.
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

const BASE_URL = (process.env.DECKREPS_BASE_URL || 'https://deckreps.app').replace(/\/$/, '');
const HEADLESS = process.env.HEADLESS !== '0';
const ARTIFACT_DIR = path.resolve(process.env.UI_PLAYTEST_ARTIFACT_DIR || 'playtest-artifacts/rooms');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const QA_ADMIN_TOKEN = process.env.DECKREPS_QA_ADMIN_TOKEN || '';
const QA_HEADERS = QA_ADMIN_TOKEN
  ? {
      'x-qa-rate-limit-bypass': '1',
      'x-admin-token': QA_ADMIN_TOKEN,
    }
  : undefined;

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

async function waitForEnabledButton(page, name, timeout = 15000) {
  const started = Date.now();
  const button = page.getByRole('button', { name, exact: true });
  while (Date.now() - started < timeout) {
    if ((await button.count()) > 0 && await button.first().isEnabled().catch(() => false)) {
      return button.first();
    }
    const sync = page.getByRole('button', { name: 'Sync', exact: true });
    if ((await sync.count()) === 1) {
      await sync.click().catch(() => {});
    }
    await page.waitForTimeout(750);
  }
  throw new Error(`Timed out waiting for enabled button: ${name}`);
}

async function fillChat(page, message) {
  const chat = page.getByPlaceholder('Message the room. Links and unsafe content are blocked.');
  await chat.fill(message);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

async function createRoom(page, { hostName, roomName, password, mobile = false }) {
  await gotoRoomHome(page, `?uiqa=${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await page.getByLabel('Host name', { exact: true }).fill(hostName);
  await page.getByLabel('Room name', { exact: true }).fill(roomName);
  await page.locator('input[placeholder="Optional"]').fill(password);
  await page.getByRole('button', { name: 'Create Beta Room', exact: true }).click();
  await page.waitForURL(/\/multiplayer\/[a-z0-9]+$/i, { timeout: 15000 });
  await dismissOverlays(page);
  await page.getByText('Room created.', { exact: false }).waitFor({ timeout: 5000 }).catch(async () => {
    const body = await page.locator('body').innerText();
    assert(body.includes('CURRENT ROOM') && body.includes(hostName), 'room creation did not land on a seated room');
  });
  const roomId = new URL(page.url()).pathname.split('/').pop();
  const body = await page.locator('body').innerText();
  assert(body.includes('0 non-commander cards ready to lock.'), 'new room carried stale deck draft instead of starting empty');
  await screenshot(page, mobile ? 'mobile-created-room.png' : 'host-created-room.png');
  return roomId;
}

async function readRoomSession(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('magicbrains_multiplayer_session_v1');
    return raw ? JSON.parse(raw) : null;
  });
}

async function waitForSeatReady(page, timeout = 20000) {
  const session = await readRoomSession(page);
  const roomId = session?.roomId || new URL(page.url()).pathname.split('/').pop();
  const playerName = session?.playerName;
  assert(roomId, 'missing room id while waiting for seat readiness');
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const room = await apiJson(`/api/multiplayer/rooms/${roomId}`);
    const seat = playerName
      ? room.seats.find(item => item.name === playerName)
      : room.seats.find(item => item.ready && item.deck_locked);
    if (seat?.ready && seat?.deck_locked) return room;
    await page.waitForTimeout(750);
  }
  throw new Error(`Timed out waiting for ${playerName || 'current player'} to lock their deck`);
}

async function apiJson(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(QA_HEADERS || {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API ${pathname} returned ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function joinRoom(page, { roomId, playerName, password, mobile = false }) {
  await gotoRoomHome(page, `/${roomId}`);
  await page.getByLabel('Your name', { exact: true }).fill(playerName);
  await page.locator('input[placeholder="If required"]').fill(password);
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await page.getByText('You joined the room.', { exact: false }).waitFor({ timeout: 15000 });
  await screenshot(page, mobile ? 'mobile-guest-joined.png' : 'guest-joined.png');
}

async function spectateRoom(page, { roomId, spectatorName, password }) {
  await gotoRoomHome(page, `/${roomId}`);
  await page.getByPlaceholder('Spectator name').fill(spectatorName);
  await page.getByPlaceholder('Room password if required').fill(password);
  await page.getByRole('button', { name: 'Spectate Room', exact: true }).click();
  await page.getByText('Spectator mode opened.', { exact: false }).waitFor({ timeout: 15000 });
  await waitBodyIncludes(page, 'Spectator Mode', 20000);
  await screenshot(page, 'spectator-joined-engine.png');
}

async function chooseStarterAndReady(page, starterName) {
  const seatForm = page.locator('form').filter({ hasText: 'Your Seat' }).first();
  await seatForm.getByRole('button', { name: starterName, exact: true }).click();
  await page.getByText('99 non-commander cards ready to lock.', { exact: false }).waitFor({ timeout: 10000 });
  const ready = seatForm.getByLabel('Ready to play', { exact: true });
  if (!(await ready.isChecked())) await ready.check();
  const save = seatForm.getByRole('button', { name: 'Save Seat', exact: true });
  await save.waitFor({ state: 'visible', timeout: 10000 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
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
        // Keep retrying through the UI below; the API poll only proves whether the UI submit already landed.
      }
      if (!body.includes('Lock a commander and deck list') && attempt === 0) {
        await page.waitForTimeout(500);
        continue;
      }
      throw error;
    }
  }
}

async function readyWithDeck(page, { deckName, commander, cards }) {
  await page.getByPlaceholder('Deck name').fill(deckName);
  await page.locator('input[placeholder="Commander"]').fill(commander);
  await page.getByPlaceholder('Paste a Commander decklist here. The commander can be listed too; it will be removed from the library list.').fill(cards.join('\n'));
  await page.getByText('99 non-commander cards ready to lock.', { exact: false }).waitFor({ timeout: 10000 });
  const ready = page.getByLabel('Ready to play', { exact: true });
  if (!(await ready.isChecked())) await ready.check();
  const save = page.getByRole('button', { name: 'Save Seat', exact: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
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
        // Retry once. Hosted bundles can occasionally update the room before the toast is visible.
      }
      if (attempt === 1) throw error;
    }
  }
}

async function waitBodyIncludes(page, needle, timeout = 15000) {
  const started = Date.now();
  let lastBody = '';
  while (Date.now() - started < timeout) {
    const body = await page.locator('body').innerText();
    lastBody = body;
    if (body.toLowerCase().includes(needle.toLowerCase())) return body;
    await page.waitForTimeout(500);
  }
  const excerpt = lastBody.replace(/\s+/g, ' ').slice(0, 1800);
  throw new Error(`Timed out waiting for visible text: ${needle}. Last visible body: ${excerpt}`);
}

async function clickAction(page, name) {
  const button = await waitForEnabledButton(page, name, 15000);
  await button.click();
  await page.waitForTimeout(600);
}

async function selectTrackerTarget(page, playerName) {
  await page.getByLabel('Target', { exact: true }).selectOption({ label: playerName });
}

async function runSharedMatch(browser) {
  const password = `ui-shared-${Date.now()}`;
  const hostContext = await newContext(browser, { viewport: { width: 1280, height: 900 } });
  const guestContext = await newContext(browser, { viewport: { width: 1280, height: 900 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  const roomId = await createRoom(host, {
    hostName: 'UI Host',
    roomName: `UI Shared Match ${RUN_ID}`,
    password,
  });
  await joinRoom(guest, { roomId, playerName: 'UI Guest', password });

  await fillChat(host, 'Good luck, this is a real UI chat check.');
  await waitBodyIncludes(guest, 'Good luck, this is a real UI chat check.');

  await fillChat(guest, 'send nudes');
  await waitBodyIncludes(guest, 'Message removed by room moderation.');
  await fillChat(guest, 'open https://bad.example');
  await waitBodyIncludes(guest, 'Message removed by room moderation.');

  await chooseStarterAndReady(host, 'Green Big Creatures');
  await chooseStarterAndReady(guest, 'Blue Spell Practice');

  await screenshot(host, 'host-ready-before-start.png');
  await screenshot(guest, 'guest-ready-before-start.png');
  await (await waitForEnabledButton(host, 'Start Shared Table', 20000)).click();
  await waitBodyIncludes(host, 'SHARED TABLE');
  await waitBodyIncludes(guest, 'SHARED TABLE');
  const reloaded = await host.reload({ waitUntil: 'load' });
  void reloaded;
  await dismissOverlays(host);
  await waitBodyIncludes(host, 'SHARED TABLE', 20000);
  await waitBodyIncludes(host, 'This browser will reconnect as UI Host after refresh.', 20000);
  await waitBodyIncludes(host, 'Mode: Shared Tracker', 20000);

  const rejoinContext = await newContext(browser, { viewport: { width: 1280, height: 900 } });
  const rejoinGuest = await rejoinContext.newPage();
  await joinRoom(rejoinGuest, { roomId, playerName: 'UI Guest', password });
  const rejoinBody = await waitBodyIncludes(rejoinGuest, 'SHARED TABLE', 20000);
  assert(rejoinBody.includes('UI Guest rejoined the room.'), 'guest rejoin by invite/name did not sync into room chat');
  await screenshot(rejoinGuest, 'guest-rejoined-in-game.png');
  await rejoinContext.close();

  await clickAction(host, 'Leave');
  await joinRoom(host, { roomId, playerName: 'UI Host', password });
  const hostRejoinBody = await waitBodyIncludes(host, 'SHARED TABLE', 20000);
  assert(hostRejoinBody.includes('UI Host rejoined the room.'), 'host rejoin by invite/name did not sync into room chat');
  assert(hostRejoinBody.includes('Mode: Shared Tracker'), 'host rejoin did not restore shared tracker view');
  await screenshot(host, 'host-rejoined-in-game.png');

  await selectTrackerTarget(host, 'UI Guest');
  await clickAction(host, 'Commander Damage');
  await waitBodyIncludes(host, 'UI Guest took 1 commander damage', 15000);
  await clickAction(host, 'Set Monarch');
  await waitBodyIncludes(host, 'Monarch: UI Guest', 15000);
  await host.getByPlaceholder('Optional note, spell name, or shortcut').fill('Bear');
  await clickAction(host, 'Create Token');
  await waitBodyIncludes(host, 'Bear', 15000);
  await clickAction(host, 'Undo');
  await waitBodyIncludes(host, 'Undid the last tracker action.', 15000);
  await host.getByPlaceholder('Optional note, spell name, or shortcut').fill('Treasure Map');
  await clickAction(host, 'Add Board Entry');
  await waitBodyIncludes(host, 'Treasure Map', 15000);
  await clickAction(host, 'Move Last to Exile');
  await waitBodyIncludes(host, 'Moved 1 permanent to exile: Treasure Map', 15000);
  await host.getByLabel('Source Zone', { exact: true }).selectOption({ label: 'Exile' });
  await host.getByPlaceholder('Optional note, spell name, or shortcut').fill('Treasure Map');
  await clickAction(host, 'Return to Board');
  await waitBodyIncludes(host, 'Returned 1 Treasure Map from exile to battlefield.', 15000);
  await clickAction(host, 'Move Last to Command');
  await waitBodyIncludes(host, 'Moved 1 permanent to command zone: Treasure Map', 15000);
  await host.getByLabel('Source Zone', { exact: true }).selectOption({ label: 'Command' });
  await host.getByPlaceholder('Optional note, spell name, or shortcut').fill('Treasure Map');
  await clickAction(host, 'Return to Hand');
  await waitBodyIncludes(host, 'Returned 1 card from command zone to hand: Treasure Map', 15000);
  await host.getByPlaceholder('Optional note, spell name, or shortcut').fill('Cleanup discard');
  await clickAction(host, 'Discard to GY');
  await waitBodyIncludes(host, 'Discarded 1 card to graveyard: Cleanup discard', 15000);
  await host.getByPlaceholder('Optional note, spell name, or shortcut').fill('Hold removal for commander');
  await clickAction(host, 'Private Note');
  await waitBodyIncludes(host, 'Hold removal for commander', 15000);

  await clickAction(host, 'Draw');
  await clickAction(host, 'Play Permanent');
  await clickAction(host, 'Pass Turn');
  await waitBodyIncludes(guest, 'Current turn: UI Guest');

  await clickAction(guest, 'Draw');
  await clickAction(guest, 'Play Permanent');
  await clickAction(guest, 'Pass Turn');
  await waitBodyIncludes(host, 'Current turn: UI Host');

  await clickAction(guest, 'Lose Life');
  await clickAction(guest, 'Concede');

  const hostBody = await waitBodyIncludes(host, 'Match Complete', 20000);
  const guestBody = await waitBodyIncludes(guest, 'Match Complete', 20000);
  assert(hostBody.includes('UI Host wins the shared table.'), 'winner not visible to host');
  assert(guestBody.includes('UI Host wins the shared table.'), 'winner not visible to guest');
  for (const phrase of ['Drew 1 card.', 'Played a permanent', 'Passed the turn.', 'Conceded the game.']) {
    assert(hostBody.includes(phrase), `host game log missing ${phrase}`);
    assert(guestBody.includes(phrase), `guest game log missing ${phrase}`);
  }

  await waitBodyIncludes(host, 'Learning Replay', 20000);
  for (const phrase of ['What Were My Options?', 'Compare Lines', 'State Snapshot', 'Personalized Insights', 'Replay Timeline', 'Grade']) {
    await waitBodyIncludes(host, phrase, 20000);
  }
  await host.getByPlaceholder('Add a note for this replay step').fill('Review note: check whether developing before passing was better.');
  await clickAction(host, 'Add Annotation');
  await waitBodyIncludes(host, 'Replay annotation saved.', 15000);
  await waitBodyIncludes(host, 'Review note: check whether developing before passing was better.', 15000);
  const replayDownloadPromise = host.waitForEvent('download');
  await clickAction(host, 'Export Review');
  const replayDownload = await replayDownloadPromise;
  assert((await replayDownload.suggestedFilename()).endsWith('-replay-review.json'), 'exported replay review filename was unexpected');
  await screenshot(host, 'shared-learning-replay-host.png');

  await screenshot(host, 'shared-complete-host.png');
  await screenshot(guest, 'shared-complete-guest.png');
  const downloadPromise = host.waitForEvent('download');
  await clickAction(host, 'Export Log');
  const download = await downloadPromise;
  assert((await download.suggestedFilename()).endsWith('-match-log.txt'), 'exported match log filename was unexpected');
  await clickAction(host, 'New Game');
  const rematchBody = await waitBodyIncludes(host, 'Turn 1 - beginning', 20000);
  assert(rematchBody.includes('Current turn: UI Host'), 'rematch did not restart at the host');
  await screenshot(host, 'shared-rematch-host.png');
  await hostContext.close();
  await guestContext.close();
  return { roomId };
}

async function runEngineGate(browser) {
  const password = `ui-engine-${Date.now()}`;
  const hostContext = await newContext(browser, { viewport: { width: 1280, height: 900 } });
  const guestContext = await newContext(browser, { viewport: { width: 1280, height: 900 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  const roomId = await createRoom(host, {
    hostName: 'UI Engine Host',
    roomName: `UI Engine Gate ${RUN_ID}`,
    password,
  });
  await joinRoom(guest, { roomId, playerName: 'UI Engine Guest', password });
  await readyWithDeck(host, {
    deckName: 'Rograkh Engine Gate',
    commander: 'Rograkh, Son of Rohgahh',
    cards: Array.from({ length: 99 }, () => '1 Mountain'),
  });
  await chooseStarterAndReady(guest, 'Blue Spell Practice');

  await (await waitForEnabledButton(host, 'Start Engine Beta', 20000)).click();
  await waitBodyIncludes(host, 'EXPERIMENTAL REAL ENGINE', 20000);
  await waitBodyIncludes(host, 'Authority engine is live in this browser.', 20000);
  await waitBodyIncludes(guest, 'EXPERIMENTAL REAL ENGINE', 20000);
  const hostStartBody = await waitBodyIncludes(host, 'Real Actions', 20000);
  assert(!hostStartBody.includes('Waiting for authority snapshot'), 'host stuck waiting for authority snapshot');
  assert(hostStartBody.toLowerCase().includes("why can't i?"), 'engine action explanation panel missing during upkeep');
  assert(hostStartBody.toLowerCase().includes('land plays unlock during your main phase while you have priority.'), 'play-land phase explanation missing during upkeep');
  assert(!(await host.getByRole('button', { name: 'Play First Land', exact: true }).isEnabled()), 'Play First Land should be disabled before main phase');

  await clickAction(host, 'Pass Priority');
  await clickAction(guest, 'Pass Priority');
  await waitBodyIncludes(host, 'advanced to beginning / draw', 20000);

  await clickAction(host, 'Pass Priority');
  await clickAction(guest, 'Pass Priority');
  await waitBodyIncludes(host, 'advanced to precombat_main', 20000);

  const playLand = await waitForEnabledButton(host, 'Play First Land', 20000);
  await playLand.click();
  const afterLand = await waitBodyIncludes(host, 'UI Engine Host played a land.', 20000);
  assert(/BOARD\s+1/.test(afterLand), 'host board count did not show land after Play First Land');

  await host.getByLabel('Mana Color', { exact: true }).selectOption({ label: 'R' });
  await clickAction(host, 'Tap First Mana Source');
  await waitBodyIncludes(host, 'UI Engine Host tapped Mountain for R.', 20000);
  await clickAction(host, 'Cast Commander');
  await waitBodyIncludes(host, 'UI Engine Host cast Rograkh, Son of Rohgahh.', 20000);
  await clickAction(host, 'Pass Priority');
  await clickAction(guest, 'Pass Priority');
  await waitBodyIncludes(host, 'top stack item resolved', 20000);

  await clickAction(host, 'Pass Priority');
  await clickAction(guest, 'Pass Priority');
  await waitBodyIncludes(host, 'advanced to combat / declare_attackers', 20000);
  await clickAction(host, 'No Attacks');
  await waitBodyIncludes(host, 'UI Engine Host declared no attackers.', 20000);

  const guestView = await guest.locator('body').innerText();
  assert(!guestView.includes('Rancor,') && !guestView.includes('Garruk'), 'host hand details leaked into guest UI');
  assert(guestView.includes('Talrand'), 'guest scoped view did not render guest identity');

  const spectatorContext = await newContext(browser, { viewport: { width: 1280, height: 900 } });
  const spectator = await spectatorContext.newPage();
  await spectateRoom(spectator, { roomId, spectatorName: 'UI Watcher', password });
  await waitBodyIncludes(spectator, 'hidden hands and libraries are redacted', 20000);
  await waitBodyIncludes(spectator, 'Scoped hidden views', 20000);
  const spectatorBody = await waitBodyIncludes(spectator, 'Priority:', 20000);
  const normalizedSpectatorBody = spectatorBody.toLowerCase();
  assert(normalizedSpectatorBody.includes('active: ui engine host'), 'spectator did not see active player');
  assert(normalizedSpectatorBody.includes('priority:'), 'spectator did not see priority');
  assert(normalizedSpectatorBody.includes('stack:'), 'spectator did not see stack');
  assert(!spectatorBody.includes('Play First Land'), 'spectator could see player action controls');
  assert(!spectatorBody.includes('Rancor,') && !spectatorBody.includes('Garruk'), 'spectator view leaked hidden hand details');

  await screenshot(host, 'engine-after-land-host.png');
  await screenshot(guest, 'engine-after-land-guest.png');

  await clickAction(host, 'Leave');
  const failoverBody = await waitBodyIncludes(guest, 'Authority: UI Engine Guest', 30000);
  assert(failoverBody.includes('Authority: UI Engine Guest'), 'guest did not see authority failover');
  await waitBodyIncludes(guest, 'Authority engine is live in this browser.', 30000);
  await screenshot(guest, 'engine-authority-failover-guest.png');

  const hostSession = await readRoomSession(host);
  const guestSession = await readRoomSession(guest);
  await spectatorContext.close();
  await hostContext.close();
  await guestContext.close();
  return { roomId, hostPlayerId: hostSession?.playerId, guestPlayerId: guestSession?.playerId };
}

async function runFourPlayerEngineGate(browser) {
  const password = `ui-engine-4p-${Date.now()}`;
  const contexts = await Promise.all([
    newContext(browser, { viewport: { width: 1280, height: 900 } }),
    newContext(browser, { viewport: { width: 1280, height: 900 } }),
    newContext(browser, { viewport: { width: 1280, height: 900 } }),
    newContext(browser, { viewport: { width: 1280, height: 900 } }),
  ]);
  const [host, guestA, guestB, guestC] = await Promise.all(contexts.map(context => context.newPage()));

  const roomId = await createRoom(host, {
    hostName: 'FourP Host',
    roomName: `Four Player Engine ${RUN_ID}`,
    password,
  });
  await joinRoom(guestA, { roomId, playerName: 'FourP A', password });
  await joinRoom(guestB, { roomId, playerName: 'FourP B', password });
  await joinRoom(guestC, { roomId, playerName: 'FourP C', password });

  await chooseStarterAndReady(host, 'Green Big Creatures');
  await chooseStarterAndReady(guestA, 'Blue Spell Practice');
  await chooseStarterAndReady(guestB, 'Red Goblin Swarm');
  await chooseStarterAndReady(guestC, 'Green Big Creatures');

  await (await waitForEnabledButton(host, 'Start Engine Beta', 20000)).click();
  for (const page of [host, guestA, guestB, guestC]) {
    await waitBodyIncludes(page, 'EXPERIMENTAL REAL ENGINE', 20000);
    await waitBodyIncludes(page, 'Scoped hidden views', 20000);
  }

  const hostBody = await host.locator('body').innerText();
  const normalizedHostBody = hostBody.toLowerCase();
  assert(normalizedHostBody.includes('active: fourp host'), '4-player engine active player label missing');
  assert(normalizedHostBody.includes('priority: fourp host'), '4-player engine priority label missing');
  assert(normalizedHostBody.includes('stack: 0'), '4-player engine stack label missing');
  assert(normalizedHostBody.includes('4/4 seated'), '4-player room did not show four occupied seats');

  await clickAction(host, 'Pass Priority');
  await clickAction(guestA, 'Pass Priority');
  await clickAction(guestB, 'Pass Priority');
  await clickAction(guestC, 'Pass Priority');
  await waitBodyIncludes(host, 'advanced to beginning / draw', 25000);
  await waitBodyIncludes(guestC, 'advanced to beginning / draw', 25000);

  const guestText = await guestA.locator('body').innerText();
  assert(!guestText.includes('Garruk') && !guestText.includes('Rancor,'), '4-player scoped view leaked host hand details');

  await screenshot(host, 'engine-4p-host.png');
  await screenshot(guestA, 'engine-4p-guest-a.png');
  const sessions = await Promise.all([host, guestA, guestB, guestC].map(readRoomSession));
  await Promise.all(contexts.map(context => context.close()));
  return {
    roomId,
    playerIds: sessions.map(session => session?.playerId).filter(Boolean),
  };
}

function complexScopedCard(instanceId, name, typeLine, cardTypes, options = {}) {
  return {
    instanceId,
    definitionId: `${instanceId}-definition`,
    ownerId: options.ownerId || 'owner',
    zone: 'battlefield',
    name,
    typeLine,
    oracleText: options.oracleText || '',
    manaCost: options.manaCost || '',
    cmc: options.cmc || 0,
    colors: options.colors || [],
    colorIdentity: options.colorIdentity || [],
    cardTypes,
    power: options.power,
    toughness: options.toughness,
    keywords: options.keywords || [],
    tapped: Boolean(options.tapped),
    counters: options.counters || {},
    isCommander: Boolean(options.isCommander),
  };
}

function buildComplexScopedView({ viewerId, hostId, guestId }) {
  const hostBattlefield = [
    complexScopedCard('host_dragon_1', 'Ancient Copper Dragon', 'Creature - Elder Dragon', ['creature'], {
      ownerId: hostId,
      power: 6,
      toughness: 5,
      keywords: ['Flying', 'Trample', 'Deathtouch'],
      counters: { '+1/+1': 2 },
    }),
    complexScopedCard('host_terror_1', 'Terror of the Peaks', 'Creature - Dragon', ['creature'], {
      ownerId: hostId,
      power: 5,
      toughness: 4,
      keywords: ['Flying'],
    }),
    ...Array.from({ length: 14 }, (_, index) => complexScopedCard(
      `host_treasure_${index + 1}`,
      `Treasure Token ${index + 1}`,
      'Token Artifact - Treasure',
      ['artifact'],
      { ownerId: hostId, oracleText: 'Tap, sacrifice this artifact: add one mana of any color.' },
    )),
  ];
  const guestBattlefield = [
    complexScopedCard('guest_blocker_1', 'Talrand Drake Token', 'Token Creature - Drake', ['creature'], {
      ownerId: guestId,
      power: 2,
      toughness: 2,
      keywords: ['Flying'],
    }),
    complexScopedCard('guest_wall_1', 'Fractal Token', 'Token Creature - Fractal', ['creature'], {
      ownerId: guestId,
      power: 4,
      toughness: 4,
      counters: { '+1/+1': 4 },
    }),
    ...Array.from({ length: 12 }, (_, index) => complexScopedCard(
      `guest_clue_${index + 1}`,
      `Clue Token ${index + 1}`,
      'Token Artifact - Clue',
      ['artifact'],
      { ownerId: guestId, oracleText: 'Pay 2, sacrifice this artifact: draw a card.' },
    )),
  ];
  const guestHand = [
    complexScopedCard('guest_counterspell_1', 'Counterspell', 'Instant', ['instant'], {
      ownerId: guestId,
      zone: 'hand',
      manaCost: '{U}{U}',
      oracleText: 'Counter target spell.',
    }),
  ];
  const players = [
    {
      id: hostId,
      name: 'Complex Host',
      life: 35,
      poisonCounters: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 2, G: 3, C: 0 },
      isActive: true,
      hasPriority: false,
      zones: {
        hand: { count: 7, cards: viewerId === hostId ? [] : undefined },
        library: { count: 82 },
        battlefield: { count: hostBattlefield.length, cards: hostBattlefield },
        graveyard: { count: 4, cards: [] },
        exile: { count: 1, cards: [] },
        command: { count: 1, cards: [complexScopedCard('host_cmd_1', 'Xenagos, God of Revels', 'Legendary Enchantment Creature - God', ['creature', 'enchantment'], { ownerId: hostId, power: 6, toughness: 5, isCommander: true })] },
      },
    },
    {
      id: guestId,
      name: 'Complex Guest',
      life: 29,
      poisonCounters: 0,
      manaPool: { W: 0, U: 3, B: 0, R: 0, G: 0, C: 1 },
      isActive: false,
      hasPriority: true,
      zones: {
        hand: { count: 5, cards: viewerId === guestId ? guestHand : undefined },
        library: { count: 79 },
        battlefield: { count: guestBattlefield.length, cards: guestBattlefield },
        graveyard: { count: 6, cards: [] },
        exile: { count: 0, cards: [] },
        command: { count: 1, cards: [complexScopedCard('guest_cmd_1', 'Talrand, Sky Summoner', 'Legendary Creature - Merfolk Wizard', ['creature'], { ownerId: guestId, power: 2, toughness: 2, isCommander: true })] },
      },
    },
  ];
  return {
    viewerId,
    turnNumber: 7,
    phase: 'combat',
    step: 'declare_blockers',
    activePlayerId: hostId,
    priorityPlayerId: guestId,
    stackSize: 3,
    stack: [
      {
        id: 'stack_top_trigger',
        kind: 'Triggered Ability',
        label: 'Terror of the Peaks trigger',
        controllerName: 'Complex Host',
        sourceName: 'Terror of the Peaks',
        targetNames: ['Complex Guest'],
        order: 1,
        resolvesNext: true,
        triggerKind: 'ETB',
        why: 'Terror of the Peaks triggered because a matching permanent entered the battlefield.',
      },
      {
        id: 'stack_spell_copy',
        kind: 'Spell',
        label: 'Fork copy',
        controllerName: 'Complex Host',
        sourceName: 'Fork',
        targetNames: ['Counterspell'],
        order: 2,
        resolvesNext: false,
        why: 'Fork is a copied spell. Stack items resolve from top to bottom.',
      },
      {
        id: 'stack_bottom_spell',
        kind: 'Spell',
        label: 'Chandra Ignition',
        controllerName: 'Complex Host',
        sourceName: 'Chandra Ignition',
        targetNames: ['Ancient Copper Dragon'],
        order: 3,
        resolvesNext: false,
        why: 'Chandra Ignition was cast and is waiting for all players to pass priority.',
      },
    ],
    pendingTriggerGroups: [
      {
        key: 'host:terror:ETB',
        sourceName: 'Terror of the Peaks',
        controllerName: 'Complex Host',
        triggerKind: 'ETB',
        count: 4,
        why: 'Terror of the Peaks triggered because a matching permanent entered the battlefield.',
      },
      {
        key: 'guest:talrand:CastInstantOrSorcery',
        sourceName: 'Talrand, Sky Summoner',
        controllerName: 'Complex Guest',
        triggerKind: 'CastInstantOrSorcery',
        count: 2,
        why: 'Talrand triggered from a spell being cast or copied: Counterspell.',
      },
    ],
    combat: {
      step: 'declare_blockers',
      assignments: [
        {
          attacker: {
            id: 'host_dragon_1',
            name: 'Ancient Copper Dragon',
            controllerName: 'Complex Host',
            power: 8,
            toughness: 7,
            keywords: ['Flying', 'Trample', 'Deathtouch'],
            damage: 0,
          },
          defenderName: 'Complex Guest',
          blockers: [
            {
              id: 'guest_blocker_1',
              name: 'Talrand Drake Token',
              controllerName: 'Complex Guest',
              power: 2,
              toughness: 2,
              keywords: ['Flying'],
              damage: 0,
            },
            {
              id: 'guest_wall_1',
              name: 'Fractal Token',
              controllerName: 'Complex Guest',
              power: 4,
              toughness: 4,
              keywords: [],
              damage: 0,
            },
          ],
          unblocked: false,
          assignmentHint: 'Ancient Copper Dragon has trample and deathtouch, so 1 damage can be lethal to each blocker before excess tramples over.',
        },
      ],
    },
    legalActions: [
      { action: 'Pass Priority', enabled: true, reason: 'You have priority now.' },
      { action: 'Declare Blockers', enabled: true, reason: 'Declare blockers step and you have priority.' },
      { action: 'Play Land', enabled: false, reason: 'Lands use main-phase timing.' },
      { action: 'Cast From Hand', enabled: true, reason: 'The current engine can submit the first visible spell.' },
    ],
    teachingNotes: [
      'Stack: the top item resolves first after every player passes priority.',
      'Triggers: pending triggers are grouped by source before they are placed on the stack.',
      'Combat: attackers are tied to one defender; blockers and keyword notes show how damage will be assigned.',
      'Layers: continuous effects are included in shown power/toughness and creature status.',
    ],
    complexity: {
      stackCount: 3,
      pendingTriggerCount: 6,
      battlefieldCardCount: hostBattlefield.length + guestBattlefield.length,
      continuousEffectCount: 5,
      largeBoardMode: true,
    },
    players,
  };
}

async function publishComplexSnapshot(roomId, hostPlayerId, guestPlayerId) {
  await apiJson(`/api/multiplayer/rooms/${roomId}/real-game/snapshot`, {
    method: 'POST',
    body: JSON.stringify({
      player_id: hostPlayerId,
      revision: 100,
      views: {
        [hostPlayerId]: buildComplexScopedView({ viewerId: hostPlayerId, hostId: hostPlayerId, guestId: guestPlayerId }),
        [guestPlayerId]: buildComplexScopedView({ viewerId: guestPlayerId, hostId: hostPlayerId, guestId: guestPlayerId }),
      },
      completed_action_ids: [],
      rejected_actions: {},
      events: ['Complex play UI verification snapshot published.'],
    }),
  });
}

async function runComplexPlayUiGate(browser) {
  const password = `ui-complex-${Date.now()}`;
  const hostContext = await newContext(browser, { viewport: { width: 1280, height: 960 } });
  const guestContext = await newContext(browser, { viewport: { width: 1280, height: 960 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  const roomId = await createRoom(host, {
    hostName: 'Complex Host',
    roomName: `Complex Play Lens ${RUN_ID}`,
    password,
  });
  await joinRoom(guest, { roomId, playerName: 'Complex Guest', password });
  await chooseStarterAndReady(host, 'Green Big Creatures');
  await chooseStarterAndReady(guest, 'Blue Spell Practice');
  await (await waitForEnabledButton(host, 'Start Engine Beta', 20000)).click();
  await waitBodyIncludes(host, 'Authority engine is live in this browser.', 20000);
  await waitBodyIncludes(guest, 'EXPERIMENTAL REAL ENGINE', 20000);

  const hostSession = await readRoomSession(host);
  const guestSession = await readRoomSession(guest);
  assert(hostSession?.playerId && guestSession?.playerId, 'missing player ids for complex snapshot gate');
  await hostContext.close();

  await publishComplexSnapshot(roomId, hostSession.playerId, guestSession.playerId);
  await guest.reload({ waitUntil: 'load' });
  await dismissOverlays(guest);

  const body = await waitBodyIncludes(guest, 'Complex Turn Lens', 20000);
  for (const phrase of [
    'Trigger Stack',
    'Resolves Next',
    'Why did this trigger?',
    'Pending Triggers',
    'Combat Assignment',
    'Damage Assignment Preview',
    'What Are My Options?',
    'Large board mode',
    'Teaching On',
    'Trample',
    'Deathtouch',
    'Declare Selected Blocker',
  ]) {
    assert(body.toLowerCase().includes(phrase.toLowerCase()), `complex play UI missing visible phrase: ${phrase}`);
  }
  const noOverflow = await guest.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
  assert(noOverflow, 'complex play UI introduced horizontal overflow');
  await screenshot(guest, 'complex-turn-lens-guest.png');
  await guestContext.close();
  return { roomId };
}

async function runMobileRoomCheck(browser) {
  const password = `ui-mobile-${Date.now()}`;
  const hostContext = await newContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true });
  const guestContext = await newContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  const roomId = await createRoom(host, {
    hostName: 'Mobile UI Host',
    roomName: `Mobile UI Room ${RUN_ID}`,
    password,
    mobile: true,
  });
  await joinRoom(guest, { roomId, playerName: 'Mobile UI Guest', password, mobile: true });
  await chooseStarterAndReady(host, 'Green Big Creatures');
  await chooseStarterAndReady(guest, 'Blue Spell Practice');
  await (await waitForEnabledButton(host, 'Start Shared Table', 20000)).click();
  await waitBodyIncludes(host, 'SHARED TABLE');
  await waitBodyIncludes(guest, 'SHARED TABLE');
  await waitBodyIncludes(host, 'Table Controls', 20000);
  await waitBodyIncludes(host, 'Draw', 20000);

  const checks = await host.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button')).map(button => {
      const rect = button.getBoundingClientRect();
      return {
        text: button.textContent?.trim() || '',
        disabled: button.disabled,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
    const actionLabels = [
      'Draw',
      'Play Permanent',
      'Create Token',
      'Add Board Entry',
      'Remove Last',
      'Move Last to Exile',
      'Move Last to Command',
      'Discard to GY',
      'Exile from Hand',
      'Return to Hand',
      'Return to Board',
      'Pass Turn',
      'Next Phase',
      'Lose Life',
      'Gain Life',
      'Commander Damage',
      'Poison',
      'Add Counter',
      'Tax +2',
      'Set Monarch',
      'Set Initiative',
      'Concede',
      'Log Note',
      'Player Note',
      'Private Note',
      'Export Log',
    ];
    const actionButtons = buttons.filter(button => actionLabels.includes(button.text));
    const overlap = actionButtons.some((a, i) => actionButtons.some((b, j) =>
      j > i &&
      Math.max(a.rect.x, b.rect.x) < Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) &&
      Math.max(a.rect.y, b.rect.y) < Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height)
    ));
    return {
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      actionButtonCount: actionButtons.length,
      minActionHeight: Math.min(...actionButtons.map(button => button.rect.height).filter(Boolean)),
      overlap,
      hasChat: document.body.innerText.includes('Room Chat'),
      hasGameLog: document.body.innerText.includes('GAME LOG'),
    };
  });
  assert(!checks.horizontalOverflow, 'mobile room has horizontal overflow');
  assert(!checks.overlap, 'mobile action buttons overlap');
  assert(checks.actionButtonCount >= 8, 'mobile actions are not reachable');
  assert(checks.minActionHeight >= 40, 'mobile action buttons are too short to tap');
  assert(checks.hasChat, 'mobile chat is not visible');
  assert(checks.hasGameLog, 'mobile game log is not visible');

  await screenshot(host, 'mobile-shared-room-host.png');
  await screenshot(guest, 'mobile-shared-room-guest.png');
  await hostContext.close();
  await guestContext.close();
  return { roomId, checks };
}

async function checkUnsupportedActionFails(roomId, playerId) {
  assert(playerId, 'missing player id for unsupported action check');
  const response = await fetch(`${BASE_URL}/api/multiplayer/rooms/${roomId}/real-game/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(QA_HEADERS || {}) },
    body: JSON.stringify({
      player_id: playerId,
      action: { kind: 'cheat_win', payload: { card_instance_id: 'unknown' } },
    }),
  });
  const body = await response.text();
  assert(response.status === 400, `unsupported action returned unexpected status ${response.status}: ${body}`);
  assert(body.includes('Unsupported real engine action'), `unsupported action detail was unclear: ${body}`);
  return { status: response.status, body };
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  try {
    const shared = await runSharedMatch(browser);
    const engine = await runEngineGate(browser);
    const engineFourPlayer = await runFourPlayerEngineGate(browser);
    const complexPlay = await runComplexPlayUiGate(browser);
    const mobile = await runMobileRoomCheck(browser);
    const unsupported = await checkUnsupportedActionFails(engine.roomId, engine.guestPlayerId);
    const result = {
      ok: true,
      baseUrl: BASE_URL,
      artifactDir: path.join(ARTIFACT_DIR, RUN_ID),
      shared,
      engine,
      engineFourPlayer,
      complexPlay,
      mobile,
      unsupported,
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
