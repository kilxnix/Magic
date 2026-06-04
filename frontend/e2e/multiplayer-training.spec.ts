import { expect, request, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import {
  createCardLookup,
  getCardDefinition,
  getPlayerView,
  initRoomGame,
  serializeGameState,
  type GameState,
  type ScryfallCard,
} from 'commander-engine';

const hostCommander = 'Goreclaw, Terror of Qal Sisma';
const guestCommander = 'Talrand, Sky Summoner';

test.describe.configure({ mode: 'serial' });

function deckList(cardName: string) {
  return Array.from({ length: 99 }, () => `1x ${cardName}`).join('\n');
}

function partnerDeckList(cardName: string) {
  return Array.from({ length: 98 }, () => `1x ${cardName}`).join('\n');
}

function repeatedCardNames(cardName: string, count = 99) {
  return Array.from({ length: count }, () => cardName);
}

function creatureCard(id: string, name: string, power = '2', toughness = '2', oracleText = ''): ScryfallCard {
  return {
    id,
    name,
    type_line: 'Legendary Creature - Test',
    oracle_text: oracleText,
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    power,
    toughness,
    legalities: { commander: 'legal' },
  };
}

function basicLandCard(id: string, name: string, subtype: string, color: 'W' | 'U' | 'B' | 'R' | 'G'): ScryfallCard {
  return {
    id,
    name,
    type_line: `Basic Land - ${subtype}`,
    oracle_text: `({T}: Add {${color}}.)`,
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [color],
    keywords: [],
    legalities: { commander: 'legal' },
  };
}

const e2eCardLookup = createCardLookup([
  creatureCard('e2e-goreclaw', hostCommander, '4', '3'),
  creatureCard('e2e-talrand', guestCommander, '2', '2'),
  creatureCard('e2e-krenko', 'Krenko, Mob Boss', '3', '3'),
  creatureCard('e2e-ayli', 'Ayli, Eternal Pilgrim', '2', '3'),
  creatureCard('e2e-memnite', 'Memnite', '1', '1', ''),
  basicLandCard('e2e-plains', 'Plains', 'Plains', 'W'),
  basicLandCard('e2e-island', 'Island', 'Island', 'U'),
  basicLandCard('e2e-swamp', 'Swamp', 'Swamp', 'B'),
  basicLandCard('e2e-mountain', 'Mountain', 'Mountain', 'R'),
  basicLandCard('e2e-forest', 'Forest', 'Forest', 'G'),
]);

function setPriority(state: GameState, playerId: string): GameState {
  const priorityIndex = Math.max(0, state.players.findIndex(player => player.id === playerId));
  return {
    ...state,
    priorityPlayerIndex: priorityIndex,
    hasPriorityPassed: state.players.map(() => false),
    players: state.players.map((player, index) => ({
      ...player,
      hasPriority: index === priorityIndex,
    })),
  };
}

function createMultiDefenderCombatSeed(input: {
  host: { playerId: string; playerName: string };
  playerTwo: { playerId: string; playerName: string };
  playerThree: { playerId: string; playerName: string };
  playerFour: { playerId: string; playerName: string };
}): GameState {
  let state = initRoomGame({
    players: [
      {
        id: input.host.playerId,
        name: input.host.playerName,
        deck: {
          id: 'e2e-multi-attack-host',
          commander: hostCommander,
          list: repeatedCardNames('Memnite'),
          colors: [],
          bracket: 2,
          theme: 'e2e',
        },
      },
      {
        id: input.playerTwo.playerId,
        name: input.playerTwo.playerName,
        deck: {
          id: 'e2e-multi-attack-two',
          commander: guestCommander,
          list: repeatedCardNames('Island'),
          colors: ['U'],
          bracket: 2,
          theme: 'e2e',
        },
      },
      {
        id: input.playerThree.playerId,
        name: input.playerThree.playerName,
        deck: {
          id: 'e2e-multi-attack-three',
          commander: 'Krenko, Mob Boss',
          list: repeatedCardNames('Mountain'),
          colors: ['R'],
          bracket: 2,
          theme: 'e2e',
        },
      },
      {
        id: input.playerFour.playerId,
        name: input.playerFour.playerName,
        deck: {
          id: 'e2e-multi-attack-four',
          commander: 'Ayli, Eternal Pilgrim',
          list: repeatedCardNames('Swamp'),
          colors: ['B'],
          bracket: 2,
          theme: 'e2e',
        },
      },
    ],
    cardLookup: e2eCardLookup,
    firstPlayerId: input.host.playerId,
    startingLife: 40,
    startingHandSize: 7,
  });

  const cards = new Map(state.cards);
  const hostMemnites = [...cards.values()]
    .filter(card => card.ownerId === input.host.playerId && getCardDefinition(state, card).name === 'Memnite')
    .slice(0, 2);
  for (const card of hostMemnites) {
    cards.set(card.instanceId, {
      ...card,
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
    });
  }

  const hostIndex = Math.max(0, state.players.findIndex(player => player.id === input.host.playerId));
  state = {
    ...state,
    cards,
    activePlayerIndex: hostIndex,
    phase: 'combat',
    step: 'declare_attackers',
    turnNumber: 5,
    stack: [],
    combat: null,
    pendingTriggers: [],
  };
  return setPriority(state, input.host.playerId);
}

async function publishEngineSeed(
  baseURL: string,
  roomId: string,
  authorityPlayerId: string,
  state: GameState,
) {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: qaHeaders() });
  const published = await postJsonWithBackoff(api, `/api/multiplayer/rooms/${roomId}/real-game/snapshot`, {
    player_id: authorityPlayerId,
    revision: 50,
    views: Object.fromEntries(state.players.map(player => [player.id, getPlayerView(state, player.id)])),
    engine_state: serializeGameState(state),
    completed_action_ids: [],
    rejected_actions: {},
    events: ['E2E seeded multi-defender combat state.'],
  });
  await expectApiOk(published, 'publish engine seed');
  await api.dispose();
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
  const expectedCards = input.list.split(/\r?\n/).filter(line => line.trim()).reduce((sum, line) => {
    const match = line.trim().match(/^(\d+)\s*x?\s+/i);
    return sum + (match ? Number(match[1]) : 1);
  }, 0);
  await page.getByPlaceholder('Deck name').fill(input.deckName);
  await page.getByRole('textbox', { name: 'Commander', exact: true }).fill(input.commander);
  await page.locator('textarea[placeholder^="Paste a Commander decklist"]').fill(input.list);
  const ready = page.getByLabel('Ready to play');
  if (!(await ready.isChecked())) {
    await ready.check();
  }
  await page.getByRole('button', { name: 'Save Seat' }).click();
  await expect(page.getByText('Ready state saved.')).toBeVisible();
  await expect(page.getByText(`${expectedCards} non-commander cards ready to lock.`)).toBeVisible();
}

async function roomSession(page: Page) {
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('magicbrains_multiplayer_session_v1') || 'null'));
  expect(session?.roomId).toBeTruthy();
  expect(session?.playerId).toBeTruthy();
  return session as { roomId: string; playerId: string; playerName: string; isHost?: boolean };
}

async function clickUnique(page: Page, roleName: string) {
  const button = page.getByRole('button', { name: roleName });
  await expect(button).toHaveCount(1);
  await button.click();
}

async function passCurrentEnginePriority(priorityPages: Page[]) {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const priorityText = await priorityPages[0]
      .getByTestId('real-engine-priority-player')
      .innerText({ timeout: 1_000 })
      .catch(() => '');
    const priorityName = priorityText.replace(/^Priority:\s*/i, '').trim();
    const sessions = await Promise.all(priorityPages.map(async (page) => ({
      page,
      session: await roomSession(page).catch(() => null),
    })));
    const priorityPage = sessions.find(entry => entry.session?.playerName === priorityName)?.page;
    const candidates = priorityPage
      ? [priorityPage, ...priorityPages.filter(page => page !== priorityPage)]
      : priorityPages;

    for (const page of candidates) {
      const pass = page.getByRole('button', { name: 'Pass Priority' });
      if (await pass.isEnabled().catch(() => false)) {
        const clicked = await pass.click({ timeout: 2_000 }).then(() => true).catch(() => false);
        if (clicked) {
          await page.waitForTimeout(250);
          return;
        }
      }
    }
    await priorityPages[0].waitForTimeout(250);
  }

  const priority = await priorityPages[0]
    .getByTestId('real-engine-priority-player')
    .innerText({ timeout: 5_000 })
    .catch(() => 'Priority: unknown');
  throw new Error(`No browser had an enabled Pass Priority button while ${priority}`);
}

async function advanceEnginePodToPrecombatMain(priorityPages: Page[], observer: Page = priorityPages[0], turnNumber = 1) {
  const turnLabel = observer.getByTestId('real-engine-turn-label');
  if ((await turnLabel.innerText()).trim() === `Turn ${turnNumber} - beginning / untap`) {
    await passEnginePriorityUntilTurnLabel(priorityPages, observer, `Turn ${turnNumber} - beginning / upkeep`);
  }
  await expect(turnLabel).toHaveText(`Turn ${turnNumber} - beginning / upkeep`, { timeout: 20_000 });
  await passEnginePriorityUntilTurnLabel(priorityPages, observer, `Turn ${turnNumber} - beginning / draw`);
  await expect(turnLabel).toHaveText(`Turn ${turnNumber} - beginning / draw`, { timeout: 20_000 });
  await passEnginePriorityUntilTurnLabel(priorityPages, observer, `Turn ${turnNumber} - precombat main`);
  await expect(turnLabel).toHaveText(`Turn ${turnNumber} - precombat main`, { timeout: 20_000 });
}

async function advanceEngineToPrecombatMain(host: Page, guest: Page) {
  await advanceEnginePodToPrecombatMain([host, guest], host);
}

async function passEnginePriorityCycle(priorityPages: Page[]) {
  for (let index = 0; index < priorityPages.length; index += 1) {
    await passCurrentEnginePriority(priorityPages);
  }
}

async function passEnginePriorityUntilTurnLabel(
  priorityPages: Page[],
  observer: Page,
  expectedText: string,
  maxPasses = priorityPages.length + 4,
) {
  const turnLabel = observer.getByTestId('real-engine-turn-label');
  for (let index = 0; index < maxPasses; index += 1) {
    if ((await turnLabel.innerText()).includes(expectedText)) {
      return;
    }
    await passCurrentEnginePriority(priorityPages);
    const reached = await expect(turnLabel)
      .toContainText(expectedText, { timeout: 1_500 })
      .then(() => true)
      .catch(() => false);
    if (reached) {
      return;
    }
  }
  await expect(turnLabel).toContainText(expectedText, { timeout: 20_000 });
}

async function passEnginePriorityUntilStackEmpty(priorityPages: Page[], observer: Page) {
  for (let index = 0; index < priorityPages.length + 3; index += 1) {
    if ((await observer.getByTestId('real-engine-stack-size').innerText()).trim() === 'Stack: 0') {
      return;
    }
    await passCurrentEnginePriority(priorityPages);
    const resolved = await expect(observer.getByTestId('real-engine-stack-size'))
      .toHaveText('Stack: 0', { timeout: 1_500 })
      .then(() => true)
      .catch(() => false);
    if (resolved) {
      return;
    }
  }
  await expect(observer.getByTestId('real-engine-stack-size')).toHaveText('Stack: 0', { timeout: 20_000 });
}

async function advanceEngineEmptyTurn(priorityPages: Page[], observer: Page, nextTurnLabel: string) {
  await passEnginePriorityUntilTurnLabel(priorityPages, observer, 'declare_attackers');
  await expect(observer.getByTestId('real-engine-turn-label')).toContainText('declare_attackers', { timeout: 20_000 });
  const noAttacks = priorityPages[0].getByRole('button', { name: 'No Attacks' });
  await expect(noAttacks).toBeEnabled({ timeout: 20_000 });
  await noAttacks.click();
  await passEnginePriorityUntilTurnLabel(priorityPages, observer, 'end_of_combat');
  await passEnginePriorityUntilTurnLabel(priorityPages, observer, 'postcombat main');
  await passEnginePriorityUntilTurnLabel(priorityPages, observer, 'ending / cleanup');
  await passEnginePriorityUntilTurnLabel(priorityPages, observer, nextTurnLabel);
}

async function castSelectedSpellAndResolve(activePage: Page, priorityPages: Page[], playerId: string, cardName: string) {
  await expect(activePage.getByRole('button', { name: 'Cast Selected Spell' })).toBeEnabled({ timeout: 20_000 });
  await activePage.getByRole('button', { name: 'Cast Selected Spell' }).click();
  await expect(activePage.getByTestId('real-engine-stack-size')).toHaveText('Stack: 1', { timeout: 20_000 });
  await passEnginePriorityUntilStackEmpty(priorityPages, activePage);
  await expect(activePage.getByTestId('real-engine-stack-size')).toHaveText('Stack: 0', { timeout: 20_000 });
  await expect(activePage.getByTestId(`real-engine-battlefield-${playerId}`)).toContainText(cardName, { timeout: 20_000 });
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

test('multiplayer lobby ignores stale saved room sessions', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('magicbrains_multiplayer_session_v1', JSON.stringify({
      roomId: 'expiredroom',
      playerId: 'expired-player',
      playerName: 'Expired Player',
      isHost: true,
    }));
  });
  await page.goto('/multiplayer?e2e=stale-session');
  await closeAlpha(page);
  await expect(page.getByText('Host a private beta room')).toBeVisible();
  await expect(page.getByText('Room not found')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create Beta Room' })).toBeEnabled();
});

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

test('engine beta applies land and priority actions across two real browser seats', async ({ browser, baseURL }) => {
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
      deckName: 'E2E Engine Host Lands',
      commander: hostCommander,
      list: deckList('Forest'),
    });
    await lockSeat(guest, {
      deckName: 'E2E Engine Guest Lands',
      commander: guestCommander,
      list: deckList('Island'),
    });

    const hostSession = await roomSession(host);
    const guestSession = await roomSession(guest);

    await host.reload();
    await expect(host.getByText('99 cards locked')).toHaveCount(2);
    await host.getByRole('button', { name: 'Start Engine Beta' }).click();
    await expect(host.getByText('Mode: Engine Beta')).toBeVisible();
    await expect(guest.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });

    await advanceEngineToPrecombatMain(host, guest);

    const playLand = host.getByRole('button', { name: 'Play First Land' });
    await expect(playLand).toBeEnabled({ timeout: 20_000 });
    await playLand.click();
    await expect(host.getByTestId(`real-engine-board-count-${hostSession.playerId}`)).toHaveText('1', { timeout: 20_000 });
    await expect(host.getByTestId(`real-engine-hand-count-${hostSession.playerId}`)).toHaveText('6');
    await expect(host.getByTestId(`real-engine-battlefield-${hostSession.playerId}`)).toContainText('Forest');
    await expect(host.getByTestId('real-engine-log')).toContainText(`${created.hostName} played a land.`);

    await guest.reload();
    await expect(guest.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });
    await expect(guest.getByTestId(`real-engine-board-count-${hostSession.playerId}`)).toHaveText('1');
    await expect(guest.getByTestId(`real-engine-battlefield-${hostSession.playerId}`)).toContainText('Forest');
    await expect(guest.getByTestId(`real-engine-hand-preview-${hostSession.playerId}`)).toHaveCount(0);
    await expect(guest.getByTestId(`real-engine-hand-preview-${guestSession.playerId}`)).toContainText('Island');

    await passCurrentEnginePriority([host, guest]);
    await expect(guest.getByTestId('real-engine-priority-player')).toHaveText(`Priority: ${guestSession.playerName}`, { timeout: 20_000 });
    await passCurrentEnginePriority([host, guest]);
    await expect(host.getByTestId('real-engine-turn-label')).toHaveText('Turn 1 - combat / declare_attackers', { timeout: 20_000 });
    await expect(host.getByTestId('real-engine-log')).toContainText('All players passed; advanced to combat / declare_attackers.');
  } finally {
    if (baseURL && roomId && hostPlayerId) {
      await closeRoomForQa(baseURL, roomId, hostPlayerId).catch(() => {});
    }
    await hostContext.close();
    await guestContext.close();
  }
});

test('engine beta casts a zero-cost spell through stack resolution and reload sync', async ({ browser, baseURL }) => {
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
      deckName: 'E2E Engine Host Spell',
      commander: hostCommander,
      list: deckList('Memnite'),
    });
    await lockSeat(guest, {
      deckName: 'E2E Engine Guest Islands',
      commander: guestCommander,
      list: deckList('Island'),
    });

    const hostSession = await roomSession(host);

    await host.reload();
    await expect(host.getByText('99 cards locked')).toHaveCount(2);
    await host.getByRole('button', { name: 'Start Engine Beta' }).click();
    await expect(host.getByText('Mode: Engine Beta')).toBeVisible();
    await expect(guest.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });

    await advanceEngineToPrecombatMain(host, guest);

    await expect(host.getByLabel('Selected spell')).toHaveValue(/room_card_/);
    await expect(host.getByRole('button', { name: 'Cast Selected Spell' })).toBeEnabled({ timeout: 20_000 });
    await host.getByRole('button', { name: 'Cast Selected Spell' }).click();
    await expect(host.getByTestId('real-engine-stack-size')).toHaveText('Stack: 1', { timeout: 20_000 });
    await expect(host.getByTestId('real-engine-log')).toContainText(`${created.hostName} cast Memnite.`);
    await expect(host.getByTestId(`real-engine-board-count-${hostSession.playerId}`)).toHaveText('0');

    await passEnginePriorityUntilStackEmpty([host, guest], host);
    await expect(host.getByTestId('real-engine-stack-size')).toHaveText('Stack: 0', { timeout: 20_000 });
    await expect(host.getByTestId(`real-engine-board-count-${hostSession.playerId}`)).toHaveText('1');
    await expect(host.getByTestId(`real-engine-battlefield-${hostSession.playerId}`)).toContainText('Memnite');
    await expect(host.getByTestId('real-engine-log')).toContainText('All players passed; the top stack item resolved.');

    await guest.reload();
    await expect(guest.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });
    await expect(guest.getByTestId(`real-engine-board-count-${hostSession.playerId}`)).toHaveText('1');
    await expect(guest.getByTestId(`real-engine-battlefield-${hostSession.playerId}`)).toContainText('Memnite');
  } finally {
    if (baseURL && roomId && hostPlayerId) {
      await closeRoomForQa(baseURL, roomId, hostPlayerId).catch(() => {});
    }
    await hostContext.close();
    await guestContext.close();
  }
});

test('engine beta combat can attack, skip blocks, deal damage, and reload sync', async ({ browser, baseURL }) => {
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
      deckName: 'E2E Engine Combat Host',
      commander: hostCommander,
      list: deckList('Memnite'),
    });
    await lockSeat(guest, {
      deckName: 'E2E Engine Combat Guest',
      commander: guestCommander,
      list: deckList('Island'),
    });

    const hostSession = await roomSession(host);
    const guestSession = await roomSession(guest);

    await host.reload();
    await expect(host.getByText('99 cards locked')).toHaveCount(2);
    await host.getByRole('button', { name: 'Start Engine Beta' }).click();
    await expect(host.getByText('Mode: Engine Beta')).toBeVisible();
    await expect(guest.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });

    await advanceEngineToPrecombatMain(host, guest);
    await expect(host.getByRole('button', { name: 'Cast Selected Spell' })).toBeEnabled({ timeout: 20_000 });
    await host.getByRole('button', { name: 'Cast Selected Spell' }).click();
    await expect(host.getByTestId('real-engine-stack-size')).toHaveText('Stack: 1', { timeout: 20_000 });
    await passEnginePriorityUntilStackEmpty([host, guest], host);
    await expect(host.getByTestId(`real-engine-battlefield-${hostSession.playerId}`)).toContainText('Memnite', { timeout: 20_000 });

    await advanceEngineEmptyTurn([host, guest], host, 'Turn 2 - beginning / untap');
    await advanceEnginePodToPrecombatMain([guest, host], host, 2);
    await advanceEngineEmptyTurn([guest, host], host, 'Turn 3 - beginning / untap');
    await advanceEnginePodToPrecombatMain([host, guest], host, 3);
    await passEnginePriorityUntilTurnLabel([host, guest], host, 'Turn 3 - combat / declare_attackers');
    await expect(host.getByTestId('real-engine-turn-label')).toHaveText('Turn 3 - combat / declare_attackers', { timeout: 20_000 });

    const attack = host.getByRole('button', { name: 'Attack First Creature' });
    await expect(attack).toBeEnabled({ timeout: 20_000 });
    await attack.click();
    await expect(host.getByText('Memnite 1/1')).toBeVisible({ timeout: 20_000 });
    await expect(host.getByText(`Attacking ${guestSession.playerName}`)).toBeVisible({ timeout: 20_000 });

    await passEnginePriorityUntilTurnLabel([host, guest], guest, 'Turn 3 - combat / declare_blockers');
    await expect(guest.getByTestId('real-engine-turn-label')).toHaveText('Turn 3 - combat / declare_blockers', { timeout: 20_000 });
    const noBlocks = guest.getByRole('button', { name: 'No Blocks' });
    await expect(noBlocks).toBeEnabled({ timeout: 20_000 });
    await noBlocks.click();

    await passEnginePriorityUntilTurnLabel([host, guest], host, 'Turn 3 - combat / first_strike_damage');
    await expect(host.getByTestId('real-engine-turn-label')).toHaveText('Turn 3 - combat / first_strike_damage', { timeout: 20_000 });
    await passEnginePriorityUntilTurnLabel([host, guest], host, 'Turn 3 - combat / combat_damage');
    await expect(host.getByTestId('real-engine-turn-label')).toHaveText('Turn 3 - combat / combat_damage', { timeout: 20_000 });
    await passEnginePriorityUntilTurnLabel([host, guest], host, 'Turn 3 - combat / end_of_combat');

    await expect(host.getByTestId(`real-engine-life-${guestSession.playerId}`)).toHaveText('39', { timeout: 20_000 });
    await expect(host.getByTestId('real-engine-log')).toContainText('Combat damage resolved.');

    await guest.reload();
    await expect(guest.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });
    await expect(guest.getByTestId(`real-engine-life-${guestSession.playerId}`)).toHaveText('39');
    await expect(guest.getByTestId(`real-engine-battlefield-${hostSession.playerId}`)).toContainText('Memnite');
  } finally {
    if (baseURL && roomId && hostPlayerId) {
      await closeRoomForQa(baseURL, roomId, hostPlayerId).catch(() => {});
    }
    await hostContext.close();
    await guestContext.close();
  }
});

test('engine beta combat can declare a real blocker and prevent player damage', async ({ browser, baseURL }) => {
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
      deckName: 'E2E Engine Block Host',
      commander: hostCommander,
      list: deckList('Memnite'),
    });
    await lockSeat(guest, {
      deckName: 'E2E Engine Block Guest',
      commander: guestCommander,
      list: deckList('Memnite'),
    });

    const hostSession = await roomSession(host);
    const guestSession = await roomSession(guest);

    await host.reload();
    await expect(host.getByText('99 cards locked')).toHaveCount(2);
    await host.getByRole('button', { name: 'Start Engine Beta' }).click();
    await expect(host.getByText('Mode: Engine Beta')).toBeVisible();
    await expect(guest.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });

    await advanceEngineToPrecombatMain(host, guest);
    await expect(host.getByRole('button', { name: 'Cast Selected Spell' })).toBeEnabled({ timeout: 20_000 });
    await host.getByRole('button', { name: 'Cast Selected Spell' }).click();
    await passEnginePriorityUntilStackEmpty([host, guest], host);
    await expect(host.getByTestId(`real-engine-battlefield-${hostSession.playerId}`)).toContainText('Memnite', { timeout: 20_000 });

    await advanceEngineEmptyTurn([host, guest], host, 'Turn 2 - beginning / untap');
    await advanceEnginePodToPrecombatMain([guest, host], host, 2);
    await expect(guest.getByRole('button', { name: 'Cast Selected Spell' })).toBeEnabled({ timeout: 20_000 });
    await guest.getByRole('button', { name: 'Cast Selected Spell' }).click();
    await passEnginePriorityUntilStackEmpty([guest, host], guest);
    await expect(guest.getByTestId(`real-engine-battlefield-${guestSession.playerId}`)).toContainText('Memnite', { timeout: 20_000 });

    await advanceEngineEmptyTurn([guest, host], host, 'Turn 3 - beginning / untap');
    await advanceEnginePodToPrecombatMain([host, guest], host, 3);
    await passEnginePriorityUntilTurnLabel([host, guest], host, 'Turn 3 - combat / declare_attackers');
    await expect(host.getByTestId('real-engine-turn-label')).toHaveText('Turn 3 - combat / declare_attackers', { timeout: 20_000 });

    await expect(host.getByRole('button', { name: 'Attack First Creature' })).toBeEnabled({ timeout: 20_000 });
    await host.getByRole('button', { name: 'Attack First Creature' }).click();
    await expect(host.getByText(`Attacking ${guestSession.playerName}`)).toBeVisible({ timeout: 20_000 });

    await passEnginePriorityUntilTurnLabel([host, guest], guest, 'Turn 3 - combat / declare_blockers');
    await expect(guest.getByTestId('real-engine-turn-label')).toHaveText('Turn 3 - combat / declare_blockers', { timeout: 20_000 });
    await expect(guest.getByRole('button', { name: 'Declare Selected Blocker' })).toBeEnabled({ timeout: 20_000 });
    await guest.getByRole('button', { name: 'Declare Selected Blocker' }).click();
    await expect(guest.getByTestId('real-engine-log')).toContainText(`${guestSession.playerName} declared 1 blocker(s).`, { timeout: 20_000 });

    await passEnginePriorityUntilTurnLabel([host, guest], host, 'Turn 3 - combat / first_strike_damage');
    await expect(host.getByTestId('real-engine-turn-label')).toHaveText('Turn 3 - combat / first_strike_damage', { timeout: 20_000 });
    await passEnginePriorityUntilTurnLabel([host, guest], host, 'Turn 3 - combat / combat_damage');
    await expect(host.getByTestId('real-engine-turn-label')).toHaveText('Turn 3 - combat / combat_damage', { timeout: 20_000 });
    await passEnginePriorityUntilTurnLabel([host, guest], host, 'Turn 3 - combat / end_of_combat');

    await expect(host.getByTestId(`real-engine-life-${hostSession.playerId}`)).toHaveText('40', { timeout: 20_000 });
    await expect(host.getByTestId(`real-engine-life-${guestSession.playerId}`)).toHaveText('40', { timeout: 20_000 });
    await expect(host.getByTestId('real-engine-log')).toContainText('Combat damage resolved.');

    await guest.reload();
    await expect(guest.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });
    await expect(guest.getByTestId(`real-engine-life-${hostSession.playerId}`)).toHaveText('40');
    await expect(guest.getByTestId(`real-engine-life-${guestSession.playerId}`)).toHaveText('40');
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

test('four-player engine beta applies a gameplay action and keeps scoped reload views', async ({ browser, baseURL }) => {
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
    await joinRoomThroughUi(playerTwo, roomId, created.password, 'E2E Action Two');
    await joinRoomThroughUi(playerThree, roomId, created.password, 'E2E Action Three');
    await joinRoomThroughUi(playerFour, roomId, created.password, 'E2E Action Four');

    await lockSeat(host, {
      deckName: 'E2E 4P Host Lands',
      commander: hostCommander,
      list: deckList('Forest'),
    });
    await lockSeat(playerTwo, {
      deckName: 'E2E 4P Two Lands',
      commander: guestCommander,
      list: deckList('Island'),
    });
    await lockSeat(playerThree, {
      deckName: 'E2E 4P Three Lands',
      commander: 'Krenko, Mob Boss',
      list: deckList('Mountain'),
    });
    await lockSeat(playerFour, {
      deckName: 'E2E 4P Four Lands',
      commander: 'Ayli, Eternal Pilgrim',
      list: deckList('Swamp'),
    });

    const hostSession = await roomSession(host);
    const twoSession = await roomSession(playerTwo);
    const threeSession = await roomSession(playerThree);
    const fourSession = await roomSession(playerFour);

    await host.reload();
    await expect(host.getByText('99 cards locked')).toHaveCount(4);
    await host.getByRole('button', { name: 'Start Engine Beta' }).click();
    await expect(host.getByText('Mode: Engine Beta')).toBeVisible();
    for (const page of [playerTwo, playerThree, playerFour]) {
      await expect(page.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Waiting for authority snapshot')).not.toBeVisible();
    }

    await advanceEnginePodToPrecombatMain([host, playerTwo, playerThree, playerFour], host);

    const playLand = host.getByRole('button', { name: 'Play First Land' });
    await expect(playLand).toBeEnabled({ timeout: 20_000 });
    await playLand.click();
    await expect(host.getByTestId(`real-engine-board-count-${hostSession.playerId}`)).toHaveText('1', { timeout: 20_000 });
    await expect(host.getByTestId(`real-engine-battlefield-${hostSession.playerId}`)).toContainText('Forest');

    for (const { page, session: viewerSession } of [
      { page: playerTwo, session: twoSession },
      { page: playerThree, session: threeSession },
      { page: playerFour, session: fourSession },
    ]) {
      await page.reload();
      await expect(page.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId(`real-engine-board-count-${hostSession.playerId}`)).toHaveText('1');
      await expect(page.getByTestId(`real-engine-battlefield-${hostSession.playerId}`)).toContainText('Forest');
      await expect(page.getByTestId(`real-engine-hand-preview-${hostSession.playerId}`)).toHaveCount(0);
      await expect(page.getByTestId(`real-engine-hand-preview-${viewerSession.playerId}`)).toBeVisible();
    }
  } finally {
    if (baseURL && roomId && hostPlayerId) {
      await closeRoomForQa(baseURL, roomId, hostPlayerId).catch(() => {});
    }
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('four-player engine beta advances multiple turns and lets the next player act', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);

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
    await joinRoomThroughUi(playerTwo, roomId, created.password, 'E2E Turn Two');
    await joinRoomThroughUi(playerThree, roomId, created.password, 'E2E Turn Three');
    await joinRoomThroughUi(playerFour, roomId, created.password, 'E2E Turn Four');

    await lockSeat(host, {
      deckName: 'E2E Multi Turn Host',
      commander: hostCommander,
      list: deckList('Forest'),
    });
    await lockSeat(playerTwo, {
      deckName: 'E2E Multi Turn Two',
      commander: guestCommander,
      list: deckList('Island'),
    });
    await lockSeat(playerThree, {
      deckName: 'E2E Multi Turn Three',
      commander: 'Krenko, Mob Boss',
      list: deckList('Mountain'),
    });
    await lockSeat(playerFour, {
      deckName: 'E2E Multi Turn Four',
      commander: 'Ayli, Eternal Pilgrim',
      list: deckList('Swamp'),
    });

    const hostSession = await roomSession(host);
    const twoSession = await roomSession(playerTwo);

    await host.reload();
    await expect(host.getByText('99 cards locked')).toHaveCount(4);
    await host.getByRole('button', { name: 'Start Engine Beta' }).click();
    await expect(host.getByText('Mode: Engine Beta')).toBeVisible();
    for (const page of [playerTwo, playerThree, playerFour]) {
      await expect(page.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Waiting for authority snapshot')).not.toBeVisible();
    }

    await advanceEnginePodToPrecombatMain([host, playerTwo, playerThree, playerFour], host, 1);
    await expect(host.getByRole('button', { name: 'Play First Land' })).toBeEnabled({ timeout: 20_000 });
    await host.getByRole('button', { name: 'Play First Land' }).click();
    await expect(host.getByTestId(`real-engine-board-count-${hostSession.playerId}`)).toHaveText('1', { timeout: 20_000 });
    await expect(host.getByTestId(`real-engine-battlefield-${hostSession.playerId}`)).toContainText('Forest');

    await advanceEngineEmptyTurn(
      [host, playerTwo, playerThree, playerFour],
      host,
      'Turn 2 - beginning / upkeep',
    );
    await advanceEnginePodToPrecombatMain([host, playerTwo, playerThree, playerFour], playerTwo, 2);
    await expect(playerTwo.getByTestId('real-engine-priority-player')).toHaveText(`Priority: ${twoSession.playerName}`, { timeout: 20_000 });
    await expect(playerTwo.getByRole('button', { name: 'Play First Land' })).toBeEnabled({ timeout: 20_000 });
    await playerTwo.getByRole('button', { name: 'Play First Land' }).click();
    await expect(playerTwo.getByTestId(`real-engine-board-count-${twoSession.playerId}`)).toHaveText('1', { timeout: 20_000 });
    await expect(playerTwo.getByTestId(`real-engine-battlefield-${twoSession.playerId}`)).toContainText('Island');
    await expect(playerTwo.getByRole('button', { name: 'Play First Land' })).toBeDisabled({ timeout: 20_000 });

    await playerThree.reload();
    await expect(playerThree.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });
    await expect(playerThree.getByTestId(`real-engine-board-count-${hostSession.playerId}`)).toHaveText('1');
    await expect(playerThree.getByTestId(`real-engine-board-count-${twoSession.playerId}`)).toHaveText('1');
    await expect(playerThree.getByTestId(`real-engine-battlefield-${hostSession.playerId}`)).toContainText('Forest');
    await expect(playerThree.getByTestId(`real-engine-battlefield-${twoSession.playerId}`)).toContainText('Island');
  } finally {
    if (baseURL && roomId && hostPlayerId) {
      await closeRoomForQa(baseURL, roomId, hostPlayerId).catch(() => {});
    }
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('four-player engine beta attacks multiple defenders and applies combat damage separately', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);

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
    await joinRoomThroughUi(playerTwo, roomId, created.password, 'E2E Defender Two');
    await joinRoomThroughUi(playerThree, roomId, created.password, 'E2E Defender Three');
    await joinRoomThroughUi(playerFour, roomId, created.password, 'E2E Defender Four');

    await lockSeat(host, {
      deckName: 'E2E 4P Multi Attack Host',
      commander: hostCommander,
      list: deckList('Memnite'),
    });
    await lockSeat(playerTwo, {
      deckName: 'E2E 4P Multi Defender Two',
      commander: guestCommander,
      list: deckList('Island'),
    });
    await lockSeat(playerThree, {
      deckName: 'E2E 4P Multi Defender Three',
      commander: 'Krenko, Mob Boss',
      list: deckList('Mountain'),
    });
    await lockSeat(playerFour, {
      deckName: 'E2E 4P Multi Defender Four',
      commander: 'Ayli, Eternal Pilgrim',
      list: deckList('Swamp'),
    });

    const hostSession = await roomSession(host);
    const twoSession = await roomSession(playerTwo);
    const threeSession = await roomSession(playerThree);
    const fourSession = await roomSession(playerFour);

    await host.reload();
    await expect(host.getByText('99 cards locked')).toHaveCount(4);
    await host.getByRole('button', { name: 'Start Engine Beta' }).click();
    await expect(host.getByText('Mode: Engine Beta')).toBeVisible();
    for (const page of [playerTwo, playerThree, playerFour]) {
      await expect(page.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });
    }
    await publishEngineSeed(
      baseURL!,
      roomId,
      hostSession.playerId,
      createMultiDefenderCombatSeed({
        host: hostSession,
        playerTwo: twoSession,
        playerThree: threeSession,
        playerFour: fourSession,
      }),
    );
    await Promise.all([host, playerTwo, playerThree, playerFour].map(async page => {
      await page.reload();
      await expect(page.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('real-engine-turn-label')).toHaveText('Turn 5 - combat / declare_attackers', { timeout: 20_000 });
    }));
    await expect(host.getByTestId(`real-engine-board-count-${hostSession.playerId}`)).toHaveText('2', { timeout: 20_000 });

    await passEnginePriorityUntilTurnLabel(
      [host, playerTwo, playerThree, playerFour],
      host,
      'Turn 5 - combat / declare_attackers',
    );
    await expect(host.getByTestId('real-engine-turn-label')).toHaveText('Turn 5 - combat / declare_attackers', { timeout: 20_000 });
    const multiAttack = host.getByRole('button', { name: 'Attack Multiple Defenders' });
    await expect(multiAttack).toBeEnabled({ timeout: 20_000 });
    await multiAttack.click();
    await expect(host.getByText(`Attacking ${twoSession.playerName}`)).toBeVisible({ timeout: 20_000 });
    await expect(host.getByText(`Attacking ${threeSession.playerName}`)).toBeVisible({ timeout: 20_000 });

    await passEnginePriorityUntilTurnLabel(
      [host, playerTwo, playerThree, playerFour],
      playerTwo,
      'Turn 5 - combat / declare_blockers',
    );
    await expect(playerTwo.getByTestId('real-engine-turn-label')).toHaveText('Turn 5 - combat / declare_blockers', { timeout: 20_000 });
    await expect(playerTwo.getByRole('button', { name: 'No Blocks' })).toBeEnabled({ timeout: 20_000 });
    await playerTwo.getByRole('button', { name: 'No Blocks' }).click();
    await expect(playerThree.getByRole('button', { name: 'No Blocks' })).toBeEnabled({ timeout: 20_000 });
    await playerThree.getByRole('button', { name: 'No Blocks' }).click();

    await passEnginePriorityUntilTurnLabel(
      [host, playerTwo, playerThree, playerFour],
      host,
      'Turn 5 - combat / first_strike_damage',
    );
    await expect(host.getByTestId('real-engine-turn-label')).toHaveText('Turn 5 - combat / first_strike_damage', { timeout: 20_000 });
    await passEnginePriorityUntilTurnLabel(
      [host, playerTwo, playerThree, playerFour],
      host,
      'Turn 5 - combat / combat_damage',
    );
    await expect(host.getByTestId('real-engine-turn-label')).toHaveText('Turn 5 - combat / combat_damage', { timeout: 20_000 });
    await passEnginePriorityUntilTurnLabel(
      [host, playerTwo, playerThree, playerFour],
      host,
      'Turn 5 - combat / end_of_combat',
    );

    await expect(host.getByTestId(`real-engine-life-${twoSession.playerId}`)).toHaveText('39', { timeout: 20_000 });
    await expect(host.getByTestId(`real-engine-life-${threeSession.playerId}`)).toHaveText('39', { timeout: 20_000 });
    await expect(host.getByTestId(`real-engine-life-${fourSession.playerId}`)).toHaveText('40', { timeout: 20_000 });
    await expect(host.getByTestId('real-engine-log')).toContainText(`${created.hostName} declared 2 attacker(s).`);

    await playerFour.reload();
    await expect(playerFour.getByText('Mode: Engine Beta')).toBeVisible({ timeout: 20_000 });
    await expect(playerFour.getByTestId(`real-engine-life-${twoSession.playerId}`)).toHaveText('39');
    await expect(playerFour.getByTestId(`real-engine-life-${threeSession.playerId}`)).toHaveText('39');
    await expect(playerFour.getByTestId(`real-engine-life-${fourSession.playerId}`)).toHaveText('40');
  } finally {
    if (baseURL && roomId && hostPlayerId) {
      await closeRoomForQa(baseURL, roomId, hostPlayerId).catch(() => {});
    }
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('engine beta room supports partner commanders in scoped command zones', async ({ browser, baseURL }) => {
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
    await joinRoomThroughUi(guest, roomId, created.password, 'E2E Partner Guest');

    await lockSeat(host, {
      deckName: 'E2E Dargo Thrasios',
      commander: 'Dargo, the Shipwrecker // Thrasios, Triton Hero',
      list: partnerDeckList('Island'),
    });
    await lockSeat(guest, {
      deckName: 'E2E Ravos Tana',
      commander: 'Ravos, Soultender // Tana, the Bloodsower',
      list: partnerDeckList('Swamp'),
    });

    await host.reload();
    await expect(host.getByText('98 cards locked')).toHaveCount(2);
    const engineButton = host.getByRole('button', { name: 'Start Engine Beta' });
    await expect(engineButton).toBeEnabled();
    await engineButton.click();

    await expect(host.getByText('Mode: Engine Beta')).toBeVisible();
    await expect(host.getByText('Dargo, the Shipwrecker / Thrasios, Triton Hero')).toBeVisible();
    await expect(host.getByText('Ravos, Soultender / Tana, the Bloodsower')).toBeVisible();
    await expect(host.getByText('2 commanders')).toHaveCount(2);
    await expect(host.getByText('Waiting for authority snapshot')).not.toBeVisible();

    await guest.reload();
    await expect(guest.getByText('Mode: Engine Beta')).toBeVisible();
    await expect(guest.getByText('Dargo, the Shipwrecker / Thrasios, Triton Hero')).toBeVisible();
    await expect(guest.getByText('Ravos, Soultender / Tana, the Bloodsower')).toBeVisible();
    await expect(guest.getByText('2 commanders')).toHaveCount(2);
    await expect(guest.getByText('Waiting for authority snapshot')).not.toBeVisible();
  } finally {
    if (baseURL && roomId && hostPlayerId) {
      await closeRoomForQa(baseURL, roomId, hostPlayerId).catch(() => {});
    }
    await hostContext.close();
    await guestContext.close();
  }
});
