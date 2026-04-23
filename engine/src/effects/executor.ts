// Phase 4: Effect executor - applies Effect AST to GameState
// Phase 10: Extended with new effect types, X costs, tokens
// Phase 14: Extended with ExileFromLibrary, GainControl, ForEach, EachPlayer, AllOfType
// Phase 17: Conditional, Blink, Copy, GrantKeyword, PhaseOut, loyalty ability execution

import type { GameState, CardInstance, CardDefinition } from '../types';
import type { Effect, TargetRef, AmountRef, TokenDefinition, CardFilter, SurveilEffect, ForEachAmount, Condition, LoyaltyAbility } from './ast';
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
 * For ForEach amounts, we need the full game state and caster.
 */
function resolveAmount(amount: AmountRef, xValue: number, state?: GameState, casterId?: string): number {
  if (typeof amount === 'number') {
    return amount;
  }
  if (amount.kind === 'X') {
    return xValue;
  }
  if (amount.kind === 'XMultiplied') {
    return xValue * amount.multiplier;
  }
  if (amount.kind === 'ForEach') {
    return resolveForEachCount(amount, state, casterId);
  }
  // Exhaustiveness
  const _never: never = amount;
  throw new Error(`Unknown AmountRef kind`);
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

  // Determine which player(s) we're counting for
  const playerIds: string[] = [];
  if (controller === 'you') {
    playerIds.push(casterId);
  } else if (controller === 'opponent') {
    for (const p of state.players) {
      if (p.id !== casterId && !p.hasLost) {
        playerIds.push(p.id);
      }
    }
  } else if (controller === 'each') {
    for (const p of state.players) {
      if (!p.hasLost) {
        playerIds.push(p.id);
      }
    }
  }

  for (const [, card] of state.cards) {
    if (card.zone !== zone) continue;
    if (!playerIds.includes(card.ownerId)) continue;

    if (filter) {
      const def = state.cardDefinitions.get(card.definitionId);
      if (!def) continue;
      if (!matchesCardFilter(def, filter)) continue;
    }

    count++;
  }

  return count;
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
    case 'EachPlayer':
      throw new Error('EachPlayer must be handled before calling resolveTargetRef');
    case 'AllCreatures':
      throw new Error('AllCreatures must be handled before calling resolveTargetRef');
    case 'AllCreaturesYouControl':
      throw new Error('AllCreaturesYouControl must be handled before calling resolveTargetRef');
    case 'AllOfType':
      throw new Error('AllOfType must be handled before calling resolveTargetRef');
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

  // Check if the target is a player (for poison counters and similar)
  const playerIndex = state.players.findIndex(p => p.id === targetId);
  if (playerIndex !== -1) {
    // Only poison counters are tracked on players via poisonCounters
    if (counterType === 'poison') {
      const newPlayers = state.players.map((p, i) =>
        i === playerIndex
          ? { ...p, poisonCounters: p.poisonCounters + finalCount }
          : p
      );
      return { ...state, players: newPlayers };
    }
    // Other player-targeted counter types: no-op for now
    return state;
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
 * Execute a Surveil effect.
 * Simplified: uses AI heuristic — puts high-CMC non-land cards into graveyard,
 * keeps lands and low-CMC spells on top (similar to Scry but cards go to graveyard
 * instead of bottom of library).
 */
function executeSurveil(state: GameState, playerId: string, count: number): GameState {
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

  // AI heuristic: lands and low-CMC spells stay on top, others go to graveyard.
  const keepOnTop: CardInstance[] = [];
  const sendToGraveyard: CardInstance[] = [];

  for (const card of surveilCards) {
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
      sendToGraveyard.push(card);
    }
  }

  // Rebuild library: top cards first, then rest (no bottom — graveyard cards are removed)
  const newLibrary = [...keepOnTop, ...restLibrary];

  // Rebuild cards map
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
  // Move surveiled cards to graveyard
  for (const card of sendToGraveyard) {
    newCards.set(card.instanceId, { ...card, zone: 'graveyard' });
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
 * Execute a CounterSpell effect.
 * Moves the target spell from the stack to the graveyard.
 * V0: We move the card to the graveyard if it exists on the stack.
 */
function executeCounterSpell(state: GameState, targetId: string): GameState {
  // In the real engine, countering removes from the stack.
  // Here we move the card instance to graveyard if it exists.
  const card = state.cards.get(targetId);
  if (!card) return state;

  // The card should be on the stack, but we handle any zone gracefully
  const destZone = getCommanderDestinationZone(state, targetId, 'graveyard');
  const newCards = new Map(state.cards);
  newCards.set(targetId, { ...card, zone: destZone });

  return { ...state, cards: newCards };
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
function executeExileFromLibrary(state: GameState, playerId: string, count: number): GameState {
  const newCards = new Map(state.cards);

  // Find cards in library
  const libraryCards: CardInstance[] = [];
  for (const [, card] of state.cards) {
    if (card.ownerId === playerId && card.zone === 'library') {
      libraryCards.push(card);
    }
  }

  const toExile = Math.min(count, libraryCards.length);
  for (let i = 0; i < toExile; i++) {
    const card = libraryCards[i];
    newCards.set(card.instanceId, { ...card, zone: 'exile' });
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
        const def = state.cardDefinitions.get(card.definitionId);
        if (def && matchesCardFilter(def, condition.filter)) return true;
      }
      return false;
    }
    case 'ControlsMoreThan': {
      let opponentCount = 0;
      let yourCount = 0;
      for (const [, card] of state.cards) {
        if (card.zone !== 'battlefield') continue;
        const def = state.cardDefinitions.get(card.definitionId);
        if (!def || !matchesCardFilter(def, condition.what)) continue;
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

  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return state;

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
  const { casterId, chosenTargets, xValue } = ctx;

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
      const drawPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const drawCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeDraw(state, drawPlayerId, drawCount);
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
      // AllOfType: destroy all permanents matching filter
      if (effect.target.kind === 'AllOfType') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone === 'battlefield') {
            const def = state.cardDefinitions.get(card.definitionId);
            if (def && matchesCardFilter(def, effect.target.filter)) {
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
      const dmgTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      const dmgAmount = resolveAmount(effect.amount, xValue, state, casterId);
      return executeDealDamage(state, dmgTargetId, dmgAmount);
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
            const def = state.cardDefinitions.get(card.definitionId);
            if (def && matchesCardFilter(def, effect.target.filter)) {
              s = executeExile(s, card.instanceId);
            }
          }
        }
        return s;
      }
      const exileTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeExile(state, exileTargetId);
    }
    case 'ReturnToHand': {
      // AllOfType: return all matching permanents
      if (effect.target.kind === 'AllOfType') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone === 'battlefield') {
            const def = state.cardDefinitions.get(card.definitionId);
            if (def && matchesCardFilter(def, effect.target.filter)) {
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
    case 'Mill': {
      const millPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const millCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeMill(state, millPlayerId, millCount);
    }
    case 'AddCounters': {
      const acTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
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
      const untapTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeUntap(state, untapTargetId);
    }
    case 'CreateToken': {
      const ctControllerId = resolveTargetRef(effect.controller, casterId, chosenTargets);
      const ctCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeCreateToken(state, ctControllerId, effect.token, ctCount);
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
      return executeScry(state, scryPlayerId, scryCount);
    }
    case 'Surveil': {
      const surveilPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const surveilCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeSurveil(state, surveilPlayerId, surveilCount);
    }
    case 'SearchLibrary': {
      const slPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      return executeSearchLibrary(state, slPlayerId, effect.filter, effect.destination, effect.tapped);
    }
    case 'ShuffleLibrary': {
      const shPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      return executeShuffleLibrary(state, shPlayerId);
    }
    case 'CounterSpell': {
      const csTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeCounterSpell(state, csTargetId);
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
            const def = state.cardDefinitions.get(card.definitionId);
            if (def && def.card_types.includes('creature')) {
              s = executeModifyPT(s, card.instanceId, effect.power, effect.toughness);
            }
          }
        }
        return s;
      }
      const mptTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeModifyPT(state, mptTargetId, effect.power, effect.toughness);
    }
    case 'ExileFromLibrary': {
      const eflPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const eflCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeExileFromLibrary(state, eflPlayerId, eflCount);
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
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets);
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
