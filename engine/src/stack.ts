import { GameState, Phase, StackItem, SpellStackItem, TriggeredAbilityStackItem, isSpellStackItem, isTriggeredAbilityStackItem, isActivatedAbilityStackItem, TriggeredAbilityRef, CardInstance, CardDefinition } from './types';
import { applyFaceToCardDefinition, getCardDefinition } from './game-state';
import { parseManaString, canPaySpellCost, paySpellCost, getSpellPaymentRestrictedMana, getSpellPaymentConditionalMana } from './mana';
import { getOverride } from './effects/overrides';
import { parseOracleText } from './effects/parser';
import { executeEffectsWithSBA } from './effects/executor';
import { validateTargetChoices, TargetSpec, TargetType } from './effects/targets';
import { checkStateBasedActions } from './state-based';
import type { Effect, StaticAbilityEffect } from './effects/ast';
import { findCastZoneRestriction, getCommanderTaxForCast } from './casting-restrictions';
import { getCostReduction, getIntrinsicCostReduction, registerContinuousEffect } from './effects/continuous';
import { getCommanderDestinationZone } from './commander';
import { buildBattlefieldEntryPlan } from './permanent-entry';
import { applyWardForStackItem } from './ward';

const MAIN_PHASES: Phase[] = ['precombat_main', 'postcombat_main'];
const PERMANENT_TYPES = ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle'];

let stackCounter = 0;

export interface CastSpellOptions {
  chosenModes?: number[];
  namedCardChoices?: Record<string, string>;
  cardChoices?: CardInstance['choices'];
  xValue?: number;
  faceName?: string;
  delveCardIds?: string[];
  convokeCreatureIds?: string[];
  improviseArtifactIds?: string[];
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
    imprintedCardIds: choices.imprintedCardIds ? [...choices.imprintedCardIds] : undefined,
    discardedCardIds: choices.discardedCardIds ? [...choices.discardedCardIds] : undefined,
  } : undefined;
}

interface CostMechanicPlan {
  cost: ReturnType<typeof parseManaString>;
  tapIds: string[];
  exileIds: string[];
}

function hasKeywordOrText(def: CardDefinition, keyword: string): boolean {
  const normalized = keyword.toLowerCase();
  return def.keywords.some(item => item.toLowerCase() === normalized)
    || new RegExp(`\\b${keyword}\\b`, 'i').test(def.oracle_text);
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
  if (source.imprintedCardIds && source.imprintedCardIds.length > 0) {
    merged.imprintedCardIds = [...source.imprintedCardIds];
  }
  if (source.discardedCardIds && source.discardedCardIds.length > 0) {
    merged.discardedCardIds = [...source.discardedCardIds];
  }
  if (override?.chosenCreatureType) merged.chosenCreatureType = override.chosenCreatureType;
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
    if (modes.length !== parsed.modal.chooseCount) {
      throw new Error(`Modal spell requires ${parsed.modal.chooseCount} mode(s), got ${modes.length}`);
    }
    const specs: TargetSpec[] = [];
    for (const modeIndex of modes) {
      const choice = parsed.modal.choices[modeIndex];
      if (!choice) {
        throw new Error(`Invalid modal choice ${modeIndex}`);
      }
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
      ...(item.constraints ? { constraints: item.constraints } : {}),
    };
  });
}

function reduceGenericCost(
  state: GameState,
  playerId: string,
  cost: ReturnType<typeof parseManaString>,
  def: CardDefinition,
): ReturnType<typeof parseManaString> {
  const reduction = Math.min(cost.generic, getCostReduction(state, playerId, def) + getIntrinsicCostReduction(state, playerId, def));
  return reduction > 0 ? { ...cost, generic: cost.generic - reduction } : cost;
}

function hasCantBeCounteredText(text: string): boolean {
  return /\b(?:can'?t|cannot)\s+be\s+countered\b/i.test(text);
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

function entersWithCounters(oracleText: string): Array<{ counterType: string; count: number }> {
  const counters: Array<{ counterType: string; count: number }> = [];
  for (const rawLine of oracleText.split('\n')) {
    const line = rawLine.trim();
    const match = line.match(/\benters(?: the battlefield)? with (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) ([+\-]\d+\/[+\-]\d+|[a-z]+(?: [a-z]+)?) counters?\b/i);
    if (!match) continue;
    const count = parseSmallCounterCount(match[1]);
    const counterType = match[2]?.toLowerCase();
    if (!count || !counterType) continue;
    counters.push({ counterType, count });
  }
  return counters;
}

function applyEntersWithCounters(state: GameState, instanceId: string, def: CardDefinition): GameState {
  const counters = entersWithCounters(def.oracle_text);
  if (counters.length === 0) return state;
  const card = state.cards.get(instanceId);
  if (!card || card.zone !== 'battlefield') return state;
  const nextCounters = { ...card.counters };
  for (const counter of counters) {
    nextCounters[counter.counterType] = (nextCounters[counter.counterType] || 0) + counter.count;
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
    id: `stack_${++stackCounter}`,
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
    id: `stack_${++stackCounter}`,
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
  eventContext?: { casterId?: string; cardInstanceId?: string },
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
  }
  return text;
}

function additionalStaticKeywordFromLine(line: string): string | null {
  const match = line.match(/\band\s+(?:have|has)\s+([^,.]+)/i);
  if (!match) return null;
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
  }

  return resultState;
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
  const validZone = card.zone === 'hand' || (card.zone === 'command' && isCommander);
  if (!validZone) return false;
  if (findCastZoneRestriction(state, playerId, card)) return false;

  const def = getCastSpellDefinition(state, cardInstanceId, options);
  if (!def) return false;

  // Lands are not cast
  if (def.card_types.includes('land')) return false;

  const isInstant = def.card_types.includes('instant');
  const hasFlash = def.keywords.includes('Flash');

  // Sorcery-speed: must be main phase, active player, empty stack
  if (!isInstant && !hasFlash) {
    const playerIndex = state.players.findIndex(p => p.id === playerId);
    if (state.activePlayerIndex !== playerIndex) return false;
    if (!MAIN_PHASES.includes(state.phase)) return false;
    if (state.stack.length > 0) return false;
  }

  // Check mana (including commander tax for command zone casts)
  const totalCost = getEffectiveCastCost(state, playerId, cardInstanceId, options);
  if (!totalCost) return false;

  if (!canPaySpellCost(player!, totalCost, def, card)) return false;

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
  const reducedCost = reduceGenericCost(state, playerId, { ...cost, generic: cost.generic + taxAmount + xCost }, def);
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
          life: paidPlayer.life,
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
    ...(castOptions.faceName ? { activeFaceName: castOptions.faceName } : {}),
  });

  // Add to stack
  const stackItem: SpellStackItem = {
    kind: 'Spell',
    id: `stack_${++stackCounter}`,
    cardInstanceId,
    casterId: playerId,
    targets,
    castFromZone,
    ...(castOptions.chosenModes ? { chosenModes: castOptions.chosenModes } : {}),
    ...(castOptions.namedCardChoices ? { namedCardChoices: castOptions.namedCardChoices } : {}),
    ...(castOptions.cardChoices ? { cardChoices: copyCardChoices(castOptions.cardChoices) } : {}),
    ...(/\{X\}/i.test(def.mana_cost) ? { xValue: normalizedXValue(castOptions) } : {}),
    ...(castOptions.faceName ? { faceName: castOptions.faceName } : {}),
    ...(paymentMakesSpellUncounterable(state, usedRestrictedMana) || hasCantBeCounteredText(def.oracle_text)
      ? { cantBeCountered: true }
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
  const lines = def.oracle_text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const normalizedLine = normalizeOracleText(trimmed, def.name);
    const parsed = parseOracleText(normalizedLine);

    if (parsed.kind === 'ETB') {
      // Only add if we didn't already get an override for ETB
      if (!override || override.kind !== 'ETB') {
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
 */
export function createETBTriggers(state: GameState, instanceId: string): GameState {
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
    for (const line of def.oracle_text.split('\n')) {
      const parsed = parseOracleText(normalizeOracleText(line.trim(), def.name));
      if (parsed.kind === 'ETB') {
        targetSpecs = parsed.targets;
        break;
      }
    }
  }

  const newPendingTriggers = [...state.pendingTriggers];

  for (const ability of abilities) {
    if (ability.trigger.kind === 'ETB' && ability.trigger.who === 'self') {
      const abilityTargets = (ability.targets as TargetSpec[] | undefined) || targetSpecs;
      newPendingTriggers.push({
        id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        sourceInstanceId: instanceId,
        controllerId: card.ownerId,
        ability,
        requiredTargets: abilityTargets,
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

    // Execute the triggered ability's effects
    const effects = topItem.ability.effects as Effect[];
    const targetSpecs = normalizeStackTargetSpecs(topItem.targetSpecs);

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

    const effects = topItem.ability.effects as Effect[];
    const targetSpecs = normalizeStackTargetSpecs(topItem.ability.targets);

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

    resultState = applyEntersWithCounters(resultState, card.instanceId, def);
    resultState = applyAttachedAuraEntryEffects(resultState, card.instanceId);
    // Register all triggered abilities for this permanent (ETB, dies, attacks, etc.)
    resultState = registerBattlefieldAbilities(resultState, card.instanceId);
    resultState = registerContinuousAbilitiesForPermanent(resultState, card.instanceId);
    // Create ETB triggers for this specific permanent (self-ETB)
    resultState = createETBTriggers(resultState, card.instanceId);

    // Fire "whenever a creature enters the battlefield" triggers on OTHER permanents
    if (isCreature) {
      resultState = checkTriggersForEvent(resultState, {
        kind: 'CreatureETB',
        instanceId: card.instanceId,
        controllerId: card.ownerId,
      });
    }
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

        // Validate mode count matches spell requirement
        if (spellItem.chosenModes.length !== modal.chooseCount) {
          throw new Error(`Modal spell requires ${modal.chooseCount} mode(s), got ${spellItem.chosenModes.length}`);
        }
        const allEffects: Effect[] = [];
        const allTargetSpecs: TargetSpec[] = [];

        for (const modeIndex of spellItem.chosenModes) {
          if (modeIndex >= 0 && modeIndex < modal.choices.length) {
            const choice = modal.choices[modeIndex];
            allEffects.push(...choice.effects);
            // Convert ModalChoice targets to TargetSpecs
            for (const t of choice.targets) {
              allTargetSpecs.push({ id: t.id, type: t.type as TargetType, count: 1 });
            }
          }
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
  | { kind: 'Attacks'; attackerInstanceId: string; controllerId: string }
  | { kind: 'Unblocked'; attackerInstanceId: string; controllerId: string }
  | { kind: 'PermanentTapped'; instanceId: string; controllerId: string }
  | { kind: 'CombatDamageToPlayer'; sourceInstanceId: string; controllerId: string; damagedPlayerId: string; damage: number }
  | { kind: 'LifeGained'; playerId: string; amount: number }
  | { kind: 'LandETB'; instanceId: string; controllerId: string }
  | { kind: 'UpkeepStart'; activePlayerId: string }
  | { kind: 'BeginningCombatStart'; activePlayerId: string }
  | { kind: 'EndStepStart'; activePlayerId: string };

function getSpellEventController(event: GameEvent): string | null {
  if (event.kind === 'SpellCast') return event.casterId;
  if (event.kind === 'SpellCopied') return event.controllerId;
  return null;
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
        && delayed.trigger.whose === 'yours'
        && event.activePlayerId === delayed.controllerId;

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

    const controllerId = card.ownerId;

    for (const ability of abilities) {
      const trigger = ability.trigger;
      let shouldFire = false;

      switch (event.kind) {
        case 'SpellCast': {
          // "Whenever an opponent casts a spell"
          if (trigger.kind === 'OpponentCastSpell' && event.casterId !== controllerId) {
            shouldFire = true;
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
          break;
        }

        case 'CreatureDied': {
          if (trigger.kind === 'CreatureYouControlDies' && event.ownerId === controllerId) {
            shouldFire = true;
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
          // "Whenever ~ attacks"
          if (trigger.kind === 'Attacks' && (trigger as { kind: 'Attacks'; who: string }).who === 'self'
            && event.attackerInstanceId === instanceId) {
            shouldFire = true;
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
          break;
        }

        case 'CombatDamageToPlayer': {
          if (trigger.kind === 'CombatDamageToPlayer') {
            const damageTrigger = trigger as { kind: 'CombatDamageToPlayer'; who: string };
            if (damageTrigger.who === 'self' && event.sourceInstanceId === instanceId) {
              shouldFire = true;
            }
            if (damageTrigger.who === 'creatureYouControl' && event.controllerId === controllerId) {
              shouldFire = true;
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

        case 'LandETB': {
          // "Whenever a land enters the battlefield under your control"
          if (trigger.kind === 'Landfall' && event.controllerId === controllerId) {
            shouldFire = true;
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
          ? { casterId: event.casterId, cardInstanceId: event.cardInstanceId }
          : event.kind === 'SpellCopied'
            ? { casterId: event.controllerId, cardInstanceId: event.cardInstanceId }
          : event.kind === 'CreatureDied'
            ? { cardInstanceId: event.instanceId }
          : event.kind === 'Attacks' || event.kind === 'Unblocked'
            ? { cardInstanceId: event.attackerInstanceId }
            : event.kind === 'CombatDamageToPlayer'
              ? { cardInstanceId: event.sourceInstanceId }
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
