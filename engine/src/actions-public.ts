// engine/src/actions-public.ts
import type { GameState, ManaColor, ManaCost, AttackerDeclaration, BlockerDeclaration, Zone, Phase, Step } from './types';
import {
  playLand,
  canPlayLandDetailed,
  tapLandForMana,
  activateAbility,
  getActivatedAbilities,
  equipCreature,
  isBlockedBySummoningSicknessForTap,
  getAvailableManaColors,
  type PlayLandOptions,
} from './actions';
import { castSpell, canCastSpell, getCastSpellDefinition, getEffectiveCastCost, type CastSpellOptions } from './stack';
import { canPaySpellCost, canPayUnrestrictedCost, parseManaString } from './mana';
import { getCardDefinition } from './game-state';
import { passPriority } from './priority';
import { declareAttackers, declareBlockers, hasPlayerDeclaredBlockers } from './combat';
import { LoopDetector, checkWinConditions } from './win-conditions';
import { findCastZoneRestriction, getCommanderTaxForCast } from './casting-restrictions';
import { getCommanderDestinationZone } from './commander';
import { populateParsedCache } from './cards/card-parser-cache';
import { getCostIncrease, getCostReduction, getIntrinsicCostReduction } from './effects/continuous';
import { executeEffects } from './effects/executor';
import type { Effect } from './effects/ast';

export type ActionFailure =
  | 'not_your_turn'
  | 'wrong_phase'
  | 'illegal_target'
  | 'insufficient_mana'
  | 'already_tapped'
  | 'not_in_zone'
  | 'land_already_played'
  | 'insufficient_life'
  | 'cast_restricted'
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
  | { kind: 'ManaUntapped'; playerId: string; cardId: string; color: ManaColor; amount: number; manual: true }
  | {
      kind: 'CountersAdjusted';
      playerId: string;
      cardId: string;
      counterType: string;
      delta: number;
      previous: number;
      next: number;
      manual: true;
    }
  | {
      kind: 'PlayerCounterAdjusted';
      playerId: string;
      targetPlayerId: string;
      counterType: string;
      delta: number;
      previous: number;
      next: number;
      manual: true;
    }
  | {
      kind: 'CommanderDamageAdjusted';
      playerId: string;
      targetPlayerId: string;
      commanderInstanceId: string;
      delta: number;
      previous: number;
      next: number;
      manual: true;
    }
  | {
      kind: 'CardMovedManually';
      playerId: string;
      cardId: string;
      from: Zone;
      to: Zone;
      manual: true;
    }
  | {
      kind: 'CardDamageAdjusted';
      playerId: string;
      cardId: string;
      delta: number;
      previous: number;
      next: number;
      manual: true;
    }
  | {
      kind: 'TokenCreated';
      playerId: string;
      tokenName: string;
      count: number;
      manual: true;
    }
  | {
      kind: 'AttachmentAdjusted';
      playerId: string;
      cardId: string;
      previousTargetId?: string;
      nextTargetId?: string;
      manual: true;
    }
  | {
      kind: 'TurnStepAdjusted';
      playerId: string;
      from: { activePlayerId?: string; phase: Phase; step: Step };
      to: { activePlayerId: string; phase: Phase; step: Step };
      manual: true;
    }
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

const globalDetector = new LoopDetector();

function failureFromCaughtError(error: unknown): ActionResult {
  const message = (error as Error).message || String(error);
  if (
    message.startsWith('Invalid target')
    || /^Expected \d+ target choice\(s\)/.test(message)
    || /target/i.test(message) && /missing|illegal|invalid|expected/i.test(message)
  ) {
    return fail('illegal_target', message);
  }
  if (/summoning sick/i.test(message)) return fail('summoning_sick', message);
  if (/already tapped/i.test(message)) return fail('already_tapped', message);
  if (/cannot pay life|insufficient life/i.test(message)) return fail('insufficient_life', message);
  if (/cannot pay|insufficient mana/i.test(message)) return fail('insufficient_mana', message);
  return fail('internal_error', message);
}

const PHASE_STEPS: Record<Phase, Step[]> = {
  beginning: ['untap', 'upkeep', 'draw'],
  precombat_main: ['begin_combat'],
  combat: ['begin_combat', 'declare_attackers', 'declare_blockers', 'first_strike_damage', 'combat_damage', 'end_of_combat'],
  postcombat_main: ['end_of_combat', 'end'],
  ending: ['end', 'cleanup'],
};

export function resetLoopDetector(): void {
  globalDetector.reset();
}

function runWinCheck(state: GameState): GameEvent[] {
  try {
    const { losers, loop } = checkWinConditions(state, globalDetector);
    const events: GameEvent[] = [];
    for (const l of losers) {
      events.push({ kind: 'PlayerLost', playerId: l.playerId, reason: l.reason });
    }
    if (loop) events.push({ kind: 'PossibleLoop', signature: loop });
    return events;
  } catch (e) {
    return [{ kind: 'WinCheckFailed', message: (e as Error).message }];
  }
}

function reduceGenericCost(
  state: GameState,
  playerId: string,
  cost: ManaCost,
  def: ReturnType<typeof getCardDefinition>,
): ManaCost {
  const increasedCost = {
    ...cost,
    generic: cost.generic + getCostIncrease(state, playerId, def),
  };
  const reduction = Math.min(
    increasedCost.generic,
    getCostReduction(state, playerId, def) + getIntrinsicCostReduction(state, playerId, def),
  );
  return reduction > 0 ? { ...increasedCost, generic: increasedCost.generic - reduction } : increasedCost;
}

export function tryPlayLand(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  options: PlayLandOptions = {},
): ActionResult {
  const legality = canPlayLandDetailed(state, playerId, cardInstanceId);
  if (!legality.legal) {
    switch (legality.code) {
      case 'player_not_found':
      case 'card_not_found':
        return fail('card_not_found', legality.reason);
      case 'not_in_zone':
        return fail('not_in_zone', legality.reason);
      case 'not_your_turn':
        return fail('not_your_turn', legality.reason);
      case 'priority_not_yours':
        return fail('priority_not_yours', legality.reason);
      case 'wrong_phase':
      case 'stack_not_empty':
        return fail('wrong_phase', legality.reason);
      case 'land_already_played':
        return fail('land_already_played', legality.reason);
      case 'not_land':
        return fail('internal_error', legality.reason);
      default: {
        const _never: never = legality.code;
        return fail('internal_error', _never);
      }
    }
  }

  try {
    const next = playLand(state, playerId, cardInstanceId, options);
    return success(next, [{ kind: 'LandPlayed', playerId, cardId: cardInstanceId }, ...runWinCheck(next)]);
  } catch (e) {
    if ((e as Error).message.includes('Cannot pay life')) {
      return fail('insufficient_life', (e as Error).message);
    }
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
  const rawDef = getCardDefinition(state, card);
  const parsedDef = rawDef.manaProduction ? rawDef : populateParsedCache(rawDef);
  const manaProduction = parsedDef.manaProduction;
  const handExileAbility = manaProduction?.activationZone === 'hand'
    && manaProduction.requiresExileFromHand === true;
  if (handExileAbility) {
    if (card.zone !== 'hand') return fail('not_in_zone', 'Card not in hand');
  } else {
    if (card.zone !== 'battlefield') return fail('not_in_zone', 'Card not on battlefield');
    if (manaProduction?.isTapAbility && card.tapped) return fail('already_tapped', 'Already tapped');
    if (manaProduction?.isTapAbility && isBlockedBySummoningSicknessForTap(state, cardInstanceId)) {
      return fail('summoning_sick', 'Summoning sick');
    }
  }
  if (!manaProduction) return fail('internal_error', 'Card has no mana ability');
  if (!getAvailableManaColors(state, cardInstanceId).includes(color)) {
    return fail('illegal_target', `Card cannot produce ${color}`);
  }

  try {
    const next = tapLandForMana(state, playerId, cardInstanceId, color);
    return success(next, [{ kind: 'ManaTapped', playerId, cardId: cardInstanceId, color }, ...runWinCheck(next)]);
  } catch (e) {
    return fail('internal_error', (e as Error).message);
  }
}

export function tryUntapManaSource(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  color: ManaColor,
  amount = 1,
): ActionResult {
  const card = state.cards.get(cardInstanceId);
  if (!card) return fail('card_not_found', 'Card not found');
  if (card.ownerId !== playerId) return fail('card_not_found', 'Not your card');
  if (card.zone !== 'battlefield') return fail('not_in_zone', 'Card not on battlefield');
  if (!card.tapped) return fail('internal_error', 'Card is not tapped');

  const playerIndex = state.players.findIndex(player => player.id === playerId);
  if (playerIndex < 0) return fail('card_not_found', 'Player not found');
  const player = state.players[playerIndex];
  const spendAmount = Math.max(1, Math.floor(amount));
  if ((player.manaPool[color] || 0) < spendAmount) {
    return fail('insufficient_mana', `No unspent ${color} mana to remove`);
  }

  const newCards = new Map(state.cards);
  newCards.set(cardInstanceId, { ...card, tapped: false });
  const players = state.players.map((candidate, index) => {
    if (index !== playerIndex) return candidate;
    return {
      ...candidate,
      manaPool: {
        ...candidate.manaPool,
        [color]: candidate.manaPool[color] - spendAmount,
      },
    };
  });
  const next = { ...state, cards: newCards, players };
  return success(next, [{
    kind: 'ManaUntapped',
    playerId,
    cardId: cardInstanceId,
    color,
    amount: spendAmount,
    manual: true,
  }]);
}

export function tryCastSpell(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  targets: string[],
  manaPayment: ManaCost,
  options: CastSpellOptions = {},
): ActionResult {
  const card = state.cards.get(cardInstanceId);
  if (!card) return fail('card_not_found', 'Card not found');
  if (card.ownerId !== playerId) return fail('card_not_found', 'Not your card');
  if (card.zone !== 'hand' && card.zone !== 'command') return fail('not_in_zone', 'Card not in hand or command zone');

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return fail('card_not_found', 'Player not found');
  const player = state.players[playerIndex];

  const def = getCastSpellDefinition(state, cardInstanceId, options);
  if (!def) return fail('card_not_found', 'Card definition missing');
  const castRestriction = findCastZoneRestriction(state, playerId, card);
  if (castRestriction) {
    return fail(
      'cast_restricted',
      `${castRestriction.sourceName} prevents casting spells from outside your hand`,
    );
  }

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
  const fallbackCost = parseManaString(def.mana_cost);
  const taxAmount = card.zone === 'command' ? getCommanderTaxForCast(state, playerId, cardInstanceId) : 0;
  const totalCost = getEffectiveCastCost(state, playerId, cardInstanceId, options)
    ?? reduceGenericCost(state, playerId, { ...fallbackCost, generic: fallbackCost.generic + taxAmount }, def);
  if (!canPaySpellCost(player, totalCost, def, card)) {
    return fail('insufficient_mana', 'Insufficient mana in pool');
  }

  try {
    const next = castSpell(state, playerId, cardInstanceId, targets, options);
    return success(next, [{ kind: 'SpellCast', playerId, cardId: cardInstanceId }, ...runWinCheck(next)]);
  } catch (e) {
    return failureFromCaughtError(e);
  }
}

export function tryActivateAbility(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  abilityIndex: number,
  targets: string[],
): ActionResult {
  const card = state.cards.get(cardInstanceId);
  if (!card) return fail('card_not_found', 'Card not found');
  if (card.ownerId !== playerId) return fail('card_not_found', 'Not your card');
  if (card.zone !== 'battlefield') return fail('not_in_zone', 'Card not on battlefield');

  const abilities = getActivatedAbilities(state, cardInstanceId);
  if (abilityIndex >= abilities.length) return fail('card_not_found', `Ability ${abilityIndex} not found`);
  const ability = abilities[abilityIndex];
  const def = getCardDefinition(state, card);

  if (ability.cost.tap && card.tapped) return fail('already_tapped', 'Already tapped');
  if (ability.cost.tap && isBlockedBySummoningSicknessForTap(state, cardInstanceId)) {
    return fail('summoning_sick', 'Summoning sick');
  }
  if (ability.cost.mana) {
    const cost = parseManaString(ability.cost.mana);
    const player = state.players.find(p => p.id === playerId)!;
    if (!canPayUnrestrictedCost(player, cost)) return fail('insufficient_mana', 'Cannot pay mana cost');
  }
  if (ability.cost.payLife) {
    const player = state.players.find(p => p.id === playerId)!;
    if (player.life < ability.cost.payLife) return fail('insufficient_life', 'Cannot pay life cost');
  }

  try {
    const next = activateAbility(state, playerId, cardInstanceId, abilityIndex, targets);
    return success(next, [{ kind: 'AbilityActivated', playerId, cardId: cardInstanceId, abilityIndex }, ...runWinCheck(next)]);
  } catch (e) {
    return failureFromCaughtError(e);
  }
}

export function tryPassPriority(state: GameState, playerId: string): ActionResult {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return fail('card_not_found', 'Player not found');
  if (state.priorityPlayerIndex !== playerIndex) return fail('priority_not_yours', 'You do not have priority');
  if (state.step === 'declare_attackers' && state.activePlayerIndex === playerIndex && !state.combat) {
    return fail('wrong_phase', 'Declare attackers before passing priority. You may declare no attackers.');
  }
  try {
    const next = passPriority(state);
    return success(next, runWinCheck(next));
  } catch (e) {
    return fail('internal_error', (e as Error).message);
  }
}

export function tryDeclareAttackers(
  state: GameState,
  playerId: string,
  attackers: AttackerDeclaration[],
): ActionResult {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return fail('card_not_found', 'Player not found');
  if (state.activePlayerIndex !== playerIndex) return fail('not_your_turn', 'Only active player declares attackers');
  if (state.step !== 'declare_attackers') return fail('wrong_phase', 'Not declare-attackers step');
  if (state.combat) return fail('wrong_phase', 'Attackers already declared');
  try {
    const next = declareAttackers(state, playerId, attackers);
    return success(next, runWinCheck(next));
  } catch (e) {
    return fail('internal_error', (e as Error).message);
  }
}

export function tryDeclareBlockers(
  state: GameState,
  playerId: string,
  blockers: BlockerDeclaration[],
): ActionResult {
  if (state.step !== 'declare_blockers') return fail('wrong_phase', 'Not declare-blockers step');
  if (hasPlayerDeclaredBlockers(state, playerId)) return fail('wrong_phase', 'Blockers already declared');
  try {
    const next = declareBlockers(state, playerId, blockers);
    return success(next, runWinCheck(next));
  } catch (e) {
    return fail('internal_error', (e as Error).message);
  }
}

export function tryEquip(
  state: GameState,
  playerId: string,
  equipmentId: string,
  creatureId: string,
): ActionResult {
  const equip = state.cards.get(equipmentId);
  if (!equip) return fail('card_not_found', 'Equipment not found');
  if (equip.zone !== 'battlefield') return fail('not_in_zone', 'Equipment not on battlefield');
  if (equip.ownerId !== playerId) return fail('card_not_found', 'Not your equipment');

  const target = state.cards.get(creatureId);
  if (!target) return fail('card_not_found', 'Target creature not found');
  if (target.zone !== 'battlefield') return fail('not_in_zone', 'Target not on battlefield');

  try {
    const next = equipCreature(state, playerId, equipmentId, creatureId);
    return success(next, runWinCheck(next));
  } catch (e) {
    return fail('internal_error', (e as Error).message);
  }
}

export function tryAdjustCounters(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  counterType: string,
  delta: number,
): ActionResult {
  if (!state.players.some(p => p.id === playerId)) return fail('card_not_found', 'Player not found');

  const card = state.cards.get(cardInstanceId);
  if (!card) return fail('card_not_found', 'Card not found');
  if (card.zone !== 'battlefield') return fail('not_in_zone', 'Counters can only be adjusted on battlefield permanents');

  const normalizedCounter = counterType.trim().replace(/\s+/g, ' ');
  if (normalizedCounter.length === 0 || normalizedCounter.length > 32) {
    return fail('illegal_target', 'Counter type must be 1-32 characters');
  }
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 99) {
    return fail('illegal_target', 'Counter adjustment must be a non-zero integer from -99 to 99');
  }

  const previous = Math.max(0, card.counters[normalizedCounter] ?? 0);
  const nextCount = Math.max(0, previous + delta);
  if (previous === nextCount) {
    return fail('illegal_target', `No ${normalizedCounter} counters to remove`);
  }

  const counters = { ...card.counters };
  if (nextCount === 0) {
    delete counters[normalizedCounter];
  } else {
    counters[normalizedCounter] = nextCount;
  }

  const cards = new Map(state.cards);
  cards.set(cardInstanceId, { ...card, counters });
  const next = { ...state, cards };

  return success(next, [
    {
      kind: 'CountersAdjusted',
      playerId,
      cardId: cardInstanceId,
      counterType: normalizedCounter,
      delta,
      previous,
      next: nextCount,
      manual: true,
    },
    ...runWinCheck(next),
  ]);
}

export function tryAdjustPlayerCounter(
  state: GameState,
  playerId: string,
  targetPlayerId: string,
  counterType: string,
  delta: number,
): ActionResult {
  if (!state.players.some(p => p.id === playerId)) return fail('card_not_found', 'Player not found');
  const target = state.players.find(p => p.id === targetPlayerId);
  if (!target) return fail('card_not_found', 'Target player not found');

  const normalizedCounter = counterType.trim().replace(/\s+/g, ' ').toLowerCase();
  if (normalizedCounter.length === 0 || normalizedCounter.length > 32) {
    return fail('illegal_target', 'Counter type must be 1-32 characters');
  }
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 99) {
    return fail('illegal_target', 'Counter adjustment must be a non-zero integer from -99 to 99');
  }

  const previous = normalizedCounter === 'poison'
    ? Math.max(0, target.poisonCounters || 0)
    : Math.max(0, target.playerCounters?.[normalizedCounter] ?? 0);
  const nextCount = Math.max(0, previous + delta);
  if (previous === nextCount) {
    return fail('illegal_target', `No ${normalizedCounter} counters to remove`);
  }

  const nextPlayers = state.players.map(player => {
    if (player.id !== targetPlayerId) return player;
    if (normalizedCounter === 'poison') {
      return { ...player, poisonCounters: nextCount };
    }
    const playerCounters = { ...(player.playerCounters || {}) };
    if (nextCount === 0) {
      delete playerCounters[normalizedCounter];
    } else {
      playerCounters[normalizedCounter] = nextCount;
    }
    return { ...player, playerCounters };
  });
  const next = { ...state, players: nextPlayers };

  return success(next, [
    {
      kind: 'PlayerCounterAdjusted',
      playerId,
      targetPlayerId,
      counterType: normalizedCounter,
      delta,
      previous,
      next: nextCount,
      manual: true,
    },
    ...runWinCheck(next),
  ]);
}

export function tryAdjustCommanderDamage(
  state: GameState,
  playerId: string,
  targetPlayerId: string,
  commanderInstanceId: string,
  delta: number,
): ActionResult {
  if (!state.players.some(p => p.id === playerId)) return fail('card_not_found', 'Player not found');
  const target = state.players.find(p => p.id === targetPlayerId);
  if (!target) return fail('card_not_found', 'Target player not found');
  const commander = state.cards.get(commanderInstanceId);
  if (!commander) return fail('card_not_found', 'Commander not found');
  if (!commander.isCommander) return fail('illegal_target', 'Commander damage source must be a commander');
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 99) {
    return fail('illegal_target', 'Commander damage adjustment must be a non-zero integer from -99 to 99');
  }

  const previous = Math.max(0, target.commanderDamage[commanderInstanceId] ?? 0);
  const nextDamage = Math.max(0, previous + delta);
  if (previous === nextDamage) {
    return fail('illegal_target', 'No commander damage to remove');
  }

  const players = state.players.map(player => {
    if (player.id !== targetPlayerId) return player;
    const commanderDamage = { ...player.commanderDamage };
    if (nextDamage === 0) {
      delete commanderDamage[commanderInstanceId];
    } else {
      commanderDamage[commanderInstanceId] = nextDamage;
    }
    return { ...player, commanderDamage };
  });
  const next = { ...state, players };

  return success(next, [
    {
      kind: 'CommanderDamageAdjusted',
      playerId,
      targetPlayerId,
      commanderInstanceId,
      delta,
      previous,
      next: nextDamage,
      manual: true,
    },
    ...runWinCheck(next),
  ]);
}

export function tryMoveCardManually(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  zone: Exclude<Zone, 'library' | 'stack'>,
): ActionResult {
  if (!state.players.some(p => p.id === playerId)) return fail('card_not_found', 'Player not found');
  const card = state.cards.get(cardInstanceId);
  if (!card) return fail('card_not_found', 'Card not found');
  if (card.zone === 'stack') return fail('wrong_phase', 'Cards on the stack must resolve or be countered through the stack');
  const finalZone = getCommanderDestinationZone(state, cardInstanceId, zone);
  if (card.zone === finalZone) return fail('illegal_target', `Card is already in ${finalZone}`);
  if (!['hand', 'battlefield', 'graveyard', 'exile', 'command'].includes(zone)) {
    return fail('illegal_target', 'Unsupported destination zone');
  }

  const def = getCardDefinition(state, card);
  const permanentTypes = ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'];
  if (zone === 'battlefield' && !def.card_types.some(type => permanentTypes.includes(type))) {
    return fail('illegal_target', 'Only permanent cards can be moved to the battlefield');
  }
  if (finalZone === 'command' && !card.isCommander) {
    return fail('illegal_target', 'Only commanders can be moved to the command zone');
  }

  const cards = new Map(state.cards);
  const from = card.zone;
  if (card.isToken && finalZone !== 'battlefield') {
    cards.delete(card.instanceId);
  } else {
    cards.set(cardInstanceId, {
      ...card,
      zone: finalZone,
      tapped: false,
      summoningSick: finalZone === 'battlefield',
      counters: finalZone === 'battlefield' ? card.counters : {},
      damage: 0,
      attachedTo: undefined,
    });
  }
  for (const [id, candidate] of cards) {
    if (candidate.attachedTo === cardInstanceId || (candidate.zone !== 'battlefield' && candidate.attachedTo)) {
      cards.set(id, { ...candidate, attachedTo: undefined });
    }
  }

  const next = { ...state, cards };
  return success(next, [
    {
      kind: 'CardMovedManually',
      playerId,
      cardId: cardInstanceId,
      from,
      to: finalZone,
      manual: true,
    },
    ...runWinCheck(next),
  ]);
}

export function tryAdjustDamage(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  delta: number,
): ActionResult {
  if (!state.players.some(p => p.id === playerId)) return fail('card_not_found', 'Player not found');
  const card = state.cards.get(cardInstanceId);
  if (!card) return fail('card_not_found', 'Card not found');
  if (card.zone !== 'battlefield') return fail('not_in_zone', 'Damage can only be adjusted on battlefield permanents');
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 99) {
    return fail('illegal_target', 'Damage adjustment must be a non-zero integer from -99 to 99');
  }

  const previous = Math.max(0, card.damage || 0);
  const nextDamage = Math.max(0, previous + delta);
  if (previous === nextDamage) {
    return fail('illegal_target', 'No marked damage to remove');
  }

  const cards = new Map(state.cards);
  cards.set(cardInstanceId, { ...card, damage: nextDamage });
  const next = { ...state, cards };

  return success(next, [
    {
      kind: 'CardDamageAdjusted',
      playerId,
      cardId: cardInstanceId,
      delta,
      previous,
      next: nextDamage,
      manual: true,
    },
    ...runWinCheck(next),
  ]);
}

export function tryCreateManualToken(
  state: GameState,
  playerId: string,
  token: {
    name: string;
    count: number;
    power: number;
    toughness: number;
    colors: string[];
    types: string[];
    subtypes: string[];
    keywords?: string[];
  },
): ActionResult {
  if (!state.players.some(p => p.id === playerId)) return fail('card_not_found', 'Player not found');

  const name = token.name.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > 80) return fail('illegal_target', 'Token name must be 1-80 characters');
  const count = Math.floor(token.count);
  if (!Number.isInteger(count) || count < 1 || count > 99) return fail('illegal_target', 'Token count must be 1-99');
  const power = Math.trunc(token.power);
  const toughness = Math.trunc(token.toughness);
  if (!Number.isFinite(power) || !Number.isFinite(toughness) || Math.abs(power) > 99 || Math.abs(toughness) > 99) {
    return fail('illegal_target', 'Token power/toughness must be between -99 and 99');
  }

  const cleanWords = (values: string[], fallback: string[]) => {
    const cleaned = values
      .map(value => value.trim().replace(/[^A-Za-z0-9' -]/g, '').replace(/\s+/g, ' '))
      .filter(value => value.length > 0 && value.length <= 40);
    return cleaned.length > 0 ? [...new Set(cleaned)] : fallback;
  };
  const types = cleanWords(token.types, ['creature']).map(value => value.toLowerCase());
  const subtypes = cleanWords(token.subtypes, [name]);
  const colors = token.colors
    .map(color => color.toUpperCase())
    .filter((color): color is 'W' | 'U' | 'B' | 'R' | 'G' => ['W', 'U', 'B', 'R', 'G'].includes(color));
  const keywords = cleanWords(token.keywords || [], []);

  const effect: Effect = {
    kind: 'CreateToken',
    controller: { kind: 'Controller' },
    token: {
      name,
      colors,
      types,
      subtypes,
      power,
      toughness,
      keywords,
    },
    count,
  };

  const next = executeEffects(state, [effect], playerId, [], []);
  return success(next, [
    {
      kind: 'TokenCreated',
      playerId,
      tokenName: name,
      count,
      manual: true,
    },
    ...runWinCheck(next),
  ]);
}

export function tryAttachCardManually(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  targetId?: string,
): ActionResult {
  if (!state.players.some(p => p.id === playerId)) return fail('card_not_found', 'Player not found');
  const card = state.cards.get(cardInstanceId);
  if (!card) return fail('card_not_found', 'Card not found');
  if (card.zone !== 'battlefield') return fail('not_in_zone', 'Only battlefield permanents can be attached');

  const nextTargetId = targetId?.trim() || undefined;
  if (nextTargetId === cardInstanceId) return fail('illegal_target', 'A card cannot attach to itself');

  if (nextTargetId) {
    const target = state.cards.get(nextTargetId);
    if (!target) return fail('card_not_found', 'Attachment target not found');
    if (target.zone !== 'battlefield') return fail('not_in_zone', 'Attachment target must be on the battlefield');
  }

  const previousTargetId = card.attachedTo;
  if (previousTargetId === nextTargetId) {
    return fail('illegal_target', nextTargetId ? 'Card is already attached to that target' : 'Card is already unattached');
  }

  const cards = new Map(state.cards);
  cards.set(cardInstanceId, { ...card, attachedTo: nextTargetId });
  const next = { ...state, cards };

  return success(next, [
    {
      kind: 'AttachmentAdjusted',
      playerId,
      cardId: cardInstanceId,
      previousTargetId,
      nextTargetId,
      manual: true,
    },
    ...runWinCheck(next),
  ]);
}

export function trySetPhaseStepManually(
  state: GameState,
  playerId: string,
  activePlayerId: string,
  phase: Phase,
  step: Step,
): ActionResult {
  if (!state.players.some(p => p.id === playerId)) return fail('card_not_found', 'Player not found');
  const activePlayerIndex = state.players.findIndex(p => p.id === activePlayerId);
  if (activePlayerIndex < 0) return fail('card_not_found', 'Active player not found');
  if (state.players[activePlayerIndex]?.hasLost) return fail('illegal_target', 'A player who has lost cannot be made active');
  if (!PHASE_STEPS[phase]?.includes(step)) {
    return fail('wrong_phase', `Step ${step} is not valid during ${phase}`);
  }

  const previousActivePlayerId = state.players[state.activePlayerIndex]?.id;
  if (
    previousActivePlayerId === activePlayerId
    && state.phase === phase
    && state.step === step
  ) {
    return fail('wrong_phase', 'The game is already at that turn step');
  }

  const next: GameState = {
    ...state,
    activePlayerIndex,
    priorityPlayerIndex: activePlayerIndex,
    phase,
    step,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    combat: phase === 'combat' && step !== 'begin_combat' ? state.combat : null,
  };

  return success(next, [
    {
      kind: 'TurnStepAdjusted',
      playerId,
      from: {
        activePlayerId: previousActivePlayerId,
        phase: state.phase,
        step: state.step,
      },
      to: {
        activePlayerId,
        phase,
        step,
      },
      manual: true,
    },
    ...runWinCheck(next),
  ]);
}
