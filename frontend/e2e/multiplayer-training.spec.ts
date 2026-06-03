import { expect, request, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

const hostCommander = 'Goreclaw, Terror of Qal Sisma';
const guestCommander = 'Talrand, Sky Summoner';

test.describe.configure({ mode: 'serial' });

function deckList(cardName: string) {
  return Array.from({ length: 99 }, () => `1x ${cardName}`).join('\n');
}

async function closeAlpha(page: Page) {
  const declineAds = page.getByRole('button', { name: 'Decline Ads' });
  if (await declineAds.isVisible().catch(() => false)) {
    await declineAds.click();
  }
  const dismiss = page.getByRole('button', { name: 'Dismiss alpha notice' });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
}

async function createRoomThroughUi(page: Page) {
  const suffix = Date.now().toString(36);
  const password = `deckreps-${suffix}`;
  await page.goto('/multiplayer?e2e=shared-training');
  await closeAlpha(page);
  await page.getByLabel('Host name').fill(`E2E Host ${suffix}`);
  await page.getByLabel('Room name').fill(`E2E Training Room ${suffix}`);
  await page.getByLabel('Tags').fill('qa, training');
  await page.getByPlaceholder('Optional').fill(password);
  await page.getByLabel('Unlisted invite-only room').check();
  await page.getByRole('button', { name: 'Create Beta Room' }).click();
  await expect(page.getByText('Room created. Send the invite link when your pod is ready.')).toBeVisible();
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('magicbrains_multiplayer_session_v1') || 'null'));
  expect(session?.roomId).toBeTruthy();
  expect(session?.playerId).toBeTruthy();
  return {
    roomId: session.roomId as string,
    hostName: session.playerName as string,
    hostPlayerId: session.playerId as string,
    password,
  };
}

async function joinRoomThroughUi(page: Page, roomId: string, password: string, playerName = 'E2E Guest') {
  await page.goto(`/multiplayer/${roomId}?e2e=shared-training`);
  await closeAlpha(page);
  await page.getByLabel('Your name').fill(playerName);
  await page.getByPlaceholder('If required', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Join Room' }).click();
  await expect(page.getByText('You joined the room.')).toBeVisible();
  await expect(page.getByText('Your Seat')).toBeVisible();
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('magicbrains_multiplayer_session_v1') || 'null'));
  expect(session?.roomId).toBe(roomId);
}

async function lockSeat(page: Page, input: { deckName: string; commander: string; list: string }) {
  await page.getByPlaceholder('Deck name').fill(input.deckName);
  await page.getByRole('textbox', { name: 'Commander', exact: true }).fill(input.commander);
  await page.locator('textarea[placeholder^="Paste a Commander decklist"]').fill(input.list);
  const ready = page.getByLabel('Ready to play');
  if (!(await ready.isChecked())) {
    await ready.check();
  }
  await page.getByRole('button', { name: 'Save Seat' }).click();
  await expect(page.getByText('Ready state saved.')).toBeVisible();
  await expect(page.getByText('99 non-commander cards ready to lock.')).toBeVisible();
}

async function clickUnique(page: Page, roleName: string) {
  const button = page.getByRole('button', { name: roleName });
  await expect(button).toHaveCount(1);
  await button.click();
}

function qaHeaders() {
  const token = process.env.DECKREPS_QA_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
  return token
    ? {
        'x-qa-rate-limit-bypass': '1',
        'x-admin-token': token,
      }
    : undefined;
}

async function responseBody(response: APIResponse) {
  try {
    return await response.text();
  } catch {
    return '<body unavailable>';
  }
}

async function postJsonWithBackoff(api: APIRequestContext, path: string, data: unknown) {
  let latest: APIResponse | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    latest = await api.post(path, { data, timeout: 15_000 });
    if (latest.ok() || latest.status() !== 429) {
      return latest;
    }
    await latest.dispose();
    await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
  }
  return latest!;
}

async function expectApiOk(response: APIResponse, label: string) {
  if (!response.ok()) {
    throw new Error(`${label} failed with ${response.status()}: ${await responseBody(response)}`);
  }
}

async function seedEventLearning(baseURL: string, replayRoomId: string) {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: qaHeaders() });
  const created = await postJsonWithBackoff(api, '/api/multiplayer/events', {
      name: `E2E Learning Event ${Date.now().toString(36)}`,
      organizer_name: 'E2E Organizer',
      format: 'swiss',
      public: false,
      settings: { rounds: 1, max_players: 4, match_wins_required: 2, round_minutes: 50 },
  });
  await expectApiOk(created, 'create event');
  const createdBody = await created.json();
  const eventId = createdBody.event.id as string;
  const token = createdBody.organizer_token as string;
  for (const playerName of ['E2E Host', 'E2E Guest']) {
    const registered = await postJsonWithBackoff(api, `/api/multiplayer/events/${eventId}/players`, {
      player_name: playerName,
      deck_name: `${playerName} Deck`,
    });
    await expectApiOk(registered, `register ${playerName}`);
  }
  const started = await postJsonWithBackoff(api, `/api/multiplayer/events/${eventId}/start`, { organizer_token: token });
  await expectApiOk(started, 'start event');
  const match = (await started.json()).matches[0];
  const reported = await postJsonWithBackoff(api, `/api/multiplayer/events/${eventId}/matches/${match.id}/result`, {
      organizer_token: token,
      player1_wins: 2,
      player2_wins: 0,
      replay_room_id: replayRoomId,
      highlight: 'E2E shared table replay attached for learning report.',
  });
  await expectApiOk(reported, 'report event result');
  await api.dispose();
  return eventId;
}

async function closeRoomForQa(baseURL: string, roomId: string, hostPlayerId: string) {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: qaHeaders() });
  await postJsonWithBackoff(api, `/api/multiplayer/rooms/${roomId}/close`, { player_id: hostPlayerId });
  await api.dispose();
}

test('shared room training loop is playable, replayable, and mobile-readable', async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const eventContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const mobile = await mobileContext.newPage();
  const eventPage = await eventContext.newPage();
  let roomId = '';
  let hostPlayerId = '';

  try {
    const created = await createRoomThroughUi(host);
    roomId = created.roomId;
    hostPlayerId = created.hostPlayerId;
    await joinRoomThroughUi(guest, roomId, created.password);

    await lockSeat(host, {
      deckName: 'E2E Host Stompy',
      commander: hostCommander,
      list: deckList('Forest'),
    });
    await lockSeat(guest, {
      deckName: 'E2E Guest Spells',
      commander: guestCommander,
      list: deckList('Island'),
    });

    await host.reload();
    await expect(host.getByText('E2E Guest', { exact: true })).toBeVisible();
    await expect(host.getByText('99 cards locked')).toHaveCount(2);
    await host.getByRole('button', { name: 'Start Shared Table' }).click();
    await expect(host.getByText('Shared table started.', { exact: true })).toBeVisible();

    await clickUnique(host, 'Draw');
    await host.getByPlaceholder('Optional note, spell name, or shortcut').fill('E2E host permanent');
    await clickUnique(host, 'Play Permanent');
    await clickUnique(host, 'Pass Turn');

    await guest.reload();
    await expect(guest.getByText('Turn 2 - beginning')).toBeVisible();
    await clickUnique(guest, 'Next Phase');
    await expect(guest.getByText('Turn 2 - main')).toBeVisible();
    await clickUnique(guest, 'Draw');
    await guest.getByPlaceholder('Optional note, spell name, or shortcut').fill('E2E guest permanent');
    await clickUnique(guest, 'Play Permanent');
    await clickUnique(guest, 'Concede');

    await host.reload();
    await expect(host.getByText('Match Complete')).toBeVisible();
    await expect(host.getByText(`${created.hostName} wins the shared table.`)).toBeVisible();
    await host.getByRole('button', { name: 'Replay Review' }).click();
    await expect(host.getByText('Learning Replay')).toBeVisible();
    await expect(host.getByTestId('room-next-drills')).toBeVisible();
    await expect(host.getByText('Next Drills')).toBeVisible();
    await expect(host.getByText('Replay Timeline')).toBeVisible();

    await mobile.goto(`/multiplayer/${roomId}?review=1&e2e=mobile-replay`);
    await closeAlpha(mobile);
    await expect(mobile.getByText('Learning Replay')).toBeVisible();
    await expect(mobile.getByTestId('room-next-drills')).toBeVisible();
    const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(mobileOverflow).toBeLessThanOrEqual(4);

    const eventId = await seedEventLearning(baseURL!, roomId);
    await eventPage.goto(`/events/${eventId}?learningReport=e2e`);
    await closeAlpha(eventPage);
    await expect(eventPage.getByTestId('event-learning-report')).toBeVisible();
    await expect(eventPage.getByText('Replay Coverage')).toBeVisible();
    await expect(eventPage.getByText('Next Event Drills')).toBeVisible();
    await expect(eventPage.getByText('Player Practice Focus')).toBeVisible();
  } finally {
    if (baseURL && roomId && hostPlayerId) {
      await closeRoomForQa(baseURL, roomId, hostPlayerId).catch(() => {});
    }
    await hostContext.close();
    await guestContext.close();
    await mobileContext.close();
    await eventContext.close();
  }
});

test('four-player shared tracker seats a full pod and cycles turns', async ({ browser, baseURL }) => {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const [host, playerTwo, playerThree, playerFour] = await Promise.all(contexts.map((context) => context.newPage()));
  let roomId = '';
  let hostPlayerId = '';

  try {
    const created = await createRoomThroughUi(host);
    roomId = created.roomId;
    hostPlayerId = created.hostPlayerId;

    await joinRoomThroughUi(playerTwo, roomId, created.password, 'E2E Player Two');
    await joinRoomThroughUi(playerThree, roomId, created.password, 'E2E Player Three');
    await joinRoomThroughUi(playerFour, roomId, created.password, 'E2E Player Four');

    await lockSeat(host, {
      deckName: 'E2E Host Stompy',
      commander: hostCommander,
      list: deckList('Forest'),
    });
    await lockSeat(playerTwo, {
      deckName: 'E2E Player Two Spells',
      commander: guestCommander,
      list: deckList('Island'),
    });
    await lockSeat(playerThree, {
      deckName: 'E2E Player Three Aggro',
      commander: 'Aurelia, the Warleader',
      list: deckList('Mountain'),
    });
    await lockSeat(playerFour, {
      deckName: 'E2E Player Four Value',
      commander: 'Muldrotha, the Gravetide',
      list: deckList('Swamp'),
    });

    await host.reload();
    await expect(host.getByText('4/4 seated - waiting', { exact: true })).toBeVisible();
    await expect(host.getByText('99 cards locked')).toHaveCount(4);
    await host.getByRole('button', { name: 'Start Shared Table' }).click();
    await expect(host.getByText('Shared table started.', { exact: true })).toBeVisible();

    await clickUnique(host, 'Draw');
    await clickUnique(host, 'Pass Turn');

    const turnPages = [
      { page: playerTwo, turn: 2 },
      { page: playerThree, turn: 3 },
      { page: playerFour, turn: 4 },
    ];
    for (const { page, turn } of turnPages) {
      await page.reload();
      await expect(page.getByText(`Turn ${turn} - beginning`)).toBeVisible();
      await clickUnique(page, 'Draw');
      await clickUnique(page, 'Pass Turn');
    }

    await host.reload();
    await expect(host.getByText('Turn 5 - beginning')).toBeVisible();
    await expect(host.getByText(`Current turn: ${created.hostName}`, { exact: true })).toBeVisible();
    await expect(host.getByText('Game Log')).toBeVisible();
  } finally {
    if (baseURL && roomId && hostPlayerId) {
      await closeRoomForQa(baseURL, roomId, hostPlayerId).catch(() => {});
    }
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('engine beta starts separately with scoped views for both players', async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let roomId = '';
  let hostPlayerId = '';

  try {
    const created = await createRoomThroughUi(host);
    roomId = created.roomId;
    hostPlayerId = created.hostPlayerId;
    await joinRoomThroughUi(guest, roomId, created.password);

    await lockSeat(host, {
      deckName: 'E2E Engine Host Basics',
      commander: hostCommander,
      list: deckList('Forest'),
    });
    await lockSeat(guest, {
      deckName: 'E2E Engine Guest Basics',
      commander: guestCommander,
      list: deckList('Island'),
    });

    await host.reload();
    await expect(host.getByText('99 cards locked')).toHaveCount(2);
    const engineButton = host.getByRole('button', { name: 'Start Engine Beta' });
    await expect(engineButton).toBeEnabled();
    await engineButton.click();

    await expect(host.getByText('Mode: Engine Beta')).toBeVisible();
    await expect(host.getByText('Experimental Real Engine')).toBeVisible();
    await expect(host.getByText(`Authority: ${created.hostName}`, { exact: true })).toBeVisible();
    await expect(host.getByText('Scoped hidden views')).toBeVisible();
    await expect(host.getByText('Real Actions')).toBeVisible();
    await expect(host.getByRole('button', { name: 'Pass Priority' })).toBeVisible();
    await expect(host.getByRole('button', { name: 'Play First Land' })).toBeVisible();

    await guest.reload();
    await expect(guest.getByText('Mode: Engine Beta')).toBeVisible();
    await expect(guest.getByText('Experimental Real Engine')).toBeVisible();
    await expect(guest.getByText(`Authority: ${created.hostName}`, { exact: true })).toBeVisible();
    await expect(guest.getByText('Scoped hidden views')).toBeVisible();
    await expect(guest.getByText('Real Actions')).toBeVisible();
    await expect(guest.getByText('Waiting for authority snapshot')).not.toBeVisible();
  } finally {
    if (baseURL && roomId && hostPlayerId) {
      await closeRoomForQa(baseURL, roomId, hostPlayerId).catch(() => {});
    }
    await hostContext.close();
    await guestContext.close();
  }
});

test('four-player engine beta starts with scoped views for a full pod', async ({ browser, baseURL }) => {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const [host, playerTwo, playerThree, playerFour] = await Promise.all(contexts.map((context) => context.newPage()));
  let roomId = '';
  let hostPlayerId = '';

  try {
    const created = await createRoomThroughUi(host);
    roomId = created.roomId;
    hostPlayerId = created.hostPlayerId;
    await joinRoomThroughUi(playerTwo, roomId, created.password, 'E2E Engine Two');
    await joinRoomThroughUi(playerThree, roomId, created.password, 'E2E Engine Three');
    await joinRoomThroughUi(playerFour, roomId, created.password, 'E2E Engine Four');

    await lockSeat(host, {
      deckName: 'E2E Engine Host Basics',
      commander: hostCommander,
      list: deckList('Forest'),
    });
    await lockSeat(playerTwo, {
      deckName: 'E2E Engine Two Basics',
      commander: guestCommander,
      list: deckList('Island'),
    });
    await lockSeat(playerThree, {
      deckName: 'E2E Engine Three Basics',
      commander: 'Krenko, Mob Boss',
      list: deckList('Mountain'),
    });
    await lockSeat(playerFour, {
      deckName: 'E2E Engine Four Basics',
      commander: 'Ayli, Eternal Pilgrim',
      list: deckList('Swamp'),
    });

    await host.reload();
    await expect(host.getByText('4/4 seated - waiting', { exact: true })).toBeVisible();
    await expect(host.getByText('99 cards locked')).toHaveCount(4);
    const engineButton = host.getByRole('button', { name: 'Start Engine Beta' });
    await expect(engineButton).toBeEnabled();
    await engineButton.click();

    await expect(host.getByText('Mode: Engine Beta')).toBeVisible();
    await expect(host.getByText('Experimental Real Engine')).toBeVisible();
    await expect(host.getByText(`Authority: ${created.hostName}`, { exact: true })).toBeVisible();
    await expect(host.getByText('Scoped hidden views')).toBeVisible();
    await expect(host.getByRole('button', { name: 'Pass Priority' })).toBeVisible();

    for (const page of [playerTwo, playerThree, playerFour]) {
      await page.reload();
      await expect(page.getByText('Mode: Engine Beta')).toBeVisible();
      await expect(page.getByText('Experimental Real Engine')).toBeVisible();
      await expect(page.getByText(`Authority: ${created.hostName}`, { exact: true })).toBeVisible();
      await expect(page.getByText('Scoped hidden views')).toBeVisible();
      await expect(page.getByText('Waiting for authority snapshot')).not.toBeVisible();
    }
  } finally {
    if (baseURL && roomId && hostPlayerId) {
      await closeRoomForQa(baseURL, roomId, hostPlayerId).catch(() => {});
    }
    await Promise.all(contexts.map((context) => context.close()));
  }
});
