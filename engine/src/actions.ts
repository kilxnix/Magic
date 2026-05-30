import { GameState, ManaColor, Phase, ActivatedAbilityStackItem } from './types';
import { getCardDefinition, getCardsInZone } from './game-state';
import {
  addConditionalMana,
  addMana,
  addRestrictedMana,
  canPayUnrestrictedCost,
  parseManaString,
  payUnrestrictedManaCost,
} from './mana';
import { getOverride } from './effects/overrides';
import { parseActivatedAbilities } from './effects/parser';
import { executeSacrificeSpecific, executeSearchLibrary, executeShuffleLibrary, executeEffectsWithSBA, matchesCardFilter } from './effects/executor';
import { checkTriggersForEvent, registerBattlefieldAbilities } from './stack';
import { instanceHasKeyword } from './keywords';
import { populateParsedCache } from './cards/card-parser-cache';
import { isEffectiveCreature } from './effective-types';
import { getCommanderDestinationZone } from './commander';
import {
  buildBattlefieldEntryPlan,
  entersTheBattlefieldTapped,
  getOptionalUntappedLifeCost,
} from './permanent-entry';
import type { ActivatedAbility, Effect } from './effects/ast';
import type { TargetSpec } from './effects/targets';
import { applyWardForStackItem } from './ward';

const MAIN_PHASES: Phase[] = ['precombat_main', 'postcombat_main'];

export interface PlayLandOptions {
  payLifeToEnterUntapped?: boolean;
  chosenCreatureType?: string;
}

export type LandPlayIllegalCode =
  | 'player_not_found'
  | 'not_your_turn'
  | 'priority_not_yours'
  | 'wrong_phase'
  | 'stack_not_empty'
  | 'card_not_found'
  | 'not_in_zone'
  | 'not_land'
  | 'land_already_played';

export type LandPlayLegality =
  | { legal: true }
  | { legal: false; code: LandPlayIllegalCode; reason: string };

export function getAvailableManaColors(state: GameState, cardInstanceId: string): ManaColor[] {
  const card = state.cards.get(cardInstanceId);
  if (!card) return [];
  let def = getCardDefinition(state, card);
  if (!def.manaProduction) {
    def = populateParsedCache(def);
  }
  if (!def.manaProduction) return [];
  if (!manaActivationConditionMet(state, card.ownerId, cardInstanceId, def.oracle_text)) return [];

  if (/add one mana of any of the exiled card'?s colors/i.test(def.oracle_text)) {
    const allowed = new Set<ManaColor>();
    for (const imprintedId of card.choices?.imprintedCardIds || []) {
      const imprinted = state.cards.get(imprintedId);
      if (!imprinted || imprinted.zone !== 'exile') continue;
      const imprintedDef = state.cardDefinitions.get(imprinted.definitionId);
      for (const color of imprintedDef?.colors || []) {
        allowed.add(color);
      }
    }
    return def.manaProduction.colors.filter(color => allowed.has(color));
  }

  return def.manaProduction.colors;
}

function wordOrNumberToInt(value: string): number | undefined {
  const textNumbers: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  return /^\d+$/.test(value) ? parseInt(value, 10) : textNumbers[value.toLowerCase()];
}

function countControlledLands(state: GameState, playerId: string): number {
  let count = 0;
  for (const card of state.cards.values()) {
    if (card.ownerId !== playerId || card.zone !== 'battlefield') continue;
    if (getCardDefinition(state, card).card_types.includes('land')) count++;
  }
  return count;
}

function manaActivationConditionMet(
  state: GameState,
  playerId: string,
  _cardInstanceId: string,
  oracleText: string,
): boolean {
  const landThreshold = oracleText.match(/\bactivate only if you control (one|two|three|four|five|six|seven|eight|nine|ten|\d+) or more lands\b/i);
  if (landThreshold) {
    const required = wordOrNumberToInt(landThreshold[1]);
    if (required !== undefined && countControlledLands(state, playerId) < required) {
      return false;
    }
  }

  return true;
}

function manaHasSpellCopyRider(oracleText: string): boolean {
  return /\bwhen that mana is spent to cast a red instant or sorcery spell,\s*copy that spell\b/i.test(oracleText);
}

function manaProductionMultiplier(state: GameState, playerId: string, sourceInstanceId: string): number {
  const source = state.cards.get(sourceInstanceId);
  if (!source || source.ownerId !== playerId || source.zone !== 'battlefield') return 1;

  let multiplier = 1;
  for (const permanent of state.cards.values()) {
    if (permanent.ownerId !== playerId || permanent.zone !== 'battlefield') continue;
    const def = getCardDefinition(state, permanent);
    const text = def.oracle_text;
    if (/\bif you tap a permanent(?: you control)? for mana,\s*it produces three times as much/i.test(text)) {
      multiplier *= 3;
    } else if (/\bif you tap a permanent(?: you control)? for mana,\s*it produces twice as much/i.test(text)) {
      multiplier *= 2;
    }
  }
  return multiplier;
}

/**
 * Number of lands the player may play this turn.
 * Defaults to 1, plus one extra per battlefield permanent the player controls
 * whose oracle text reads "you may play an additional land" (Exploration,
 * Mina and Denn, Oracle of Mul Daya, Wayward Swordtooth, Azusa Lost But Seeking, etc.).
 *
 * Note: Azusa says "two additional lands" — we count those occurrences, not just cards.
 */
export function maxLandsThisTurn(state: GameState, playerId: string): number {
  let extra = 0;
  for (const [, card] of state.cards) {
    if (card.zone !== 'battlefield') continue;
    if (card.ownerId !== playerId) continue;
    const def = state.cardDefinitions.get(card.definitionId);
    if (!def) continue;
    const oracle = def.oracle_text.toLowerCase();
    // "play an additional land" → +1
    if (/\byou may play an additional land\b/.test(oracle)) extra += 1;
    // "play two additional lands" → +2 (Azusa, Lost but Seeking)
    const twoMatch = oracle.match(/\byou may play (\d+|two|three|four)\s+additional lands\b/);
    if (twoMatch) {
      const n = twoMatch[1].toLowerCase();
      const TEXT_NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4 };
      const count = /^\d+$/.test(n) ? parseInt(n, 10) : (TEXT_NUMBERS[n] ?? 1);
      extra += Math.max(0, count);
    }
  }
  return 1 + extra;
}

export function canPlayLandDetailed(state: GameState, playerId: string, cardInstanceId: string): LandPlayLegality {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    return { legal: false, code: 'player_not_found', reason: 'Player not found' };
  }

  if (state.activePlayerIndex !== playerIndex) {
    return { legal: false, code: 'not_your_turn', reason: 'Not your turn' };
  }
  if (state.priorityPlayerIndex !== playerIndex) {
    return { legal: false, code: 'priority_not_yours', reason: 'You do not have priority' };
  }
  if (!MAIN_PHASES.includes(state.phase)) {
    return { legal: false, code: 'wrong_phase', reason: 'Lands can only be played during a main phase' };
  }
  if (state.stack.length !== 0) {
    return { legal: false, code: 'stack_not_empty', reason: 'The stack must be empty' };
  }

  const card = state.cards.get(cardInstanceId);
  if (!card || card.ownerId !== playerId) {
    return { legal: false, code: 'card_not_found', reason: 'Card not found or not yours' };
  }
  if (card.zone !== 'hand') {
    return { legal: false, code: 'not_in_zone', reason: 'Card is not in a playable zone' };
  }

  const def = getCardDefinition(state, card);
  if (!def.card_types.includes('land')) {
    return { legal: false, code: 'not_land', reason: 'Not a land' };
  }

  // Treat hasPlayedLand=true as at-least-one even if landsPlayedThisTurn isn't tracked.
  const playedSoFar = Math.max(
    state.players[playerIndex].landsPlayedThisTurn ?? 0,
    state.players[playerIndex].hasPlayedLand ? 1 : 0,
  );
  if (playedSoFar >= maxLandsThisTurn(state, playerId)) {
    return { legal: false, code: 'land_already_played', reason: 'No land plays remaining' };
  }

  return { legal: true };
}

export function canPlayLand(state: GameState, playerId: string, cardInstanceId: string): boolean {
  return canPlayLandDetailed(state, playerId, cardInstanceId).legal;
}

export function playLand(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  options: PlayLandOptions = {},
): GameState {
  if (!canPlayLand(state, playerId, cardInstanceId)) {
    throw new Error('Cannot play land');
  }

  const newCards = new Map(state.cards);
  const card = newCards.get(cardInstanceId)!;
  const def = getCardDefinition(state, card);
  const entryChoices = {
    ...(card.choices || {}),
    ...(options.chosenCreatureType ? { chosenCreatureType: normalizeChoice(options.chosenCreatureType) } : {}),
  };
  const entry = buildBattlefieldEntryPlan(state, playerId, card, def, {
    payLifeToEnterUntapped: options.payLifeToEnterUntapped,
    summoningSick: false,
    choices: Object.keys(entryChoices).length > 0 ? entryChoices : card.choices,
  });
  newCards.set(cardInstanceId, entry.card);

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const newPlayers = entry.players.map((p, i) =>
    i === playerIndex
      ? { ...p, hasPlayedLand: true, landsPlayedThisTurn: (p.landsPlayedThisTurn ?? 0) + 1 }
      : p,
  );

  let resultState: GameState = { ...state, cards: newCards, players: newPlayers };

  // Register any triggered abilities the land might have (e.g., ETB triggers on lands)
  resultState = registerBattlefieldAbilities(resultState, cardInstanceId);

  // Fire landfall triggers ("Whenever a land enters the battlefield under your control")
  resultState = checkTriggersForEvent(resultState, {
    kind: 'LandETB',
    instanceId: cardInstanceId,
    controllerId: playerId,
  });

  return resultState;
}

export function entersTheBattlefieldTappedForTest(oracleText: string): boolean {
  return entersTheBattlefieldTapped(oracleText);
}

export function getOptionalUntappedLifeCostForTest(oracleText: string): number | undefined {
  return getOptionalUntappedLifeCost(oracleText);
}

function normalizeChoice(choice: string): string {
  return choice.trim().replace(/\s+/g, ' ');
}

export function tapLandForMana(state: GameState, playerId: string, cardInstanceId: string, color: ManaColor): GameState {
  const card = state.cards.get(cardInstanceId);
  if (!card) throw new Error('Card not found');
  if (card.ownerId !== playerId) throw new Error('Not your card');

  let def = getCardDefinition(state, card);
  if (!def.manaProduction) {
    const parsedDef = populateParsedCache(def);
    if (parsedDef.manaProduction) {
      const hydratedDefinitions = new Map(state.cardDefinitions);
      hydratedDefinitions.set(parsedDef.id, parsedDef);
      state = { ...state, cardDefinitions: hydratedDefinitions };
      def = parsedDef;
    }
  }
  if (!def.manaProduction) throw new Error('Card has no mana ability');
  if (!getAvailableManaColors(state, cardInstanceId).includes(color)) throw new Error('Cannot produce chosen color');

  const handExileAbility = def.manaProduction?.activationZone === 'hand'
    && def.manaProduction?.requiresExileFromHand === true;
  if (handExileAbility) {
    if (card.zone !== 'hand') throw new Error('Card not in hand');
  } else {
    if (card.zone !== 'battlefield') throw new Error('Card not on battlefield');
    if (def.manaProduction?.isTapAbility && card.tapped) throw new Error('Card already tapped');
    if (def.manaProduction?.isTapAbility && isBlockedBySummoningSicknessForTap(state, cardInstanceId)) {
      throw new Error('Summoning sick');
    }
  }

  let amount = def.manaProduction?.amounts[color] ?? 1;
  if (def.manaProduction?.amountScale === 'creaturesYouControl') {
    amount *= [...state.cards.values()].filter(instance => {
      if (instance.ownerId !== playerId || instance.zone !== 'battlefield') return false;
      const cardDef = state.cardDefinitions.get(instance.definitionId);
      return cardDef?.card_types.includes('creature');
    }).length;
  }
  amount *= manaProductionMultiplier(state, playerId, cardInstanceId);

  // Sacrifice-cost mana abilities (Lotus Petal, Tinder Wall, Lotus Bloom, etc.)
  // move the paid permanent away as part of activation. A few silver-bordered
  // old-text cards say to remove the pieces from the game, which we model as
  // exile rather than graveyard.
  const requiresSacrifice = def.manaProduction?.requiresSacrifice === true;
  const sacrificeDestination = def.manaProduction?.exileAfterUse ? 'exile' : 'graveyard';

  const newCards = new Map(state.cards);
  const sacrificeFilter = def.manaProduction?.sacrificeFilter;
  if (sacrificeFilter) {
    const candidates = [...newCards.values()]
      .filter(candidate => {
        if (candidate.instanceId === cardInstanceId) return false;
        if (candidate.ownerId !== playerId || candidate.zone !== 'battlefield') return false;
        const candidateDef = state.cardDefinitions.get(candidate.definitionId);
        return !!candidateDef && matchesCardFilter(candidateDef, sacrificeFilter);
      });
    const sacrificed = candidates[0];
    if (!sacrificed) throw new Error('No sacrifice candidate');
    const destination = getCommanderDestinationZone(state, sacrificed.instanceId, 'graveyard');
    newCards.set(sacrificed.instanceId, {
      ...sacrificed,
      zone: destination,
      tapped: false,
      damage: 0,
      counters: {},
    });
  }

  const sourceAfterCosts = newCards.get(cardInstanceId);
  if (sourceAfterCosts && sourceAfterCosts.zone === 'battlefield') {
    newCards.set(cardInstanceId, {
      ...sourceAfterCosts,
      tapped: handExileAbility ? false : def.manaProduction?.isTapAbility ? true : sourceAfterCosts.tapped,
      zone: handExileAbility
        ? getCommanderDestinationZone(state, cardInstanceId, 'exile')
        : requiresSacrifice
          ? getCommanderDestinationZone(state, cardInstanceId, sacrificeDestination)
          : sourceAfterCosts.zone,
    });
  } else if (handExileAbility || requiresSacrifice) {
    newCards.set(cardInstanceId, {
      ...card,
      tapped: false,
      zone: getCommanderDestinationZone(state, cardInstanceId, handExileAbility ? 'exile' : sacrificeDestination),
    });
  }

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const sourceProducesSnowMana = /\bsnow\b/i.test(def.type_line);
  const newPlayers = state.players.map((p, i) => {
    if (i !== playerIndex) return p;
    const withMana = {
      ...p,
      manaPool: addMana(p.manaPool, color, amount),
      ...(sourceProducesSnowMana
        ? { snowManaPool: addMana(p.snowManaPool || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, color, amount) }
        : {}),
    };
    const withRestriction = addRestrictedMana(withMana, color, amount, def.manaProduction?.restriction, {
      sourceInstanceId: cardInstanceId,
      creatureType: card.choices?.chosenCreatureType,
      snow: sourceProducesSnowMana,
    });
    if (manaHasSpellCopyRider(def.oracle_text)) {
      return addConditionalMana(withRestriction, color, amount, 'copyRedInstantOrSorcery', {
        sourceInstanceId: cardInstanceId,
        snow: sourceProducesSnowMana,
      });
    }
    return withRestriction;
  });

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

export function isBlockedBySummoningSicknessForTap(
  state: GameState,
  cardInstanceId: string,
): boolean {
  const card = state.cards.get(cardInstanceId);
  if (!card || card.zone !== 'battlefield' || !card.summoningSick) return false;

  const def = getCardDefinition(state, card);
  if (!def.card_types.includes('creature')) return false;

  return !instanceHasKeyword(state, cardInstanceId, 'Haste');
}

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
  if (ability.cost.tap && isBlockedBySummoningSicknessForTap(state, cardInstanceId)) return false;

  // Check mana cost
  if (ability.cost.mana) {
    const player = state.players.find(p => p.id === playerId);
    if (!player) return false;
    const manaCost = parseManaString(ability.cost.mana);
    if (!canPayUnrestrictedCost(player, manaCost)) return false;
  }

  if (ability.cost.payLife) {
    const player = state.players.find(p => p.id === playerId);
    if (!player || player.life < ability.cost.payLife) return false;
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
    const paidPlayer = payUnrestrictedManaCost(player, manaCost);
    const newPlayers = newState.players.map((p, i) =>
      i === playerIndex ? paidPlayer : p
    );
    newState = { ...newState, players: newPlayers };
  }

  // Pay life cost
  if (ability.cost.payLife) {
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    const newPlayers = newState.players.map((p, i) =>
      i === playerIndex ? { ...p, life: p.life - ability.cost.payLife! } : p
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
    newState = applyWardForStackItem(newState, stackItem, playerId, targets);
  }

  return newState;
}

// ============================================================================
// Equipment
// ============================================================================

/**
 * Equip an equipment to a creature you control.
 * Pays the equip cost and attaches the equipment.
 */
export function equipCreature(
  state: GameState,
  playerId: string,
  equipmentInstanceId: string,
  targetCreatureId: string,
): GameState {
  const equipment = state.cards.get(equipmentInstanceId);
  if (!equipment || equipment.zone !== 'battlefield') throw new Error('Equipment not on battlefield');
  if (equipment.ownerId !== playerId) throw new Error('Not your equipment');

  const equipDef = getCardDefinition(state, equipment);
  if (!equipDef.equipCost) throw new Error('No equip cost');
  const costAsMana = { W: equipDef.equipCost.W, U: equipDef.equipCost.U, B: equipDef.equipCost.B, R: equipDef.equipCost.R, G: equipDef.equipCost.G, C: equipDef.equipCost.C, generic: equipDef.equipCost.generic };

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];

  // Pay equip cost
  const paidPlayer = payUnrestrictedManaCost(player, costAsMana);

  const target = state.cards.get(targetCreatureId);
  if (!target || target.zone !== 'battlefield') throw new Error('Target not on battlefield');
  if (target.ownerId !== playerId) throw new Error('Can only equip your own creatures');

  if (!isEffectiveCreature(state, targetCreatureId)) throw new Error('Target is not a creature');

  const newCards = new Map(state.cards);
  newCards.set(equipmentInstanceId, { ...equipment, attachedTo: targetCreatureId });

  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? paidPlayer : p
  );

  return { ...state, cards: newCards, players: newPlayers };
}
