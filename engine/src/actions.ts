import { GameState, ManaColor, Phase, ActivatedAbilityStackItem } from './types';
import { getCardDefinition, getCardsInZone } from './game-state';
import { addMana, parseManaString, canPayCost, payManaCost } from './mana';
import { getOverride } from './effects/overrides';
import { parseActivatedAbilities } from './effects/parser';
import { executeSacrificeSpecific, executeSearchLibrary, executeShuffleLibrary, executeEffectsWithSBA } from './effects/executor';
import type { ActivatedAbility, Effect } from './effects/ast';
import type { TargetSpec } from './effects/targets';

const MAIN_PHASES: Phase[] = ['precombat_main', 'postcombat_main'];

export function canPlayLand(state: GameState, playerId: string, cardInstanceId: string): boolean {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return false;

  if (state.activePlayerIndex !== playerIndex) return false;
  if (!MAIN_PHASES.includes(state.phase)) return false;
  if (state.players[playerIndex].hasPlayedLand) return false;

  const card = state.cards.get(cardInstanceId);
  if (!card || card.zone !== 'hand' || card.ownerId !== playerId) return false;

  const def = getCardDefinition(state, card);
  if (!def.card_types.includes('land')) return false;

  return true;
}

export function playLand(state: GameState, playerId: string, cardInstanceId: string): GameState {
  if (!canPlayLand(state, playerId, cardInstanceId)) {
    throw new Error('Cannot play land');
  }

  const newCards = new Map(state.cards);
  const card = newCards.get(cardInstanceId)!;
  const def = getCardDefinition(state, card);
  const entersTapped = entersTheBattlefieldTapped(def.oracle_text);
  newCards.set(cardInstanceId, { ...card, zone: 'battlefield', tapped: entersTapped, summoningSick: false });

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, hasPlayedLand: true } : p
  );

  return { ...state, cards: newCards, players: newPlayers };
}

/** Check if a permanent's oracle text indicates it enters the battlefield tapped. */
function entersTheBattlefieldTapped(oracleText: string): boolean {
  if (!oracleText) return false;
  const lower = oracleText.toLowerCase();
  return lower.includes('enters the battlefield tapped') || lower.includes('enters tapped');
}

export function tapLandForMana(state: GameState, playerId: string, cardInstanceId: string, color: ManaColor): GameState {
  const card = state.cards.get(cardInstanceId);
  if (!card) throw new Error('Card not found');
  if (card.ownerId !== playerId) throw new Error('Not your card');
  if (card.zone !== 'battlefield') throw new Error('Card not on battlefield');
  if (card.tapped) throw new Error('Card already tapped');

  const newCards = new Map(state.cards);
  newCards.set(cardInstanceId, { ...card, tapped: true });

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, manaPool: addMana(p.manaPool, color, 1) } : p
  );

  return { ...state, cards: newCards, players: newPlayers };
}

export function drawCards(state: GameState, playerId: string, count: number): GameState {
  const library = getCardsInZone(state, playerId, 'library');
  const toDraw = Math.min(count, library.length);

  const newCards = new Map(state.cards);
  for (let i = 0; i < toDraw; i++) {
    const card = library[i];
    newCards.set(card.instanceId, { ...card, zone: 'hand' });
  }

  return { ...state, cards: newCards };
}

// ============================================================================
// Activated abilities
// ============================================================================

let activatedStackCounter = 0;

/**
 * Get activated abilities for a card.
 * Checks overrides first, then parses oracle text.
 */
export function getActivatedAbilities(state: GameState, cardInstanceId: string): ActivatedAbility[] {
  const card = state.cards.get(cardInstanceId);
  if (!card) return [];

  const def = getCardDefinition(state, card);

  // Check overrides first
  const override = getOverride(def.id, def.name);
  if (override && override.kind === 'Activated') {
    return [override.ability];
  }

  // Parse oracle text
  return parseActivatedAbilities(def.oracle_text);
}

/**
 * Check if a player can activate a specific ability on a card.
 */
export function canActivateAbility(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  abilityIndex: number,
): boolean {
  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  if (card.ownerId !== playerId) return false;
  if (card.zone !== 'battlefield') return false;

  const abilities = getActivatedAbilities(state, cardInstanceId);
  if (abilityIndex >= abilities.length) return false;

  const ability = abilities[abilityIndex];
  const def = getCardDefinition(state, card);

  // Check tap cost: can't activate if already tapped
  if (ability.cost.tap && card.tapped) return false;

  // Check summoning sickness for creatures with tap cost
  if (ability.cost.tap && card.summoningSick && def.card_types.includes('creature')) return false;

  // Check mana cost
  if (ability.cost.mana) {
    const player = state.players.find(p => p.id === playerId);
    if (!player) return false;
    const manaCost = parseManaString(ability.cost.mana);
    if (!canPayCost(player.manaPool, manaCost)) return false;
  }

  return true;
}

/**
 * Activate an ability on a permanent.
 * Pays costs upfront (MTG rules: costs paid before putting on stack).
 * Mana abilities resolve immediately without using the stack.
 */
export function activateAbility(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  abilityIndex: number,
  targets: string[] = [],
): GameState {
  if (!canActivateAbility(state, playerId, cardInstanceId, abilityIndex)) {
    throw new Error('Cannot activate ability');
  }

  const abilities = getActivatedAbilities(state, cardInstanceId);
  const ability = abilities[abilityIndex];
  let newState = state;

  // === Pay costs (before putting on stack) ===

  // Pay tap cost
  if (ability.cost.tap) {
    const newCards = new Map(newState.cards);
    const card = newCards.get(cardInstanceId)!;
    newCards.set(cardInstanceId, { ...card, tapped: true });
    newState = { ...newState, cards: newCards };
  }

  // Pay sacrifice cost
  if (ability.cost.sacrifice === 'self') {
    newState = executeSacrificeSpecific(newState, cardInstanceId);
  }

  // Pay mana cost
  if (ability.cost.mana) {
    const manaCost = parseManaString(ability.cost.mana);
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    const player = newState.players[playerIndex];
    const newManaPool = payManaCost(player.manaPool, manaCost);
    const newPlayers = newState.players.map((p, i) =>
      i === playerIndex ? { ...p, manaPool: newManaPool } : p
    );
    newState = { ...newState, players: newPlayers };
  }

  // === Put on stack or resolve immediately ===

  if (ability.isManaAbility) {
    // Mana abilities resolve immediately
    const effects = ability.effects as Effect[];
    const targetSpecs = ability.targets as TargetSpec[];
    newState = executeEffectsWithSBA(newState, effects, playerId, targets, targetSpecs);
  } else {
    // Non-mana abilities go on the stack
    const stackItem: ActivatedAbilityStackItem = {
      kind: 'ActivatedAbility',
      id: `act_${++activatedStackCounter}`,
      sourceInstanceId: cardInstanceId,
      controllerId: playerId,
      ability: {
        effects: ability.effects,
        targets: ability.targets,
      },
      targets,
    };

    newState = {
      ...newState,
      stack: [...newState.stack, stackItem],
      hasPriorityPassed: new Array(newState.players.length).fill(false),
      priorityPlayerIndex: newState.activePlayerIndex,
    };
  }

  return newState;
}
