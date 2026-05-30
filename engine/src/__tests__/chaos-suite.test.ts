import { describe, expect, it } from 'vitest';
import { initGameFromDecks, resetInstanceCounter, type GameStateWithAI } from '../game-init';
import { createCardLookup, type GeneratedDeck, type ScryfallCard } from '../cards/deck-loader';
import { getLegalActions, getLegalTargets } from '../ai/legal-actions';
import { applyClientActionRequest, createClientActionRequest } from '../authority';
import { advanceStep, performUntapStep } from '../turn-manager';
import { allPlayersPassed } from '../priority';
import { putTriggersOnStack, resolveTopOfStack } from '../stack';
import { drawCards } from '../actions';
import type { AIAction } from '../ai/types';
import type { GameState, ManaColor, PendingTrigger, Zone } from '../types';
import type { TargetSpec } from '../effects/targets';

type Rng = () => number;

const VALID_ZONES: Zone[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'stack', 'command'];
const VALID_ZONE_SET = new Set<Zone>(VALID_ZONES);
const VALID_MANA_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

function mulberry32(seed: number): Rng {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededRandom<T>(seed: number, run: () => T): T {
  const previousRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return run();
  } finally {
    Math.random = previousRandom;
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pick<T>(items: T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)];
}

function card(
  name: string,
  typeLine: string,
  oracleText: string,
  manaCost: string,
  cmc: number,
  colors: ManaColor[] = [],
  colorIdentity: ManaColor[] = colors,
  power?: string,
  toughness?: string,
  keywords: string[] = [],
): ScryfallCard {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    type_line: typeLine,
    oracle_text: oracleText,
    mana_cost: manaCost,
    cmc,
    colors,
    color_identity: colorIdentity,
    keywords,
    power,
    toughness,
    legalities: { commander: 'legal' },
  };
}

function basicLand(name: string, color: ManaColor): ScryfallCard {
  return card(name, `Basic Land - ${name}`, `{T}: Add {${color}}.`, '', 0, [], [color]);
}

function buildChaosCardPool(): ScryfallCard[] {
  return [
    basicLand('Plains', 'W'),
    basicLand('Island', 'U'),
    basicLand('Swamp', 'B'),
    basicLand('Mountain', 'R'),
    basicLand('Forest', 'G'),
    card('Command Tower', 'Land', '{T}: Add one mana of any color.', '', 0, [], ['W', 'U', 'B', 'R', 'G']),
    card('Chaos Commander', 'Legendary Creature - Human Wizard', '', '{2}{G}', 3, ['G'], ['G'], '3', '3'),
    card('Storm Commander', 'Legendary Creature - Human Wizard', 'Whenever you cast an instant or sorcery spell, draw a card.', '{2}{U}', 3, ['U'], ['U'], '2', '4'),
    card('Arena Commander', 'Legendary Creature - Human Warrior', 'Trample, haste', '{2}{R}{G}', 4, ['R', 'G'], ['R', 'G'], '4', '4', ['Trample', 'Haste']),
    card('Sol Ring', 'Artifact', '{T}: Add {C}{C}.', '{1}', 1, [], []),
    card('Arcane Signet', 'Artifact', '{T}: Add one mana of any color in your commander\'s color identity.', '{2}', 2, [], []),
    card('Llanowar Elves', 'Creature - Elf Druid', '{T}: Add {G}.', '{G}', 1, ['G'], ['G'], '1', '1'),
    card('Birds of Paradise', 'Creature - Bird', 'Flying\n{T}: Add one mana of any color.', '{G}', 1, ['G'], ['G'], '0', '1', ['Flying']),
    card('Somberwald Sage', 'Creature - Human Druid', '{T}: Add three mana of any one color. Spend this mana only to cast creature spells.', '{2}{G}', 3, ['G'], ['G'], '0', '1'),
    card('Silver Myr', 'Artifact Creature - Myr', '{T}: Add {U}.', '{2}', 2, [], ['U'], '1', '1'),
    card('Goblin Guide', 'Creature - Goblin Scout', 'Haste', '{R}', 1, ['R'], ['R'], '2', '2', ['Haste']),
    card('Questing Beast', 'Legendary Creature - Beast', 'Vigilance, deathtouch, haste', '{2}{G}{G}', 4, ['G'], ['G'], '4', '4', ['Vigilance', 'Deathtouch', 'Haste']),
    card('Steel Hellkite', 'Artifact Creature - Dragon', 'Flying\n{2}: Steel Hellkite gets +1/+0 until end of turn.', '{6}', 6, [], [], '5', '5', ['Flying']),
    card('Balefire Dragon', 'Creature - Dragon', 'Flying\nWhenever Balefire Dragon deals combat damage to a player, it deals that much damage to each creature that player controls.', '{5}{R}{R}', 7, ['R'], ['R'], '6', '6', ['Flying']),
    card('Terror of the Peaks', 'Creature - Dragon', 'Flying\nWhenever another creature enters the battlefield under your control, Terror of the Peaks deals damage equal to that creature\'s power to any target.', '{3}{R}{R}', 5, ['R'], ['R'], '5', '4', ['Flying']),
    card('Mulldrifter', 'Creature - Elemental', 'Flying\nWhen Mulldrifter enters the battlefield, draw two cards.', '{4}{U}', 5, ['U'], ['U'], '2', '2', ['Flying']),
    card('Ravenous Chupacabra', 'Creature - Beast Horror', 'When Ravenous Chupacabra enters the battlefield, destroy target creature an opponent controls.', '{2}{B}{B}', 4, ['B'], ['B'], '2', '2'),
    card('Reclamation Sage', 'Creature - Elf Shaman', 'When Reclamation Sage enters the battlefield, destroy target artifact or enchantment.', '{2}{G}', 3, ['G'], ['G'], '2', '1'),
    card('Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.', '{R}', 1, ['R'], ['R']),
    card('Counterspell', 'Instant', 'Counter target spell.', '{U}{U}', 2, ['U'], ['U']),
    card('Negate', 'Instant', 'Counter target noncreature spell.', '{1}{U}', 2, ['U'], ['U']),
    card('Beast Within', 'Instant', 'Destroy target permanent.', '{2}{G}', 3, ['G'], ['G']),
    card('Naturalize', 'Instant', 'Destroy target artifact or enchantment.', '{1}{G}', 2, ['G'], ['G']),
    card('Doom Blade', 'Instant', 'Destroy target creature.', '{1}{B}', 2, ['B'], ['B']),
    card('Divination', 'Sorcery', 'Draw two cards.', '{2}{U}', 3, ['U'], ['U']),
    card('Harmonize', 'Sorcery', 'Draw three cards.', '{2}{G}{G}', 4, ['G'], ['G']),
    card('Cultivate', 'Sorcery', 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.', '{2}{G}', 3, ['G'], ['G']),
    card('Raise the Alarm', 'Instant', 'Create two 1/1 white Soldier creature tokens.', '{1}{W}', 2, ['W'], ['W']),
    card('Dragon Fodder', 'Sorcery', 'Create two 1/1 red Goblin creature tokens.', '{1}{R}', 2, ['R'], ['R']),
    card('Oblivion Ring', 'Enchantment', 'When Oblivion Ring enters the battlefield, exile another target nonland permanent.', '{2}{W}', 3, ['W'], ['W']),
    card('Sword of Testing', 'Artifact - Equipment', 'Equipped creature gets +2/+0. Equip {2}.', '{2}', 2, [], []),
    // Silver/unusual text is intentionally in the chaos pool so the engine
    // must degrade without crashing when a weird card is drawn or cast.
    card('Blacker Lotus', 'Artifact', 'Tear Blacker Lotus into pieces. Add four mana of any one color.', '0', 0, [], []),
  ];
}

function buildDeck(id: string, commander: string, theme: string): GeneratedDeck {
  const spellPackage = [
    'Sol Ring', 'Arcane Signet', 'Llanowar Elves', 'Birds of Paradise', 'Somberwald Sage',
    'Silver Myr', 'Goblin Guide', 'Questing Beast', 'Steel Hellkite', 'Balefire Dragon',
    'Terror of the Peaks', 'Mulldrifter', 'Ravenous Chupacabra', 'Reclamation Sage',
    'Lightning Bolt', 'Counterspell', 'Negate', 'Beast Within', 'Naturalize', 'Doom Blade',
    'Divination', 'Harmonize', 'Cultivate', 'Raise the Alarm', 'Dragon Fodder',
    'Oblivion Ring', 'Sword of Testing', 'Blacker Lotus',
  ];
  const lands = [
    ...Array(7).fill('Forest'),
    ...Array(7).fill('Mountain'),
    ...Array(7).fill('Island'),
    ...Array(5).fill('Plains'),
    ...Array(5).fill('Swamp'),
    ...Array(5).fill('Command Tower'),
  ];
  const list = [...lands];
  while (list.length < 99) {
    list.push(spellPackage[list.length % spellPackage.length]);
  }

  return {
    id,
    commander,
    list,
    colors: ['W', 'U', 'B', 'R', 'G'],
    bracket: 5,
    theme,
  };
}

function pendingTriggerTargets(state: GameState): Record<string, string[]> {
  const targets: Record<string, string[]> = {};
  for (const trigger of state.pendingTriggers as PendingTrigger[]) {
    const selected: string[] = [];
    for (const rawSpec of trigger.requiredTargets) {
      const spec = rawSpec as TargetSpec;
      const legal = getLegalTargets(state, trigger.controllerId, spec);
      const count = spec.count ?? 1;
      selected.push(...legal.slice(0, count));
    }
    targets[trigger.id] = selected;
  }
  return targets;
}

function finiteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertStateInvariants(state: GameState, label: string): void {
  expect(state.players.length, label).toBeGreaterThanOrEqual(2);
  expect(state.activePlayerIndex, label).toBeGreaterThanOrEqual(0);
  expect(state.activePlayerIndex, label).toBeLessThan(state.players.length);
  expect(state.priorityPlayerIndex, label).toBeGreaterThanOrEqual(0);
  expect(state.priorityPlayerIndex, label).toBeLessThan(state.players.length);
  expect(state.hasPriorityPassed.length, label).toBe(state.players.length);
  expect(state.turnNumber, label).toBeGreaterThan(0);

  const playerIds = new Set(state.players.map(player => player.id));
  for (const player of state.players) {
    expect(playerIds.has(player.id), `${label}: player id exists`).toBe(true);
    expect(finiteNumber(player.life), `${label}: ${player.id} life is finite`).toBe(true);
    expect(finiteNumber(player.poisonCounters), `${label}: ${player.id} poison is finite`).toBe(true);
    expect(player.poisonCounters, `${label}: ${player.id} poison non-negative`).toBeGreaterThanOrEqual(0);
    for (const color of VALID_MANA_COLORS) {
      expect(finiteNumber(player.manaPool[color]), `${label}: ${player.id} ${color} mana finite`).toBe(true);
      expect(player.manaPool[color], `${label}: ${player.id} ${color} mana non-negative`).toBeGreaterThanOrEqual(0);
    }
    for (const [commanderId, amount] of Object.entries(player.commanderDamage)) {
      expect(state.cards.has(commanderId), `${label}: commander damage source ${commanderId} exists`).toBe(true);
      expect(finiteNumber(amount), `${label}: commander damage amount finite`).toBe(true);
      expect(amount, `${label}: commander damage amount non-negative`).toBeGreaterThanOrEqual(0);
    }
    for (const commanderId of player.commanderInstanceIds || []) {
      expect(state.cards.has(commanderId), `${label}: commander ${commanderId} exists`).toBe(true);
    }
  }

  for (const [instanceId, cardInstance] of state.cards) {
    expect(cardInstance.instanceId, `${label}: map key matches instance id`).toBe(instanceId);
    expect(VALID_ZONE_SET.has(cardInstance.zone), `${label}: ${instanceId} zone ${cardInstance.zone}`).toBe(true);
    expect(playerIds.has(cardInstance.ownerId), `${label}: ${instanceId} owner exists`).toBe(true);
    expect(state.cardDefinitions.has(cardInstance.definitionId), `${label}: ${instanceId} definition exists`).toBe(true);
    expect(finiteNumber(cardInstance.damage), `${label}: ${instanceId} damage finite`).toBe(true);
    expect(cardInstance.damage, `${label}: ${instanceId} damage non-negative`).toBeGreaterThanOrEqual(0);

    for (const [counterName, count] of Object.entries(cardInstance.counters)) {
      expect(counterName.length, `${label}: ${instanceId} counter name present`).toBeGreaterThan(0);
      expect(finiteNumber(count), `${label}: ${instanceId} ${counterName} counter finite`).toBe(true);
      expect(count, `${label}: ${instanceId} ${counterName} counter non-negative`).toBeGreaterThanOrEqual(0);
    }

    if (cardInstance.attachedTo) {
      const attachmentTarget = state.cards.get(cardInstance.attachedTo);
      expect(attachmentTarget, `${label}: ${instanceId} attachment target exists`).toBeTruthy();
      expect(attachmentTarget?.zone, `${label}: ${instanceId} attachment target battlefield`).toBe('battlefield');
    }
  }

  for (const item of state.stack) {
    expect(item.id.length, `${label}: stack item id present`).toBeGreaterThan(0);
    if (item.kind === 'Spell') {
      const spell = state.cards.get(item.cardInstanceId);
      expect(spell, `${label}: spell card ${item.cardInstanceId} exists`).toBeTruthy();
      if (!item.isCopy) {
        expect(spell?.zone, `${label}: spell card ${item.cardInstanceId} on stack`).toBe('stack');
      }
      expect(playerIds.has(item.casterId), `${label}: spell caster exists`).toBe(true);
    } else {
      expect(playerIds.has(item.controllerId), `${label}: ability controller exists`).toBe(true);
      expect(state.cards.has(item.sourceInstanceId), `${label}: ability source ${item.sourceInstanceId} exists`).toBe(true);
    }
  }

  if (state.combat) {
    for (const attacker of state.combat.attackers) {
      const cardInstance = state.cards.get(attacker.cardInstanceId);
      expect(cardInstance, `${label}: attacker ${attacker.cardInstanceId} exists`).toBeTruthy();
      expect(cardInstance?.zone, `${label}: attacker ${attacker.cardInstanceId} battlefield`).toBe('battlefield');
      expect(playerIds.has(attacker.defendingPlayerId), `${label}: defender ${attacker.defendingPlayerId} exists`).toBe(true);
    }
    for (const blocker of state.combat.blockers) {
      const cardInstance = state.cards.get(blocker.cardInstanceId);
      expect(cardInstance, `${label}: blocker ${blocker.cardInstanceId} exists`).toBeTruthy();
      expect(cardInstance?.zone, `${label}: blocker ${blocker.cardInstanceId} battlefield`).toBe('battlefield');
      expect(
        state.combat.attackers.some(attacker => attacker.cardInstanceId === blocker.blockingAttackerId),
        `${label}: blocker points at declared attacker`,
      ).toBe(true);
    }
  }
}

function chooseAction(actions: AIAction[], state: GameState, rng: Rng): AIAction {
  const nonPass = actions.filter(action => action.kind !== 'PassPriority');
  const pass = actions.find(action => action.kind === 'PassPriority');

  if (actions[0]?.kind === 'DeclareAttackers') {
    const attacks = actions.filter(action => action.kind === 'DeclareAttackers' && action.attacks.length > 0);
    return attacks.length > 0 && rng() < 0.75 ? pick(attacks, rng) : actions[0];
  }

  if (actions[0]?.kind === 'DeclareBlockers') {
    const blocks = actions.filter(action => action.kind === 'DeclareBlockers' && action.blocks.length > 0);
    return blocks.length > 0 && rng() < 0.55 ? pick(blocks, rng) : actions[0];
  }

  if (state.stack.length > 0) {
    if (pass && rng() < 0.7) return pass;
    return nonPass.length > 0 ? pick(nonPass, rng) : pass!;
  }

  const casts = nonPass.filter(action => action.kind === 'CastSpell');
  if (casts.length > 0 && rng() < 0.75) return pick(casts, rng);

  const lands = nonPass.filter(action => action.kind === 'PlayLand');
  if (lands.length > 0 && rng() < 0.7) return pick(lands, rng);

  const mana = nonPass.filter(action => action.kind === 'ActivateManaAbility');
  if (mana.length > 0 && rng() < 0.8) return pick(mana, rng);

  const boardActions = nonPass.filter(action =>
    action.kind === 'ActivateAbility' || action.kind === 'Equip'
  );
  if (boardActions.length > 0 && rng() < 0.65) return pick(boardActions, rng);

  return nonPass.length > 0 && rng() < 0.45 ? pick(nonPass, rng) : pass!;
}

function findDeclarationActor(
  state: GameState,
  declaredAttackers: Set<string>,
  declaredBlockers: Set<string>,
): { playerId: string; actions: AIAction[] } | null {
  if (state.step === 'declare_attackers') {
    const activePlayer = state.players[state.activePlayerIndex];
    const key = `${state.turnNumber}:${activePlayer.id}:attackers`;
    if (!declaredAttackers.has(key)) {
      const actions = getLegalActions(state, activePlayer.id);
      if (actions.some(action => action.kind === 'DeclareAttackers')) {
        return { playerId: activePlayer.id, actions };
      }
    }
  }

  if (state.step === 'declare_blockers' && state.combat) {
    for (const player of state.players) {
      if (player.hasLost) continue;
      const incoming = state.combat.attackers.some(attack => attack.defendingPlayerId === player.id);
      if (!incoming) continue;
      const key = `${state.turnNumber}:${player.id}:blockers`;
      if (declaredBlockers.has(key)) continue;
      const actions = getLegalActions(state, player.id);
      if (actions.some(action => action.kind === 'DeclareBlockers')) {
        return { playerId: player.id, actions };
      }
    }
  }

  return null;
}

function stepChaosGame(initial: GameStateWithAI, seed: number, maxActions: number): GameStateWithAI {
  const rng = mulberry32(seed);
  let state: GameStateWithAI = initial;
  const handledDrawSteps = new Set<string>();
  const declaredAttackers = new Set<string>();
  const declaredBlockers = new Set<string>();
  const nonPassActionsByStep = new Map<string, number>();

  for (let actionIndex = 0; actionIndex < maxActions; actionIndex++) {
    assertStateInvariants(state, `seed ${seed} before action ${actionIndex}`);

    if (state.step === 'untap') {
      state = advanceStep(performUntapStep(state)) as GameStateWithAI;
      continue;
    }

    if (state.step === 'draw') {
      const activePlayer = state.players[state.activePlayerIndex];
      const key = `${state.turnNumber}:${activePlayer.id}:draw`;
      if (!handledDrawSteps.has(key)) {
        state = drawCards(state, activePlayer.id, 1) as GameStateWithAI;
        handledDrawSteps.add(key);
        continue;
      }
    }

    if (state.pendingTriggers.length > 0) {
      state = putTriggersOnStack(state, pendingTriggerTargets(state)) as GameStateWithAI;
      continue;
    }

    if (allPlayersPassed(state)) {
      if (state.stack.length > 0) {
        state = resolveTopOfStack(state) as GameStateWithAI;
      } else {
        state = advanceStep(state) as GameStateWithAI;
      }
      continue;
    }

    const declaration = findDeclarationActor(state, declaredAttackers, declaredBlockers);
    const playerId = declaration?.playerId ?? state.players[state.priorityPlayerIndex].id;
    let actions = declaration?.actions ?? getLegalActions(state, playerId);
    const stepActionKey = `${state.turnNumber}:${state.step}:${playerId}:${state.stack.length > 0 ? 'stack' : 'open'}`;

    if (!declaration && state.stack.length === 0) {
      // Keep the chaos run action-rich but bounded: if the active player has
      // already used every non-pass legal action, let the turn/phase advance.
      const nonPass = actions.filter(action => action.kind !== 'PassPriority');
      if (nonPass.length === 0 || (nonPassActionsByStep.get(stepActionKey) ?? 0) >= 4) {
        actions = actions.filter(action => action.kind === 'PassPriority');
      }
    } else if (!declaration && state.stack.length > 0 && (nonPassActionsByStep.get(stepActionKey) ?? 0) >= 2) {
      actions = actions.filter(action => action.kind === 'PassPriority');
    }

    if (actions.length === 0) {
      if (state.stack.length > 0) {
        state = resolveTopOfStack(state) as GameStateWithAI;
      } else {
        state = advanceStep(state) as GameStateWithAI;
      }
      continue;
    }

    const chosen = chooseAction(actions, state, rng);
    const request = createClientActionRequest(state, playerId, chosen, {
      source: 'ai',
      label: chosen.kind,
    });
    const result = applyClientActionRequest(state, request);
    expect(
      result.ok,
      `seed ${seed} action ${actionIndex} ${playerId} ${chosen.kind}: ${result.ok ? 'ok' : result.message}`,
    ).toBe(true);
    if (!result.ok) break;

    if (chosen.kind === 'DeclareAttackers') {
      declaredAttackers.add(`${state.turnNumber}:${playerId}:attackers`);
    } else if (chosen.kind === 'DeclareBlockers') {
      declaredBlockers.add(`${state.turnNumber}:${playerId}:blockers`);
    } else if (chosen.kind !== 'PassPriority') {
      nonPassActionsByStep.set(stepActionKey, (nonPassActionsByStep.get(stepActionKey) ?? 0) + 1);
    }
    state = result.state as GameStateWithAI;
  }

  assertStateInvariants(state, `seed ${seed} final`);
  return state;
}

function createChaosGame(seed: number, aiCount: number): GameStateWithAI {
  const cards = buildChaosCardPool();
  const lookup = createCardLookup(cards);
  const commanders = ['Chaos Commander', 'Storm Commander', 'Arena Commander'];
  const humanCommander = commanders[seed % commanders.length];
  const aiDecks = Array.from({ length: aiCount }, (_, index) =>
    buildDeck(`ai-${seed}-${index}`, commanders[(seed + index + 1) % commanders.length], `chaos-ai-${index}`),
  );

  resetInstanceCounter();
  return withSeededRandom(seed, () => initGameFromDecks({
    humanDeck: buildDeck(`human-${seed}`, humanCommander, 'chaos-human'),
    aiDecks,
    aiDifficulty: 5,
    cardLookup: lookup,
    humanGoesFirst: true,
    startingLife: 40,
    startingHandSize: 7,
  }));
}

describe('Chaos Suite - high-power engine invariants', () => {
  it('runs deterministic 1v1 legal-action games without illegal state drift', () => {
    const longMode = process.env.CHAOS_SUITE_LONG === '1';
    const gameCount = envInt('ENGINE_CHAOS_1V1_RUNS', longMode ? 1000 : 40);
    const actionBudget = envInt('ENGINE_CHAOS_ACTION_BUDGET', longMode ? 240 : 120);

    for (let seed = 1; seed <= gameCount; seed++) {
      const state = createChaosGame(10_000 + seed, 1);
      const finalState = stepChaosGame(state, 20_000 + seed, actionBudget);
      expect(
        finalState.turnNumber,
        `seed ${seed} progressed turns; stopped at ${finalState.phase}/${finalState.step} stack=${finalState.stack.length} passed=${finalState.hasPriorityPassed.join(',')}`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('runs deterministic 4-player pods through multiplayer action surfaces', () => {
    const longMode = process.env.CHAOS_SUITE_LONG === '1';
    const gameCount = envInt('ENGINE_CHAOS_4P_RUNS', longMode ? 250 : 12);
    const actionBudget = envInt('ENGINE_CHAOS_4P_ACTION_BUDGET', longMode ? 320 : 140);

    for (let seed = 1; seed <= gameCount; seed++) {
      const state = createChaosGame(30_000 + seed, 3);
      const finalState = stepChaosGame(state, 40_000 + seed, actionBudget);
      expect(finalState.players.length, `pod seed ${seed} has four players`).toBe(4);
      expect(
        finalState.turnNumber,
        `pod seed ${seed} progressed turns; stopped at ${finalState.phase}/${finalState.step} stack=${finalState.stack.length} passed=${finalState.hasPriorityPassed.join(',')}`,
      ).toBeGreaterThanOrEqual(2);
    }
  });
});
