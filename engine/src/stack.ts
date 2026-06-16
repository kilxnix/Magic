import { GameState, Phase, StackItem, SpellStackItem, TriggeredAbilityStackItem, isSpellStackItem, isTriggeredAbilityStackItem, isActivatedAbilityStackItem, TriggeredAbilityRef, CardInstance, CardDefinition } from './types';
import { applyFaceToCardDefinition, getCardDefinition, getCardsInZone } from './game-state';
import { parseManaString, canPaySpellCost, paySpellCost, getSpellPaymentRestrictedMana, getSpellPaymentConditionalMana } from './mana';
import { getOverride } from './effects/overrides';
import { parseOracleText, parseWhereXIsNumberOf, parseWhereXIsAnyAmount, parseNumberOfFilterAmount } from './effects/parser';
import { CAST_ONLY_DURING_BLOCKERS_FULL_RE } from './effects/matchers/static-abilities';
import { executeEffectsWithSBA, evaluateForEachAmount, matchesCardFilter } from './effects/executor';
import { tokenizeOracleText } from './effects/tokens';
import { validateTargetChoices, TargetSpec, TargetType } from './effects/targets';
import { checkStateBasedActions } from './state-based';
import type { AmountRef, Effect, ModalSpell, StaticAbilityEffect, TargetRef, MVSumAmount } from './effects/ast';
import { findCastZoneRestriction, getCommanderTaxForCast } from './casting-restrictions';
import { getCostIncrease, getCostReduction, getIntrinsicCostReduction, registerContinuousEffect, evaluateCondition } from './effects/continuous';
import { getCommanderDestinationZone, isOwnersCommander } from './commander';
import { buildBattlefieldEntryPlan } from './permanent-entry';
import { applyWardForStackItem } from './ward';
import { playerCanPayLife } from './game-outcome';
import { instanceLosesAllAbilities, instanceHasKeyword } from './keywords';
import { typeLineHasSupertype } from './type-line';

const MAIN_PHASES: Phase[] = ['precombat_main', 'postcombat_main'];
const PERMANENT_TYPES = ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle'];

let stackCounter = 0;

function nextStackObjectId(state: GameState): string {
  let id = `stack_${++stackCounter}`;
  while (state.stack.some(item => item.id === id)) {
    id = `stack_${++stackCounter}`;
  }
  return id;
}

export interface CastSpellOptions {
  chosenModes?: number[];
  namedCardChoices?: Record<string, string>;
  cardChoices?: CardInstance['choices'];
  xValue?: number;
  faceName?: string;
  delveCardIds?: string[];
  convokeCreatureIds?: string[];
  improviseArtifactIds?: string[];
  /**
   * Slice 10: When true the player is using an alternative free-cast cost
   * (e.g. Deflecting Swat "If you control a commander, you may cast this spell
   * without paying its mana cost."). buildCostMechanicPlan checks the condition
   * and zeroes the cost when it passes.
   */
  useFreeCast?: boolean;
}

function normalizeCastOptions(options?: number[] | CastSpellOptions): CastSpellOptions {
  if (Array.isArray(options)) {
    return { chosenModes: options };
  }
  return options || {};
}

function normalizedXValue(options: CastSpellOptions): number {
  return Math.max(0, Math.floor(options.xValue ?? 0));
}

function validateModalModeSelection(modal: ModalSpell, modes: number[]): void {
  const minSelections = modal.upTo ? 1 : modal.chooseCount;
  const maxSelections = modal.chooseCount;
  const uniqueModes = new Set(modes);
  if (uniqueModes.size !== modes.length || modes.length < minSelections || modes.length > maxSelections) {
    const requirement = minSelections === maxSelections
      ? `${maxSelections}`
      : `${minSelections} to ${maxSelections}`;
    throw new Error(`Modal spell requires ${requirement} mode(s), got ${modes.length}`);
  }
  for (const modeIndex of modes) {
    if (!Number.isInteger(modeIndex) || modeIndex < 0 || modeIndex >= modal.choices.length) {
      throw new Error(`Invalid modal choice ${modeIndex}`);
    }
  }
}

function splitStackChoiceIds(value?: string): string[] {
  if (!value) return [];
  return value.split(',').map(part => part.trim()).filter(Boolean);
}

function stackAmountToNumber(amount: AmountRef, xValue = 0): number {
  if (typeof amount === 'number' && Number.isFinite(amount)) return Math.max(0, Math.floor(amount));
  if (amount && typeof amount === 'object') {
    const kind = (amount as { kind?: string }).kind;
    if (kind === 'X') return Math.max(0, Math.floor(xValue));
    if (kind === 'XMultiplied') {
      const multiplier = (amount as { multiplier?: number }).multiplier ?? 1;
      return Math.max(0, Math.floor(xValue * multiplier));
    }
  }
  return 1;
}

function targetMapFromSpecs(targetSpecs: TargetSpec[], targets: string[]): Map<string, string> {
  const mapped = new Map<string, string>();
  targetSpecs.forEach((spec, index) => {
    const targetId = targets[index];
    if (targetId) mapped.set(spec.id, targetId);
  });
  return mapped;
}

function resolveChoicePlayerId(
  state: GameState,
  controllerId: string,
  playerRef: TargetRef,
  targetSpecs: TargetSpec[],
  targets: string[],
): string {
  if (!playerRef || typeof playerRef !== 'object') return controllerId;
  const ref = playerRef as { kind?: string; playerId?: string; targetId?: string };
  if (ref.kind === 'Controller') return controllerId;
  if (ref.kind === 'Player' && ref.playerId) return ref.playerId;
  if (ref.kind === 'ActivePlayer') return state.players[state.activePlayerIndex]?.id ?? controllerId;
  if ((ref.kind === 'Chosen' || ref.kind === 'TargetController') && ref.targetId) {
    const targetId = targetMapFromSpecs(targetSpecs, targets).get(ref.targetId);
    if (!targetId) return controllerId;
    const player = state.players.find(p => p.id === targetId);
    if (player) return player.id;
    const card = state.cards.get(targetId);
    if (card) return card.ownerId;
  }
  return controllerId;
}

function hasMissingRequiredStackChoice(
  state: GameState,
  effects: Effect[],
  controllerId: string,
  targetSpecs: TargetSpec[],
  targets: string[],
  namedCardChoices?: Record<string, string>,
  xValue = 0,
): boolean {
  for (const effect of effects) {
    if (effect.kind === 'Conditional') {
      if (hasMissingRequiredStackChoice(state, [effect.effect], controllerId, targetSpecs, targets, namedCardChoices, xValue)) {
        return true;
      }
      if (effect.elseEffect && hasMissingRequiredStackChoice(state, [effect.elseEffect], controllerId, targetSpecs, targets, namedCardChoices, xValue)) {
        return true;
      }
      continue;
    }

    if (effect.kind !== 'ChooseFromTopOfLibrary') continue;

    const choiceCount = stackAmountToNumber(effect.count, xValue);
    const choicePlayerId = resolveChoicePlayerId(state, controllerId, effect.player, targetSpecs, targets);
    const libraryCards = [...state.cards.values()]
      .filter(card => card.ownerId === choicePlayerId && card.zone === 'library');
    const revealed = libraryCards.slice(0, Math.min(choiceCount, libraryCards.length));
    if (revealed.length === 0) continue;

    const minSelections = effect.minSelections ?? 0;
    const maxSelections = effect.maxSelections ?? choiceCount;
    const choiceKey = effect.selectedCardChoiceId ?? 'topLibraryChoiceIds';
    const rawChoice = namedCardChoices?.[choiceKey] ?? namedCardChoices?.selectedCardIds;
    if (!rawChoice) {
      if (minSelections > 0) return true;
      continue;
    }

    const submittedIds = splitStackChoiceIds(rawChoice);
    const uniqueIds = [...new Set(submittedIds)];
    const legalIds = new Set(revealed.map(card => card.instanceId));
    if (
      uniqueIds.length !== submittedIds.length
      || uniqueIds.length < minSelections
      || uniqueIds.length > maxSelections
      || uniqueIds.some(id => !legalIds.has(id))
    ) {
      return true;
    }
  }

  return false;
}

function hasAdditionalXLifeCost(def: CardDefinition): boolean {
  return /\bas an additional cost to cast this spell,\s*pay x life\b/i.test(def.oracle_text);
}

const ADDITIONAL_LIFE_WORD_VALUES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * Honest additional cast cost: a FIXED "As an additional cost to cast this
 * spell, pay N life." amount (digit or small word). The {X} variant is handled
 * separately by hasAdditionalXLifeCost. Returns 0 when no fixed life cost.
 */
function getFixedAdditionalLifeCost(def: CardDefinition): number {
  const match = /\bas an additional cost to cast this spell,\s*pay\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/i.exec(def.oracle_text);
  if (!match) return 0;
  const token = match[1].toLowerCase();
  const digit = Number.parseInt(token, 10);
  if (Number.isFinite(digit)) return Math.max(0, digit);
  return ADDITIONAL_LIFE_WORD_VALUES[token] ?? 0;
}

export function getAdditionalLifeCostForCast(def: CardDefinition, options: CastSpellOptions = {}): number {
  if (hasAdditionalXLifeCost(def)) return normalizedXValue(options);
  return getFixedAdditionalLifeCost(def);
}

function applyFaceToDefinition(def: CardDefinition, faceName?: string): CardDefinition {
  return applyFaceToCardDefinition(def, faceName);
}

export function getCastSpellDefinition(
  state: GameState,
  cardInstanceId: string,
  options: CastSpellOptions = {},
): CardDefinition | null {
  const card = state.cards.get(cardInstanceId);
  if (!card) return null;
  return applyFaceToDefinition(getCardDefinition(state, card), options.faceName);
}

function copyCardChoices(choices?: CardInstance['choices']): CardInstance['choices'] {
  return choices ? {
    chosenCreatureType: choices.chosenCreatureType,
    chosenColor: choices.chosenColor,
    chosenOpponent: choices.chosenOpponent,
    chosenCardName: choices.chosenCardName,
    imprintedCardIds: choices.imprintedCardIds ? [...choices.imprintedCardIds] : undefined,
    discardedCardIds: choices.discardedCardIds ? [...choices.discardedCardIds] : undefined,
  } : undefined;
}

interface CostMechanicPlan {
  cost: ReturnType<typeof parseManaString>;
  tapIds: string[];
  exileIds: string[];
}

/**
 * Slice 10: Return true when the spell has the Deflecting Swat free-cast
 * alternative cost ("if you control a commander, you may cast this spell without
 * paying its mana cost") AND the caster currently controls a commander on the
 * battlefield.
 */
function hasFreeCastConditionForCommander(
  state: GameState,
  playerId: string,
  spellDef: CardDefinition,
): boolean {
  const hasFreeText = /if you control a commander,\s*you may cast this spell without paying its mana cost/i
    .test(spellDef.oracle_text);
  if (!hasFreeText) return false;
  // Check if the player controls a commander on the battlefield.
  for (const [instanceId, card] of state.cards) {
    if (card.zone !== 'battlefield' || card.ownerId !== playerId) continue;
    if (isOwnersCommander(state, instanceId)) return true;
  }
  return false;
}

function hasKeywordOrText(def: CardDefinition, keyword: string): boolean {
  const normalized = keyword.toLowerCase();
  return def.keywords.some(item => item.toLowerCase() === normalized)
    || new RegExp(`\\b${keyword}\\b`, 'i').test(def.oracle_text);
}

/**
 * Slice 10 (combat statics): Returns true when the spell's oracle text carries
 * the "Cast this spell only during the declare blockers step." timing restriction
 * (Mirror Match family).  When true, canCastSpell requires state.step === 'declare_blockers'.
 *
 * We read oracle text directly (same pattern as hasFreeCastConditionForCommander)
 * rather than calling parseOracleText, to avoid circular dependency risks and to
 * keep this a fast O(1) check on the regex cache.
 */
function hasCastOnlyDuringDeclareBlockers(def: CardDefinition): boolean {
  return CAST_ONLY_DURING_BLOCKERS_FULL_RE.test(def.oracle_text || '');
}

function cardColorsForPayment(def: CardDefinition): Array<'W' | 'U' | 'B' | 'R' | 'G'> {
  return def.colors.filter((color): color is 'W' | 'U' | 'B' | 'R' | 'G' => color !== 'C');
}

function getControllerBattlefieldCards(
  state: GameState,
  playerId: string,
  predicate: (card: CardInstance, def: CardDefinition) => boolean,
): CardInstance[] {
  return [...state.cards.values()].filter(card => {
    if (card.ownerId !== playerId || card.zone !== 'battlefield' || card.tapped) return false;
    return predicate(card, getCardDefinition(state, card));
  });
}

function orderedMechanicCandidates<T extends CardInstance>(
  candidates: T[],
  preferredIds?: string[],
): T[] {
  if (!preferredIds?.length) return candidates;
  const byId = new Map(candidates.map(card => [card.instanceId, card]));
  return preferredIds.map(id => byId.get(id)).filter((card): card is T => Boolean(card));
}

function reduceCostForConvokeCreature(
  cost: ReturnType<typeof parseManaString>,
  creatureDef: CardDefinition,
): ReturnType<typeof parseManaString> {
  const next = { ...cost };
  for (const color of cardColorsForPayment(creatureDef)) {
    if (next[color] > 0) {
      next[color] -= 1;
      return next;
    }
  }
  if (next.generic > 0) {
    next.generic -= 1;
    return next;
  }
  return cost;
}

function buildCostMechanicPlan(
  state: GameState,
  playerId: string,
  spellCard: CardInstance,
  spellDef: CardDefinition,
  baseCost: ReturnType<typeof parseManaString>,
  options: CastSpellOptions,
): CostMechanicPlan {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { cost: baseCost, tapIds: [], exileIds: [] };

  // Slice 10: Deflecting Swat free-cast alternative cost.
  // "If you control a commander, you may cast this spell without paying its mana cost."
  // When the player explicitly opts into free-cast AND controls a commander on the
  // battlefield, zero out the mana cost entirely.
  if (options.useFreeCast && hasFreeCastConditionForCommander(state, playerId, spellDef)) {
    return { cost: parseManaString(''), tapIds: [], exileIds: [] };
  }

  let cost = { ...baseCost };
  const tapIds: string[] = [];
  const exileIds: string[] = [];
  const hasExplicitMechanicChoice = Boolean(
    options.delveCardIds?.length
    || options.convokeCreatureIds?.length
    || options.improviseArtifactIds?.length,
  );

  const isPayable = () => canPaySpellCost(player, cost, spellDef, spellCard);
  if (!hasExplicitMechanicChoice && isPayable()) return { cost, tapIds, exileIds };

  if (hasKeywordOrText(spellDef, 'delve') && cost.generic > 0) {
    const graveyardCards = [...state.cards.values()]
      .filter(card => card.ownerId === playerId && card.zone === 'graveyard' && card.instanceId !== spellCard.instanceId);
    const chosen = orderedMechanicCandidates(graveyardCards, options.delveCardIds);
    const candidates = options.delveCardIds?.length ? chosen : graveyardCards;
    for (const card of candidates) {
      if (cost.generic <= 0) break;
      exileIds.push(card.instanceId);
      cost = { ...cost, generic: cost.generic - 1 };
      if (!hasExplicitMechanicChoice && isPayable()) break;
    }
  }

  if (hasKeywordOrText(spellDef, 'convoke')) {
    const creatures = getControllerBattlefieldCards(state, playerId, (_card, def) => def.card_types.includes('creature'));
    const candidates = options.convokeCreatureIds?.length
      ? orderedMechanicCandidates(creatures, options.convokeCreatureIds)
      : creatures;
    for (const creature of candidates) {
      const creatureDef = getCardDefinition(state, creature);
      const nextCost = reduceCostForConvokeCreature(cost, creatureDef);
      if (nextCost === cost) continue;
      tapIds.push(creature.instanceId);
      cost = nextCost;
      if (!hasExplicitMechanicChoice && isPayable()) break;
    }
  }

  if (hasKeywordOrText(spellDef, 'improvise') && cost.generic > 0) {
    const artifacts = getControllerBattlefieldCards(state, playerId, (_card, def) => def.card_types.includes('artifact'));
    const candidates = options.improviseArtifactIds?.length
      ? orderedMechanicCandidates(artifacts, options.improviseArtifactIds)
      : artifacts;
    for (const artifact of candidates) {
      if (cost.generic <= 0) break;
      tapIds.push(artifact.instanceId);
      cost = { ...cost, generic: cost.generic - 1 };
      if (!hasExplicitMechanicChoice && isPayable()) break;
    }
  }

  return { cost, tapIds: [...new Set(tapIds)], exileIds: [...new Set(exileIds)] };
}

function hasCastSacrificeToCounterChoice(oracleText: string): boolean {
  return /\bwhen you cast this spell,\s*any player may sacrifice a creature\b/i.test(oracleText)
    && /\bif a player does,\s*counter\b/i.test(oracleText);
}

function applyCastSacrificeToCounterChoice(
  state: GameState,
  spellStackItem: SpellStackItem,
  sacrificeCardId: string | undefined,
): GameState {
  if (!sacrificeCardId) return state;
  const sacrificed = state.cards.get(sacrificeCardId);
  if (!sacrificed || sacrificed.zone !== 'battlefield') return state;
  const sacrificedDef = getCardDefinition(state, sacrificed);
  if (!sacrificedDef.card_types.includes('creature')) return state;

  const spellCard = state.cards.get(spellStackItem.cardInstanceId);
  if (!spellCard) return state;

  const newCards = new Map(state.cards);
  newCards.set(sacrificeCardId, {
    ...sacrificed,
    zone: getCommanderDestinationZone(state, sacrificeCardId, 'graveyard'),
    tapped: false,
    damage: 0,
    counters: {},
  });
  newCards.set(spellStackItem.cardInstanceId, {
    ...spellCard,
    zone: getCommanderDestinationZone(state, spellStackItem.cardInstanceId, 'graveyard'),
  });

  return {
    ...state,
    cards: newCards,
    stack: state.stack.filter(item => item !== spellStackItem),
  };
}

function mergeCardChoices(
  base?: CardInstance['choices'],
  override?: CardInstance['choices'],
): CardInstance['choices'] {
  const merged: NonNullable<CardInstance['choices']> = {};
  const source = { ...(base || {}) };
  if (source.chosenCreatureType) merged.chosenCreatureType = source.chosenCreatureType;
  if (source.chosenColor) merged.chosenColor = source.chosenColor;
  if (source.imprintedCardIds && source.imprintedCardIds.length > 0) {
    merged.imprintedCardIds = [...source.imprintedCardIds];
  }
  if (source.discardedCardIds && source.discardedCardIds.length > 0) {
    merged.discardedCardIds = [...source.discardedCardIds];
  }
  if (override?.chosenCreatureType) merged.chosenCreatureType = override.chosenCreatureType;
  if (override?.chosenColor) merged.chosenColor = override.chosenColor;
  if (override?.imprintedCardIds && override.imprintedCardIds.length > 0) {
    merged.imprintedCardIds = [...override.imprintedCardIds];
  }
  if (override?.discardedCardIds && override.discardedCardIds.length > 0) {
    merged.discardedCardIds = [...override.discardedCardIds];
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function isChromeMoxLike(def: CardDefinition): boolean {
  return /chrome mox/i.test(def.name)
    || /add one mana of any of the exiled card'?s colors/i.test(def.oracle_text);
}

function isMoxDiamondLike(def: CardDefinition): boolean {
  return /mox diamond/i.test(def.name)
    || /if .* would enter .* discard a land card/i.test(def.oracle_text);
}

function getAuraTargetSpecs(def: CardDefinition): TargetSpec[] {
  if (!def.card_types.includes('enchantment') || !/\baura\b/i.test(def.type_line)) return [];
  if (/\benchant\s+creature\b/i.test(def.oracle_text)) {
    return [{ id: 'aura_target', type: 'Creature', count: 1 }];
  }
  return [];
}

function getCastTargetSpecs(def: CardDefinition, castOptions: CastSpellOptions): TargetSpec[] | null {
  const auraTargetSpecs = getAuraTargetSpecs(def);
  if (auraTargetSpecs.length > 0) return auraTargetSpecs;
  if (def.card_types.some(t => PERMANENT_TYPES.includes(t))) return [];

  const override = getOverride(def.id, def.name);
  if (override && override.kind === 'Spell') return override.targets;

  const parsed = parseOracleText(normalizeOracleText(def.oracle_text, def.name), def.mana_cost);
  if (parsed.kind === 'Spell') return parsed.targets;

  if (parsed.kind === 'Modal') {
    if (!castOptions.chosenModes) return null;
    const modes = castOptions.chosenModes;
    validateModalModeSelection(parsed.modal, modes);
    const specs: TargetSpec[] = [];
    for (const modeIndex of modes) {
      const choice = parsed.modal.choices[modeIndex];
      for (const target of choice.targets) {
        specs.push({ id: target.id, type: target.type as TargetType, count: 1 });
      }
    }
    return specs;
  }

  return null;
}

const INVALID_RESOLUTION_TARGET_PREFIX = '__deckreps_invalid_resolution_target__';

function expandedTargetSpecs(specs: TargetSpec[]): TargetSpec[] {
  const expanded: TargetSpec[] = [];
  for (const spec of specs) {
    const count = Math.max(1, spec.count ?? 1);
    for (let i = 0; i < count; i++) {
      expanded.push({ ...spec, count: 1 });
    }
  }
  return expanded;
}

function targetRemainsLegalAtResolution(
  state: GameState,
  casterId: string,
  spec: TargetSpec,
  targetId: string | undefined,
  sourceInstanceId?: string,
): boolean {
  if (!targetId) return false;
  try {
    validateTargetChoices(state, casterId, [{ ...spec, count: 1 }], [targetId], sourceInstanceId);
    return true;
  } catch {
    return false;
  }
}

function sanitizeTargetsAtResolution(
  state: GameState,
  casterId: string,
  specs: TargetSpec[],
  targets: string[],
  sourceInstanceId?: string,
): { hasLegalTarget: boolean; targets: string[] } {
  if (specs.length === 0) return { hasLegalTarget: true, targets };

  const expandedSpecs = expandedTargetSpecs(specs);
  const sanitized = [...targets];
  let hasLegalTarget = false;

  for (let index = 0; index < expandedSpecs.length; index++) {
    const targetId = targets[index];
    if (targetRemainsLegalAtResolution(state, casterId, expandedSpecs[index], targetId, sourceInstanceId)) {
      hasLegalTarget = true;
      continue;
    }
    sanitized[index] = `${INVALID_RESOLUTION_TARGET_PREFIX}${index}`;
  }

  return { hasLegalTarget, targets: sanitized };
}

function normalizeStackTargetSpecs(specs: unknown[] | undefined): TargetSpec[] {
  return (specs || []).map((spec) => {
    const item = spec as Partial<TargetSpec>;
    return {
      id: String(item.id),
      type: item.type as TargetType,
      count: item.count ?? 1,
      ...(item.minCount !== undefined ? { minCount: item.minCount } : {}),
      ...(item.constraints ? { constraints: item.constraints } : {}),
    };
  });
}

// Regex for the "can't reduce the cost to less than one mana" rider
// (Valiant Changeling, Khalni Hydra). When present, the generic cost may not
// drop below 1 if there are no colored pips, or to 0 if there ARE colored pips
// (the colored pips already serve as the minimum mana). Per MTG rulings: the
// minimum is one mana of ANY type; colored pips count toward that minimum.
const CANT_REDUCE_BELOW_ONE_MANA_RE =
  /\bthis effect can['']?t reduce (?:the (?:mana |total )?cost(?: of this spell)? to less than one mana|the mana value of this spell below one)\b/i;

function reduceGenericCost(
  state: GameState,
  playerId: string,
  cost: ReturnType<typeof parseManaString>,
  def: CardDefinition,
  targets?: string[],
): ReturnType<typeof parseManaString> {
  const asThoughFlashSurcharge = getAsThoughFlashSurcharge(state, playerId, def);
  const increasedCost = {
    ...cost,
    generic: cost.generic + getCostIncrease(state, playerId, def) + asThoughFlashSurcharge
      + getSpellCostTaxIncrease(state, playerId),
  };
  const rawReduction = getCostReduction(state, playerId, def) + getIntrinsicCostReduction(state, playerId, def, targets);

  // Form 32 clamp: "this effect can't reduce the cost to less than one mana"
  // (Valiant Changeling, etc.) — if the spell's oracle text has this rider,
  // ensure at least one mana remains in the total cost after reduction.
  // Colored pips (W/U/B/R/G) are never reduced, so they already serve as the
  // minimum when present. The clamp only bites when the generic cost alone
  // would reach 0 and there are no colored pips (pure-generic spells like {6}).
  let maxReduction = increasedCost.generic;
  if (CANT_REDUCE_BELOW_ONE_MANA_RE.test(def.oracle_text || '')) {
    const coloredPips = (increasedCost.W ?? 0) + (increasedCost.U ?? 0) +
      (increasedCost.B ?? 0) + (increasedCost.R ?? 0) + (increasedCost.G ?? 0);
    if (coloredPips === 0) {
      // No colored pips: generic must stay at least 1
      maxReduction = Math.max(0, increasedCost.generic - 1);
    }
    // With colored pips: the minimum total mana is already satisfied by those
    // pips, so generic CAN go to 0 — no additional restriction needed.
  }

  const reduction = Math.min(maxReduction, rawReduction);
  return reduction > 0 ? { ...increasedCost, generic: increasedCost.generic - reduction } : increasedCost;
}

function hasCantBeCounteredText(text: string): boolean {
  return /\b(?:can'?t|cannot)\s+be\s+countered\b/i.test(text);
}

/**
 * Parse the spell's own oracle text once (cached per invocation in the
 * hot-path since parseOracleText is inexpensive for these short texts) and
 * return true when the spell carries an "as though it had flash" grant whose
 * optional condition (Ferocious-style) is satisfied.
 *
 * The surcharge form ("if you pay {N} more to cast it") is permitted here —
 * whether the player can afford the surcharge is checked separately via
 * getEffectiveCastCost which calls getAsThoughFlashSurcharge.
 *
 * HONESTY: only the three verified oracle shapes recognised by matchAsThoughFlash
 * (bare, pay-more rider, Ferocious condition) are claimed; all other forms
 * remain instant-or-sorcery-speed only.
 */
function hasAsThoughFlash(
  state: GameState,
  playerId: string,
  def: CardDefinition,
): boolean {
  // SHAPE 1–4: spell carries its own as-though-flash grant (selfOnly static).
  const parsed = parseOracleText(def.oracle_text, def.mana_cost);
  if (parsed.kind === 'StaticAbility' && parsed.ability.modifier.kind === 'AsThoughFlash') {
    const mod = parsed.ability.modifier;
    // Self-oracle grants have no typeFilter. Skip ones that do (shouldn't
    // happen from matchAsThoughFlash, but guard defensively).
    if (!mod.typeFilter) {
      if (parsed.ability.condition) {
        return evaluateCondition(state, parsed.ability.condition, playerId);
      }
      return true;
    }
  }

  // SHAPE 5 (Slice 9): type-filtered battlefield static registered via
  // registerContinuousAbilitiesForPermanent (Vivien, Prophet of Kruphix,
  // Sigarda's Aid, Quick Sliver, Rootwater Shaman, …).
  // Scan continuousEffects for AsThoughFlash modifiers with typeFilter set.
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  for (const effect of (state.continuousEffects ?? [])) {
    const mod = effect.ability.modifier;
    if (mod.kind !== 'AsThoughFlash') continue;
    if (!mod.typeFilter) continue; // self-oracle form — handled above
    if (effect.ability.selfOnly) continue; // should never be true for type-filtered form

    // Check that the source permanent is still on the battlefield.
    const source = state.cards.get(effect.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;

    // controller matching:
    //   'you'  → only the permanent's controller can use the grant
    //   'any'  → any player (Vernal Equinox, Quick Sliver)
    //   'opponent' → opponents only (unusual; skip)
    if (effect.ability.controller === 'you' && effect.controllerId !== playerId) continue;
    if (effect.ability.controller === 'opponent' && effect.controllerId === playerId) continue;

    // Conditional gate (e.g. Ferocious prefix — unlikely for this shape but guard).
    if (effect.ability.condition) {
      if (!evaluateCondition(state, effect.ability.condition, effect.controllerId, effect.sourceInstanceId)) continue;
    }

    // Check that the spell being cast matches the type filter.
    if (matchesCardFilter(def, mod.typeFilter)) return true;
  }

  return false;
}

/**
 * Return the generic surcharge (in generic mana pips) imposed by the
 * "if you pay {N} more to cast it" rider, but ONLY when the spell is being
 * cast at instant speed (i.e. the sorcery-speed window is NOT open for the
 * player). Returns 0 if: the spell has no surcharge, the player is casting at
 * sorcery speed, or hasAsThoughFlash would return false.
 */
function getAsThoughFlashSurcharge(
  state: GameState,
  playerId: string,
  def: CardDefinition,
): number {
  const parsed = parseOracleText(def.oracle_text, def.mana_cost);
  if (parsed.kind !== 'StaticAbility') return 0;
  if (parsed.ability.modifier.kind !== 'AsThoughFlash') return 0;
  const surcharge = parsed.ability.modifier.surcharge;
  if (!surcharge) return 0;

  // Surcharge only applies when cast at instant speed (outside sorcery window).
  const isInstant = def.card_types.includes('instant');
  const hasFlashKw = def.keywords.includes('Flash');
  if (isInstant || hasFlashKw) return 0; // already instant-speed; surcharge irrelevant

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const isInSorceryWindow =
    state.activePlayerIndex === playerIndex &&
    MAIN_PHASES.includes(state.phase) &&
    state.stack.length === 0;

  // If in sorcery window, the player is NOT using the flash grant — no surcharge.
  return isInSorceryWindow ? 0 : surcharge;
}

/**
 * Slice 11: Returns true when the spell carries the flash-window cleanup-sacrifice
 * rider ("If you cast it any time a sorcery couldn't have been cast, the controller
 * of the permanent it becomes sacrifices it at the beginning of the next cleanup
 * step.") AND the current cast is outside the sorcery window (i.e. used the flash
 * grant). Used at cast time to set `castAtInstantSpeed` on the stack item.
 */
function spellUsedFlashWindowForCleanupRider(
  state: GameState,
  playerId: string,
  def: CardDefinition,
): boolean {
  const parsed = parseOracleText(def.oracle_text, def.mana_cost);
  if (parsed.kind !== 'StaticAbility') return false;
  if (parsed.ability.modifier.kind !== 'AsThoughFlash') return false;
  if (!parsed.ability.modifier.sacrificeAtCleanupIfFlashCast) return false;

  // Only flag if cast at instant speed (outside the sorcery window).
  const isInstant = def.card_types.includes('instant');
  const hasFlashKw = def.keywords.includes('Flash');
  if (isInstant || hasFlashKw) return false;

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const isInSorceryWindow =
    state.activePlayerIndex === playerIndex &&
    MAIN_PHASES.includes(state.phase) &&
    state.stack.length === 0;
  return !isInSorceryWindow;
}

function paymentMakesSpellUncounterable(
  state: GameState,
  usedRestrictedMana: ReturnType<typeof getSpellPaymentRestrictedMana>,
): boolean {
  return usedRestrictedMana.some(mana => {
    if (!mana.sourceInstanceId) return false;
    const source = state.cards.get(mana.sourceInstanceId);
    if (!source) return false;
    const sourceDef = getCardDefinition(state, source);
    return hasCantBeCounteredText(sourceDef.oracle_text);
  });
}

function isInstantOrSorcery(def: CardDefinition): boolean {
  return def.card_types.includes('instant') || def.card_types.includes('sorcery');
}

function isRedInstantOrSorcery(def: CardDefinition): boolean {
  return isInstantOrSorcery(def) && def.colors.includes('R');
}

function hasStorm(def: CardDefinition): boolean {
  return /\bstorm\b/i.test(def.oracle_text);
}

function hasProwess(def: CardDefinition): boolean {
  return def.keywords.some(keyword => keyword.toLowerCase() === 'prowess')
    || /(^|\n)\s*prowess\b/i.test(def.oracle_text);
}

function hasMentor(def: CardDefinition): boolean {
  return def.keywords.some(keyword => keyword.toLowerCase() === 'mentor')
    || /(^|\n)\s*mentor\b/i.test(def.oracle_text);
}

function parseSmallCounterCount(raw: string): number | null {
  const normalized = raw.toLowerCase();
  if (normalized === 'a' || normalized === 'an') return 1;
  const numeric = parseInt(normalized, 10);
  if (!Number.isNaN(numeric)) return numeric;
  const words: Record<string, number> = {
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
  return words[normalized] ?? null;
}

function entersWithCounters(
  oracleText: string,
  xValue?: number,
): Array<{ counterType: string; count: number }> {
  const counters: Array<{ counterType: string; count: number }> = [];
  for (const rawLine of oracleText.split('\n')) {
    const line = rawLine.trim();
    // The count may be a word/number or "x", optionally followed by "additional"
    // (e.g. "enters with an additional +1/+1 counter on it"). "x" only applies
    // when we know the resolved X (an {X}-cost spell); otherwise it is skipped.
    //
    // Slice 5 companion fix: tighten the regex with a sentence-end anchor so
    // conditional forms like "enters with four +1/+1 counters on it if a creature
    // died this turn" (Morbid) are NOT matched — without an anchor the old regex
    // would match the counter-word in the middle of such lines and apply counters
    // unconditionally at runtime, contradicting the conditional oracle text.
    // The accepted tail after "counter[s]" is: optional "on it/on ~", then only
    // whitespace / punctuation (period, comma, closing parenthesis).
    const match = line.match(/\benters(?: the battlefield)? with (a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+)(?: additional)? ([+\-]\d+\/[+\-]\d+|[a-z]+(?: [a-z]+)?) counters?(?:\s+on\s+(?:it|~|this\s+\w+))?\s*[.,)]*\s*$/i);
    if (!match) continue;
    const rawCount = match[1]?.toLowerCase();
    let count: number | null;
    if (rawCount === 'x') {
      if (xValue === undefined) continue;
      count = xValue;
    } else {
      count = parseSmallCounterCount(rawCount!);
    }
    const counterType = match[2]?.toLowerCase();
    if (count === null || count === undefined || count <= 0 || !counterType) continue;
    counters.push({ counterType, count });
  }
  return counters;
}

/**
 * Exported thin wrapper for testing — returns the same result as the internal
 * entersWithCounters so tests can verify the tightened regex rejects conditional
 * forms without needing a full stack setup.
 * @internal — for test use only
 */
export function getEntersWithCountersForTest(
  oracleText: string,
  xValue?: number,
): Array<{ counterType: string; count: number }> {
  return entersWithCounters(oracleText, xValue);
}

/**
 * Slice 2: Exported thin wrapper for testing — calls entersWithCountersConditional
 * with the provided game state so tests can verify conditional ETB counter logic
 * without needing a full stack setup.
 * @internal — for test use only
 */
export function getEntersWithCountersConditionalForTest(
  oracleText: string,
  state: GameState,
  ownerId: string,
): Array<{ counterType: string; count: number }> {
  return entersWithCountersConditional(oracleText, state, ownerId);
}

/**
 * Detect "enters [the battlefield] with X <type> counter[s] [on it], where X is
 * <amount>" lines in the oracle text (slice-6/11 dynamic form).
 * Returns a list of { counterType, whereXTokens, whereXAt } entries to be resolved
 * at entry time. Complements entersWithCounters which handles fixed and {X}-cost
 * forms only. Supports ForEach (number-of), LifeTotal (your life total), and
 * GreatestManaValue (greatest mana value among ... in exile) amounts.
 */
function entersWithCountersDynamic(
  oracleText: string,
): Array<{ counterType: string; whereXTokens: string[]; whereXAt: number }> {
  const results: Array<{ counterType: string; whereXTokens: string[]; whereXAt: number }> = [];
  for (const rawLine of oracleText.split('\n')) {
    const line = rawLine.trim();

    // ── Path A: "enters ... with X ... counter[s] ... where X is" form ──────
    if (/\benters(?: the battlefield)? with x\b/i.test(line) && /\bwhere x is\b/i.test(line)) {
      // Tokenize the line and locate the counter type using the same logic as the matcher
      const tokens = tokenizeOracleText(line);
      let i = 0;
      // Skip subject prefix (up to 3 tokens before "enters")
      while (i < 3 && tokens[i] && tokens[i] !== 'enters') i++;
      if (tokens[i] !== 'enters') continue;
      i++;
      if (tokens[i] === 'the' && tokens[i + 1] === 'battlefield') i += 2;
      if (tokens[i] !== 'with') continue;
      i++;
      if (tokens[i] === 'an' && tokens[i + 1] === 'additional') i += 2;
      if (tokens[i] !== 'x') continue;
      i++;
      // Read counter type label (single or two-word like "first strike")
      let counterType: string;
      if ((tokens[i] === 'first' || tokens[i] === 'double') && tokens[i + 1] === 'strike') {
        counterType = `${tokens[i]} strike`;
        i += 2;
      } else if (tokens[i]) {
        counterType = tokens[i];
        i++;
      } else {
        continue;
      }
      if (tokens[i] !== 'counter' && tokens[i] !== 'counters') continue;
      i++;
      // Skip "on it" / "on ~" / "on this <word>"
      if (tokens[i] === 'on') {
        i++;
        if (tokens[i] === 'it' || tokens[i] === '~') i++;
        else if (tokens[i] === 'this') { i++; if (tokens[i]) i++; }
      }
      // The rest of the token list contains the "where x is ..." clause — pass the
      // entire token list and current position to parseWhereXIsAnyAmount (it skips
      // optional leading comma). Supports ForEach, LifeTotal, and GreatestManaValue.
      results.push({ counterType, whereXTokens: tokens, whereXAt: i });
      continue;
    }

    // ── Path B: "enters ... with a/N <type> counter[s] ... for each <filter> <zone>" ──
    // Slice 11: dynamic for-each form. Only "a"/"an" (count=1) per-iteration is handled
    // (N>1 per iteration is not yet expressible via AmountRef without a ForEachMultiplied kind).
    if (!/\benters(?: the battlefield)? with (?:a|an|\d+)\b/i.test(line)) continue;
    if (!/\bfor each\b/i.test(line)) continue;
    // The line must NOT also contain "where x is" (that would be the Path A form).
    if (/\bwhere x is\b/i.test(line)) continue;
    {
      const tokens = tokenizeOracleText(line);
      let i = 0;
      // Skip subject prefix
      while (i < 3 && tokens[i] && tokens[i] !== 'enters') i++;
      if (tokens[i] !== 'enters') continue;
      i++;
      if (tokens[i] === 'the' && tokens[i + 1] === 'battlefield') i += 2;
      if (tokens[i] !== 'with') continue;
      i++;
      if (tokens[i] === 'an' && tokens[i + 1] === 'additional') i += 2;
      // Must be "a" or "an" (count=1 per iteration) or a small number
      const rawCount = tokens[i];
      if (rawCount !== 'a' && rawCount !== 'an') continue; // restrict to count=1 for now
      i++;
      // Read counter type label
      let counterType: string;
      if ((tokens[i] === 'first' || tokens[i] === 'double') && tokens[i + 1] === 'strike') {
        counterType = `${tokens[i]} strike`;
        i += 2;
      } else if (tokens[i]) {
        counterType = tokens[i];
        i++;
      } else {
        continue;
      }
      if (tokens[i] !== 'counter' && tokens[i] !== 'counters') continue;
      i++;
      // Skip "on it" / "on ~" / "on this <word>"
      if (tokens[i] === 'on') {
        i++;
        if (tokens[i] === 'it' || tokens[i] === '~') i++;
        else if (tokens[i] === 'this') { i++; if (tokens[i]) i++; }
      }
      // Optional comma
      if (tokens[i] === ',') i++;
      // Must be "for each"
      if (tokens[i] !== 'for' || tokens[i + 1] !== 'each') continue;
      i += 2; // skip "for each"

      // ── Slice 4: "for each [other] spell[s] cast this turn" ────────────────
      // Storm Entity family: resolved via state.spellsCastThisTurn at ETB time.
      // Build synthetic whereXTokens for parseWhereXIsAnyAmount Form 2b.
      {
        let si = i;
        const excludeSelf = tokens[si] === 'other';
        if (excludeSelf) si++;
        if (
          (tokens[si] === 'spell' || tokens[si] === 'spells') &&
          tokens[si + 1] === 'cast' &&
          tokens[si + 2] === 'this' &&
          tokens[si + 3] === 'turn'
        ) {
          // Emit synthetic "where x is the number of [other] spell[s] cast this turn"
          const spellWord = tokens[si];
          const whereXTokens = [
            'where', 'x', 'is', 'the', 'number', 'of',
            ...(excludeSelf ? ['other'] : []),
            spellWord, 'cast', 'this', 'turn',
          ];
          results.push({ counterType, whereXTokens, whereXAt: 0 });
          continue;
        }
      }

      // ── Default: "for each <filter> <zone>" → parseNumberOfFilterAmount ────
      // Normalize "for each <filter> <zone>" → "where x is the number of <filter> <zone>"
      // by constructing synthetic tokens and using parseNumberOfFilterAmount at position 0.
      const syntheticTokens = ['the', 'number', 'of', ...tokens.slice(i)];
      const forEachResult = parseNumberOfFilterAmount(syntheticTokens, 0);
      if (!forEachResult) continue;
      // Reconstruct the whereXTokens as the synthetic "where x is <the number of ...>" stream
      // so applyEntersWithCounters can call parseWhereXIsAnyAmount on it uniformly.
      const whereXTokens = ['where', 'x', 'is', ...syntheticTokens];
      // whereXAt points to "where" (index 0) — parseWhereXIsAnyAmount will skip the header.
      results.push({ counterType, whereXTokens, whereXAt: 0 });
    }

    // ── Path C: "enters ... with a number of <type> counter[s] ... equal to the number of <filter> <zone>" ──
    // Slice 5/12: Undergrowth Scavenger / Rhizome Lurcher family.
    // Semantically identical to Path B "for each" but spelled as "equal to the number of".
    // The regex matches "enters [the battlefield] with a number of" and requires "equal to the number of".
    if (!/\benters(?: the battlefield)? with a number of\b/i.test(line)) continue;
    if (!/\bequal to the number of\b/i.test(line)) continue;
    {
      const tokens = tokenizeOracleText(line);
      let i = 0;
      // Skip subject prefix (up to 3 tokens before "enters")
      const ABILITY_WORD_SPLIT = /^[A-Za-z][A-Za-z0-9\s]*[—–]\s*/;
      const lineStripped = line.replace(ABILITY_WORD_SPLIT, '');
      const tokensStripped = tokenizeOracleText(lineStripped);
      let ti = 0;
      while (ti < 3 && tokensStripped[ti] && tokensStripped[ti] !== 'enters') ti++;
      if (tokensStripped[ti] !== 'enters') continue;
      ti++;
      if (tokensStripped[ti] === 'the' && tokensStripped[ti + 1] === 'battlefield') ti += 2;
      if (tokensStripped[ti] !== 'with') continue;
      ti++;
      // Optional "an additional"
      if (tokensStripped[ti] === 'an' && tokensStripped[ti + 1] === 'additional') ti += 2;
      // Must be "a number of"
      if (tokensStripped[ti] !== 'a' || tokensStripped[ti + 1] !== 'number' || tokensStripped[ti + 2] !== 'of') continue;
      ti += 3;
      // Optional "additional" after "a number of"
      if (tokensStripped[ti] === 'additional') ti++;
      // Read counter type label
      let counterType: string;
      if ((tokensStripped[ti] === 'first' || tokensStripped[ti] === 'double') && tokensStripped[ti + 1] === 'strike') {
        counterType = `${tokensStripped[ti]} strike`;
        ti += 2;
      } else if (tokensStripped[ti]) {
        counterType = tokensStripped[ti];
        ti++;
      } else {
        continue;
      }
      if (tokensStripped[ti] !== 'counter' && tokensStripped[ti] !== 'counters') continue;
      ti++;
      // Skip "on it" / "on ~" / "on this <word>"
      if (tokensStripped[ti] === 'on') {
        ti++;
        if (tokensStripped[ti] === 'it' || tokensStripped[ti] === '~') ti++;
        else if (tokensStripped[ti] === 'this') { ti++; if (tokensStripped[ti]) ti++; }
      }
      // Must be "equal to"
      if (tokensStripped[ti] !== 'equal' || tokensStripped[ti + 1] !== 'to') continue;
      ti += 2;
      // "the number of <filter> <zone>" — use parseNumberOfFilterAmount
      const syntheticTokens = tokensStripped.slice(ti);
      const equalToResult = parseNumberOfFilterAmount(syntheticTokens, 0);
      if (!equalToResult) continue;
      // Normalize to "where x is <the number of ...>" stream for uniform applyEntersWithCounters path
      const whereXTokens = ['where', 'x', 'is', ...syntheticTokens];
      results.push({ counterType, whereXTokens, whereXAt: 0 });
    }
  }
  return results;
}

/**
 * Slice 2: Detect "enters with N <type> counter[s] [on it] if <this-turn-condition>"
 * lines in the oracle text and evaluate the condition against the current game state.
 *
 * Supported conditions (both have first-class trackers in GameState):
 *   • "a creature died this turn"  → state.creaturesDiedThisTurn > 0
 *   • "you attacked this turn"     → state.playersWhoAttackedThisTurn.includes(ownerId)
 *
 * Optional leading ability-word prefixes (Morbid —, Raid —, etc.) are stripped
 * before matching. Returns an array of { counterType, count } when the condition
 * is satisfied, or an empty array otherwise.
 */
function entersWithCountersConditional(
  oracleText: string,
  state: GameState,
  ownerId: string,
): Array<{ counterType: string; count: number }> {
  const ABILITY_WORD_PREFIX_RE = /^[A-Za-z][A-Za-z0-9\s]*[—–]\s*/;
  // Counter-count words (same set as entersWithCounters)
  function parseSmallCounterCountLocal(token: string): number | null {
    const map: Record<string, number> = {
      a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };
    if (token in map) return map[token];
    const n = parseInt(token, 10);
    return isNaN(n) ? null : n;
  }

  const results: Array<{ counterType: string; count: number }> = [];
  for (const rawLine of oracleText.split('\n')) {
    const rawTrimmed = rawLine.trim();
    if (!rawTrimmed) continue;
    // Strip optional ability-word prefix.
    const line = rawTrimmed.replace(ABILITY_WORD_PREFIX_RE, '');

    // Quick pre-filter: must contain "enters" and "if"
    if (!/\benters\b/i.test(line) || !/\bif\b/i.test(line)) continue;
    // Must NOT have "for each" or "where x is" (those are different paths)
    if (/\bfor\s+each\b|\bwhere\s+x\s+is\b/i.test(line)) continue;

    // Determine which condition applies (if any).
    let conditionMet: boolean | null = null;
    if (/\bif\s+a\s+creature\s+died\s+this\s+turn\b/i.test(line)) {
      conditionMet = (state.creaturesDiedThisTurn ?? 0) > 0;
    } else if (/\bif\s+you\s+attacked\s+this\s+turn\b/i.test(line)) {
      const attacked = new Set(state.playersWhoAttackedThisTurn ?? []);
      conditionMet = attacked.has(ownerId);
    }
    // Decline any other condition (no tracker → honest skip).
    if (conditionMet === null || !conditionMet) continue;

    // Parse the counter type and count from the "enters with <N> <type> counter[s]" part.
    // We strip the "if <cond>" tail first, then apply the same regex as entersWithCounters.
    const bodyPart = line.replace(/\s+if\s+.+$/i, '');
    const match = bodyPart.match(
      /\benters?(?:\s+the\s+battlefield)?\s+with\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s+additional)?\s+([+\-]\d+\/[+\-]\d+|[a-z]+(?:\s+[a-z]+)?)\s+counters?(?:\s+on\s+(?:it|~|this\s+\w+))?\s*[.,)]*\s*$/i,
    );
    if (!match) continue;
    const rawCount = match[1]?.toLowerCase() ?? '';
    const count = parseSmallCounterCountLocal(rawCount);
    const counterType = match[2]?.toLowerCase() ?? '';
    if (count === null || count <= 0 || !counterType) continue;
    results.push({ counterType, count });
  }
  return results;
}

function applyEntersWithCounters(state: GameState, instanceId: string, def: CardDefinition, xValue?: number): GameState {
  const card = state.cards.get(instanceId);
  if (!card || card.zone !== 'battlefield') return state;

  const staticCounters = entersWithCounters(def.oracle_text, xValue);
  const dynamicCounters = entersWithCountersDynamic(def.oracle_text);
  const conditionalCounters = entersWithCountersConditional(def.oracle_text, state, card.ownerId);

  if (staticCounters.length === 0 && dynamicCounters.length === 0 && conditionalCounters.length === 0) return state;

  const nextCounters = { ...card.counters };
  for (const counter of staticCounters) {
    nextCounters[counter.counterType] = (nextCounters[counter.counterType] || 0) + counter.count;
  }
  for (const cond of conditionalCounters) {
    nextCounters[cond.counterType] = (nextCounters[cond.counterType] || 0) + cond.count;
  }
  for (const dyn of dynamicCounters) {
    const whereResult = parseWhereXIsAnyAmount(dyn.whereXTokens, dyn.whereXAt);
    if (!whereResult) continue;
    const amount = whereResult.amount;
    let n: number;
    if (amount && typeof amount === 'object' && 'kind' in amount && amount.kind === 'ForEach') {
      n = evaluateForEachAmount(amount, state, card.ownerId);
    } else if (amount && typeof amount === 'object' && 'kind' in amount && amount.kind === 'GreatestManaValue') {
      // Resolve GreatestManaValue (e.g. greatest mana value among cards in exile)
      let greatest = 0;
      for (const [, c] of state.cards) {
        if (c.zone !== amount.zone) continue;
        const d = getCardDefinition(state, c);
        greatest = Math.max(greatest, d.cmc ?? 0);
      }
      n = greatest;
    } else if (amount && typeof amount === 'object' && 'kind' in amount && amount.kind === 'LifeTotal') {
      // Resolve LifeTotal (e.g. your life total)
      const player = state.players.find(p => p.id === card.ownerId);
      n = player?.life ?? 0;
    } else if (amount && typeof amount === 'object' && 'kind' in amount && amount.kind === 'MVSum') {
      // Slice 10: Resolve MVSum — sum of cmc of all matching cards in zone
      const mvSumAmount = amount as MVSumAmount;
      let total = 0;
      for (const [, c] of state.cards) {
        if (c.zone !== mvSumAmount.zone) continue;
        const ownerMatches =
          mvSumAmount.controller === 'each' ||
          (mvSumAmount.controller === 'you' && c.ownerId === card.ownerId) ||
          (mvSumAmount.controller === 'opponent' && c.ownerId !== card.ownerId);
        if (!ownerMatches) continue;
        const d = getCardDefinition(state, c);
        if (mvSumAmount.filter && !matchesCardFilter(d, mvSumAmount.filter)) continue;
        total += d.cmc ?? 0;
      }
      n = total;
    } else if (amount && typeof amount === 'object' && 'kind' in amount && amount.kind === 'SpellsCastThisTurn') {
      // Slice 4: Storm Entity — "for each [other] spell cast this turn."
      // state.spellsCastThisTurn was already incremented when the spell was cast;
      // excludeSelf=true means the Storm Entity itself is not counted as "other".
      const total = state.spellsCastThisTurn ?? 0;
      n = amount.excludeSelf ? Math.max(0, total - 1) : total;
    } else {
      continue;
    }
    if (n <= 0) continue;
    nextCounters[dyn.counterType] = (nextCounters[dyn.counterType] || 0) + n;
  }

  const cards = new Map(state.cards);
  cards.set(instanceId, { ...card, counters: nextCounters });
  return { ...state, cards };
}

function hasPrintedCascade(def: CardDefinition): boolean {
  return /(^|\n)\s*cascade\b/i.test(def.oracle_text);
}

function permanentGrantsCascadeFromHand(state: GameState, playerId: string, def: CardDefinition, stackItem: SpellStackItem): boolean {
  if (stackItem.castFromZone !== 'hand') return false;
  if (!isInstantOrSorcery(def)) return false;

  for (const card of state.cards.values()) {
    if (card.zone !== 'battlefield' || card.ownerId !== playerId) continue;
    const permanentDef = getCardDefinition(state, card);
    if (/instant and sorcery spells you cast from your hand have cascade/i.test(permanentDef.oracle_text)) {
      return true;
    }
  }
  return false;
}

function cascadeInstanceCount(state: GameState, playerId: string, def: CardDefinition, stackItem: SpellStackItem): number {
  let count = 0;
  if (hasPrintedCascade(def)) count++;
  if (permanentGrantsCascadeFromHand(state, playerId, def, stackItem)) count++;
  return count;
}

function moveCardsToLibraryBottom(state: GameState, playerId: string, cardIds: string[]): GameState {
  if (cardIds.length === 0) return state;
  const moving = cardIds
    .map(id => state.cards.get(id))
    .filter((card): card is CardInstance => !!card);
  if (moving.length === 0) return state;

  const newCards = new Map<string, CardInstance>();
  for (const [id, card] of state.cards) {
    if (!cardIds.includes(id)) {
      newCards.set(id, card);
    }
  }
  for (const card of moving) {
    newCards.set(card.instanceId, {
      ...card,
      ownerId: playerId,
      zone: 'library',
      tapped: false,
      damage: 0,
      summoningSick: false,
    });
  }
  return { ...state, cards: newCards };
}

function castCascadeHitWithoutPaying(
  state: GameState,
  playerId: string,
  sourceManaValue: number,
): GameState {
  const libraryCards = [...state.cards.values()].filter(card => card.ownerId === playerId && card.zone === 'library');
  const revealedIds: string[] = [];
  let hit: CardInstance | undefined;
  let hitDef: CardDefinition | undefined;

  for (const card of libraryCards) {
    revealedIds.push(card.instanceId);
    const def = getCardDefinition(state, card);
    if (!def.card_types.includes('land') && def.cmc < sourceManaValue) {
      hit = card;
      hitDef = def;
      break;
    }
  }

  if (!hit || !hitDef) {
    const exiledAll = new Map(state.cards);
    for (const id of revealedIds) {
      const card = exiledAll.get(id);
      if (card) exiledAll.set(id, { ...card, zone: 'exile' });
    }
    return moveCardsToLibraryBottom({ ...state, cards: exiledAll }, playerId, revealedIds);
  }

  const newCards = new Map(state.cards);
  for (const id of revealedIds) {
    const card = newCards.get(id);
    if (card) newCards.set(id, { ...card, zone: 'exile' });
  }
  newCards.set(hit.instanceId, { ...hit, zone: 'stack' });

  const stackItem: SpellStackItem = {
    kind: 'Spell',
    id: nextStackObjectId(state),
    cardInstanceId: hit.instanceId,
    casterId: playerId,
    targets: [],
    castFromZone: 'exile',
    ...(hasCantBeCounteredText(hitDef.oracle_text) ? { cantBeCountered: true } : {}),
  };

  let resultState: GameState = {
    ...state,
    cards: newCards,
    stack: [...state.stack, stackItem],
    spellsCastThisTurn: (state.spellsCastThisTurn ?? 0) + 1,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };

  resultState = moveCardsToLibraryBottom(
    resultState,
    playerId,
    revealedIds.filter(id => id !== hit!.instanceId),
  );

  resultState = checkTriggersForEvent(resultState, {
    kind: 'SpellCast',
    casterId: playerId,
    cardInstanceId: hit.instanceId,
  });

  const nestedCascadeCount = cascadeInstanceCount(resultState, playerId, hitDef, stackItem);
  for (let i = 0; i < nestedCascadeCount; i++) {
    resultState = castCascadeHitWithoutPaying(resultState, playerId, hitDef.cmc);
  }

  return resultState;
}

function applyCascadeForSpell(state: GameState, playerId: string, def: CardDefinition, stackItem: SpellStackItem): GameState {
  let resultState = state;
  const count = cascadeInstanceCount(resultState, playerId, def, stackItem);
  for (let i = 0; i < count; i++) {
    resultState = castCascadeHitWithoutPaying(resultState, playerId, def.cmc);
  }
  return resultState;
}

function findSpellStackItem(state: GameState, id: string): SpellStackItem | undefined {
  return state.stack.find(item =>
    isSpellStackItem(item) && (item.id === id || item.cardInstanceId === id)
  ) as SpellStackItem | undefined;
}

function getStackSpellDefinition(state: GameState, item: SpellStackItem): CardDefinition | null {
  return getCastSpellDefinition(state, item.cardInstanceId, { faceName: item.faceName });
}

function createSpellCopyOnStack(
  state: GameState,
  sourceItem: SpellStackItem,
  controllerId: string,
  targets: string[] = sourceItem.targets,
): GameState {
  const copyItem: SpellStackItem = {
    ...sourceItem,
    id: nextStackObjectId(state),
    casterId: controllerId,
    targets: [...targets],
    isCopy: true,
    copyOfCardInstanceId: sourceItem.copyOfCardInstanceId || sourceItem.cardInstanceId,
  };

  let resultState: GameState = {
    ...state,
    stack: [...state.stack, copyItem],
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };

  resultState = checkTriggersForEvent(resultState, {
    kind: 'SpellCopied',
    controllerId,
    cardInstanceId: sourceItem.cardInstanceId,
  });

  return resultState;
}

function resolveCopySpellTargetId(
  effect: Extract<Effect, { kind: 'CopySpell' }>,
  targets: string[],
  targetSpecs: TargetSpec[],
  eventContext?: { casterId?: string; cardInstanceId?: string },
): string | null {
  const targetRef = effect.target;
  if (targetRef.kind === 'EventSpell') return eventContext?.cardInstanceId || null;
  if (targetRef.kind !== 'Chosen') return null;
  const targetIndex = targetSpecs.findIndex(spec => spec.id === targetRef.targetId);
  if (targetIndex < 0) return null;
  return targets[targetIndex] || null;
}

function applyCopySpellEffects(
  state: GameState,
  effects: Effect[],
  casterId: string,
  targets: string[],
  targetSpecs: TargetSpec[],
  eventContext?: { casterId?: string; cardInstanceId?: string },
): GameState {
  let resultState = state;
  for (const effect of effects) {
    if (effect.kind !== 'CopySpell') continue;

    const targetId = resolveCopySpellTargetId(effect, targets, targetSpecs, eventContext);
    if (!targetId) continue;

    const targetItem = findSpellStackItem(resultState, targetId);
    if (!targetItem) continue;
    const targetCard = resultState.cards.get(targetItem.cardInstanceId);
    const targetDef = targetCard ? getStackSpellDefinition(resultState, targetItem) : undefined;
    if (!targetDef) continue;
    if (effect.maxManaValue !== undefined && targetDef.cmc > effect.maxManaValue) continue;

    resultState = createSpellCopyOnStack(resultState, targetItem, casterId, targetItem.targets);
  }
  return resultState;
}

function checkCardDrawTriggersForTransition(before: GameState, after: GameState): GameState {
  const drawnByPlayer = new Map<string, string[]>();
  after.cards.forEach((afterCard, instanceId) => {
    const beforeCard = before.cards.get(instanceId);
    if (!beforeCard) return;
    if (beforeCard.zone !== 'library' || afterCard.zone !== 'hand') return;
    if (beforeCard.ownerId !== afterCard.ownerId) return;
    const drawn = drawnByPlayer.get(afterCard.ownerId) || [];
    drawn.push(instanceId);
    drawnByPlayer.set(afterCard.ownerId, drawn);
  });

  let resultState = after;
  for (const [playerId, cardInstanceIds] of drawnByPlayer) {
    if (cardInstanceIds.length === 0) continue;
    resultState = checkTriggersForEvent(resultState, {
      kind: 'CardDrawn',
      playerId,
      count: cardInstanceIds.length,
      cardInstanceIds,
    });
  }
  return resultState;
}

function executeSpellEffectsWithCopySupport(
  state: GameState,
  effects: Effect[],
  casterId: string,
  targets: string[],
  targetSpecs: TargetSpec[],
  sourceInstanceId: string,
  namedCardChoices?: Record<string, string>,
  eventContext?: { casterId?: string; cardInstanceId?: string; eventPlayerId?: string },
  xValue: number = 0,
): GameState {
  const executableEffects = effects.filter(effect => effect.kind !== 'CopySpell');
  let resultState = state;

  if (executableEffects.length > 0) {
    const beforeEffects = resultState;
    resultState = executeEffectsWithSBA(
      resultState,
      executableEffects,
      casterId,
      targets,
      targetSpecs,
      xValue,
      { namedCardChoices, sourceInstanceId, eventContext },
    );
    resultState = checkCardDrawTriggersForTransition(beforeEffects, resultState);
  }

  resultState = applyCopySpellEffects(resultState, effects, casterId, targets, targetSpecs, eventContext);
  return executableEffects.length > 0 ? resultState : checkStateBasedActions(resultState);
}

function isLegalChromeMoxImprint(
  state: GameState,
  controllerId: string,
  sourceInstanceId: string,
  chosenCardId: string | undefined,
): chosenCardId is string {
  if (!chosenCardId || chosenCardId === sourceInstanceId) return false;
  const chosenCard = state.cards.get(chosenCardId);
  if (!chosenCard || chosenCard.ownerId !== controllerId || chosenCard.zone !== 'hand') return false;
  const chosenDef = getCardDefinition(state, chosenCard);
  return !chosenDef.card_types.includes('artifact') && !chosenDef.card_types.includes('land');
}

function isLegalMoxDiamondDiscard(
  state: GameState,
  controllerId: string,
  sourceInstanceId: string,
  chosenCardId: string | undefined,
): chosenCardId is string {
  if (!chosenCardId || chosenCardId === sourceInstanceId) return false;
  const chosenCard = state.cards.get(chosenCardId);
  if (!chosenCard || chosenCard.ownerId !== controllerId || chosenCard.zone !== 'hand') return false;
  const chosenDef = getCardDefinition(state, chosenCard);
  return chosenDef.card_types.includes('land');
}

function applyPermanentEntryChoices(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  spellItem: SpellStackItem,
  entersTapped: boolean,
  summoningSick: boolean,
): { cards: Map<string, CardInstance>; entered: boolean } {
  const cards = new Map(state.cards);
  const mergedChoices = mergeCardChoices(card.choices, spellItem.cardChoices);
  const auraTargetSpecs = getAuraTargetSpecs(def);

  if (auraTargetSpecs.length > 0) {
    try {
      validateTargetChoices(state, spellItem.casterId, auraTargetSpecs, spellItem.targets, spellItem.cardInstanceId);
    } catch {
      cards.set(card.instanceId, {
        ...card,
        zone: 'graveyard',
        tapped: false,
        damage: 0,
        summoningSick: true,
        choices: mergedChoices,
      });
      return { cards, entered: false };
    }
  }

  let enteringCard: CardInstance = {
    ...buildBattlefieldEntryPlan(state, spellItem.casterId, card, def, {
      defaultTapped: entersTapped,
      summoningSick,
      choices: mergedChoices,
    }).card,
    ...(auraTargetSpecs.length > 0 ? { attachedTo: spellItem.targets[0] } : {}),
  };

  if (isChromeMoxLike(def)) {
    const imprintId = mergedChoices?.imprintedCardIds?.[0];
    if (isLegalChromeMoxImprint(state, spellItem.casterId, card.instanceId, imprintId)) {
      const imprinted = state.cards.get(imprintId)!;
      cards.set(imprintId, {
        ...imprinted,
        zone: 'exile',
        tapped: false,
        damage: 0,
        summoningSick: true,
      });
      enteringCard = {
        ...enteringCard,
        choices: mergeCardChoices(enteringCard.choices, { imprintedCardIds: [imprintId] }),
      };
    } else {
      enteringCard = {
        ...enteringCard,
        choices: mergeCardChoices({
          chosenCreatureType: enteringCard.choices?.chosenCreatureType,
          discardedCardIds: enteringCard.choices?.discardedCardIds,
        }),
      };
    }
  }

  if (isMoxDiamondLike(def)) {
    const discardId = mergedChoices?.discardedCardIds?.[0];
    if (!isLegalMoxDiamondDiscard(state, spellItem.casterId, card.instanceId, discardId)) {
      cards.set(card.instanceId, {
        ...card,
        zone: 'graveyard',
        tapped: false,
        damage: 0,
        summoningSick: true,
        choices: undefined,
      });
      return { cards, entered: false };
    }

    const discarded = state.cards.get(discardId)!;
    cards.set(discardId, {
      ...discarded,
      zone: 'graveyard',
      tapped: false,
      damage: 0,
      summoningSick: true,
    });
    enteringCard = {
      ...enteringCard,
      choices: mergeCardChoices(enteringCard.choices, { discardedCardIds: [discardId] }),
    };
  }

  cards.set(card.instanceId, enteringCard);
  return { cards, entered: true };
}

function applyAttachedAuraEntryEffects(state: GameState, auraInstanceId: string): GameState {
  const aura = state.cards.get(auraInstanceId);
  if (!aura || aura.zone !== 'battlefield' || !aura.attachedTo) return state;
  const def = getCardDefinition(state, aura);
  if (!/\bwhen this aura enters\b/i.test(def.oracle_text)) return state;
  if (!/\btap enchanted creature\b/i.test(def.oracle_text)) return state;

  const enchanted = state.cards.get(aura.attachedTo);
  if (!enchanted || enchanted.zone !== 'battlefield') return state;

  const cards = new Map(state.cards);
  cards.set(enchanted.instanceId, { ...enchanted, tapped: true });
  return { ...state, cards };
}

/**
 * Strip keyword-ability name prefixes that decorate triggered abilities.
 * Cards like Omnath, Locus of Rage write "Landfall — Whenever a land you control enters, ...".
 * The parser only recognizes "Whenever ...", so we strip the leading "<KeywordName> — " on each line.
 *
 * Matches a leading capitalized word (optionally with internal hyphens, like "Jump-start")
 * optionally followed by 1-2 more lowercase words (e.g. "Devotion to red"), then an em-dash
 * (or en-dash / ASCII hyphen) surrounded by whitespace.
 */
function stripKeywordAbilityPrefix(oracleText: string): string {
  // Negative lookahead excludes "Choose " — that's a modal-spell delimiter, not a keyword ability.
  return oracleText.replace(
    /^(?!Choose\b)[A-Z][A-Za-z\-]*(?:\s+[a-z]+){0,2}\s+[—–-]\s+/gm,
    '',
  );
}

/**
 * Normalize oracle text for the parser by replacing the card's own name with '~'
 * and stripping keyword-ability prefixes the parser does not understand.
 * Scryfall oracle text uses the literal card name; the parser expects '~'.
 */
function normalizeOracleText(oracleText: string, cardName: string): string {
  let text = stripKeywordAbilityPrefix(oracleText);
  if (cardName) {
    const escaped = cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, 'gi'), '~');
    const shortName = cardName.split(',')[0]?.trim();
    if (shortName && shortName.length >= 3 && shortName !== cardName) {
      const escapedShort = shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`\\b${escapedShort}\\b`, 'gi'), '~');
    }
    // Slice 5 (Transform): double-faced cards have combined names like
    // "Front Face // Back Face". Oracle text for each face refers only to the
    // individual face name. Replace each face name individually so trigger text
    // such as "transform Growing Rites of Itlimoc" normalizes to "transform ~".
    if (cardName.includes(' // ')) {
      for (const faceName of cardName.split(' // ').map(s => s.trim())) {
        if (!faceName || faceName.length < 3 || faceName === cardName) continue;
        // Already replaced above? Skip to avoid double-~.
        if (text.includes('~') && !text.match(new RegExp(faceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))) continue;
        const escapedFace = faceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(escapedFace, 'gi'), '~');
        // Also the first-comma short name of each face (e.g. "Itlimoc" from "Itlimoc, Cradle of the Sun").
        const faceShort = faceName.split(',')[0]?.trim();
        if (faceShort && faceShort.length >= 3 && faceShort !== faceName) {
          const escapedFaceShort = faceShort.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          text = text.replace(new RegExp(`\\b${escapedFaceShort}\\b`, 'gi'), '~');
        }
      }
    }
  }
  return text;
}

function additionalStaticKeywordFromLine(line: string): string | null {
  // Slice 10: extend to also cover "and gain[s] <keyword>" compound static rider
  // (e.g. "Creatures you control get +1/+1 and gain vigilance." —
  // matchStaticAbility parses this as ModifyPT; this registers the GrantKeyword side-channel).
  // We only match the "and gain/gains/have/has <keyword>" tail that is NOT followed by
  // "until end of turn" (which would be a temporary combat-trick effect, not a static).
  const match = line.match(/\band\s+(?:have|has|gain|gains)\s+([^,.]+)/i);
  if (!match) return null;
  // Reject temporal riders: "and gain flying until end of turn" is a spell effect, not static.
  if (/\buntil\s+end\s+of\s+turn\b/i.test(match[0])) return null;
  const clause = match[1].toLowerCase();
  const keywords = [
    'double strike',
    'first strike',
    'deathtouch',
    'indestructible',
    'lifelink',
    'vigilance',
    'trample',
    'flying',
    'haste',
    'menace',
    'reach',
    'hexproof',
    'shroud',
    'ward',
  ];
  return keywords.find(keyword => new RegExp(`\\b${keyword}\\b`, 'i').test(clause)) ?? null;
}

export function registerContinuousAbilitiesForPermanent(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) return state;
  const def = getCardDefinition(state, card);

  let resultState = state;
  for (const line of def.oracle_text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const normalizedLine = normalizeOracleText(trimmed, def.name);
    const parsed = parseOracleText(normalizedLine);
    if (parsed.kind !== 'StaticAbility') continue;

    resultState = registerContinuousEffect(resultState, instanceId, card.ownerId, parsed.ability);

    if (parsed.ability.modifier.kind === 'ModifyPT') {
      const keyword = additionalStaticKeywordFromLine(normalizedLine);
      if (keyword) {
        const extraAbility: StaticAbilityEffect = {
          ...parsed.ability,
          modifier: { kind: 'GrantKeyword', keyword },
        };
        resultState = registerContinuousEffect(resultState, instanceId, card.ownerId, extraAbility);
      }
    }

    // Slice 9 (ControlEnchanted): "You control enchanted creature/permanent."
    // On Aura attach, transfer control of the enchanted permanent to the Aura's
    // controller. Store the original owner and the enchanted permanent's instanceId
    // in the Aura's choices so pruneDetachedEffects can precisely revert control
    // when the Aura leaves the battlefield.
    if (parsed.ability.modifier.kind === 'ControlEnchanted') {
      const currentCard = resultState.cards.get(instanceId);
      if (currentCard?.attachedTo) {
        const enchantedId = currentCard.attachedTo;
        const enchanted = resultState.cards.get(enchantedId);
        if (enchanted && enchanted.zone === 'battlefield') {
          const previousOwnerId = enchanted.ownerId;
          const newCards = new Map(resultState.cards);
          // Save original owner + stolen card's instanceId in Aura's choices for
          // the precise revert path in pruneDetachedEffects (game-state.ts).
          newCards.set(instanceId, {
            ...currentCard,
            choices: {
              ...currentCard.choices,
              previousEnchantedOwnerId: previousOwnerId,
              stolenPermanentId: enchantedId,
            },
          });
          // Transfer control of the enchanted permanent.
          newCards.set(enchantedId, { ...enchanted, ownerId: card.ownerId });
          resultState = { ...resultState, cards: newCards };
        }
      }
    }
  }

  return resultState;
}

/**
 * Slice 10: Return true when a turn-scoped Silence-style prohibition prevents
 * `playerId` from casting spells this turn.
 */
function isSpellCastProhibited(state: GameState, playerId: string): boolean {
  const prohibitions = state.spellCastProhibitions || [];
  return prohibitions.some(
    p => p.expiresAtTurnNumber >= state.turnNumber && p.prohibitedPlayerIds.includes(playerId),
  );
}

/**
 * Slice 4/CBC: Return true when a continuous OpponentsCantCastDuringYourTurn
 * static (Dragonlord Dromoka family) prevents `playerId` from casting spells.
 *
 * Conditions for blocking:
 *   1. A permanent on the battlefield has this static registered in continuousEffects.
 *   2. The caster (`playerId`) is an OPPONENT of the effect's controller.
 *   3. The effect's controller IS the current active player.
 */
function isOpponentCastBlockedByStaticDuringActivePlayerTurn(state: GameState, playerId: string): boolean {
  const activePlayer = state.players[state.activePlayerIndex];
  if (!activePlayer) return false;

  for (const effect of (state.continuousEffects ?? [])) {
    if (effect.ability.modifier.kind !== 'OpponentsCantCastDuringYourTurn') continue;
    // The source permanent must be on the battlefield.
    const source = state.cards.get(effect.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;
    // The effect's controller must be the active player.
    if (effect.controllerId !== activePlayer.id) continue;
    // The caster must be an opponent (not the controller themselves).
    if (effect.controllerId === playerId) continue;
    return true;
  }
  return false;
}

/**
 * Slice 6: Return the total generic-mana cost increase applied to spells cast
 * by `playerId` due to active "until your next turn" cost taxes (Tax Collector family).
 *
 * A tax is active when the caster is an opponent of the tax's controllerId.
 * Taxes are pruned by pruneSpellCostTaxes (turn-manager.ts) when the
 * controller's turn begins, so no turn-number check is needed here.
 */
function getSpellCostTaxIncrease(state: GameState, playerId: string): number {
  const taxes = state.spellCostTaxes || [];
  return taxes.reduce((total, tax) => {
    // The tax applies to opponents of the controller: anyone who isn't the controller.
    if (tax.controllerId === playerId) return total;
    return total + tax.amount;
  }, 0);
}

export function getEffectiveCastCost(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  options: CastSpellOptions = {},
): ReturnType<typeof parseManaString> | null {
  const card = state.cards.get(cardInstanceId);
  if (!card) return null;
  const def = getCastSpellDefinition(state, cardInstanceId, options);
  if (!def) return null;
  const baseCost = parseManaString(def.mana_cost);
  const xCost = /\{X\}/i.test(def.mana_cost) ? normalizedXValue(options) : 0;
  const taxAmount = card.zone === 'command' ? getCommanderTaxForCast(state, playerId, cardInstanceId) : 0;
  const reducedCost = reduceGenericCost(state, playerId, { ...baseCost, generic: baseCost.generic + taxAmount + xCost }, def);
  return buildCostMechanicPlan(state, playerId, card, def, reducedCost, options).cost;
}

/**
 * Slice 4 (top-library-play): Check whether `playerId` has a registered
 * PlayFromTopLibrary continuous effect that permits playing/casting `cardDef`
 * from the top of their library.
 *
 * Returns true only when:
 *   1. The card is at the top of the player's library (first in zone order).
 *   2. At least one active PlayFromTopLibrary continuous effect is registered for
 *      `playerId` whose source permanent is still on the battlefield.
 *   3. The effect's typeFilter (if any) matches `cardDef`.
 */
export function canPlayCardFromTopOfLibrary(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  cardDef: CardDefinition,
): boolean {
  // 1. The card must be at the top of the player's library.
  const library = getCardsInZone(state, playerId, 'library');
  if (library.length === 0 || library[0].instanceId !== cardInstanceId) return false;

  // 2 & 3. Scan continuousEffects for a PlayFromTopLibrary modifier for this player.
  for (const effect of (state.continuousEffects ?? [])) {
    if (effect.controllerId !== playerId) continue;
    const mod = effect.ability.modifier;
    if (mod.kind !== 'PlayFromTopLibrary') continue;
    // Verify the source permanent is still on the battlefield.
    const source = state.cards.get(effect.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;
    // Type filter check (if any).
    if (mod.typeFilter) {
      if (!matchesCardFilter(cardDef, mod.typeFilter)) continue;
    }
    return true;
  }
  return false;
}

export function canCastSpell(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  options: CastSpellOptions = {},
): boolean {
  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  if (card.ownerId !== playerId) return false;

  // Can cast from hand OR command zone (if it's the player's commander)
  const player = state.players.find(p => p.id === playerId);
  const isCommander = card.isCommander === true || player?.commanderInstanceIds?.includes(cardInstanceId) || player?.commanderInstanceId === cardInstanceId;
  const playableFromExile = card.zone === 'exile'
    && typeof card.playableFromExileUntilTurn === 'number'
    && card.playableFromExileUntilTurn >= state.turnNumber;
  // Slice 4 (top-library-play): may also cast from top of library when
  // a PlayFromTopLibrary continuous effect is active for this player.
  const def0 = getCastSpellDefinition(state, cardInstanceId, options) ?? getCardDefinition(state, card);
  const playableFromTopOfLibrary = card.zone === 'library'
    && !!def0
    && !def0.card_types.includes('land')
    && canPlayCardFromTopOfLibrary(state, playerId, cardInstanceId, def0);
  const validZone = card.zone === 'hand' || playableFromExile || (card.zone === 'command' && isCommander) || playableFromTopOfLibrary;
  if (!validZone) return false;
  if (findCastZoneRestriction(state, playerId, card)) return false;
  // Slice 10: check turn-scoped Silence-style spell-cast prohibitions.
  if (isSpellCastProhibited(state, playerId)) return false;
  // Slice 4/CBC: check continuous 'OpponentsCantCastDuringYourTurn' statics
  // (Dragonlord Dromoka family). Block when the caster is an opponent of the
  // effect's controller AND the controller is the current active player.
  if (isOpponentCastBlockedByStaticDuringActivePlayerTurn(state, playerId)) return false;

  const def = getCastSpellDefinition(state, cardInstanceId, options);
  if (!def) return false;

  // Lands are not cast
  if (def.card_types.includes('land')) return false;

  const isInstant = def.card_types.includes('instant');
  const hasFlash = def.keywords.includes('Flash');
  const hasOracleFlash = !isInstant && !hasFlash && hasAsThoughFlash(state, playerId, def);

  // Sorcery-speed: must be main phase, active player, empty stack
  if (!isInstant && !hasFlash && !hasOracleFlash) {
    const playerIndex = state.players.findIndex(p => p.id === playerId);
    if (state.activePlayerIndex !== playerIndex) return false;
    if (!MAIN_PHASES.includes(state.phase)) return false;
    if (state.stack.length > 0) return false;
  }

  // Slice 10 (combat statics): "Cast this spell only during the declare blockers step."
  // (Mirror Match family). If the spell carries this restriction, it may only be cast
  // when the game is in the declare-blockers step — even though it is otherwise an instant.
  if (hasCastOnlyDuringDeclareBlockers(def) && state.step !== 'declare_blockers') {
    return false;
  }

  // Check mana (including commander tax for command zone casts)
  const totalCost = getEffectiveCastCost(state, playerId, cardInstanceId, options);
  if (!totalCost) return false;

  if (!canPaySpellCost(player!, totalCost, def, card)) return false;
  if ((player?.life ?? 0) < getAdditionalLifeCostForCast(def, options)) return false;

  return true;
}

export function castSpell(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  targets: string[] = [],
  options?: number[] | CastSpellOptions,
): GameState {
  const castOptions = normalizeCastOptions(options);
  if (!canCastSpell(state, playerId, cardInstanceId, castOptions)) {
    throw new Error('Cannot cast spell');
  }

  const card = state.cards.get(cardInstanceId)!;
  const def = getCastSpellDefinition(state, cardInstanceId, castOptions)!;
  const castFromZone = card.zone;
  const castTargetSpecs = getCastTargetSpecs(def, castOptions);
  if (castTargetSpecs) {
    validateTargetChoices(state, playerId, castTargetSpecs, targets, cardInstanceId);
  }
  const cost = parseManaString(def.mana_cost);

  // Pay mana (including commander tax if from command zone)
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const isFromCommandZone = card.zone === 'command';
  const taxAmount = isFromCommandZone ? getCommanderTaxForCast(state, playerId, cardInstanceId) : 0;
  const xCost = /\{X\}/i.test(def.mana_cost) ? normalizedXValue(castOptions) : 0;
  const additionalLifeCost = getAdditionalLifeCostForCast(def, castOptions);
  if (!playerCanPayLife(state, playerId, additionalLifeCost)) {
    throw new Error('Cannot pay life cost');
  }
  const reducedCost = reduceGenericCost(state, playerId, { ...cost, generic: cost.generic + taxAmount + xCost }, def, targets);
  const mechanicPlan = buildCostMechanicPlan(state, playerId, card, def, reducedCost, castOptions);
  const totalCost = mechanicPlan.cost;
  const usedRestrictedMana = getSpellPaymentRestrictedMana(player, totalCost, def, card);
  const usedConditionalMana = getSpellPaymentConditionalMana(player, totalCost, def, card);
  const paidPlayer = paySpellCost(player, totalCost, def, card);
  const previousSpellCount = state.spellsCastThisTurn ?? 0;

  // Increment commander cast count if casting from command zone
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex
      ? {
          ...p,
          life: paidPlayer.life - additionalLifeCost,
          manaPool: paidPlayer.manaPool,
          snowManaPool: paidPlayer.snowManaPool,
          restrictedMana: paidPlayer.restrictedMana,
          conditionalMana: paidPlayer.conditionalMana,
          commanderCastCount: isFromCommandZone && p.commanderInstanceId === cardInstanceId
            ? p.commanderCastCount + 1
            : p.commanderCastCount,
          commanderCastCounts: isFromCommandZone
            ? {
                ...(p.commanderCastCounts || {}),
                [cardInstanceId]: ((p.commanderCastCounts || {})[cardInstanceId] ?? 0) + 1,
              }
            : p.commanderCastCounts,
        }
      : p
  );

  // Move card to stack zone
  const newCards = new Map(state.cards);
  for (const tapId of mechanicPlan.tapIds) {
    const tappedCard = newCards.get(tapId);
    if (tappedCard) newCards.set(tapId, { ...tappedCard, tapped: true });
  }
  for (const exileId of mechanicPlan.exileIds) {
    const exiledCard = newCards.get(exileId);
    if (exiledCard) newCards.set(exileId, { ...exiledCard, zone: 'exile', tapped: false, damage: 0 });
  }
  newCards.set(cardInstanceId, {
    ...card,
    zone: 'stack' as const,
    playableFromExileUntilTurn: undefined,
    playableFromExileSourceId: undefined,
    ...(castOptions.faceName ? { activeFaceName: castOptions.faceName } : {}),
  });

  // Add to stack
  const stackItem: SpellStackItem = {
    kind: 'Spell',
    id: nextStackObjectId(state),
    cardInstanceId,
    casterId: playerId,
    targets,
    castFromZone,
    ...(castOptions.chosenModes ? { chosenModes: castOptions.chosenModes } : {}),
    ...(castOptions.namedCardChoices ? { namedCardChoices: castOptions.namedCardChoices } : {}),
    ...(castOptions.cardChoices ? { cardChoices: copyCardChoices(castOptions.cardChoices) } : {}),
    ...(/\{X\}/i.test(def.mana_cost) || normalizedXValue(castOptions) > 0 ? { xValue: normalizedXValue(castOptions) } : {}),
    ...(castOptions.faceName ? { faceName: castOptions.faceName } : {}),
    ...(paymentMakesSpellUncounterable(state, usedRestrictedMana) || hasCantBeCounteredText(def.oracle_text)
      ? { cantBeCountered: true }
      : {}),
    // Slice 11: flag spells that used the flash window and carry the cleanup-sacrifice rider.
    ...(spellUsedFlashWindowForCleanupRider(state, playerId, def)
      ? { castAtInstantSpeed: true }
      : {}),
  };

  let resultState: GameState = {
    ...state,
    cards: newCards,
    players: newPlayers,
    stack: [...state.stack, stackItem],
    spellsCastThisTurn: previousSpellCount + 1,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };

  // Fire "whenever a spell is cast" triggers
  resultState = checkTriggersForEvent(resultState, {
    kind: 'SpellCast',
    casterId: playerId,
    cardInstanceId,
  });

  if (hasCastSacrificeToCounterChoice(def.oracle_text)) {
    resultState = applyCastSacrificeToCounterChoice(
      resultState,
      stackItem,
      castOptions.namedCardChoices?.sacrificeCardId,
    );
  }

  if (isRedInstantOrSorcery(def)) {
    for (const mana of usedConditionalMana) {
      if (mana.effect === 'copyRedInstantOrSorcery') {
        resultState = createSpellCopyOnStack(resultState, stackItem, playerId);
      }
    }
  }

  if (hasStorm(def) && previousSpellCount > 0) {
    for (let i = 0; i < previousSpellCount; i++) {
      resultState = createSpellCopyOnStack(resultState, stackItem, playerId);
    }
  }

  resultState = applyCascadeForSpell(resultState, playerId, def, stackItem);

  resultState = applyWardForStackItem(resultState, stackItem, playerId, targets);

  return resultState;
}

/**
 * Register ALL triggered abilities for a permanent that just entered the battlefield.
 * Handles ETB, Dies, Attacks, OpponentCastSpell, YouCastSpell, Upkeep, EndStep,
 * AnotherCreatureETB, CreatureYouControlDies, LifeGain, CardDrawn, AnyCreatureETB,
 * CastInstantOrSorcery, Landfall, and more.
 */
export function registerBattlefieldAbilities(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) return state;

  const def = getCardDefinition(state, card);

  const abilitiesToAdd: TriggeredAbilityRef[] = [];

  if (hasProwess(def)) {
    abilitiesToAdd.push({
      kind: 'TriggeredAbility' as const,
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

  // Mentor (CR 702.110): attack trigger that buffs a lesser-power attacking creature.
  if (hasMentor(def)) {
    abilitiesToAdd.push({
      kind: 'TriggeredAbility' as const,
      trigger: { kind: 'Attacks', who: 'self' },
      effects: [{ kind: 'Mentor' }],
    } as TriggeredAbilityRef);
  }

  // Register tax triggers from cached data (Rhystic Study, Mystic Remora, etc.)
  if (def.unlessTax) {
    const trigger = { kind: def.unlessTax.triggerKind as 'OpponentCastSpell' | 'CardDrawn' };
    const taxEffects: Effect[] = def.unlessTax.effect === 'draw'
      ? [{ kind: 'Draw' as const, player: { kind: 'Controller' as const }, count: def.unlessTax.effectCount }]
      : def.unlessTax.effect === 'treasure'
        ? [{
            kind: 'CreateToken' as const,
            controller: { kind: 'Controller' as const },
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
      kind: 'TriggeredAbility' as const,
      trigger,
      effects: taxEffects,
    } as TriggeredAbilityRef);
  }

  // Check for override first (ETB overrides)
  const override = getOverride(def.id, def.name);
  if (override && override.kind === 'ETB') {
    abilitiesToAdd.push({
      ...(override.ability as TriggeredAbilityRef),
      targets: override.targets,
    });
  }

  // Parse oracle text — may contain multiple abilities across sentences
  // Split oracle text by newlines to parse each ability line separately
  let addedOracleEtb = false;
  if (!override || override.kind !== 'ETB') {
    const parsedFullOracle = parseOracleText(normalizeOracleText(def.oracle_text, def.name));
    if (parsedFullOracle.kind === 'ETB') {
      abilitiesToAdd.push({
        ...(parsedFullOracle.ability as TriggeredAbilityRef),
        targets: parsedFullOracle.targets,
      });
      addedOracleEtb = true;
    }
  }

  const lines = def.oracle_text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const normalizedLine = normalizeOracleText(trimmed, def.name);
    const parsed = parseOracleText(normalizedLine);

    if (parsed.kind === 'ETB') {
      // Only add if we didn't already get an override for ETB
      if ((!override || override.kind !== 'ETB') && !addedOracleEtb) {
        abilitiesToAdd.push({
          ...(parsed.ability as TriggeredAbilityRef),
          targets: parsed.targets,
        });
      }
      if (/^whenever\s+~\s+enters\s+or\s+attacks\b/i.test(normalizedLine)) {
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
      // This covers: Attacks, Upkeep, EndStep, AnotherCreatureETB,
      // CreatureYouControlDies, YouCastSpell, OpponentCastSpell,
      // LifeGain, CardDrawn, AnyCreatureETB, CastInstantOrSorcery, Landfall
      // Deduplicate: skip if a trigger of this kind was already added from cached data
      const parsedTriggerKind = (parsed.ability as TriggeredAbilityRef).trigger.kind;
      const alreadyRegistered = abilitiesToAdd.some(a => a.trigger.kind === parsedTriggerKind);
      if (!alreadyRegistered) {
        abilitiesToAdd.push({
          ...(parsed.ability as TriggeredAbilityRef),
          targets: parsed.targets,
        });
      }
    }
  }

  if (abilitiesToAdd.length === 0) return state;

  const newAbilities = new Map(state.battlefieldAbilities || new Map());
  const existing = newAbilities.get(instanceId) || [];
  newAbilities.set(instanceId, [...existing, ...abilitiesToAdd]);
  return { ...state, battlefieldAbilities: newAbilities };
}

/**
 * Create pending triggers for a permanent that just entered the battlefield.
 *
 * @param enteredViaCast - Slice 11 (intervening-if ETB): pass true when the
 *   permanent entered as a result of a spell resolving (stack.ts spell path).
 *   Leave undefined/false for blink, search-to-battlefield, tokens, etc.
 *   Stored in PendingTrigger.eventContext.enteredViaCast so that
 *   evaluateCondition can answer the 'EnteredByCasting' condition honestly.
 */
export function createETBTriggers(state: GameState, instanceId: string, enteredViaCast?: boolean): GameState {
  const abilities = state.battlefieldAbilities.get(instanceId);
  if (!abilities || abilities.length === 0) return state;

  const card = state.cards.get(instanceId);
  if (!card) return state;

  const def = getCardDefinition(state, card);

  // Get target specs from parsing
  const override = getOverride(def.id, def.name);
  let targetSpecs: TargetSpec[] = [];

  if (override && override.kind === 'ETB') {
    targetSpecs = override.targets;
  } else {
    const fullOracleParsed = parseOracleText(normalizeOracleText(def.oracle_text, def.name));
    if (fullOracleParsed.kind === 'ETB') {
      targetSpecs = fullOracleParsed.targets;
    }
    for (const line of def.oracle_text.split('\n')) {
      if (targetSpecs.length > 0) break;
      const parsed = parseOracleText(normalizeOracleText(line.trim(), def.name));
      if (parsed.kind === 'ETB') {
        targetSpecs = parsed.targets;
        break;
      }
    }
  }

  const newPendingTriggers = [...state.pendingTriggers];

  for (const ability of abilities) {
    const isETBSelf = ability.trigger.kind === 'ETB' && (ability.trigger as { kind: 'ETB'; who: string }).who === 'self';
    // Slice 7: SelfOrAnotherSubtypeETB also fires when the source itself enters.
    const isSelfOrAnother = ability.trigger.kind === 'SelfOrAnotherSubtypeETB';
    if (isETBSelf || isSelfOrAnother) {
      const abilityTargets = (ability.targets as TargetSpec[] | undefined) || targetSpecs;
      newPendingTriggers.push({
        id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        sourceInstanceId: instanceId,
        controllerId: card.ownerId,
        ability,
        requiredTargets: abilityTargets,
        // Slice 11: propagate cast-entry flag so intervening-if ETB conditions
        // ('EnteredByCasting') can be evaluated honestly at resolution time.
        ...(enteredViaCast ? { eventContext: { enteredViaCast: true } } : {}),
      });
    }
  }

  return { ...state, pendingTriggers: newPendingTriggers };
}

export function resolveTopOfStack(state: GameState): GameState {
  if (state.stack.length === 0) {
    throw new Error('Stack is empty');
  }

  const topItem = state.stack[state.stack.length - 1];
  const newStack = state.stack.slice(0, -1);

  // Handle triggered ability resolution
  if (isTriggeredAbilityStackItem(topItem)) {
    let resultState: GameState = {
      ...state,
      stack: newStack,
      hasPriorityPassed: new Array(state.players.length).fill(false),
      priorityPlayerIndex: state.activePlayerIndex,
    };

    // Slice 10: Modal-as-trigger-body — resolve chosen mode(s) or default to all modes.
    // Mirrors the activated-ability modal path above.
    if (topItem.ability.modal) {
      const modal = topItem.ability.modal as ModalSpell;
      const modeIndices = (topItem.ability.chosenModes && topItem.ability.chosenModes.length > 0)
        ? topItem.ability.chosenModes
        : modal.choices.map((_, i) => i); // default: execute all modes (AI picks all)

      const allEffects: Effect[] = [];
      const allTargetSpecs: TargetSpec[] = [];
      for (const modeIndex of modeIndices) {
        if (modeIndex < 0 || modeIndex >= modal.choices.length) continue;
        const choice = modal.choices[modeIndex];
        allEffects.push(...choice.effects);
        for (const t of choice.targets) {
          allTargetSpecs.push({ id: t.id, type: t.type as TargetType, count: 1 });
        }
      }

      const resolvedTargets = sanitizeTargetsAtResolution(resultState, topItem.controllerId, allTargetSpecs, topItem.targets, topItem.sourceInstanceId);
      if (allTargetSpecs.length > 0 && !resolvedTargets.hasLegalTarget) {
        return checkStateBasedActions(resultState);
      }

      const beforeEffectsModal = resultState;
      resultState = executeSpellEffectsWithCopySupport(
        resultState,
        allEffects,
        topItem.controllerId,
        resolvedTargets.targets,
        allTargetSpecs,
        topItem.sourceInstanceId,
        topItem.namedCardChoices,
        topItem.eventContext,
      );
      resultState = checkCardDrawTriggersForTransition(beforeEffectsModal, resultState);
      return resultState;
    }

    const effects = topItem.ability.effects as Effect[];
    const targetSpecs = normalizeStackTargetSpecs(topItem.targetSpecs);
    if (hasMissingRequiredStackChoice(state, effects, topItem.controllerId, targetSpecs, topItem.targets, topItem.namedCardChoices)) {
      return state;
    }

    // Execute the triggered ability's effects
    const resolvedTargets = sanitizeTargetsAtResolution(resultState, topItem.controllerId, targetSpecs, topItem.targets, topItem.sourceInstanceId);
    if (targetSpecs.length > 0 && !resolvedTargets.hasLegalTarget) {
      return checkStateBasedActions(resultState);
    }

    resultState = executeSpellEffectsWithCopySupport(
      resultState,
      effects,
      topItem.controllerId,
      resolvedTargets.targets,
      targetSpecs,
      topItem.sourceInstanceId,
      topItem.namedCardChoices,
      topItem.eventContext,
    );

    return resultState;
  }

  // Handle activated ability resolution
  if (isActivatedAbilityStackItem(topItem)) {
    let resultState: GameState = {
      ...state,
      stack: newStack,
      hasPriorityPassed: new Array(state.players.length).fill(false),
      priorityPlayerIndex: state.activePlayerIndex,
    };

    // Slice 6: Modal activated ability — resolve chosen mode(s) or default to all modes.
    if (topItem.modal) {
      const modal = topItem.modal as ModalSpell;
      const modeIndices = (topItem.chosenModes && topItem.chosenModes.length > 0)
        ? topItem.chosenModes
        : modal.choices.map((_, i) => i); // default: execute all modes (AI picks all)

      const allEffects: Effect[] = [];
      const allTargetSpecs: TargetSpec[] = [];
      for (const modeIndex of modeIndices) {
        if (modeIndex < 0 || modeIndex >= modal.choices.length) continue;
        const choice = modal.choices[modeIndex];
        allEffects.push(...choice.effects);
        for (const t of choice.targets) {
          allTargetSpecs.push({ id: t.id, type: t.type as TargetType, count: 1 });
        }
      }

      const resolvedTargets = sanitizeTargetsAtResolution(resultState, topItem.controllerId, allTargetSpecs, topItem.targets, topItem.sourceInstanceId);
      if (allTargetSpecs.length > 0 && !resolvedTargets.hasLegalTarget) {
        return checkStateBasedActions(resultState);
      }

      const beforeEffectsModal = resultState;
      resultState = executeEffectsWithSBA(
        resultState,
        allEffects,
        topItem.controllerId,
        resolvedTargets.targets,
        allTargetSpecs,
        0,
        { namedCardChoices: topItem.namedCardChoices, sourceInstanceId: topItem.sourceInstanceId },
      );
      resultState = checkCardDrawTriggersForTransition(beforeEffectsModal, resultState);
      return resultState;
    }

    const effects = topItem.ability.effects as Effect[];
    const targetSpecs = normalizeStackTargetSpecs(topItem.ability.targets);
    if (hasMissingRequiredStackChoice(state, effects, topItem.controllerId, targetSpecs, topItem.targets, topItem.namedCardChoices)) {
      return state;
    }

    const resolvedTargets = sanitizeTargetsAtResolution(resultState, topItem.controllerId, targetSpecs, topItem.targets, topItem.sourceInstanceId);
    if (targetSpecs.length > 0 && !resolvedTargets.hasLegalTarget) {
      return checkStateBasedActions(resultState);
    }

    const beforeEffects = resultState;
    resultState = executeEffectsWithSBA(
      resultState,
      effects,
      topItem.controllerId,
      resolvedTargets.targets,
      targetSpecs,
      0,
      { namedCardChoices: topItem.namedCardChoices, sourceInstanceId: topItem.sourceInstanceId },
    );
    resultState = checkCardDrawTriggersForTransition(beforeEffects, resultState);

    return resultState;
  }

  // Handle spell resolution (existing logic)
  const spellItem = topItem as SpellStackItem;
  const card = state.cards.get(spellItem.cardInstanceId)!;
  const def = getStackSpellDefinition(state, spellItem)!;

  let newCards = new Map(state.cards);
  const isPermanent = def.card_types.some(t => PERMANENT_TYPES.includes(t));

  let resultState: GameState;

  if (isPermanent) {
    // Permanents enter the battlefield
    const isCreature = def.card_types.includes('creature');
    const entersTapped = def.oracle_text.toLowerCase().includes('enters the battlefield tapped')
      || def.oracle_text.toLowerCase().includes('enters tapped');
    const entry = applyPermanentEntryChoices(state, card, def, spellItem, entersTapped, isCreature);
    newCards = entry.cards;

    resultState = {
      ...state,
      cards: newCards,
      stack: newStack,
      hasPriorityPassed: new Array(state.players.length).fill(false),
      priorityPlayerIndex: state.activePlayerIndex,
    };

    if (!entry.entered) {
      return checkStateBasedActions(resultState);
    }

    resultState = applyEntersWithCounters(resultState, card.instanceId, def, spellItem.xValue);
    resultState = applyAttachedAuraEntryEffects(resultState, card.instanceId);

    // Slice 11: flag the permanent for cleanup-step sacrifice when the spell used
    // the flash window and carries the cleanup-sacrifice rider.
    if (spellItem.castAtInstantSpeed) {
      const entering = resultState.cards.get(card.instanceId);
      if (entering && entering.zone === 'battlefield') {
        const newCardsForFlag = new Map(resultState.cards);
        newCardsForFlag.set(card.instanceId, { ...entering, sacrificeAtCleanup: true });
        resultState = { ...resultState, cards: newCardsForFlag };
      }
    }

    // Register all triggered abilities for this permanent (ETB, dies, attacks, etc.)
    resultState = registerBattlefieldAbilities(resultState, card.instanceId);
    resultState = registerContinuousAbilitiesForPermanent(resultState, card.instanceId);
    // Create ETB triggers for this specific permanent (self-ETB).
    // Slice 11: pass enteredViaCast=true so intervening-if ETB conditions
    // ('if you cast it') resolve correctly at trigger resolution.
    resultState = createETBTriggers(resultState, card.instanceId, true);

    // Fire "whenever a creature enters the battlefield" triggers on OTHER permanents
    if (isCreature) {
      resultState = checkTriggersForEvent(resultState, {
        kind: 'CreatureETB',
        instanceId: card.instanceId,
        controllerId: card.ownerId,
      });
    }

    // Slice 2: Fire PermanentETB for ALL permanents (used by AnotherLegendaryPermanentETB etc.)
    resultState = checkTriggersForEvent(resultState, {
      kind: 'PermanentETB',
      instanceId: card.instanceId,
      controllerId: card.ownerId,
    });
  } else {
    // Instants and sorceries: execute effects, then originals go to graveyard.
    // Spell copies are stack objects only; the physical card stays where it is.
    if (!spellItem.isCopy) {
      const { activeFaceName: _activeFaceName, ...graveyardCard } = card;
      newCards.set(card.instanceId, { ...graveyardCard, zone: 'graveyard' });
    }

    let intermediateState: GameState = {
      ...state,
      cards: newCards,
      stack: newStack,
      hasPriorityPassed: new Array(state.players.length).fill(false),
      priorityPlayerIndex: state.activePlayerIndex,
    };

    // Try to find effect definition: override first, then parse
    const override = getOverride(def.id, def.name);
    if (override && override.kind === 'Spell') {
      if (hasMissingRequiredStackChoice(
        state,
        override.effects,
        spellItem.casterId,
        override.targets,
        spellItem.targets,
        spellItem.namedCardChoices,
        spellItem.xValue ?? 0,
      )) {
        return state;
      }
      const resolvedTargets = sanitizeTargetsAtResolution(intermediateState, spellItem.casterId, override.targets, spellItem.targets, spellItem.cardInstanceId);
      if (override.targets.length > 0 && !resolvedTargets.hasLegalTarget) {
        resultState = checkStateBasedActions(intermediateState);
      } else {
        resultState = executeSpellEffectsWithCopySupport(
          intermediateState,
          override.effects,
          spellItem.casterId,
          resolvedTargets.targets,
          override.targets,
          spellItem.cardInstanceId,
          spellItem.namedCardChoices,
          undefined,
          spellItem.xValue ?? 0,
        );
      }
    } else {
      // Try to parse oracle text
      const parsed = parseOracleText(normalizeOracleText(def.oracle_text, def.name));
      if (parsed.kind === 'Spell') {
        if (hasMissingRequiredStackChoice(
          state,
          parsed.effects,
          spellItem.casterId,
          parsed.targets,
          spellItem.targets,
          spellItem.namedCardChoices,
          spellItem.xValue ?? 0,
        )) {
          return state;
        }
        const resolvedTargets = sanitizeTargetsAtResolution(intermediateState, spellItem.casterId, parsed.targets, spellItem.targets, spellItem.cardInstanceId);
        if (parsed.targets.length > 0 && !resolvedTargets.hasLegalTarget) {
          resultState = checkStateBasedActions(intermediateState);
        } else {
          resultState = executeSpellEffectsWithCopySupport(
            intermediateState,
            parsed.effects,
            spellItem.casterId,
            resolvedTargets.targets,
            parsed.targets,
            spellItem.cardInstanceId,
            spellItem.namedCardChoices,
            undefined,
            spellItem.xValue ?? 0,
          );
        }
      } else if (parsed.kind === 'Modal' && spellItem.chosenModes && spellItem.chosenModes.length > 0) {
        // Modal spell: collect effects and targets from chosen modes
        const modal = parsed.modal;

        validateModalModeSelection(modal, spellItem.chosenModes);
        const allEffects: Effect[] = [];
        const allTargetSpecs: TargetSpec[] = [];

        for (const modeIndex of spellItem.chosenModes) {
          const choice = modal.choices[modeIndex];
          allEffects.push(...choice.effects);
          // Convert ModalChoice targets to TargetSpecs
          for (const t of choice.targets) {
            allTargetSpecs.push({ id: t.id, type: t.type as TargetType, count: 1 });
          }
        }

        if (hasMissingRequiredStackChoice(
          state,
          allEffects,
          spellItem.casterId,
          allTargetSpecs,
          spellItem.targets,
          spellItem.namedCardChoices,
          spellItem.xValue ?? 0,
        )) {
          return state;
        }

        const resolvedTargets = sanitizeTargetsAtResolution(intermediateState, spellItem.casterId, allTargetSpecs, spellItem.targets, spellItem.cardInstanceId);
        if (allTargetSpecs.length > 0 && !resolvedTargets.hasLegalTarget) {
          resultState = checkStateBasedActions(intermediateState);
        } else {
          resultState = executeSpellEffectsWithCopySupport(
            intermediateState,
            allEffects,
            spellItem.casterId,
            resolvedTargets.targets,
            allTargetSpecs,
            spellItem.cardInstanceId,
            spellItem.namedCardChoices,
            undefined,
            spellItem.xValue ?? 0,
          );
        }
      } else {
        // Unparsed spell (or modal with no chosenModes): just resolve without effects (card still goes to graveyard)
        // Run SBAs anyway
        resultState = checkStateBasedActions(intermediateState);
      }
    }
  }

  return resultState;
}

/**
 * Move pending triggers to the stack.
 * In APNAP order (active player first, then clockwise).
 */
export function putTriggersOnStack(
  state: GameState,
  triggerTargets: Record<string, string[]> = {},
  triggerOrder: string[] = [],
): GameState {
  if (state.pendingTriggers.length === 0) return state;

  // Sort triggers by APNAP order
  const playerOrder: string[] = [];
  for (let i = 0; i < state.players.length; i++) {
    const idx = (state.activePlayerIndex + i) % state.players.length;
    playerOrder.push(state.players[idx].id);
  }

  const orderIndex = new Map(triggerOrder.map((triggerId, index) => [triggerId, index]));
  const sortedTriggers = [...state.pendingTriggers].sort((a, b) => {
    const aIdx = playerOrder.indexOf(a.controllerId);
    const bIdx = playerOrder.indexOf(b.controllerId);
    if (aIdx !== bIdx) return aIdx - bIdx;
    const aOrder = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return 0;
  });

  // Create stack items for each trigger
  const newStackItems: TriggeredAbilityStackItem[] = sortedTriggers.map(trigger => ({
    kind: 'TriggeredAbility' as const,
    id: trigger.id,
    sourceInstanceId: trigger.sourceInstanceId,
    controllerId: trigger.controllerId,
    ability: trigger.ability,
    targets: triggerTargets[trigger.id] || defaultTriggerTargets(state, trigger.controllerId, trigger.requiredTargets as TargetSpec[]),
    targetSpecs: trigger.requiredTargets,
    eventContext: trigger.eventContext,
  }));

  return {
    ...state,
    stack: [...state.stack, ...newStackItems],
    pendingTriggers: [],
  };
}

function defaultTriggerTargets(state: GameState, controllerId: string, specs: TargetSpec[] = []): string[] {
  const targets: string[] = [];
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i++) {
      const target = defaultTargetForSpec(state, controllerId, spec, targets);
      if (!target) return targets;
      targets.push(target);
    }
  }
  return targets;
}

function defaultTargetForSpec(
  state: GameState,
  controllerId: string,
  spec: TargetSpec,
  existingTargets: string[],
): string | null {
  if (spec.type === 'Player') {
    return state.players.find(player =>
      !player.hasLost
      && !existingTargets.includes(player.id)
      && (!spec.constraints?.opponentControls || player.id !== controllerId)
    )?.id ?? null;
  }
  if (spec.type === 'Creature') {
    return [...state.cards.values()].find(card => {
      if (card.zone !== 'battlefield') return false;
      if (existingTargets.includes(card.instanceId)) return false;
      if (spec.constraints?.opponentControls && card.ownerId === controllerId) return false;
      const def = getCardDefinition(state, card);
      if (spec.constraints?.notColors?.some(color => def.colors.includes(color))) return false;
      return def?.card_types.includes('creature') ?? false;
    })?.instanceId ?? null;
  }
  if (
    spec.type === 'CardInGraveyard'
    || spec.type === 'CreatureCardInGraveyard'
    || spec.type === 'CreatureOrEnchantmentCardInGraveyard'
  ) {
    return [...state.cards.values()].find(card => {
      if (card.zone !== 'graveyard') return false;
      if (existingTargets.includes(card.instanceId)) return false;
      if (spec.constraints?.opponentControls && card.ownerId === controllerId) return false;
      const def = getCardDefinition(state, card);
      if (spec.constraints?.notColors?.some(color => def.colors.includes(color))) return false;
      // Honor the full parsed filter (required types/subtypes, mana value, …) so
      // a default trigger target never violates the target spec's constraints.
      try {
        validateTargetChoices(state, controllerId, [{ ...spec, count: 1 }], [card.instanceId]);
      } catch {
        return false;
      }
      if (spec.type === 'CreatureCardInGraveyard') return def.card_types.includes('creature');
      if (spec.type === 'CreatureOrEnchantmentCardInGraveyard') {
        return def.card_types.includes('creature') || def.card_types.includes('enchantment');
      }
      return true;
    })?.instanceId ?? null;
  }
  return null;
}

export function putPendingTriggerOnStack(
  state: GameState,
  triggerId: string,
  triggerTargets: string[] = [],
): GameState {
  const trigger = state.pendingTriggers.find(candidate => candidate.id === triggerId);
  if (!trigger) return state;

  const newStackItem: TriggeredAbilityStackItem = {
    kind: 'TriggeredAbility' as const,
    id: trigger.id,
    sourceInstanceId: trigger.sourceInstanceId,
    controllerId: trigger.controllerId,
    ability: trigger.ability,
    targets: triggerTargets,
    targetSpecs: trigger.requiredTargets,
    eventContext: trigger.eventContext,
  };

  return {
    ...state,
    stack: [...state.stack, newStackItem],
    pendingTriggers: state.pendingTriggers.filter(candidate => candidate.id !== triggerId),
  };
}

// ============================================================================
// Event-driven trigger checking
// ============================================================================

/**
 * Game event types that can fire triggers.
 */
export type GameEvent =
  | { kind: 'SpellCast'; casterId: string; cardInstanceId: string }
  | { kind: 'SpellCopied'; controllerId: string; cardInstanceId: string }
  | { kind: 'CardDrawn'; playerId: string; count: number; cardInstanceIds?: string[] }
  | { kind: 'CreatureDied'; instanceId: string; ownerId: string }
  | { kind: 'CreatureETB'; instanceId: string; controllerId: string }
  | { kind: 'Attacks'; attackerInstanceId: string; controllerId: string; alone?: boolean; defendingPlayerId?: string }
  | { kind: 'Unblocked'; attackerInstanceId: string; controllerId: string; defendingPlayerId?: string }
  | { kind: 'PermanentTapped'; instanceId: string; controllerId: string; forMana?: boolean }
  | { kind: 'CombatDamageToPlayer'; sourceInstanceId: string; controllerId: string; damagedPlayerId: string; damage: number; attackerInstanceIds?: string[] }
  | { kind: 'LifeGained'; playerId: string; amount: number }
  | { kind: 'LifeLost'; playerId: string; amount: number }
  | { kind: 'LandETB'; instanceId: string; controllerId: string }
  | { kind: 'UpkeepStart'; activePlayerId: string }
  | { kind: 'DrawStepStart'; activePlayerId: string }
  | { kind: 'BeginningCombatStart'; activePlayerId: string }
  | { kind: 'EndStepStart'; activePlayerId: string }
  /**
   * Slice 5 (event-damage triggers): fired by executeDealDamage whenever actual
   * damage is applied. sourceInstanceId is the dealing permanent; targetId is the
   * damaged creature or player; amount is the actual damage dealt after replacements.
   */
  | { kind: 'DealsDamage'; sourceInstanceId: string; targetId: string; amount: number }
  /**
   * Slice 2: fired for EVERY permanent entering the battlefield (including creatures
   * and lands). Used by AnotherLegendaryPermanentETB (Yoshimaru family) which must
   * fire for any legendary permanent regardless of card type.
   */
  | { kind: 'PermanentETB'; instanceId: string; controllerId: string }
  /**
   * Slice 8/11: fired for each blocking/blocked-by combat pair when all blockers are
   * finalized. `sourceInstanceId` is the creature whose trigger fires; `opposingCreatureId`
   * is the OTHER creature in the pair (the one "that creature" refers to in the effect body).
   * Both creatures get one event each per pair (attacker fires for the blocker, blocker
   * fires for the attacker).
   */
  | { kind: 'BlocksOrBlockedBy'; sourceInstanceId: string; opposingCreatureId: string; controllerId: string };

function getSpellEventController(event: GameEvent): string | null {
  if (event.kind === 'SpellCast') return event.casterId;
  if (event.kind === 'SpellCopied') return event.controllerId;
  return null;
}

/** "with mana value N or less" rider on cast triggers (Scalding Viper style). */
function spellEventManaValueAtMost(state: GameState, cardInstanceId: string, maxManaValue: number): boolean {
  const spellCard = state.cards.get(cardInstanceId);
  const spellDef = spellCard ? getCardDefinition(state, spellCard) : undefined;
  return !!spellDef && spellDef.cmc <= maxManaValue;
}

function spellEventIsInstantOrSorcery(state: GameState, event: GameEvent): boolean {
  if (event.kind !== 'SpellCast' && event.kind !== 'SpellCopied') return false;
  const spellCard = state.cards.get(event.cardInstanceId);
  const spellDef = spellCard ? getCardDefinition(state, spellCard) : undefined;
  return !!spellDef && isInstantOrSorcery(spellDef);
}

function additionalTriggerMultiplierCount(state: GameState, controllerId: string, event: GameEvent): number {
  if (!spellEventIsInstantOrSorcery(state, event)) return 0;

  let count = 0;
  for (const card of state.cards.values()) {
    if (card.zone !== 'battlefield' || card.ownerId !== controllerId) continue;
    const def = getCardDefinition(state, card);
    if (/triggered ability of a permanent you control[^.]*triggers an additional time/i.test(def.oracle_text)) {
      count++;
    }
  }
  return count;
}

function copyAdditionalSpellTriggers(
  state: GameState,
  triggers: GameState['pendingTriggers'],
  firstNewTriggerIndex: number,
  event: GameEvent,
): GameState['pendingTriggers'] {
  const controllerId = getSpellEventController(event);
  if (!controllerId) return triggers;

  const multiplierCount = additionalTriggerMultiplierCount(state, controllerId, event);
  if (multiplierCount <= 0) return triggers;

  const createdByEvent = triggers.slice(firstNewTriggerIndex).filter(trigger => {
    const source = state.cards.get(trigger.sourceInstanceId);
    return source?.zone === 'battlefield' && source.ownerId === controllerId;
  });
  if (createdByEvent.length === 0) return triggers;

  const copied = [...triggers];
  for (let copyRound = 0; copyRound < multiplierCount; copyRound++) {
    for (const trigger of createdByEvent) {
      copied.push({
        ...trigger,
        id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        requiredTargets: [...trigger.requiredTargets],
      });
    }
  }
  return copied;
}

/**
 * Check all battlefield permanents for triggers matching a game event.
 * Creates pending trigger entries for any matches.
 *
 * This is the CORE function that connects game events to the trigger system.
 * It must be called whenever a relevant game event occurs.
 */
export function checkTriggersForEvent(state: GameState, event: GameEvent): GameState {
  let newPendingTriggers = [...(state.pendingTriggers || [])];
  const firstEventTriggerIndex = newPendingTriggers.length;
  let delayedTriggers = [...(state.delayedTriggers || [])];

  if (event.kind === 'EndStepStart' && delayedTriggers.length > 0) {
    const remainingDelayed = [];
    for (const delayed of delayedTriggers) {
      const shouldFire = delayed.trigger.kind === 'EndStep'
        && (
          delayed.trigger.whose === 'next'
          || (delayed.trigger.whose === 'yours' && event.activePlayerId === delayed.controllerId)
          || (delayed.trigger.whose === 'opponents' && event.activePlayerId !== delayed.controllerId)
        );

      if (shouldFire) {
        newPendingTriggers.push({
          id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          sourceInstanceId: delayed.sourceInstanceId || delayed.id,
          controllerId: delayed.controllerId,
          ability: {
            kind: 'TriggeredAbility',
            trigger: delayed.trigger,
            effects: delayed.effects,
          },
          requiredTargets: [],
        });
      }

      if (!shouldFire || !delayed.oneShot) {
        remainingDelayed.push(delayed);
      }
    }
    delayedTriggers = remainingDelayed;
  }

  if (!state.battlefieldAbilities || state.battlefieldAbilities.size === 0) {
    return { ...state, pendingTriggers: newPendingTriggers, delayedTriggers };
  }

  for (const [instanceId, abilities] of state.battlefieldAbilities) {
    // Verify the permanent is still on the battlefield
    const card = state.cards.get(instanceId);
    if (!card || card.zone !== 'battlefield') continue;

    // CR 613 layer 6: a "loses all abilities" aura (Darksteel Mutation, Song of
    // the Dryads) suppresses the permanent's own printed triggered abilities.
    if (instanceLosesAllAbilities(state, instanceId)) continue;

    const controllerId = card.ownerId;

    for (const ability of abilities) {
      const trigger = ability.trigger;
      let shouldFire = false;

      switch (event.kind) {
        case 'SpellCast': {
          // "Whenever an opponent casts a spell [with mana value N or less]"
          if (trigger.kind === 'OpponentCastSpell' && event.casterId !== controllerId) {
            const castTrigger = trigger as { kind: 'OpponentCastSpell'; maxManaValue?: number };
            shouldFire = castTrigger.maxManaValue === undefined
              || spellEventManaValueAtMost(state, event.cardInstanceId, castTrigger.maxManaValue);
          }
          // "Whenever a player casts a spell [with mana value N or less]" — ANY caster.
          if (trigger.kind === 'AnyPlayerCastSpell') {
            const castTrigger = trigger as { kind: 'AnyPlayerCastSpell'; maxManaValue?: number };
            shouldFire = castTrigger.maxManaValue === undefined
              || spellEventManaValueAtMost(state, event.cardInstanceId, castTrigger.maxManaValue);
          }
          // "Whenever you cast a spell"
          if (trigger.kind === 'YouCastSpell' && event.casterId === controllerId) {
            shouldFire = true;
          }
          // "Whenever you cast a noncreature spell"
          if (trigger.kind === 'CastNoncreatureSpell' && event.casterId === controllerId) {
            const spellCard = state.cards.get(event.cardInstanceId);
            if (spellCard) {
              const spellDef = getCardDefinition(state, spellCard);
              if (!spellDef.card_types.includes('creature')) {
                shouldFire = true;
              }
            }
          }
          // "Whenever you cast an instant or sorcery spell"
          if (trigger.kind === 'CastInstantOrSorcery' && event.casterId === controllerId) {
            const spellCard = state.cards.get(event.cardInstanceId);
            if (spellCard) {
              const spellDef = getCardDefinition(state, spellCard);
              if (spellDef.card_types.includes('instant') || spellDef.card_types.includes('sorcery')) {
                shouldFire = true;
              }
            }
          }
          // "Whenever you cast or copy an instant or sorcery spell"
          if (trigger.kind === 'CastOrCopyInstantOrSorcery' && event.casterId === controllerId) {
            const spellCard = state.cards.get(event.cardInstanceId);
            if (spellCard) {
              const spellDef = getCardDefinition(state, spellCard);
              if (isInstantOrSorcery(spellDef)) {
                shouldFire = true;
              }
            }
          }
          break;
        }

        case 'SpellCopied': {
          if (trigger.kind === 'CastOrCopyInstantOrSorcery' && event.controllerId === controllerId) {
            const spellCard = state.cards.get(event.cardInstanceId);
            if (spellCard) {
              const spellDef = getCardDefinition(state, spellCard);
              if (isInstantOrSorcery(spellDef)) {
                shouldFire = true;
              }
            }
          }
          break;
        }

        case 'CardDrawn': {
          if (trigger.kind === 'CardDrawn' && event.playerId !== controllerId) {
            shouldFire = true;
          }
          break;
        }

        case 'CreatureETB': {
          const enteringCard = state.cards.get(event.instanceId);
          const enteringIsToken = enteringCard?.isToken === true;
          // "Whenever another creature enters the battlefield under your control"
          if (trigger.kind === 'AnotherCreatureETB'
            && (trigger as { kind: 'AnotherCreatureETB'; controller: string }).controller === 'yours'
            && event.controllerId === controllerId
            && event.instanceId !== instanceId) {
            const etbTrigger = trigger as { kind: 'AnotherCreatureETB'; controller: string; nontoken?: boolean; tokenOnly?: boolean };
            shouldFire = (!etbTrigger.nontoken || !enteringIsToken)
              && (!etbTrigger.tokenOnly || enteringIsToken);
          }
          // "Whenever a creature enters the battlefield" and the
          // controller-restricted "under your control" variant.
          if (trigger.kind === 'AnyCreatureETB' && event.instanceId !== instanceId) {
            const etbTrigger = trigger as { kind: 'AnyCreatureETB'; controller?: string; nontoken?: boolean; tokenOnly?: boolean };
            const controllerRestriction = etbTrigger.controller ?? 'any';
            const tokenRestrictionOk = (!etbTrigger.nontoken || !enteringIsToken)
              && (!etbTrigger.tokenOnly || enteringIsToken);
            if (tokenRestrictionOk && (controllerRestriction === 'any' || event.controllerId === controllerId)) {
              shouldFire = true;
            }
          }
          // Slice 7: "Whenever this creature or another <Subtype> you control enters"
          // This fires for both self-entering AND another matching creature entering.
          if (trigger.kind === 'SelfOrAnotherSubtypeETB' && event.controllerId === controllerId) {
            const subtypeTrigger = trigger as { kind: 'SelfOrAnotherSubtypeETB'; subtype: string };
            const sub = subtypeTrigger.subtype.toLowerCase();
            const enteringCard2 = state.cards.get(event.instanceId);
            const enteringDef2 = enteringCard2 ? getCardDefinition(state, enteringCard2) : undefined;
            if (enteringDef2) {
              const entTypeLine = enteringDef2.type_line.toLowerCase();
              const subtypeMatch = sub === 'creature'
                ? enteringDef2.card_types.includes('creature')
                : entTypeLine.includes(sub);
              if (subtypeMatch) {
                shouldFire = true;
              }
            }
          }
          break;
        }

        case 'CreatureDied': {
          if (trigger.kind === 'CreatureYouControlDies' && event.ownerId === controllerId) {
            shouldFire = true;
          }
          // "Whenever another creature you control dies" /
          // "Whenever a creature an opponent controls dies".
          if (trigger.kind === 'OtherCreatureDies') {
            const scope = trigger as {
              kind: 'OtherCreatureDies';
              who: 'youControl' | 'opponentControl';
              other?: boolean;
            };
            const scopeMatches =
              scope.who === 'youControl'
                ? event.ownerId === controllerId
                : event.ownerId !== controllerId;
            const notSelf = !scope.other || event.instanceId !== instanceId;
            if (scopeMatches && notSelf) {
              shouldFire = true;
            }
          }
          if (trigger.kind === 'AttachedCreatureDies') {
            const source = state.cards.get(instanceId);
            if (source?.attachedTo === event.instanceId) {
              shouldFire = true;
            }
          }
          break;
        }

        case 'Attacks': {
          // "Whenever ~ attacks" (and "Whenever ~ attacks alone")
          if (trigger.kind === 'Attacks' && (trigger as { kind: 'Attacks'; who: string }).who === 'self'
            && event.attackerInstanceId === instanceId) {
            const attacksTrigger = trigger as { kind: 'Attacks'; who: string; alone?: boolean };
            // "attacks alone" only fires when this is the sole attacker.
            if (!attacksTrigger.alone || event.alone === true) {
              shouldFire = true;
            }
          }
          // "Whenever a creature you control attacks"
          if (trigger.kind === 'CreatureYouControlAttacks' && event.controllerId === controllerId) {
            shouldFire = true;
          }
          break;
        }

        case 'Unblocked': {
          if (trigger.kind === 'Unblocked' && trigger.who === 'self'
            && event.attackerInstanceId === instanceId) {
            shouldFire = true;
          }
          break;
        }

        case 'PermanentTapped': {
          if (trigger.kind === 'BecomesTapped' && trigger.who === 'self'
            && event.instanceId === instanceId) {
            shouldFire = true;
          }
          // "Whenever a player taps a land for mana" (Manabarbs/Scald subfamily).
          // Only fires for taps made to produce mana, and only when the tapped
          // permanent matches the land restriction (plain land / subtype / nonbasic).
          if (trigger.kind === 'PlayerTapsLandForMana' && event.forMana === true) {
            const tapTrigger = trigger as { kind: 'PlayerTapsLandForMana'; subtype?: string; nonbasic?: boolean };
            const tappedCard = state.cards.get(event.instanceId);
            const tappedDef = tappedCard ? getCardDefinition(state, tappedCard) : undefined;
            if (tappedDef?.card_types.includes('land')) {
              const typeLine = tappedDef.type_line.toLowerCase();
              const subtypeOk = !tapTrigger.subtype || typeLine.includes(tapTrigger.subtype.toLowerCase());
              const nonbasicOk = !tapTrigger.nonbasic || !typeLine.includes('basic');
              if (subtypeOk && nonbasicOk) {
                shouldFire = true;
              }
            }
          }
          break;
        }

        case 'CombatDamageToPlayer': {
          if (trigger.kind === 'CombatDamageToPlayer') {
            const damageTrigger = trigger as { kind: 'CombatDamageToPlayer'; who: string; requiresDeathtouch?: boolean };
            if (damageTrigger.who === 'self' && event.sourceInstanceId === instanceId) {
              shouldFire = true;
            }
            if (damageTrigger.who === 'creatureYouControl' && event.controllerId === controllerId) {
              // Fynn family: if trigger requires deathtouch, the source creature must have deathtouch.
              if (damageTrigger.requiresDeathtouch) {
                shouldFire = instanceHasKeyword(state, event.sourceInstanceId, 'Deathtouch');
              } else {
                shouldFire = true;
              }
            }
          }
          break;
        }

        case 'LifeGained': {
          if (trigger.kind === 'LifeGain' && event.playerId === controllerId && event.amount > 0) {
            shouldFire = true;
          }
          break;
        }

        case 'LifeLost': {
          if (trigger.kind === 'LifeLoss' && event.playerId === controllerId && event.amount > 0) {
            shouldFire = true;
          }
          break;
        }

        case 'LandETB': {
          // "Whenever a land enters the battlefield under your control"
          if (trigger.kind === 'Landfall' && event.controllerId === controllerId) {
            shouldFire = true;
          }
          break;
        }

        case 'PermanentETB': {
          // Slice 2: "Whenever another legendary permanent you control enters"
          // (Yoshimaru, Ever Faithful family). Fires for any legendary permanent
          // (other than the source itself) entering under the same controller.
          if (
            trigger.kind === 'AnotherLegendaryPermanentETB' &&
            event.controllerId === controllerId &&
            event.instanceId !== instanceId
          ) {
            const enteringCard = state.cards.get(event.instanceId);
            const enteringDef = enteringCard ? getCardDefinition(state, enteringCard) : undefined;
            // Slice-7: respect nonLegendary flag ("except it isn't legendary" rider).
            if (enteringDef && typeLineHasSupertype(enteringDef.type_line, 'legendary') && !enteringCard?.nonLegendary) {
              shouldFire = true;
            }
          }
          break;
        }

        case 'UpkeepStart': {
          // "At the beginning of your upkeep"
          if (trigger.kind === 'Upkeep') {
            const upkeepTrigger = trigger as { kind: 'Upkeep'; whose: string };
            if (upkeepTrigger.whose === 'yours' && event.activePlayerId === controllerId) {
              shouldFire = true;
            }
            if (upkeepTrigger.whose === 'each') {
              shouldFire = true;
            }
            // "At the beginning of each opponent's upkeep"
            if (upkeepTrigger.whose === 'opponents' && event.activePlayerId !== controllerId) {
              shouldFire = true;
            }
          }
          break;
        }

        case 'DrawStepStart': {
          // "At the beginning of your draw step" — Immortal Sun family
          if (trigger.kind === 'DrawStep') {
            const drawTrigger = trigger as { kind: 'DrawStep'; whose: string };
            if (drawTrigger.whose === 'yours' && event.activePlayerId === controllerId) {
              shouldFire = true;
            }
          }
          break;
        }

        case 'BeginningCombatStart': {
          if (trigger.kind === 'BeginningCombat') {
            const combatTrigger = trigger as { kind: 'BeginningCombat'; whose: string };
            if (combatTrigger.whose === 'yours' && event.activePlayerId === controllerId) {
              shouldFire = true;
            }
            if (combatTrigger.whose === 'each') {
              shouldFire = true;
            }
          }
          break;
        }

        case 'BlocksOrBlockedBy': {
          // Slice 8/11: "Whenever ~ blocks or becomes blocked by a creature, that creature <effect>"
          // The trigger fires on the source creature (sourceInstanceId == instanceId) when it
          // blocks or becomes blocked. The opposing creature is stored in opposingCreatureId and
          // bound to { kind: 'EventCreature' } in the effect body ("that creature").
          if (trigger.kind === 'BlocksOrBlockedBy'
            && (trigger as { kind: 'BlocksOrBlockedBy'; who: string }).who === 'self'
            && event.sourceInstanceId === instanceId) {
            shouldFire = true;
          }
          break;
        }

        case 'DealsDamage': {
          // Slice 5: "Whenever this creature / enchanted creature deals damage …"
          if (trigger.kind === 'DealsDamage') {
            const dmgTrigger = trigger as { kind: 'DealsDamage'; who: 'self' | 'enchantedCreature' };
            if (dmgTrigger.who === 'self' && event.sourceInstanceId === instanceId) {
              shouldFire = true;
            }
            if (dmgTrigger.who === 'enchantedCreature') {
              // The source is an Aura; check that the damaged creature is the one
              // this Aura is attached to (i.e. sourceAttachedTo === event.sourceInstanceId).
              const sourceCard = state.cards.get(instanceId);
              if (sourceCard?.attachedTo === event.sourceInstanceId) {
                shouldFire = true;
              }
            }
          }
          break;
        }

        case 'EndStepStart': {
          // "At the beginning of your end step"
          if (trigger.kind === 'EndStep') {
            const endStepTrigger = trigger as { kind: 'EndStep'; whose: string };
            if (endStepTrigger.whose === 'yours' && event.activePlayerId === controllerId) {
              shouldFire = true;
            }
            if (endStepTrigger.whose === 'opponents' && event.activePlayerId !== controllerId) {
              shouldFire = true;
            }
            // "At the beginning of each end step" — fires on every player's end step.
            if (endStepTrigger.whose === 'each') {
              shouldFire = true;
            }
          }
          break;
        }
      }

      if (shouldFire) {
        // Get target specs for this ability from parsing
        let targetSpecs: TargetSpec[] = (ability.targets as TargetSpec[] | undefined) || [];
        const cardDef = getCardDefinition(state, card);
        if (targetSpecs.length === 0) {
          // Parse the specific line that matches this trigger
          const lines = cardDef.oracle_text.split('\n');
          for (const line of lines) {
            const parsed = parseOracleText(normalizeOracleText(line.trim(), cardDef.name));
            if ((parsed.kind === 'Triggered' || parsed.kind === 'ETB' || parsed.kind === 'Dies')
              && parsed.ability.trigger.kind === trigger.kind) {
              targetSpecs = parsed.targets;
              break;
            }
          }
        }

        const eventContext = event.kind === 'SpellCast'
          ? { casterId: event.casterId, cardInstanceId: event.cardInstanceId, eventPlayerId: event.casterId }
          : event.kind === 'SpellCopied'
            ? { casterId: event.controllerId, cardInstanceId: event.cardInstanceId, eventPlayerId: event.controllerId }
          : event.kind === 'CreatureDied'
            ? { cardInstanceId: event.instanceId }
          : event.kind === 'Attacks' || event.kind === 'Unblocked'
            ? { cardInstanceId: event.attackerInstanceId, ...(event.defendingPlayerId ? { eventPlayerId: event.defendingPlayerId } : {}) }
            : event.kind === 'CombatDamageToPlayer'
              // cardInstanceId = the source creature; eventPlayerId = the damaged player ("that player")
              // Slice 2: eventDamageAmount = damage dealt for "put that many counters / create that many tokens"
              // Slice 6: attackerInstanceIds = snapshot of attacker ids before combat state is cleared
              ? { cardInstanceId: event.sourceInstanceId, eventPlayerId: event.damagedPlayerId, eventDamageAmount: event.damage, attackerInstanceIds: event.attackerInstanceIds ?? state.combat?.attackers.map(a => a.cardInstanceId) ?? [] }
              // "that player" for upkeep punishers — the player whose upkeep it is.
              : event.kind === 'UpkeepStart'
                ? { eventPlayerId: event.activePlayerId }
                // Slice 11: DrawStepStart — draw-step trigger context (Immortal Sun family).
                : event.kind === 'DrawStepStart'
                  ? { eventPlayerId: event.activePlayerId }
                  // "that player" for taps-for-mana punishers — the tapping player.
                  : event.kind === 'PermanentTapped'
                  ? { cardInstanceId: event.instanceId, eventPlayerId: event.controllerId }
                  // Slice 5: DealsDamage — eventDamageAmount carries the damage amount for
                  // "you gain that much life" / "deals that much damage" effect bodies.
                  : event.kind === 'DealsDamage'
                    ? { cardInstanceId: event.sourceInstanceId, eventDamageAmount: event.amount }
                  // Slice 8/11: BlocksOrBlockedBy — opposingCreatureId is "that creature" in the body.
                  : event.kind === 'BlocksOrBlockedBy'
                    ? { cardInstanceId: event.opposingCreatureId }
                    : undefined;

        newPendingTriggers.push({
          id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          sourceInstanceId: instanceId,
          controllerId,
          ability,
          requiredTargets: targetSpecs,
          eventContext,
        });
      }
    }
  }

  newPendingTriggers = copyAdditionalSpellTriggers(state, newPendingTriggers, firstEventTriggerIndex, event);

  return { ...state, pendingTriggers: newPendingTriggers, delayedTriggers };
}
