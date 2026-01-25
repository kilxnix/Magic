// Phase 4: Effect executor - applies Effect AST to GameState

import type { GameState, CardInstance } from '../types';
import type { Effect, TargetRef } from './ast';
import { checkStateBasedActions } from '../state-based';
import { isIndestructible } from '../keywords';

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
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    throw new Error(`Player ${playerId} not found`);
  }

  const newCards = new Map(state.cards);
  const newPlayers = [...state.players];

  // Find cards in library (ordered by... we assume first entries are top)
  const libraryCards: CardInstance[] = [];
  for (const [, card] of state.cards) {
    if (card.ownerId === playerId && card.zone === 'library') {
      libraryCards.push(card);
    }
  }

  // Draw from "top" (first N cards in library)
  const toDraw = Math.min(count, libraryCards.length);

  // If trying to draw from empty library, player loses (handled by SBAs)
  // For now, just draw what we can

  for (let i = 0; i < toDraw; i++) {
    const card = libraryCards[i];
    newCards.set(card.instanceId, { ...card, zone: 'hand' });
  }

  return { ...state, cards: newCards, players: newPlayers };
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

  const newCards = new Map(state.cards);
  newCards.set(targetId, { ...card, zone: 'graveyard' });

  return { ...state, cards: newCards };
}

/**
 * Execute a DealDamage effect.
 */
function executeDealDamage(state: GameState, targetId: string, amount: number): GameState {
  // Check if target is a player
  const playerIndex = state.players.findIndex(p => p.id === targetId);
  if (playerIndex !== -1) {
    const newPlayers = state.players.map((p, i) =>
      i === playerIndex ? { ...p, life: p.life - amount } : p
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
  newCards.set(targetId, { ...card, damage: card.damage + amount });

  return { ...state, cards: newCards };
}

/**
 * Execute a GainLife effect.
 */
function executeGainLife(state: GameState, playerId: string, amount: number): GameState {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    throw new Error(`Player ${playerId} not found`);
  }

  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, life: p.life + amount } : p
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
 * Execute a single effect.
 */
function executeEffect(
  state: GameState,
  effect: Effect,
  casterId: string,
  chosenTargets: Map<string, string>,
): GameState {
  switch (effect.kind) {
    case 'Draw': {
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      return executeDraw(state, playerId, effect.count);
    }
    case 'Destroy': {
      const targetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeDestroy(state, targetId);
    }
    case 'DealDamage': {
      const targetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeDealDamage(state, targetId, effect.amount);
    }
    case 'GainLife': {
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      return executeGainLife(state, playerId, effect.amount);
    }
    case 'LoseLife': {
      const playerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      return executeLoseLife(state, playerId, effect.amount);
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
): GameState {
  // Build a map from spec ID to chosen target ID
  const chosenTargets = new Map<string, string>();
  for (let i = 0; i < targetSpecs.length && i < chosenTargetIds.length; i++) {
    chosenTargets.set(targetSpecs[i].id, chosenTargetIds[i]);
  }

  let newState = state;
  for (const effect of effects) {
    newState = executeEffect(newState, effect, casterId, chosenTargets);
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
): GameState {
  let newState = executeEffects(state, effects, casterId, chosenTargetIds, targetSpecs);
  newState = checkStateBasedActions(newState);
  return newState;
}
