// Phase 4: Effect executor - applies Effect AST to GameState
// Phase 10: Extended with new effect types, X costs, tokens

import type { GameState, CardInstance, CardDefinition } from '../types';
import type { Effect, TargetRef, AmountRef, TokenDefinition, CardFilter } from './ast';
import { checkStateBasedActions, markPlayerLostFromEmptyLibrary } from '../state-based';
import { isIndestructible } from '../keywords';
import { getCommanderDestinationZone } from '../commander';
import { applyReplacements } from './replacement';
import type { ReplacementEvent } from './replacement';

/**
 * Context for effect execution, includes X value from spell casting.
 */
export interface ExecutionContext {
  casterId: string;
  chosenTargets: Map<string, string>;
  xValue: number;
}

/**
 * Resolve an AmountRef to a concrete number.
 */
function resolveAmount(amount: AmountRef, xValue: number): number {
  if (typeof amount === 'number') {
    return amount;
  }
  if (amount.kind === 'X') {
    return xValue;
  }
  if (amount.kind === 'XMultiplied') {
    return xValue * amount.multiplier;
  }
  // Exhaustiveness
  const _never: never = amount;
  throw new Error(`Unknown AmountRef kind`);
}

/**
 * Resolve a TargetRef to a concrete ID or IDs.
 * For 'Controller', we need the caster's ID.
 */
function resolveTargetRef(
  ref: TargetRef,
  casterId: string,
  chosenTargets: Map<string, string>,
): string {
  switch (ref.kind) {
    case 'Chosen':
      const chosen = chosenTargets.get(ref.targetId);
      if (!chosen) {
        throw new Error(`Missing chosen target for ${ref.targetId}`);
      }
      return chosen;
    case 'Controller':
      return casterId;
    case 'Player':
      return ref.playerId;
    case 'EachOpponent':
      throw new Error('EachOpponent must be handled before calling resolveTargetRef');
    case 'AllCreatures':
      throw new Error('AllCreatures must be handled before calling resolveTargetRef');
    default:
      // Exhaustiveness check
      const _never: never = ref;
      throw new Error(`Unknown TargetRef kind`);
  }
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
      // Attempting to draw from empty library - player loses
      currentState = markPlayerLostFromEmptyLibrary(currentState, playerId);
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

  const destZone = getCommanderDestinationZone(state, targetId, 'graveyard');
  const newCards = new Map(state.cards);
  newCards.set(targetId, { ...card, zone: destZone });

  return { ...state, cards: newCards };
}

/**
 * Execute a DealDamage effect.
 */
function executeDealDamage(state: GameState, targetId: string, amount: number): GameState {
  // Check for replacement effects (e.g., damage prevention)
  const event: ReplacementEvent = { type: 'DamageDealt', targetId, amount };
  const { event: replaced } = applyReplacements(state, event);
  if (!replaced) return state; // fully prevented
  const finalAmount = replaced.amount ?? amount;
  if (finalAmount <= 0) return state;

  // Check if target is a player
  const playerIndex = state.players.findIndex(p => p.id === targetId);
  if (playerIndex !== -1) {
    const newPlayers = state.players.map((p, i) =>
      i === playerIndex ? { ...p, life: p.life - finalAmount } : p
    );
    return { ...state, players: newPlayers };
  }

  // Target is a card (creature)
  const card = state.cards.get(targetId);
  if (!card) {
    // Target no longer exists (fizzle)
    return state;
  }

  if (card.zone !== 'battlefield') {
    // Can only damage things on battlefield
    return state;
  }

  const newCards = new Map(state.cards);
  newCards.set(targetId, { ...card, damage: card.damage + finalAmount });

  return { ...state, cards: newCards };
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

  return { ...state, cards: newCards };
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

  return { ...state, cards: newCards };
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

/**
 * Execute a Scry effect.
 * Uses AI heuristic: keeps lands and low-CMC spells on top, sends expensive spells to bottom.
 */
function executeScry(state: GameState, playerId: string, count: number): GameState {
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

  // AI heuristic: evaluate each card by CMC relative to current game state.
  // Keep lands and low-CMC spells on top early, expensive spells on bottom.
  // Simple rule: cards with CMC <= 3 or lands stay on top, others go to bottom.
  const keepOnTop: CardInstance[] = [];
  const sendToBottom: CardInstance[] = [];

  for (const card of scryCards) {
    const def = state.cardDefinitions.get(card.definitionId);
    if (!def) {
      keepOnTop.push(card); // Unknown = keep
      continue;
    }
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

  // Rebuild cards map preserving non-library entries, then re-add library in new order
  const nonLibraryEntries: [string, CardInstance][] = [];
  for (const [id, card] of state.cards) {
    if (card.ownerId !== playerId || card.zone !== 'library') {
      nonLibraryEntries.push([id, card]);
    }
  }

  const newCards = new Map<string, CardInstance>();
  for (const [id, card] of nonLibraryEntries) {
    newCards.set(id, card);
  }
  for (const card of newLibrary) {
    newCards.set(card.instanceId, card);
  }

  return { ...state, cards: newCards };
}

/**
 * Check if a card definition matches a CardFilter.
 */
export function matchesCardFilter(def: CardDefinition, filter: CardFilter): boolean {
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

  // Check CMC
  if (filter.cmc) {
    switch (filter.cmc.op) {
      case 'eq': if (def.cmc !== filter.cmc.value) return false; break;
      case 'lte': if (def.cmc > filter.cmc.value) return false; break;
      case 'gte': if (def.cmc < filter.cmc.value) return false; break;
    }
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

  const destZone = getCommanderDestinationZone(state, cardInstanceId, 'graveyard');
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
  const candidates: CardInstance[] = [];
  for (const [, card] of state.cards) {
    if (card.ownerId !== playerId || card.zone !== 'battlefield') continue;
    if (filter) {
      const def = state.cardDefinitions.get(card.definitionId);
      if (!def || !matchesCardFilter(def, filter)) continue;
    }
    candidates.push(card);
  }

  let newState = state;
  const toSacrifice = Math.min(count, candidates.length);
  for (let i = 0; i < toSacrifice; i++) {
    newState = executeSacrificeSpecific(newState, candidates[i].instanceId);
  }

  return newState;
}

/**
 * Search a player's library for a card matching filter, move to destination.
 * V0: auto-selects first match.
 */
export function executeSearchLibrary(
  state: GameState,
  playerId: string,
  filter: CardFilter,
  destination: 'battlefield' | 'hand' | 'graveyard',
  tapped?: boolean,
): GameState {
  // Find first matching card in library
  let matchedCard: CardInstance | null = null;

  for (const [, card] of state.cards) {
    if (card.ownerId !== playerId || card.zone !== 'library') continue;
    const def = state.cardDefinitions.get(card.definitionId);
    if (!def) continue;
    if (matchesCardFilter(def, filter)) {
      matchedCard = card;
      break;
    }
  }

  if (!matchedCard) return state; // No match found

  const newCards = new Map(state.cards);
  newCards.set(matchedCard.instanceId, {
    ...matchedCard,
    zone: destination,
    tapped: destination === 'battlefield' ? (tapped ?? false) : false,
    summoningSick: destination === 'battlefield',
    damage: 0,
  });

  return { ...state, cards: newCards };
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
): GameState {
  // Check for replacement effects (e.g., token doubling)
  const event: ReplacementEvent = { type: 'TokenCreated', targetId: controllerId, amount: count };
  const { event: replaced } = applyReplacements(state, event);
  if (!replaced) return state; // fully prevented
  const finalCount = replaced.amount ?? count;
  if (finalCount <= 0) return state;

  const newCards = new Map(state.cards);
  const newCardDefinitions = new Map(state.cardDefinitions);

  // Create a card definition for the token if it doesn't exist
  const defId = `token_${tokenDef.name.toLowerCase().replace(/\s+/g, '_')}`;
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
      power: tokenDef.power,
      toughness: tokenDef.toughness,
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
      counters: {},
      damage: 0,
      isCommander: false,
    };
    newCards.set(instanceId, instance);
  }

  return { ...state, cards: newCards, cardDefinitions: newCardDefinitions };
}

/**
 * Execute a single effect.
 */
function executeEffect(
  state: GameState,
  effect: Effect,
  ctx: ExecutionContext,
): GameState {
  const { casterId, chosenTargets, xValue } = ctx;

  switch (effect.kind) {
    case 'Draw': {
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const count = resolveAmount(effect.count, xValue);
      return executeDraw(state, playerId, count);
    }
    case 'Destroy': {
      if (effect.target.kind === 'AllCreatures') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone === 'battlefield') {
            const def = state.cardDefinitions.get(card.definitionId);
            if (def && def.card_types.includes('creature')) {
              s = executeDestroy(s, card.instanceId);
            }
          }
        }
        return s;
      }
      const targetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeDestroy(state, targetId);
    }
    case 'DealDamage': {
      const targetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      const amount = resolveAmount(effect.amount, xValue);
      return executeDealDamage(state, targetId, amount);
    }
    case 'GainLife': {
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const amount = resolveAmount(effect.amount, xValue);
      return executeGainLife(state, playerId, amount);
    }
    case 'LoseLife': {
      if (effect.player.kind === 'EachOpponent') {
        const amount = resolveAmount(effect.amount, xValue);
        let s = state;
        for (const p of state.players) {
          if (p.id !== casterId && !p.hasLost) {
            s = executeLoseLife(s, p.id, amount);
          }
        }
        return s;
      }
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const amount = resolveAmount(effect.amount, xValue);
      return executeLoseLife(state, playerId, amount);
    }
    case 'Exile': {
      const targetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeExile(state, targetId);
    }
    case 'ReturnToHand': {
      const targetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeReturnToHand(state, targetId);
    }
    case 'Sacrifice': {
      // Sacrifice N permanents matching filter (player choice).
      // V0: auto-selects first matching permanent(s).
      const sacrificePlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const sacrificeCount = resolveAmount(effect.count, xValue);
      return executeSacrifice(state, sacrificePlayerId, sacrificeCount, effect.filter);
    }
    case 'Mill': {
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const count = resolveAmount(effect.count, xValue);
      return executeMill(state, playerId, count);
    }
    case 'AddCounters': {
      const targetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      const count = resolveAmount(effect.count, xValue);
      return executeAddCounters(state, targetId, effect.counterType, count);
    }
    case 'RemoveCounters': {
      const targetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      const count = resolveAmount(effect.count, xValue);
      return executeRemoveCounters(state, targetId, effect.counterType, count);
    }
    case 'Tap': {
      const targetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeTap(state, targetId);
    }
    case 'Untap': {
      const targetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeUntap(state, targetId);
    }
    case 'CreateToken': {
      const controllerId = resolveTargetRef(effect.controller, casterId, chosenTargets);
      const count = resolveAmount(effect.count, xValue);
      return executeCreateToken(state, controllerId, effect.token, count);
    }
    case 'Discard': {
      if (effect.player.kind === 'EachOpponent') {
        const count = resolveAmount(effect.count, xValue);
        let s = state;
        for (const p of state.players) {
          if (p.id !== casterId && !p.hasLost) {
            s = executeDiscard(s, p.id, count, effect.random);
          }
        }
        return s;
      }
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const count = resolveAmount(effect.count, xValue);
      return executeDiscard(state, playerId, count, effect.random);
    }
    case 'Scry': {
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const count = resolveAmount(effect.count, xValue);
      return executeScry(state, playerId, count);
    }
    case 'SearchLibrary': {
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      return executeSearchLibrary(state, playerId, effect.filter, effect.destination, effect.tapped);
    }
    case 'ShuffleLibrary': {
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      return executeShuffleLibrary(state, playerId);
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
): GameState {
  let newState = executeEffects(state, effects, casterId, chosenTargetIds, targetSpecs, xValue);
  newState = checkStateBasedActions(newState);
  return newState;
}

/**
 * Reset token counter (for testing).
 */
export function resetTokenCounter(): void {
  tokenInstanceCounter = 0;
}
