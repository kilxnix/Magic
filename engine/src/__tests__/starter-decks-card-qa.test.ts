import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  convertCard,
  convertGeneratedDeck,
  createCardLookup,
  parseCardsJsonl,
  type CardLookup,
  type GeneratedDeck,
} from '../cards/deck-loader';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { getCardsInZone } from '../game-state';
import { addMana, type ManaCost } from '../mana';
import { canCastSpell, putTriggersOnStack, registerBattlefieldAbilities, resolveTopOfStack } from '../stack';
import {
  tryActivateAbility,
  tryCastSpell,
  tryDeclareAttackers,
  tryDeclareBlockers,
  tryPassPriority,
  tryPlayLand,
  tryTapLandForMana,
} from '../actions-public';
import { getLegalActions, getLegalTargets, getSpellTargetSpecs } from '../ai/legal-actions';
import { getEffectivePower } from '../effects/continuous';
import { instanceHasKeyword } from '../keywords';
import { declareAttackers, declareBlockers, resolveCombatDamage } from '../combat';
import { createPlayer, emptyManaPool, type CardDefinition, type CardInstance, type GameState, type ManaColor, type Zone } from '../types';
import { advanceStep } from '../turn-manager';
import type { AIAction, CastSpellAction } from '../ai/types';
import {
  BEGINNER_DECKS,
  CERTIFIED_BLUE_FILLER,
  CERTIFIED_GREEN_FILLER,
  CERTIFIED_RED_FILLER,
  decklistCardNames,
  hasOnlyLegalBeginnerDuplicates,
} from '../../../frontend/src/lib/beginnerDecks';

type StarterDeckSpec = {
  id: string;
  commander: string;
  colors: string[];
  cards: string[];
};

const STARTER_DECKS: StarterDeckSpec[] = [
  ...BEGINNER_DECKS.map(deck => ({
    id: deck.id,
    commander: deck.commander,
    colors: deck.colors,
    cards: decklistCardNames(deck).filter(name => name !== deck.commander),
  })),
];

const UNIQUE_STARTER_CARDS = [...new Set(STARTER_DECKS.flatMap(deck => [deck.commander, ...deck.cards]))].sort();
const CERTIFIED_FILLER_CARDS = [
  ...CERTIFIED_GREEN_FILLER,
  ...CERTIFIED_RED_FILLER,
  ...CERTIFIED_BLUE_FILLER,
];
const NO_PAYMENT: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };

let lookup: CardLookup;
let nextInstance = 0;

function toGeneratedDeck(deck: StarterDeckSpec): GeneratedDeck {
  return {
    id: deck.id,
    commander: deck.commander,
    list: deck.cards,
    colors: deck.colors,
    bracket: 2,
    theme: 'starter QA',
  };
}

function getDef(name: string): CardDefinition {
  const raw = lookup(name);
  if (!raw) throw new Error(`Missing starter QA card fixture: ${name}`);
  return convertCard(raw);
}

function makeState(): GameState {
  nextInstance = 0;
  return {
    players: [createPlayer('p1', 'Starter pilot'), createPlayer('p2', 'Starter opponent')],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'draw',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    delayedTriggers: [],
  };
}

function addCard(
  state: GameState,
  name: string,
  zone: Zone,
  ownerId: string = 'p1',
  options: Partial<CardInstance> = {},
): string {
  const def = getDef(name);
  state.cardDefinitions.set(def.id, def);
  const instanceId = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++nextInstance}`;
  const instance: CardInstance = {
    instanceId,
    definitionId: def.id,
    ownerId,
    zone,
    tapped: options.tapped ?? false,
    summoningSick: options.summoningSick ?? (zone === 'battlefield' && def.card_types.includes('creature')),
    counters: options.counters ?? {},
    attachedTo: options.attachedTo,
    damage: options.damage ?? 0,
    isCommander: options.isCommander ?? false,
    isToken: options.isToken,
  };
  state.cards.set(instanceId, instance);

  if (instance.isCommander) {
    state.players = state.players.map(player => player.id === ownerId
      ? {
          ...player,
          commanderInstanceId: instanceId,
          commanderInstanceIds: [instanceId],
          commanderCastCounts: { [instanceId]: 0 },
        }
      : player);
  }

  return instanceId;
}

function giveMana(state: GameState, colors: Partial<Record<ManaColor | 'generic', number>> = {}): GameState {
  const pool = {
    ...emptyManaPool(),
    W: colors.W ?? 20,
    U: colors.U ?? 20,
    B: colors.B ?? 20,
    R: colors.R ?? 20,
    G: colors.G ?? 20,
    C: colors.C ?? 20,
  };
  return {
    ...state,
    players: state.players.map(player => player.id === 'p1'
      ? { ...player, manaPool: pool }
      : player),
  };
}

function zoneCount(state: GameState, playerId: string, zone: Zone, name?: string): number {
  return getCardsInZone(state, playerId, zone)
    .filter(card => !name || state.cardDefinitions.get(card.definitionId)?.name === name)
    .length;
}

function tokenCount(state: GameState, ownerId: string, subtype: string): number {
  return [...state.cards.values()].filter(card => {
    if (card.ownerId !== ownerId || card.zone !== 'battlefield' || !card.isToken) return false;
    const def = state.cardDefinitions.get(card.definitionId);
    return def?.type_line.toLowerCase().includes(subtype.toLowerCase());
  }).length;
}

function castAndResolve(
  state: GameState,
  cardId: string,
  targets: string[] = [],
  options: Parameters<typeof tryCastSpell>[5] = {},
): GameState {
  const cast = tryCastSpell(giveMana(state), 'p1', cardId, targets, NO_PAYMENT, options);
  const name = state.cardDefinitions.get(state.cards.get(cardId)?.definitionId ?? '')?.name ?? cardId;
  expect(cast.ok, cast.ok ? undefined : `${name}: ${cast.message}`).toBe(true);
  return resolveTopOfStack(cast.state);
}

function resolveFirstPendingTrigger(state: GameState, targets: string[] = []): GameState {
  expect(state.pendingTriggers.length).toBeGreaterThan(0);
  const triggerId = state.pendingTriggers[0].id;
  const withTrigger = putTriggersOnStack(state, { [triggerId]: targets });
  return resolveTopOfStack(withTrigger);
}

function resolveAllPendingTriggers(state: GameState): GameState {
  let next = state;
  let guard = 0;
  while ((next.pendingTriggers.length > 0 || next.stack.length > 0) && guard < 50) {
    if (next.pendingTriggers.length > 0) {
      next = putTriggersOnStack(next);
    }
    if (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    guard++;
  }
  expect(guard).toBeLessThan(50);
  return next;
}

function registerPermanent(state: GameState, instanceId: string): GameState {
  return registerBattlefieldAbilities(state, instanceId);
}

function starterById(id: string): StarterDeckSpec {
  const deck = STARTER_DECKS.find(candidate => candidate.id === id);
  if (!deck) throw new Error(`Missing starter deck ${id}`);
  return deck;
}

function initRuntimeStarter(deckId: string): GameState {
  resetInstanceCounter();
  const deck = starterById(deckId);
  const game = initGameFromDecks({
    humanDeck: toGeneratedDeck(deck),
    aiDecks: [toGeneratedDeck(deck)],
    aiDifficulty: 2,
    cardLookup: lookup,
    startingHandSize: 0,
  });
  return {
    ...game,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'draw',
    hasPriorityPassed: new Array(game.players.length).fill(false),
  };
}

function cardName(state: GameState, instanceId: string): string {
  const card = state.cards.get(instanceId);
  const def = card ? state.cardDefinitions.get(card.definitionId) : undefined;
  return def?.name || '';
}

function findRuntimeCard(
  state: GameState,
  ownerId: string,
  name: string,
  zones?: Zone[],
): string {
  const card = [...state.cards.values()].find(instance => {
    if (instance.ownerId !== ownerId) return false;
    if (zones && !zones.includes(instance.zone)) return false;
    return state.cardDefinitions.get(instance.definitionId)?.name === name;
  });
  if (!card) throw new Error(`Could not find ${ownerId}'s ${name} in ${zones?.join(', ') || 'any zone'}`);
  return card.instanceId;
}

function moveRuntimeCard(
  state: GameState,
  ownerId: string,
  name: string,
  zone: Zone,
  options: Partial<CardInstance> = {},
): string {
  const instanceId = findRuntimeCard(state, ownerId, name);
  const card = state.cards.get(instanceId)!;
  state.cards.set(instanceId, {
    ...card,
    zone,
    tapped: options.tapped ?? false,
    summoningSick: options.summoningSick ?? (zone === 'battlefield' && state.cardDefinitions.get(card.definitionId)?.card_types.includes('creature')) ?? false,
    counters: options.counters ?? card.counters,
    damage: options.damage ?? 0,
    attachedTo: options.attachedTo,
  });
  return instanceId;
}

function setRuntimeMainPriority(state: GameState): GameState {
  return {
    ...state,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'draw',
    stack: [],
    hasPriorityPassed: new Array(state.players.length).fill(false),
  };
}

function setHumanMana(state: GameState, colors: Partial<Record<ManaColor, number>>): GameState {
  return {
    ...state,
    players: state.players.map(player => player.id === 'human'
      ? {
          ...player,
          manaPool: {
            ...emptyManaPool(),
            W: colors.W ?? 0,
            U: colors.U ?? 0,
            B: colors.B ?? 0,
            R: colors.R ?? 0,
            G: colors.G ?? 0,
            C: colors.C ?? 0,
          },
        }
      : player),
  };
}

function getLegalActionForCard<T extends AIAction['kind']>(
  state: GameState,
  kind: T,
  cardId: string,
): Extract<AIAction, { kind: T }> {
  const actions = getLegalActions(state, 'human');
  const action = actions.find(candidate => {
    if (candidate.kind !== kind) return false;
    if ('cardInstanceId' in candidate) return candidate.cardInstanceId === cardId;
    if (candidate.kind === 'Equip') return candidate.equipmentInstanceId === cardId;
    return false;
  }) as Extract<AIAction, { kind: T }> | undefined;
  expect(action, `Expected legal ${kind} action for ${cardName(state, cardId)}`).toBeDefined();
  return action!;
}

function getLegalCastByName(state: GameState, name: string): CastSpellAction {
  const actions = getLegalActions(state, 'human');
  const action = actions.find((candidate): candidate is CastSpellAction =>
    candidate.kind === 'CastSpell' && cardName(state, candidate.cardInstanceId) === name,
  );
  expect(action, `Expected legal CastSpell action for ${name}`).toBeDefined();
  return action!;
}

function getLegalCastByNameTarget(state: GameState, name: string, targetId: string): CastSpellAction {
  const actions = getLegalActions(state, 'human');
  const action = actions.find((candidate): candidate is CastSpellAction =>
    candidate.kind === 'CastSpell'
    && cardName(state, candidate.cardInstanceId) === name
    && candidate.targets.includes(targetId),
  );
  expect(action, `Expected legal CastSpell action for ${name} targeting ${targetId}`).toBeDefined();
  return action!;
}

function resolveRuntimeStack(state: GameState): GameState {
  let next = state;
  let guard = 0;
  while ((next.pendingTriggers.length > 0 || next.stack.length > 0) && guard < 60) {
    if (next.pendingTriggers.length > 0) next = putTriggersOnStack(next);
    if (next.stack.length > 0) next = resolveTopOfStack(next);
    guard++;
  }
  expect(guard).toBeLessThan(60);
  return next;
}

function castLegalRuntimeSpell(
  state: GameState,
  spellName: string,
  mana: Partial<Record<ManaColor, number>>,
  targetId?: string,
): GameState {
  const withMana = setHumanMana(setRuntimeMainPriority(state), mana);
  const action = targetId
    ? getLegalCastByNameTarget(withMana, spellName, targetId)
    : getLegalCastByName(withMana, spellName);
  const result = tryCastSpell(withMana, 'human', action.cardInstanceId, action.targets, NO_PAYMENT, {
    chosenModes: action.chosenModes,
    namedCardChoices: action.namedCardChoices,
    cardChoices: action.cardChoices,
  });
  expect(result.ok, result.ok ? undefined : result.message).toBe(true);
  return resolveRuntimeStack(result.state);
}

function runtimeTokenCount(state: GameState, ownerId: string, subtype: string): number {
  return [...state.cards.values()].filter(card => {
    if (card.ownerId !== ownerId || card.zone !== 'battlefield' || !card.isToken) return false;
    const def = state.cardDefinitions.get(card.definitionId);
    return def?.type_line.toLowerCase().includes(subtype.toLowerCase());
  }).length;
}

function allPriorityPassed(state: GameState): boolean {
  return state.hasPriorityPassed.every((passed, index) => passed || state.players[index].hasLost);
}

function passPriorityWindowAndAdvance(state: GameState): GameState {
  let next = state;
  let guard = next.players.length + 2;
  while (!allPriorityPassed(next) && guard-- > 0) {
    const priorityPlayer = next.players[next.priorityPlayerIndex];
    const pass = tryPassPriority(next, priorityPlayer.id);
    expect(pass.ok, pass.ok ? undefined : pass.message).toBe(true);
    next = pass.state;
  }
  expect(allPriorityPassed(next)).toBe(true);
  return advanceStep(next);
}

function finishHumanTurnWithPublicActions(state: GameState): GameState {
  let next = {
    ...state,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as const,
    step: 'draw' as const,
    stack: [],
    combat: null,
    hasPriorityPassed: new Array(state.players.length).fill(false),
  };
  const startingTurn = next.turnNumber;
  let guard = 40;

  while (next.turnNumber === startingTurn && next.activePlayerIndex === 0 && guard-- > 0) {
    if (next.step === 'declare_attackers') {
      const noAttack = getLegalActions(next, 'human').find(
        (action): action is Extract<AIAction, { kind: 'DeclareAttackers' }> =>
          action.kind === 'DeclareAttackers' && action.attacks.length === 0,
      );
      expect(noAttack).toBeDefined();
      const declared = tryDeclareAttackers(next, 'human', noAttack!.attacks);
      expect(declared.ok, declared.ok ? undefined : declared.message).toBe(true);
      next = declared.state;
    } else if (next.step === 'declare_blockers') {
      const noBlock = getLegalActions(next, 'ai1').find(
        (action): action is Extract<AIAction, { kind: 'DeclareBlockers' }> =>
          action.kind === 'DeclareBlockers' && action.blocks.length === 0,
      );
      if (noBlock) {
        const declared = tryDeclareBlockers(next, 'ai1', noBlock.blocks);
        expect(declared.ok, declared.ok ? undefined : declared.message).toBe(true);
        next = declared.state;
      }
    } else if (next.step === 'combat_damage' && next.combat && next.combat.attackers.length > 0) {
      next = resolveCombatDamage(next);
    }

    next = passPriorityWindowAndAdvance(next);
  }

  expect(guard).toBeGreaterThan(0);
  expect(next.turnNumber).toBe(startingTurn + 1);
  expect(next.activePlayerIndex).toBe(1);
  expect(next.players[next.activePlayerIndex].id).toBe('ai1');
  return next;
}

describe('starter deck full-card QA', () => {
  beforeAll(() => {
    const cardsPath = new URL('../../../mtg_data/cards_min.jsonl', import.meta.url);
    lookup = createCardLookup(parseCardsJsonl(readFileSync(cardsPath, 'utf8')));
  });

  it('loads every card used by the starter decks from the real card database', () => {
    const missing = UNIQUE_STARTER_CARDS.filter(name => !lookup(name));
    expect(missing).toEqual([]);
  });

  it('certifies the exact beginner decks shipped by the frontend', () => {
    expect(STARTER_DECKS.map(deck => deck.id)).toEqual([
      'beginner-goreclaw-stompy',
      'beginner-krenko-goblins',
      'beginner-talrand-spells',
    ]);

    for (const deck of BEGINNER_DECKS) {
      expect(decklistCardNames(deck)).toHaveLength(100);
      expect(decklistCardNames(deck)[0]).toBe(deck.commander);
      expect(hasOnlyLegalBeginnerDuplicates(deck)).toBe(true);

      const converted = convertGeneratedDeck(toGeneratedDeck(STARTER_DECKS.find(starter => starter.id === deck.id)!), lookup);
      expect(converted.commanders.map(card => card.name)).toEqual([deck.commander]);
      expect(converted.library).toHaveLength(99);
    }
  });

  it('initializes all starter decks as Commander games with command-zone commanders', () => {
    resetInstanceCounter();
    for (const deck of STARTER_DECKS) {
      const converted = convertGeneratedDeck(toGeneratedDeck(deck), lookup);
      expect(converted.commander?.name).toBe(deck.commander);
      expect(converted.library).toHaveLength(99);

      const game = initGameFromDecks({
        humanDeck: toGeneratedDeck(deck),
        aiDecks: [toGeneratedDeck(deck)],
        aiDifficulty: 2,
        cardLookup: lookup,
        startingHandSize: 7,
      });
      const commanderId = game.players[0].commanderInstanceId;
      expect(commanderId).toBeTruthy();
      expect(game.cards.get(commanderId!)?.zone).toBe('command');
    }
  });

  it('covers every starter card with an explicit scenario in this QA file', () => {
    const covered = new Set<string>([
      'Acidic Slime',
      'Abrade',
      'Aetherize',
      'Anticipate',
      'Arcane Signet',
      'Beast Within',
      'Blink of an Eye',
      'Brainstorm',
      'Chart a Course',
      'Chaos Warp',
      'Colossal Dreadmaw',
      'Compulsive Research',
      'Concentrate',
      'Consider',
      'Counterspell',
      'Counsel of the Soratami',
      'Cultivate',
      'Curate',
      'Disperse',
      'Divination',
      'Dragon Fodder',
      'Elvish Mystic',
      'Forest',
      'Frantic Search',
      'Fyndhorn Elves',
      "Garruk's Uprising",
      'Goblin Chieftain',
      'Goblin Instigator',
      'Goblin Matron',
      'Goblin Warchief',
      'Goreclaw, Terror of Qal Sisma',
      'Hordeling Outburst',
      'Impact Tremors',
      'Impulse',
      'Hieroglyphic Illumination',
      'Inspiration',
      'Into the Roil',
      'Island',
      "Jace's Ingenuity",
      "Kodama's Reach",
      "Krenko's Command",
      'Krenko, Mob Boss',
      'Lightning Bolt',
      'Llanowar Elves',
      'Mind Stone',
      'Mountain',
      'Negate',
      'Opt',
      'Peek',
      'Ponder',
      'Preordain',
      'Quick Study',
      'Rampant Growth',
      'Rancor',
      'Reclamation Sage',
      'Return of the Wildspeaker',
      'See Beyond',
      'Serum Visions',
      'Sky Diamond',
      'Skirk Prospector',
      'Sleight of Hand',
      'Sol Ring',
      'Strategic Planning',
      'Talrand, Sky Summoner',
      "Talrand's Invocation",
      'Terra Stomper',
      'Think Twice',
      'Unsummon',
      ...CERTIFIED_FILLER_CARDS,
    ]);

    expect(UNIQUE_STARTER_CARDS.filter(name => !covered.has(name))).toEqual([]);
  });

  it('casts every certified filler card used to complete the starter decks', () => {
    for (const name of CERTIFIED_FILLER_CARDS) {
      let state = makeState();
      const cardId = addCard(state, name, 'hand');
      const def = state.cardDefinitions.get(state.cards.get(cardId)!.definitionId)!;

      expect(def.card_types).toContain('creature');
      expect(canCastSpell(giveMana(state), 'p1', cardId), name).toBe(true);

      state = castAndResolve(state, cardId);
      expect(state.cards.get(cardId)?.zone, name).toBe('battlefield');
    }
  });

  it('casts all three starter commanders from the command zone', () => {
    for (const commander of STARTER_DECKS.map(deck => deck.commander)) {
      let state = makeState();
      const commanderId = addCard(state, commander, 'command', 'p1', { isCommander: true, summoningSick: false });
      state = giveMana(state);

      expect(canCastSpell(state, 'p1', commanderId)).toBe(true);
      state = castAndResolve(state, commanderId);
      expect(state.cards.get(commanderId)?.zone).toBe('battlefield');
    }
  });

  it('exercises starter mana sources and creature summoning-sickness rules', () => {
    let state = makeState();
    const forest = addCard(state, 'Forest', 'battlefield', 'p1', { summoningSick: false });
    const mountain = addCard(state, 'Mountain', 'battlefield', 'p1', { summoningSick: false });
    const island = addCard(state, 'Island', 'battlefield', 'p1', { summoningSick: false });
    const solRing = addCard(state, 'Sol Ring', 'battlefield', 'p1', { summoningSick: false });
    const signet = addCard(state, 'Arcane Signet', 'battlefield', 'p1', { summoningSick: false });
    const diamond = addCard(state, 'Sky Diamond', 'battlefield', 'p1', { summoningSick: false });
    const mindStone = addCard(state, 'Mind Stone', 'battlefield', 'p1', { summoningSick: false });
    const sickElf = addCard(state, 'Llanowar Elves', 'battlefield', 'p1', { summoningSick: true });
    const mystic = addCard(state, 'Elvish Mystic', 'battlefield', 'p1', { summoningSick: false });
    const fyndhorn = addCard(state, 'Fyndhorn Elves', 'battlefield', 'p1', { summoningSick: false });

    expect(tryTapLandForMana(state, 'p1', sickElf, 'G').ok).toBe(false);
    for (const [cardId, color] of [
      [forest, 'G'],
      [mountain, 'R'],
      [island, 'U'],
      [solRing, 'C'],
      [signet, 'G'],
      [diamond, 'U'],
      [mindStone, 'C'],
      [mystic, 'G'],
      [fyndhorn, 'G'],
    ] as Array<[string, ManaColor]>) {
      const result = tryTapLandForMana(state, 'p1', cardId, color);
      expect(result.ok, result.ok ? undefined : result.message).toBe(true);
      state = result.state;
    }
  });

  it('resolves green ramp, removal, Aura, large-creature, and combat interactions', () => {
    let state = makeState();
    addCard(state, 'Forest', 'library');
    addCard(state, 'Forest', 'library');
    const rampantGrowth = addCard(state, 'Rampant Growth', 'hand');
    state = castAndResolve(state, rampantGrowth);
    expect(zoneCount(state, 'p1', 'battlefield', 'Forest')).toBe(1);

    const cultivate = addCard(state, 'Cultivate', 'hand');
    addCard(state, 'Forest', 'library');
    addCard(state, 'Forest', 'library');
    state = castAndResolve(state, cultivate);
    expect(zoneCount(state, 'p1', 'battlefield', 'Forest')).toBe(2);
    expect(zoneCount(state, 'p1', 'hand', 'Forest')).toBe(1);

    const reach = addCard(state, "Kodama's Reach", 'hand');
    addCard(state, 'Forest', 'library');
    addCard(state, 'Forest', 'library');
    state = castAndResolve(state, reach);
    expect(zoneCount(state, 'p1', 'battlefield', 'Forest')).toBe(3);
    expect(zoneCount(state, 'p1', 'hand', 'Forest')).toBe(2);

    const dreadmaw = addCard(state, 'Colossal Dreadmaw', 'battlefield', 'p1', { summoningSick: false });
    const rancor = addCard(state, 'Rancor', 'hand');
    state = castAndResolve(state, rancor, [dreadmaw]);
    expect(state.cards.get(rancor)?.attachedTo).toBe(dreadmaw);
    expect(getEffectivePower(state, dreadmaw)).toBe(8);
    expect(instanceHasKeyword(state, dreadmaw, 'Trample')).toBe(true);

    const uprising = addCard(state, "Garruk's Uprising", 'hand');
    addCard(state, 'Forest', 'library');
    state = castAndResolve(state, uprising);
    state = resolveFirstPendingTrigger(state);
    expect(zoneCount(state, 'p1', 'hand', 'Forest')).toBe(3);

    const wildspeaker = addCard(state, 'Return of the Wildspeaker', 'hand');
    addCard(state, 'Forest', 'library');
    addCard(state, 'Forest', 'library');
    addCard(state, 'Forest', 'library');
    addCard(state, 'Forest', 'library');
    addCard(state, 'Forest', 'library');
    addCard(state, 'Forest', 'library');
    addCard(state, 'Forest', 'library');
    addCard(state, 'Forest', 'library');
    state = castAndResolve(state, wildspeaker);
    expect(zoneCount(state, 'p1', 'hand', 'Forest')).toBeGreaterThanOrEqual(8);

    const targetArtifact = addCard(state, 'Sol Ring', 'battlefield', 'p2', { summoningSick: false });
    const sage = addCard(state, 'Reclamation Sage', 'hand');
    state = castAndResolve(state, sage);
    state = resolveFirstPendingTrigger(state, [targetArtifact]);
    expect(state.cards.get(targetArtifact)?.zone).toBe('graveyard');

    const targetLand = addCard(state, 'Mountain', 'battlefield', 'p2', { summoningSick: false });
    const slime = addCard(state, 'Acidic Slime', 'hand');
    state = castAndResolve(state, slime);
    state = resolveFirstPendingTrigger(state, [targetLand]);
    expect(state.cards.get(targetLand)?.zone).toBe('graveyard');

    const targetPermanent = addCard(state, 'Island', 'battlefield', 'p2', { summoningSick: false });
    const beastWithin = addCard(state, 'Beast Within', 'hand');
    state = castAndResolve(state, beastWithin, [targetPermanent]);
    expect(state.cards.get(targetPermanent)?.zone).toBe('graveyard');
    expect(tokenCount(state, 'p2', 'Beast')).toBe(1);

    const stomper = addCard(state, 'Terra Stomper', 'battlefield', 'p1', { summoningSick: false });
    state = { ...state, step: 'declare_attackers' };
    state = declareAttackers(state, 'p1', [{ cardInstanceId: stomper, defendingPlayerId: 'p2' }]);
    state = declareBlockers(state, 'p2', []);
    state = resolveCombatDamage(state);
    expect(state.players.find(player => player.id === 'p2')?.life).toBe(32);
  });

  it('resolves red goblin token, lord, tutor, removal, and activated-ability interactions', () => {
    let state = makeState();
    const impact = addCard(state, 'Impact Tremors', 'battlefield', 'p1', { summoningSick: false });
    state = registerPermanent(state, impact);

    for (const [spellName, expectedTokenCount] of [
      ['Dragon Fodder', 2],
      ["Krenko's Command", 4],
      ['Hordeling Outburst', 7],
    ] as const) {
      const spell = addCard(state, spellName, 'hand');
      state = castAndResolve(state, spell);
      state = resolveAllPendingTriggers(state);
      expect(tokenCount(state, 'p1', 'Goblin')).toBe(expectedTokenCount);
    }
    expect(state.players.find(player => player.id === 'p2')?.life).toBe(33);

    const instigator = addCard(state, 'Goblin Instigator', 'hand');
    state = castAndResolve(state, instigator);
    state = resolveAllPendingTriggers(state);
    expect(tokenCount(state, 'p1', 'Goblin')).toBe(8);

    const matron = addCard(state, 'Goblin Matron', 'hand');
    addCard(state, 'Goblin Chieftain', 'library');
    state = castAndResolve(state, matron);
    state = resolveAllPendingTriggers(state);
    expect(zoneCount(state, 'p1', 'hand', 'Goblin Chieftain')).toBe(1);

    const warchief = addCard(state, 'Goblin Warchief', 'hand');
    state = castAndResolve(state, warchief);
    const cheapGoblin = addCard(state, 'Goblin Instigator', 'hand');
    state = {
      ...state,
      players: state.players.map(player => player.id === 'p1'
        ? { ...player, manaPool: { ...emptyManaPool(), R: 1 } }
        : player),
    };
    expect(canCastSpell(state, 'p1', cheapGoblin)).toBe(true);

    const chieftain = state.cards.get([...state.cards.values()].find(card =>
      state.cardDefinitions.get(card.definitionId)?.name === 'Goblin Chieftain'
      && card.zone === 'hand'
    )!.instanceId)!.instanceId;
    state = castAndResolve(state, chieftain);
    const goblinToken = [...state.cards.values()].find(card => {
      const def = state.cardDefinitions.get(card.definitionId);
      return card.isToken && card.ownerId === 'p1' && def?.type_line.toLowerCase().includes('goblin');
    })!;
    expect(getEffectivePower(state, goblinToken.instanceId)).toBeGreaterThanOrEqual(2);
    expect(instanceHasKeyword(state, goblinToken.instanceId, 'Haste')).toBe(true);

    const prospector = addCard(state, 'Skirk Prospector', 'battlefield', 'p1', { summoningSick: false });
    const prospectorResult = tryTapLandForMana(state, 'p1', prospector, 'R');
    expect(prospectorResult.ok, prospectorResult.ok ? undefined : prospectorResult.message).toBe(true);
    state = prospectorResult.state;
    expect(state.players[0].manaPool.R).toBeGreaterThan(0);

    const krenko = addCard(state, 'Krenko, Mob Boss', 'battlefield', 'p1', { summoningSick: false });
    const krenkoResult = tryActivateAbility(state, 'p1', krenko, 0, []);
    expect(krenkoResult.ok, krenkoResult.ok ? undefined : krenkoResult.message).toBe(true);
    state = resolveTopOfStack(krenkoResult.state);
    expect(tokenCount(state, 'p1', 'Goblin')).toBeGreaterThan(8);

    const boltTarget = addCard(state, 'Colossal Dreadmaw', 'battlefield', 'p2', { summoningSick: false });
    const bolt = addCard(state, 'Lightning Bolt', 'hand');
    state = castAndResolve(state, bolt, [boltTarget]);
    expect(state.cards.get(boltTarget)?.damage).toBe(3);

    const abradeCreatureTarget = addCard(state, 'Colossal Dreadmaw', 'battlefield', 'p2', { summoningSick: false });
    const abradeDamage = addCard(state, 'Abrade', 'hand');
    state = castAndResolve(state, abradeDamage, [abradeCreatureTarget], { chosenModes: [0] });
    expect(state.cards.get(abradeCreatureTarget)?.damage).toBe(3);

    const abradeArtifactTarget = addCard(state, 'Sol Ring', 'battlefield', 'p2', { summoningSick: false });
    const abradeDestroy = addCard(state, 'Abrade', 'hand');
    state = castAndResolve(state, abradeDestroy, [abradeArtifactTarget], { chosenModes: [1] });
    expect(state.cards.get(abradeArtifactTarget)?.zone).toBe('graveyard');

    const chaosTarget = addCard(state, 'Arcane Signet', 'battlefield', 'p2', { summoningSick: false });
    const chaosWarp = addCard(state, 'Chaos Warp', 'hand');
    state = castAndResolve(state, chaosWarp, [chaosTarget]);
    expect(state.cards.get(chaosTarget)?.zone).toBe('library');
  });

  it('resolves blue cantrips, Talrand token triggers, counters, and bounce spells', () => {
    let state = makeState();

    for (const drawSpellName of ['Ponder', 'Preordain', 'Brainstorm', 'Consider', 'Impulse', 'Chart a Course'] as const) {
      addCard(state, 'Island', 'library');
      addCard(state, 'Island', 'library');
      addCard(state, 'Island', 'library');
      const spell = addCard(state, drawSpellName, 'hand');
      const beforeHand = zoneCount(state, 'p1', 'hand');
      state = castAndResolve(state, spell);
      expect(zoneCount(state, 'p1', 'hand')).toBeGreaterThanOrEqual(beforeHand - 1);
    }

    const talrand = addCard(state, 'Talrand, Sky Summoner', 'battlefield', 'p1', { summoningSick: false });
    state = registerPermanent(state, talrand);

    const opt = addCard(state, 'Opt', 'hand');
    addCard(state, 'Island', 'library');
    const castOpt = tryCastSpell(giveMana(state), 'p1', opt, [], NO_PAYMENT);
    expect(castOpt.ok, castOpt.ok ? undefined : castOpt.message).toBe(true);
    state = putTriggersOnStack(castOpt.state);
    state = resolveTopOfStack(state);
    expect(tokenCount(state, 'p1', 'Drake')).toBe(1);
    state = resolveTopOfStack(state);

    const invocation = addCard(state, "Talrand's Invocation", 'hand');
    state = castAndResolve(state, invocation);
    state = resolveAllPendingTriggers(state);
    expect(tokenCount(state, 'p1', 'Drake')).toBe(4);

    const stackTarget = addCard(state, 'Ponder', 'stack', 'p2');
    state = {
      ...state,
      stack: [{ kind: 'Spell', id: 'opponent_spell_1', cardInstanceId: stackTarget, casterId: 'p2', targets: [] }],
      priorityPlayerIndex: 0,
    };
    const counterspell = addCard(state, 'Counterspell', 'hand');
    state = castAndResolve(state, counterspell, [stackTarget]);
    expect(state.cards.get(stackTarget)?.zone).toBe('graveyard');

    const negateCreatureTarget = addCard(state, 'Goblin Instigator', 'stack', 'p2');
    state = {
      ...state,
      stack: [{ kind: 'Spell', id: 'opponent_spell_2', cardInstanceId: negateCreatureTarget, casterId: 'p2', targets: [] }],
      priorityPlayerIndex: 0,
    };
    expect(getLegalTargets(state, 'p1', { id: 'target_1', type: 'NoncreatureSpell', count: 1 })).toEqual([]);

    const negateTarget = addCard(state, 'Ponder', 'stack', 'p2');
    state = {
      ...state,
      stack: [{ kind: 'Spell', id: 'opponent_spell_3', cardInstanceId: negateTarget, casterId: 'p2', targets: [] }],
      priorityPlayerIndex: 0,
    };
    const negate = addCard(state, 'Negate', 'hand');
    state = castAndResolve(state, negate, [negateTarget]);
    expect(state.cards.get(negateTarget)?.zone).toBe('graveyard');

    const bounceCreature = addCard(state, 'Goblin Instigator', 'battlefield', 'p2', { summoningSick: false });
    const unsummon = addCard(state, 'Unsummon', 'hand');
    state = castAndResolve(state, unsummon, [bounceCreature]);
    expect(state.cards.get(bounceCreature)?.zone).toBe('hand');

    const bouncePermanent = addCard(state, 'Sol Ring', 'battlefield', 'p2', { summoningSick: false });
    const intoTheRoil = addCard(state, 'Into the Roil', 'hand');
    state = castAndResolve(state, intoTheRoil, [bouncePermanent]);
    expect(state.cards.get(bouncePermanent)?.zone).toBe('hand');

    const targetSpecs = getSpellTargetSpecs(state, state.cards.get(intoTheRoil)!);
    expect(targetSpecs[0]?.type).toBe('NonlandPermanent');
  });

  it('resolves blue starter draw, filtering, targeted bounce, and Aetherize', () => {
    const drawAndFilterSpells = [
      'Anticipate',
      'Compulsive Research',
      'Concentrate',
      'Counsel of the Soratami',
      'Curate',
      'Divination',
      'Frantic Search',
      'Hieroglyphic Illumination',
      'Inspiration',
      "Jace's Ingenuity",
      'Peek',
      'Quick Study',
      'See Beyond',
      'Serum Visions',
      'Sleight of Hand',
      'Strategic Planning',
      'Think Twice',
    ] as const;
    const targetsSelf = new Set<string>(['Compulsive Research', 'Inspiration', 'Peek']);

    for (const spellName of drawAndFilterSpells) {
      let state = makeState();
      for (let i = 0; i < 8; i++) addCard(state, 'Island', 'library');
      for (let i = 0; i < 3; i++) addCard(state, 'Island', 'hand');
      const spell = addCard(state, spellName, 'hand');
      const beforeLibrary = zoneCount(state, 'p1', 'library');

      state = castAndResolve(state, spell, targetsSelf.has(spellName) ? ['p1'] : []);

      expect(state.cards.get(spell)?.zone, spellName).toBe('graveyard');
      expect(zoneCount(state, 'p1', 'library'), spellName).toBeLessThan(beforeLibrary);
    }

    let bounce = makeState();
    const blinkTarget = addCard(bounce, 'Sol Ring', 'battlefield', 'p2', { summoningSick: false });
    const blink = addCard(bounce, 'Blink of an Eye', 'hand');
    bounce = castAndResolve(bounce, blink, [blinkTarget]);
    expect(bounce.cards.get(blinkTarget)?.zone).toBe('hand');

    const disperseTarget = addCard(bounce, 'Arcane Signet', 'battlefield', 'p2', { summoningSick: false });
    const disperse = addCard(bounce, 'Disperse', 'hand');
    bounce = castAndResolve(bounce, disperse, [disperseTarget]);
    expect(bounce.cards.get(disperseTarget)?.zone).toBe('hand');

    let aetherizeState = makeState();
    const attackerOne = addCard(aetherizeState, 'Goblin Instigator', 'battlefield', 'p2', { summoningSick: false });
    const attackerTwo = addCard(aetherizeState, 'Colossal Dreadmaw', 'battlefield', 'p2', { summoningSick: false });
    const bystander = addCard(aetherizeState, 'Elvish Mystic', 'battlefield', 'p2', { summoningSick: false });
    aetherizeState = {
      ...aetherizeState,
      phase: 'combat',
      step: 'declare_blockers',
      combat: {
        attackers: [
          { cardInstanceId: attackerOne, defendingPlayerId: 'p1' },
          { cardInstanceId: attackerTwo, defendingPlayerId: 'p1' },
        ],
        blockers: [],
        damageAssignment: new Map(),
      },
    };
    const aetherize = addCard(aetherizeState, 'Aetherize', 'hand');
    aetherizeState = castAndResolve(aetherizeState, aetherize);

    expect(aetherizeState.cards.get(attackerOne)?.zone).toBe('hand');
    expect(aetherizeState.cards.get(attackerTwo)?.zone).toBe('hand');
    expect(aetherizeState.cards.get(bystander)?.zone).toBe('battlefield');
  });

  it('plays the first real action sequence for every shipped starter through legal actions', () => {
    for (const deck of STARTER_DECKS) {
      let state = initRuntimeStarter(deck.id);
      const basicName = deck.colors[0] === 'R' ? 'Mountain' : deck.colors[0] === 'U' ? 'Island' : 'Forest';
      const landId = moveRuntimeCard(state, 'human', basicName, 'hand');
      const solRingId = moveRuntimeCard(state, 'human', 'Sol Ring', 'hand');

      const playLand = getLegalActionForCard(state, 'PlayLand', landId);
      expect(playLand.cardInstanceId).toBe(landId);

      const played = tryPlayLand(state, 'human', playLand.cardInstanceId);
      expect(played.ok, played.ok ? undefined : played.message).toBe(true);
      state = played.state;
      expect(state.cards.get(landId)?.zone).toBe('battlefield');

      const manaAction = getLegalActionForCard(state, 'ActivateManaAbility', landId);
      const tapped = tryTapLandForMana(state, 'human', manaAction.cardInstanceId, manaAction.color);
      expect(tapped.ok, tapped.ok ? undefined : tapped.message).toBe(true);
      state = tapped.state;

      const solRingCast = getLegalActionForCard(state, 'CastSpell', solRingId);
      const cast = tryCastSpell(state, 'human', solRingCast.cardInstanceId, solRingCast.targets, NO_PAYMENT);
      expect(cast.ok, cast.ok ? undefined : cast.message).toBe(true);
      state = resolveTopOfStack(cast.state);
      expect(state.cards.get(solRingId)?.zone, deck.id).toBe('battlefield');
    }
  });

  it('executes each starter deck core game plan through the public action surface', () => {
    let green = initRuntimeStarter('beginner-goreclaw-stompy');
    const goreclawId = findRuntimeCard(green, 'human', 'Goreclaw, Terror of Qal Sisma', ['command']);
    green = setHumanMana(green, { G: 4 });
    const goreclawCast = getLegalActionForCard(green, 'CastSpell', goreclawId);
    let cast = tryCastSpell(green, 'human', goreclawCast.cardInstanceId, goreclawCast.targets, NO_PAYMENT);
    expect(cast.ok, cast.ok ? undefined : cast.message).toBe(true);
    green = resolveRuntimeStack(cast.state);
    expect(green.cards.get(goreclawId)?.zone).toBe('battlefield');

    const reducedDreadmawId = moveRuntimeCard(green, 'human', 'Colossal Dreadmaw', 'hand');
    green = castLegalRuntimeSpell(green, 'Colossal Dreadmaw', { G: 4 });
    expect(green.cards.get(reducedDreadmawId)?.zone).toBe('battlefield');

    const dreadmawId = moveRuntimeCard(green, 'human', 'Colossal Dreadmaw', 'battlefield', { summoningSick: false });
    moveRuntimeCard(green, 'human', 'Rancor', 'hand');
    green = castLegalRuntimeSpell(green, 'Rancor', { G: 1 }, dreadmawId);
    const rancorId = findRuntimeCard(green, 'human', 'Rancor', ['battlefield']);
    expect(green.cards.get(rancorId)?.attachedTo).toBe(dreadmawId);

    green = { ...green, phase: 'combat', step: 'declare_attackers', priorityPlayerIndex: 0 };
    const attackAction = getLegalActions(green, 'human').find(action =>
      action.kind === 'DeclareAttackers' && action.attacks.some(attack => attack.cardInstanceId === dreadmawId),
    );
    expect(attackAction).toBeDefined();
    green = declareAttackers(green, 'human', (attackAction as Extract<AIAction, { kind: 'DeclareAttackers' }>).attacks);
    green = declareBlockers(green, 'ai1', []);
    green = resolveCombatDamage(green);
    expect(green.players.find(player => player.id === 'ai1')?.life).toBeLessThan(40);

    let red = initRuntimeStarter('beginner-krenko-goblins');
    const krenkoId = findRuntimeCard(red, 'human', 'Krenko, Mob Boss', ['command']);
    red = setHumanMana(red, { R: 4 });
    const krenkoCast = getLegalActionForCard(red, 'CastSpell', krenkoId);
    cast = tryCastSpell(red, 'human', krenkoCast.cardInstanceId, krenkoCast.targets, NO_PAYMENT);
    expect(cast.ok, cast.ok ? undefined : cast.message).toBe(true);
    red = resolveRuntimeStack(cast.state);
    red.cards.set(krenkoId, { ...red.cards.get(krenkoId)!, summoningSick: false });

    moveRuntimeCard(red, 'human', 'Goblin Instigator', 'hand');
    red = castLegalRuntimeSpell(red, 'Goblin Instigator', { R: 2 });
    const goblinsBeforeKrenko = runtimeTokenCount(red, 'human', 'Goblin');
    expect(goblinsBeforeKrenko).toBeGreaterThanOrEqual(1);
    const krenkoAction = getLegalActionForCard(red, 'ActivateAbility', krenkoId);
    const activated = tryActivateAbility(red, 'human', krenkoAction.cardInstanceId, krenkoAction.abilityIndex, krenkoAction.targets);
    expect(activated.ok, activated.ok ? undefined : activated.message).toBe(true);
    red = resolveRuntimeStack(activated.state);
    expect(runtimeTokenCount(red, 'human', 'Goblin')).toBeGreaterThan(goblinsBeforeKrenko);

    let blue = initRuntimeStarter('beginner-talrand-spells');
    const talrandId = findRuntimeCard(blue, 'human', 'Talrand, Sky Summoner', ['command']);
    blue = setHumanMana(blue, { U: 4 });
    const talrandCast = getLegalActionForCard(blue, 'CastSpell', talrandId);
    cast = tryCastSpell(blue, 'human', talrandCast.cardInstanceId, talrandCast.targets, NO_PAYMENT);
    expect(cast.ok, cast.ok ? undefined : cast.message).toBe(true);
    blue = resolveRuntimeStack(cast.state);

    moveRuntimeCard(blue, 'human', 'Island', 'library');
    moveRuntimeCard(blue, 'human', 'Opt', 'hand');
    blue = castLegalRuntimeSpell(blue, 'Opt', { U: 1 });
    expect(runtimeTokenCount(blue, 'human', 'Drake')).toBe(1);
  });

  it('exposes starter interaction spells as legal targeted actions when the stack or board asks for them', () => {
    let red = initRuntimeStarter('beginner-krenko-goblins');
    const boltTarget = moveRuntimeCard(red, 'ai1', 'Goblin Instigator', 'battlefield', { summoningSick: false });
    red = setHumanMana(red, { R: 1 });
    moveRuntimeCard(red, 'human', 'Lightning Bolt', 'hand');
    const bolt = getLegalCastByNameTarget(red, 'Lightning Bolt', boltTarget);
    expect(bolt.targets).toEqual([boltTarget]);

    let green = initRuntimeStarter('beginner-goreclaw-stompy');
    const permanentTarget = moveRuntimeCard(green, 'ai1', 'Sol Ring', 'battlefield');
    green = setHumanMana(green, { G: 3 });
    moveRuntimeCard(green, 'human', 'Beast Within', 'hand');
    const beastWithin = getLegalCastByName(green, 'Beast Within');
    expect(beastWithin.targets).toEqual([permanentTarget]);

    let blue = initRuntimeStarter('beginner-talrand-spells');
    const stackTarget = moveRuntimeCard(blue, 'ai1', 'Ponder', 'stack');
    blue = {
      ...setHumanMana(blue, { U: 2 }),
      stack: [{ kind: 'Spell', id: 'starter_runtime_stack_spell', cardInstanceId: stackTarget, casterId: 'ai1', targets: [] }],
      priorityPlayerIndex: 0,
    };
    moveRuntimeCard(blue, 'human', 'Counterspell', 'hand');
    const counterspell = getLegalCastByName(blue, 'Counterspell');
    expect(counterspell.targets).toEqual([stackTarget]);
  });

  it('finishes an empty human starter turn through public actions instead of getting stuck in phase cycling', () => {
    for (const deck of STARTER_DECKS) {
      const state = initRuntimeStarter(deck.id);
      const next = finishHumanTurnWithPublicActions(state);

      expect(next.players[next.activePlayerIndex].id, deck.id).toBe('ai1');
      expect(next.step, deck.id).toBe('untap');
      expect(next.phase, deck.id).toBe('beginning');
    }
  });

  it('resolves Goreclaw attack trigger before combat damage', () => {
    let state = makeState();
    const goreclaw = addCard(state, 'Goreclaw, Terror of Qal Sisma', 'battlefield', 'p1', {
      isCommander: true,
      summoningSick: false,
    });
    const terra = addCard(state, 'Terra Stomper', 'battlefield', 'p1', { summoningSick: false });
    const small = addCard(state, 'Colossodon Yearling', 'battlefield', 'p1', { summoningSick: false });
    state = registerPermanent(state, goreclaw);
    state = {
      ...state,
      phase: 'combat',
      step: 'declare_attackers',
      priorityPlayerIndex: 0,
    };

    state = declareAttackers(state, 'p1', [{ cardInstanceId: goreclaw, defendingPlayerId: 'p2' }]);
    expect(state.pendingTriggers.length).toBeGreaterThan(0);
    state = resolveAllPendingTriggers(state);

    expect(getEffectivePower(state, goreclaw)).toBe(5);
    expect(getEffectivePower(state, terra)).toBe(9);
    expect(getEffectivePower(state, small)).toBe(2);
    expect(instanceHasKeyword(state, goreclaw, 'Trample')).toBe(true);
    expect(instanceHasKeyword(state, terra, 'Trample')).toBe(true);
    expect(instanceHasKeyword(state, small, 'Trample')).toBe(false);

    state = declareBlockers(state, 'p2', []);
    state = resolveCombatDamage(state);

    expect(state.players.find(player => player.id === 'p2')?.life).toBe(35);

    state = advanceStep({ ...state, step: 'cleanup', phase: 'ending' });

    expect(getEffectivePower(state, goreclaw)).toBe(4);
    expect(getEffectivePower(state, terra)).toBe(8);
    expect(state.cards.get(goreclaw)?.counters['_powerMod']).toBeUndefined();
    expect(state.cards.get(terra)?.counters['_powerMod']).toBeUndefined();
    expect(instanceHasKeyword(state, goreclaw, 'Trample')).toBe(false);
    expect(instanceHasKeyword(state, terra, 'Trample')).toBe(true);
  });

  it('deals combat damage for every starter commander through public attack and block actions', () => {
    const damageCases = [
      { deckId: 'beginner-goreclaw-stompy', attackerName: 'Goreclaw, Terror of Qal Sisma' },
      { deckId: 'beginner-krenko-goblins', attackerName: 'Krenko, Mob Boss' },
      { deckId: 'beginner-talrand-spells', attackerName: 'Talrand, Sky Summoner' },
    ] as const;

    for (const { deckId, attackerName } of damageCases) {
      let state = initRuntimeStarter(deckId);
      const attackerId = moveRuntimeCard(state, 'human', attackerName, 'battlefield', {
        isCommander: true,
        summoningSick: false,
      });
      state = {
        ...state,
        activePlayerIndex: 0,
        priorityPlayerIndex: 0,
        phase: 'combat',
        step: 'declare_attackers',
        hasPriorityPassed: new Array(state.players.length).fill(false),
      };

      const attack = getLegalActions(state, 'human').find(
        (action): action is Extract<AIAction, { kind: 'DeclareAttackers' }> =>
          action.kind === 'DeclareAttackers'
          && action.attacks.some(declaration => declaration.cardInstanceId === attackerId),
      );
      expect(attack, deckId).toBeDefined();

      const declaredAttack = tryDeclareAttackers(state, 'human', attack!.attacks);
      expect(declaredAttack.ok, declaredAttack.ok ? undefined : declaredAttack.message).toBe(true);
      state = passPriorityWindowAndAdvance(declaredAttack.state);
      expect(state.step, deckId).toBe('declare_blockers');

      const noBlocks = getLegalActions(state, 'ai1').find(
        (action): action is Extract<AIAction, { kind: 'DeclareBlockers' }> =>
          action.kind === 'DeclareBlockers' && action.blocks.length === 0,
      );
      expect(noBlocks, deckId).toBeDefined();
      const declaredBlocks = tryDeclareBlockers(state, 'ai1', noBlocks!.blocks);
      expect(declaredBlocks.ok, declaredBlocks.ok ? undefined : declaredBlocks.message).toBe(true);
      state = passPriorityWindowAndAdvance(declaredBlocks.state);
      state = passPriorityWindowAndAdvance(state);
      expect(state.step, deckId).toBe('combat_damage');

      state = resolveCombatDamage(state);
      const aiLife = state.players.find(player => player.id === 'ai1')?.life;
      expect(aiLife, deckId).toBeLessThan(40);
      expect(state.players.find(player => player.id === 'ai1')?.commanderDamage[attackerId] ?? 0, deckId)
        .toBeGreaterThan(0);
    }
  });
});
