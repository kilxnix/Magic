#!/usr/bin/env node
/*
 * Full UI playtest for DeckReps Event Center.
 *
 * This drives the React organizer/player flow through the browser. API use is
 * limited to supplemental state checks and never replaces the UI path.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findPlaywrightPackage() {
  try {
    return require('playwright');
  } catch {
    // Fall through to the common npx cache search.
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
const ARTIFACT_DIR = path.resolve(process.env.UI_PLAYTEST_ARTIFACT_DIR || 'playtest-artifacts/events');
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

async function newContext(browser, options = {}) {
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
    if ((await button.count()) > 0 && (await button.first().isVisible().catch(() => false))) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(200);
    }
  }
}

async function waitBodyIncludes(page, text, timeout = 15000) {
  const started = Date.now();
  const expected = text.toLowerCase();
  while (Date.now() - started < timeout) {
    const body = await page.locator('body').innerText();
    if (body.toLowerCase().includes(expected)) return body;
    await page.waitForTimeout(300);
  }
  const body = await page.locator('body').innerText();
  throw new Error(`Timed out waiting for "${text}". Body starts:\n${body.slice(0, 900)}`);
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

async function gotoEvents(page, suffix = '') {
  await page.goto(`${BASE_URL}/events${suffix}`, { waitUntil: 'domcontentloaded' });
  await dismissOverlays(page);
  await page.waitForLoadState('load');
}

async function createEventThroughUi(page, { name, organizer, format, rounds = 2, maxPlayers = 8 }) {
  await gotoEvents(page, `?uiqa=${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await page.getByPlaceholder('Event name').fill(name);
  await page.getByPlaceholder('Organizer name').fill(organizer);
  await page.locator('select').selectOption(format);
  await page.getByLabel('Rounds').fill(String(rounds));
  await page.getByLabel('Max players').fill(String(maxPlayers));
  await page.getByPlaceholder('Prize note').fill('Store credit and bragging rights.');
  await page.getByPlaceholder('Recurring rule, e.g. Weekly Friday league').fill('Weekly QA league slot.');
  await page.getByRole('button', { name: 'Create Event', exact: true }).click();
  await page.waitForURL(/\/events\/[a-z0-9]+$/i, { timeout: 15000 });
  await waitBodyIncludes(page, 'Organizer controls are unlocked', 15000);
  await screenshot(page, `${format}-created.png`);
  return new URL(page.url()).pathname.split('/').pop();
}

async function registerPlayersThroughUi(page, names) {
  for (const name of names) {
    await page.getByPlaceholder('Player name').fill(name);
    await page.getByPlaceholder('Deck name').fill(`${name} Deck`);
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    await waitBodyIncludes(page, `${name} Deck`, 15000);
  }
}

async function runSwissFlow(page) {
  const eventName = `UI Swiss Event ${RUN_ID.slice(0, 10)}`;
  const eventId = await createEventThroughUi(page, {
    name: eventName,
    organizer: 'QA Organizer',
    format: 'swiss',
    rounds: 2,
    maxPlayers: 8,
  });

  await registerPlayersThroughUi(page, ['QA Alpha', 'QA Bravo', 'QA Charlie', 'QA Delta']);
  await screenshot(page, 'swiss-registered.png');

  await page.getByRole('button', { name: 'Start Event', exact: true }).click();
  await waitBodyIncludes(page, 'Round 1 pairings are posted.', 15000);
  await waitBodyIncludes(page, 'Pairings And Match Rooms', 15000);
  await screenshot(page, 'swiss-round-one.png');

  await page.getByRole('button', { name: 'Create Table', exact: true }).first().click();
  await waitBodyIncludes(page, 'Open Table', 15000);
  await screenshot(page, 'swiss-table-created.png');

  const linkedRoom = await page.locator('a', { hasText: 'Open Table' }).first().getAttribute('href');
  assert(linkedRoom && linkedRoom.startsWith('/multiplayer/'), 'event table did not link to a multiplayer room');
  const roomId = linkedRoom.split('/').pop();
  const tableRoom = await apiJson(`/api/multiplayer/rooms/${roomId}`);
  assert(tableRoom.settings.table_note.includes(`Event ${eventId}`), 'event table room is missing event note');

  const firstReplayInput = page.getByPlaceholder('Replay room id').first();
  await firstReplayInput.fill(roomId);
  await page.getByPlaceholder('Highlight note').first().fill('Feature match ended with a clean two-game sweep.');
  await page.getByRole('button', { name: /2-0$/ }).first().click();
  await waitBodyIncludes(page, 'Result reported', 15000);
  await waitBodyIncludes(page, 'Replay Highlights', 15000);

  await page.getByRole('button', { name: /2-0$/ }).first().click();
  await waitBodyIncludes(page, 'Result reported', 15000);

  await page.getByRole('button', { name: 'Pair Next Round', exact: true }).click();
  await waitBodyIncludes(page, 'Next round paired.', 15000);
  await screenshot(page, 'swiss-round-two.png');

  await page.getByPlaceholder('Organizer announcement').fill('Round two is live. Spectators may use the table links.');
  await page.getByRole('button', { name: 'Post Announcement', exact: true }).click();
  await waitBodyIncludes(page, 'Round two is live', 15000);

  await page.getByPlaceholder('Organizer announcement').fill('Prize link http://bad.example');
  await page.getByRole('button', { name: 'Post Announcement', exact: true }).click();
  await waitBodyIncludes(page, 'Message removed by room moderation.', 15000);
  await screenshot(page, 'swiss-moderation.png');

  return eventId;
}

async function runDraftFlow(page) {
  const eventId = await createEventThroughUi(page, {
    name: `UI Draft Event ${RUN_ID.slice(0, 10)}`,
    organizer: 'Draft Organizer',
    format: 'draft',
    rounds: 3,
    maxPlayers: 8,
  });
  await registerPlayersThroughUi(page, ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']);
  await page.getByRole('button', { name: 'Start Event', exact: true }).click();
  await waitBodyIncludes(page, 'Draft Pods', 15000);
  await waitBodyIncludes(page, 'Pod 1', 15000);
  await waitBodyIncludes(page, '3 packs per player', 15000);
  await screenshot(page, 'draft-pod.png');
  return eventId;
}

async function checkMobileEvent(browser, eventId) {
  const context = await newContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();
  await gotoEvents(page, `/${eventId}?mobileqa=${Date.now()}`);
  await waitBodyIncludes(page, 'Pairings And Match Rooms', 15000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 4, `mobile event page has horizontal overflow of ${overflow}px`);
  await screenshot(page, 'mobile-event-detail.png');
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await newContext(browser, { viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();

  try {
    const swissEventId = await runSwissFlow(page);
    await runDraftFlow(page);
    await checkMobileEvent(browser, swissEventId);
    console.log(`Event UI playtest passed. Artifacts: ${path.join(ARTIFACT_DIR, RUN_ID)}`);
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
