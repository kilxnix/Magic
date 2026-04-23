// engine/src/actions-public.ts
import type { GameState, ManaColor, Phase, ManaCost } from './types';
import { playLand, canPlayLand, tapLandForMana } from './actions';
import { castSpell, canCastSpell } from './stack';
import { canPayCost, parseManaString } from './mana';
import { getCardDefinition } from './game-state';

export type ActionFailure =
  | 'not_your_turn'
  | 'wrong_phase'
  | 'illegal_target'
  | 'insufficient_mana'
  | 'already_tapped'
  | 'not_in_zone'
  | 'land_already_played'
  | 'card_not_found'
  | 'summoning_sick'
  | 'priority_not_yours'
  | 'internal_error';

export type WinReason = 'life' | 'commander_damage' | 'empty_library' | 'poison' | 'concede';

export type LoopCategory = 'state_repeat' | 'trigger_self_loop' | 'unbounded_growth';

export interface LoopSignature {
  category: LoopCategory;
  sources: string[];
  hash: string;
}

export type GameEvent =
  | { kind: 'LandPlayed'; playerId: string; cardId: string }
  | { kind: 'SpellCast'; playerId: string; cardId: string }
  | { kind: 'AbilityActivated'; playerId: string; cardId: string; abilityIndex: number }
  | { kind: 'ManaTapped'; playerId: string; cardId: string; color: ManaColor }
  | { kind: 'CreatureDied'; cardId: string; ownerId: string }
  | { kind: 'PlayerLost'; playerId: string; reason: WinReason }
  | { kind: 'PossibleLoop'; signature: LoopSignature }
  | { kind: 'WinCheckFailed'; message: string };

export type ActionResult<T = GameState> =
  | { ok: true; state: T; events: GameEvent[] }
  | { ok: false; reason: ActionFailure; message: string };

export function fail(reason: ActionFailure, message: string): ActionResult {
  return { ok: false, reason, message };
}

export function success(state: GameState, events: GameEvent[] = []): ActionResult {
  return { ok: true, state, events };
}

const MAIN_PHASES: Phase[] = ['precombat_main', 'postcombat_main'];

export function tryPlayLand(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
): ActionResult {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return fail('card_not_found', 'Player not found');

  const card = state.cards.get(cardInstanceId);
  if (!card || card.ownerId !== playerId) return fail('card_not_found', 'Card not found or not yours');
  if (card.zone !== 'hand') return fail('not_in_zone', 'Card is not in hand');

  if (state.activePlayerIndex !== playerIndex) return fail('not_your_turn', 'Not your turn');
  if (!MAIN_PHASES.includes(state.phase)) {
    return fail('wrong_phase', 'Lands can only be played in main phases');
  }
  if (state.players[playerIndex].hasPlayedLand) {
    return fail('land_already_played', 'Already played a land this turn');
  }
  if (!canPlayLand(state, playerId, cardInstanceId)) {
    return fail('internal_error', 'canPlayLand returned false for unknown reason');
  }

  try {
    const next = playLand(state, playerId, cardInstanceId);
    return success(next, [{ kind: 'LandPlayed', playerId, cardId: cardInstanceId }]);
  } catch (e) {
    return fail('internal_error', (e as Error).message);
  }
}

export function tryTapLandForMana(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  color: ManaColor,
): ActionResult {
  const card = state.cards.get(cardInstanceId);
  if (!card) return fail('card_not_found', 'Card not found');
  if (card.ownerId !== playerId) return fail('card_not_found', 'Not your card');
  if (card.zone !== 'battlefield') return fail('not_in_zone', 'Card not on battlefield');
  if (card.tapped) return fail('already_tapped', 'Already tapped');

  try {
    const next = tapLandForMana(state, playerId, cardInstanceId, color);
    return success(next, [{ kind: 'ManaTapped', playerId, cardId: cardInstanceId, color }]);
  } catch (e) {
    return fail('internal_error', (e as Error).message);
  }
}

export function tryCastSpell(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  targets: string[],
  manaPayment: ManaCost,
): ActionResult {
  const card = state.cards.get(cardInstanceId);
  if (!card) return fail('card_not_found', 'Card not found');
  if (card.ownerId !== playerId) return fail('card_not_found', 'Not your card');
  if (card.zone !== 'hand' && card.zone !== 'command') return fail('not_in_zone', 'Card not in hand or command zone');

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return fail('card_not_found', 'Player not found');
  const player = state.players[playerIndex];

  const def = getCardDefinition(state, card);
  if (!def) return fail('card_not_found', 'Card definition missing');

  const isSorceryLike =
    def.card_types.includes('sorcery') ||
    def.card_types.includes('creature') ||
    def.card_types.includes('enchantment') ||
    def.card_types.includes('artifact') ||
    def.card_types.includes('planeswalker');

  if (isSorceryLike) {
    if (state.activePlayerIndex !== playerIndex) return fail('not_your_turn', 'Sorcery speed requires your turn');
    if (state.phase !== 'precombat_main' && state.phase !== 'postcombat_main') {
      return fail('wrong_phase', 'Sorcery speed requires main phase');
    }
    if (state.stack.length > 0) return fail('wrong_phase', 'Stack must be empty for sorcery speed');
  }

  if (state.priorityPlayerIndex !== playerIndex) return fail('priority_not_yours', 'You do not have priority');

  // Check that the player's mana pool can cover the spell's mana cost
  const spellCost = parseManaString(def.mana_cost);
  if (!canPayCost(player.manaPool, spellCost)) {
    return fail('insufficient_mana', 'Insufficient mana in pool');
  }

  try {
    const next = castSpell(state, playerId, cardInstanceId, targets);
    return success(next, [{ kind: 'SpellCast', playerId, cardId: cardInstanceId }]);
  } catch (e) {
    return fail('internal_error', (e as Error).message);
  }
}
