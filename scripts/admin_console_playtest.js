#!/usr/bin/env node
/*
 * Verifies the protected admin console through the rendered UI and confirms
 * admin room actions hit the backend.
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
const API_URL = (process.env.DECKREPS_API_URL || BASE_URL).replace(/\/$/, '');
const ADMIN_TOKEN = process.env.DECKREPS_QA_ADMIN_TOKEN || 'local-ui-qa-token';
const HEADLESS = process.env.HEADLESS !== '0';
const ARTIFACT_DIR = path.resolve(process.env.UI_PLAYTEST_ARTIFACT_DIR || 'playtest-artifacts/admin-console');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
fs.mkdirSync(path.join(ARTIFACT_DIR, RUN_ID), { recursive: true });

function artifact(name) {
  return path.join(ARTIFACT_DIR, RUN_ID, name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function apiJson(pathname, options = {}) {
  const response = await fetch(`${API_URL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text ? JSON.parse(text) : null };
}

async function dismissOverlays(page) {
  for (const name of ['Decline Ads', 'Allow Ads', 'Dismiss', 'Close guided practice prompt']) {
    const button = page.getByRole('button', { name, exact: true });
    if ((await button.count()) > 0 && (await button.first().isVisible().catch(() => false))) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(150);
    }
  }
}

(async () => {
  const roomName = `Admin QA ${Date.now()}`;
  const created = await apiJson('/api/multiplayer/rooms', {
    method: 'POST',
    body: JSON.stringify({ name: roomName, host_name: 'Admin Host', is_private: false, namespace: 'qa' }),
  });
  assert(created.ok, `could not create QA room (${created.status})`);
  const roomId = created.body.room.id;
  const guest = await apiJson(`/api/multiplayer/rooms/${roomId}/join`, {
    method: 'POST',
    body: JSON.stringify({ player_name: 'Muted Guest' }),
  });
  assert(guest.ok, `could not join muted guest (${guest.status})`);
  const guestId = guest.body.player_id;
  const bannedGuest = await apiJson(`/api/multiplayer/rooms/${roomId}/join`, {
    method: 'POST',
    body: JSON.stringify({ player_name: 'Banned Guest' }),
  });
  assert(bannedGuest.ok, `could not join banned guest (${bannedGuest.status})`);
  await apiJson(`/api/multiplayer/rooms/${roomId}/chat`, {
    method: 'POST',
    body: JSON.stringify({ player_id: guestId, message: 'Friendly admin QA chat message' }),
  });

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/admin?qa=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await page.locator('input[type="password"]').fill(ADMIN_TOKEN);
    await page.getByRole('button', { name: 'Unlock Console' }).click();
    await page.getByRole('heading', { name: 'Rooms', exact: true }).waitFor({ timeout: 10000 });
    await page.screenshot({ path: artifact('admin-overview.png'), fullPage: false });

    await page.getByRole('button', { name: roomName, exact: true }).click();
    await page.getByPlaceholder('Optional reason stored in admin audit').fill('admin console playtest');

    await page.getByPlaceholder('Message all room users').fill('Admin QA announcement');
    await page.getByLabel('Send room announcement', { exact: true }).click();
    await page.getByText('Announcement sent.').waitFor({ timeout: 10000 });
    let overview = await apiJson('/api/admin/overview', { headers: { 'x-admin-token': ADMIN_TOKEN } });
    let inspectedRoom = overview.body.rooms.find(room => room.id === roomId);
    assert(inspectedRoom?.chat.some(message => message.player_name === 'Admin' && message.message === 'Admin QA announcement'), 'admin announcement was not added to room chat');

    await page.getByRole('button', { name: roomName, exact: true }).click();
    await page.getByLabel('Mute Muted Guest', { exact: true }).click();
    await page.getByText('Seat muted.').waitFor({ timeout: 10000 });
    const mutedChat = await apiJson(`/api/multiplayer/rooms/${roomId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ player_id: guestId, message: 'This should be blocked while muted' }),
    });
    assert(!mutedChat.ok && mutedChat.status === 403, 'muted room user was still able to chat');

    await page.getByRole('button', { name: roomName, exact: true }).click();
    await page.getByLabel('Unmute Muted Guest', { exact: true }).click();
    await page.getByText('Seat unmuted.').waitFor({ timeout: 10000 });
    const unmutedChat = await apiJson(`/api/multiplayer/rooms/${roomId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ player_id: guestId, message: 'Unmuted admin QA chat message' }),
    });
    assert(unmutedChat.ok, 'unmuted room user could not chat');

    await page.getByRole('button', { name: roomName, exact: true }).click();
    await page.getByLabel('Remove chat message', { exact: true }).first().click();
    await page.getByText('Chat message removed.').waitFor({ timeout: 10000 });
    overview = await apiJson('/api/admin/overview', { headers: { 'x-admin-token': ADMIN_TOKEN } });
    inspectedRoom = overview.body.rooms.find(room => room.id === roomId);
    assert(inspectedRoom?.chat.some(message => message.message === 'Admin removed a chat message.'), 'admin chat removal was not logged');

    await page.getByRole('button', { name: roomName, exact: true }).click();
    await page.getByLabel('Ban Banned Guest', { exact: true }).click();
    await page.getByText('Seat banned.').waitFor({ timeout: 10000 });
    const bannedRejoin = await apiJson(`/api/multiplayer/rooms/${roomId}/join`, {
      method: 'POST',
      body: JSON.stringify({ player_name: 'Banned Guest' }),
    });
    assert(!bannedRejoin.ok && bannedRejoin.status === 403, 'banned room name was able to rejoin');

    await page.getByRole('button', { name: roomName, exact: true }).click();
    await page.getByLabel('Remove Muted Guest', { exact: true }).click();
    await page.getByText('Seat removed.').waitFor({ timeout: 10000 });
    overview = await apiJson('/api/admin/overview', { headers: { 'x-admin-token': ADMIN_TOKEN } });
    inspectedRoom = overview.body.rooms.find(room => room.id === roomId);
    assert(inspectedRoom && inspectedRoom.player_count === 1, 'admin kick did not remove the guest seat');

    await page.getByRole('button', { name: roomName, exact: true }).click();
    await page.locator('aside').getByRole('button', { name: 'Close' }).click();
    await page.getByText('Room closed.').waitFor({ timeout: 10000 });

    const closed = await apiJson('/api/admin/overview', { headers: { 'x-admin-token': ADMIN_TOKEN } });
    const closedRoom = closed.body.rooms.find(room => room.id === roomId);
    assert(closedRoom && closedRoom.status === 'closed', 'admin close did not mark the room closed');

    await page.locator('aside').getByRole('button', { name: 'Delete' }).click();
    await page.getByText('Room deleted.').waitFor({ timeout: 10000 });
    const afterDelete = await apiJson('/api/admin/overview', { headers: { 'x-admin-token': ADMIN_TOKEN } });
    assert(!afterDelete.body.rooms.some(room => room.id === roomId), 'admin delete did not remove the room');

    await page.screenshot({ path: artifact('admin-after-actions.png'), fullPage: false });
    console.log(JSON.stringify({ ok: true, roomId, artifacts: path.join(ARTIFACT_DIR, RUN_ID) }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
