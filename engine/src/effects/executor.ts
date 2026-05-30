// Phase 4: Effect executor - applies Effect AST to GameState
// Phase 10: Extended with new effect types, X costs, tokens
// Phase 14: Extended with ExileFromLibrary, GainControl, ForEach, EachPlayer, AllOfType
// Phase 17: Conditional, Blink, Copy, GrantKeyword, PhaseOut, loyalty ability execution

import type { GameState, CardInstance, CardDefinition, PendingTrigger, Zone, DiceRollRecord } from '../types';
import { isSpellStackItem } from '../types';
import type { Effect, TargetRef, AmountRef, TokenDefinition, CardFilter, SurveilEffect, ForEachAmount, Condition, LoyaltyAbility } from './ast';
import { getCardDefinition, pruneDetachedEffects } from '../game-state';
import { checkStateBasedActions, markPlayerLostFromEmptyLibrary } from '../state-based';
import { instanceHasKeyword, isIndestructible } from '../keywords';
import { getCommanderDestinationZone } from '../commander';
import { applyDamageReplacementEffects, applyReplacements, registerDamagePrevention } from './replacement';
import type { ReplacementEvent } from './replacement';
import { getEffectivePower } from './continuous';
import { isEffectiveCreature } from '../effective-types';
import { buildBattlefieldEntryPlan } from '../permanent-entry';

/**
 * Context for effect execution, includes X value from spell casting.
 */
export interface ExecutionContext {
  casterId: string;
  chosenTargets: Map<string, string>;
  xValue: number;
  namedCardChoices: Map<string, string>;
  sourceInstanceId?: string;
  eventContext?: {
    casterId?: string;
    cardInstanceId?: string;
  };
}

export interface EffectExecutionOptions {
  namedCardChoices?: Record<string, string>;
  sourceInstanceId?: string;
  eventContext?: ExecutionContext['eventContext'];
}

/**
 * Resolve an AmountRef to a concrete number.
 * For ForEach amounts, we need the full game state and caster.
 */
function resolveAmount(
  amount: AmountRef,
  xValue: number,
  state?: GameState,
  casterId?: string,
  chosenTargets: Map<string, string> = new Map(),
  targetId?: string,
  eventCardInstanceId?: string,
): number {
  if (typeof amount === 'number') {
    return amount;
  }
  if (amount.kind === 'X') {
    return xValue;
  }
  if (amount.kind === 'XMultiplied') {
    return xValue * amount.multiplier;
  }
  if (amount.kind === 'EventSpellManaValue') {
    if (!state || !eventCardInstanceId) return 0;
    const eventCard = state.cards.get(eventCardInstanceId);
    const eventDef = eventCard ? getCardDefinition(state, eventCard) : undefined;
    return eventDef?.cmc ?? 0;
  }
  if (amount.kind === 'ForEach') {
    return resolveForEachCount(amount, state, casterId);
  }
  if (amount.kind === 'GreatestPower') {
    return resolveGreatestPower(amount, state, casterId);
  }
  if (amount.kind === 'GreatestManaValue') {
    return resolveGreatestManaValue(amount, state, casterId);
  }
  if (amount.kind === 'TargetPower') {
    if (!state || !casterId) return 0;
    const resolvedTargetId = targetId ?? resolveTargetRef(amount.target, casterId, chosenTargets, state);
    return getEffectivePower(state, resolvedTargetId);
  }
  // Exhaustiveness
  const _never: never = amount;
  throw new Error(`Unknown AmountRef kind`);
}

function resolveControllerIds(
  state: GameState,
  casterId: string,
  controller: 'you' | 'opponent' | 'each',
): string[] {
  if (controller === 'you') return [casterId];
  if (controller === 'opponent') {
    return state.players.filter(p => p.id !== casterId && !p.hasLost).map(p => p.id);
  }
  return state.players.filter(p => !p.hasLost).map(p => p.id);
}

/**
 * Count entities matching a ForEachAmount condition.
 */
function resolveForEachCount(
  forEach: ForEachAmount,
  state?: GameState,
  casterId?: string,
): number {
  if (!state || !casterId) return 0;

  let count = 0;
  const { zone, filter, controller } = forEach;

  const playerIds = resolveControllerIds(state, casterId, controller);

  for (const [, card] of state.cards) {
    if (card.zone !== zone) continue;
    if (!playerIds.includes(card.ownerId)) continue;

    if (filter) {
      const def = getCardDefinition(state, card);
      const filterWithoutPower = { ...filter };
      delete filterWithoutPower.power;
      if (!matchesCardFilter(def, filterWithoutPower)) continue;
      if (filter.power) {
        const effectivePower = (def.power ?? 0)
          + (card.counters['+1/+1'] || 0)
          - (card.counters['-1/-1'] || 0)
          + (card.counters['_powerMod'] || 0);
        if (!matchesNumericFilter(effectivePower, filter.power)) continue;
      }
    }

    count++;
  }

  return count;
}

function resolveGreatestPower(
  amount: Extract<AmountRef, { kind: 'GreatestPower' }>,
  state?: GameState,
  casterId?: string,
): number {
  if (!state || !casterId) return 0;

  let greatest = 0;
  const playerIds = resolveControllerIds(state, casterId, amount.controller);
  for (const [, card] of state.cards) {
    if (card.zone !== amount.zone) continue;
    if (!playerIds.includes(card.ownerId)) continue;
    const def = getCardDefinition(state, card);
    if (amount.filter && !matchesCardFilter(def, amount.filter)) continue;
    greatest = Math.max(greatest, getEffectivePower(state, card.instanceId));
  }
  return greatest;
}

function resolveGreatestManaValue(
  amount: Extract<AmountRef, { kind: 'GreatestManaValue' }>,
  state?: GameState,
  casterId?: string,
): number {
  if (!state || !casterId) return 0;

  let greatest = 0;
  const playerIds = resolveControllerIds(state, casterId, amount.controller);
  for (const [, card] of state.cards) {
    if (card.zone !== amount.zone) continue;
    if (!playerIds.includes(card.ownerId)) continue;
    const def = getCardDefinition(state, card);
    if (amount.filter && !matchesCardFilter(def, amount.filter)) continue;
    greatest = Math.max(greatest, def.cmc ?? 0);
  }
  return greatest;
}

/**
 * Resolve a TargetRef to a concrete ID or IDs.
 * For 'Controller', we need the caster's ID.
 */
function resolveTargetRef(
  ref: TargetRef,
  casterId: string,
  chosenTargets: Map<string, string>,
  state?: GameState,
  eventContext?: ExecutionContext['eventContext'],
): string {
  switch (ref.kind) {
    case 'Chosen':
      const chosen = chosenTargets.get(ref.targetId);
      if (!chosen) {
        throw new Error(`Missing chosen target for ${ref.targetId}`);
      }
      return chosen;
    case 'TargetController': {
      const chosenTarget = chosenTargets.get(ref.targetId);
      if (!chosenTarget) {
        throw new Error(`Missing chosen target for ${ref.targetId}`);
      }
      if (!state) {
        throw new Error('TargetController target requires game state');
      }
      const stackItem = state.stack.find(item => {
        if (item.id === chosenTarget) return true;
        return isSpellStackItem(item) && item.cardInstanceId === chosenTarget;
      });
      if (stackItem) {
        return isSpellStackItem(stackItem) ? stackItem.casterId : stackItem.controllerId;
      }
      const targetCard = state.cards.get(chosenTarget);
      if (targetCard) return targetCard.ownerId;
      throw new Error(`Cannot find controller for target ${chosenTarget}`);
    }
    case 'Controller':
      return casterId;
    case 'ActivePlayer': {
      const activePlayer = state?.players[state.activePlayerIndex];
      if (!activePlayer) {
        throw new Error('ActivePlayer target requires game state');
      }
      return activePlayer.id;
    }
    case 'Player':
      return ref.playerId;
    case 'EachOpponent':
      throw new Error('EachOpponent must be handled before calling resolveTargetRef');
    case 'EachPlayer':
      throw new Error('EachPlayer must be handled before calling resolveTargetRef');
    case 'AllCreatures':
      throw new Error('AllCreatures must be handled before calling resolveTargetRef');
    case 'AllAttackingCreatures':
      throw new Error('AllAttackingCreatures must be handled before calling resolveTargetRef');
    case 'AllCreaturesYouControl':
      throw new Error('AllCreaturesYouControl must be handled before calling resolveTargetRef');
    case 'AllOfType':
      throw new Error('AllOfType must be handled before calling resolveTargetRef');
    case 'Source':
      throw new Error('Source target must be handled with effect execution context');
    case 'EventCaster':
      if (!eventContext?.casterId) {
        throw new Error('EventCaster target requires trigger event context');
      }
      return eventContext.casterId;
    case 'EventSpell':
      if (!eventContext?.cardInstanceId) {
        throw new Error('EventSpell target requires trigger event context');
      }
      return eventContext.cardInstanceId;
    default:
      // Exhaustiveness check
      const _never: never = ref;
      throw new Error(`Unknown TargetRef kind`);
  }
}

function matchesNumericFilter(value: number, filter: { op: 'eq' | 'lte' | 'gte'; value: number }): boolean {
  switch (filter.op) {
    case 'eq': return value === filter.value;
    case 'lte': return value <= filter.value;
    case 'gte': return value >= filter.value;
  }
}

function resolveNamedCardChoice(
  effect: { namedCard?: string; namedCardChoiceId?: string },
  choices: Map<string, string>,
): string {
  const choiceId = effect.namedCardChoiceId ?? 'namedCard';
  const chosen = choices.get(choiceId) || choices.get('namedCard') || choices.get('cardName');
  const namedCard = chosen || effect.namedCard;
  if (!namedCard?.trim()) {
    throw new Error(`Missing named card choice for ${choiceId}`);
  }
  return namedCard.trim();
}

/**
 * Execute a Draw effect.
 */
function executeDraw(state: GameState, playerId: string, count: number): GameState {
  // Check for replacement effects (e.g., draw doubling)
  const event: ReplacementEvent = { type: 'CardDrawn', targetId: playerId, amount: count };
  const { event: replaced } = applyReplacements(state, event);
  if (!replaced) return state; // fully prevented
  const finalCount = replaced.amount ?? count;
  if (finalCount <= 0) return state;

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    throw new Error(`Player ${playerId} not found`);
  }

  let currentState = state;
  const newCards = new Map(state.cards);

  // Find cards in library (ordered by... we assume first entries are top)
  const libraryCards: CardInstance[] = [];
  for (const [, card] of state.cards) {
    if (card.ownerId === playerId && card.zone === 'library') {
      libraryCards.push(card);
    }
  }

  // Draw each card one at a time
  for (let i = 0; i < finalCount; i++) {
    if (i >= libraryCards.length) {
      // Attempting to draw from an empty library normally loses, but cards
      // such as Laboratory Maniac and Jace replace that draw with a win.
      currentState = hasEmptyLibraryDrawWinReplacement(currentState, playerId)
        ? markPlayerWonGame(currentState, playerId)
        : markPlayerLostFromEmptyLibrary(currentState, playerId);
      break;
    }
    const card = libraryCards[i];
    newCards.set(card.instanceId, { ...card, zone: 'hand' });
  }

  return { ...currentState, cards: newCards };
}

/**
 * Execute a Destroy effect.
 */
function executeDestroy(state: GameState, targetId: string): GameState {
  const card = state.cards.get(targetId);
  if (!card) {
    // Target no longer exists (fizzle)
    return state;
  }

  if (card.zone !== 'battlefield') {
    // Can only destroy things on battlefield
    return state;
  }

  // Indestructible creatures cannot be destroyed
  if (isIndestructible(state, targetId)) {
    return state;
  }

  const destZone = getDeathDestination(state, targetId, card);
  if (!destZone) return state;
  const newCards = new Map(state.cards);
  newCards.set(targetId, { ...card, zone: destZone, damage: 0, deathtouchDamage: undefined, tapped: false });

  return pruneDetachedEffects({ ...state, cards: newCards });
}

function getDeathDestination(state: GameState, cardInstanceId: string, card: CardInstance): Zone | null {
  const commanderDestination = getCommanderDestinationZone(state, cardInstanceId, 'graveyard');
  if (commanderDestination !== 'graveyard') return commanderDestination;
  if (!isEffectiveCreature(state, cardInstanceId)) return 'graveyard';

  const { event } = applyReplacements(state, {
    type: 'CreatureDies',
    cardInstanceId,
    targetId: card.ownerId,
    destinationZone: 'graveyard',
  });
  if (!event) return null;
  return event.destinationZone || 'graveyard';
}

/**
 * Execute a DealDamage effect.
 */
function executeDealDamage(state: GameState, targetId: string, amount: number, sourceInstanceId?: string): GameState {
  // Check for replacement effects (e.g., damage prevention)
  const event: ReplacementEvent & { type: 'DamageDealt'; amount: number } = {
    type: 'DamageDealt',
    targetId,
    sourceId: sourceInstanceId,
    amount,
  };
  const { state: replacedState, event: replaced } = applyDamageReplacementEffects(state, event);
  if (!replaced) return state; // fully prevented
  const finalAmount = replaced.amount ?? amount;
  if (finalAmount <= 0) return state;

  // Check if target is a player
  const playerIndex = replacedState.players.findIndex(p => p.id === targetId);
  if (playerIndex !== -1) {
    const newPlayers = replacedState.players.map((p, i) =>
      i === playerIndex ? { ...p, life: p.life - finalAmount } : p
    );
    return { ...replacedState, players: newPlayers };
  }

  // Target is a card (creature)
  const card = replacedState.cards.get(targetId);
  if (!card) {
    // Target no longer exists (fizzle)
    return replacedState;
  }

  if (card.zone !== 'battlefield') {
    // Can only damage things on battlefield
    return replacedState;
  }

  const newCards = new Map(replacedState.cards);
  const sourceHasDeathtouch = sourceInstanceId ? instanceHasKeyword(replacedState, sourceInstanceId, 'Deathtouch') : false;
  newCards.set(targetId, {
    ...card,
    damage: card.damage + finalAmount,
    deathtouchDamage: card.deathtouchDamage || sourceHasDeathtouch,
  });

  return pruneDetachedEffects({ ...replacedState, cards: newCards });
}

function executePreventDamage(
  state: GameState,
  effect: Extract<Effect, { kind: 'PreventDamage' }>,
  casterId: string,
  sourceInstanceId?: string,
  xValue = 0,
  chosenTargets: Map<string, string> = new Map(),
): GameState {
  const protectedTargetId = effect.target
    ? resolveTargetRef(effect.target, casterId, chosenTargets, state)
    : undefined;
  const amount = effect.amount === 'all'
    ? 'all'
    : resolveAmount(effect.amount, xValue, state, casterId, chosenTargets);

  return registerDamagePrevention(state, {
    id: `damage_prevention_${sourceInstanceId || casterId}_${state.turnNumber}_${(state.damagePreventionEffects || []).length + 1}`,
    sourceInstanceId,
    controllerId: casterId,
    protectedTargetId,
    amount,
    combatOnly: effect.combatOnly,
    expiresAtTurnNumber: state.turnNumber,
  });
}

function hasEmptyLibraryDrawWinReplacement(state: GameState, playerId: string): boolean {
  for (const card of state.cards.values()) {
    if (card.zone !== 'battlefield' || card.ownerId !== playerId) continue;
    const def = getCardDefinition(state, card);
    if (/if you would draw a card while your library has no cards in it,\s*you win the game instead/i.test(def.oracle_text)) {
      return true;
    }
  }
  return false;
}

function markPlayerWonGame(state: GameState, winnerId: string): GameState {
  return {
    ...state,
    players: state.players.map(player =>
      player.id === winnerId ? player : { ...player, hasLost: true }
    ),
  };
}

/**
 * Execute a GainLife effect.
 */
function executeGainLife(state: GameState, playerId: string, amount: number): GameState {
  // Check for replacement effects (e.g., life gain prevention/doubling)
  const event: ReplacementEvent = { type: 'LifeGained', targetId: playerId, amount };
  const { event: replaced } = applyReplacements(state, event);
  if (!replaced) return state; // fully prevented
  const finalAmount = replaced.amount ?? amount;
  if (finalAmount <= 0) return state;

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    throw new Error(`Player ${playerId} not found`);
  }

  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, life: p.life + finalAmount } : p
  );

  return { ...state, players: newPlayers };
}

/**
 * Execute a LoseLife effect.
 */
function executeLoseLife(state: GameState, playerId: string, amount: number): GameState {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    throw new Error(`Player ${playerId} not found`);
  }

  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, life: p.life - amount } : p
  );

  return { ...state, players: newPlayers };
}

/**
 * Execute an Exile effect.
 */
function executeExile(state: GameState, targetId: string): GameState {
  const card = state.cards.get(targetId);
  if (!card) return state;

  const destZone = getCommanderDestinationZone(state, targetId, 'exile');
  const newCards = new Map(state.cards);
  newCards.set(targetId, { ...card, zone: destZone });

  return pruneDetachedEffects({ ...state, cards: newCards });
}

function executePutIntoLibrary(
  state: GameState,
  targetId: string,
  position: 'top' | 'bottom' | 'shuffle',
): GameState {
  const card = state.cards.get(targetId);
  if (!card) return state;

  const ownerId = card.ownerId;
  const libraryCards: CardInstance[] = [];
  const otherEntries: [string, CardInstance][] = [];

  for (const [id, existing] of state.cards) {
    if (id === targetId) continue;
    if (existing.ownerId === ownerId && existing.zone === 'library') {
      libraryCards.push(existing);
    } else {
      otherEntries.push([id, existing]);
    }
  }

  const libraryCard: CardInstance = {
    ...card,
    zone: 'library',
    tapped: false,
    damage: 0,
    counters: {},
    summoningSick: true,
    attachedTo: undefined,
  };

  let nextLibrary = position === 'bottom'
    ? [...libraryCards, libraryCard]
    : [libraryCard, ...libraryCards];

  if (position === 'shuffle') {
    for (let i = nextLibrary.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nextLibrary[i], nextLibrary[j]] = [nextLibrary[j], nextLibrary[i]];
    }
  }

  const newCards = new Map<string, CardInstance>();
  for (const [id, existing] of otherEntries) newCards.set(id, existing);
  for (const libraryEntry of nextLibrary) newCards.set(libraryEntry.instanceId, libraryEntry);

  return pruneDetachedEffects({ ...state, cards: newCards });
}

/**
 * Execute a ReturnToHand effect.
 */
function executeReturnToHand(state: GameState, targetId: string): GameState {
  const card = state.cards.get(targetId);
  if (!card) return state;

  // Commander replacement: owner may choose command zone instead of hand
  // Default: goes to hand (owner doesn't auto-choose command zone for bounce)
  const destZone = getCommanderDestinationZone(state, targetId, 'hand');
  const newCards = new Map(state.cards);
  newCards.set(targetId, {
    ...card,
    zone: destZone,
    tapped: false,
    damage: 0,
    counters: {},
    summoningSick: true,
  });

  return pruneDetachedEffects({ ...state, cards: newCards });
}

/**
 * Execute a Mill effect.
 */
function executeMill(state: GameState, playerId: string, count: number): GameState {
  const newCards = new Map(state.cards);

  // Find cards in library
  const libraryCards: CardInstance[] = [];
  for (const [, card] of state.cards) {
    if (card.ownerId === playerId && card.zone === 'library') {
      libraryCards.push(card);
    }
  }

  // Mill from top (first entries)
  const toMill = Math.min(count, libraryCards.length);
  for (let i = 0; i < toMill; i++) {
    const card = libraryCards[i];
    newCards.set(card.instanceId, { ...card, zone: 'graveyard' });
  }

  return { ...state, cards: newCards };
}

/**
 * Execute an AddCounters effect.
 */
function executeAddCounters(
  state: GameState,
  targetId: string,
  counterType: string,
  count: number,
): GameState {
  // Check for replacement effects (e.g., counter doubling)
  const event: ReplacementEvent = { type: 'CounterAdded', targetId, amount: count };
  const { event: replaced } = applyReplacements(state, event);
  if (!replaced) return state; // fully prevented
  const finalCount = replaced.amount ?? count;
  if (finalCount <= 0) return state;

  // Check if the target is a player (for poison counters and similar)
  const playerIndex = state.players.findIndex(p => p.id === targetId);
  if (playerIndex !== -1) {
    // Poison has a first-class loss condition; every other player counter is
    // stored generically for energy, experience, rad, ticket, and similar mechanics.
    if (counterType === 'poison') {
      const newPlayers = state.players.map((p, i) =>
        i === playerIndex
          ? { ...p, poisonCounters: p.poisonCounters + finalCount }
          : p
      );
      return { ...state, players: newPlayers };
    }
    const normalizedCounter = counterType.trim().replace(/\s+/g, ' ').toLowerCase();
    const newPlayers = state.players.map((p, i) => {
      if (i !== playerIndex) return p;
      const current = p.playerCounters?.[normalizedCounter] ?? 0;
      return {
        ...p,
        playerCounters: {
          ...(p.playerCounters || {}),
          [normalizedCounter]: current + finalCount,
        },
      };
    });
    return { ...state, players: newPlayers };
  }

  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'battlefield') return state;

  const newCards = new Map(state.cards);
  const currentCount = card.counters[counterType] || 0;
  newCards.set(targetId, {
    ...card,
    counters: { ...card.counters, [counterType]: currentCount + finalCount },
  });

  return { ...state, cards: newCards };
}

/**
 * Execute a RemoveCounters effect.
 */
function executeRemoveCounters(
  state: GameState,
  targetId: string,
  counterType: string,
  count: number,
): GameState {
  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'battlefield') return state;

  const newCards = new Map(state.cards);
  const currentCount = card.counters[counterType] || 0;
  const newCount = Math.max(0, currentCount - count);

  const newCounters = { ...card.counters };
  if (newCount === 0) {
    delete newCounters[counterType];
  } else {
    newCounters[counterType] = newCount;
  }

  newCards.set(targetId, { ...card, counters: newCounters });

  return { ...state, cards: newCards };
}

/**
 * Execute a Tap effect.
 */
function executeTap(state: GameState, targetId: string): GameState {
  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'battlefield') return state;

  const newCards = new Map(state.cards);
  newCards.set(targetId, { ...card, tapped: true });

  return { ...state, cards: newCards };
}

/**
 * Execute an Untap effect.
 */
function executeUntap(state: GameState, targetId: string): GameState {
  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'battlefield') return state;

  const newCards = new Map(state.cards);
  newCards.set(targetId, { ...card, tapped: false });

  return { ...state, cards: newCards };
}

/**
 * Execute a Discard effect.
 */
function executeDiscard(state: GameState, playerId: string, count: number, random: boolean = false): GameState {
  const newCards = new Map(state.cards);

  // Find cards in hand
  const handCards: CardInstance[] = [];
  for (const [, card] of state.cards) {
    if (card.ownerId === playerId && card.zone === 'hand') {
      handCards.push(card);
    }
  }

  if (handCards.length === 0) return state;

  let toDiscard: CardInstance[];
  if (random) {
    // Shuffle and take first N
    const shuffled = [...handCards].sort(() => Math.random() - 0.5);
    toDiscard = shuffled.slice(0, Math.min(count, shuffled.length));
  } else {
    // For non-random, we just discard the first N (in real game, player chooses)
    toDiscard = handCards.slice(0, Math.min(count, handCards.length));
  }

  for (const card of toDiscard) {
    newCards.set(card.instanceId, { ...card, zone: 'graveyard' });
  }

  return { ...state, cards: newCards };
}

function splitChoiceIds(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

function rebuildLibraryOrder(
  state: GameState,
  playerId: string,
  newLibrary: CardInstance[],
  movedCards: CardInstance[] = [],
): GameState {
  const nonLibraryEntries: [string, CardInstance][] = [];
  const movedIds = new Set(movedCards.map(card => card.instanceId));

  for (const [id, card] of state.cards) {
    if (movedIds.has(id)) continue;
    if (card.ownerId !== playerId || card.zone !== 'library') {
      nonLibraryEntries.push([id, card]);
    }
  }

  const newCards = new Map<string, CardInstance>();
  for (const [id, card] of nonLibraryEntries) {
    newCards.set(id, card);
  }
  for (const card of newLibrary) {
    newCards.set(card.instanceId, { ...card, zone: 'library' });
  }
  for (const card of movedCards) {
    newCards.set(card.instanceId, card);
  }

  return { ...state, cards: newCards };
}

function executeUntapAllOfType(
  state: GameState,
  filter: CardFilter,
  maxCount?: number,
): GameState {
  const candidates: CardInstance[] = [];
  for (const card of state.cards.values()) {
    if (card.zone !== 'battlefield' || !card.tapped) continue;
    const def = getCardDefinition(state, card);
    if (!matchesCardFilter(def, filter)) continue;
    candidates.push(card);
  }

  if (candidates.length === 0) return state;

  const limit = maxCount === undefined ? candidates.length : Math.max(0, maxCount);
  if (limit === 0) return state;

  const newCards = new Map(state.cards);
  for (const card of candidates.slice(0, limit)) {
    newCards.set(card.instanceId, { ...card, tapped: false });
  }
  return { ...state, cards: newCards };
}

function orderChosenCards(sourceCards: CardInstance[], chosenIds: string[]): CardInstance[] {
  const byId = new Map(sourceCards.map(card => [card.instanceId, card]));
  const seen = new Set<string>();
  const ordered: CardInstance[] = [];
  for (const id of chosenIds) {
    const card = byId.get(id);
    if (!card || seen.has(id)) continue;
    seen.add(id);
    ordered.push(card);
  }
  return ordered;
}

/**
 * Execute a Scry effect. If explicit choices are provided, those choices are
 * authoritative; otherwise the AI/fallback heuristic keeps lands and cheap
 * spells on top.
 */
function executeScry(
  state: GameState,
  playerId: string,
  count: number,
  namedCardChoices: Map<string, string> = new Map(),
): GameState {
  // Get library cards (Map iteration order = library order)
  const libraryCards: CardInstance[] = [];
  for (const [, card] of state.cards) {
    if (card.ownerId === playerId && card.zone === 'library') {
      libraryCards.push(card);
    }
  }

  const toScry = Math.min(count, libraryCards.length);
  if (toScry === 0) return state;

  // Get the top N cards to scry
  const scryCards = libraryCards.slice(0, toScry);
  const restLibrary = libraryCards.slice(toScry);

  const hasExplicitChoices = namedCardChoices.has('scryTopIds') || namedCardChoices.has('scryBottomIds');
  if (hasExplicitChoices) {
    const topCards = orderChosenCards(scryCards, splitChoiceIds(namedCardChoices.get('scryTopIds')));
    const bottomCards = orderChosenCards(scryCards, splitChoiceIds(namedCardChoices.get('scryBottomIds')));
    const assigned = new Set([...topCards, ...bottomCards].map(card => card.instanceId));
    const unassignedTop = scryCards.filter(card => !assigned.has(card.instanceId));
    return rebuildLibraryOrder(state, playerId, [...topCards, ...unassignedTop, ...restLibrary, ...bottomCards]);
  }

  // AI heuristic: evaluate each card by CMC relative to current game state.
  // Keep lands and low-CMC spells on top early, expensive spells on bottom.
  // Simple rule: cards with CMC <= 3 or lands stay on top, others go to bottom.
  const keepOnTop: CardInstance[] = [];
  const sendToBottom: CardInstance[] = [];

  for (const card of scryCards) {
    const def = getCardDefinition(state, card);
    const isLand = def.card_types.includes('land');
    const isLowCost = def.cmc <= 3;
    if (isLand || isLowCost) {
      keepOnTop.push(card);
    } else {
      sendToBottom.push(card);
    }
  }

  // Rebuild library: top cards first, then rest, then bottom cards
  const newLibrary = [...keepOnTop, ...restLibrary, ...sendToBottom];

  return rebuildLibraryOrder(state, playerId, newLibrary);
}

/**
 * Execute a Surveil effect.
 * Simplified: uses AI heuristic — puts high-CMC non-land cards into graveyard,
 * keeps lands and low-CMC spells on top (similar to Scry but cards go to graveyard
 * instead of bottom of library).
 */
function executeSurveil(
  state: GameState,
  playerId: string,
  count: number,
  namedCardChoices: Map<string, string> = new Map(),
): GameState {
  // Get library cards (Map iteration order = library order)
  const libraryCards: CardInstance[] = [];
  for (const [, card] of state.cards) {
    if (card.ownerId === playerId && card.zone === 'library') {
      libraryCards.push(card);
    }
  }

  const toSurveil = Math.min(count, libraryCards.length);
  if (toSurveil === 0) return state;

  // Get the top N cards to surveil
  const surveilCards = libraryCards.slice(0, toSurveil);
  const restLibrary = libraryCards.slice(toSurveil);

  const hasExplicitChoices = namedCardChoices.has('surveilTopIds') || namedCardChoices.has('surveilGraveyardIds');
  if (hasExplicitChoices) {
    const topCards = orderChosenCards(surveilCards, splitChoiceIds(namedCardChoices.get('surveilTopIds')));
    const graveyardCards = orderChosenCards(surveilCards, splitChoiceIds(namedCardChoices.get('surveilGraveyardIds')))
      .map(card => ({ ...card, zone: 'graveyard' as Zone }));
    const assigned = new Set([...topCards, ...graveyardCards].map(card => card.instanceId));
    const unassignedTop = surveilCards.filter(card => !assigned.has(card.instanceId));
    return rebuildLibraryOrder(state, playerId, [...topCards, ...unassignedTop, ...restLibrary], graveyardCards);
  }

  // AI heuristic: lands and low-CMC spells stay on top, others go to graveyard.
  const keepOnTop: CardInstance[] = [];
  const sendToGraveyard: CardInstance[] = [];

  for (const card of surveilCards) {
    const def = getCardDefinition(state, card);
    const isLand = def.card_types.includes('land');
    const isLowCost = def.cmc <= 3;
    if (isLand || isLowCost) {
      keepOnTop.push(card);
    } else {
      sendToGraveyard.push(card);
    }
  }

  // Rebuild library: top cards first, then rest (no bottom — graveyard cards are removed)
  const newLibrary = [...keepOnTop, ...restLibrary];

  return rebuildLibraryOrder(
    state,
    playerId,
    newLibrary,
    sendToGraveyard.map(card => ({ ...card, zone: 'graveyard' as Zone })),
  );
}

type CardFilterContext = {
  state?: GameState;
  sourceInstanceId?: string;
};

function isPermanentDefinition(def: CardDefinition): boolean {
  return ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']
    .some(type => def.card_types.includes(type as any) || def.type_line.toLowerCase().includes(type));
}

/**
 * Check if a card definition matches a CardFilter.
 */
export function matchesCardFilter(def: CardDefinition, filter: CardFilter, context: CardFilterContext = {}): boolean {
  if (filter.anyOf && !filter.anyOf.some(candidate => matchesCardFilter(def, candidate, context))) {
    return false;
  }

  if (filter.names) {
    const wantedNames = filter.names.map(name => name.trim().toLowerCase());
    if (!wantedNames.includes(def.name.trim().toLowerCase())) return false;
  }

  if (filter.nameIncludes) {
    const lowerName = def.name.toLowerCase();
    const hasMatchingName = filter.nameIncludes.some(fragment =>
      lowerName.includes(fragment.trim().toLowerCase())
    );
    if (!hasMatchingName) return false;
  }

  if (filter.permanent && !isPermanentDefinition(def)) {
    return false;
  }

  // Check card types
  if (filter.types) {
    const hasMatchingType = filter.types.some(t =>
      def.card_types.includes(t as any) || def.type_line.toLowerCase().includes(t.toLowerCase())
    );
    if (!hasMatchingType) return false;
  }

  // Check subtypes
  if (filter.subtypes) {
    const typeLine = def.type_line.toLowerCase();
    const hasMatchingSubtype = filter.subtypes.some(st => typeLine.includes(st.toLowerCase()));
    if (!hasMatchingSubtype) return false;
  }

  if (filter.excludeSubtypes) {
    const typeLine = def.type_line.toLowerCase();
    const hasExcludedSubtype = filter.excludeSubtypes.some(st => typeLine.includes(st.toLowerCase()));
    if (hasExcludedSubtype) return false;
  }

  // Check supertypes (e.g., "basic")
  if (filter.supertypes) {
    const typeLine = def.type_line.toLowerCase();
    const hasMatchingSupertype = filter.supertypes.some(st => typeLine.includes(st.toLowerCase()));
    if (!hasMatchingSupertype) return false;
  }

  // Check colors
  if (filter.colors) {
    const hasMatchingColor = filter.colors.some(c => def.colors.includes(c));
    if (!hasMatchingColor) return false;
  }

  if (filter.multicolored && def.colors.length < 2) return false;

  // Check CMC
  if (filter.cmc) {
    switch (filter.cmc.op) {
      case 'eq': if (def.cmc !== filter.cmc.value) return false; break;
      case 'lte': if (def.cmc > filter.cmc.value) return false; break;
      case 'gte': if (def.cmc < filter.cmc.value) return false; break;
    }
  }

  if (filter.manaValueLessThanSourcePower) {
    if (!context.state || !context.sourceInstanceId) return false;
    if (def.cmc >= getEffectivePower(context.state, context.sourceInstanceId)) return false;
  }

  // Check printed power when no card instance is available.
  if (filter.power && !matchesNumericFilter(def.power ?? 0, filter.power)) {
    return false;
  }

  return true;
}

/**
 * Sacrifice a specific card by instance ID.
 * Moves from battlefield to graveyard (with commander replacement rule).
 */
export function executeSacrificeSpecific(state: GameState, cardInstanceId: string): GameState {
  const card = state.cards.get(cardInstanceId);
  if (!card || card.zone !== 'battlefield') return state;

  const destZone = getDeathDestination(state, cardInstanceId, card);
  if (!destZone) return state;
  const newCards = new Map(state.cards);
  newCards.set(cardInstanceId, {
    ...card,
    zone: destZone,
    tapped: false,
    damage: 0,
    counters: {},
  });

  return { ...state, cards: newCards };
}

/**
 * Sacrifice N permanents matching a filter (player choice, v0 auto-selects).
 */
function executeSacrifice(state: GameState, playerId: string, count: number, filter?: CardFilter): GameState {
  // Find matching permanents on the player's battlefield
  const candidates = getSacrificeCandidates(state, playerId, filter);

  let newState = state;
  const toSacrifice = Math.min(count, candidates.length);
  for (let i = 0; i < toSacrifice; i++) {
    newState = executeSacrificeSpecific(newState, candidates[i].instanceId);
  }

  return newState;
}

function getSacrificeCandidates(state: GameState, playerId: string, filter?: CardFilter): CardInstance[] {
  const candidates: CardInstance[] = [];
  for (const [, card] of state.cards) {
    if (card.ownerId !== playerId || card.zone !== 'battlefield') continue;
    if (filter) {
      const def = getCardDefinition(state, card);
      if (!matchesCardFilter(def, filter)) continue;
    }
    candidates.push(card);
  }
  return candidates;
}

function executeSacrificeSelfUnlessPlayerSacrifices(
  state: GameState,
  sourceInstanceId: string | undefined,
  playerId: string,
  count: number,
  filter?: CardFilter,
): GameState {
  if (!sourceInstanceId) return state;
  const candidates = getSacrificeCandidates(state, playerId, filter);
  if (candidates.length >= count && count > 0) {
    let next = state;
    for (let i = 0; i < count; i++) {
      next = executeSacrificeSpecific(next, candidates[i].instanceId);
    }
    return next;
  }
  return executeSacrificeSpecific(state, sourceInstanceId);
}

/**
 * Search a player's library for a card matching filter, move to destination.
 * V0: auto-selects first match.
 */
export function executeSearchLibrary(
  state: GameState,
  playerId: string,
  filter: CardFilter,
  destination: 'battlefield' | 'hand' | 'top' | 'graveyard',
  tapped?: boolean,
  shuffleRest: boolean = false,
  choices: {
    namedCard?: string;
    selectedCardInstanceId?: string;
    sourceInstanceId?: string;
    payLifeToEnterUntapped?: boolean;
  } = {},
): GameState {
  const candidates: CardInstance[] = [];

  for (const [, card] of state.cards) {
    if (card.ownerId !== playerId || card.zone !== 'library') continue;
    const def = getCardDefinition(state, card);
    if (matchesCardFilter(def, filter, { state, sourceInstanceId: choices.sourceInstanceId })) {
      candidates.push(card);
    }
  }

  let matchedCard: CardInstance | null = null;
  if (choices.selectedCardInstanceId) {
    matchedCard = candidates.find(card => card.instanceId === choices.selectedCardInstanceId) ?? null;
    if (!matchedCard) return state;
  }
  if (!matchedCard && choices.namedCard) {
    const wanted = choices.namedCard.trim().toLowerCase();
    matchedCard = candidates.find(card => {
      const def = getCardDefinition(state, card);
      return def.name.toLowerCase() === wanted;
    }) ?? null;
    if (!matchedCard) return state;
  }
  if (!matchedCard) {
    matchedCard = candidates[0] ?? null;
  }

  if (!matchedCard) return state; // No match found

  if (destination === 'top') {
    const libraryEntries: [string, CardInstance][] = [];
    const otherEntries: [string, CardInstance][] = [];

    for (const [id, card] of state.cards) {
      if (id === matchedCard.instanceId) continue;
      if (card.ownerId === playerId && card.zone === 'library') {
        libraryEntries.push([id, card]);
      } else {
        otherEntries.push([id, card]);
      }
    }

    const newMap = new Map<string, CardInstance>();
    for (const [id, card] of otherEntries) newMap.set(id, card);
    newMap.set(matchedCard.instanceId, {
      ...matchedCard,
      zone: 'library',
      tapped: false,
      damage: 0,
      summoningSick: true,
    });

    const remainingLibrary = [...libraryEntries];
    if (shuffleRest) {
      for (let i = remainingLibrary.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingLibrary[i], remainingLibrary[j]] = [remainingLibrary[j], remainingLibrary[i]];
      }
    }
    for (const [id, card] of remainingLibrary) newMap.set(id, card);
    return { ...state, cards: newMap };
  }

  const newCards = new Map(state.cards);
  let players = state.players;
  if (destination === 'battlefield') {
    const def = getCardDefinition(state, matchedCard);
    const entry = buildBattlefieldEntryPlan(state, playerId, matchedCard, def, {
      forceTapped: tapped === true,
      defaultTapped: tapped === true,
      payLifeToEnterUntapped: choices.payLifeToEnterUntapped,
      summoningSick: true,
    });
    newCards.set(matchedCard.instanceId, entry.card);
    players = entry.players;
  } else {
    newCards.set(matchedCard.instanceId, {
      ...matchedCard,
      zone: destination,
      tapped: false,
      summoningSick: false,
      damage: 0,
    });
  }

  const movedState = { ...state, cards: newCards, players };
  return shuffleRest ? executeShuffleLibrary(movedState, playerId) : movedState;
}

/**
 * Shuffle a player's library using Fisher-Yates.
 * Rebuilds the Map to change iteration order.
 */
export function executeShuffleLibrary(state: GameState, playerId: string): GameState {
  // Collect library cards
  const libraryCards: CardInstance[] = [];
  const otherEntries: [string, CardInstance][] = [];

  for (const [id, card] of state.cards) {
    if (card.ownerId === playerId && card.zone === 'library') {
      libraryCards.push(card);
    } else {
      otherEntries.push([id, card]);
    }
  }

  // Fisher-Yates shuffle
  for (let i = libraryCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [libraryCards[i], libraryCards[j]] = [libraryCards[j], libraryCards[i]];
  }

  // Rebuild Map with shuffled library cards re-inserted
  const newCards = new Map<string, CardInstance>();
  for (const [id, card] of otherEntries) {
    newCards.set(id, card);
  }
  for (const card of libraryCards) {
    newCards.set(card.instanceId, card);
  }

  return { ...state, cards: newCards };
}

function executePutLandFromHandOntoBattlefield(
  state: GameState,
  playerId: string,
  tapped: boolean,
  selectedCardInstanceId?: string,
): GameState {
  const chosen = selectedCardInstanceId ? state.cards.get(selectedCardInstanceId) : undefined;
  const chosenDef = chosen ? getCardDefinition(state, chosen) : undefined;
  const land = chosen && chosen.ownerId === playerId && chosen.zone === 'hand' && chosenDef?.card_types.includes('land')
    ? chosen
    : [...state.cards.values()].find(card => {
        if (card.ownerId !== playerId || card.zone !== 'hand') return false;
        const def = getCardDefinition(state, card);
        return def.card_types.includes('land');
      });
  if (!land) return state;

  const newCards = new Map(state.cards);
  const landDef = getCardDefinition(state, land);
  const entry = buildBattlefieldEntryPlan(state, playerId, land, landDef, {
    forceTapped: tapped,
    defaultTapped: tapped,
    summoningSick: false,
  });
  newCards.set(land.instanceId, entry.card);
  return { ...state, cards: newCards, players: entry.players };
}

// Token instance counter
let tokenInstanceCounter = 0;

/**
 * Execute a CreateToken effect.
 */
function executeCreateToken(
  state: GameState,
  controllerId: string,
  tokenDef: TokenDefinition,
  count: number,
  attachSourceToCreated?: string,
  eventCardInstanceId?: string,
): GameState {
  // Check for replacement effects (e.g., token doubling)
  const event: ReplacementEvent = { type: 'TokenCreated', targetId: controllerId, amount: count };
  const { event: replaced } = applyReplacements(state, event);
  if (!replaced) return state; // fully prevented
  const finalCount = replaced.amount ?? count;
  if (finalCount <= 0) return state;

  const newCards = new Map(state.cards);
  const newCardDefinitions = new Map(state.cardDefinitions);
  const createdTokenIds: string[] = [];
  const power = tokenDef.powerAmount
    ? resolveAmount(tokenDef.powerAmount, 0, state, controllerId, new Map(), undefined, eventCardInstanceId)
    : tokenDef.power;
  const toughness = tokenDef.toughnessAmount
    ? resolveAmount(tokenDef.toughnessAmount, 0, state, controllerId, new Map(), undefined, eventCardInstanceId)
    : tokenDef.toughness;

  // Create a card definition for the token if it doesn't exist
  const baseDefId = `token_${tokenDef.name.toLowerCase().replace(/\s+/g, '_')}`;
  const defId = tokenDef.powerAmount || tokenDef.toughnessAmount
    ? `${baseDefId}_${power}_${toughness}`
    : baseDefId;
  if (!newCardDefinitions.has(defId)) {
    const def: CardDefinition = {
      id: defId,
      name: tokenDef.name,
      type_line: `Token ${tokenDef.types.join(' ')}${tokenDef.subtypes ? ' — ' + tokenDef.subtypes.join(' ') : ''}`,
      oracle_text: tokenDef.abilities?.join('\n') || '',
      mana_cost: '',
      cmc: 0,
      colors: tokenDef.colors,
      color_identity: tokenDef.colors,
      keywords: tokenDef.keywords || [],
      power,
      toughness,
      card_types: tokenDef.types as any[],
    };
    newCardDefinitions.set(defId, def);
  }

  // Create token instances
  for (let i = 0; i < finalCount; i++) {
    const instanceId = `token_inst_${++tokenInstanceCounter}`;
    const instance: CardInstance = {
      instanceId,
      definitionId: defId,
      ownerId: controllerId,
      zone: 'battlefield',
      tapped: false,
      summoningSick: true,
      counters: Object.fromEntries(Object.entries(tokenDef.counters || {}).map(([counterType, amount]) => [
        counterType,
        resolveAmount(amount, 0, state, controllerId, new Map(), undefined, eventCardInstanceId),
      ])),
      damage: 0,
      isCommander: false,
      isToken: true,
    };
    newCards.set(instanceId, instance);
    createdTokenIds.push(instanceId);
  }

  let nextState: GameState = { ...state, cards: newCards, cardDefinitions: newCardDefinitions };

  if (attachSourceToCreated && createdTokenIds.length > 0) {
    const source = nextState.cards.get(attachSourceToCreated);
    if (source?.zone === 'battlefield') {
      const attachedCards = new Map(nextState.cards);
      attachedCards.set(attachSourceToCreated, { ...source, attachedTo: createdTokenIds[0] });
      nextState = { ...nextState, cards: attachedCards };
    }
  }

  if (tokenDef.types.some(type => type.toLowerCase() === 'creature')) {
    nextState = queueCreatureTokenETBTriggers(nextState, createdTokenIds, controllerId);
  }

  return nextState;
}

function executeRollD20(state: GameState, effect: Extract<Effect, { kind: 'RollD20' }>, ctx: ExecutionContext): GameState {
  const roll = Math.max(
    1,
    Math.min(20, effect.rollOverride ?? Math.floor(Math.random() * 20) + 1),
  );
  const outcome = effect.outcomes.find(o => roll >= o.min && roll <= o.max);
  if (!outcome) return state;

  const sourceCard = ctx.sourceInstanceId ? state.cards.get(ctx.sourceInstanceId) : undefined;
  const sourceDef = sourceCard ? getCardDefinition(state, sourceCard) : undefined;
  const priorRolls = state.diceRolls || [];
  const rollRecord: DiceRollRecord = {
    id: `dice_${state.turnNumber}_${priorRolls.length + 1}_${ctx.sourceInstanceId || 'effect'}_${roll}`,
    playerId: ctx.casterId,
    sourceInstanceId: ctx.sourceInstanceId,
    sourceName: sourceDef?.name,
    sides: 20,
    result: roll,
    outcomeMin: outcome.min,
    outcomeMax: outcome.max,
    turnNumber: state.turnNumber,
    phase: state.phase,
    step: state.step,
  };

  let nextState: GameState = {
    ...state,
    diceRolls: [...priorRolls, rollRecord],
  };
  for (const nestedEffect of outcome.effects) {
    nextState = executeEffect(nextState, nestedEffect, ctx);
  }
  return nextState;
}

function queueCreatureTokenETBTriggers(
  state: GameState,
  tokenIds: string[],
  tokenControllerId: string,
): GameState {
  if (tokenIds.length === 0) return state;

  const pendingTriggers: PendingTrigger[] = [...(state.pendingTriggers || [])];
  const battlefieldAbilities = state.battlefieldAbilities || new Map();

  for (const tokenId of tokenIds) {
    for (const [sourceInstanceId, abilities] of battlefieldAbilities) {
      const sourceCard = state.cards.get(sourceInstanceId);
      if (!sourceCard || sourceCard.zone !== 'battlefield') continue;
      const sourceControllerId = sourceCard.ownerId;

      for (const ability of abilities) {
        const trigger = ability.trigger;
        let shouldFire = false;

        if (
          trigger.kind === 'AnotherCreatureETB' &&
          trigger.controller === 'yours' &&
          tokenControllerId === sourceControllerId &&
          tokenId !== sourceInstanceId &&
          !trigger.nontoken &&
          (trigger.tokenOnly !== false)
        ) {
          shouldFire = true;
        }

        if (trigger.kind === 'AnyCreatureETB' && tokenId !== sourceInstanceId) {
          const controllerRestriction = trigger.controller ?? 'any';
          if (
            !trigger.nontoken &&
            trigger.tokenOnly !== false &&
            (controllerRestriction === 'any' || tokenControllerId === sourceControllerId)
          ) {
            shouldFire = true;
          }
        }

        if (shouldFire) {
          pendingTriggers.push({
            id: `trigger_token_etb_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            sourceInstanceId,
            controllerId: sourceControllerId,
            ability,
            requiredTargets: [],
          });
        }
      }
    }
  }

  return { ...state, pendingTriggers };
}

/**
 * Execute a CounterSpell effect.
 * Moves the target spell from the stack to the graveyard.
 * V0: We move the card to the graveyard if it exists on the stack.
 */
function executeCounterSpell(state: GameState, targetId: string, filter?: 'noncreature' | 'creature'): GameState {
  let targetCardInstanceId: string | undefined;
  const targetStackItem = state.stack.find(item => {
    if (!isSpellStackItem(item)) return false;
    const matches = item.cardInstanceId === targetId || item.id === targetId;
    if (matches) targetCardInstanceId = item.cardInstanceId;
    return matches;
  });
  const cardInstanceId = targetCardInstanceId ?? targetId;
  const card = state.cards.get(cardInstanceId);
  if (!card) return state;
  if (targetStackItem && isSpellStackItem(targetStackItem) && targetStackItem.cantBeCountered) return state;

  const def = getCardDefinition(state, card);
  if (filter === 'creature' && !def.card_types.includes('creature')) return state;
  if (filter === 'noncreature' && def.card_types.includes('creature')) return state;
  if (/\b(?:can'?t|cannot)\s+be\s+countered\b/i.test(def.oracle_text)) {
    return state;
  }

  const destZone = getCommanderDestinationZone(state, cardInstanceId, 'graveyard');
  const newCards = new Map(state.cards);
  newCards.set(cardInstanceId, { ...card, zone: destZone });
  const newStack = targetStackItem
    ? state.stack.filter(item => item !== targetStackItem)
    : state.stack;

  return { ...state, cards: newCards, stack: newStack };
}

/**
 * Execute a ReturnFromGraveyard effect.
 * Moves target creature card from graveyard to hand or battlefield.
 */
function executeReturnFromGraveyard(
  state: GameState,
  targetId: string,
  destination: 'hand' | 'battlefield',
): GameState {
  const card = state.cards.get(targetId);
  if (!card) return state;

  if (card.zone !== 'graveyard') return state;

  const newCards = new Map(state.cards);
  newCards.set(targetId, {
    ...card,
    zone: destination,
    tapped: false,
    damage: 0,
    counters: {},
    summoningSick: destination === 'battlefield',
  });

  return { ...state, cards: newCards };
}

/**
 * Execute a ModifyPT effect on a single creature.
 * Adjusts the creature's power/toughness via temporary counters or modifiers.
 * V0: Uses a simplistic approach of adjusting counters.
 */
function executeModifyPT(
  state: GameState,
  targetId: string,
  powerMod: number,
  toughnessMod: number,
): GameState {
  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'battlefield') return state;

  const newCards = new Map(state.cards);
  // Store P/T modifications as special counters
  // The game engine can read these to adjust effective P/T
  const currentPowerMod = card.counters['_powerMod'] || 0;
  const currentToughMod = card.counters['_toughnessMod'] || 0;

  newCards.set(targetId, {
    ...card,
    counters: {
      ...card.counters,
      '_powerMod': currentPowerMod + powerMod,
      '_toughnessMod': currentToughMod + toughnessMod,
    },
  });

  return { ...state, cards: newCards };
}

/**
 * Execute an ExileFromLibrary effect.
 * Moves the top N cards from library to exile.
 */
function executeExileFromLibrary(
  state: GameState,
  playerId: string,
  count: number,
  options: { sourceInstanceId?: string; delayedDamageEachOpponentPerCard?: number } = {},
): GameState {
  const newCards = new Map(state.cards);

  // Find cards in library
  const libraryCards: CardInstance[] = [];
  for (const [, card] of state.cards) {
    if (card.ownerId === playerId && card.zone === 'library') {
      libraryCards.push(card);
    }
  }

  const toExile = Math.min(count, libraryCards.length);
  const exiledCardIds: string[] = [];
  for (let i = 0; i < toExile; i++) {
    const card = libraryCards[i];
    exiledCardIds.push(card.instanceId);
    newCards.set(card.instanceId, { ...card, zone: 'exile' });
  }

  let nextState: GameState = { ...state, cards: newCards };
  if (options.delayedDamageEachOpponentPerCard && exiledCardIds.length > 0) {
    nextState = {
      ...nextState,
      delayedTriggers: [
        ...(nextState.delayedTriggers || []),
        {
          id: `delayed_dragonhawk_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          sourceInstanceId: options.sourceInstanceId,
          controllerId: playerId,
          trigger: { kind: 'EndStep', whose: 'yours' },
          effects: [
            {
              kind: 'DealDamageForExiledCards',
              target: { kind: 'EachOpponent' },
              exiledCardIds,
              amountPerCard: options.delayedDamageEachOpponentPerCard,
            },
          ],
          oneShot: true,
        },
      ],
    };
  }

  return pruneDetachedEffects(nextState);
}

function executeExileUntilNamed(
  state: GameState,
  playerId: string,
  namedCard: string,
  foundDestination: 'hand' | 'exile',
  exileBeforeSearch: number = 0,
): GameState {
  const newCards = new Map(state.cards);
  const libraryCards = [...state.cards.values()].filter(card =>
    card.ownerId === playerId && card.zone === 'library'
  );
  const targetName = namedCard.toLowerCase();

  let index = 0;
  for (; index < Math.min(exileBeforeSearch, libraryCards.length); index++) {
    const card = libraryCards[index];
    newCards.set(card.instanceId, { ...card, zone: 'exile' });
  }

  for (; index < libraryCards.length; index++) {
    const card = libraryCards[index];
    const def = getCardDefinition(state, card);
    const isNamed = def.name.toLowerCase() === targetName;
    newCards.set(card.instanceId, {
      ...card,
      zone: isNamed ? foundDestination : 'exile',
    });
    if (isNamed) break;
  }

  return { ...state, cards: newCards };
}

/**
 * Execute a GainControl effect.
 * Changes the ownerId of the target permanent to the new controller.
 */
function executeGainControl(state: GameState, targetId: string, newControllerId: string): GameState {
  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'battlefield') return state;

  const newCards = new Map(state.cards);
  newCards.set(targetId, { ...card, ownerId: newControllerId });

  return { ...state, cards: newCards };
}

// ============================================================================
// Phase 17: Conditional effect evaluation
// ============================================================================

/**
 * Evaluate a condition against the current game state.
 */
function evaluateCondition(state: GameState, condition: Condition, casterId: string): boolean {
  switch (condition.kind) {
    case 'ControlsType': {
      const playerId = condition.controller === 'you' ? casterId : undefined;
      for (const [, card] of state.cards) {
        if (card.zone !== 'battlefield') continue;
        if (playerId && card.ownerId !== playerId) continue;
        if (!playerId) {
          // opponent
          if (card.ownerId === casterId) continue;
        }
        const def = getCardDefinition(state, card);
        if (matchesCardFilter(def, condition.filter)) return true;
      }
      return false;
    }
    case 'ControlsMoreThan': {
      let opponentCount = 0;
      let yourCount = 0;
      for (const [, card] of state.cards) {
        if (card.zone !== 'battlefield') continue;
        const def = getCardDefinition(state, card);
        if (!matchesCardFilter(def, condition.what)) continue;
        if (card.ownerId === casterId) yourCount++;
        else opponentCount++;
      }
      return opponentCount > yourCount;
    }
    case 'LifeAtOrBelow': {
      const player = condition.controller === 'you'
        ? state.players.find(p => p.id === casterId)
        : state.players.find(p => p.id !== casterId && !p.hasLost);
      return player ? player.life <= condition.amount : false;
    }
    case 'LifeAtOrAbove': {
      const player = condition.controller === 'you'
        ? state.players.find(p => p.id === casterId)
        : state.players.find(p => p.id !== casterId && !p.hasLost);
      return player ? player.life >= condition.amount : false;
    }
    default: {
      const _never: never = condition;
      return false;
    }
  }
}

// ============================================================================
// Phase 16: Blink, Copy, GrantKeyword, PhaseOut executors
// ============================================================================

/**
 * Blink: exile then immediately return to battlefield (triggers ETB again).
 * The card stays on the battlefield but resets all state (untapped, no damage, no counters).
 * In a full implementation, this would create a new object identity for triggers,
 * but for our engine we reset all transient state.
 */
function executeBlink(state: GameState, targetId: string): GameState {
  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'battlefield') return state;

  const newCards = new Map(state.cards);
  // Return to battlefield fresh (untapped, no damage, no counters, summoning sick, no granted keywords)
  newCards.set(targetId, {
    ...card,
    zone: 'battlefield',
    tapped: false,
    damage: 0,
    counters: {},
    summoningSick: true,
    grantedKeywords: undefined,
    phasedOut: undefined,
  });

  return { ...state, cards: newCards };
}

/**
 * Copy: create a token that's a copy of target creature (simplified).
 * Creates a new CardInstance that references the same CardDefinition as the target.
 * The copy is marked as a token.
 */
function executeCopy(state: GameState, targetId: string, controllerId: string): GameState {
  const card = state.cards.get(targetId);
  if (!card) return state;

  // Create a token copy with a fresh instance ID
  const copyId = `copy_${++tokenInstanceCounter}`;
  const newCards = new Map(state.cards);
  newCards.set(copyId, {
    instanceId: copyId,
    definitionId: card.definitionId,
    ownerId: controllerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: true,
    counters: {},
    damage: 0,
    isCommander: false,
    isToken: true,
    copiedFromDefinitionId: card.definitionId,
  });

  return { ...state, cards: newCards };
}

/**
 * Grant a keyword ability to a creature.
 * Adds the keyword to grantedKeywords array on the CardInstance.
 * For "until end of turn" effects, the cleanup step should clear grantedKeywords.
 */
function executeGrantKeyword(state: GameState, targetId: string, keyword: string): GameState {
  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'battlefield') return state;

  const newCards = new Map(state.cards);
  const currentGranted = card.grantedKeywords || [];
  // Don't add duplicates
  if (!currentGranted.includes(keyword)) {
    newCards.set(targetId, {
      ...card,
      grantedKeywords: [...currentGranted, keyword],
    });
  } else {
    // Already has the keyword, no-op
    return state;
  }

  return { ...state, cards: newCards };
}

/**
 * Phase out a permanent.
 * Sets phasedOut flag; the permanent stays on the battlefield but is treated as not existing.
 * In the untap step, phased-out permanents phase back in.
 */
function executePhaseOut(state: GameState, targetId: string): GameState {
  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'battlefield') return state;

  const newCards = new Map(state.cards);
  newCards.set(targetId, { ...card, phasedOut: true });

  return { ...state, cards: newCards };
}

// ============================================================================
// Phase 17: Loyalty ability executor
// ============================================================================

/**
 * Execute a loyalty ability on a planeswalker.
 * Adjusts loyalty counters, then executes the effects.
 * If loyalty reaches 0, SBA will handle destruction.
 */
export function executeLoyaltyAbility(
  state: GameState,
  planeswalkerInstanceId: string,
  ability: LoyaltyAbility,
  controllerId: string,
  chosenTargetIds: string[] = [],
): GameState {
  const card = state.cards.get(planeswalkerInstanceId);
  if (!card || card.zone !== 'battlefield') return state;

  // Adjust loyalty counters
  const currentLoyalty = card.counters['loyalty'] || 0;
  const newLoyalty = currentLoyalty + ability.loyaltyCost;

  // Cannot activate if loyalty would go below 0 from a negative cost
  if (newLoyalty < 0) return state;

  const newCards = new Map(state.cards);
  newCards.set(planeswalkerInstanceId, {
    ...card,
    counters: { ...card.counters, loyalty: newLoyalty },
  });
  let newState = { ...state, cards: newCards };

  // Execute the ability's effects
  const targetSpecs = ability.targets;
  newState = executeEffects(
    newState,
    ability.effects,
    controllerId,
    chosenTargetIds,
    targetSpecs,
  );

  // Check SBA (planeswalker with 0 loyalty dies)
  newState = checkStateBasedActions(newState);

  return newState;
}

/**
 * Execute a single effect.
 */
function executeEffect(
  state: GameState,
  effect: Effect,
  ctx: ExecutionContext,
): GameState {
  const { casterId, chosenTargets, xValue, namedCardChoices, sourceInstanceId, eventContext } = ctx;

  switch (effect.kind) {
    case 'Draw': {
      // Handle EachPlayer and EachOpponent
      if (effect.player.kind === 'EachPlayer') {
        const count = resolveAmount(effect.count, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (!p.hasLost) {
            s = executeDraw(s, p.id, count);
          }
        }
        return s;
      }
      if (effect.player.kind === 'EachOpponent') {
        const count = resolveAmount(effect.count, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (p.id !== casterId && !p.hasLost) {
            s = executeDraw(s, p.id, count);
          }
        }
        return s;
      }
      const drawPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      const drawCount = resolveAmount(effect.count, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId);
      return executeDraw(state, drawPlayerId, drawCount);
    }
    case 'Destroy': {
      if (effect.target.kind === 'AllCreatures') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone === 'battlefield') {
            if (isEffectiveCreature(s, card.instanceId)) {
              s = executeDestroy(s, card.instanceId);
            }
          }
        }
        return s;
      }
      // AllOfType: destroy all permanents matching filter
      if (effect.target.kind === 'AllOfType') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone === 'battlefield') {
            const def = getCardDefinition(state, card);
            if (matchesCardFilter(def, effect.target.filter)) {
              s = executeDestroy(s, card.instanceId);
            }
          }
        }
        return s;
      }
      const destroyTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeDestroy(state, destroyTargetId);
    }
    case 'DealDamage': {
      if (effect.target.kind === 'EachOpponent') {
        const dmgAmount = resolveAmount(effect.amount, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (p.id !== casterId && !p.hasLost) {
            s = executeDealDamage(s, p.id, dmgAmount, sourceInstanceId);
          }
        }
        return s;
      }
      const dmgTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      const dmgAmount = resolveAmount(effect.amount, xValue, state, casterId);
      return executeDealDamage(state, dmgTargetId, dmgAmount, sourceInstanceId);
    }
    case 'DealDamageForExiledCards': {
      const stillExiled = effect.exiledCardIds.filter(cardId => state.cards.get(cardId)?.zone === 'exile').length;
      const amount = stillExiled * effect.amountPerCard;
      if (amount <= 0) return state;
      if (effect.target.kind === 'EachOpponent') {
        let s = state;
        for (const p of state.players) {
          if (p.id !== casterId && !p.hasLost) {
            s = executeDealDamage(s, p.id, amount, sourceInstanceId);
          }
        }
        return s;
      }
      const targetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeDealDamage(state, targetId, amount, sourceInstanceId);
    }
    case 'PreventDamage': {
      return executePreventDamage(state, effect, casterId, sourceInstanceId, xValue, chosenTargets);
    }
    case 'GainLife': {
      if (effect.player.kind === 'EachPlayer') {
        const glAmount = resolveAmount(effect.amount, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (!p.hasLost) {
            s = executeGainLife(s, p.id, glAmount);
          }
        }
        return s;
      }
      const glPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const glAmt = resolveAmount(effect.amount, xValue, state, casterId);
      return executeGainLife(state, glPlayerId, glAmt);
    }
    case 'LoseLife': {
      if (effect.player.kind === 'EachOpponent') {
        const llAmount = resolveAmount(effect.amount, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (p.id !== casterId && !p.hasLost) {
            s = executeLoseLife(s, p.id, llAmount);
          }
        }
        return s;
      }
      if (effect.player.kind === 'EachPlayer') {
        const llAmount = resolveAmount(effect.amount, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (!p.hasLost) {
            s = executeLoseLife(s, p.id, llAmount);
          }
        }
        return s;
      }
      const llPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const llAmt = resolveAmount(effect.amount, xValue, state, casterId);
      return executeLoseLife(state, llPlayerId, llAmt);
    }
    case 'Exile': {
      // AllOfType: exile all permanents matching filter
      if (effect.target.kind === 'AllOfType') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone === 'battlefield') {
            const def = getCardDefinition(state, card);
            if (matchesCardFilter(def, effect.target.filter)) {
              s = executeExile(s, card.instanceId);
            }
          }
        }
        return s;
      }
      const exileTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeExile(state, exileTargetId);
    }
    case 'PutIntoLibrary': {
      const libraryTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executePutIntoLibrary(state, libraryTargetId, effect.position);
    }
    case 'ReturnToHand': {
      if (effect.target.kind === 'AllAttackingCreatures') {
        let s = state;
        for (const attacker of state.combat?.attackers || []) {
          s = executeReturnToHand(s, attacker.cardInstanceId);
        }
        return s;
      }
      // AllOfType: return all matching permanents
      if (effect.target.kind === 'AllOfType') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone === 'battlefield') {
            const def = getCardDefinition(state, card);
            if (matchesCardFilter(def, effect.target.filter)) {
              s = executeReturnToHand(s, card.instanceId);
            }
          }
        }
        return s;
      }
      const bounceTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeReturnToHand(state, bounceTargetId);
    }
    case 'Sacrifice': {
      // Handle EachOpponent and EachPlayer sacrifice
      if (effect.player.kind === 'EachOpponent') {
        const sacCount = resolveAmount(effect.count, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (p.id !== casterId && !p.hasLost) {
            s = executeSacrifice(s, p.id, sacCount, effect.filter);
          }
        }
        return s;
      }
      if (effect.player.kind === 'EachPlayer') {
        const sacCount = resolveAmount(effect.count, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (!p.hasLost) {
            s = executeSacrifice(s, p.id, sacCount, effect.filter);
          }
        }
        return s;
      }
      const sacrificePlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const sacrificeCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeSacrifice(state, sacrificePlayerId, sacrificeCount, effect.filter);
    }
    case 'SacrificeSelfUnlessPlayerSacrifices': {
      const sacrificePlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const sacrificeCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeSacrificeSelfUnlessPlayerSacrifices(
        state,
        sourceInstanceId,
        sacrificePlayerId,
        sacrificeCount,
        effect.filter,
      );
    }
    case 'Mill': {
      const millPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const millCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeMill(state, millPlayerId, millCount);
    }
    case 'AddCounters': {
      const acTargetId = effect.target.kind === 'Source'
        ? sourceInstanceId
        : resolveTargetRef(effect.target, casterId, chosenTargets);
      if (!acTargetId) return state;
      const acCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeAddCounters(state, acTargetId, effect.counterType, acCount);
    }
    case 'RemoveCounters': {
      const rcTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      const rcCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeRemoveCounters(state, rcTargetId, effect.counterType, rcCount);
    }
    case 'Tap': {
      const tapTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeTap(state, tapTargetId);
    }
    case 'Untap': {
      if (effect.target.kind === 'AllOfType') {
        const maxCount = effect.maxCount === undefined
          ? undefined
          : resolveAmount(effect.maxCount, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId);
        return executeUntapAllOfType(state, effect.target.filter, maxCount);
      }
      const untapTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeUntap(state, untapTargetId);
    }
    case 'CreateToken': {
      const ctControllerId = resolveTargetRef(effect.controller, casterId, chosenTargets, state, eventContext);
      const ctCount = resolveAmount(effect.count, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId);
      return executeCreateToken(
        state,
        ctControllerId,
        effect.token,
        ctCount,
        effect.attachSourceToCreated ? sourceInstanceId : undefined,
        eventContext?.cardInstanceId,
      );
    }
    case 'RollD20': {
      return executeRollD20(state, effect, ctx);
    }
    case 'Discard': {
      if (effect.player.kind === 'EachOpponent') {
        const dcCount = resolveAmount(effect.count, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (p.id !== casterId && !p.hasLost) {
            s = executeDiscard(s, p.id, dcCount, effect.random);
          }
        }
        return s;
      }
      if (effect.player.kind === 'EachPlayer') {
        const dcCount = resolveAmount(effect.count, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (!p.hasLost) {
            s = executeDiscard(s, p.id, dcCount, effect.random);
          }
        }
        return s;
      }
      const dcPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const dcCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeDiscard(state, dcPlayerId, dcCount, effect.random);
    }
    case 'Scry': {
      const scryPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const scryCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeScry(state, scryPlayerId, scryCount, namedCardChoices);
    }
    case 'Surveil': {
      const surveilPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const surveilCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeSurveil(state, surveilPlayerId, surveilCount, namedCardChoices);
    }
    case 'LookAtHand':
      resolveTargetRef(effect.player, casterId, chosenTargets);
      return state;
    case 'SearchLibrary': {
      const slPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const namedCardChoiceId = effect.namedCardChoiceId ?? 'tutorCard';
      const selectedCardChoiceId = effect.selectedCardChoiceId ?? 'tutorCardId';
      return executeSearchLibrary(state, slPlayerId, effect.filter, effect.destination, effect.tapped, effect.shuffle, {
        namedCard: namedCardChoices.get(namedCardChoiceId)
          || namedCardChoices.get('tutorCard')
          || namedCardChoices.get('namedCard')
          || namedCardChoices.get('cardName'),
        selectedCardInstanceId: namedCardChoices.get(selectedCardChoiceId)
          || namedCardChoices.get('tutorCardId')
          || namedCardChoices.get('selectedCardId'),
        sourceInstanceId,
      });
    }
    case 'ShuffleLibrary': {
      const shPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      return executeShuffleLibrary(state, shPlayerId);
    }
    case 'CounterSpell': {
      const csTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeCounterSpell(state, csTargetId, effect.filter);
    }
    case 'ReturnFromGraveyard': {
      const rfgTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeReturnFromGraveyard(state, rfgTargetId, effect.destination);
    }
    case 'ModifyPT': {
      if (effect.target.kind === 'AllCreaturesYouControl') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone === 'battlefield' && card.ownerId === casterId) {
            if (isEffectiveCreature(s, card.instanceId)) {
              const power = resolveAmount(effect.power, xValue, s, casterId, chosenTargets, card.instanceId);
              const toughness = resolveAmount(effect.toughness, xValue, s, casterId, chosenTargets, card.instanceId);
              s = executeModifyPT(s, card.instanceId, power, toughness);
            }
          }
        }
        return s;
      }
      if (effect.target.kind === 'Source') {
        if (!sourceInstanceId) return state;
        const power = resolveAmount(effect.power, xValue, state, casterId, chosenTargets, sourceInstanceId);
        const toughness = resolveAmount(effect.toughness, xValue, state, casterId, chosenTargets, sourceInstanceId);
        return executeModifyPT(state, sourceInstanceId, power, toughness);
      }
      const mptTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      const power = resolveAmount(effect.power, xValue, state, casterId, chosenTargets, mptTargetId);
      const toughness = resolveAmount(effect.toughness, xValue, state, casterId, chosenTargets, mptTargetId);
      return executeModifyPT(state, mptTargetId, power, toughness);
    }
    case 'ExileFromLibrary': {
      const eflPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const eflCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeExileFromLibrary(state, eflPlayerId, eflCount, {
        sourceInstanceId,
        delayedDamageEachOpponentPerCard: effect.delayedDamageEachOpponentPerCard,
      });
    }
    case 'ExileUntilNamed': {
      const eunPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const namedCard = resolveNamedCardChoice(effect, namedCardChoices);
      return executeExileUntilNamed(
        state,
        eunPlayerId,
        namedCard,
        effect.foundDestination,
        effect.exileBeforeSearch,
      );
    }
    case 'GainControl': {
      const gcTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeGainControl(state, gcTargetId, casterId);
    }
    // Phase 17: Conditional effects
    case 'Conditional': {
      if (evaluateCondition(state, effect.condition, casterId)) {
        return executeEffect(state, effect.effect, ctx);
      } else if (effect.elseEffect) {
        return executeEffect(state, effect.elseEffect, ctx);
      }
      return state;
    }
    // Phase 16: Blink — exile then return to battlefield
    case 'Blink': {
      const blinkTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeBlink(state, blinkTargetId);
    }
    // Phase 16: Copy — create token copy (simplified)
    case 'Copy': {
      const copyTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeCopy(state, copyTargetId, casterId);
    }
    case 'CopySpell':
      // Spell-copy stack manipulation is handled by stack resolution so the
      // copied spell can keep its own targets and trigger magecraft correctly.
      return state;
    // Phase 16: GrantKeyword — give keyword to creature
    case 'GrantKeyword': {
      const gkTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeGrantKeyword(state, gkTargetId, effect.keyword);
    }
    // Phase 16: PhaseOut
    case 'PhaseOut': {
      const poTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executePhaseOut(state, poTargetId);
    }
    // WinGame: all other players lose
    case 'WinGame': {
      const winnerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const newPlayers = state.players.map(p =>
        p.id !== winnerId ? { ...p, hasLost: true } : p
      );
      return { ...state, players: newPlayers };
    }
    // LoseGame: the specified player loses
    case 'LoseGame': {
      const loserId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const newPlayers = state.players.map(p =>
        p.id === loserId ? { ...p, hasLost: true } : p
      );
      return { ...state, players: newPlayers };
    }
    // AddMana: add mana to a player's pool
    case 'AddMana': {
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      const playerIdx = state.players.findIndex(p => p.id === playerId);
      if (playerIdx === -1) return state;
      const player = state.players[playerIdx];
      const newPool = { ...player.manaPool };
      for (const [color, amount] of Object.entries(effect.mana)) {
        if (amount && amount > 0) {
          newPool[color as keyof typeof newPool] += amount;
        }
      }
      const newPlayers = state.players.map((p, i) =>
        i === playerIdx ? { ...p, manaPool: newPool } : p
      );
      return { ...state, players: newPlayers };
    }
    case 'PutLandFromHandOntoBattlefield': {
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      const selectedId = namedCardChoices.get(effect.selectedCardChoiceId ?? 'putLandCardId')
        || namedCardChoices.get('selectedCardId');
      return executePutLandFromHandOntoBattlefield(state, playerId, effect.tapped ?? false, selectedId);
    }
    default:
      // Exhaustiveness
      const _never: never = effect;
      throw new Error(`Unknown effect kind`);
  }
}

/**
 * Execute a list of effects in order.
 * Returns the updated GameState.
 */
export function executeEffects(
  state: GameState,
  effects: Effect[],
  casterId: string,
  chosenTargetIds: string[],
  targetSpecs: { id: string }[],
  xValue: number = 0,
  options: EffectExecutionOptions = {},
): GameState {
  // Build a map from spec ID to chosen target ID
  const chosenTargets = new Map<string, string>();
  for (let i = 0; i < targetSpecs.length && i < chosenTargetIds.length; i++) {
    chosenTargets.set(targetSpecs[i].id, chosenTargetIds[i]);
  }

  const ctx: ExecutionContext = {
    casterId,
    chosenTargets,
    xValue,
    namedCardChoices: new Map(Object.entries(options.namedCardChoices || {})),
    sourceInstanceId: options.sourceInstanceId,
    eventContext: options.eventContext,
  };

  let newState = state;
  for (const effect of effects) {
    newState = executeEffect(newState, effect, ctx);
  }

  return newState;
}

/**
 * Execute effects and then check state-based actions.
 * This is the main entry point for spell resolution.
 */
export function executeEffectsWithSBA(
  state: GameState,
  effects: Effect[],
  casterId: string,
  chosenTargetIds: string[],
  targetSpecs: { id: string }[],
  xValue: number = 0,
  options: EffectExecutionOptions = {},
): GameState {
  let newState = executeEffects(state, effects, casterId, chosenTargetIds, targetSpecs, xValue, options);
  newState = checkStateBasedActions(newState);
  return newState;
}

/**
 * Reset token counter (for testing).
 */
export function resetTokenCounter(): void {
  tokenInstanceCounter = 0;
}
