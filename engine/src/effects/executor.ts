// Phase 4: Effect executor - applies Effect AST to GameState
// Phase 10: Extended with new effect types, X costs, tokens
// Phase 14: Extended with ExileFromLibrary, GainControl, ForEach, EachPlayer, AllOfType
// Phase 17: Conditional, Blink, Copy, GrantKeyword, PhaseOut, loyalty ability execution

import type { GameState, CardInstance, CardDefinition, PendingTrigger, TriggeredAbilityRef, Zone, DiceRollRecord, SpellCastProhibitionRef, SpellCostTaxRef, SpellStackItem } from '../types';
import { isSpellStackItem } from '../types';
import { nextId, randomIntInclusive, shuffleInPlace, shuffled } from '../rng';
import type { Effect, TargetRef, AmountRef, TokenDefinition, CardFilter, SurveilEffect, ForEachAmount, Condition, LoyaltyAbility, EnterAsCopyEffect, GrantCantBeCounteredEffect, MVSumAmount, SetBasePTEffect, BecomesCopyEffect, GreatestToughnessAmount } from './ast';
import { getCardDefinition, getCardsInZone, pruneDetachedEffects } from '../game-state';
import { checkStateBasedActions, markPlayerLostFromEmptyLibrary } from '../state-based';
import { instanceHasKeyword, isIndestructible, isProtectedFromSource } from '../keywords';
import { getCommanderDestinationZone, isOwnersCommander } from '../commander';
import { applyDamageReplacementEffects, applyReplacements, getSelfDieReplacementZone, registerDamagePrevention } from './replacement';
import type { ReplacementEvent } from './replacement';
import { getEffectivePower, getEffectiveToughness, getEffectiveColors } from './continuous';
import { isEffectiveCreature, countDevotionToColors } from '../effective-types';
import { buildBattlefieldEntryPlan } from '../permanent-entry';
import { parseOracleText } from './parser';
import { getOverride } from './overrides';
import type { TargetSpec } from './targets';
import { typeLineHasSubtype, typeLineHasSupertype, typeLineHasType } from '../type-line';
import { populateParsedCache } from '../cards/card-parser-cache';
import { playerCantLose, playerCantWin, playerCantLoseLife, registerGameOutcomePrevention } from '../game-outcome';
import { parseManaString, canPayUnrestrictedCost, payUnrestrictedManaCost } from '../mana';
import { matchTurnedFaceUpPrefix } from './matchers/trigger-prefixes';

/**
 * Context for effect execution, includes X value from spell casting.
 */
export interface ExecutionContext {
  casterId: string;
  chosenTargets: Map<string, string>;
  /**
   * spec.id -> ALL chosen target ids for that spec, in choice order. For
   * single-target specs this holds one id (mirrors chosenTargets). For
   * multi-target specs ("up to N target creatures") it holds every chosen id,
   * letting effects like Tap/Destroy/Exile apply to each chosen target rather
   * than only the first. Built alongside chosenTargets in executeEffects.
   */
  chosenTargetsMulti: Map<string, string[]>;
  xValue: number;
  namedCardChoices: Map<string, string>;
  sourceInstanceId?: string;
  eventContext?: {
    casterId?: string;
    cardInstanceId?: string;
    eventPlayerId?: string; // "that player" — the player tied to the triggering event
    eventDamageAmount?: number; // Slice 5: the damage amount from a DealsDamage trigger
    /** Slice 11 (intervening-if ETB): true when the permanent entered via being cast. */
    enteredViaCast?: boolean;
    /**
     * Slice 6 (combat-damage trigger bodies): snapshot of attacker instanceIds
     * captured at the time combat damage was dealt (before combat state is cleared).
     * Used by AllAttackingCreaturesYouControl executor branch.
     */
    attackerInstanceIds?: string[];
  };
  /**
   * Set by the RevealTopMatch executor when it moves a card. Used by
   * { kind: 'RevealedTopCardManaValue' } AmountRefs in sibling effects within
   * the same chain (Dark Confidant / Pain Seer family).
   */
  lastRevealedCardManaValue?: number;
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
  sourceInstanceId?: string,
  eventPlayerId?: string,
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
    return resolveForEachCount(amount, state, casterId, chosenTargets, sourceInstanceId, eventPlayerId);
  }
  if (amount.kind === 'DomainCount') {
    // Domain (CR 700.13): the number of basic land types among lands you control.
    if (!state || !casterId) return 0;
    const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
    let domain = 0;
    for (const basicType of BASIC_LAND_TYPES) {
      for (const card of state.cards.values()) {
        if (card.zone !== 'battlefield' || card.ownerId !== casterId) continue;
        const def = getCardDefinition(state, card);
        const isLand = def.card_types.includes('land') || typeLineHasType(def.type_line, 'land');
        if (isLand && typeLineHasSubtype(def.type_line, basicType)) {
          domain++;
          break;
        }
      }
    }
    return domain;
  }
  if (amount.kind === 'GreatestPower') {
    return resolveGreatestPower(amount, state, casterId, sourceInstanceId);
  }
  if (amount.kind === 'GreatestToughness') {
    return resolveGreatestToughness(amount, state, casterId);
  }
  if (amount.kind === 'GreatestManaValue') {
    return resolveGreatestManaValue(amount, state, casterId);
  }
  if (amount.kind === 'TargetPower') {
    if (!state || !casterId) return 0;
    const resolvedTargetId = targetId ?? resolveTargetRef(amount.target, casterId, chosenTargets, state);
    const basePower = getEffectivePower(state, resolvedTargetId);
    return amount.multiplier !== undefined ? basePower * amount.multiplier : basePower;
  }
  if (amount.kind === 'RevealedTopCardManaValue') {
    // Resolved from the execution context by the caller (executeEffect).
    // Falls back to 0 if no card was revealed (e.g., empty library).
    return 0;
  }
  if (amount.kind === 'RevealedRandomCardManaValue') {
    // Slice 4: Planeswalker's Favor/Fury family — "equal to that card's mana value".
    // Resolved from ctx.lastRevealedCardManaValue (set by RevealRandomCardFromHand).
    // Falls back to 0 when no random reveal preceded this effect.
    return 0;
  }
  if (amount.kind === 'EventPlayerHandCount') {
    // Slice 11: Dreamborn Muse family — count cards in EventPlayer's hand.
    // Resolved inline here; requires caller to pass eventPlayerId separately
    // since resolveAmount does not receive eventContext. Callers that need this
    // should handle EventPlayerHandCount before calling resolveAmount (see Mill).
    return 0;
  }
  if (amount.kind === 'EventDamageAmount') {
    // Slice 5: pre-errata lifelink / Guilty Conscience family — "you gain that
    // much life" / "deals that much damage".  Resolved by the caller by reading
    // eventContext.eventDamageAmount before invoking resolveAmount; falls back
    // to 0 here (safe no-op) when there is no event context.
    return 0;
  }
  if (amount.kind === 'EventCreatureStat') {
    // Slice 10: "equal to that creature's toughness/power" — live P/T of the
    // creature from the triggering event (eventContext.cardInstanceId).
    if (!state || !eventCardInstanceId) return 0;
    return amount.stat === 'power'
      ? getEffectivePower(state, eventCardInstanceId)
      : getEffectiveToughness(state, eventCardInstanceId);
  }
  if (amount.kind === 'LifeTotal') {
    // Slice 6: Eternity Vessel family — "where X is your life total."
    if (!state || !casterId) return 0;
    const player = state.players.find(p => p.id === casterId);
    return player?.life ?? 0;
  }
  if (amount.kind === 'MVSum') {
    // Slice 10: "where X is the total mana value of <filter> in <zone>."
    return resolveMVSum(amount, state, casterId);
  }
  if (amount.kind === 'HalfLifeRoundedUp') {
    // Slice 11: Havoc Festival family — "loses half their life, rounded up."
    // Per-player resolution is handled inline in the EachPlayer / EachOpponent
    // LoseLife loop (where the individual player's life total is available).
    // For any other calling context (e.g. a single-player LoseLife), fall back to
    // half the caster's own life total, rounded up.
    if (!state || !casterId) return 0;
    const lifeCasterPlayer = state.players.find(p => p.id === casterId);
    return lifeCasterPlayer ? Math.ceil(lifeCasterPlayer.life / 2) : 0;
  }
  if (amount.kind === 'SacrificedCreaturePower') {
    // Brion Stoutarm family: resolved in DealDamage/GainLife executor cases directly
    // from namedCardChoices. This fallback (0) is reached only when resolveAmount is
    // called without namedCardChoices context — safe no-op.
    return 0;
  }
  if (amount.kind === 'SpellsCastThisTurn') {
    // Slice 4: Storm Entity — "for each [other] spell cast this turn."
    // state.spellsCastThisTurn is incremented by castSpell in stack.ts; when
    // excludeSelf is true the spell that put this creature onto the battlefield
    // is NOT counted (Storm Entity's own cast does not count itself as "other").
    if (!state) return 0;
    const total = state.spellsCastThisTurn ?? 0;
    return amount.excludeSelf ? Math.max(0, total - 1) : total;
  }
  if (amount.kind === 'DevotionCount') {
    // Slice 4 (devotion): "equal to your devotion to <color(s)>" — sum of
    // colored mana symbols among permanents the controller has on the battlefield.
    if (!state || !casterId) return 0;
    return countDevotionToColors(state, casterId, amount.colors);
  }
  if (amount.kind === 'BaseMinusCount') {
    // Slice 7: Wheel of Torture / Storm World / Rackling / Viseling family.
    // "where X is N minus the number of <filter> in <zone>" — base minus a
    // ForEach count, clamped to 0 so damage is never negative.
    const counted = resolveForEachCount(amount.count, state, casterId, chosenTargets, sourceInstanceId, eventPlayerId);
    return Math.max(0, amount.base - counted);
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

function resolveForEachControllerIds(
  state: GameState,
  casterId: string,
  forEach: ForEachAmount,
  chosenTargets: Map<string, string>,
  eventPlayerId?: string,
): string[] {
  if (forEach.controller === 'target') {
    if (!forEach.target) return [];
    const targetId = resolveTargetRef(forEach.target, casterId, chosenTargets, state);
    return state.players.some(player => player.id === targetId && !player.hasLost)
      ? [targetId]
      : [];
  }
  // Slice 12: pestilence-style "equal to the number of <filter> they control" —
  // "they" is the per-player-upkeep event player.
  if (forEach.controller === 'eventPlayer') {
    const epId = eventPlayerId ?? casterId;
    return state.players.some(p => p.id === epId && !p.hasLost) ? [epId] : [];
  }
  return resolveControllerIds(state, casterId, forEach.controller);
}

/**
 * Count entities matching a ForEachAmount condition.
 */
function resolveForEachCount(
  forEach: ForEachAmount,
  state?: GameState,
  casterId?: string,
  chosenTargets: Map<string, string> = new Map(),
  sourceInstanceId?: string,
  eventPlayerId?: string,
): number {
  if (!state || !casterId) return 0;

  let count = 0;
  const { zone, filter } = forEach;

  // Slice 9: resolve namesSelf → build a names filter from the source card's name.
  let resolvedFilter = filter;
  if (filter?.namesSelf) {
    const sourceCard = sourceInstanceId ? state.cards.get(sourceInstanceId) : undefined;
    const sourceDef = sourceCard ? getCardDefinition(state, sourceCard) : undefined;
    if (!sourceDef) return 0;
    const { namesSelf: _, ...rest } = filter;
    resolvedFilter = { ...rest, names: [sourceDef.name] };
  }

  const playerIds = resolveForEachControllerIds(state, casterId, forEach, chosenTargets, eventPlayerId);

  for (const [, card] of state.cards) {
    if (card.zone !== zone) continue;
    if (!playerIds.includes(card.ownerId)) continue;

    if (resolvedFilter) {
      const def = getCardDefinition(state, card);
      const filterWithoutPower = { ...resolvedFilter };
      delete filterWithoutPower.power;
      if (!matchesCardFilter(def, filterWithoutPower)) continue;
      if (resolvedFilter.power) {
        const effectivePower = (def.power ?? 0)
          + (card.counters['+1/+1'] || 0)
          - (card.counters['-1/-1'] || 0)
          + (card.counters['_powerMod'] || 0);
        if (!matchesNumericFilter(effectivePower, resolvedFilter.power)) continue;
      }
      // Slice 7 (untapped-land counting): instance-level tapped check.
      // matchesCardFilter operates on card definitions only; tapped state is
      // checked here against the live card instance (card.tapped).
      // filter.tapped===false → count only untapped cards (Citadel of Pain / Power Surge).
      // filter.tapped===true  → count only tapped cards.
      if (resolvedFilter.tapped !== undefined && card.tapped !== resolvedFilter.tapped) continue;
    }

    count++;
  }

  // Slice 6/12: "twice the number of <filter>" — multiply the raw count by the
  // optional multiplier stored on the ForEachAmount (e.g. multiplier: 2).
  return count * (forEach.multiplier ?? 1);
}

function resolveGreatestPower(
  amount: Extract<AmountRef, { kind: 'GreatestPower' }>,
  state?: GameState,
  casterId?: string,
  sourceInstanceId?: string,
): number {
  if (!state || !casterId) return 0;

  let greatest = 0;
  const playerIds = resolveControllerIds(state, casterId, amount.controller);
  for (const [, card] of state.cards) {
    if (card.zone !== amount.zone) continue;
    if (!playerIds.includes(card.ownerId)) continue;
    // Slice 7: "other [subtypes]" — exclude the source permanent itself.
    if (amount.notSource && sourceInstanceId && card.instanceId === sourceInstanceId) continue;
    const def = getCardDefinition(state, card);
    if (amount.filter && !matchesCardFilter(def, amount.filter)) continue;
    greatest = Math.max(greatest, getEffectivePower(state, card.instanceId));
  }
  return greatest;
}

/**
 * Slice 4/CBC: resolve "the greatest toughness among <filter> you control" —
 * mirrors resolveGreatestPower but scans effective toughness instead of power.
 */
function resolveGreatestToughness(
  amount: GreatestToughnessAmount,
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
    greatest = Math.max(greatest, getEffectiveToughness(state, card.instanceId));
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
 * Slice 10: Sum the mana values (cmc) of all matching cards in the zone.
 * Used by MVSumAmount ("the total mana value of instant and sorcery cards in your graveyard").
 */
function resolveMVSum(
  amount: MVSumAmount,
  state?: GameState,
  casterId?: string,
): number {
  if (!state || !casterId) return 0;

  let total = 0;
  const playerIds = resolveControllerIds(state, casterId, amount.controller);
  for (const [, card] of state.cards) {
    if (card.zone !== amount.zone) continue;
    if (!playerIds.includes(card.ownerId)) continue;
    const def = getCardDefinition(state, card);
    if (amount.filter && !matchesCardFilter(def, amount.filter)) continue;
    total += def.cmc ?? 0;
  }
  return total;
}

/**
 * Resolve a TargetRef to a concrete ID or IDs.
 * For 'Controller', we need the caster's ID.
 */
/**
 * Resolve ALL chosen ids for a {kind:'Chosen'} target ref, honoring multi-target
 * specs ("up to N target creatures"). For any other ref kind, or when no
 * multi-map entry exists, falls back to the single resolved id. Used by effects
 * (Tap/Destroy/Exile) that must apply to every chosen target, not just the first.
 */
function resolveChosenTargetIds(
  ref: TargetRef,
  casterId: string,
  chosenTargets: Map<string, string>,
  chosenTargetsMulti: Map<string, string[]>,
  state?: GameState,
  eventContext?: ExecutionContext['eventContext'],
): string[] {
  if (ref.kind === 'Chosen') {
    const ids = chosenTargetsMulti.get(ref.targetId);
    if (ids && ids.length > 0) return ids;
  }
  return [resolveTargetRef(ref, casterId, chosenTargets, state, eventContext)];
}

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
    case 'AllOtherCreatures':
      throw new Error('AllOtherCreatures must be handled before calling resolveTargetRef');
    case 'AllAttackingCreatures':
      throw new Error('AllAttackingCreatures must be handled before calling resolveTargetRef');
    case 'AllAttackingCreaturesYouControl':
      throw new Error('AllAttackingCreaturesYouControl must be handled before calling resolveTargetRef');
    case 'AllCreaturesYouControl':
      throw new Error('AllCreaturesYouControl must be handled before calling resolveTargetRef');
    case 'AllCreaturesYouControlMatching':
      throw new Error('AllCreaturesYouControlMatching must be handled before calling resolveTargetRef');
    case 'AllOfType':
      throw new Error('AllOfType must be handled before calling resolveTargetRef');
    case 'Source':
      throw new Error('Source target must be handled with effect execution context');
    case 'SourceAttachedTo':
      throw new Error('SourceAttachedTo target must be handled with effect execution context');
    case 'EventCaster':
      // The player tied to the triggering event. Returns '' (safe no-op for callers)
      // when there is no event context, rather than throwing.
      return eventContext?.casterId ?? '';
    case 'EventPlayer':
      // "that player" — the player tied to the triggering event (an upkeep's
      // active player, a cast spell's caster, the controller of a land tapped
      // for mana). Returns '' (safe no-op) when there is no event context.
      return eventContext?.eventPlayerId ?? '';
    case 'EventSpell':
      if (!eventContext?.cardInstanceId) {
        throw new Error('EventSpell target requires trigger event context');
      }
      return eventContext.cardInstanceId;
    case 'EventCreature':
      // The creature involved in the triggering event ("that creature"). Returns
      // '' when there is no event context so callers no-op rather than crash.
      return eventContext?.cardInstanceId ?? '';
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
    newCards.set(card.instanceId, {
      ...card,
      zone: getCommanderDestinationZone(currentState, card.instanceId, 'hand'),
      tapped: false,
      damage: 0,
      counters: {},
    });
  }

  return { ...currentState, cards: newCards };
}

/**
 * Execute a Destroy effect.
 */
function executeDestroy(state: GameState, targetId: string, noRegen = false): GameState {
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

  // Regeneration shield (CR 701.18): replace this destruction — tap, remove damage,
  // remove from combat, consume one shield. Bypassed by "can't be regenerated".
  const shields = card.regenerationShields ?? 0;
  if (shields > 0 && !noRegen) {
    const regenCards = new Map(state.cards);
    regenCards.set(targetId, { ...card, regenerationShields: shields - 1, damage: 0, deathtouchDamage: undefined, tapped: true });
    let s: GameState = { ...state, cards: regenCards };
    if (s.combat) {
      s = {
        ...s,
        combat: {
          ...s.combat,
          attackers: s.combat.attackers.filter(a => a.cardInstanceId !== targetId),
          blockers: s.combat.blockers.filter(b => b.cardInstanceId !== targetId),
        },
      };
    }
    return s;
  }

  const destZone = getDeathDestination(state, targetId, card);
  if (!destZone) return state;
  const newCards = new Map(state.cards);
  newCards.set(targetId, {
    ...card,
    zone: destZone,
    damage: 0,
    deathtouchDamage: undefined,
    tapped: false,
    counters: {},
    grantedKeywords: undefined,
    lostKeywords: undefined,
  });

  return pruneDetachedEffects({ ...state, cards: newCards });
}

function getDeathDestination(state: GameState, cardInstanceId: string, card: CardInstance): Zone | null {
  const commanderDestination = getCommanderDestinationZone(state, cardInstanceId, 'graveyard');
  if (commanderDestination !== 'graveyard') return commanderDestination;
  if (!isEffectiveCreature(state, cardInstanceId)) return 'graveyard';

  // Self die-replacement printed on the card itself ("If ~ would die, exile it instead").
  const selfZone = getSelfDieReplacementZone(getCardDefinition(state, card));
  if (selfZone) return selfZone;

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
  if (state.cards.has(targetId) && isProtectedFromSource(state, targetId, sourceInstanceId)) {
    return state;
  }

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

  // Slice 12 (en-Kor redirect): if a redirect shield changed the target, use
  // the new targetId from the replacement event rather than the original.
  const effectiveTargetId = replaced.targetId ?? targetId;

  // Check if target is a player
  const playerIndex = replacedState.players.findIndex(p => p.id === effectiveTargetId);
  if (playerIndex !== -1) {
    if (playerCantLoseLife(replacedState, effectiveTargetId)) return replacedState;
    const newPlayers = replacedState.players.map((p, i) =>
      i === playerIndex ? { ...p, life: p.life - finalAmount } : p
    );
    const playerDamageState = { ...replacedState, players: newPlayers };
    // Slice 5: fire DealsDamage triggers for "Whenever this creature deals damage" family.
    if (sourceInstanceId) {
      return enqueueDealsDamageTriggers(playerDamageState, sourceInstanceId, finalAmount);
    }
    return playerDamageState;
  }

  // Target is a card (creature)
  const card = replacedState.cards.get(effectiveTargetId);
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
  newCards.set(effectiveTargetId, {
    ...card,
    damage: card.damage + finalAmount,
    deathtouchDamage: card.deathtouchDamage || sourceHasDeathtouch,
  });

  const creatureDamageState = pruneDetachedEffects({ ...replacedState, cards: newCards });
  // Slice 5: fire DealsDamage triggers for "Whenever this creature deals damage" family.
  if (sourceInstanceId) {
    return enqueueDealsDamageTriggers(creatureDamageState, sourceInstanceId, finalAmount);
  }
  return creatureDamageState;
}

function executePreventDamage(
  state: GameState,
  effect: Extract<Effect, { kind: 'PreventDamage' }>,
  casterId: string,
  sourceInstanceId?: string,
  xValue = 0,
  chosenTargets: Map<string, string> = new Map(),
): GameState {
  let protectedTargetId: string | undefined;
  if (effect.target) {
    // Slice 10: Source and SourceAttachedTo cannot go through resolveTargetRef
    // (it throws). Handle them directly:
    // - Source → the source permanent itself (self-protection activated ability)
    // - SourceAttachedTo → the creature this Aura/Equipment is attached to
    if (effect.target.kind === 'Source') {
      protectedTargetId = sourceInstanceId;
    } else if (effect.target.kind === 'SourceAttachedTo') {
      protectedTargetId = getSourceAttachedTo(state, sourceInstanceId) ?? undefined;
    } else {
      protectedTargetId = resolveTargetRef(effect.target, casterId, chosenTargets, state);
    }
  }
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

function stripKeywordAbilityPrefix(oracleText: string): string {
  return oracleText.replace(
    /^(?!Choose\b)[A-Z][A-Za-z\-]*(?:\s+[a-z]+){0,2}\s+[â€”â€“-]\s+/gm,
    '',
  );
}

function normalizeTriggeredOracleLine(oracleText: string, cardName: string): string {
  let text = stripKeywordAbilityPrefix(oracleText);
  if (!cardName) return text;

  const escaped = cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  text = text.replace(new RegExp(escaped, 'gi'), '~');
  const shortName = cardName.split(',')[0]?.trim();
  if (shortName && shortName.length >= 3 && shortName !== cardName) {
    const escapedShort = shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\b${escapedShort}\\b`, 'gi'), '~');
  }
  return text;
}

function hasProwessAbility(def: CardDefinition): boolean {
  return def.keywords.some(keyword => keyword.toLowerCase() === 'prowess')
    || /(^|\n)\s*prowess\b/i.test(def.oracle_text);
}

function targetSpecsForTriggerKind(
  state: GameState,
  card: CardInstance,
  triggerKind: TriggeredAbilityRef['trigger']['kind'],
): TargetSpec[] {
  const def = getCardDefinition(state, card);
  for (const line of def.oracle_text.split('\n')) {
    const parsed = parseOracleText(normalizeTriggeredOracleLine(line.trim(), def.name));
    if (
      (parsed.kind === 'Triggered' || parsed.kind === 'ETB' || parsed.kind === 'Dies') &&
      parsed.ability.trigger.kind === triggerKind
    ) {
      return parsed.targets;
    }
  }
  return [];
}

function registerBattlefieldAbilitiesAfterDirectEntry(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card || card.zone !== 'battlefield') return state;
  const def = getCardDefinition(state, card);
  const abilitiesToAdd: TriggeredAbilityRef[] = [];

  if (hasProwessAbility(def)) {
    abilitiesToAdd.push({
      kind: 'TriggeredAbility',
      trigger: { kind: 'CastNoncreatureSpell' },
      effects: [{
        kind: 'ModifyPT',
        target: { kind: 'Source' },
        power: 1,
        toughness: 1,
        untilEndOfTurn: true,
      }],
    } as TriggeredAbilityRef);
  }

  if (def.unlessTax) {
    const trigger = { kind: def.unlessTax.triggerKind as 'OpponentCastSpell' | 'CardDrawn' };
    const taxEffects: Effect[] = def.unlessTax.effect === 'draw'
      ? [{ kind: 'Draw', player: { kind: 'Controller' }, count: def.unlessTax.effectCount }]
      : def.unlessTax.effect === 'treasure'
        ? [{
            kind: 'CreateToken',
            controller: { kind: 'Controller' },
            token: {
              name: 'Treasure',
              colors: [],
              types: ['artifact'],
              subtypes: ['Treasure'],
              power: 0,
              toughness: 0,
            },
            count: def.unlessTax.effectCount,
          }]
        : [];
    abilitiesToAdd.push({
      kind: 'TriggeredAbility',
      trigger,
      effects: taxEffects,
    } as TriggeredAbilityRef);
  }

  const override = getOverride(def.id, def.name);
  if (override && override.kind === 'ETB') {
    abilitiesToAdd.push({
      ...(override.ability as TriggeredAbilityRef),
      targets: override.targets,
    });
  }

  for (const line of def.oracle_text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = parseOracleText(normalizeTriggeredOracleLine(trimmed, def.name));

    if (parsed.kind === 'ETB') {
      if (!override || override.kind !== 'ETB') {
        abilitiesToAdd.push({
          ...(parsed.ability as TriggeredAbilityRef),
          targets: parsed.targets,
        });
      }
      if (/^whenever\s+~\s+enters\s+or\s+attacks\b/i.test(normalizeTriggeredOracleLine(trimmed, def.name))) {
        abilitiesToAdd.push({
          ...(parsed.ability as TriggeredAbilityRef),
          trigger: { kind: 'Attacks', who: 'self' },
          targets: parsed.targets,
        });
      }
    } else if (parsed.kind === 'Dies') {
      abilitiesToAdd.push({
        ...(parsed.ability as TriggeredAbilityRef),
        targets: parsed.targets,
      });
    } else if (parsed.kind === 'Triggered') {
      const parsedTriggerKind = (parsed.ability as TriggeredAbilityRef).trigger.kind;
      const alreadyRegistered = abilitiesToAdd.some(ability => ability.trigger.kind === parsedTriggerKind);
      if (!alreadyRegistered) {
        abilitiesToAdd.push({
          ...(parsed.ability as TriggeredAbilityRef),
          targets: parsed.targets,
        });
      }
    }
  }

  const battlefieldAbilities = new Map(state.battlefieldAbilities || new Map());
  battlefieldAbilities.delete(instanceId);
  if (abilitiesToAdd.length > 0) {
    battlefieldAbilities.set(instanceId, abilitiesToAdd);
  }
  return { ...state, battlefieldAbilities };
}

function queueSelfETBTriggersAfterDirectEntry(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card || card.zone !== 'battlefield') return state;
  const abilities = state.battlefieldAbilities.get(instanceId);
  if (!abilities || abilities.length === 0) return state;

  const pendingTriggers: PendingTrigger[] = [...(state.pendingTriggers || [])];
  for (const ability of abilities) {
    const isETBSelf = ability.trigger.kind === 'ETB' && ability.trigger.who === 'self';
    const isSelfOrAnother = ability.trigger.kind === 'SelfOrAnotherSubtypeETB';
    if (!isETBSelf && !isSelfOrAnother) continue;
    pendingTriggers.push({
      id: `trigger_direct_etb_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      sourceInstanceId: instanceId,
      controllerId: card.ownerId,
      ability,
      requiredTargets: (ability.targets as TargetSpec[] | undefined) || targetSpecsForTriggerKind(state, card, 'ETB'),
    });
  }
  return { ...state, pendingTriggers };
}

function queueEntryTriggersForOtherPermanents(state: GameState, enteredInstanceId: string): GameState {
  const entered = state.cards.get(enteredInstanceId);
  if (!entered || entered.zone !== 'battlefield') return state;
  const enteredDef = getCardDefinition(state, entered);
  const enteredIsCreature = enteredDef.card_types.includes('creature');
  const enteredIsLand = enteredDef.card_types.includes('land');
  const enteredIsEquipment = enteredDef.isEquipment === true;
  // Slice-7: respect nonLegendary flag set by "except it isn't legendary" rider.
  const enteredIsLegendary = typeLineHasSupertype(enteredDef.type_line, 'legendary') && !entered.nonLegendary;
  // Slice 7: Equipment can trigger SelfOrAnotherSubtypeETB('equipment') on others.
  // Slice 2: Legendary permanents can trigger AnotherLegendaryPermanentETB on others.
  if (!enteredIsCreature && !enteredIsLand && !enteredIsEquipment && !enteredIsLegendary) return state;

  const pendingTriggers: PendingTrigger[] = [...(state.pendingTriggers || [])];
  const battlefieldAbilities = state.battlefieldAbilities || new Map();

  for (const [sourceInstanceId, abilities] of battlefieldAbilities) {
    if (sourceInstanceId === enteredInstanceId) continue;
    const sourceCard = state.cards.get(sourceInstanceId);
    if (!sourceCard || sourceCard.zone !== 'battlefield') continue;
    const controllerId = sourceCard.ownerId;

    for (const ability of abilities) {
      const trigger = ability.trigger;
      let shouldFire = false;

      if (enteredIsCreature && trigger.kind === 'AnotherCreatureETB' && trigger.controller === 'yours' && entered.ownerId === controllerId) {
        shouldFire = (!trigger.nontoken || !entered.isToken) && (!trigger.tokenOnly || entered.isToken === true);
      }

      // Slice 7: "Whenever this creature or another <Subtype> you control enters"
      // Fires for OTHER permanents (self-entering is handled in queueSelfETBTriggersAfterDirectEntry).
      if (trigger.kind === 'SelfOrAnotherSubtypeETB' && entered.ownerId === controllerId) {
        const subtypeTrigger = trigger as { kind: 'SelfOrAnotherSubtypeETB'; subtype: string };
        const sub = subtypeTrigger.subtype.toLowerCase();
        const enteredDef2 = getCardDefinition(state, entered);
        const enteredTypeLine = enteredDef2.type_line.toLowerCase();
        const subtypeMatch = sub === 'creature'
          ? enteredDef2.card_types.includes('creature')
          : enteredTypeLine.includes(sub);
        if (subtypeMatch) {
          shouldFire = true;
        }
      }

      if (enteredIsCreature && trigger.kind === 'AnyCreatureETB') {
        const controllerRestriction = trigger.controller ?? 'any';
        const tokenRestrictionOk = (!trigger.nontoken || !entered.isToken) && (!trigger.tokenOnly || entered.isToken === true);
        shouldFire = tokenRestrictionOk && (controllerRestriction === 'any' || entered.ownerId === controllerId);
      }

      if (enteredIsLand && trigger.kind === 'Landfall' && entered.ownerId === controllerId) {
        shouldFire = true;
      }

      // Slice 2: "Whenever another legendary permanent you control enters"
      // Fires for any legendary permanent other than the source itself.
      if (
        trigger.kind === 'AnotherLegendaryPermanentETB' &&
        entered.ownerId === controllerId &&
        enteredIsLegendary
      ) {
        shouldFire = true;
      }

      if (!shouldFire) continue;

      pendingTriggers.push({
        id: `trigger_direct_entry_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        sourceInstanceId,
        controllerId,
        ability,
        requiredTargets: (ability.targets as TargetSpec[] | undefined) || targetSpecsForTriggerKind(state, sourceCard, trigger.kind),
      });
    }
  }

  return { ...state, pendingTriggers };
}

function applyDirectBattlefieldEntrySideEffects(state: GameState, instanceId: string): GameState {
  let nextState = registerBattlefieldAbilitiesAfterDirectEntry(state, instanceId);
  nextState = queueSelfETBTriggersAfterDirectEntry(nextState, instanceId);
  nextState = queueEntryTriggersForOtherPermanents(nextState, instanceId);
  return nextState;
}

function targetSpecsForLifeGainTrigger(
  state: GameState,
  card: CardInstance,
  abilityTargets: unknown[] | undefined,
): TargetSpec[] {
  const existing = (abilityTargets as TargetSpec[] | undefined) || [];
  if (existing.length > 0) return existing;

  const cardDef = getCardDefinition(state, card);
  for (const line of cardDef.oracle_text.split('\n')) {
    const parsed = parseOracleText(normalizeTriggeredOracleLine(line.trim(), cardDef.name));
    if (parsed.kind === 'Triggered' && parsed.ability.trigger.kind === 'LifeGain') {
      return parsed.targets;
    }
  }
  return [];
}

function targetSpecsForLifeLossTrigger(
  state: GameState,
  card: CardInstance,
  abilityTargets: unknown[] | undefined,
): TargetSpec[] {
  const existing = (abilityTargets as TargetSpec[] | undefined) || [];
  if (existing.length > 0) return existing;

  const cardDef = getCardDefinition(state, card);
  for (const line of cardDef.oracle_text.split('\n')) {
    const parsed = parseOracleText(normalizeTriggeredOracleLine(line.trim(), cardDef.name));
    if (parsed.kind === 'Triggered' && parsed.ability.trigger.kind === 'LifeLoss') {
      return parsed.targets;
    }
  }
  return [];
}

/**
 * Enqueue "Whenever you lose life" triggers for permanents controlled by the
 * player who lost life. Mirrors enqueueLifeGainTriggers (LifeGain). The engine
 * emits this whenever a player actually loses life via executeLoseLife.
 */
function enqueueLifeLossTriggers(state: GameState, playerId: string): GameState {
  if (!state.battlefieldAbilities || state.battlefieldAbilities.size === 0) return state;

  const pendingTriggers: PendingTrigger[] = [...(state.pendingTriggers || [])];
  for (const [instanceId, abilities] of state.battlefieldAbilities) {
    const card = state.cards.get(instanceId);
    if (!card || card.zone !== 'battlefield' || card.ownerId !== playerId) continue;

    for (const ability of abilities) {
      if (ability.trigger.kind !== 'LifeLoss') continue;
      pendingTriggers.push({
        id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        sourceInstanceId: instanceId,
        controllerId: card.ownerId,
        ability,
        requiredTargets: targetSpecsForLifeLossTrigger(state, card, ability.targets),
      });
    }
  }

  return { ...state, pendingTriggers };
}

function enqueueLifeGainTriggers(state: GameState, playerId: string): GameState {
  if (!state.battlefieldAbilities || state.battlefieldAbilities.size === 0) return state;

  const pendingTriggers: PendingTrigger[] = [...(state.pendingTriggers || [])];
  for (const [instanceId, abilities] of state.battlefieldAbilities) {
    const card = state.cards.get(instanceId);
    if (!card || card.zone !== 'battlefield' || card.ownerId !== playerId) continue;

    for (const ability of abilities) {
      if (ability.trigger.kind !== 'LifeGain') continue;
      pendingTriggers.push({
        id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        sourceInstanceId: instanceId,
        controllerId: card.ownerId,
        ability,
        requiredTargets: targetSpecsForLifeGainTrigger(state, card, ability.targets),
      });
    }
  }

  return { ...state, pendingTriggers };
}

/**
 * Slice 5 (event-damage triggers): enqueue "Whenever this creature / enchanted
 * creature deals damage" triggers for any permanent that fires on deals-damage.
 *
 * sourceInstanceId — the permanent that dealt the damage (for 'self' triggers).
 * amount           — the actual damage dealt (stored in eventContext so effect
 *                    bodies can resolve EventDamageAmount: "you gain that much
 *                    life" / "deals that much damage to that creature's controller").
 */
function enqueueDealsDamageTriggers(
  state: GameState,
  sourceInstanceId: string,
  amount: number,
): GameState {
  if (!state.battlefieldAbilities || state.battlefieldAbilities.size === 0) return state;

  const pendingTriggers: PendingTrigger[] = [...(state.pendingTriggers || [])];

  for (const [instanceId, abilities] of state.battlefieldAbilities) {
    const card = state.cards.get(instanceId);
    if (!card || card.zone !== 'battlefield') continue;

    for (const ability of abilities) {
      if (ability.trigger.kind !== 'DealsDamage') continue;
      const dmgTrigger = ability.trigger as { kind: 'DealsDamage'; who: 'self' | 'enchantedCreature' };

      let shouldFire = false;
      if (dmgTrigger.who === 'self' && instanceId === sourceInstanceId) {
        shouldFire = true;
      }
      if (dmgTrigger.who === 'enchantedCreature') {
        // Aura triggers: fires when the creature this Aura is attached to deals damage.
        if (card.attachedTo === sourceInstanceId) {
          shouldFire = true;
        }
      }

      if (shouldFire) {
        pendingTriggers.push({
          id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          sourceInstanceId: instanceId,
          controllerId: card.ownerId,
          ability,
          requiredTargets: (ability.targets as import('../effects/targets').TargetSpec[] | undefined) || [],
          eventContext: { cardInstanceId: sourceInstanceId, eventDamageAmount: amount },
        });
      }
    }
  }

  return { ...state, pendingTriggers };
}

/**
 * Slice 5 (player-level static prohibitions): return true when any battlefield
 * permanent has a CantGainLife continuous effect active (i.e., "Players can't
 * gain life." from Leyline of Punishment, Sulfuric Vortex, Erebos, etc.).
 *
 * Mirrors the playerCantLoseLife pattern from game-outcome.ts: scan
 * state.continuousEffects for the CantGainLife modifier and verify the source
 * is still on the battlefield.
 */
function anyPlayerCantGainLife(state: GameState): boolean {
  const effects = state.continuousEffects;
  if (!effects || effects.length === 0) return false;
  for (const ce of effects) {
    if (ce.ability.modifier.kind !== 'CantGainLife') continue;
    const source = state.cards.get(ce.sourceInstanceId);
    if (source && source.zone === 'battlefield') return true;
  }
  return false;
}

/**
 * Execute a GainLife effect.
 */
function executeGainLife(state: GameState, playerId: string, amount: number): GameState {
  // Slice 5: "Players can't gain life." (Leyline of Punishment family).
  if (anyPlayerCantGainLife(state)) return state;

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

  return enqueueLifeGainTriggers({ ...state, players: newPlayers }, playerId);
}

/**
 * Execute a LoseLife effect.
 * Exported so that shock-land auto-pay (permanent-entry auto-choice) can route
 * life loss through this path, which fires LifeLoss triggers (e.g. Sanguine Bond).
 */
export function executeLoseLife(state: GameState, playerId: string, amount: number): GameState {
  if (playerCantLoseLife(state, playerId)) return state;

  const event: ReplacementEvent = { type: 'LifeLost', targetId: playerId, amount };
  const { event: replaced } = applyReplacements(state, event);
  if (!replaced) return state;
  const finalAmount = replaced.amount ?? amount;
  if (finalAmount <= 0) return state;

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    throw new Error(`Player ${playerId} not found`);
  }

  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, life: p.life - finalAmount } : p
  );

  return enqueueLifeLossTriggers({ ...state, players: newPlayers }, playerId);
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
  position: 'top' | 'bottom' | 'shuffle' | 'thirdFromTop',
): GameState {
  const card = state.cards.get(targetId);
  if (!card) return state;

  const finalZone = getCommanderDestinationZone(state, targetId, 'library');
  if (finalZone !== 'library') {
    const newCards = new Map(state.cards);
    newCards.set(targetId, {
      ...card,
      zone: finalZone,
      tapped: false,
      damage: 0,
      counters: {},
      summoningSick: true,
      attachedTo: undefined,
    });
    return pruneDetachedEffects({ ...state, cards: newCards });
  }

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

  let nextLibrary: CardInstance[];
  if (position === 'bottom') {
    nextLibrary = [...libraryCards, libraryCard];
  } else if (position === 'thirdFromTop') {
    // "Third from the top" (Lost Hours family): insert at index 2, or at end if
    // the library has fewer than 2 cards, matching the printed card's intent.
    const insertAt = Math.min(2, libraryCards.length);
    nextLibrary = [
      ...libraryCards.slice(0, insertAt),
      libraryCard,
      ...libraryCards.slice(insertAt),
    ];
  } else {
    nextLibrary = [libraryCard, ...libraryCards];
  }

  if (position === 'shuffle') {
    shuffleInPlace(state, nextLibrary);
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
    newCards.set(card.instanceId, {
      ...card,
      zone: getCommanderDestinationZone(state, card.instanceId, 'graveyard'),
      tapped: false,
      damage: 0,
      counters: {},
    });
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
 * Execute a Goad effect: record goaderId on the target creature. The goad lasts
 * until the goader's next turn (cleared in performUntapStep). CR 701.39.
 */
function executeGoad(state: GameState, targetId: string, goaderId: string): GameState {
  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'battlefield') return state;
  if (!isEffectiveCreature(state, targetId)) return state;

  const existing = card.goadedBy || [];
  if (existing.includes(goaderId)) return state;
  const newCards = new Map(state.cards);
  newCards.set(targetId, { ...card, goadedBy: [...existing, goaderId] });
  return { ...state, cards: newCards };
}

// Counters that are bad for their controller — the only kinds proliferate grows
// on permanents/players an opponent controls.
const DETRIMENTAL_COUNTERS = new Set(['-1/-1', 'stun', 'poison']);

/**
 * Execute Proliferate (CR 701.27). "Choose any number of permanents and/or
 * players with a counter, then give each another counter of a kind already
 * there." Implemented with a controller-optimal heuristic: grow every counter on
 * the caster's own permanents and player counters; on opponents grow only
 * detrimental counters (-1/-1, stun, poison).
 */
function executeProliferate(state: GameState, casterId: string): GameState {
  const newCards = new Map(state.cards);
  for (const [id, card] of state.cards) {
    if (card.zone !== 'battlefield') continue;
    const kinds = Object.keys(card.counters).filter(k => card.counters[k] > 0);
    if (kinds.length === 0) continue;
    const ownByCaster = card.ownerId === casterId;
    const counters = { ...card.counters };
    let changed = false;
    for (const k of kinds) {
      if (ownByCaster || DETRIMENTAL_COUNTERS.has(k)) {
        counters[k] += 1;
        changed = true;
      }
    }
    if (changed) newCards.set(id, { ...card, counters });
  }

  const newPlayers = state.players.map(p => {
    const isCaster = p.id === casterId;
    let next = p;
    // Generic player counters (energy/experience): grow only the caster's own.
    if (isCaster && p.playerCounters) {
      const pc = { ...p.playerCounters };
      let changed = false;
      for (const k of Object.keys(pc)) {
        if (pc[k] > 0) { pc[k] += 1; changed = true; }
      }
      if (changed) next = { ...next, playerCounters: pc };
    }
    // Poison: only grow on opponents who already have at least one.
    if (!isCaster && p.poisonCounters > 0) {
      next = { ...next, poisonCounters: p.poisonCounters + 1 };
    }
    return next;
  });

  return { ...state, cards: newCards, players: newPlayers };
}

/** Add N +1/+1 counters to one creature instance. */
function addPlusCounters(state: GameState, creatureId: string, n: number): GameState {
  const card = state.cards.get(creatureId);
  if (!card || card.zone !== 'battlefield' || n <= 0) return state;
  const newCards = new Map(state.cards);
  newCards.set(creatureId, {
    ...card,
    counters: { ...card.counters, '+1/+1': (card.counters['+1/+1'] ?? 0) + n },
  });
  return { ...state, cards: newCards };
}

/**
 * Execute Adapt N (CR 701.41): if the source creature has no +1/+1 counters,
 * put N +1/+1 counters on it.
 */
function executeAdapt(state: GameState, sourceId: string | undefined, n: number): GameState {
  if (!sourceId) return state;
  const card = state.cards.get(sourceId);
  if (!card || card.zone !== 'battlefield') return state;
  if ((card.counters['+1/+1'] ?? 0) > 0) return state; // already has counters → no effect
  return addPlusCounters(state, sourceId, n);
}

/**
 * Execute Mentor (CR 702.110): put a +1/+1 counter on an attacking creature the
 * source's controller controls whose power is less than the source's power. Picks
 * the highest-power eligible creature deterministically (the source's controller's
 * best beneficiary), excluding the source itself.
 */
function executeMentor(state: GameState, sourceId: string | undefined): GameState {
  if (!sourceId || !state.combat) return state;
  const source = state.cards.get(sourceId);
  if (!source || source.zone !== 'battlefield') return state;
  const sourcePower = getEffectivePower(state, sourceId);

  let bestId: string | undefined;
  let bestPower = -Infinity;
  for (const attack of state.combat.attackers) {
    const id = attack.cardInstanceId;
    if (id === sourceId) continue;
    const card = state.cards.get(id);
    if (!card || card.zone !== 'battlefield' || card.ownerId !== source.ownerId) continue;
    if (!isEffectiveCreature(state, id)) continue;
    const p = getEffectivePower(state, id);
    if (p < sourcePower && p > bestPower) { bestPower = p; bestId = id; }
  }
  if (!bestId) return state;
  return addPlusCounters(state, bestId, 1);
}

/**
 * Execute Fabricate N (CR 702.123): put N +1/+1 counters on the source if it is
 * still a creature on the battlefield; otherwise create N 1/1 colorless Servo
 * artifact creature tokens for the caster.
 */
function executeFabricate(state: GameState, sourceId: string | undefined, casterId: string, n: number): GameState {
  if (n <= 0) return state;
  const source = sourceId ? state.cards.get(sourceId) : undefined;
  if (source && source.zone === 'battlefield' && sourceId && isEffectiveCreature(state, sourceId)) {
    return addPlusCounters(state, sourceId, n);
  }
  const servo: TokenDefinition = {
    name: 'Servo', colors: [], types: ['artifact', 'creature'], subtypes: ['Servo'], power: 1, toughness: 1,
  };
  return executeCreateToken(state, casterId, servo, n);
}

/**
 * Execute Monstrosity N (CR 701.34): if the source isn't monstrous, put N +1/+1
 * counters on it and mark it monstrous.
 */
function executeMonstrosity(state: GameState, sourceId: string | undefined, n: number): GameState {
  if (!sourceId) return state;
  const card = state.cards.get(sourceId);
  if (!card || card.zone !== 'battlefield' || card.monstrous) return state;
  const withCounters = addPlusCounters(state, sourceId, n);
  const updated = withCounters.cards.get(sourceId);
  if (!updated) return withCounters;
  const newCards = new Map(withCounters.cards);
  newCards.set(sourceId, { ...updated, monstrous: true });
  return { ...withCounters, cards: newCards };
}

/**
 * Execute Bolster N (CR 701.24): put N +1/+1 counters on the caster's creature with
 * the least toughness (first such creature on ties).
 */
function executeBolster(state: GameState, casterId: string, n: number): GameState {
  let targetId: string | undefined;
  let least = Infinity;
  for (const [id, card] of state.cards) {
    if (card.zone !== 'battlefield' || card.ownerId !== casterId) continue;
    if (!isEffectiveCreature(state, id)) continue;
    const t = getEffectiveToughness(state, id);
    if (t < least) { least = t; targetId = id; }
  }
  if (!targetId) return state;
  return addPlusCounters(state, targetId, n);
}

/**
 * Execute Populate (CR 701.32): create a token that's a copy of a creature token
 * the caster controls. Picks the caster's highest-statted creature token. The copy
 * copies copiable characteristics only (no counters/damage).
 */
function executePopulate(state: GameState, casterId: string): GameState {
  let best: CardInstance | undefined;
  let bestScore = -1;
  for (const [id, card] of state.cards) {
    if (card.zone !== 'battlefield' || card.ownerId !== casterId || !card.isToken) continue;
    if (!isEffectiveCreature(state, id)) continue;
    const def = getCardDefinition(state, card);
    const score = (def.power ?? 0) + (def.toughness ?? 0);
    if (score > bestScore) { bestScore = score; best = card; }
  }
  if (!best) return state;

  let instanceId = `token_inst_${++tokenInstanceCounter}`;
  while (state.cards.has(instanceId)) instanceId = `token_inst_${++tokenInstanceCounter}`;
  const copy: CardInstance = {
    ...best,
    instanceId,
    tapped: false,
    summoningSick: true,
    counters: {},
    damage: 0,
    deathtouchDamage: undefined,
    attachedTo: undefined,
    goadedBy: undefined,
    regenerationShields: undefined,
  };
  const newCards = new Map(state.cards);
  newCards.set(instanceId, copy);
  return { ...state, cards: newCards };
}

/**
 * Execute Amass (CR 701.43): if the caster controls no Army, create a 0/0 black
 * Army creature token of the given type; then put N +1/+1 counters on an Army the
 * caster controls.
 */
function executeAmass(state: GameState, casterId: string, count: number, armyType?: string): GameState {
  const findArmy = (s: GameState): string | undefined => {
    for (const [id, card] of s.cards) {
      if (card.zone !== 'battlefield' || card.ownerId !== casterId) continue;
      if (typeLineHasSubtype(getCardDefinition(s, card).type_line, 'army')) return id;
    }
    return undefined;
  };

  let s = state;
  let armyId = findArmy(s);
  if (!armyId) {
    const subtypes = armyType ? [armyType, 'Army'] : ['Army'];
    const token: TokenDefinition = {
      name: subtypes.join(' '),
      colors: ['B'],
      types: ['creature'],
      subtypes,
      power: 0,
      toughness: 0,
    };
    s = executeCreateToken(s, casterId, token, 1);
    armyId = findArmy(s);
  }
  if (!armyId || count <= 0) return s;

  const army = s.cards.get(armyId)!;
  const newCards = new Map(s.cards);
  newCards.set(armyId, {
    ...army,
    counters: { ...army.counters, '+1/+1': (army.counters['+1/+1'] ?? 0) + count },
  });
  return { ...s, cards: newCards };
}

/**
 * Execute Connive on one creature (CR 702.156): draw N, then discard N, and put a
 * +1/+1 counter on the creature for each nonland card discarded this way.
 */
function executeConnive(state: GameState, creatureId: string, ownerId: string, n: number): GameState {
  if (n <= 0) return state;
  let s = executeDraw(state, ownerId, n);

  // Discard N (deterministic first-N, mirroring executeDiscard), counting nonlands.
  const hand = getCardsInZone(s, ownerId, 'hand');
  const toDiscard = hand.slice(0, Math.min(n, hand.length));
  let nonland = 0;
  const newCards = new Map(s.cards);
  for (const card of toDiscard) {
    const def = getCardDefinition(s, card);
    if (!def.card_types.includes('land')) nonland++;
    newCards.set(card.instanceId, {
      ...card,
      zone: getCommanderDestinationZone(s, card.instanceId, 'graveyard'),
      tapped: false,
      damage: 0,
      counters: {},
    });
  }
  s = { ...s, cards: newCards };

  if (nonland > 0) {
    const creature = s.cards.get(creatureId);
    if (creature && creature.zone === 'battlefield') {
      const withCounter = new Map(s.cards);
      withCounter.set(creatureId, {
        ...creature,
        counters: { ...creature.counters, '+1/+1': (creature.counters['+1/+1'] ?? 0) + nonland },
      });
      s = { ...s, cards: withCounter };
    }
  }
  return s;
}

/**
 * Execute Explore on one creature (CR 701.40). Reveal the top card of the
 * creature controller's library; if a land, put it into hand; otherwise put a
 * +1/+1 counter on the creature (the card stays on top). Empty library still
 * grants the counter.
 */
function executeExplore(state: GameState, creatureId: string): GameState {
  const creature = state.cards.get(creatureId);
  if (!creature || creature.zone !== 'battlefield') return state;
  if (!isEffectiveCreature(state, creatureId)) return state;

  const library = getCardsInZone(state, creature.ownerId, 'library');
  const top = library[0];
  const newCards = new Map(state.cards);
  if (top) {
    const topDef = getCardDefinition(state, top);
    if (topDef.card_types.includes('land')) {
      newCards.set(top.instanceId, { ...top, zone: 'hand' });
      return { ...state, cards: newCards };
    }
  }
  const counters = { ...creature.counters, '+1/+1': (creature.counters['+1/+1'] ?? 0) + 1 };
  newCards.set(creatureId, { ...creature, counters });
  return { ...state, cards: newCards };
}

/**
 * Execute a Regenerate effect: add a regeneration shield to the target creature.
 * The shield replaces the next destruction this turn (CR 701.18).
 */
function executeRegenerate(state: GameState, targetId: string): GameState {
  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'battlefield') return state;
  if (!isEffectiveCreature(state, targetId)) return state;
  const newCards = new Map(state.cards);
  newCards.set(targetId, { ...card, regenerationShields: (card.regenerationShields ?? 0) + 1 });
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

function getSourceAttachedTo(state: GameState, sourceInstanceId?: string): string | null {
  if (!sourceInstanceId) return null;
  const source = state.cards.get(sourceInstanceId);
  return source?.attachedTo ?? null;
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
    // Shuffle (seeded) and take first N
    const order = shuffled(state, handCards);
    toDiscard = order.slice(0, Math.min(count, order.length));
  } else {
    // For non-random, we just discard the first N (in real game, player chooses)
    toDiscard = handCards.slice(0, Math.min(count, handCards.length));
  }

  for (const card of toDiscard) {
    newCards.set(card.instanceId, {
      ...card,
      zone: getCommanderDestinationZone(state, card.instanceId, 'graveyard'),
      tapped: false,
      damage: 0,
      counters: {},
    });
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
  /** When set, restrict to permanents this player controls ("untap all <type> you control"). */
  youControlPlayerId?: string,
): GameState {
  const candidates: CardInstance[] = [];
  for (const card of state.cards.values()) {
    if (card.zone !== 'battlefield' || !card.tapped) continue;
    if (youControlPlayerId !== undefined && card.ownerId !== youControlPlayerId) continue;
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

/**
 * Tap every battlefield permanent matching `filter` (e.g. "tap all artifacts").
 * When `youControlPlayerId` is set, restrict to permanents that player controls
 * ("tap all <type> you control"). Goes through executeTap so tap-triggers fire.
 */
function executeTapAllOfType(
  state: GameState,
  filter: CardFilter,
  youControlPlayerId?: string,
): GameState {
  const ids: string[] = [];
  for (const card of state.cards.values()) {
    if (card.zone !== 'battlefield') continue;
    if (youControlPlayerId !== undefined && card.ownerId !== youControlPlayerId) continue;
    const def = getCardDefinition(state, card);
    if (!matchesCardFilter(def, filter)) continue;
    ids.push(card.instanceId);
  }
  let s = state;
  for (const id of ids) s = executeTap(s, id);
  return s;
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
      .map(card => ({
        ...card,
        zone: getCommanderDestinationZone(state, card.instanceId, 'graveyard'),
      }));
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
    sendToGraveyard.map(card => ({
      ...card,
      zone: getCommanderDestinationZone(state, card.instanceId, 'graveyard'),
    })),
  );
}

type CardFilterContext = {
  state?: GameState;
  sourceInstanceId?: string;
  /** Slice 6: cast-time named choices (used by chosenColorFromCastTime filter). */
  namedCardChoices?: Map<string, string>;
  /**
   * Layer 5 (SetAllColors): the instance ID of the card being evaluated.
   * When provided together with `state`, getEffectiveColors is used for all
   * color checks so that a Leyline of the Guildpact–style static is reflected.
   */
  instanceId?: string;
};

function isPermanentDefinition(def: CardDefinition): boolean {
  return ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']
    .some(type => def.card_types.includes(type as any) || typeLineHasType(def.type_line, type));
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
      def.card_types.includes(t as any) || typeLineHasType(def.type_line, t)
    );
    if (!hasMatchingType) return false;
  }

  if (filter.excludeTypes) {
    const hasExcludedType = filter.excludeTypes.some(t =>
      def.card_types.includes(t as any) || typeLineHasType(def.type_line, t)
    );
    if (hasExcludedType) return false;
  }

  // Check subtypes — bypass when instance has been granted all creature types (Slice 10:
  // Volatile Claws / Shields of Velis Vel / Blades of Velis Vel family).
  if (filter.subtypes || filter.chosenCreatureTypeFromSource) {
    const instance = context.state && context.instanceId
      ? context.state.cards.get(context.instanceId)
      : undefined;
    const hasAllCreatureTypes = instance?.grantedAllCreatureTypes === true;

    if (!hasAllCreatureTypes) {
      if (filter.subtypes) {
        // Slice 4 (SetCreatureType): also check grantedSubtypes for temporarily-granted
        // specific subtypes (Amoeba Spy / Mistform Dreamer family).
        const grantedSubs = instance?.grantedSubtypes ?? [];
        const hasMatchingSubtype = filter.subtypes.some(st =>
          typeLineHasSubtype(def.type_line, st) ||
          grantedSubs.some(gs => gs.toLowerCase() === st.toLowerCase())
        );
        if (!hasMatchingSubtype) return false;
      }

      if (filter.chosenCreatureTypeFromSource) {
        if (!context.state || !context.sourceInstanceId) return false;
        const source = context.state.cards.get(context.sourceInstanceId);
        const chosenType = source?.choices?.chosenCreatureType?.trim().toLowerCase();
        if (!chosenType) return false;
        // Also respect grantedSubtypes on the evaluated instance
        const grantedSubs2 = instance?.grantedSubtypes ?? [];
        if (!typeLineHasSubtype(def.type_line, chosenType) &&
            !grantedSubs2.some(gs => gs.toLowerCase() === chosenType)) return false;
      }
    }
    // else: hasAllCreatureTypes → creature has every type, so any subtype filter passes.
  }

  // Slice 3/13: chosen-card-TYPE filter — "put all cards of the chosen type into
  // your hand" (Vigean Intuition family). Checks def.card_types against the source's
  // choices.chosenCreatureType field (reused for the card-type choice declaration).
  if (filter.chosenCardTypeFromSource) {
    if (!context.state || !context.sourceInstanceId) return false;
    const source = context.state.cards.get(context.sourceInstanceId);
    const chosenCardType = source?.choices?.chosenCreatureType?.trim().toLowerCase();
    if (!chosenCardType) return false;
    if (!def.card_types.includes(chosenCardType as import('../types').CardType)) return false;
  }

  // Slice 5: chosen-color filter — matches permanents whose color includes the
  // source's stored chosenColor (Caged Sun / Gauntlet of Power anthem family).
  if (filter.chosenColorFromSource) {
    if (!context.state || !context.sourceInstanceId) return false;
    const source = context.state.cards.get(context.sourceInstanceId);
    const chosenColor = source?.choices?.chosenColor;
    if (!chosenColor) return false;
    // Layer 5: use effective colors when instance context is available.
    const colors = context.state && context.instanceId
      ? getEffectiveColors(context.state, context.instanceId)
      : def.colors;
    if (!colors.includes(chosenColor)) return false;
  }

  // Slice 6: cast-time chosen-color filter — matches hand cards whose color
  // includes the color stored in namedCardChoices['chosenColor']. Used by the
  // Addle / Hint of Insanity family ("choose a color" preamble + reveal-hand).
  // When no chosenColor key is present the filter is treated as unfiltered
  // (matches any card) so the AI picks the highest-CMC card regardless of color.
  if (filter.chosenColorFromCastTime) {
    const castColor = context.namedCardChoices?.get('chosenColor') as 'W' | 'U' | 'B' | 'R' | 'G' | undefined;
    if (castColor) {
      // Layer 5: use effective colors when instance context is available.
      const colors = context.state && context.instanceId
        ? getEffectiveColors(context.state, context.instanceId)
        : def.colors;
      if (!colors.includes(castColor)) return false;
    }
    // No castColor → unfiltered; fall through (any card matches).
  }

  // Slice 6/spell-pump: cast-time chosen-creature-type filter — matches battlefield
  // creatures whose subtype equals the type chosen at cast time (stored in the
  // execution context's namedCardChoices['chosenCreatureType']). Used by
  // matchChosenTypePump (And They Shall Know No Fear family). When no entry is
  // present in namedCardChoices the filter returns false (safe no-op — no creature
  // is accidentally buffed by a spell whose type choice was not recorded).
  if (filter.chosenCreatureTypeFromCastTime) {
    const castType = context.namedCardChoices?.get('chosenCreatureType')?.trim().toLowerCase();
    if (!castType) return false;
    // Also respect grantedAllCreatureTypes on the evaluated instance.
    const instance = context.state && context.instanceId
      ? context.state.cards.get(context.instanceId)
      : undefined;
    if (!instance?.grantedAllCreatureTypes) {
      const grantedSubs = instance?.grantedSubtypes ?? [];
      if (!typeLineHasSubtype(def.type_line, castType) &&
          !grantedSubs.some(gs => gs.toLowerCase() === castType)) return false;
    }
  }

  if (filter.excludeSubtypes) {
    const hasExcludedSubtype = filter.excludeSubtypes.some(st => typeLineHasSubtype(def.type_line, st));
    if (hasExcludedSubtype) return false;
  }

  // Check supertypes (e.g., "basic")
  if (filter.supertypes) {
    const hasMatchingSupertype = filter.supertypes.some(st => typeLineHasSupertype(def.type_line, st));
    if (!hasMatchingSupertype) return false;
  }

  // Check colors (Layer 5: use effective colors to reflect SetAllColors overlays
  // when an instance context is available; falls back to def.colors otherwise).
  if (filter.colors) {
    const colors = context.state && context.instanceId
      ? getEffectiveColors(context.state, context.instanceId)
      : def.colors;
    const hasMatchingColor = filter.colors.some(c => colors.includes(c));
    if (!hasMatchingColor) return false;
  }

  // Slice 4 (OptionalPay reflexive): excludeColors — card must NOT have any of the listed colors.
  if (filter.excludeColors) {
    const colors = context.state && context.instanceId
      ? getEffectiveColors(context.state, context.instanceId)
      : def.colors;
    const hasExcludedColor = filter.excludeColors.some(c => colors.includes(c));
    if (hasExcludedColor) return false;
  }

  if (filter.multicolored) {
    const colors = context.state && context.instanceId
      ? getEffectiveColors(context.state, context.instanceId)
      : def.colors;
    if (colors.length < 2) return false;
  }

  // Slice 11: monocolored — exactly one color (Defiler of Souls family).
  if (filter.monocolored) {
    const colors = context.state && context.instanceId
      ? getEffectiveColors(context.state, context.instanceId)
      : def.colors;
    if (colors.length !== 1) return false;
  }

  // Slice 11: excludeSupertypes — "nonbasic" etc. (Destructive Flow family).
  if (filter.excludeSupertypes) {
    const hasExcludedSupertype = filter.excludeSupertypes.some(st => typeLineHasSupertype(def.type_line, st));
    if (hasExcludedSupertype) return false;
  }

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

  // Slice 8: keyword-holder filter — static fallback checks printed keywords only.
  // Instance-level (continuously granted) keywords are checked in isAffectedBy
  // (continuous.ts) which has access to the full game state.
  if (filter.withKeyword) {
    const norm = filter.withKeyword.toLowerCase().replace(/[\s_-]/g, '');
    const hasIt = def.keywords.some(k => k.toLowerCase().replace(/[\s_-]/g, '') === norm);
    if (!hasIt) return false;
  }

  // Slice 5 (controller-agnostic filtered anthems): negated keyword-holder filter.
  // Static fallback: checks printed keywords only (continuous grants handled by
  // isAffectedBy in continuous.ts). A card matches "without <kw>" iff it does NOT
  // have the keyword in its printed def.keywords list.
  if (filter.withoutKeyword) {
    const norm = filter.withoutKeyword.toLowerCase().replace(/[\s_-]/g, '');
    const hasIt = def.keywords.some(k => k.toLowerCase().replace(/[\s_-]/g, '') === norm);
    if (hasIt) return false;
  }

  return true;
}

function matchesCardInstanceFilter(
  state: GameState,
  instanceId: string,
  filter: CardFilter,
  context: CardFilterContext = {},
): boolean {
  const card = state.cards.get(instanceId);
  if (!card) return false;
  // Slice 2 (beginning-of-combat tails): "other creatures you control" — exclude the source.
  if (filter.notSource && context.sourceInstanceId && instanceId === context.sourceInstanceId) return false;
  const def = getCardDefinition(state, card);
  const filterWithoutPower = { ...filter };
  delete filterWithoutPower.power;
  if (!matchesCardFilter(def, filterWithoutPower, context)) return false;
  if (filter.power && !matchesNumericFilter(getEffectivePower(state, instanceId), filter.power)) return false;
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
function executeSacrifice(
  state: GameState,
  playerId: string,
  count: number,
  filter?: CardFilter,
  selectedCardIds: string[] = [],
): GameState {
  // Find matching permanents on the player's battlefield
  const candidates = getSacrificeCandidates(state, playerId, filter);
  const candidateIds = new Set(candidates.map(card => card.instanceId));
  const selected = selectedCardIds.filter(id => candidateIds.has(id));

  let newState = state;
  const toSacrifice = Math.min(count, candidates.length);
  if (selected.length >= toSacrifice && toSacrifice > 0) {
    for (let i = 0; i < toSacrifice; i++) {
      newState = executeSacrificeSpecific(newState, selected[i]);
    }
    return newState;
  }

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
  selectedCardId?: string,
): GameState {
  if (!sourceInstanceId) return state;
  const candidates = getSacrificeCandidates(state, playerId, filter);
  if (selectedCardId && candidates.some(candidate => candidate.instanceId === selectedCardId)) {
    return executeSacrificeSpecific(state, selectedCardId);
  }
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
    selectedCardInstanceIds?: string[];
    sourceInstanceId?: string;
    payLifeToEnterUntapped?: boolean;
    applyEntrySideEffects?: boolean;
    /**
     * "Search ... for up to N ... cards." When present (and max > 1, or an
     * explicit multi-card selection is supplied), the search moves up to N
     * matching cards instead of exactly one. The single-card path is unchanged.
     */
    selection?: { min: number; max: number };
    /**
     * Slice 12: "search your library and/or graveyard" — when true, graveyard
     * cards owned by the player are included as search candidates alongside the
     * library. Honest: the executor searches both zones and moves the chosen
     * card to the destination from whichever zone it occupied.
     */
    searchGraveyard?: boolean;
  } = {},
): GameState {
  const candidates: CardInstance[] = [];

  for (const [, card] of state.cards) {
    const inLibrary = card.ownerId === playerId && card.zone === 'library';
    const inGraveyard = choices.searchGraveyard && card.ownerId === playerId && card.zone === 'graveyard';
    if (!inLibrary && !inGraveyard) continue;
    const def = getCardDefinition(state, card);
    if (matchesCardFilter(def, filter, { state, sourceInstanceId: choices.sourceInstanceId })) {
      candidates.push(card);
    }
  }

  // Multi-select path: "search ... for up to N ... cards, put them ...".
  // Triggered only when a selection cap > 1 (or an explicit multi-card id list)
  // is provided, so every existing single-card caller behaves identically.
  const explicitMulti = (choices.selectedCardInstanceIds?.length ?? 0) > 0;
  if ((choices.selection && choices.selection.max > 1) || explicitMulti) {
    const max = Math.max(choices.selection?.max ?? 0, explicitMulti ? choices.selectedCardInstanceIds!.length : 0);
    const min = Math.max(0, choices.selection?.min ?? 0);
    return executeSearchLibraryMulti(
      state,
      playerId,
      candidates,
      destination,
      tapped,
      shuffleRest,
      { min, max },
      choices.selectedCardInstanceIds,
      choices.applyEntrySideEffects,
    );
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

  const intendedZone: Zone = destination === 'top' ? 'library' : destination;
  const finalDestination = getCommanderDestinationZone(state, matchedCard.instanceId, intendedZone);
  if (finalDestination !== intendedZone) {
    const newCards = new Map(state.cards);
    newCards.set(matchedCard.instanceId, {
      ...matchedCard,
      zone: finalDestination,
      tapped: false,
      summoningSick: true,
      damage: 0,
      counters: {},
    });
    const movedState = { ...state, cards: newCards };
    return shuffleRest ? executeShuffleLibrary(movedState, playerId) : movedState;
  }

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
      shuffleInPlace(state, remainingLibrary);
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
  let finalState = movedState;
  if (destination === 'battlefield' && choices.applyEntrySideEffects !== false) {
    finalState = applyDirectBattlefieldEntrySideEffects(finalState, matchedCard.instanceId);
  }

  return shuffleRest ? executeShuffleLibrary(finalState, playerId) : finalState;
}

/**
 * Deterministic AI/heuristic ranking for "up to N" library searches.
 * Higher score = picked first. Designed so ramp picks distinct basic-land
 * subtypes (color fixing) and general fetches grab the most valuable card.
 *
 * Selection is greedy over a per-card base score, with a diversity bonus that
 * rewards picking a basic-land subtype not already chosen. Fully deterministic:
 * ties break on instanceId so the result never depends on RNG or Map order.
 */
function rankSearchCandidates(
  state: GameState,
  candidates: CardInstance[],
  limit: number,
): CardInstance[] {
  if (limit <= 0) return [];
  const BASIC_SUBTYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
  const remaining = [...candidates];
  const chosen: CardInstance[] = [];
  const chosenBasicSubtypes = new Set<string>();

  const baseScore = (card: CardInstance): number => {
    const def = getCardDefinition(state, card);
    // Prefer higher mana value (more impactful tutor target / bigger ramp body).
    let score = def.cmc * 10;
    // Creatures/permanents with stats are generally better fetch targets.
    if (typeof def.power === 'number') score += def.power + (def.toughness ?? 0);
    return score;
  };

  while (chosen.length < limit && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    let bestId = '';
    for (let i = 0; i < remaining.length; i++) {
      const card = remaining[i];
      const def = getCardDefinition(state, card);
      let score = baseScore(card);
      // Color-fixing diversity: reward a basic-land subtype not yet chosen.
      const newBasic = BASIC_SUBTYPES.some(
        st => !chosenBasicSubtypes.has(st) && typeLineHasSubtype(def.type_line, st),
      );
      if (newBasic) score += 1000;
      if (
        score > bestScore
        || (score === bestScore && card.instanceId < bestId)
      ) {
        bestScore = score;
        bestIdx = i;
        bestId = card.instanceId;
      }
    }
    if (bestIdx < 0) break;
    const picked = remaining.splice(bestIdx, 1)[0];
    chosen.push(picked);
    const def = getCardDefinition(state, picked);
    for (const st of BASIC_SUBTYPES) {
      if (typeLineHasSubtype(def.type_line, st)) chosenBasicSubtypes.add(st);
    }
  }
  return chosen;
}

/**
 * Move up to N matching cards from a library to `destination`, then optionally
 * shuffle. Honest "search ... for up to N ... cards" execution: each chosen card
 * goes through the same per-card commander-redirect + battlefield-entry plumbing
 * as the single-card path, so ETB side effects, tapped state, and the legend/
 * commander rules all apply to every card. Selection is deterministic.
 */
function executeSearchLibraryMulti(
  state: GameState,
  playerId: string,
  candidates: CardInstance[],
  destination: 'battlefield' | 'hand' | 'top' | 'graveyard',
  tapped: boolean | undefined,
  shuffleRest: boolean,
  selection: { min: number; max: number },
  explicitSelectedIds: string[] | undefined,
  applyEntrySideEffects?: boolean,
): GameState {
  const byId = new Map(candidates.map(c => [c.instanceId, c]));
  let selected: CardInstance[];
  if (explicitSelectedIds && explicitSelectedIds.length > 0) {
    // Honor an explicit (player/AI-submitted) legal selection.
    const unique = [...new Set(explicitSelectedIds)]
      .map(id => byId.get(id))
      .filter((c): c is CardInstance => Boolean(c))
      .slice(0, selection.max);
    selected = unique;
  } else {
    // Deterministic heuristic: pick the best up-to-N. "Up to" means the engine
    // may take fewer than max, but we take as many as are available/useful
    // (ramp/fetch always wants the cards), at least `min`.
    const want = Math.min(selection.max, candidates.length);
    selected = rankSearchCandidates(state, candidates, want);
  }

  if (selected.length === 0) {
    // Nothing taken — still shuffle if the text says to.
    return shuffleRest ? executeShuffleLibrary(state, playerId) : state;
  }

  let working = state;
  const sideEffectIds: string[] = [];
  for (const card of selected) {
    const current = working.cards.get(card.instanceId);
    if (!current || current.zone !== 'library') continue;

    const intendedZone: Zone = destination === 'top' ? 'library' : destination;
    const finalDestination = getCommanderDestinationZone(working, card.instanceId, intendedZone);

    if (finalDestination !== intendedZone) {
      const newCards = new Map(working.cards);
      newCards.set(card.instanceId, {
        ...current,
        zone: finalDestination,
        tapped: false,
        summoningSick: true,
        damage: 0,
        counters: {},
      });
      working = { ...working, cards: newCards };
      continue;
    }

    if (destination === 'top') {
      // Putting multiple cards on top: place each on top (most-recently-moved
      // ends up on top); order among them is deterministic by selection order.
      const newCards = new Map(working.cards);
      newCards.set(card.instanceId, {
        ...current,
        zone: 'library',
        tapped: false,
        damage: 0,
        summoningSick: true,
      });
      working = { ...working, cards: newCards };
      continue;
    }

    if (destination === 'battlefield') {
      const def = getCardDefinition(working, current);
      const entry = buildBattlefieldEntryPlan(working, playerId, current, def, {
        forceTapped: tapped === true,
        defaultTapped: tapped === true,
        summoningSick: true,
      });
      const newCards = new Map(working.cards);
      newCards.set(card.instanceId, entry.card);
      working = { ...working, cards: newCards, players: entry.players };
      sideEffectIds.push(card.instanceId);
    } else {
      const newCards = new Map(working.cards);
      newCards.set(card.instanceId, {
        ...current,
        zone: destination,
        tapped: false,
        summoningSick: false,
        damage: 0,
      });
      working = { ...working, cards: newCards };
    }
  }

  if (destination === 'battlefield' && applyEntrySideEffects !== false) {
    for (const id of sideEffectIds) {
      working = applyDirectBattlefieldEntrySideEffects(working, id);
    }
  }

  return shuffleRest ? executeShuffleLibrary(working, playerId) : working;
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

  // Fisher-Yates shuffle (seeded)
  shuffleInPlace(state, libraryCards);

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
  filter?: import('./ast').CardFilter,
): GameState {
  // Allowed card types: use filter.types if provided, otherwise default to land only.
  const allowedTypes: string[] | null = filter?.types ?? ['land'];
  const matchesFilter = (card: import('../types').CardInstance): boolean => {
    const def = getCardDefinition(state, card);
    if (!allowedTypes) return true; // no type restriction
    return allowedTypes.some(t => def.card_types.includes(t as import('../types').CardType));
  };

  const chosen = selectedCardInstanceId ? state.cards.get(selectedCardInstanceId) : undefined;
  const land = chosen && chosen.ownerId === playerId && chosen.zone === 'hand' && matchesFilter(chosen)
    ? chosen
    : [...state.cards.values()].find(card => {
        if (card.ownerId !== playerId || card.zone !== 'hand') return false;
        return matchesFilter(card);
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

function executePutCardsFromHandOnTop(
  state: GameState,
  playerId: string,
  count: number,
  selectedCardIds: string[],
): GameState {
  const selectedUnique = [...new Set(selectedCardIds.filter(Boolean))];
  if (selectedUnique.length < count || count <= 0) return state;

  const selectedCards: CardInstance[] = [];
  for (const selectedId of selectedUnique.slice(0, count)) {
    const card = state.cards.get(selectedId);
    if (!card || card.ownerId !== playerId || card.zone !== 'hand') return state;
    selectedCards.push(card);
  }

  const selectedSet = new Set(selectedCards.map(card => card.instanceId));
  const libraryCards = [...state.cards.values()]
    .filter(card => card.ownerId === playerId && card.zone === 'library');
  const otherEntries: [string, CardInstance][] = [];

  for (const [id, card] of state.cards) {
    if (selectedSet.has(id)) continue;
    if (card.ownerId === playerId && card.zone === 'library') continue;
    otherEntries.push([id, card]);
  }

  const newCards = new Map<string, CardInstance>();
  for (const [id, card] of otherEntries) newCards.set(id, card);
  for (const card of selectedCards) {
    newCards.set(card.instanceId, {
      ...card,
      zone: 'library',
      tapped: false,
      damage: 0,
      counters: {},
    });
  }
  for (const card of libraryCards) {
    newCards.set(card.instanceId, card);
  }

  return { ...state, cards: newCards };
}

function moveLibraryChoiceCard(
  state: GameState,
  card: CardInstance,
  destination: 'hand' | 'graveyard' | 'exile',
): CardInstance {
  const zone = getCommanderDestinationZone(state, card.instanceId, destination);
  return {
    ...card,
    zone,
    tapped: false,
    damage: 0,
    counters: {},
    playableFromExileUntilTurn: undefined,
    playableFromExileSourceId: undefined,
  };
}

function executeChooseFromTopOfLibrary(
  state: GameState,
  playerId: string,
  count: number,
  destination: 'hand' | 'graveyard' | 'exile' | 'battlefield' | 'top',
  restDestination: 'bottom' | 'graveyard' | 'exile' | 'top' | 'hand',
  selectedCardIds: string[],
  minSelections: number,
  maxSelections: number,
  fallbackSelectionCount?: number,
  filter?: CardFilter,
  maxPerAnyOfBranch?: number,
  applyEntrySideEffects?: boolean,
  tapped?: boolean,
  /** Slice 3/13: passed through to matchesCardFilter for chosenCreatureTypeFromSource resolution */
  filterSourceInstanceId?: string,
): GameState {
  const libraryCards = [...state.cards.values()]
    .filter(card => card.ownerId === playerId && card.zone === 'library');
  const revealCount = Math.min(Math.max(0, count), libraryCards.length);
  if (revealCount <= 0) return state;

  const revealed = libraryCards.slice(0, revealCount);
  const restLibrary = libraryCards.slice(revealCount);
  const revealedById = new Map(revealed.map(card => [card.instanceId, card]));
  const uniqueSelected = [...new Set(selectedCardIds.filter(id => revealedById.has(id)))];
  // A submitted (non-empty) selection is honored when it's legal. An empty array
  // means no choice was submitted, which (for a filtered "put any number of <type>"
  // effect) defers to the filter-driven auto-selection below.
  const hasExplicitSubmission = selectedCardIds.length > 0;
  const hasValidSelection = hasExplicitSubmission
    && uniqueSelected.length === selectedCardIds.length
    && uniqueSelected.length >= minSelections
    && uniqueSelected.length <= maxSelections;

  // Filter-driven auto-selection ("put any number of <filter> cards into your hand"):
  // with no explicit selection, the engine takes every revealed card matching the
  // filter, capped at maxSelections. Non-matching cards always go to restDestination.
  let autoSelectedByFilter: string[] | null = null;
  if (!hasValidSelection && !hasExplicitSubmission && filter) {
    if (maxPerAnyOfBranch !== undefined && filter.anyOf) {
      // "a <typeA> card and/or a <typeB> card" — at most maxPerAnyOfBranch cards
      // per anyOf branch; a card matching several branches counts against the
      // first branch with remaining room.
      const branches = filter.anyOf;
      const takenPerBranch = branches.map(() => 0);
      const taken: string[] = [];
      for (const card of revealed) {
        if (taken.length >= maxSelections) break;
        const def = getCardDefinition(state, card);
        const branchIndex = branches.findIndex((branch, i) =>
          takenPerBranch[i] < maxPerAnyOfBranch && matchesCardFilter(def, branch, { state, sourceInstanceId: filterSourceInstanceId }));
        if (branchIndex === -1) continue;
        takenPerBranch[branchIndex]++;
        taken.push(card.instanceId);
      }
      autoSelectedByFilter = taken;
    } else {
      autoSelectedByFilter = revealed
        .filter(card => matchesCardFilter(getCardDefinition(state, card), filter, { state, sourceInstanceId: filterSourceInstanceId }))
        .slice(0, maxSelections)
        .map(card => card.instanceId);
    }
  }

  if (!hasValidSelection && autoSelectedByFilter === null && fallbackSelectionCount === undefined) return state;

  let selected: CardInstance[];
  if (hasValidSelection) {
    selected = uniqueSelected
      .map(id => revealedById.get(id))
      .filter((card): card is CardInstance => Boolean(card));
  } else if (autoSelectedByFilter !== null) {
    selected = autoSelectedByFilter
      .map(id => revealedById.get(id))
      .filter((card): card is CardInstance => Boolean(card));
  } else {
    const selectionCount = Math.min(Math.max(fallbackSelectionCount ?? minSelections, minSelections), maxSelections, revealed.length);
    selected = revealed.slice(0, selectionCount).map(card => card.instanceId)
      .map(id => revealedById.get(id))
      .filter((card): card is CardInstance => Boolean(card));
  }
  const selectedSet = new Set(selected.map(card => card.instanceId));
  const unselected = revealed.filter(card => !selectedSet.has(card.instanceId));

  const otherEntries: [string, CardInstance][] = [];
  for (const [id, card] of state.cards) {
    if (card.ownerId === playerId && card.zone === 'library') continue;
    otherEntries.push([id, card]);
  }

  const newCards = new Map<string, CardInstance>();
  for (const [id, card] of otherEntries) newCards.set(id, card);

  // restDestination 'top': put unselected cards back on top of library (before the
  // un-revealed rest). We add them first, then restLibrary below.
  if (restDestination === 'top') {
    for (const card of unselected) {
      newCards.set(card.instanceId, { ...card, zone: 'library' });
    }
    for (const card of restLibrary) {
      newCards.set(card.instanceId, card);
    }
  } else {
    for (const card of restLibrary) {
      newCards.set(card.instanceId, card);
    }
    for (const card of unselected) {
      if (restDestination === 'bottom') {
        newCards.set(card.instanceId, { ...card, zone: 'library' });
      } else {
        newCards.set(card.instanceId, moveLibraryChoiceCard(state, card, restDestination));
      }
    }
  }

  // destination='top': selected card(s) go back on top of the library. Rebuild
  // the full card map with selected cards first (→ top of library), then the
  // unselected cards and restLibrary according to restDestination.
  if (destination === 'top') {
    const topCards = new Map<string, CardInstance>();
    for (const [id, card] of otherEntries) topCards.set(id, card);
    // Selected cards land on top (library zone, inserted first).
    for (const card of selected) {
      topCards.set(card.instanceId, { ...card, zone: 'library' });
    }
    // Unselected cards and restLibrary go to restDestination (bottom or graveyard).
    if (restDestination === 'bottom') {
      for (const card of restLibrary) topCards.set(card.instanceId, card);
      for (const card of unselected) {
        topCards.set(card.instanceId, { ...card, zone: 'library' });
      }
    } else {
      // graveyard (or top, though top+top is unusual) — reuse newCards placements
      for (const card of restLibrary) topCards.set(card.instanceId, card);
      for (const card of unselected) {
        const placed = newCards.get(card.instanceId);
        if (placed) topCards.set(card.instanceId, placed);
      }
    }
    return { ...state, cards: topCards };
  }

  // Non-battlefield destinations (hand/graveyard/exile) move directly via the
  // shared library-choice mover. The battlefield destination needs full entry
  // plumbing (tapped/summoning-sick state, player updates, ETB side effects), so
  // it runs through buildBattlefieldEntryPlan one card at a time below.
  if (destination !== 'battlefield') {
    for (const card of selected) {
      newCards.set(card.instanceId, moveLibraryChoiceCard(state, card, destination));
    }
    return { ...state, cards: newCards };
  }

  // Seed the selected (revealed) cards back into the working map at their current
  // (library) state so the battlefield-entry plumbing below can move them. They
  // were excluded from `otherEntries` above as library cards.
  for (const card of selected) {
    newCards.set(card.instanceId, card);
  }

  let working: GameState = { ...state, cards: newCards };
  const enteredIds: string[] = [];
  for (const card of selected) {
    const current = working.cards.get(card.instanceId);
    if (!current) continue;
    const intendedZone = getCommanderDestinationZone(working, card.instanceId, 'battlefield');
    if (intendedZone !== 'battlefield') {
      const redirected = new Map(working.cards);
      redirected.set(card.instanceId, {
        ...current,
        zone: intendedZone,
        tapped: false,
        summoningSick: true,
        damage: 0,
        counters: {},
      });
      working = { ...working, cards: redirected };
      continue;
    }
    const def = getCardDefinition(working, current);
    const entry = buildBattlefieldEntryPlan(working, playerId, current, def, {
      summoningSick: true,
      forceTapped: tapped === true,
      defaultTapped: tapped === true,
    });
    const entered = new Map(working.cards);
    entered.set(card.instanceId, entry.card);
    working = { ...working, cards: entered, players: entry.players };
    enteredIds.push(card.instanceId);
  }

  if (applyEntrySideEffects !== false) {
    for (const id of enteredIds) {
      working = applyDirectBattlefieldEntrySideEffects(working, id);
    }
  }

  return working;
}

// Token instance counter
let tokenInstanceCounter = 0;

// Slice 8/11: stack item id counter for CastFromRevealedHand free-cast path
let freeCastStackCounter = 0;

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
  entersTapped?: boolean,
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
    let instanceId = `token_inst_${++tokenInstanceCounter}`;
    while (newCards.has(instanceId)) {
      instanceId = `token_inst_${++tokenInstanceCounter}`;
    }
    const instance: CardInstance = {
      instanceId,
      definitionId: defId,
      ownerId: controllerId,
      zone: 'battlefield',
      tapped: entersTapped ?? false,
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

  for (const tokenId of createdTokenIds) {
    nextState = applyDirectBattlefieldEntrySideEffects(nextState, tokenId);
  }

  return nextState;
}

function executeRollD20(state: GameState, effect: Extract<Effect, { kind: 'RollD20' }>, ctx: ExecutionContext): GameState {
  const roll = Math.max(
    1,
    Math.min(20, effect.rollOverride ?? randomIntInclusive(state, 1, 20)),
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

/**
 * Execute a CounterSpell effect.
 * Moves the target spell from the stack to the graveyard.
 * V0: We move the card to the graveyard if it exists on the stack.
 */
function executeCounterSpell(
  state: GameState,
  targetId: string,
  filter?: 'noncreature' | 'creature' | 'creatureOrEnchantment' | 'artifactOrCreature' | 'instantOrSorcery' | 'enchantmentInstantOrSorcery',
  exileInstead: boolean = false,
): GameState {
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
  if (filter === 'creatureOrEnchantment' && !def.card_types.includes('creature') && !def.card_types.includes('enchantment')) return state;
  if (filter === 'artifactOrCreature' && !def.card_types.includes('artifact') && !def.card_types.includes('creature')) return state;
  if (filter === 'instantOrSorcery' && !def.card_types.includes('instant') && !def.card_types.includes('sorcery')) return state;
  if (filter === 'enchantmentInstantOrSorcery' && !def.card_types.includes('enchantment') && !def.card_types.includes('instant') && !def.card_types.includes('sorcery')) return state;
  if (/\b(?:can'?t|cannot)\s+be\s+countered\b/i.test(def.oracle_text)) {
    return state;
  }

  // Slice 11: Battlefield-source "can't be countered" statics. Scan
  // continuousEffects for non-selfOnly GrantKeyword:'CantBeCountered' statics
  // whose filter matches the target spell's definition and whose controller
  // matches the spell's caster.
  if (targetStackItem && isSpellStackItem(targetStackItem)) {
    const spellCasterId = targetStackItem.casterId;
    for (const effect of (state.continuousEffects ?? [])) {
      const mod = effect.ability.modifier;
      if (mod.kind !== 'GrantKeyword' || mod.keyword !== 'CantBeCountered') continue;
      if (effect.ability.selfOnly) continue; // self-form handled by cantBeCountered flag above
      // Source permanent must still be on the battlefield.
      const source = state.cards.get(effect.sourceInstanceId);
      if (!source || source.zone !== 'battlefield') continue;
      // Controller check:
      //   'you'  → only the static's controller's spells are protected
      //   'any'  → all spells matching the filter (Gaea's Herald, Root Sliver)
      //   'opponent' → not currently emitted but handle defensively
      if (effect.ability.controller === 'you' && effect.controllerId !== spellCasterId) continue;
      if (effect.ability.controller === 'opponent' && effect.controllerId === spellCasterId) continue;
      // Filter check: does the target spell's definition match the static's filter?
      const abFilter = effect.ability.filter;
      if (!matchesCardFilter(def, abFilter)) continue;
      // All checks passed — this static protects the spell from being countered.
      return state;
    }
  }

  const destZone = getCommanderDestinationZone(state, cardInstanceId, exileInstead ? 'exile' : 'graveyard');
  const newCards = new Map(state.cards);
  newCards.set(cardInstanceId, { ...card, zone: destZone });
  const newStack = targetStackItem
    ? state.stack.filter(item => item !== targetStackItem)
    : state.stack;

  return { ...state, cards: newCards, stack: newStack };
}

function executeFight(state: GameState, fighterAId: string, fighterBId: string): GameState {
  const fighterA = state.cards.get(fighterAId);
  const fighterB = state.cards.get(fighterBId);
  if (!fighterA || !fighterB) return state;
  if (fighterA.zone !== 'battlefield' || fighterB.zone !== 'battlefield') return state;
  if (!isEffectiveCreature(state, fighterAId) || !isEffectiveCreature(state, fighterBId)) return state;

  const powerA = getEffectivePower(state, fighterAId);
  const powerB = getEffectivePower(state, fighterBId);
  let nextState = executeDealDamage(state, fighterBId, powerA, fighterAId);
  nextState = executeDealDamage(nextState, fighterAId, powerB, fighterBId);
  return nextState;
}

/**
 * Execute a ReturnFromGraveyard effect.
 * Moves target creature card from graveyard to hand or battlefield.
 */
function executeReturnFromGraveyard(
  state: GameState,
  targetId: string,
  destination: 'hand' | 'battlefield',
  counters: string[] = [],
  entersTapped = false,
): GameState {
  const card = state.cards.get(targetId);
  if (!card) return state;

  if (card.zone !== 'graveyard') return state;
  const finalDestination = getCommanderDestinationZone(state, targetId, destination);

  const nextCounters = { ...card.counters };
  if (finalDestination === 'battlefield') {
    for (const counter of counters) {
      nextCounters[counter] = (nextCounters[counter] || 0) + 1;
    }
  }

  const newCards = new Map(state.cards);
  if (finalDestination === 'battlefield') {
    const def = getCardDefinition(state, card);
    const entry = buildBattlefieldEntryPlan(state, card.ownerId, card, def, {
      summoningSick: true,
    });
    newCards.set(targetId, {
      ...entry.card,
      counters: nextCounters,
      ...(entersTapped ? { tapped: true } : {}),
    });
    return applyDirectBattlefieldEntrySideEffects({ ...state, cards: newCards, players: entry.players }, targetId);
  }

  newCards.set(targetId, {
    ...card,
    zone: finalDestination,
    tapped: false,
    damage: 0,
    counters: {},
    summoningSick: false,
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
  options: { sourceInstanceId?: string; delayedDamageEachOpponentPerCard?: number; mayPlay?: boolean } = {},
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
    const destination = getCommanderDestinationZone(state, card.instanceId, 'exile');
    if (destination === 'exile') exiledCardIds.push(card.instanceId);
    newCards.set(card.instanceId, {
      ...card,
      zone: destination,
      tapped: false,
      damage: 0,
      counters: {},
      ...(destination === 'exile' && options.mayPlay
        ? {
            playableFromExileUntilTurn: state.turnNumber,
            playableFromExileSourceId: options.sourceInstanceId,
          }
        : {
            playableFromExileUntilTurn: undefined,
            playableFromExileSourceId: undefined,
          }),
    });
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
    newCards.set(card.instanceId, {
      ...card,
      zone: getCommanderDestinationZone(state, card.instanceId, 'exile'),
      tapped: false,
      damage: 0,
      counters: {},
    });
  }

  for (; index < libraryCards.length; index++) {
    const card = libraryCards[index];
    const def = getCardDefinition(state, card);
    const isNamed = def.name.toLowerCase() === targetName;
    const intendedZone = isNamed ? foundDestination : 'exile';
    newCards.set(card.instanceId, {
      ...card,
      zone: getCommanderDestinationZone(state, card.instanceId, intendedZone),
      tapped: false,
      damage: 0,
      counters: {},
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
function evaluateCondition(
  state: GameState,
  condition: Condition,
  casterId: string,
  eventCtx?: ExecutionContext['eventContext'],
): boolean {
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
    case 'ControlsNone': {
      // Slice 1: negation of ControlsType — true when NO matching battlefield
      // permanent is controlled by the specified player(s).
      // Slice 9/11 extension: also checks instance-level tapped state when
      // condition.filter.tapped is defined (e.g. "you control no untapped lands").
      const cnPlayerId = condition.controller === 'you' ? casterId : undefined;
      for (const [instanceId, card] of state.cards) {
        if (card.zone !== 'battlefield') continue;
        if (cnPlayerId && card.ownerId !== cnPlayerId) continue;
        if (!cnPlayerId && card.ownerId === casterId) continue; // exclude caster when opponent
        if (condition.excludeSource && instanceId === (eventCtx as any)?.sourceInstanceId) continue;
        const def = getCardDefinition(state, card);
        if (!matchesCardFilter(def, condition.filter)) continue;
        // Instance-level tapped check (matchesCardFilter operates on def only)
        if (condition.filter.tapped !== undefined && card.tapped !== condition.filter.tapped) continue;
        return false;
      }
      return true;
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
    case 'CardsInZoneAtLeast': {
      const playerIds = resolveControllerIds(state, casterId, condition.controller);
      let count = 0;
      for (const [, card] of state.cards) {
        if (card.zone !== condition.zone) continue;
        if (!playerIds.includes(card.ownerId)) continue;
        if (condition.filter) {
          const def = getCardDefinition(state, card);
          if (!matchesCardFilter(def, condition.filter)) continue;
        }
        count++;
        if (count >= condition.count) return true;
      }
      return false;
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
    case 'LifeAtOrBelowHalfStarting': {
      // Slice 7: "as long as your life total is less than or equal to half your starting
      // life total" — Bhaal / Myrkul family. The threshold is half startingLife (default 40).
      const player = condition.controller === 'you'
        ? state.players.find(p => p.id === casterId)
        : state.players.find(p => p.id !== casterId && !p.hasLost);
      if (!player) return false;
      const threshold = Math.floor((player.startingLife ?? 40) / 2);
      return player.life <= threshold;
    }
    case 'LifeAboveStarting': {
      // Slice 7: "as long as your life total is greater than your starting life total"
      // — Elenda, Saint of Dusk family.
      const player = condition.controller === 'you'
        ? state.players.find(p => p.id === casterId)
        : state.players.find(p => p.id !== casterId && !p.hasLost);
      return player ? player.life > (player.startingLife ?? 40) : false;
    }
    case 'PlayerAttackedThisTurn': {
      const attacked = new Set(state.playersWhoAttackedThisTurn || []);
      if (condition.controller === 'you') return attacked.has(casterId);
      return state.players.some(player => player.id !== casterId && !player.hasLost && attacked.has(player.id));
    }
    case 'ColorIsMostCommonAmongPermanents': {
      // Mirrors continuous.ts evaluateCondition — a multicolored permanent
      // counts once for EACH of its colors; colorless counts for nothing.
      const counts: Record<'W' | 'U' | 'B' | 'R' | 'G', number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
      for (const [, card] of state.cards) {
        if (card.zone !== 'battlefield') continue;
        const def = getCardDefinition(state, card);
        for (const color of def.colors) {
          if (color in counts) counts[color as keyof typeof counts]++;
        }
      }
      const target = counts[condition.color];
      const others = (Object.keys(counts) as Array<keyof typeof counts>)
        .filter(color => color !== condition.color);
      if (condition.orTiedForMost) return others.every(color => counts[color] <= target);
      return others.every(color => counts[color] < target);
    }
    case 'ControlsCommander': {
      // Slice 12: true when the caster controls their commander on the battlefield.
      for (const [instanceId, card] of state.cards) {
        if (card.zone !== 'battlefield') continue;
        if (card.ownerId !== casterId) continue;
        if (isOwnersCommander(state, instanceId)) return true;
      }
      return false;
    }
    case 'CreatureDiedThisTurn': {
      // Slice 6: true when at least one creature has died this turn.
      return (state.creaturesDiedThisTurn ?? 0) > 0;
    }
    case 'OpponentsControlAtLeast': {
      // Slice 6: true when opponents collectively control at least `count` matching permanents.
      let count = 0;
      for (const [, card] of state.cards) {
        if (card.zone !== 'battlefield') continue;
        if (card.ownerId === casterId) continue;
        const def = getCardDefinition(state, card);
        if (matchesCardFilter(def, condition.what)) count++;
        if (count >= condition.count) return true;
      }
      return false;
    }
    case 'EventPlayerHasMoreCardsInHand': {
      // Slice 12: Anvil of Bogardan family — "if that player has more cards in hand than you."
      // "That player" = eventPlayerId; "you" = casterId (the trigger controller).
      const ephmPlayerId = eventCtx?.eventPlayerId ?? '';
      if (!ephmPlayerId || ephmPlayerId === casterId) return false;
      const ephmEventHandCount = [...state.cards.values()].filter(
        c => c.ownerId === ephmPlayerId && c.zone === 'hand',
      ).length;
      const ephmControllerHandCount = [...state.cards.values()].filter(
        c => c.ownerId === casterId && c.zone === 'hand',
      ).length;
      return ephmEventHandCount > ephmControllerHandCount;
    }
    case 'NoSpellsLastTurn': {
      // Slice 2 (werewolf day->night): "if no spells were cast last turn."
      return (state.spellsCastLastTurn ?? 0) === 0;
    }
    case 'AnyPlayerTwoOrMoreSpellsLastTurn': {
      // Slice 2 (werewolf night->day): "if a player cast two or more spells last turn."
      return (state.spellsCastLastTurn ?? 0) >= 2;
    }
    case 'EnteredByCasting': {
      // Slice 11 (intervening-if ETB): true when the permanent that triggered this
      // ETB ability entered the battlefield as a result of being cast. Populated by
      // createETBTriggers when called from spell resolution in stack.ts.
      return eventCtx?.enteredViaCast === true;
    }
    case 'SpellsCastThisTurnAtLeast': {
      // Slice 9/11: "as long as you've cast N or more spells this turn."
      return (state.spellsCastThisTurn ?? 0) >= condition.count;
    }
    case 'DistinctManaValuesInGraveyardAtLeast': {
      // Slice 9/11: "as long as there are N or more mana values among cards in your graveyard."
      const distinctCmcsEx = new Set<number>();
      for (const [, card] of state.cards) {
        if (card.zone !== 'graveyard') continue;
        if (card.ownerId !== casterId) continue;
        const def = getCardDefinition(state, card);
        distinctCmcsEx.add(def.cmc);
        if (distinctCmcsEx.size >= condition.count) return true;
      }
      return false;
    }
    case 'CardTypesInGraveyardAtLeast': {
      // Slice 5 (Delirium): "as long as there are four or more card types among cards in
      // your graveyard." Mirrors the evaluateCondition branch in continuous.ts.
      const distinctTypesEx = new Set<string>();
      for (const [, card] of state.cards) {
        if (card.zone !== 'graveyard') continue;
        if (card.ownerId !== casterId) continue;
        const def = getCardDefinition(state, card);
        for (const ct of def.card_types) {
          distinctTypesEx.add(ct);
          if (distinctTypesEx.size >= condition.count) return true;
        }
        for (const t of ['artifact', 'creature', 'enchantment', 'instant', 'land',
                         'planeswalker', 'sorcery', 'battle']) {
          if (typeLineHasType(def.type_line, t)) {
            distinctTypesEx.add(t);
            if (distinctTypesEx.size >= condition.count) return true;
          }
        }
      }
      return distinctTypesEx.size >= condition.count;
    }
    case 'TopCardOfLibraryIs': {
      // Slice 4 (top-card-conditional anthem): evaluate against the controller's top
      // library card in an effect/trigger body. Mirrors the evaluateCondition branch
      // in continuous.ts — the first library card in Map insertion order is the top.
      let topDefEx: CardDefinition | null = null;
      for (const [, card] of state.cards) {
        if (card.zone !== 'library') continue;
        if (card.ownerId !== casterId) continue;
        topDefEx = getCardDefinition(state, card);
        break;
      }
      if (!topDefEx) return false;
      if (condition.colors && condition.colors.length > 0) {
        return condition.colors.some(c => (topDefEx!.colors as string[]).includes(c));
      }
      if (condition.cardTypes && condition.cardTypes.length > 0) {
        return condition.cardTypes.some(t => (topDefEx!.card_types as string[]).includes(t));
      }
      return false;
    }
    case 'IsActivePlayer': {
      // Slice 11 (self conditional anthem): "During your turn, this creature gets +N/+N."
      // True when the caster/controller is the current active player.
      // Mirrors the evaluateCondition branch in continuous.ts.
      const activePlayer = state.players[state.activePlayerIndex];
      return !!activePlayer && activePlayer.id === casterId;
    }
    case 'SelfIsUntapped': {
      // Slice 2 — conditional self-buff: "as long as it's untapped."
      // In an executor (trigger/spell) context there is no sourceInstanceId;
      // these conditions are meaningful only for continuous statics, so return false.
      return false;
    }
    case 'SelfIsAttacking': {
      // Slice 2 — conditional self-buff: "as long as it's attacking."
      // Same as SelfIsUntapped — not applicable in executor context.
      return false;
    }
    case 'SelfIsEquipped': {
      // Slice 5 — "as long as this creature is equipped."
      // Meaningful only for continuous statics; not applicable in executor context.
      return false;
    }
    case 'SelfIsEnchanted': {
      // Slice 5 — "as long as this creature is enchanted."
      // Meaningful only for continuous statics; not applicable in executor context.
      return false;
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
function executeReturnFromExile(state: GameState, targetId: string): GameState {
  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'exile') return state;

  const def = getCardDefinition(state, card);
  const entry = buildBattlefieldEntryPlan(
    state,
    card.ownerId,
    {
      ...card,
      zone: 'battlefield',
      counters: {},
      damage: 0,
      grantedKeywords: undefined,
      lostKeywords: undefined,
      phasedOut: undefined,
      attachedTo: undefined,
    },
    def,
    { summoningSick: true },
  );
  const newCards = new Map(state.cards);
  newCards.set(targetId, entry.card);

  return applyDirectBattlefieldEntrySideEffects({ ...state, cards: newCards, players: entry.players }, targetId);
}

function executeBlink(state: GameState, targetId: string, delayed = false): GameState {
  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'battlefield') return state;

  if (delayed) {
    const destination = getCommanderDestinationZone(state, targetId, 'exile');
    const newCards = new Map(state.cards);
    newCards.set(targetId, {
      ...card,
      zone: destination,
      tapped: false,
      damage: 0,
      counters: {},
      grantedKeywords: undefined,
      lostKeywords: undefined,
      phasedOut: undefined,
      attachedTo: undefined,
    });
    const delayedTriggers = destination === 'exile'
      ? [
          ...(state.delayedTriggers || []),
          {
            id: `delayed_blink_${targetId}_${state.turnNumber}_${(state.delayedTriggers || []).length + 1}`,
            sourceInstanceId: targetId,
            controllerId: card.ownerId,
            trigger: { kind: 'EndStep' as const, whose: 'next' as const },
            effects: [{ kind: 'ReturnFromExile' as const, target: { kind: 'Source' as const } }],
            oneShot: true,
          },
        ]
      : state.delayedTriggers;
    return pruneDetachedEffects({ ...state, cards: newCards, delayedTriggers });
  }

  const def = getCardDefinition(state, card);
  const entry = buildBattlefieldEntryPlan(
    state,
    card.ownerId,
    {
      ...card,
      counters: {},
      damage: 0,
      grantedKeywords: undefined,
      lostKeywords: undefined,
      phasedOut: undefined,
      attachedTo: undefined,
    },
    def,
    { summoningSick: true },
  );
  const newCards = new Map(state.cards);
  newCards.set(targetId, entry.card);

  return applyDirectBattlefieldEntrySideEffects({ ...state, cards: newCards, players: entry.players }, targetId);
}

/**
 * Copy: create a token with the target's copiable card definition and entry choices.
 * Damage, counters, attachments, and temporary grants are intentionally not copied.
 */
function executeCopy(state: GameState, targetId: string, controllerId: string): GameState {
  const card = state.cards.get(targetId);
  if (!card) return state;

  // Create a token copy with a fresh instance ID
  const copyId = `copy_${++tokenInstanceCounter}`;
  const def = getCardDefinition(state, card);
  const copiedChoices = card.choices ? {
    chosenCreatureType: card.choices.chosenCreatureType,
    chosenColor: card.choices.chosenColor,
    chosenOpponent: card.choices.chosenOpponent,
    chosenCardName: card.choices.chosenCardName,
    imprintedCardIds: card.choices.imprintedCardIds ? [...card.choices.imprintedCardIds] : undefined,
    discardedCardIds: card.choices.discardedCardIds ? [...card.choices.discardedCardIds] : undefined,
  } : undefined;
  const entry = buildBattlefieldEntryPlan(
    state,
    controllerId,
    {
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
      ...(card.activeFaceName ? { activeFaceName: card.activeFaceName } : {}),
      ...(copiedChoices ? { choices: copiedChoices } : {}),
    },
    def,
    { summoningSick: true, choices: copiedChoices },
  );
  const newCards = new Map(state.cards);
  newCards.set(copyId, entry.card);

  return applyDirectBattlefieldEntrySideEffects({ ...state, cards: newCards, players: entry.players }, copyId);
}

/**
 * Slice 7 (becomes-copy): temporarily replace a permanent's copiable characteristics.
 *
 * Resolves the copy source, finds the target permanent(s), and writes
 * `becomesCopyOfDefinitionId` on each. `getCardDefinition` returns the copied
 * definition for the rest of the turn; `cleanupDamage` clears the field at EOT.
 *
 * Mass form (Mirrorweave): when `effect.mass` is true, every battlefield creature
 * OTHER THAN the copy source is transformed.  The copy source itself is left alone
 * (you can't become a copy of yourself).
 *
 * Single-target form: `effect.subject` holds the target permanent.
 */
function executeBecomesCopy(
  state: GameState,
  effect: BecomesCopyEffect,
  casterId: string,
  chosenTargets: Map<string, string>,
  sourceInstanceId: string | undefined,
  eventContext: ExecutionContext['eventContext'],
): GameState {
  // Resolve the copy source
  const copySourceId = resolveTargetRef(effect.copySource, casterId, chosenTargets, state, eventContext);
  if (!copySourceId) return state;
  const copySourceCard = state.cards.get(copySourceId);
  if (!copySourceCard || copySourceCard.zone !== 'battlefield') return state;

  // The definition id that all affected permanents will copy
  const newDefId = copySourceCard.becomesCopyOfDefinitionId ?? copySourceCard.definitionId;

  const newCards = new Map(state.cards);

  if (effect.mass) {
    // Mirrorweave: every other battlefield creature becomes a copy
    for (const card of state.cards.values()) {
      if (card.zone !== 'battlefield') continue;
      if (card.phasedOut) continue;
      if (card.instanceId === copySourceId) continue; // skip the source itself
      // Only creatures
      const def = getCardDefinition(state, card);
      if (!def.card_types.includes('creature')) continue;
      newCards.set(card.instanceId, { ...card, becomesCopyOfDefinitionId: newDefId });
    }
  } else {
    // Single-target form
    const subjectId = effect.subject.kind === 'Source'
      ? sourceInstanceId
      : resolveTargetRef(effect.subject, casterId, chosenTargets, state, eventContext);
    if (!subjectId) return state;
    const subjectCard = state.cards.get(subjectId);
    if (!subjectCard || subjectCard.zone !== 'battlefield') return state;
    newCards.set(subjectId, { ...subjectCard, becomesCopyOfDefinitionId: newDefId });
  }

  return { ...state, cards: newCards };
}

/**
 * EnterAsCopy: apply copy-characteristics to the entering permanent.
 *
 * Called when a Clone-family permanent resolves. The entering card (identified by
 * `enteringInstanceId`) has its definitionId replaced with the chosen battlefield
 * permanent's definitionId, mirroring the copiable-characteristics rule (CR 707.2).
 * Only the definition pointer is updated; zone, controller, isCommander, and
 * summoning-sickness flags are preserved.
 *
 * The "best" copy target is chosen AI-optimally:
 *   1. Prefer opponent creatures (maximises value gained).
 *   2. Among ties fall back to any battlefield creature / creature-or-artifact.
 *   3. If the entering permanent IS the only candidate it is skipped (can't copy itself).
 *
 * When `subtypeFilter` is set, only creatures with a matching type_line subtype are legal.
 * When `includesArtifacts` is true, artifact permanents are also legal choices.
 *
 * If no legal candidate exists the permanent enters as itself (no-op).
 */
function executeEnterAsCopy(
  state: GameState,
  enteringInstanceId: string,
  effect: EnterAsCopyEffect,
  casterId?: string,
): GameState {
  const entering = state.cards.get(enteringInstanceId);
  if (!entering || entering.zone !== 'battlefield') return state;

  const sourceVariant = effect.sourceVariant ?? 'battlefield';

  // Collect legal copy targets based on the source variant.
  const candidates: { card: CardInstance; def: CardDefinition }[] = [];
  for (const card of state.cards.values()) {
    if (card.instanceId === enteringInstanceId) continue;

    if (sourceVariant === 'graveyard') {
      if (card.zone !== 'graveyard') continue;
    } else if (sourceVariant === 'youControl') {
      if (card.zone !== 'battlefield') continue;
      if (card.phasedOut) continue;
      const owner = casterId ?? entering.ownerId;
      if (card.ownerId !== owner) continue;
    } else if (sourceVariant === 'opponentControls') {
      // "a creature an opponent controls" — must be on the battlefield, not controlled by caster
      if (card.zone !== 'battlefield') continue;
      if (card.phasedOut) continue;
      const owner = casterId ?? entering.ownerId;
      if (card.ownerId === owner) continue;
    } else if (sourceVariant === 'anotherCreatureYouControl') {
      // "another creature you control" — Sakashima of a Thousand Faces
      // Must be a controller-owned battlefield creature; excludes the entering permanent itself
      // (already excluded above by `card.instanceId === enteringInstanceId` check).
      if (card.zone !== 'battlefield') continue;
      if (card.phasedOut) continue;
      const owner = casterId ?? entering.ownerId;
      if (card.ownerId !== owner) continue;
    } else if (sourceVariant === 'artifactOrCreatureYouControl') {
      // "an artifact or creature you control" — battlefield, caster-controlled
      if (card.zone !== 'battlefield') continue;
      if (card.phasedOut) continue;
      const owner = casterId ?? entering.ownerId;
      if (card.ownerId !== owner) continue;
    } else if (sourceVariant === 'creatureOrPlaneswalkerYouControl') {
      // "a creature or planeswalker you control" — Spark Double
      if (card.zone !== 'battlefield') continue;
      if (card.phasedOut) continue;
      const owner = casterId ?? entering.ownerId;
      if (card.ownerId !== owner) continue;
    } else if (sourceVariant === 'permanentYouControl') {
      // "a permanent you control" — Moritte of the Frost
      if (card.zone !== 'battlefield') continue;
      if (card.phasedOut) continue;
      const owner = casterId ?? entering.ownerId;
      if (card.ownerId !== owner) continue;
    } else {
      // Default: 'battlefield'
      if (card.zone !== 'battlefield') continue;
      if (card.phasedOut) continue;
    }

    const def = getCardDefinition(state, card);
    const typeLine = def.type_line.toLowerCase();

    // ── Pool-type filter (Slice-8 noncreature pools) ─────────────────────────
    if (effect.poolType) {
      const isArtifact = def.card_types.includes('artifact');
      const isEnchantment = def.card_types.includes('enchantment');
      const isLand = def.card_types.includes('land');
      switch (effect.poolType) {
        case 'artifact':
          if (!isArtifact) continue;
          break;
        case 'enchantment':
          if (!isEnchantment) continue;
          break;
        case 'land':
          if (!isLand) continue;
          break;
        case 'nonlandPermanent':
          if (isLand) continue;
          break;
        case 'artifactOrEnchantment':
          if (!isArtifact && !isEnchantment) continue;
          break;
        case 'equipment':
          // Equipment is an artifact subtype; check type_line for "Equipment".
          if (!isArtifact || !typeLine.includes('equipment')) continue;
          break;
      }
    } else if (sourceVariant === 'anotherCreatureYouControl') {
      // "another creature you control" — must be a creature (Sakashima of a Thousand Faces)
      const isCreature = def.card_types.includes('creature');
      if (!isCreature) continue;
    } else if (sourceVariant === 'artifactOrCreatureYouControl') {
      // "an artifact or creature you control" — must be artifact or creature
      const isCreature = def.card_types.includes('creature');
      const isArtifact = def.card_types.includes('artifact');
      if (!isCreature && !isArtifact) continue;
    } else if (sourceVariant === 'creatureOrPlaneswalkerYouControl') {
      // "a creature or planeswalker you control" — Spark Double
      const isCreature = def.card_types.includes('creature');
      const isPlaneswalker = def.card_types.includes('planeswalker');
      if (!isCreature && !isPlaneswalker) continue;
    } else if (sourceVariant === 'permanentYouControl') {
      // "a permanent you control" — Moritte of the Frost: any permanent type qualifies
      // (creatures, artifacts, enchantments, planeswalkers, lands, battles)
      // No type filter needed — all battlefield permanents are legal.
    } else {
      // Legacy creature-centric filter (default for all pre-Slice-8 pools).
      const isCreature = def.card_types.includes('creature');
      const isArtifact = def.card_types.includes('artifact');
      if (!isCreature && !(effect.includesArtifacts && isArtifact)) continue;

      // Subtype filter (e.g. 'ally' for Jwari Shapeshifter).
      if (effect.subtypeFilter) {
        const sub = effect.subtypeFilter.toLowerCase();
        if (!typeLine.includes(sub)) continue;
      }
    }

    candidates.push({ card, def });
  }

  if (candidates.length === 0) return state;

  // AI heuristic: prefer opponent's creature with highest combined P+T (power play value).
  let bestId = candidates[0].card.instanceId;
  let bestScore = -Infinity;
  for (const { card, def } of candidates) {
    const power = typeof def.power === 'number' ? def.power : 0;
    const toughness = typeof def.toughness === 'number' ? def.toughness : 0;
    const isOpponent = card.ownerId !== entering.ownerId ? 10 : 0; // prefer opponents' permanents
    const score = power + toughness + isOpponent;
    if (score > bestScore) {
      bestScore = score;
      bestId = card.instanceId;
    }
  }

  const bestCard = state.cards.get(bestId);
  if (!bestCard) return state;

  const bestDef = getCardDefinition(state, bestCard);

  // When nameOverride is '~', capture the entering permanent's original name.
  let nameOverride: string | undefined;
  if (effect.nameOverride === '~') {
    const origDef = state.cardDefinitions.get(entering.definitionId);
    nameOverride = origDef?.name ?? entering.definitionId;
  }

  // Apply copy-characteristics: update the entering permanent's definitionId and
  // copy any copiable entry choices (activeFaceName, chosenCreatureType, chosenColor).
  const newCards = new Map(state.cards);
  const copiedChoices = bestCard.choices
    ? {
        chosenCreatureType: bestCard.choices.chosenCreatureType,
        chosenColor: bestCard.choices.chosenColor,
        chosenOpponent: bestCard.choices.chosenOpponent,
        chosenCardName: bestCard.choices.chosenCardName,
        imprintedCardIds: bestCard.choices.imprintedCardIds
          ? [...bestCard.choices.imprintedCardIds]
          : undefined,
        discardedCardIds: bestCard.choices.discardedCardIds
          ? [...bestCard.choices.discardedCardIds]
          : undefined,
      }
    : undefined;

  // Slice-8: build additionalTypes overlay, including addedLegendary.
  let resolvedAdditionalTypes: string[] | undefined = effect.additionalTypes
    ? [...effect.additionalTypes]
    : undefined;
  if (effect.addedLegendary) {
    // Append 'legendary' supertype overlay so checks that read additionalTypes see it.
    resolvedAdditionalTypes = resolvedAdditionalTypes ? [...resolvedAdditionalTypes, 'legendary'] : ['legendary'];
  }

  newCards.set(enteringInstanceId, {
    ...entering,
    definitionId: bestDef.id,
    copiedFromDefinitionId: bestDef.id,
    ...(bestCard.activeFaceName ? { activeFaceName: bestCard.activeFaceName } : {}),
    ...(copiedChoices ? { choices: copiedChoices } : {}),
    // Slice-6 riders:
    ...(nameOverride !== undefined ? { nameOverride } : {}),
    ...(resolvedAdditionalTypes ? { additionalTypes: resolvedAdditionalTypes } : {}),
    // Slice-7: "except it isn't legendary" suppresses legendary supertype of copied def.
    ...(effect.nonLegendary ? { nonLegendary: true } : {}),
  });

  let newState = { ...state, cards: newCards };

  // Apply entryCounter rider ("except it enters with a <type> counter on it").
  if (effect.entryCounter) {
    newState = executeAddCounters(
      newState,
      enteringInstanceId,
      effect.entryCounter.counterType,
      effect.entryCounter.count,
    );
  }

  // Apply addedKeywords rider ("except it has <keyword>").
  if (effect.addedKeywords) {
    for (const kw of effect.addedKeywords) {
      newState = executeGrantKeyword(newState, enteringInstanceId, kw);
    }
  }

  // Slice-8: Apply P/T override rider ("except it's N/N" — Quicksilver Gargantuan).
  // After copying, the entered card has bestDef's printed P/T as its base. To make
  // effective P/T equal to ptOverride, store the delta in _powerMod/_toughnessMod
  // counters (the same mechanism used by executeModifyPT for temporary boosts).
  if (effect.ptOverride) {
    const copiedPower = typeof bestDef.power === 'number' ? bestDef.power : 0;
    const copiedToughness = typeof bestDef.toughness === 'number' ? bestDef.toughness : 0;
    const powerDelta = effect.ptOverride.power - copiedPower;
    const toughnessDelta = effect.ptOverride.toughness - copiedToughness;
    if (powerDelta !== 0 || toughnessDelta !== 0) {
      const overriddenCard = newState.cards.get(enteringInstanceId)!;
      const overriddenCards = new Map(newState.cards);
      overriddenCards.set(enteringInstanceId, {
        ...overriddenCard,
        counters: {
          ...overriddenCard.counters,
          '_powerMod': (overriddenCard.counters['_powerMod'] || 0) + powerDelta,
          '_toughnessMod': (overriddenCard.counters['_toughnessMod'] || 0) + toughnessDelta,
        },
      });
      newState = { ...newState, cards: overriddenCards };
    }
  }

  return newState;
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
 * Temporarily remove a keyword ability from a creature.
 * For "until end of turn" effects, cleanup clears lostKeywords.
 */
function executeLoseKeyword(state: GameState, targetId: string, keyword: string): GameState {
  const card = state.cards.get(targetId);
  if (!card || card.zone !== 'battlefield') return state;

  const newCards = new Map(state.cards);
  const currentLost = card.lostKeywords || [];
  if (!currentLost.includes(keyword)) {
    newCards.set(targetId, {
      ...card,
      lostKeywords: [...currentLost, keyword],
    });
  } else {
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
  const { casterId, chosenTargets, chosenTargetsMulti, xValue, namedCardChoices, sourceInstanceId, eventContext } = ctx;

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
      // Slice 2: EventDamageAmount — "draw that many cards" in a combat-damage trigger body.
      const drawCount =
        typeof effect.count === 'object' && effect.count.kind === 'EventDamageAmount'
          ? (eventContext?.eventDamageAmount ?? 0)
          : resolveAmount(effect.count, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId);
      return executeDraw(state, drawPlayerId, drawCount);
    }
    case 'Destroy': {
      const noRegen = effect.noRegen ?? false;
      if (effect.target.kind === 'AllCreatures') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone === 'battlefield') {
            if (isEffectiveCreature(s, card.instanceId)) {
              s = executeDestroy(s, card.instanceId, noRegen);
            }
          }
        }
        return s;
      }
      // AllOfType: destroy all permanents matching filter
      if (effect.target.kind === 'AllOfType') {
        let s = state;
        // Pre-compute combat sets for blocking/blocked/attacking filters (Slice 8).
        const attackerIds = state.combat ? new Set(state.combat.attackers.map(a => a.cardInstanceId)) : new Set<string>();
        const blockerIds = state.combat ? new Set(state.combat.blockers.map(b => b.cardInstanceId)) : new Set<string>();
        // "blocked creatures" = attackers that have at least one blocker assigned.
        const blockedAttackerIds = state.combat
          ? new Set(state.combat.blockers.map(b => b.blockingAttackerId))
          : new Set<string>();
        for (const [, card] of state.cards) {
          if (card.zone === 'battlefield') {
            const def = getCardDefinition(state, card);
            if (!matchesCardFilter(def, effect.target.filter)) continue;
            // Slice 4: tapped/untapped filter (instance state check)
            if (effect.target.filter.tapped === true && !card.tapped) continue;
            if (effect.target.filter.tapped === false && card.tapped) continue;
            // Slice 8: token/nontoken filter (instance state check)
            if (effect.target.filter.tokenOnly && !card.isToken) continue;
            if (effect.target.filter.nontoken && card.isToken) continue;
            // Slice 8: blocking/blocked/attacking filter (combat state check)
            if (effect.target.filter.blocking && !blockerIds.has(card.instanceId)) continue;
            if (effect.target.filter.blocked && !blockedAttackerIds.has(card.instanceId)) continue;
            if (effect.target.filter.attacking && !attackerIds.has(card.instanceId)) continue;
            s = executeDestroy(s, card.instanceId, noRegen);
          }
        }
        return s;
      }
      if (effect.target.kind === 'Source') {
        if (!sourceInstanceId) return state;
        return executeDestroy(state, sourceInstanceId, noRegen);
      }
      // Apply to every chosen target ("destroy up to N target creatures" maps a
      // single Chosen ref to N ids); single-target specs yield exactly one id.
      const destroyTargetIds = resolveChosenTargetIds(
        effect.target, casterId, chosenTargets, chosenTargetsMulti, state, eventContext,
      );
      let destroyState = state;
      for (const id of destroyTargetIds) {
        if (!id) continue;
        destroyState = executeDestroy(destroyState, id, noRegen);
      }
      return destroyState;
    }
    case 'DealDamage': {
      // "deals damage equal to its power" => power of the source permanent itself.
      // resolveTargetRef throws on {kind:'Source'}, so pass sourceInstanceId as the
      // targetId override (used directly by resolveAmount's TargetPower branch). Only
      // for the Source case, so ordinary chosen-target TargetPower is unaffected.
      // Slice 10: SourceAttachedTo TargetPower — "enchanted creature deals damage equal
      // to its power" — resolve the attached creature's id for the power lookup.
      const dmgPowerSourceId =
        typeof effect.amount === 'object'
        && effect.amount.kind === 'TargetPower'
        && effect.amount.target.kind === 'Source'
          ? sourceInstanceId
          : typeof effect.amount === 'object'
            && effect.amount.kind === 'TargetPower'
            && effect.amount.target.kind === 'SourceAttachedTo'
            ? getSourceAttachedTo(state, sourceInstanceId) ?? undefined
            : undefined;
      if (effect.target.kind === 'EachOpponent' || effect.target.kind === 'EachPlayer') {
        // Slice 2: EventDamageAmount — "it deals that much damage to each other opponent"
        const dmgAmount =
          typeof effect.amount === 'object' && effect.amount.kind === 'EventDamageAmount'
            ? (eventContext?.eventDamageAmount ?? 0)
            : resolveAmount(effect.amount, xValue, state, casterId, chosenTargets, dmgPowerSourceId, undefined, sourceInstanceId);
        const opponentsOnly = effect.target.kind === 'EachOpponent';
        let s = state;
        for (const p of state.players) {
          if (p.hasLost) continue;
          if (opponentsOnly && p.id === casterId) continue;
          s = executeDealDamage(s, p.id, dmgAmount, sourceInstanceId);
        }
        return s;
      }
      if (effect.target.kind === 'AllCreatures' || effect.target.kind === 'AllCreaturesYouControl') {
        const dmgAmount = resolveAmount(effect.amount, xValue, state, casterId, chosenTargets, dmgPowerSourceId, undefined, sourceInstanceId);
        const youOnly = effect.target.kind === 'AllCreaturesYouControl';
        const ids = [...state.cards.values()]
          .filter(c => c.zone === 'battlefield' && (!youOnly || c.ownerId === casterId) && isEffectiveCreature(state, c.instanceId))
          .map(c => c.instanceId);
        let s = state;
        for (const id of ids) s = executeDealDamage(s, id, dmgAmount, sourceInstanceId);
        return s;
      }
      if (effect.target.kind === 'AllOtherCreatures') {
        // "~ deals N damage to each other creature" — every battlefield creature
        // EXCEPT the source itself (Chaos Maw / Pyrohemia style). Never damages source.
        const dmgAmount = resolveAmount(effect.amount, xValue, state, casterId, chosenTargets, dmgPowerSourceId, undefined, sourceInstanceId);
        const ids = [...state.cards.values()]
          .filter(c => c.zone === 'battlefield'
            && c.instanceId !== sourceInstanceId
            && isEffectiveCreature(state, c.instanceId))
          .map(c => c.instanceId);
        let s = state;
        for (const id of ids) s = executeDealDamage(s, id, dmgAmount, sourceInstanceId);
        return s;
      }
      // Slice 4 (OptionalPay reflexive): AllOfType — "~ deals N damage to each <filter> creature"
      // (Oros / Dromar / Darigaaz family: noncolor mass damage, e.g. "each nonwhite creature").
      // Slice 3: AllOfType with eventPlayerControls — "it deals that much damage to each creature
      // that player controls" (Balefire Dragon family). Restricts targets to the event player's
      // permanents and resolves EventDamageAmount from eventContext.eventDamageAmount.
      if (effect.target.kind === 'AllOfType') {
        const dmgAmount =
          typeof effect.amount === 'object' && effect.amount.kind === 'EventDamageAmount'
            ? (eventContext?.eventDamageAmount ?? 0)
            : resolveAmount(effect.amount, xValue, state, casterId, chosenTargets, dmgPowerSourceId, undefined, sourceInstanceId);
        const eventPlayerId = eventContext?.eventPlayerId;
        const restrictToEventPlayer = effect.target.eventPlayerControls && eventPlayerId != null;
        let s = state;
        for (const card of state.cards.values()) {
          if (card.zone !== 'battlefield') continue;
          if (!isEffectiveCreature(s, card.instanceId)) continue;
          // Slice 3: restrict to the event player's creatures when eventPlayerControls is set
          if (restrictToEventPlayer && card.ownerId !== eventPlayerId) continue;
          const def = getCardDefinition(s, card);
          if (!matchesCardFilter(def, effect.target.filter)) continue;
          s = executeDealDamage(s, card.instanceId, dmgAmount, sourceInstanceId);
        }
        return s;
      }
      // Slice 8: "up to one" optional second target in matchDealDamageTwoTargets — when the
      // player chose 0 creatures the Chosen ref has no entry in chosenTargets. Guard here
      // (same pattern as Fight's optional-fighterB guard) so resolveTargetRef does not throw.
      if (effect.target.kind === 'Chosen' && !chosenTargets.get(effect.target.targetId)) {
        return state;
      }
      const dmgTargetId = resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      if (!dmgTargetId) return state;
      // Slice 5: EventDamageAmount — "this Aura deals that much damage to that creature's controller" (Guilty Conscience family).
      // Slice 10: EventCreatureStat — "deals damage equal to that creature's toughness/power".
      // Slice 12: pass eventPlayerId so ForEach{controller:'eventPlayer'} counts the
      // upkeep-trigger's active player's permanents (Ancient Runes / Primal Order family).
      // Brion Stoutarm family: SacrificedCreaturePower — power captured during cost payment.
      // Slice 4: RevealedRandomCardManaValue — Planeswalker's Fury family.
      const dmgAmount =
        typeof effect.amount === 'object' && effect.amount.kind === 'EventDamageAmount'
          ? (eventContext?.eventDamageAmount ?? 0)
          : typeof effect.amount === 'object' && effect.amount.kind === 'SacrificedCreaturePower'
            ? parseInt(namedCardChoices.get('sacrificedCreaturePower') ?? '0', 10)
            : typeof effect.amount === 'object' && effect.amount.kind === 'RevealedRandomCardManaValue'
              ? (ctx.lastRevealedCardManaValue ?? 0)
              : resolveAmount(effect.amount, xValue, state, casterId, chosenTargets, dmgPowerSourceId, eventContext?.cardInstanceId, sourceInstanceId, eventContext?.eventPlayerId);
      return executeDealDamage(state, dmgTargetId, dmgAmount, sourceInstanceId);
    }
    case 'DealDamageDivided': {
      // "~ deals N|X damage divided as you choose among ..." — a single
      // multi-target spec; the TOTAL is split across every chosen id and each
      // portion is applied through the regular executeDealDamage path. An
      // explicit division may ride the choice payload (namedCardChoices) as
      // comma-separated portions parallel to the chosen ids ("damageDivision":
      // "2,1"); it is honored only when it parallels the ids, every portion is
      // a non-negative integer, and the portions sum to the resolved total.
      // Otherwise (AI / no prompt) the total is split evenly with the
      // remainder to the earliest chosen targets — all to the first target
      // when only one was chosen.
      //
      // Ids that are neither a player nor a known card are dropped before
      // dividing (sanitizeTargetsAtResolution substitutes placeholder markers
      // for unfilled multi-target slots); ids for permanents that left the
      // battlefield keep their portion, which then no-ops inside
      // executeDealDamage (CR 601.2: a removed target's share is lost, not
      // redistributed).
      const dividedIds = resolveChosenTargetIds(
        effect.target, casterId, chosenTargets, chosenTargetsMulti, state, eventContext,
      ).filter(id => !!id && (state.players.some(p => p.id === id) || state.cards.has(id)));
      if (dividedIds.length === 0) return state;
      const dividedTotal = resolveAmount(effect.amount, xValue, state, casterId, chosenTargets);
      if (dividedTotal <= 0) return state;

      let portions: number[] | null = null;
      const rawDivision = (effect.target.kind === 'Chosen'
        ? namedCardChoices.get(`damageDivision:${effect.target.targetId}`)
        : undefined) ?? namedCardChoices.get('damageDivision');
      if (rawDivision) {
        const parsedPortions = rawDivision.split(',').map(part => parseInt(part.trim(), 10));
        const validDivision = parsedPortions.length === dividedIds.length
          && parsedPortions.every(portion => Number.isInteger(portion) && portion >= 0)
          && parsedPortions.reduce((sum, portion) => sum + portion, 0) === dividedTotal;
        if (validDivision) portions = parsedPortions;
      }
      if (!portions) {
        const base = Math.floor(dividedTotal / dividedIds.length);
        const remainder = dividedTotal % dividedIds.length;
        portions = dividedIds.map((_, index) => base + (index < remainder ? 1 : 0));
      }

      let dividedState = state;
      for (let index = 0; index < dividedIds.length; index++) {
        if (portions[index] <= 0) continue;
        dividedState = executeDealDamage(dividedState, dividedIds[index], portions[index], sourceInstanceId);
      }
      return dividedState;
    }
    case 'DealDamageEachTarget': {
      // Slice 8: "it deals N damage to each of up to two targets." — each chosen
      // target takes effect.amount damage independently (not N split among them).
      // Uses the multi-target spec's chosen ids (chosenTargetsMulti). Ids absent
      // from the map (minCount=0 means player chose 0) are silently skipped.
      const eachIds = resolveChosenTargetIds(
        effect.target, casterId, chosenTargets, chosenTargetsMulti, state, eventContext,
      ).filter(id => !!id && (state.players.some(p => p.id === id) || state.cards.has(id)));
      let eachState = state;
      for (const id of eachIds) {
        eachState = executeDealDamage(eachState, id, effect.amount, sourceInstanceId);
      }
      return eachState;
    }
    case 'DealDamageAllByPower': {
      // Slice 5 (bite family): "Each other <Subtype> you control deals damage equal
      // to its power to <target>." — each matching permanent deals its OWN power.
      const dabpTargetId = resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      if (!dabpTargetId) return state;
      let dabpState = state;
      for (const card of state.cards.values()) {
        if (card.zone !== 'battlefield') continue;
        if (effect.excludeSource && card.instanceId === sourceInstanceId) continue;
        if (effect.controller === 'you' && card.ownerId !== casterId) continue;
        if (!matchesCardFilter(getCardDefinition(dabpState, card), effect.sourceFilter)) continue;
        const perPower = getEffectivePower(dabpState, card.instanceId);
        if (perPower <= 0) continue;
        dabpState = executeDealDamage(dabpState, dabpTargetId, perPower, card.instanceId);
      }
      return dabpState;
    }
    case 'DistributeCounters': {
      // "Distribute N +1/+1 counters among one, two, or three target creatures."
      // Same allocation logic as DealDamageDivided but applying counter additions.
      // An explicit division may ride namedCardChoices as "counterDivision": "2,1"
      // (comma-separated portions parallel to the chosen ids). Absent or invalid →
      // split as evenly as possible, remainder going to the earliest chosen targets.
      // Chosen targets that left the battlefield are filtered out; their share is lost
      // (mirror of CR 601.2 damage-division policy).
      const distIds = resolveChosenTargetIds(
        effect.target, casterId, chosenTargets, chosenTargetsMulti, state, eventContext,
      ).filter(id => !!id && state.cards.has(id));
      if (distIds.length === 0) return state;
      const distTotal = resolveAmount(effect.total, xValue, state, casterId, chosenTargets);
      if (distTotal <= 0) return state;

      let distPortions: number[] | null = null;
      const rawDistDiv = (effect.target.kind === 'Chosen'
        ? namedCardChoices.get(`counterDivision:${effect.target.targetId}`)
        : undefined) ?? namedCardChoices.get('counterDivision');
      if (rawDistDiv) {
        const parsedDistPortions = rawDistDiv.split(',').map(part => parseInt(part.trim(), 10));
        const validDistDivision = parsedDistPortions.length === distIds.length
          && parsedDistPortions.every(portion => Number.isInteger(portion) && portion >= 0)
          && parsedDistPortions.reduce((sum, portion) => sum + portion, 0) === distTotal;
        if (validDistDivision) distPortions = parsedDistPortions;
      }
      if (!distPortions) {
        const distBase = Math.floor(distTotal / distIds.length);
        const distRemainder = distTotal % distIds.length;
        distPortions = distIds.map((_, index) => distBase + (index < distRemainder ? 1 : 0));
      }

      let distState = state;
      for (let index = 0; index < distIds.length; index++) {
        if (distPortions[index] <= 0) continue;
        distState = executeAddCounters(distState, distIds[index], effect.counterType, distPortions[index]);
      }
      return distState;
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
    case 'Fight': {
      // Slice 1: "it fights up to one target creature" — Source vs optional Chosen target.
      // If fighterA is Source, resolve it to sourceInstanceId; if fighterB is optional
      // (up-to-one, minCount=0) and no target was chosen, skip the fight entirely.
      // Slice 10: SourceAttachedTo — "enchanted creature fights ..." — resolves to
      // the creature the source Aura is attached to via getSourceAttachedTo.
      //
      // Slice 10/13 (choose-N group fight): "those creatures fight each other" emits
      // fighterA === fighterB (same Chosen ref, same targetId). Resolve id[0] vs id[1]
      // from chosenTargetsMulti so both fighters are distinct chosen creatures.
      if (
        effect.fighterA.kind === 'Chosen' &&
        effect.fighterB.kind === 'Chosen' &&
        effect.fighterA.targetId === effect.fighterB.targetId
      ) {
        const multiIds = chosenTargetsMulti.get(effect.fighterA.targetId);
        if (!multiIds || multiIds.length < 2) return state;
        return executeFight(state, multiIds[0], multiIds[1]);
      }
      const fighterAId = effect.fighterA.kind === 'Source'
        ? sourceInstanceId
        : effect.fighterA.kind === 'SourceAttachedTo'
          ? getSourceAttachedTo(state, sourceInstanceId) ?? undefined
          : resolveTargetRef(effect.fighterA, casterId, chosenTargets);
      if (!fighterAId) return state;
      // For an optional Chosen target (up-to-one fight), chosenTargets may not have
      // the target id when the player chose 0 targets — skip in that case.
      if (effect.fighterB.kind === 'Chosen' && !chosenTargets.get(effect.fighterB.targetId)) {
        return state;
      }
      const fighterBId = resolveTargetRef(effect.fighterB, casterId, chosenTargets);
      return executeFight(state, fighterAId, fighterBId);
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
      const glPowerSourceId =
        typeof effect.amount === 'object' && effect.amount.kind === 'TargetPower' && effect.amount.target.kind === 'Source'
          ? sourceInstanceId : undefined;
      // Slice 5: EventDamageAmount — "you gain that much life" in a DealsDamage trigger body.
      // Brion Stoutarm family: SacrificedCreaturePower — power captured during cost payment.
      const glAmt =
        typeof effect.amount === 'object' && effect.amount.kind === 'EventDamageAmount'
          ? (eventContext?.eventDamageAmount ?? 0)
          : typeof effect.amount === 'object' && effect.amount.kind === 'SacrificedCreaturePower'
            ? parseInt(namedCardChoices.get('sacrificedCreaturePower') ?? '0', 10)
            : resolveAmount(effect.amount, xValue, state, casterId, chosenTargets, glPowerSourceId, eventContext?.cardInstanceId);
      return executeGainLife(state, glPlayerId, glAmt);
    }
    case 'LoseLife': {
      if (effect.player.kind === 'EachOpponent') {
        // Slice 11: HalfLifeRoundedUp — each opponent loses half their life (per-player).
        const isHalfLife = typeof effect.amount === 'object' && effect.amount !== null
          && (effect.amount as { kind: string }).kind === 'HalfLifeRoundedUp';
        let s = state;
        for (const p of state.players) {
          if (p.id !== casterId && !p.hasLost) {
            const llAmount = isHalfLife
              ? Math.ceil(p.life / 2)
              : resolveAmount(effect.amount, xValue, state, casterId);
            s = executeLoseLife(s, p.id, llAmount);
          }
        }
        return s;
      }
      if (effect.player.kind === 'EachPlayer') {
        // Slice 11: HalfLifeRoundedUp — each player loses half their life (per-player).
        const isHalfLife = typeof effect.amount === 'object' && effect.amount !== null
          && (effect.amount as { kind: string }).kind === 'HalfLifeRoundedUp';
        let s = state;
        for (const p of state.players) {
          if (!p.hasLost) {
            const llAmount = isHalfLife
              ? Math.ceil(p.life / 2)
              : resolveAmount(effect.amount, xValue, state, casterId);
            s = executeLoseLife(s, p.id, llAmount);
          }
        }
        return s;
      }
      // Slice 11: pass state + eventContext so EventPlayer resolves correctly
      // ("that player loses half their life" upkeep trigger tails).
      const llPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      const llPowerSourceId =
        typeof effect.amount === 'object' && effect.amount.kind === 'TargetPower' && effect.amount.target.kind === 'Source'
          ? sourceInstanceId : undefined;
      // RevealedTopCardManaValue: resolved from the context set by a preceding RevealTopMatch.
      // Slice 2: EventDamageAmount — "you lose that much life" in a damage trigger body.
      // Slice 11: HalfLifeRoundedUp — resolve from the individual player's life total.
      const llAmt =
        typeof effect.amount === 'object' && effect.amount.kind === 'RevealedTopCardManaValue'
          ? (ctx.lastRevealedCardManaValue ?? 0)
          : typeof effect.amount === 'object' && effect.amount.kind === 'EventDamageAmount'
            ? (eventContext?.eventDamageAmount ?? 0)
            : typeof effect.amount === 'object' && effect.amount.kind === 'HalfLifeRoundedUp'
              ? (() => {
                  const llPlayer = state.players.find(p => p.id === llPlayerId);
                  return llPlayer ? Math.ceil(llPlayer.life / 2) : 0;
                })()
              // Slice 7: pass eventPlayerId so ForEach{controller:'eventPlayer'} counts the
              // upkeep-trigger's active player's permanents/hand (Citadel of Pain / Price of Knowledge family).
              : resolveAmount(effect.amount, xValue, state, casterId, chosenTargets, llPowerSourceId, eventContext?.cardInstanceId, undefined, eventContext?.eventPlayerId);
      // Guard: if playerId is empty (e.g. EventPlayer with no event context), no-op.
      if (!llPlayerId) return state;
      return executeLoseLife(state, llPlayerId, llAmt);
    }
    case 'Exile': {
      if (effect.target.kind === 'AllCreatures') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone !== 'battlefield') continue;
          if (isEffectiveCreature(s, card.instanceId)) {
            s = executeExile(s, card.instanceId);
          }
        }
        return s;
      }
      // AllOfType: exile all permanents matching filter
      if (effect.target.kind === 'AllOfType') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone === 'battlefield') {
            const def = getCardDefinition(state, card);
            if (!matchesCardFilter(def, effect.target.filter)) continue;
            // Slice 8: token/nontoken filter (instance state check)
            if (effect.target.filter.tokenOnly && !card.isToken) continue;
            if (effect.target.filter.nontoken && card.isToken) continue;
            s = executeExile(s, card.instanceId);
          }
        }
        return s;
      }
      if (effect.target.kind === 'Source') {
        if (!sourceInstanceId) return state;
        return executeExile(state, sourceInstanceId);
      }
      // Apply to every chosen target ("exile up to N target creatures").
      const exileTargetIds = resolveChosenTargetIds(
        effect.target, casterId, chosenTargets, chosenTargetsMulti, state, eventContext,
      );
      let exileState = state;
      for (const id of exileTargetIds) {
        if (!id) continue;
        exileState = executeExile(exileState, id);
      }
      return exileState;
    }
    case 'ExileAllGraveyards': {
      let s = state;
      for (const [cardId, card] of state.cards) {
        if (card.zone === 'graveyard') {
          s = executeExile(s, cardId);
        }
      }
      return s;
    }
    case 'ExileNFromGraveyard': {
      // Slice 9/12: "that player exiles N cards from their graveyard."
      // EventPlayer resolves to eventContext.eventPlayerId (the upkeep's active player).
      const engPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      if (!engPlayerId) return state; // no-op if no event context
      const engCount = resolveAmount(effect.count, xValue, state, casterId, chosenTargets);
      // Collect graveyard cards for the player, sorted by CMC ascending (AI prefers cheap first).
      const graveyardCards = [...state.cards.values()]
        .filter(c => c.zone === 'graveyard' && c.ownerId === engPlayerId)
        .sort((a, b) => {
          const defA = state.cardDefinitions.get(state.cards.get(a.instanceId)?.definitionId ?? '');
          const defB = state.cardDefinitions.get(state.cards.get(b.instanceId)?.definitionId ?? '');
          return (defA?.cmc ?? 0) - (defB?.cmc ?? 0);
        });
      let engState = state;
      let exiled = 0;
      for (const card of graveyardCards) {
        if (exiled >= engCount) break;
        engState = executeExile(engState, card.instanceId);
        exiled++;
      }
      return engState;
    }
    case 'PutIntoLibrary': {
      // Slice 7: handle Source self-target (Wayward Soul family: "put this creature
      // on top of its owner's library"). resolveTargetRef throws on Source, so we
      // check explicitly here, mirroring the pattern used by Destroy/ReturnToHand.
      const libraryTargetId = effect.target.kind === 'Source'
        ? (sourceInstanceId ?? casterId)
        : resolveTargetRef(effect.target, casterId, chosenTargets);
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
      if (effect.target.kind === 'AllCreatures' || effect.target.kind === 'AllCreaturesYouControl') {
        const youOnly = effect.target.kind === 'AllCreaturesYouControl';
        const ids = [...state.cards.values()]
          .filter(c => c.zone === 'battlefield' && (!youOnly || c.ownerId === casterId) && isEffectiveCreature(state, c.instanceId))
          .map(c => c.instanceId);
        let s = state;
        for (const id of ids) s = executeReturnToHand(s, id);
        return s;
      }
      // AllOfType: return all matching permanents
      if (effect.target.kind === 'AllOfType') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone === 'battlefield') {
            const def = getCardDefinition(state, card);
            if (!matchesCardFilter(def, effect.target.filter)) continue;
            // Slice 8: token/nontoken filter (instance state check)
            if (effect.target.filter.tokenOnly && !card.isToken) continue;
            if (effect.target.filter.nontoken && card.isToken) continue;
            s = executeReturnToHand(s, card.instanceId);
          }
        }
        return s;
      }
      // Multi-target bounce ("return two target creatures to their owners' hands")
      // maps a single Chosen ref to N ids via resolveChosenTargetIds.
      if (effect.target.kind === 'Chosen') {
        const bounceIds = resolveChosenTargetIds(
          effect.target, casterId, chosenTargets, chosenTargetsMulti, state, eventContext,
        );
        let bounceState = state;
        for (const id of bounceIds) {
          if (!id) continue;
          bounceState = executeReturnToHand(bounceState, id);
        }
        return bounceState;
      }
      const bounceTargetId = effect.target.kind === 'Source'
        ? sourceInstanceId
        : resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      if (!bounceTargetId) return state;
      return executeReturnToHand(state, bounceTargetId);
    }
    case 'BounceControlledByPlayer': {
      // "that player returns a creature they control to its owner's hand"
      // (Sunken Hope family). Mirrors the sacrifice-selection policy: resolve the
      // player from the event context, then return their cheapest matching permanent.
      // Slice 4: "each creature they control with power greater than the number of
      // cards in their hand" (Noetic Scales) uses powerGreaterThanEventPlayerHandCount
      // filter and count=100 (effectively "all matching").
      const bouncePlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      if (!bouncePlayerId) return state;
      const bounceCount = resolveAmount(effect.count, xValue, state, casterId);
      // Slice 4: compute the controlling player's hand count once for power-filter.
      const bouncePlayerHandCount = effect.filter?.powerGreaterThanEventPlayerHandCount
        ? [...state.cards.values()].filter(c => c.ownerId === bouncePlayerId && c.zone === 'hand').length
        : 0;
      // Collect matching permanents owned by the player, prefer lowest CMC first.
      const baseFilter = effect.filter
        ? (({ powerGreaterThanEventPlayerHandCount: _, ...rest }) => rest)(effect.filter)
        : undefined;
      const candidates = [...state.cards.values()].filter(c => {
        if (c.zone !== 'battlefield' || c.ownerId !== bouncePlayerId) return false;
        if (baseFilter && Object.keys(baseFilter).length > 0) {
          const def = getCardDefinition(state, c);
          if (!matchesCardFilter(def, baseFilter)) return false;
        }
        // Slice 4: power > hand count check (Noetic Scales).
        if (effect.filter?.powerGreaterThanEventPlayerHandCount) {
          const effectivePow = getEffectivePower(state, c.instanceId);
          if (effectivePow <= bouncePlayerHandCount) return false;
        }
        return true;
      });
      // Sort by CMC ascending (lowest first — AI picks least-valuable permanent).
      candidates.sort((a, b) => {
        const da = getCardDefinition(state, a);
        const db = getCardDefinition(state, b);
        return (da.cmc ?? 0) - (db.cmc ?? 0);
      });
      const toReturn = Math.min(bounceCount, candidates.length);
      let bounceState = state;
      for (let i = 0; i < toReturn; i++) {
        bounceState = executeReturnToHand(bounceState, candidates[i].instanceId);
      }
      return bounceState;
    }
    case 'Sacrifice': {
      // "Sacrifice this creature / it / ~." — sacrifice the source permanent.
      if (effect.self) {
        return sourceInstanceId ? executeSacrificeSpecific(state, sourceInstanceId) : state;
      }
      // Handle EachOpponent and EachPlayer sacrifice
      if (effect.player.kind === 'EachOpponent') {
        const sacCount = resolveAmount(effect.count, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (p.id !== casterId && !p.hasLost) {
            const selectedIds = splitChoiceIds(namedCardChoices.get(`sacrificeCardIds:${p.id}`));
            s = executeSacrifice(s, p.id, sacCount, effect.filter, selectedIds);
          }
        }
        return s;
      }
      if (effect.player.kind === 'EachPlayer') {
        const sacCount = resolveAmount(effect.count, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (!p.hasLost) {
            const selectedIds = splitChoiceIds(namedCardChoices.get(`sacrificeCardIds:${p.id}`));
            s = executeSacrifice(s, p.id, sacCount, effect.filter, selectedIds);
          }
        }
        return s;
      }
      const sacrificePlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      if (!sacrificePlayerId) return state;
      const sacrificeCount = resolveAmount(effect.count, xValue, state, casterId);
      const selectedIds = splitChoiceIds(namedCardChoices.get(`sacrificeCardIds:${sacrificePlayerId}`) || namedCardChoices.get('sacrificeCardIds'));
      return executeSacrifice(state, sacrificePlayerId, sacrificeCount, effect.filter, selectedIds);
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
        namedCardChoices.get(`sacrificeCardId:${sacrificePlayerId}`) || namedCardChoices.get('sacrificeCardId'),
      );
    }
    case 'SacrificeSelfUnlessPay': {
      // Slice 4 (self-reference normalization): "sacrifice this Aura unless you pay {1}{U}."
      // Try to pay the cost from the controller's untapped lands (or life).
      // If payment succeeds → permanent survives (return paid state).
      // If payment fails → sacrifice the source permanent.
      if (!sourceInstanceId) return state;
      const pIdx = state.players.findIndex(p => p.id === casterId);
      if (pIdx < 0) return state;
      const player = state.players[pIdx];

      if (effect.lifeCost !== undefined) {
        if (player.life - effect.lifeCost >= 5) {
          // Pay life — permanent survives.
          const newPlayers = state.players.map((p, i) => i === pIdx ? { ...p, life: p.life - effect.lifeCost! } : p);
          return { ...state, players: newPlayers };
        }
        // Cannot safely pay life → sacrifice self.
        return executeSacrificeSpecific(state, sourceInstanceId);
      }

      if (effect.manaCost !== undefined) {
        const untappedLands = getCardsInZone(state, casterId, 'battlefield').filter(
          c => !c.tapped && getCardDefinition(state, c).card_types.includes('land'),
        );
        const landsToTap = typeof effect.manaCost === 'number'
          ? (untappedLands.length >= effect.manaCost ? untappedLands.slice(0, effect.manaCost) : null)
          : selectLandsForManaString(state, untappedLands, effect.manaCost);
        if (landsToTap) {
          // Pay mana — permanent survives.
          const newCards = new Map(state.cards);
          for (const land of landsToTap) {
            newCards.set(land.instanceId, { ...land, tapped: true });
          }
          return { ...state, cards: newCards };
        }
        // Cannot pay → sacrifice self.
        return executeSacrificeSpecific(state, sourceInstanceId);
      }

      // No cost specified (should not happen) — sacrifice conservatively.
      return executeSacrificeSpecific(state, sourceInstanceId);
    }
    case 'Mill': {
      if (effect.player.kind === 'EachOpponent') {
        const mlCount = resolveAmount(effect.count, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (p.id !== casterId && !p.hasLost) {
            s = executeMill(s, p.id, mlCount);
          }
        }
        return s;
      }
      if (effect.player.kind === 'EachPlayer') {
        const mlCount = resolveAmount(effect.count, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (!p.hasLost) {
            s = executeMill(s, p.id, mlCount);
          }
        }
        return s;
      }
      const millPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      // Slice 11: EventPlayerHandCount — "mills X cards, where X is the number of
      // cards in their hand" (Dreamborn Muse). Count the mill player's hand directly.
      // Slice 2: EventDamageAmount — "that player mills that many cards" in a combat-damage trigger body.
      const millCount = (
        typeof effect.count === 'object' &&
        effect.count !== null &&
        (effect.count as { kind: string }).kind === 'EventPlayerHandCount'
      )
        ? [...state.cards.values()].filter(c => c.ownerId === millPlayerId && c.zone === 'hand').length
        : typeof effect.count === 'object' && effect.count !== null && effect.count.kind === 'EventDamageAmount'
          ? (eventContext?.eventDamageAmount ?? 0)
          : resolveAmount(effect.count, xValue, state, casterId);
      return executeMill(state, millPlayerId, millCount);
    }
    case 'AddCounters': {
      // Slice 12: AllOfType target — "that player puts a counter on target [non-<Subtype>] land
      // they control" (Quicksilver Fountain family). Respects eventPlayerControls and maxCount.
      if (effect.target.kind === 'AllOfType') {
        const acControllerFilter = effect.target.eventPlayerControls
          ? (eventContext?.eventPlayerId ?? casterId)
          : effect.target.controllerControls
            ? casterId
            : undefined;
        const acCount = resolveAmount(effect.count, xValue, state, casterId);
        const acMax = effect.maxCount ?? Infinity;
        let acState = state;
        let placed = 0;
        for (const [, card] of state.cards) {
          if (placed >= acMax) break;
          if (card.zone !== 'battlefield') continue;
          if (acControllerFilter && card.ownerId !== acControllerFilter) continue;
          if (!matchesCardInstanceFilter(acState, card.instanceId, effect.target.filter, { state: acState, sourceInstanceId })) continue;
          acState = executeAddCounters(acState, card.instanceId, effect.counterType, acCount);
          placed++;
        }
        return acState;
      }
      // Slice 6 (combat-damage trigger bodies): "put a +1/+1 counter on each attacking
      // creature you control." Only caster's attacking creatures receive the counter.
      // The combat state is cleared before trigger resolution, so we use the attacker
      // snapshot stored in eventContext.attackerInstanceIds (set by stack.ts).
      if (effect.target.kind === 'AllAttackingCreaturesYouControl') {
        // Prefer the snapshot from eventContext (captured before combat clears);
        // fall back to live combat state as a safety net (e.g. in spell form).
        const attackerIds = new Set<string>(
          eventContext?.attackerInstanceIds ?? state.combat?.attackers.map(a => a.cardInstanceId) ?? [],
        );
        let s = state;
        const acAtCount = resolveAmount(effect.count, xValue, state, casterId);
        for (const card of state.cards.values()) {
          if (card.zone !== 'battlefield') continue;
          if (card.ownerId !== casterId) continue;
          if (!attackerIds.has(card.instanceId)) continue;
          if (!isEffectiveCreature(s, card.instanceId)) continue;
          s = executeAddCounters(s, card.instanceId, effect.counterType, acAtCount);
        }
        return s;
      }
      // Mass counter placement: "put a +1/+1 counter on each creature you control"
      // (and variants). Expand to each matching battlefield creature.
      if (
        effect.target.kind === 'AllCreatures' ||
        effect.target.kind === 'AllCreaturesYouControl' ||
        effect.target.kind === 'AllCreaturesYouControlMatching'
      ) {
        const youOnly = effect.target.kind !== 'AllCreatures';
        const filter = effect.target.kind === 'AllCreaturesYouControlMatching' ? effect.target.filter : undefined;
        let s = state;
        for (const card of state.cards.values()) {
          if (card.zone !== 'battlefield') continue;
          // "each OTHER creature ..." — never the source permanent itself.
          if (effect.excludeSelf && card.instanceId === sourceInstanceId) continue;
          if (youOnly && card.ownerId !== casterId) continue;
          if (!isEffectiveCreature(s, card.instanceId)) continue;
          if (filter && !matchesCardInstanceFilter(s, card.instanceId, filter, { state: s, sourceInstanceId })) continue;
          const c = resolveAmount(effect.count, xValue, s, casterId, chosenTargets, card.instanceId);
          s = executeAddCounters(s, card.instanceId, effect.counterType, c);
        }
        return s;
      }
      if (effect.target.kind === 'Source' || effect.target.kind === 'SourceAttachedTo') {
        const acSelfId = effect.target.kind === 'Source'
          ? sourceInstanceId
          : getSourceAttachedTo(state, sourceInstanceId);
        if (!acSelfId) return state;
        // Slice 2: EventDamageAmount — "put that many +1/+1 counters on it" in combat-damage trigger bodies.
        const acSelfCount =
          typeof effect.count === 'object' && effect.count.kind === 'EventDamageAmount'
            ? (eventContext?.eventDamageAmount ?? 0)
            : resolveAmount(effect.count, xValue, state, casterId);
        return executeAddCounters(state, acSelfId, effect.counterType, acSelfCount);
      }
      // Apply to every chosen target ("put a +1/+1 counter on each of up to N
      // target creatures" maps a single Chosen ref to N ids); single-target
      // specs yield exactly one id (see resolveChosenTargetIds).
      // Guard: if no targets were chosen (minCount=0 / "up to" form and player chose 0),
      // return state unchanged to avoid resolveTargetRef throwing.
      if (effect.target.kind === 'Chosen') {
        const acChosenIds = chosenTargetsMulti.get(effect.target.targetId);
        if (!acChosenIds || acChosenIds.length === 0) {
          const acSingleFallback = chosenTargets.get(effect.target.targetId);
          if (!acSingleFallback) return state;
        }
      }
      const acTargetIds = resolveChosenTargetIds(
        effect.target, casterId, chosenTargets, chosenTargetsMulti, state, eventContext,
      );
      // Slice 2: EventDamageAmount — resolve once for all targets
      const acCount =
        typeof effect.count === 'object' && effect.count.kind === 'EventDamageAmount'
          ? (eventContext?.eventDamageAmount ?? 0)
          : resolveAmount(effect.count, xValue, state, casterId);
      let acState = state;
      for (const id of acTargetIds) {
        if (!id) continue;
        acState = executeAddCounters(acState, id, effect.counterType, acCount);
      }
      return acState;
    }
    case 'RemoveCounters': {
      const rcTargetId = effect.target.kind === 'Source'
        ? sourceInstanceId
        : resolveTargetRef(effect.target, casterId, chosenTargets);
      if (!rcTargetId) return state;
      // Slice 10: allCounters=true → remove every counter type on the target
      // (Suncleanser "Remove all counters from target creature." form).
      if (effect.allCounters) {
        const rcCard = state.cards.get(rcTargetId);
        if (!rcCard || rcCard.zone !== 'battlefield') return state;
        let rcState = state;
        for (const [cType, cCount] of Object.entries(rcCard.counters)) {
          if (!cCount || cCount <= 0) continue;
          rcState = executeRemoveCounters(rcState, rcTargetId, cType, cCount);
        }
        return rcState;
      }
      const rcCount = resolveAmount(effect.count, xValue, state, casterId);
      return executeRemoveCounters(state, rcTargetId, effect.counterType, rcCount);
    }
    case 'MoveCounters': {
      // Slice 9: counter-migration — atomically move counters from source to target.
      const mcSourceId = effect.source.kind === 'Source' ? sourceInstanceId : undefined;
      if (!mcSourceId) return state;
      const mcTargetId = resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      if (!mcTargetId) return state;

      const mcSourceCard = state.cards.get(mcSourceId);
      if (!mcSourceCard || mcSourceCard.zone !== 'battlefield') return state;

      let mcState = state;

      if (effect.allCounters) {
        // Move every counter type that exists on the source permanent.
        for (const [cType, cCount] of Object.entries(mcSourceCard.counters)) {
          if (!cCount || cCount <= 0) continue;
          mcState = executeRemoveCounters(mcState, mcSourceId, cType, cCount);
          mcState = executeAddCounters(mcState, mcTargetId, cType, cCount);
        }
      } else {
        // Move a fixed count of the specified counter type.
        const mcType = effect.counterType ?? '+1/+1';
        const mcCount = effect.count ?? 1;
        const available = mcSourceCard.counters[mcType] ?? 0;
        const toMove = Math.min(mcCount, available);
        if (toMove <= 0) return state;
        mcState = executeRemoveCounters(mcState, mcSourceId, mcType, toMove);
        mcState = executeAddCounters(mcState, mcTargetId, mcType, toMove);
      }

      return mcState;
    }
    case 'Tap': {
      if (effect.target.kind === 'AllCreatures' || effect.target.kind === 'AllCreaturesYouControl') {
        const youOnly = effect.target.kind === 'AllCreaturesYouControl';
        const ids = [...state.cards.values()]
          .filter(c => c.zone === 'battlefield' && (!youOnly || c.ownerId === casterId) && isEffectiveCreature(state, c.instanceId))
          .map(c => c.instanceId);
        let s = state;
        for (const id of ids) s = executeTap(s, id);
        return s;
      }
      if (effect.target.kind === 'AllOfType') {
        return executeTapAllOfType(
          state,
          effect.target.filter,
          effect.target.controllerControls ? casterId : undefined,
        );
      }
      if (effect.target.kind === 'SourceAttachedTo' || effect.target.kind === 'Source') {
        const tapTargetId = effect.target.kind === 'SourceAttachedTo'
          ? getSourceAttachedTo(state, sourceInstanceId)
          : sourceInstanceId;
        if (!tapTargetId) return state;
        return executeTap(state, tapTargetId);
      }
      // Apply to every chosen target ("tap up to N target creatures").
      const tapTargetIds = resolveChosenTargetIds(
        effect.target, casterId, chosenTargets, chosenTargetsMulti, state, eventContext,
      );
      let tapState = state;
      for (const id of tapTargetIds) {
        if (!id) continue;
        tapState = executeTap(tapState, id);
      }
      return tapState;
    }
    case 'Goad': {
      // "Goad all creatures you don't control" (parsed as AllCreatures): goad every
      // creature the goader doesn't control.
      if (effect.target.kind === 'AllCreatures') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone !== 'battlefield') continue;
          if (card.ownerId === casterId) continue;
          if (!isEffectiveCreature(s, card.instanceId)) continue;
          s = executeGoad(s, card.instanceId, casterId);
        }
        return s;
      }
      const goadTargetId = resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      if (!goadTargetId) return state;
      return executeGoad(state, goadTargetId, casterId);
    }
    case 'MustBeBlockedIfAble': {
      // Slice 7 (lure): "All creatures able to block <subject> [this turn] do so."
      // (Taunting Challenge / Goldenhide Ox family for targeted/self spell forms.)
      //
      // Resolve the subject creature id, then record it on state.combat.luredCreatureIds
      // so combat.ts declareBlockers can force every able blocker to block it this combat.
      //
      // SourceAttachedTo — Nemesis Mask static form never reaches here (it is parsed
      // as a StaticAbility and enforced via oracle-text scan in combat.ts); included
      // for completeness if ever emitted as a one-shot effect.
      //
      // HONESTY: if there is no active combat state, this is a no-op (the effect
      // has no legal target for forced blocking outside of combat — safe fall-through).
      let lureTargetId: string | undefined;
      if (effect.subject.kind === 'Source') {
        lureTargetId = sourceInstanceId;
      } else if (effect.subject.kind === 'SourceAttachedTo') {
        lureTargetId = getSourceAttachedTo(state, sourceInstanceId) ?? undefined;
      } else {
        // Chosen (targeted form — Taunting Challenge) or EventCreature
        const resolved = resolveTargetRef(effect.subject, casterId, chosenTargets, state, eventContext);
        lureTargetId = resolved || undefined;
      }
      if (!lureTargetId) return state;
      if (!state.combat) {
        // Outside combat: grant the MustBeBlockedIfAble keyword to the creature instance
        // so it can be read when combat begins next. This mirrors how GrantKeyword
        // handles "this turn" grants outside of combat.
        const card = state.cards.get(lureTargetId);
        if (!card) return state;
        const newCards = new Map(state.cards);
        const existing = card.grantedKeywords ?? [];
        if (!existing.includes('MustBeBlockedIfAble')) {
          newCards.set(lureTargetId, { ...card, grantedKeywords: [...existing, 'MustBeBlockedIfAble'] });
        }
        return { ...state, cards: newCards };
      }
      // In combat: record the lured creature id on the CombatState.
      const alreadyLured = state.combat.luredCreatureIds ?? [];
      if (alreadyLured.includes(lureTargetId)) return state; // idempotent
      return {
        ...state,
        combat: {
          ...state.combat,
          luredCreatureIds: [...alreadyLured, lureTargetId],
        },
      };
    }
    case 'Regenerate': {
      // Slice 9: SourceAttachedTo — "{cost}: Regenerate enchanted creature" — resolves
      // to the creature the source Aura is attached to via getSourceAttachedTo.
      const regenTargetId = effect.target.kind === 'Source'
        ? sourceInstanceId
        : effect.target.kind === 'SourceAttachedTo'
          ? getSourceAttachedTo(state, sourceInstanceId) ?? undefined
          : resolveTargetRef(effect.target, casterId, chosenTargets);
      if (!regenTargetId) return state;
      return executeRegenerate(state, regenTargetId);
    }
    case 'Proliferate':
      return executeProliferate(state, casterId);
    case 'Amass': {
      const n = resolveAmount(effect.count, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId);
      return executeAmass(state, casterId, n, effect.armyType);
    }
    case 'Populate':
      return executePopulate(state, casterId);
    case 'Adapt': {
      const n = resolveAmount(effect.count, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId);
      return executeAdapt(state, sourceInstanceId, n);
    }
    case 'Bolster': {
      const n = resolveAmount(effect.count, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId);
      return executeBolster(state, casterId, n);
    }
    case 'Monstrosity': {
      const n = resolveAmount(effect.count, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId);
      return executeMonstrosity(state, sourceInstanceId, n);
    }
    case 'Fabricate': {
      const n = resolveAmount(effect.count, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId);
      return executeFabricate(state, sourceInstanceId, casterId, n);
    }
    case 'Mentor':
      return executeMentor(state, sourceInstanceId);
    case 'Attach': {
      // Equipment ETB self-attach (Maul of the Skyclaves, Mithril Coat).
      // Move the source Equipment's attachment onto the chosen creature; the
      // continuous equipmentBonus cache then applies the buff. No equip cost.
      if (!sourceInstanceId) return state;
      const equipment = state.cards.get(sourceInstanceId);
      if (!equipment || equipment.zone !== 'battlefield') return state;
      const attachTargetId = resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      if (!attachTargetId) return state;
      const attachTarget = state.cards.get(attachTargetId);
      if (!attachTarget || attachTarget.zone !== 'battlefield') return state;
      if (!isEffectiveCreature(state, attachTargetId)) return state;
      const attachCards = new Map(state.cards);
      attachCards.set(sourceInstanceId, { ...equipment, attachedTo: attachTargetId });
      return { ...state, cards: attachCards };
    }
    case 'ReturnAllFromGraveyard': {
      // Slice 8 (choose-type-return): pass namedCardChoices so chosenCreatureTypeFromCastTime
      // filter can resolve the creature type chosen at cast time (Haunting Voyage family).
      const ragMatchCtx = { state, sourceInstanceId, namedCardChoices: ctx.namedCardChoices };
      let ids = [...state.cards.values()]
        .filter(c => c.zone === 'graveyard'
          && (effect.whose === 'all' || c.ownerId === casterId)
          && matchesCardFilter(getCardDefinition(state, c), effect.filter, ragMatchCtx))
        .map(c => c.instanceId);
      // Slice 8: honour maxCount ("up to N" form — Haunting Voyage).
      if (effect.maxCount !== undefined && ids.length > effect.maxCount) {
        ids = ids.slice(0, effect.maxCount);
      }
      let s = state;
      for (const id of ids) s = executeReturnFromGraveyard(s, id, effect.destination);
      return s;
    }
    case 'RevealTopMatch': {
      const lib = getCardsInZone(state, casterId, 'library');
      const top = lib[0];
      if (!top) return state;
      const topDef = getCardDefinition(state, top);
      // Store mana value for sibling RevealedTopCardManaValue amount refs (Dark Confidant family).
      ctx.lastRevealedCardManaValue = topDef.cmc ?? 0;
      if (!matchesCardFilter(topDef, effect.filter)) return state; // stays on top
      if (effect.matchDestination === 'battlefield') {
        // "If it's a land card, put it onto the battlefield [tapped]" — full
        // battlefield-entry plumbing (tapped/summoning-sick state, ETB side effects).
        const entry = buildBattlefieldEntryPlan(state, casterId, top, topDef, {
          forceTapped: effect.tapped === true,
          defaultTapped: effect.tapped === true,
          summoningSick: true,
        });
        const enteredCards = new Map(state.cards);
        enteredCards.set(top.instanceId, entry.card);
        return applyDirectBattlefieldEntrySideEffects(
          { ...state, cards: enteredCards, players: entry.players },
          top.instanceId,
        );
      }
      const newCards = new Map(state.cards);
      newCards.set(top.instanceId, { ...top, zone: effect.matchDestination });
      return { ...state, cards: newCards };
    }
    case 'RevealUntilMatch': {
      // Resolve the acting player: defaults to the caster; effect.player overrides
      // (e.g. EventPlayer for "that player reveals…" trigger tails like Mirko Vosk).
      const rumPlayerId = effect.player
        ? resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext)
        : casterId;
      if (!rumPlayerId) return state;

      // How many matching cards to find before stopping (default 1 for classic shapes).
      const rumCount = effect.count ?? 1;

      // Reveal cards from the top of the acting player's library one by one until
      // `rumCount` cards matching the filter are found (or the library is exhausted).
      const lib = getCardsInZone(state, rumPlayerId, 'library');
      if (lib.length === 0) return state;

      const revealed: CardInstance[] = [];
      const matchedCards: CardInstance[] = [];

      for (const card of lib) {
        const def = getCardDefinition(state, card);
        if (matchedCards.length < rumCount && matchesCardFilter(def, effect.filter)) {
          matchedCards.push(card);
          if (matchedCards.length >= rumCount) break;
        } else if (matchedCards.length < rumCount) {
          // Only accumulate non-matched cards while still searching
          revealed.push(card);
        }
      }

      // Build updated card map: start from non-library cards, then re-add unrevealed
      // library cards, then apply movements.
      const otherEntries: [string, CardInstance][] = [];
      for (const [id, card] of state.cards) {
        if (card.ownerId === rumPlayerId && card.zone === 'library') continue;
        otherEntries.push([id, card]);
      }

      const revealedIds = new Set([
        ...revealed.map(c => c.instanceId),
        ...matchedCards.map(c => c.instanceId),
      ]);
      const unrevealedLib = lib.filter(c => !revealedIds.has(c.instanceId));

      const newCards = new Map<string, CardInstance>();
      for (const [id, card] of otherEntries) newCards.set(id, card);
      // Unrevealed library cards stay in library order at the top.
      for (const card of unrevealedLib) newCards.set(card.instanceId, card);

      // Move the non-matched revealed cards to restDestination.
      // 'hand' = Treasure Hunt shape (all revealed cards into hand).
      // 'bottom' = put on the bottom of the library.
      // 'graveyard' = send to graveyard.
      const restZone = effect.restDestination === 'hand' ? 'hand'
        : effect.restDestination === 'graveyard' ? 'graveyard'
        : null; // 'bottom' handled below
      if (restZone) {
        for (const card of revealed) {
          const zone = getCommanderDestinationZone(state, card.instanceId, restZone);
          newCards.set(card.instanceId, { ...card, zone, tapped: false, damage: 0, counters: {} });
        }
      } else {
        // 'bottom': append to library (Map iteration order = library order, so adding last = bottom).
        for (const card of revealed) {
          newCards.set(card.instanceId, { ...card, zone: 'library', tapped: false, damage: 0, counters: {} });
        }
      }

      // Move matched card(s) to matchedDestination.
      // For count=1 the original single-card path applies; for count>1 all matched
      // cards go to the same destination (Mirko Vosk sends all four lands to graveyard).
      if (effect.matchedDestination === 'battlefieldTapped' || effect.matchedDestination === 'battlefield') {
        // Battlefield entry requires the full entry plan — build a running state
        // so each subsequent card enters with the correct accumulated state.
        let runningState: GameState = { ...state, cards: newCards };
        for (const mc of matchedCards) {
          const mcDef = getCardDefinition(runningState, mc);
          const entry = buildBattlefieldEntryPlan(
            runningState,
            rumPlayerId,
            mc,
            mcDef,
            {
              forceTapped: effect.matchedDestination === 'battlefieldTapped',
              defaultTapped: effect.matchedDestination === 'battlefieldTapped',
              summoningSick: true,
            },
          );
          const enteredCards = new Map(runningState.cards);
          enteredCards.set(mc.instanceId, entry.card);
          runningState = { ...runningState, cards: enteredCards, players: entry.players };
          runningState = applyDirectBattlefieldEntrySideEffects(runningState, mc.instanceId);
        }
        return runningState;
      } else {
        // hand or graveyard destination
        const matchedZoneName = effect.matchedDestination === 'hand' ? 'hand' : 'graveyard';
        for (const mc of matchedCards) {
          const zone = getCommanderDestinationZone(state, mc.instanceId, matchedZoneName);
          newCards.set(mc.instanceId, { ...mc, zone, tapped: false, damage: 0, counters: {} });
        }
        // Treasure Hunt shape: rest also goes to hand — already handled in restZone block above.
        // If restDestination === 'hand' and matchedDestination === 'hand', both already resolved.
      }

      return { ...state, cards: newCards };
    }
    case 'OptionalPay': {
      const pIdx = state.players.findIndex(p => p.id === casterId);
      if (pIdx < 0) return state;
      const player = state.players[pIdx];
      let paidState: GameState | null = null;

      if (effect.lifeCost !== undefined) {
        // Pay only if it keeps a safety buffer (avoid bleeding out for minor effects).
        if (player.life - effect.lifeCost < 5) return state;
        const newPlayers = state.players.map((p, i) => i === pIdx ? { ...p, life: p.life - effect.lifeCost! } : p);
        paidState = { ...state, players: newPlayers };
      } else if (effect.xCost) {
        // Slice 1: "{X}" or "{X}{R}" costs. Pay xValue generic lands plus any
        // colored pips stored in manaCost. Inner effects that reference {X} via
        // { kind: 'X' } amounts already resolve against the same ctx.xValue.
        const xLands = getCardsInZone(state, casterId, 'battlefield').filter(
          c => !c.tapped && getCardDefinition(state, c).card_types.includes('land'),
        );
        let xLandsToTap: CardInstance[] | null;
        if (effect.manaCost !== undefined) {
          // Hybrid case: {X}{R} — first satisfy the colored pips, then pay xValue generics.
          const colorString = effect.manaCost;
          const coloredLands = typeof colorString === 'string'
            ? selectLandsForManaString(state, xLands, colorString)
            : null;
          if (!coloredLands) { xLandsToTap = null; }
          else {
            const usedColorIds = new Set(coloredLands.map(l => l.instanceId));
            const remainingLands = xLands.filter(l => !usedColorIds.has(l.instanceId));
            if (remainingLands.length < xValue) { xLandsToTap = null; }
            else { xLandsToTap = [...coloredLands, ...remainingLands.slice(0, xValue)]; }
          }
        } else {
          // Pure {X} cost — tap exactly xValue untapped lands.
          xLandsToTap = xLands.length >= xValue ? xLands.slice(0, xValue) : null;
        }
        if (!xLandsToTap) return state; // can't afford
        const xNewCards = new Map(state.cards);
        for (const land of xLandsToTap) {
          xNewCards.set(land.instanceId, { ...land, tapped: true });
        }
        paidState = { ...state, cards: xNewCards };
      } else if (effect.manaCost !== undefined) {
        const untappedLands = getCardsInZone(state, casterId, 'battlefield').filter(
          c => !c.tapped && getCardDefinition(state, c).card_types.includes('land'),
        );
        // Numeric cost = generic only (any lands); string cost carries colored
        // pips and requires lands that actually produce those colors.
        const landsToTap = typeof effect.manaCost === 'number'
          ? (untappedLands.length >= effect.manaCost ? untappedLands.slice(0, effect.manaCost) : null)
          : selectLandsForManaString(state, untappedLands, effect.manaCost);
        if (!landsToTap) return state; // can't afford
        const newCards = new Map(state.cards);
        for (const land of landsToTap) {
          newCards.set(land.instanceId, { ...land, tapped: true });
        }
        paidState = { ...state, cards: newCards };
      } else if (effect.energyCost !== undefined) {
        // "pay {E}{E}" — paid from the player's energy counters, never lands.
        const currentEnergy = player.playerCounters?.['energy'] ?? 0;
        if (currentEnergy < effect.energyCost) return state; // can't afford
        const newPlayers = state.players.map((p, i) => i === pIdx
          ? { ...p, playerCounters: { ...(p.playerCounters || {}), energy: currentEnergy - effect.energyCost! } }
          : p);
        paidState = { ...state, players: newPlayers };
      } else if (effect.sacrificeFilter !== undefined) {
        // Conservative: only sacrifice an expendable TOKEN matching the filter.
        const token = getCardsInZone(state, casterId, 'battlefield').find(
          c => c.isToken && matchesCardFilter(getCardDefinition(state, c), effect.sacrificeFilter!),
        );
        if (!token) return state; // decline rather than sacrifice a real permanent
        paidState = executeSacrificeSpecific(state, token.instanceId);
      } else if (effect.discardCount !== undefined) {
        // Pay only from a hand with cards to spare (keep at least 2 after discarding).
        const handCount = getCardsInZone(state, casterId, 'hand').length;
        if (handCount < effect.discardCount + 2) return state;
        paidState = executeDiscard(state, casterId, effect.discardCount);
      }

      if (!paidState) return state;
      let s = paidState;
      for (const inner of effect.effects) {
        s = executeEffect(s, inner, ctx);
      }
      return s;
    }
    case 'Connive': {
      const n = resolveAmount(effect.count, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId);
      const conniveId = effect.target.kind === 'Source'
        ? sourceInstanceId
        : resolveTargetRef(effect.target, casterId, chosenTargets);
      // The conniving creature's controller does the drawing/discarding; fall back to caster.
      const cre = conniveId ? state.cards.get(conniveId) : undefined;
      const ownerId = cre?.ownerId ?? casterId;
      if (!conniveId) return state;
      return executeConnive(state, conniveId, ownerId, n);
    }
    case 'BecomeMonarch': {
      const newMonarch = effect.player.kind === 'Controller'
        ? casterId
        : resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      if (!newMonarch) return state;
      return { ...state, monarchId: newMonarch };
    }
    case 'Explore': {
      if (effect.target.kind === 'AllCreaturesYouControl') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone === 'battlefield' && card.ownerId === casterId && isEffectiveCreature(s, card.instanceId)) {
            s = executeExplore(s, card.instanceId);
          }
        }
        return s;
      }
      const exploreId = effect.target.kind === 'Source'
        ? sourceInstanceId
        : resolveTargetRef(effect.target, casterId, chosenTargets);
      if (!exploreId) return state;
      return executeExplore(state, exploreId);
    }
    case 'Untap': {
      if (effect.target.kind === 'AllOfType') {
        const maxCount = effect.maxCount === undefined
          ? undefined
          : resolveAmount(effect.maxCount, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId);
        // Slice 11: eventPlayerControls — "that player untaps a land they control"
        // (Hokori, Dust Drinker family). Restricts untap to EventPlayer's permanents.
        const untapControllerId = effect.target.eventPlayerControls
          ? (eventContext?.eventPlayerId ?? casterId)
          : effect.target.controllerControls
            ? casterId
            : undefined;
        return executeUntapAllOfType(
          state,
          effect.target.filter,
          maxCount,
          untapControllerId,
        );
      }
      if (effect.target.kind === 'AllCreatures' || effect.target.kind === 'AllCreaturesYouControl') {
        const youOnly = effect.target.kind === 'AllCreaturesYouControl';
        const ids = [...state.cards.values()]
          .filter(c => c.zone === 'battlefield' && (!youOnly || c.ownerId === casterId) && isEffectiveCreature(state, c.instanceId))
          .map(c => c.instanceId);
        let s = state;
        for (const id of ids) s = executeUntap(s, id);
        return s;
      }
      // Slice 1: multi-target "untap up to N target creatures" — apply to every chosen id.
      if (effect.target.kind === 'Chosen') {
        const untapTargetIds = resolveChosenTargetIds(
          effect.target, casterId, chosenTargets, chosenTargetsMulti, state, eventContext,
        );
        let untapState = state;
        for (const id of untapTargetIds) {
          if (!id) continue;
          untapState = executeUntap(untapState, id);
        }
        return untapState;
      }
      const untapTargetId = effect.target.kind === 'SourceAttachedTo'
        ? getSourceAttachedTo(state, sourceInstanceId)
        : effect.target.kind === 'Source'
          ? sourceInstanceId
          // Slice 10: pass state and eventContext so EventCreature ("that land") resolves correctly.
          : resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      if (!untapTargetId) return state;
      return executeUntap(state, untapTargetId);
    }
    case 'CreateToken': {
      const ctControllerId = resolveTargetRef(effect.controller, casterId, chosenTargets, state, eventContext);
      // Slice 2: EventDamageAmount — "create that many tokens" in combat-damage trigger bodies.
      const ctCount =
        typeof effect.count === 'object' && effect.count.kind === 'EventDamageAmount'
          ? (eventContext?.eventDamageAmount ?? 0)
          : resolveAmount(effect.count, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId);
      return executeCreateToken(
        state,
        ctControllerId,
        effect.token,
        ctCount,
        effect.attachSourceToCreated ? sourceInstanceId : undefined,
        eventContext?.cardInstanceId,
        effect.tapped,
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
      const dcPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      // Slice 2: EventDamageAmount — "that player discards that many cards" in combat-damage trigger bodies.
      const dcCount =
        typeof effect.count === 'object' && effect.count.kind === 'EventDamageAmount'
          ? (eventContext?.eventDamageAmount ?? 0)
          : resolveAmount(effect.count, xValue, state, casterId);
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
    case 'RevealRandomCardFromHand': {
      // Slice 4: Planeswalker's Favor / Fury / Wand of Ith family.
      // "Target opponent/player reveals a card at random from their hand."
      // Revealing is information-only — no zone change (same rationale as LookAtHand).
      // The random card is identified and its MV stored in ctx so sibling effects
      // (DealDamage / ModifyPT with RevealedRandomCardManaValue) can resolve it.
      //
      // Slice 11 additive branch: when conditionalDiscardFilter is set, the executor
      // also discards the revealed card if it matches the filter (Wand of Ith family).
      const rrcfhPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      // Collect all cards in the target player's hand
      const rrcfhHand: CardInstance[] = [];
      for (const [, card] of state.cards) {
        if (card.ownerId === rrcfhPlayerId && card.zone === 'hand') rrcfhHand.push(card);
      }
      if (rrcfhHand.length > 0) {
        // Prefer an explicitly provided random-reveal choice (for tests / human play).
        // Deterministic fallback: lowest instanceId (stable across identical states).
        const rrcfhSelectedId = namedCardChoices.get('randomRevealedCardId');
        let rrcfhChosen = rrcfhSelectedId ? rrcfhHand.find(c => c.instanceId === rrcfhSelectedId) : undefined;
        if (!rrcfhChosen) {
          rrcfhChosen = [...rrcfhHand].sort((a, b) => a.instanceId.localeCompare(b.instanceId))[0];
        }
        // Store MV for sibling RevealedRandomCardManaValue amount refs.
        ctx.lastRevealedCardManaValue = getCardDefinition(state, rrcfhChosen).cmc ?? 0;
        // Slice 11: conditional discard — "if it's a <filter> card, that player discards it."
        if (effect.conditionalDiscardFilter) {
          const rrcfhDef = getCardDefinition(state, rrcfhChosen);
          if (matchesCardFilter(rrcfhDef, effect.conditionalDiscardFilter)) {
            const rrcfhCards = new Map(state.cards);
            rrcfhCards.set(rrcfhChosen.instanceId, {
              ...rrcfhChosen,
              zone: getCommanderDestinationZone(state, rrcfhChosen.instanceId, 'graveyard'),
              tapped: false,
              damage: 0,
              counters: {},
            });
            return { ...state, cards: rrcfhCards };
          }
        }
      } else {
        ctx.lastRevealedCardManaValue = 0;
      }
      return state; // no zone change — reveal is information-only
    }
    case 'LookAtTopOfLibrary':
      // Information-only reveal of the top N cards of a target player's library.
      // No cards change zone — honest equivalent of LookAtHand for the library.
      resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      return state;
    case 'RevealHandChooseCard': {
      // Slice 1: EachOpponent — loop over all opponents and apply the
      // choose+move logic for each. The caster picks the highest-CMC matching
      // card from each opponent's hand in turn.
      if (effect.player.kind === 'EachOpponent') {
        let rhEachState = state;
        const rhEachFilter = effect.filter.cmc?.x
          ? { ...effect.filter, cmc: { op: effect.filter.cmc.op, value: xValue } }
          : effect.filter;
        const rhEachFilterCtx: CardFilterContext = { namedCardChoices };
        for (const rhEachPlayer of state.players) {
          if (rhEachPlayer.id === casterId || rhEachPlayer.hasLost) continue;
          const rhEachMatching: CardInstance[] = [];
          for (const [, card] of rhEachState.cards) {
            if (card.ownerId !== rhEachPlayer.id || card.zone !== 'hand') continue;
            if (matchesCardFilter(getCardDefinition(rhEachState, card), rhEachFilter, rhEachFilterCtx)) rhEachMatching.push(card);
          }
          if (rhEachMatching.length === 0) continue;
          if (effect.discardAll) {
            for (const rhCard of rhEachMatching) {
              if (effect.disposition === 'exile') {
                rhEachState = executeExile(rhEachState, rhCard.instanceId);
              } else {
                const rhAllCards = new Map(rhEachState.cards);
                const current = rhAllCards.get(rhCard.instanceId);
                if (current) {
                  rhAllCards.set(rhCard.instanceId, {
                    ...current,
                    zone: getCommanderDestinationZone(rhEachState, rhCard.instanceId, 'graveyard'),
                    tapped: false, damage: 0, counters: {},
                  });
                  rhEachState = { ...rhEachState, cards: rhAllCards };
                }
              }
            }
          } else {
            // Pick highest CMC card from this opponent's hand
            const rhChosen = [...rhEachMatching].sort((a, b) => {
              const cmcDiff = getCardDefinition(rhEachState, b).cmc - getCardDefinition(rhEachState, a).cmc;
              return cmcDiff !== 0 ? cmcDiff : a.instanceId.localeCompare(b.instanceId);
            })[0];
            if (effect.disposition === 'exile') {
              rhEachState = executeExile(rhEachState, rhChosen.instanceId);
            } else {
              const rhAllCards = new Map(rhEachState.cards);
              rhAllCards.set(rhChosen.instanceId, {
                ...rhChosen,
                zone: getCommanderDestinationZone(rhEachState, rhChosen.instanceId, 'graveyard'),
                tapped: false, damage: 0, counters: {},
              });
              rhEachState = { ...rhEachState, cards: rhAllCards };
            }
          }
        }
        return rhEachState;
      }
      // Reveal-hand coercion (Thoughtseize/Castigate family): the chosen player
      // reveals their hand (revealing needs no state change — same as
      // LookAtHand), the caster picks a filter-matching card from it, and that
      // card is discarded (owner's graveyard) or exiled.
      const rhPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      // Substitute cast-time X when the filter has a cmc.x bound ("mana value X or less").
      const rhFilter = effect.filter.cmc?.x
        ? { ...effect.filter, cmc: { op: effect.filter.cmc.op, value: xValue } }
        : effect.filter;
      const rhMatching: CardInstance[] = [];
      // Slice 6: pass namedCardChoices to matchesCardFilter so chosenColorFromCastTime
      // can resolve the color chosen at cast time (Addle / Hint of Insanity family).
      const rhFilterCtx: CardFilterContext = { namedCardChoices };
      for (const [, card] of state.cards) {
        if (card.ownerId !== rhPlayerId || card.zone !== 'hand') continue;
        if (matchesCardFilter(getCardDefinition(state, card), rhFilter, rhFilterCtx)) rhMatching.push(card);
      }
      // discardAll: move every filter-matching card via the disposition (Amnesia family).
      if (effect.discardAll) {
        let s = state;
        for (const rhCard of rhMatching) {
          if (effect.disposition === 'exile') {
            s = executeExile(s, rhCard.instanceId);
          } else {
            const rhAllCards = new Map(s.cards);
            const current = rhAllCards.get(rhCard.instanceId);
            if (current) {
              rhAllCards.set(rhCard.instanceId, {
                ...current,
                zone: getCommanderDestinationZone(s, rhCard.instanceId, 'graveyard'),
                tapped: false,
                damage: 0,
                counters: {},
              });
              s = { ...s, cards: rhAllCards };
            }
          }
        }
        return s;
      }
      // Optional "you may" form: if no matching card exists (nothing to choose),
      // execute else-effects (if any) and return. AI policy: always choose when
      // a legal card exists, so we only skip when the hand is truly empty of
      // matching cards.
      if (rhMatching.length === 0) {
        if (effect.optional && effect.elseEffects && effect.elseEffects.length > 0) {
          let s = state;
          for (const inner of effect.elseEffects) {
            s = executeEffect(s, inner, ctx);
          }
          return s;
        }
        return state;
      }
      const rhSelectedId = namedCardChoices.get(effect.selectedCardChoiceId ?? 'revealHandCardId')
        || namedCardChoices.get('selectedCardId');
      let rhChosen = rhSelectedId ? rhMatching.find(c => c.instanceId === rhSelectedId) : undefined;
      if (!rhChosen) {
        // Deterministic fallback: highest mana value; ties break on instanceId
        // so the result never depends on RNG or Map order.
        rhChosen = [...rhMatching].sort((a, b) => {
          const cmcDiff = getCardDefinition(state, b).cmc - getCardDefinition(state, a).cmc;
          return cmcDiff !== 0 ? cmcDiff : a.instanceId.localeCompare(b.instanceId);
        })[0];
      }
      // Slice 12: Talara's Bane — gain life equal to the chosen card's toughness
      // BEFORE moving the card via the disposition.
      let rhState = state;
      if (effect.gainLifeEqualToChosenCardToughness) {
        const rhChosenDef = getCardDefinition(state, rhChosen);
        const rhToughness = rhChosenDef.toughness ?? 0;
        if (rhToughness > 0) {
          rhState = executeGainLife(rhState, casterId, rhToughness);
        }
      }
      if (effect.disposition === 'exile') {
        return executeExile(rhState, rhChosen.instanceId);
      }
      // Shuffle: put the chosen card into its owner's library at a random position
      // (Perish the Thought family). Reuses executePutIntoLibrary with 'shuffle'.
      if (effect.disposition === 'shuffle') {
        return executePutIntoLibrary(rhState, rhChosen.instanceId, 'shuffle');
      }
      // PutOnTop: put the chosen card on top of its owner's library
      // (Painful Memories family).
      if (effect.disposition === 'putOnTop') {
        return executePutIntoLibrary(rhState, rhChosen.instanceId, 'top');
      }
      // PutThirdFromTop: put the chosen card third from the top of its owner's
      // library (Lost Hours family).
      if (effect.disposition === 'putThirdFromTop') {
        return executePutIntoLibrary(rhState, rhChosen.instanceId, 'thirdFromTop');
      }
      // PutOnBottom: put the chosen card on the bottom of its owner's library
      // (Psychotic Episode family).
      if (effect.disposition === 'putOnBottom') {
        return executePutIntoLibrary(rhState, rhChosen.instanceId, 'bottom');
      }
      // Discard: the same zone move as executeDiscard, for the specific chosen card.
      const rhCards = new Map(rhState.cards);
      rhCards.set(rhChosen.instanceId, {
        ...rhChosen,
        zone: getCommanderDestinationZone(rhState, rhChosen.instanceId, 'graveyard'),
        tapped: false,
        damage: 0,
        counters: {},
      });
      return { ...rhState, cards: rhCards };
    }
    case 'CastFromRevealedHand': {
      // Slice 8/11: "target opponent reveals their hand. You may cast an instant or
      // sorcery spell from among those cards without paying its mana cost."
      // (Mindclaw Shaman family)
      //
      // Reveal: no state change needed — the engine already sees all zones.
      // Cast: find the highest-mana-value matching card from the opponent's hand,
      // move it to zone 'stack', and add a SpellStackItem under the controller's
      // casterId. No mana is paid. SpellCast event triggers do NOT fire from this
      // path (acknowledged gap — see AST comment for rationale).
      const cfrhPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      // Collect matching cards from the revealed player's hand.
      const cfrhMatching: CardInstance[] = [];
      for (const [, card] of state.cards) {
        if (card.ownerId !== cfrhPlayerId || card.zone !== 'hand') continue;
        const def = getCardDefinition(state, card);
        // Only non-land spells can be cast; instants/sorceries are what the
        // current filter always contains, but guard explicitly.
        if (def.card_types.includes('land')) continue;
        if (matchesCardFilter(def, effect.filter)) cfrhMatching.push(card);
      }
      if (cfrhMatching.length === 0) return state;
      // AI policy: choose the highest-mana-value card; break ties on instanceId.
      const cfrhSelectedId = namedCardChoices.get(effect.selectedCardChoiceId ?? 'castFromHandCardId');
      let cfrhChosen = cfrhSelectedId ? cfrhMatching.find(c => c.instanceId === cfrhSelectedId) : undefined;
      if (!cfrhChosen) {
        cfrhChosen = [...cfrhMatching].sort((a, b) => {
          const cmcDiff = getCardDefinition(state, b).cmc - getCardDefinition(state, a).cmc;
          return cmcDiff !== 0 ? cmcDiff : a.instanceId.localeCompare(b.instanceId);
        })[0];
      }
      if (!cfrhChosen) return state;
      // Generate a unique stack item id (uses a module-level counter to avoid
      // importing nextStackObjectId from stack.ts which would be circular).
      let cfrhStackId = `free_cast_stack_${++freeCastStackCounter}`;
      while (state.stack.some(item => item.id === cfrhStackId)) {
        cfrhStackId = `free_cast_stack_${++freeCastStackCounter}`;
      }
      const cfrhStackItem: SpellStackItem = {
        kind: 'Spell',
        id: cfrhStackId,
        cardInstanceId: cfrhChosen.instanceId,
        casterId,
        targets: [],
        castFromZone: 'hand',
      };
      const cfrhNewCards = new Map(state.cards);
      cfrhNewCards.set(cfrhChosen.instanceId, { ...cfrhChosen, zone: 'stack' as const });
      return {
        ...state,
        cards: cfrhNewCards,
        stack: [...state.stack, cfrhStackItem],
        spellsCastThisTurn: (state.spellsCastThisTurn ?? 0) + 1,
        hasPriorityPassed: new Array(state.players.length).fill(false),
        priorityPlayerIndex: state.activePlayerIndex,
      };
    }
    case 'RevealTopDistribute': {
      // Slice 9: "Reveal the top N cards of your library. An opponent chooses one
      // [matching filter]. Put that card into your <chosenDestination> and the rest
      // into your <restDestination>." (Murmurs from Beyond family — single-pile form.)
      //
      // The choosing opponent is the first non-caster player (AI policy: first
      // opponent in seat order). The opponent's chosen card id is read from
      // namedCardChoices[chosenCardChoiceId ?? 'opponentChosenCardId']. If no valid
      // card is supplied, the executor falls back to the AI policy: choose the
      // highest-mana-value filter-matching card (or the highest-MV card if no filter).
      const rtdPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      const rtdLibrary = [...state.cards.values()]
        .filter(c => c.ownerId === rtdPlayerId && c.zone === 'library');
      const rtdRevealCount = Math.min(effect.count, rtdLibrary.length);
      if (rtdRevealCount <= 0) return state;
      const rtdRevealed = rtdLibrary.slice(0, rtdRevealCount);
      // Determine eligible cards (filtered or all revealed).
      const rtdEligible = effect.filter
        ? rtdRevealed.filter(c => matchesCardFilter(getCardDefinition(state, c), effect.filter!))
        : rtdRevealed;
      if (rtdEligible.length === 0) {
        // No eligible card to choose — all revealed go to restDestination.
        const rtdNoChoiceCards = new Map(state.cards);
        for (const c of rtdRevealed) {
          rtdNoChoiceCards.set(c.instanceId, { ...c, zone: effect.restDestination, tapped: false, damage: 0, counters: {} });
        }
        return { ...state, cards: rtdNoChoiceCards };
      }
      // Read the explicit choice or fall back to AI (highest MV among eligible).
      const rtdChosenKey = effect.chosenCardChoiceId ?? 'opponentChosenCardId';
      const rtdExplicitId = namedCardChoices.get(rtdChosenKey);
      const rtdChosen = rtdExplicitId
        ? rtdEligible.find(c => c.instanceId === rtdExplicitId)
        : undefined;
      const rtdFinal: CardInstance = rtdChosen ?? [...rtdEligible].sort((a, b) => {
        const mvDiff = getCardDefinition(state, b).cmc - getCardDefinition(state, a).cmc;
        return mvDiff !== 0 ? mvDiff : a.instanceId.localeCompare(b.instanceId);
      })[0];
      // Move cards: chosen → chosenDestination, rest (including non-eligible) → restDestination.
      const rtdNewCards = new Map(state.cards);
      for (const c of rtdRevealed) {
        const dest = c.instanceId === rtdFinal.instanceId ? effect.chosenDestination : effect.restDestination;
        rtdNewCards.set(c.instanceId, { ...c, zone: dest, tapped: false, damage: 0, counters: {} });
      }
      return { ...state, cards: rtdNewCards };
    }
    case 'RevealTopSplitTwoPiles': {
      // Slice 9: "Reveal the top N cards of your library and separate them into two piles.
      // An opponent chooses one of those piles. Put that pile into your <pileChosenDestination>
      // and the other into your <pileOtherDestination>." (Steam Augury / Fact-or-Fiction family.)
      //
      // Split encoding:
      //   namedCardChoices[pileSplitChoiceId ?? 'pileSplitIds'] — comma-sep instance ids = pile A.
      //   remaining revealed cards form pile B.
      //   namedCardChoices[opponentChosenPileChoiceId ?? 'opponentChosenPile'] — 'A' or 'B'.
      //
      // AI fallback:
      //   Split: sort revealed by MV ascending; lower half → pile A, upper half → pile B.
      //   Opponent: always picks pile B (the higher-MV half — worse for controller).
      const rtspPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      const rtspLibrary = [...state.cards.values()]
        .filter(c => c.ownerId === rtspPlayerId && c.zone === 'library');
      const rtspCount = Math.min(effect.count, rtspLibrary.length);
      if (rtspCount <= 0) return state;
      const rtspRevealed = rtspLibrary.slice(0, rtspCount);

      // Build pile A from explicit split choice, or AI fallback (lower-MV half).
      const rtspSplitKey = effect.pileSplitChoiceId ?? 'pileSplitIds';
      const rtspSplitRaw = namedCardChoices.get(rtspSplitKey);
      let rtspPileAIds: Set<string>;
      if (rtspSplitRaw) {
        rtspPileAIds = new Set(rtspSplitRaw.split(',').map(s => s.trim()).filter(Boolean));
      } else {
        // AI fallback split: sort ascending by MV, put lower half in pile A.
        const rtspSorted = [...rtspRevealed].sort((a, b) => {
          const mvA = getCardDefinition(state, a).cmc;
          const mvB = getCardDefinition(state, b).cmc;
          return mvA !== mvB ? mvA - mvB : a.instanceId.localeCompare(b.instanceId);
        });
        const rtspHalfSize = Math.floor(rtspSorted.length / 2);
        rtspPileAIds = new Set(rtspSorted.slice(0, rtspHalfSize).map(c => c.instanceId));
      }

      const rtspPileA = rtspRevealed.filter(c => rtspPileAIds.has(c.instanceId));
      const rtspPileB = rtspRevealed.filter(c => !rtspPileAIds.has(c.instanceId));

      // Determine which pile the opponent picks.
      const rtspPickKey = effect.opponentChosenPileChoiceId ?? 'opponentChosenPile';
      const rtspPickRaw = namedCardChoices.get(rtspPickKey);
      // AI fallback: opponent picks pile B (higher-MV pile).
      const rtspOpponentPicksA = rtspPickRaw === 'A';

      const rtspChosenPile = rtspOpponentPicksA ? rtspPileA : rtspPileB;
      const rtspOtherPile  = rtspOpponentPicksA ? rtspPileB : rtspPileA;

      const rtspNewCards = new Map(state.cards);
      for (const c of rtspChosenPile) {
        rtspNewCards.set(c.instanceId, { ...c, zone: effect.pileChosenDestination, tapped: false, damage: 0, counters: {} });
      }
      for (const c of rtspOtherPile) {
        rtspNewCards.set(c.instanceId, { ...c, zone: effect.pileOtherDestination, tapped: false, damage: 0, counters: {} });
      }
      return { ...state, cards: rtspNewCards };
    }
    case 'SearchLibrary': {
      const slPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      const namedCardChoiceId = effect.namedCardChoiceId ?? 'tutorCard';
      const selectedCardChoiceId = effect.selectedCardChoiceId ?? 'tutorCardId';
      const slMax = effect.maxSelections;
      // "any number of" uses minSelections=0 with maxSelections undefined.
      // Treat as unbounded: the executor selects ALL matching candidates (AI
      // auto-pick policy: take everything that matches the filter).
      const isAnyNumberOf = effect.minSelections === 0 && slMax === undefined;
      const slSelection = isAnyNumberOf
        ? { min: 0, max: Number.MAX_SAFE_INTEGER }
        : (slMax !== undefined && slMax > 1
          ? { min: effect.minSelections ?? 0, max: slMax }
          : undefined);
      const slMultiIds = slSelection
        ? splitChoiceIds(
            namedCardChoices.get(selectedCardChoiceId)
              || namedCardChoices.get('tutorCardIds')
              || namedCardChoices.get('selectedCardIds'),
          )
        : [];
      // "mana value X or less" filters carry cmc.x; substitute the cast-time X
      // for the placeholder value so the search bound is the real X.
      const slFilter = effect.filter.cmc?.x
        ? { ...effect.filter, cmc: { op: effect.filter.cmc.op, value: xValue } }
        : effect.filter;
      return executeSearchLibrary(state, slPlayerId, slFilter, effect.destination, effect.tapped, effect.shuffle, {
        namedCard: namedCardChoices.get(namedCardChoiceId)
          || namedCardChoices.get('tutorCard')
          || namedCardChoices.get('namedCard')
          || namedCardChoices.get('cardName'),
        selectedCardInstanceId: namedCardChoices.get(selectedCardChoiceId)
          || namedCardChoices.get('tutorCardId')
          || namedCardChoices.get('selectedCardId'),
        selectedCardInstanceIds: slMultiIds.length > 0 ? slMultiIds : undefined,
        selection: slSelection,
        sourceInstanceId,
        searchGraveyard: effect.searchGraveyard,
      });
    }
    case 'PutCardsFromHandOnTop': {
      // Slice 9/12: pass state + eventContext so EventPlayer ("that player") resolves correctly
      // for per-player-upkeep triggers. Without eventContext, EventPlayer returns '' (no-op).
      const topPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      const topCount = resolveAmount(effect.count, xValue, state, casterId, chosenTargets);
      const selectedIds = splitChoiceIds(
        namedCardChoices.get(effect.selectedCardChoiceId ?? 'putOnTopIds')
          || namedCardChoices.get('handTopIds'),
      );
      return executePutCardsFromHandOnTop(state, topPlayerId, topCount, selectedIds);
    }
    case 'ChooseFromTopOfLibrary': {
      const choicePlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      // Pass sourceInstanceId so TargetPower{Source} counts resolve correctly
      // for "look at top X where X is its/this creature's power" (Descendant of Soramaro family).
      // Slice 2: EventDamageAmount — "look at that many cards from top" in combat-damage trigger bodies.
      const choiceCount =
        typeof effect.count === 'object' && effect.count.kind === 'EventDamageAmount'
          ? (eventContext?.eventDamageAmount ?? 0)
          : resolveAmount(effect.count, xValue, state, casterId, chosenTargets, sourceInstanceId);
      const selectedIds = splitChoiceIds(
        namedCardChoices.get(effect.selectedCardChoiceId ?? 'topLibraryChoiceIds')
          || namedCardChoices.get('selectedCardIds'),
      );
      return executeChooseFromTopOfLibrary(
        state,
        choicePlayerId,
        choiceCount,
        effect.destination,
        effect.restDestination,
        selectedIds,
        effect.minSelections ?? 0,
        effect.maxSelections ?? choiceCount,
        effect.fallbackSelectionCount,
        effect.filter,
        effect.maxPerAnyOfBranch,
        undefined,  // applyEntrySideEffects
        effect.tapped,
        // Slice 3/13: pass sourceInstanceId so chosenCreatureTypeFromSource filter resolves
        sourceInstanceId,
      );
    }
    case 'ShuffleLibrary': {
      const shPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      return executeShuffleLibrary(state, shPlayerId);
    }
    case 'CounterSpell': {
      const csTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeCounterSpell(state, csTargetId, effect.filter, effect.exileInstead);
    }
    case 'GrantCantBeCountered': {
      // Slice 11: "Target spell can't be countered [this turn]." (Vexing Shusher family).
      // Set SpellStackItem.cantBeCountered on the targeted stack item so that
      // executeCounterSpell refuses to counter it.
      const gccTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      const gccItem = state.stack.find(item => isSpellStackItem(item) && (item.cardInstanceId === gccTargetId || item.id === gccTargetId));
      if (!gccItem || !isSpellStackItem(gccItem)) return state;
      const newStack = state.stack.map(item =>
        item === gccItem ? { ...item, cantBeCountered: true } : item
      );
      return { ...state, stack: newStack };
    }
    case 'OpponentsCantCastSpells': {
      // Slice 10: "Your opponents can't cast spells this turn." (Silence family).
      // Register a SpellCastProhibitionRef covering all opponents for this turn.
      const prohibitedPlayerIds = state.players
        .filter(p => p.id !== casterId && !p.hasLost)
        .map(p => p.id);
      if (prohibitedPlayerIds.length === 0) return state;
      const prohibitionId = `spell_prohibition_${casterId}_${state.turnNumber}_${(state.spellCastProhibitions || []).length + 1}`;
      return {
        ...state,
        spellCastProhibitions: [
          ...(state.spellCastProhibitions || []),
          {
            id: prohibitionId,
            sourceInstanceId,
            controllerId: casterId,
            prohibitedPlayerIds,
            expiresAtTurnNumber: state.turnNumber,
          },
        ],
      };
    }
    case 'OpponentSpellCostTax': {
      // Slice 6: "Until your next turn, spells your opponents cast cost {N} more."
      // (Tax Collector / Gobakhan ETB family.)
      // Register a SpellCostTaxRef; getSpellCostTaxIncrease in stack.ts reads it.
      // Expires when the controller's next turn begins (pruneSpellCostTaxes in turn-manager.ts).
      const taxId = `spell_cost_tax_${casterId}_${state.turnNumber}_${(state.spellCostTaxes || []).length + 1}`;
      const tax: SpellCostTaxRef = {
        id: taxId,
        sourceInstanceId,
        controllerId: casterId,
        amount: effect.amount,
        registeredAtTurnNumber: state.turnNumber,
      };
      return {
        ...state,
        spellCostTaxes: [...(state.spellCostTaxes || []), tax],
      };
    }
    case 'ChangeSpellTargets': {
      // Slice 10: "You may choose new targets for target spell or ability."
      // (Deflecting Swat family). Rewrites the targets array of a single-target
      // spell on the stack. v1: no-ops for ≠ 1 target (honesty constraint).
      const cstTargetId = resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      const newTargetId = resolveTargetRef(effect.newTarget, casterId, chosenTargets, state, eventContext);
      if (!cstTargetId || !newTargetId) return state;
      const cstItem = state.stack.find(
        item => isSpellStackItem(item) && (item.cardInstanceId === cstTargetId || item.id === cstTargetId),
      );
      if (!cstItem || !isSpellStackItem(cstItem)) return state;
      // v1 honesty: only rewrite single-target spells.
      if (cstItem.targets.length !== 1) return state;
      const newStackCST = state.stack.map(item =>
        item === cstItem ? { ...item, targets: [newTargetId] } : item
      );
      return { ...state, stack: newStackCST };
    }
    case 'ReturnFromGraveyard': {
      if (effect.target.kind === 'Source') {
        if (!sourceInstanceId) return state;
        return executeReturnFromGraveyard(state, sourceInstanceId, effect.destination, effect.counters, effect.tapped);
      }
      // "Return up to two target creature cards..." maps a single Chosen ref to
      // N ids (see resolveChosenTargetIds); single-target specs yield one id.
      const rfgTargetIds = resolveChosenTargetIds(
        effect.target, casterId, chosenTargets, chosenTargetsMulti, state, eventContext,
      );
      let rfgState = state;
      for (const id of rfgTargetIds) {
        if (!id) continue;
        rfgState = executeReturnFromGraveyard(rfgState, id, effect.destination, effect.counters, effect.tapped);
      }
      return rfgState;
    }
    case 'ModifyPT': {
      // Slice 8: AllOfType — mass P/T modification filtered by type + optional
      // controller restriction (controllerControls = caster controls,
      // opponentControls = opponents control). Covers "creatures your opponents
      // control get -2/-0" (Turn the Tide family).
      // Slice 3: also handles filter.attacking / filter.blocking (Army of Allah /
      // Piety family — "attacking/blocking creatures get +N/+M until end of turn").
      if (effect.target.kind === 'AllOfType') {
        let s = state;
        // Pre-compute combat sets for attacking/blocking filters (Slice 3).
        const allotAttackerIds = state.combat ? new Set(state.combat.attackers.map(a => a.cardInstanceId)) : new Set<string>();
        const allotBlockerIds = state.combat ? new Set(state.combat.blockers.map(b => b.cardInstanceId)) : new Set<string>();
        for (const card of state.cards.values()) {
          if (card.zone !== 'battlefield') continue;
          if (effect.target.controllerControls && card.ownerId !== casterId) continue;
          if (effect.target.opponentControls && card.ownerId === casterId) continue;
          if (!isEffectiveCreature(s, card.instanceId)) continue;
          const def = getCardDefinition(s, card);
          if (!matchesCardFilter(def, effect.target.filter)) continue;
          // Slice 3: combat-status filter checks (instance-state, not card-def).
          if (effect.target.filter.attacking && !allotAttackerIds.has(card.instanceId)) continue;
          if (effect.target.filter.blocking && !allotBlockerIds.has(card.instanceId)) continue;
          const power = resolveAmount(effect.power, xValue, s, casterId, chosenTargets, card.instanceId);
          const toughness = resolveAmount(effect.toughness, xValue, s, casterId, chosenTargets, card.instanceId);
          s = executeModifyPT(s, card.instanceId, power, toughness);
        }
        return s;
      }
      if (effect.target.kind === 'AllCreatures') {
        let s = state;
        for (const [, card] of state.cards) {
          if (card.zone !== 'battlefield') continue;
          if (!isEffectiveCreature(s, card.instanceId)) continue;
          const power = resolveAmount(effect.power, xValue, s, casterId, chosenTargets, card.instanceId);
          const toughness = resolveAmount(effect.toughness, xValue, s, casterId, chosenTargets, card.instanceId);
          s = executeModifyPT(s, card.instanceId, power, toughness);
        }
        return s;
      }
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
      if (effect.target.kind === 'AllCreaturesYouControlMatching') {
        let s = state;
        // Slice 6/spell-pump: pass namedCardChoices so chosenCreatureTypeFromCastTime
        // filter can resolve the creature type chosen at cast time.
        const mptMatchCtx = { state: s, sourceInstanceId, namedCardChoices: ctx.namedCardChoices };
        for (const card of state.cards.values()) {
          if (card.zone !== 'battlefield' || card.ownerId !== casterId) continue;
          if (!isEffectiveCreature(s, card.instanceId)) continue;
          if (!matchesCardInstanceFilter(s, card.instanceId, effect.target.filter, mptMatchCtx)) continue;
          const power = resolveAmount(effect.power, xValue, s, casterId, chosenTargets, card.instanceId);
          const toughness = resolveAmount(effect.toughness, xValue, s, casterId, chosenTargets, card.instanceId);
          s = executeModifyPT(s, card.instanceId, power, toughness);
        }
        return s;
      }
      if (effect.target.kind === 'Source') {
        if (!sourceInstanceId) return state;
        // Slice 12: pass eventContext.cardInstanceId so EventSpellManaValue resolves
        // to the triggering spell's cmc (Erratic Cyclops trigger tail).
        const power = resolveAmount(effect.power, xValue, state, casterId, chosenTargets, sourceInstanceId, eventContext?.cardInstanceId, sourceInstanceId, eventContext?.eventPlayerId);
        const toughness = resolveAmount(effect.toughness, xValue, state, casterId, chosenTargets, sourceInstanceId, eventContext?.cardInstanceId, sourceInstanceId, eventContext?.eventPlayerId);
        return executeModifyPT(state, sourceInstanceId, power, toughness);
      }
      // Slice 4: multi-target pump ("up to two target creatures each get +N/+N")
      // maps a single Chosen ref to N ids via chosenTargetsMulti.
      if (effect.target.kind === 'Chosen') {
        // Guard: if no targets were chosen (minCount=0 "up to" form), return state unchanged.
        const mptChosenIds = chosenTargetsMulti.get(effect.target.targetId);
        if (!mptChosenIds || mptChosenIds.length === 0) {
          // Fall back to single-target path if the 1:1 map has an entry;
          // otherwise this is a zero-target resolution (legal for minCount=0).
          const mptSingle = chosenTargets.get(effect.target.targetId);
          if (!mptSingle) return state;
        }
        const mptMultiIds = resolveChosenTargetIds(
          effect.target, casterId, chosenTargets, chosenTargetsMulti, state, eventContext,
        );
        let mptMultiState = state;
        for (const id of mptMultiIds) {
          if (!id) continue;
          // Slice 3/BC: "where X is this creature's power" (TargetPower{Source}) means
          // the AMOUNT is the source's power, not the chosen target's. Override to use
          // sourceInstanceId for the power lookup when the amount targets the source.
          const powerTargetId =
            typeof effect.power === 'object' && effect.power.kind === 'TargetPower' && effect.power.target.kind === 'Source'
              ? (sourceInstanceId ?? id)
              : id;
          const toughnessTargetId =
            typeof effect.toughness === 'object' && effect.toughness.kind === 'TargetPower' && effect.toughness.target.kind === 'Source'
              ? (sourceInstanceId ?? id)
              : id;
          const mptChRevealedMV = ctx.lastRevealedCardManaValue ?? 0;
          const power =
            typeof effect.power === 'object' && effect.power.kind === 'RevealedRandomCardManaValue'
              ? mptChRevealedMV
              : resolveAmount(effect.power, xValue, mptMultiState, casterId, chosenTargets, powerTargetId);
          const toughness =
            typeof effect.toughness === 'object' && effect.toughness.kind === 'RevealedRandomCardManaValue'
              ? mptChRevealedMV
              : resolveAmount(effect.toughness, xValue, mptMultiState, casterId, chosenTargets, toughnessTargetId);
          mptMultiState = executeModifyPT(mptMultiState, id, power, toughness);
        }
        return mptMultiState;
      }
      // Slice 7: pass eventContext so EventCreature ("that creature") resolves to
      // the triggering creature's instanceId at execution time.
      const mptTargetId = resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      // Slice 4: RevealedRandomCardManaValue — Planeswalker's Favor family ("where X is that card's mana value").
      const mptRevealedMV = ctx.lastRevealedCardManaValue ?? 0;
      const power =
        typeof effect.power === 'object' && effect.power.kind === 'RevealedRandomCardManaValue'
          ? mptRevealedMV
          : resolveAmount(effect.power, xValue, state, casterId, chosenTargets, mptTargetId);
      const toughness =
        typeof effect.toughness === 'object' && effect.toughness.kind === 'RevealedRandomCardManaValue'
          ? mptRevealedMV
          : resolveAmount(effect.toughness, xValue, state, casterId, chosenTargets, mptTargetId);
      return executeModifyPT(state, mptTargetId, power, toughness);
    }
    // Slice 1 (base P/T set): "Target creature has base power and toughness N/M until end of turn."
    // Layer 7b SET — stores _setBasePower / _setBaseToughness on the target card's counters
    // (cleared at end-of-turn cleanup alongside _powerMod / _toughnessMod).
    // Slice 7 extension (transient polymorph): when effect.losesAllAbilities is set, also
    // sets transientLosesAllAbilities + grantedSubtypes on the target (Turn to Frog family).
    case 'SetBasePT': {
      const sbptTargetId = effect.target.kind === 'Source'
        ? (sourceInstanceId ?? '')
        : resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      if (!sbptTargetId) return state;
      const sbptCard = state.cards.get(sbptTargetId);
      if (!sbptCard || sbptCard.zone !== 'battlefield') return state;
      const newSbptCards = new Map(state.cards);
      newSbptCards.set(sbptTargetId, {
        ...sbptCard,
        counters: {
          ...sbptCard.counters,
          '_setBasePower': effect.power,
          '_setBaseToughness': effect.toughness,
        },
        // Slice 7 (transient polymorph): set losesAllAbilities flag and creature type override.
        ...(effect.losesAllAbilities ? { transientLosesAllAbilities: true as const } : {}),
        ...(effect.subtypes && effect.subtypes.length > 0 ? { grantedSubtypes: effect.subtypes } : {}),
      });
      let sbptState: GameState = { ...state, cards: newSbptCards };
      // Grant any keyword riders (e.g. Water Wings: "and gains flying and hexproof";
      // Dance of the Skywise: "and gains flying").
      for (const kw of (effect.keywords ?? [])) {
        sbptState = executeGrantKeyword(sbptState, sbptTargetId, kw);
      }
      return sbptState;
    }
    // Slice 9 (switch P/T): "Switch [target creature's | its] power and toughness until end of turn."
    // Layer 7c swap — stores _switchPT: 1 on the target's counters. getEffectivePower /
    // getEffectiveToughness in continuous.ts read the opposite axis when the flag is set.
    // Cleared at end-of-turn cleanup (cleanupDamage in state-based.ts).
    case 'SwitchPowerToughness': {
      const sptTargetId = effect.target.kind === 'Source'
        ? (sourceInstanceId ?? '')
        : resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      if (!sptTargetId) return state;
      const sptCard = state.cards.get(sptTargetId);
      if (!sptCard || sptCard.zone !== 'battlefield') return state;
      const newSptCards = new Map(state.cards);
      newSptCards.set(sptTargetId, {
        ...sptCard,
        counters: {
          ...sptCard.counters,
          '_switchPT': 1,
        },
      });
      return { ...state, cards: newSptCards };
    }
    case 'ExileFromLibrary': {
      // Slice 7: pass eventContext so EventPlayer ("that player") resolves correctly
      // for CombatDamageToPlayer trigger tails like Raven Guild Master.
      // Slice 2: EventDamageAmount — "exile that many cards from the top of their library"
      // Slice 11/12 (EachPlayer/EachOpponent): Etali / Lidless Gaze / Brainstealer Dragon family —
      // "exile the top card of each player's / opponent's library".
      if (effect.player.kind === 'EachPlayer' || effect.player.kind === 'EachOpponent') {
        const eflCount =
          typeof effect.count === 'object' && effect.count.kind === 'EventDamageAmount'
            ? (eventContext?.eventDamageAmount ?? 0)
            : resolveAmount(effect.count, xValue, state, casterId);
        let s = state;
        for (const p of state.players) {
          if (p.hasLost) continue;
          if (effect.player.kind === 'EachOpponent' && p.id === casterId) continue;
          s = executeExileFromLibrary(s, p.id, eflCount, {
            sourceInstanceId,
            mayPlay: effect.mayPlay,
            delayedDamageEachOpponentPerCard: effect.delayedDamageEachOpponentPerCard,
          });
        }
        return s;
      }
      const eflPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      const eflCount =
        typeof effect.count === 'object' && effect.count.kind === 'EventDamageAmount'
          ? (eventContext?.eventDamageAmount ?? 0)
          : resolveAmount(effect.count, xValue, state, casterId);
      return executeExileFromLibrary(state, eflPlayerId, eflCount, {
        sourceInstanceId,
        mayPlay: effect.mayPlay,
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
      // Slice 11: Source target — "that player gains control of this enchantment" uses the
      // source permanent itself as the target. Resolve Source inline to avoid the throw path.
      const gcTargetId = effect.target.kind === 'Source'
        ? (sourceInstanceId ?? '')
        : resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      if (!gcTargetId) return state;
      // Slice 11: optional newController field — "that player gains control" uses EventPlayer.
      const gcNewControllerId = effect.newController
        ? resolveTargetRef(effect.newController, casterId, chosenTargets, state, eventContext)
        : casterId;
      if (!gcNewControllerId) return state;
      return executeGainControl(state, gcTargetId, gcNewControllerId);
    }
    // Phase 17: Conditional effects
    case 'Conditional': {
      if (evaluateCondition(state, effect.condition, casterId, eventContext)) {
        return executeEffect(state, effect.effect, ctx);
      } else if (effect.elseEffect) {
        return executeEffect(state, effect.elseEffect, ctx);
      }
      return state;
    }
    // Phase 16: Blink — exile then return to battlefield
    case 'Blink': {
      const blinkTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executeBlink(state, blinkTargetId, effect.delayed === true);
    }
    case 'ReturnFromExile': {
      const returnTargetId = effect.target.kind === 'Source'
        ? sourceInstanceId
        : resolveTargetRef(effect.target, casterId, chosenTargets);
      if (!returnTargetId) return state;
      return executeReturnFromExile(state, returnTargetId);
    }
    // Phase 16: Copy - create a token copy
    case 'Copy': {
      // Slice 7: Source target ("create a token that's a copy of this creature") —
      // resolveTargetRef throws on Source, so handle it inline with sourceInstanceId.
      const copyTargetId = effect.target.kind === 'Source'
        ? sourceInstanceId
        : resolveTargetRef(effect.target, casterId, chosenTargets);
      if (!copyTargetId) return state;
      return executeCopy(state, copyTargetId, casterId);
    }
    // Slice 7 (becomes-copy): "target/each creature becomes a copy of target creature until EOT"
    case 'BecomesCopy': {
      return executeBecomesCopy(state, effect, casterId, chosenTargets, sourceInstanceId, eventContext);
    }
    // Slice 9: EnterAsCopy — apply copy-characteristics to the entering permanent.
    case 'EnterAsCopy': {
      if (!sourceInstanceId) return state;
      return executeEnterAsCopy(state, sourceInstanceId, effect, casterId);
    }
    case 'CopySpell':
      // Spell-copy stack manipulation is handled by stack resolution so the
      // copied spell can keep its own targets and trigger magecraft correctly.
      return state;
    // Phase 16: GrantKeyword — give keyword to creature
    case 'GrantKeyword': {
      if (effect.target.kind === 'AllCreaturesYouControl') {
        let nextState = state;
        for (const card of state.cards.values()) {
          if (card.ownerId !== casterId || card.zone !== 'battlefield') continue;
          const def = getCardDefinition(state, card);
          if (!def.card_types.includes('creature')) continue;
          nextState = executeGrantKeyword(nextState, card.instanceId, effect.keyword);
        }
        return nextState;
      }
      if (effect.target.kind === 'AllCreaturesYouControlMatching') {
        let nextState = state;
        // Slice 6/spell-pump: pass namedCardChoices so chosenCreatureTypeFromCastTime
        // filter can resolve the creature type chosen at cast time.
        const gkMatchCtx = { state: nextState, sourceInstanceId, namedCardChoices: ctx.namedCardChoices };
        for (const card of state.cards.values()) {
          if (card.ownerId !== casterId || card.zone !== 'battlefield') continue;
          if (!isEffectiveCreature(nextState, card.instanceId)) continue;
          if (!matchesCardInstanceFilter(nextState, card.instanceId, effect.target.filter, gkMatchCtx)) continue;
          nextState = executeGrantKeyword(nextState, card.instanceId, effect.keyword);
        }
        return nextState;
      }
      // "All creatures gain <keyword> until end of turn" — every creature on the
      // battlefield (any controller) gets the keyword. The UEOT cleanup is global
      // (cleanupDamage clears grantedKeywords), mirroring the AllCreaturesYouControl path.
      if (effect.target.kind === 'AllCreatures') {
        let nextState = state;
        for (const card of state.cards.values()) {
          if (card.zone !== 'battlefield') continue;
          if (!isEffectiveCreature(nextState, card.instanceId)) continue;
          nextState = executeGrantKeyword(nextState, card.instanceId, effect.keyword);
        }
        return nextState;
      }
      // "All <type> creatures/permanents gain <keyword> until end of turn" — every
      // battlefield permanent matching the filter gets the keyword.
      // Slice 7: controllerControls limits to the caster's permanents only
      // (Heroic Intervention: "permanents you control gain hexproof and indestructible").
      // Slice 3: also handles filter.attacking / filter.blocking (Vampiric Fury family
      // — "attacking/blocking creatures gain <keyword> until end of turn").
      if (effect.target.kind === 'AllOfType') {
        let nextState = state;
        // Pre-compute combat sets for attacking/blocking filters (Slice 3).
        const gkAllotAttackerIds = state.combat ? new Set(state.combat.attackers.map(a => a.cardInstanceId)) : new Set<string>();
        const gkAllotBlockerIds = state.combat ? new Set(state.combat.blockers.map(b => b.cardInstanceId)) : new Set<string>();
        for (const card of state.cards.values()) {
          if (card.zone !== 'battlefield') continue;
          if (effect.target.controllerControls && card.ownerId !== casterId) continue;
          if (effect.target.opponentControls && card.ownerId === casterId) continue;
          const def = getCardDefinition(nextState, card);
          if (!matchesCardFilter(def, effect.target.filter)) continue;
          // Slice 3: combat-status filter checks (instance-state, not card-def).
          if (effect.target.filter.attacking && !gkAllotAttackerIds.has(card.instanceId)) continue;
          if (effect.target.filter.blocking && !gkAllotBlockerIds.has(card.instanceId)) continue;
          nextState = executeGrantKeyword(nextState, card.instanceId, effect.keyword);
        }
        return nextState;
      }
      if (effect.target.kind === 'Source') {
        if (!sourceInstanceId) return state;
        return executeGrantKeyword(state, sourceInstanceId, effect.keyword);
      }
      // Slice 10: Aura ETB "enchanted creature gains <keyword>" — SourceAttachedTo resolves
      // to the creature the source Aura is attached to via getSourceAttachedTo.
      if (effect.target.kind === 'SourceAttachedTo') {
        const gkAttachedId = getSourceAttachedTo(state, sourceInstanceId);
        if (!gkAttachedId) return state;
        return executeGrantKeyword(state, gkAttachedId, effect.keyword);
      }
      // Slice 1: multi-target "up to N target creatures can't block this turn" — apply to each chosen id.
      if (effect.target.kind === 'Chosen') {
        const gkTargetIds = resolveChosenTargetIds(
          effect.target, casterId, chosenTargets, chosenTargetsMulti, state, eventContext,
        );
        let gkState = state;
        for (const id of gkTargetIds) {
          if (!id) continue;
          gkState = executeGrantKeyword(gkState, id, effect.keyword);
        }
        return gkState;
      }
      // Pass state and eventContext so EventCreature ("that creature") resolves correctly
      // for BlocksOrBlockedBy trigger bodies (Slice 8/11: Witherscale Wurm / Dwarven Nomad family).
      const gkTargetId = resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      return executeGrantKeyword(state, gkTargetId, effect.keyword);
    }
    case 'LoseKeyword': {
      const lkTargetId = resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      return executeLoseKeyword(state, lkTargetId, effect.keyword);
    }
    // Slice 10: GrantAllCreatureTypes — "creatures you control gain all creature types until EOT"
    // (Volatile Claws / Shields of Velis Vel / Blades of Velis Vel family).
    case 'GrantAllCreatureTypes': {
      const gact = (id: string, s: GameState): GameState => {
        const gactCard = s.cards.get(id);
        if (!gactCard || gactCard.zone !== 'battlefield' || gactCard.grantedAllCreatureTypes) return s;
        const newCards = new Map(s.cards);
        newCards.set(id, { ...gactCard, grantedAllCreatureTypes: true });
        return { ...s, cards: newCards };
      };
      if (effect.target.kind === 'AllCreaturesYouControl') {
        let nextState = state;
        for (const card of state.cards.values()) {
          if (card.ownerId !== casterId || card.zone !== 'battlefield') continue;
          if (!isEffectiveCreature(nextState, card.instanceId)) continue;
          nextState = gact(card.instanceId, nextState);
        }
        return nextState;
      }
      if (effect.target.kind === 'AllOfType') {
        let nextState = state;
        for (const card of state.cards.values()) {
          if (card.zone !== 'battlefield') continue;
          if (effect.target.controllerControls && card.ownerId !== casterId) continue;
          if (effect.target.opponentControls && card.ownerId === casterId) continue;
          const def = getCardDefinition(nextState, card);
          if (!matchesCardFilter(def, effect.target.filter)) continue;
          nextState = gact(card.instanceId, nextState);
        }
        return nextState;
      }
      if (effect.target.kind === 'AllCreatures') {
        let nextState = state;
        for (const card of state.cards.values()) {
          if (card.zone !== 'battlefield') continue;
          if (!isEffectiveCreature(nextState, card.instanceId)) continue;
          nextState = gact(card.instanceId, nextState);
        }
        return nextState;
      }
      if (effect.target.kind === 'Chosen') {
        const gactIds = resolveChosenTargetIds(
          effect.target, casterId, chosenTargets, chosenTargetsMulti, state, eventContext,
        );
        let nextState = state;
        for (const id of gactIds) {
          if (!id) continue;
          nextState = gact(id, nextState);
        }
        return nextState;
      }
      return state;
    }
    // Slice 4: SetCreatureType — "{cost}: This creature becomes a [Subtype] until end of turn."
    // (Amoeba Spy / Mistform Dreamer family — specific named-type variant only.)
    // Sets grantedSubtypes on the source CardInstance for the remainder of the turn.
    // matchesCardFilter checks grantedSubtypes when evaluating subtype constraints.
    // Cleared at end-of-turn cleanup (cleanupDamage in state-based.ts).
    case 'SetCreatureType': {
      // Only Source-target form is emitted by matchBecomeCreatureTypeSelf.
      // Source refers to the card that activated the ability (sourceInstanceId).
      if (!sourceInstanceId) return state;
      const sctCard = state.cards.get(sourceInstanceId);
      if (!sctCard || sctCard.zone !== 'battlefield') return state;
      const newCards = new Map(state.cards);
      newCards.set(sourceInstanceId, { ...sctCard, grantedSubtypes: effect.subtypes });
      return { ...state, cards: newCards };
    }
    // Slice 9: GrantDiesTrigger — attach a transient "When this creature dies, <effects>"
    // trigger to the target creature's battlefieldAbilities entry for the turn.
    // state-based.ts fires it when the creature dies (trigger.kind === 'Dies', who: 'self').
    case 'GrantDiesTrigger': {
      let gdtTargetId: string;
      try {
        gdtTargetId = resolveTargetRef(effect.target, casterId, chosenTargets, state, eventContext);
      } catch {
        return state;
      }
      const gdtCard = state.cards.get(gdtTargetId);
      if (!gdtCard || gdtCard.zone !== 'battlefield') return state;

      const gdtAbility: TriggeredAbilityRef = {
        kind: 'TriggeredAbility',
        trigger: { kind: 'Dies', who: 'self' },
        effects: effect.dieEffects,
      };

      const newBattlefieldAbilities = new Map(state.battlefieldAbilities || new Map());
      const existing = newBattlefieldAbilities.get(gdtTargetId) || [];
      newBattlefieldAbilities.set(gdtTargetId, [...existing, gdtAbility]);
      return { ...state, battlefieldAbilities: newBattlefieldAbilities };
    }
    // Phase 16: PhaseOut
    case 'PhaseOut': {
      // Slice 8: activated self-tail "this creature phases out" → Source target.
      // resolveTargetRef throws on Source, so handle it inline like GrantKeyword does.
      if (effect.target.kind === 'Source') {
        if (!sourceInstanceId) return state;
        return executePhaseOut(state, sourceInstanceId);
      }
      const poTargetId = resolveTargetRef(effect.target, casterId, chosenTargets);
      return executePhaseOut(state, poTargetId);
    }
    case 'PreventGameOutcome': {
      const protectedPlayerIds = (() => {
        if (effect.player.kind === 'EachPlayer') {
          return state.players.filter(player => !player.hasLost).map(player => player.id);
        }
        if (effect.player.kind === 'EachOpponent') {
          return state.players.filter(player => player.id !== casterId && !player.hasLost).map(player => player.id);
        }
        return [resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext)];
      })();

      return registerGameOutcomePrevention(state, {
        sourceInstanceId,
        controllerId: casterId,
        protectedPlayerIds,
        preventsLoss: effect.preventsLoss,
        preventsWin: effect.preventsWin,
        preventsLifeLoss: effect.preventsLifeLoss,
        expiresAtTurnNumber: state.turnNumber,
      });
    }
    // WinGame: all other players lose
    case 'WinGame': {
      const winnerId = resolveTargetRef(effect.player, casterId, chosenTargets);
      if (playerCantWin(state, winnerId)) return state;
      const newPlayers = state.players.map(p =>
        p.id !== winnerId && !playerCantLose(state, p.id) ? { ...p, hasLost: true } : p
      );
      return { ...state, players: newPlayers };
    }
    // LoseGame: the specified player loses
    case 'LoseGame': {
      const loserId = resolveTargetRef(effect.player, casterId, chosenTargets);
      if (playerCantLose(state, loserId)) return state;
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
      // Slice 5: chosen-color mana — resolve color from source permanent's
      // choices.chosenColor (Sol Grail / "add one mana of the chosen color").
      if (effect.chosenColorAmount && effect.chosenColorAmount > 0) {
        const sourceCard = sourceInstanceId ? state.cards.get(sourceInstanceId) : undefined;
        const chosenColor = sourceCard?.choices?.chosenColor;
        if (chosenColor) {
          newPool[chosenColor] = (newPool[chosenColor] ?? 0) + effect.chosenColorAmount;
        }
        // If no chosenColor is stored, produce nothing (honest: card not set up yet).
      }
      for (const [color, amount] of Object.entries(effect.mana)) {
        const resolvedAmount = amount === undefined
          ? 0
          : resolveAmount(amount, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId);
        if (resolvedAmount > 0) {
          newPool[color as keyof typeof newPool] += resolvedAmount;
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
      return executePutLandFromHandOntoBattlefield(state, playerId, effect.tapped ?? false, selectedId, effect.filter);
    }
    // Slice 5 (Transform): flip the source permanent to its back face.
    case 'TransformSelf': {
      if (!sourceInstanceId) return state;
      const transformCard = state.cards.get(sourceInstanceId);
      if (!transformCard || transformCard.zone !== 'battlefield') return state;
      const transformDef = state.cardDefinitions.get(transformCard.definitionId);
      if (!transformDef || !transformDef.faces || transformDef.faces.length < 2) return state;
      // Idempotent: already on back face → no-op.
      const backFace = transformDef.faces[1];
      if (transformCard.activeFaceName === backFace.name) return state;
      const newCards = new Map(state.cards);
      newCards.set(sourceInstanceId, { ...transformCard, activeFaceName: backFace.name });
      return { ...state, cards: newCards };
    }
    // Slice 12 (en-Kor family): register a one-turn damage-redirect shield on
    // the source permanent. The next `amount` damage to the source creature is
    // redirected to the chosen creature instead.
    case 'RedirectDamage': {
      if (!sourceInstanceId) return state;
      const sourceCard = state.cards.get(sourceInstanceId);
      if (!sourceCard || sourceCard.zone !== 'battlefield') return state;
      const redirectTargetId = resolveTargetRef(effect.redirectTarget, casterId, chosenTargets, state, eventContext);
      if (!redirectTargetId) return state;
      return registerDamagePrevention(state, {
        id: `redirect_damage_${sourceInstanceId}_${state.turnNumber}_${(state.damagePreventionEffects || []).length + 1}`,
        sourceInstanceId,
        controllerId: casterId,
        protectedTargetId: sourceInstanceId,
        amount: effect.amount,
        combatOnly: false,
        expiresAtTurnNumber: state.turnNumber,
        redirectToId: redirectTargetId,
      });
    }
    // Slice 12 (Licid family): transform the source creature into an Aura and
    // attach it to the chosen creature.
    case 'LicidTransform': {
      if (!sourceInstanceId) return state;
      const licidCard = state.cards.get(sourceInstanceId);
      if (!licidCard || licidCard.zone !== 'battlefield') return state;
      const licidAttachTargetId = resolveTargetRef(effect.attachTarget, casterId, chosenTargets, state, eventContext);
      if (!licidAttachTargetId) return state;
      const licidAttachTarget = state.cards.get(licidAttachTargetId);
      if (!licidAttachTarget || licidAttachTarget.zone !== 'battlefield') return state;
      const licidCards = new Map(state.cards);
      licidCards.set(sourceInstanceId, {
        ...licidCard,
        licidAura: true,
        attachedTo: licidAttachTargetId,
      });
      return { ...state, cards: licidCards };
    }
    // Slice 8/12: "that player exiles a card at random from their hand." (Elkin Lair family).
    case 'ExileFromHand': {
      const exfhPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      if (!exfhPlayerId) return state;
      const exfhCount = resolveAmount(effect.count, xValue, state, casterId, chosenTargets, undefined, eventContext?.cardInstanceId, undefined, eventContext?.eventPlayerId);
      if (exfhCount <= 0) return state;
      // Collect the player's hand, shuffle at random (deterministic seed), exile the first N.
      const exfhHand = [...state.cards.values()].filter(c => c.ownerId === exfhPlayerId && c.zone === 'hand');
      if (exfhHand.length === 0) return state;
      const exfhOrdered = shuffled(state, exfhHand);
      const exfhToExile = exfhOrdered.slice(0, Math.min(exfhCount, exfhOrdered.length));
      const exfhNewCards = new Map(state.cards);
      for (const card of exfhToExile) {
        exfhNewCards.set(card.instanceId, {
          ...card,
          zone: getCommanderDestinationZone(state, card.instanceId, 'exile'),
          tapped: false,
          damage: 0,
          counters: {},
        });
      }
      return { ...state, cards: exfhNewCards };
    }
    // Slice 8/12: "that player may pay <cost>. If they don't, <downside>." (Umbilicus family).
    case 'EachPlayerUnlessPay': {
      const epupPlayerId = resolveTargetRef(effect.player, casterId, chosenTargets, state, eventContext);
      if (!epupPlayerId) return state;
      const pIdx2 = state.players.findIndex(p => p.id === epupPlayerId);
      if (pIdx2 < 0) return state;
      const player2 = state.players[pIdx2];

      // Attempt payment — same logic as OptionalPay but applied to the event player.
      let paidState2: GameState | null = null;

      if (effect.lifeCost !== undefined) {
        // Pay only if it keeps a safety buffer (>= 5 life remaining after payment).
        if (player2.life - effect.lifeCost >= 5) {
          const newPlayers2 = state.players.map((p, i) =>
            i === pIdx2 ? { ...p, life: p.life - effect.lifeCost! } : p,
          );
          paidState2 = { ...state, players: newPlayers2 };
        }
        // If lifeCost alone fails but we also have a manaCost (alt cost "or N life"),
        // fall through to try manaCost below.
        if (!paidState2 && effect.manaCost !== undefined) {
          const untappedLands2 = [...state.cards.values()].filter(
            c => c.ownerId === epupPlayerId && c.zone === 'battlefield' && !c.tapped && getCardDefinition(state, c).card_types.includes('land'),
          );
          const landsToTap2 = typeof effect.manaCost === 'number'
            ? (untappedLands2.length >= effect.manaCost ? untappedLands2.slice(0, effect.manaCost) : null)
            : selectLandsForManaString(state, untappedLands2, effect.manaCost);
          if (landsToTap2) {
            const newCards2 = new Map(state.cards);
            for (const land of landsToTap2) {
              newCards2.set(land.instanceId, { ...land, tapped: true });
            }
            paidState2 = { ...state, cards: newCards2 };
          }
        }
      } else if (effect.manaCost !== undefined) {
        const untappedLands2 = [...state.cards.values()].filter(
          c => c.ownerId === epupPlayerId && c.zone === 'battlefield' && !c.tapped && getCardDefinition(state, c).card_types.includes('land'),
        );
        const landsToTap2 = typeof effect.manaCost === 'number'
          ? (untappedLands2.length >= effect.manaCost ? untappedLands2.slice(0, effect.manaCost) : null)
          : selectLandsForManaString(state, untappedLands2, effect.manaCost);
        if (landsToTap2) {
          const newCards2 = new Map(state.cards);
          for (const land of landsToTap2) {
            newCards2.set(land.instanceId, { ...land, tapped: true });
          }
          paidState2 = { ...state, cards: newCards2 };
        }
      }

      if (paidState2) {
        // Player paid — skip the downside.
        return paidState2;
      }

      // Player didn't/couldn't pay — apply downside effects.
      // The downside effects reference EventPlayer so they resolve to epupPlayerId.
      let s2 = state;
      for (const inner of effect.downsideEffects) {
        s2 = executeEffect(s2, inner, ctx);
      }
      return s2;
    }
    default:
      // Exhaustiveness
      const _never: never = effect;
      throw new Error(`Unknown effect kind`);
  }
}

/** Colors a land can produce, read from its (lazily populated) mana cache. */
function landProducibleColors(state: GameState, land: CardInstance): Set<string> {
  const def = getCardDefinition(state, land);
  const parsed = (def.manaProduction || def.manaProductions?.length) ? def : populateParsedCache(def);
  const productions = parsed.manaProductions?.length
    ? parsed.manaProductions
    : parsed.manaProduction ? [parsed.manaProduction] : [];
  const colors = new Set<string>();
  for (const production of productions) {
    for (const color of production.colors) colors.add(color);
  }
  return colors;
}

/**
 * Pick untapped lands to pay a colored OptionalPay mana string like '{2}{R}'
 * or '{1}{B/G}'. Each colored pip needs a land producing that color (hybrid:
 * either listed color); generic mana takes any leftover land. The land with
 * the fewest producible colors is spent first so a dual isn't wasted on a pip
 * a basic could cover. Returns null when the cost can't be covered — declining
 * is always a legal choice for "you may pay".
 */
function selectLandsForManaString(state: GameState, untappedLands: CardInstance[], manaCost: string): CardInstance[] | null {
  let generic = 0;
  const coloredPips: string[][] = [];
  for (const pip of manaCost.match(/\{[^}]+\}/g) ?? []) {
    const inner = pip.slice(1, -1);
    const n = parseInt(inner, 10);
    if (!isNaN(n)) generic += n;
    else coloredPips.push(inner.toUpperCase().split('/'));
  }
  if (untappedLands.length < generic + coloredPips.length) return null;
  const remaining = untappedLands.map(land => ({ land, colors: landProducibleColors(state, land) }));
  // Mono pips before hybrids (fewer ways to satisfy them).
  coloredPips.sort((a, b) => a.length - b.length);
  const chosen: CardInstance[] = [];
  for (const pipColors of coloredPips) {
    let bestIndex = -1;
    for (let i = 0; i < remaining.length; i++) {
      if (!pipColors.some(c => remaining[i].colors.has(c))) continue;
      if (bestIndex < 0 || remaining[i].colors.size < remaining[bestIndex].colors.size) bestIndex = i;
    }
    if (bestIndex < 0) return null;
    chosen.push(remaining[bestIndex].land);
    remaining.splice(bestIndex, 1);
  }
  if (remaining.length < generic) return null;
  for (let i = 0; i < generic; i++) chosen.push(remaining[i].land);
  return chosen;
}

// ── Morph / Megamorph subsystem (Slice 1) ────────────────────────────────────
//
// Three exported functions power the face-down / turn-face-up state machine:
//
//   castMorphFaceDown(state, instanceId, controllerId, morphCost, isMegamorph)
//     — Called by tryMorphCast (actions-public.ts) after mana {3} is deducted.
//       Moves the card to the battlefield with faceDown=true, stores morphCost,
//       and calls applyDirectBattlefieldEntrySideEffects (does NOT queue ETB
//       triggers since the permanent entered face-down with no identity).
//
//   canTurnFaceUp(state, instanceId, controllerId)
//     — Returns true when: instanceId is faceDown, on the battlefield, owned by
//       controllerId, and the controller has enough unrestricted mana to pay morphCost.
//
//   executeTurnFaceUp(state, instanceId, controllerId)
//     — Deducts morphCost from the player's mana pool, clears faceDown on the card,
//       adds a +1/+1 counter for megamorph, re-registers battlefield abilities (now
//       the real oracle text is visible), and enqueues any TurnedFaceUp trigger.

/**
 * Returns the raw morph/megamorph cost string from oracle text, e.g. "{1}{U}".
 * Returns null when no morph/megamorph cost line is found.
 * For megamorph, also returns `isMegamorph: true`.
 */
export function parseMorphCostFromOracle(oracleText: string): { cost: string; isMegamorph: boolean } | null {
  const MORPH_LINE_RE = /^(?:mega-?morph)\s*((?:\{[^}]+\})+)/i;
  const MORPH_ONLY_RE = /^morph\s+((?:\{[^}]+\})+)/i;
  for (const line of oracleText.split('\n')) {
    const cleaned = line.trim();
    let m = MORPH_LINE_RE.exec(cleaned);
    if (m) return { cost: m[1], isMegamorph: true };
    m = MORPH_ONLY_RE.exec(cleaned);
    if (m) return { cost: m[1], isMegamorph: false };
  }
  return null;
}

/**
 * Slice 1 (Morph SUBSYSTEM): place a card face-down on the battlefield as a
 * 2/2 colorless creature with no name, text, or subtypes.  Called by
 * tryMorphCast after the controller has paid {3} (the generic face-down cost).
 *
 * Side-effects:
 *   - Sets card.zone = 'battlefield', card.faceDown = true.
 *   - Stores morphCost (the card's printed morph/megamorph cost) and isMegamorph.
 *   - Does NOT queue ETB triggers (a face-down creature has no ETB ability).
 *   - Does NOT register battlefieldAbilities (face-down identity is anonymous).
 */
export function castMorphFaceDown(
  state: GameState,
  instanceId: string,
  controllerId: string,
  morphCost: string,
  isMegamorph: boolean,
): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`castMorphFaceDown: card ${instanceId} not found`);

  const newCards = new Map(state.cards);
  newCards.set(instanceId, {
    ...card,
    zone: 'battlefield',
    ownerId: controllerId,
    faceDown: true,
    morphCost,
    isMegamorph,
    tapped: false,
    summoningSick: true,
    damage: 0,
  });

  // No ETB triggers, no battlefieldAbilities for face-down permanents.
  return { ...state, cards: newCards };
}

/**
 * Slice 1 (Morph SUBSYSTEM): returns true when the controller may activate the
 * turn-face-up action on the given permanent.
 *
 * Requirements: card is on the battlefield, is face-down, is controlled by
 * controllerId, and the controller has sufficient unrestricted mana for morphCost.
 */
export function canTurnFaceUp(state: GameState, instanceId: string, controllerId: string): boolean {
  const card = state.cards.get(instanceId);
  if (!card || card.zone !== 'battlefield' || !card.faceDown || card.ownerId !== controllerId) return false;
  if (!card.morphCost) return false;

  const player = state.players.find(p => p.id === controllerId);
  if (!player) return false;

  try {
    const cost = parseManaString(card.morphCost);
    return canPayUnrestrictedCost(player, cost);
  } catch {
    return false;
  }
}

/**
 * Slice 1 (Morph SUBSYSTEM): execute the turn-face-up action.
 *
 * 1. Deducts morphCost from the controller's mana pool.
 * 2. Clears `faceDown` on the card (reveals its true identity).
 * 3. For megamorph, adds a +1/+1 counter.
 * 4. Re-registers battlefieldAbilities (oracle text now visible — ETB not re-queued,
 *    but TurnedFaceUp and other always-on abilities are registered).
 * 5. Enqueues any TurnedFaceUp triggered abilities found on the oracle text.
 *
 * Throws when the card is not face-down, not controlled by controllerId, or the
 * controller cannot pay the morph cost.
 */
export function executeTurnFaceUp(state: GameState, instanceId: string, controllerId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card || card.zone !== 'battlefield') throw new Error(`executeTurnFaceUp: card ${instanceId} not on battlefield`);
  if (!card.faceDown) throw new Error(`executeTurnFaceUp: card ${instanceId} is not face-down`);
  if (card.ownerId !== controllerId) throw new Error(`executeTurnFaceUp: card ${instanceId} not controlled by ${controllerId}`);
  if (!card.morphCost) throw new Error(`executeTurnFaceUp: card ${instanceId} has no stored morph cost`);

  const playerIndex = state.players.findIndex(p => p.id === controllerId);
  if (playerIndex < 0) throw new Error(`executeTurnFaceUp: player ${controllerId} not found`);

  // 1. Pay the morph cost from the player's mana pool.
  const cost = parseManaString(card.morphCost);
  const updatedPlayer = payUnrestrictedManaCost(state.players[playerIndex], cost);
  const newPlayers = state.players.map((p, i) => i === playerIndex ? updatedPlayer : p);

  // 2. Turn face up: clear faceDown flag.
  const newCards = new Map(state.cards);
  const faceUpCard: CardInstance = {
    ...card,
    faceDown: false,
    // Keep morphCost/isMegamorph for reference; no longer functionally relevant.
  };

  // 3. Megamorph: add a +1/+1 counter.
  if (card.isMegamorph) {
    const counters = { ...faceUpCard.counters };
    counters['+1/+1'] = (counters['+1/+1'] ?? 0) + 1;
    (faceUpCard as CardInstance).counters = counters;
  }
  newCards.set(instanceId, faceUpCard);

  let nextState: GameState = { ...state, players: newPlayers, cards: newCards };

  // 4. Re-register battlefield abilities now that the true oracle text is visible.
  //    We explicitly exclude ETB triggers (they should not fire again on turn-face-up)
  //    but we DO register TurnedFaceUp and other always-on abilities.
  nextState = registerBattlefieldAbilitiesAfterDirectEntry(nextState, instanceId);

  // 5. Find and enqueue any TurnedFaceUp triggered abilities.
  const def = getCardDefinition(nextState, faceUpCard);
  const abilitiesToQueue = (nextState.battlefieldAbilities.get(instanceId) ?? [])
    .filter(a => a.trigger.kind === 'TurnedFaceUp');

  if (abilitiesToQueue.length > 0) {
    const pendingTriggers: PendingTrigger[] = [...(nextState.pendingTriggers || [])];
    for (const ability of abilitiesToQueue) {
      // Find the target specs for this TurnedFaceUp trigger by parsing oracle text.
      let requiredTargets: TargetSpec[] = (ability.targets as TargetSpec[] | undefined) ?? [];
      if (requiredTargets.length === 0) {
        for (const line of def.oracle_text.split('\n')) {
          const parsed = parseOracleText(normalizeTriggeredOracleLine(line.trim(), def.name));
          if (parsed.kind === 'Triggered' && parsed.ability.trigger.kind === 'TurnedFaceUp') {
            requiredTargets = parsed.targets;
            break;
          }
        }
      }
      pendingTriggers.push({
        id: `trigger_turned_face_up_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        sourceInstanceId: instanceId,
        controllerId,
        ability,
        requiredTargets,
      });
    }
    nextState = { ...nextState, pendingTriggers };
  }

  return nextState;
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
  targetSpecs: { id: string; count?: number }[],
  xValue: number = 0,
  options: EffectExecutionOptions = {},
): GameState {
  // Build maps from spec ID to chosen target id(s).
  //
  // chosenTargets is the legacy 1:1 map (spec.id -> first chosen id) preserved
  // for all single-target callers. chosenTargetsMulti slices the flat
  // chosenTargetIds by each spec's `count` (mirroring validateTargetChoices) so
  // multi-target specs expose every chosen id. When a spec omits count we treat
  // it as 1, which keeps existing single-target behavior identical.
  const chosenTargets = new Map<string, string>();
  const chosenTargetsMulti = new Map<string, string[]>();
  let offset = 0;
  for (const spec of targetSpecs) {
    const count = spec.count ?? 1;
    const slice = chosenTargetIds.slice(offset, offset + count);
    offset += count;
    if (slice.length > 0) {
      chosenTargets.set(spec.id, slice[0]);
      chosenTargetsMulti.set(spec.id, slice);
    }
  }

  const ctx: ExecutionContext = {
    casterId,
    chosenTargets,
    chosenTargetsMulti,
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
  targetSpecs: { id: string; count?: number }[],
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

/**
 * Public wrapper for resolveForEachCount, used by stack.ts to evaluate dynamic
 * ForEachAmount counter placements at ETB time (slice-11 "enters with X counters,
 * where X is the number of <filter> <place>").
 */
export function evaluateForEachAmount(
  forEach: ForEachAmount,
  state: GameState,
  controllerId: string,
): number {
  return resolveForEachCount(forEach, state, controllerId);
}
