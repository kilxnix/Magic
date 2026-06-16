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
import { executeSacrificeSpecific, executeSearchLibrary, executeShuffleLibrary, executeEffectsWithSBA, matchesCardFilter, executeLoseLife } from './effects/executor';
import { getEffectivePower } from './effects/continuous';
import { checkTriggersForEvent, createETBTriggers, registerBattlefieldAbilities, canPlayCardFromTopOfLibrary } from './stack';
import { instanceHasKeyword, instanceLosesAllAbilities } from './keywords';
import { populateParsedCache } from './cards/card-parser-cache';
import { isEffectiveCreature } from './effective-types';
import { getCommanderDestinationZone } from './commander';
import {
  buildBattlefieldEntryPlan,
  entersTheBattlefieldTapped,
  getOptionalUntappedLifeCost,
} from './permanent-entry';
import type { ActivatedAbility, Effect, ManaProductionInfo } from './effects/ast';
import { validateTargetChoices, type TargetSpec } from './effects/targets';
import { applyWardForStackItem } from './ward';
import { playerCanPayLife } from './game-outcome';

const MAIN_PHASES: Phase[] = ['precombat_main', 'postcombat_main'];

export interface PlayLandOptions {
  payLifeToEnterUntapped?: boolean;
  chosenCreatureType?: string;
  /** Slice 5: chosen-color for "As ~ enters, choose a color." lands/artifacts. */
  chosenColor?: 'W' | 'U' | 'B' | 'R' | 'G';
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

// ============================================================================
// Slice 11: Dynamic mana ability helpers (Reflecting Pool, Bloom Tender)
// ============================================================================

/**
 * Slice 11 — Reflecting Pool: "{T}: Add one mana of any type that a land you
 * control could produce."
 * Returns true when the card's oracle text matches the Reflecting Pool pattern.
 */
function isReflectingPoolAbility(oracleText: string): boolean {
  return /add one mana of any type that a land you control could produce/i.test(oracleText);
}

/**
 * Compute the union of all mana colors that lands controlled by `playerId`
 * could produce. Used by Reflecting Pool at both color-availability time and
 * tap time. We call getAvailableManaColors recursively but skip Reflecting Pool
 * sources themselves to avoid infinite recursion.
 */
function reflectingPoolColors(state: GameState, playerId: string, excludeInstanceId: string): ManaColor[] {
  const colors = new Set<ManaColor>();
  for (const [id, card] of state.cards) {
    if (id === excludeInstanceId) continue;
    if (card.ownerId !== playerId || card.zone !== 'battlefield') continue;
    const landDef = getCardDefinition(state, card);
    if (!landDef.card_types.includes('land')) continue;
    // Skip other Reflecting Pools to avoid infinite recursion
    if (isReflectingPoolAbility(landDef.oracle_text)) continue;
    const landColors = getAvailableManaColors(state, id);
    for (const c of landColors) colors.add(c);
  }
  return [...colors];
}

/**
 * Slice 11 — Bloom Tender: "{T}: For each color among permanents you control,
 * add one mana of that color."
 * Returns true when the card's oracle text matches the Bloom Tender pattern.
 */
function isBloomTenderAbility(oracleText: string): boolean {
  return /for each color among permanents you control,?\s*add one mana of that color/i.test(oracleText);
}

/**
 * Compute the set of colors present among all permanents controlled by
 * `playerId`. Used by Bloom Tender at both color-availability time and tap time.
 */
function bloomTenderColors(state: GameState, playerId: string): ManaColor[] {
  const colors = new Set<ManaColor>();
  const colorSet: ManaColor[] = ['W', 'U', 'B', 'R', 'G'];
  for (const [, card] of state.cards) {
    if (card.ownerId !== playerId || card.zone !== 'battlefield') continue;
    const permanentDef = getCardDefinition(state, card);
    for (const c of (permanentDef.colors ?? []) as ManaColor[]) {
      if (colorSet.includes(c)) colors.add(c);
    }
  }
  return [...colors];
}

export function getAvailableManaColors(state: GameState, cardInstanceId: string): ManaColor[] {
  const card = state.cards.get(cardInstanceId);
  if (!card) return [];
  let def = getCardDefinition(state, card);
  if (!def.manaProduction && !def.manaProductions?.length) {
    def = populateParsedCache(def);
  }
  const manaProductions = getManaProductions(def);
  // NOTE: do NOT return early if manaProductions is empty — the card may still gain
  // a mana ability via GrantActivatedManaAbility (Slice 4 / Enduring Vitality family).
  // We will check granted productions below after the own-production path.
  if (!manaActivationConditionMet(state, card.ownerId, cardInstanceId, def.oracle_text)) return [];

  // Slice 11: Reflecting Pool — "{T}: Add one mana of any type that a land you
  // control could produce." Dynamic union of other lands' available colors.
  if (isReflectingPoolAbility(def.oracle_text)) {
    if (card.tapped || isBlockedBySummoningSicknessForTap(state, cardInstanceId)) return [];
    return reflectingPoolColors(state, card.ownerId, cardInstanceId);
  }

  // Slice 11: Bloom Tender — "{T}: For each color among permanents you control,
  // add one mana of that color." Dynamic set of colors on your permanents.
  if (isBloomTenderAbility(def.oracle_text)) {
    if (card.tapped || isBlockedBySummoningSicknessForTap(state, cardInstanceId)) return [];
    return bloomTenderColors(state, card.ownerId);
  }

  const colors = new Set<ManaColor>();
  if (manaProductions.length === 0) {
    // Card has no own mana productions — skip the own-production color gathering but
    // still fall through to the GrantActivatedManaAbility grant path below.
  } else if (/add one mana of any of the exiled card'?s colors/i.test(def.oracle_text)) {
    const allowed = new Set<ManaColor>();
    for (const imprintedId of card.choices?.imprintedCardIds || []) {
      const imprinted = state.cards.get(imprintedId);
      if (!imprinted || imprinted.zone !== 'exile') continue;
      const imprintedDef = getCardDefinition(state, imprinted);
      for (const color of imprintedDef.colors || []) {
        allowed.add(color);
      }
    }
    for (const production of manaProductions) {
      for (const color of production.colors) {
        if (allowed.has(color)) colors.add(color);
      }
    }
    return [...colors];
  }

  if (/commander'?s color identity/i.test(def.oracle_text)) {
    const commanderIdentity = getCommanderColorIdentity(state, card.ownerId);
    for (const production of manaProductions) {
      for (const color of production.colors) {
        if (commanderIdentity.has(color)) colors.add(color);
      }
    }
    return [...colors];
  }

  for (const production of manaProductions) {
    for (const color of production.colors) colors.add(color);
  }

  // Slice 4: also add colors from granted mana abilities (GrantActivatedManaAbility).
  // If the card has no own manaProduction, the granted ones are the only source.
  // If it also has its own, both contribute.
  const grantedProductions = getGrantedManaProductions(state, cardInstanceId);
  for (const production of grantedProductions) {
    // Summoning sickness gate: {T} ability on a creature.
    if (production.isTapAbility && card.tapped) continue;
    if (production.isTapAbility && isBlockedBySummoningSicknessForTap(state, cardInstanceId)) continue;
    for (const color of production.colors) colors.add(color);
  }

  return [...colors];
}

function getManaProductions(def: { manaProduction?: ManaProductionInfo; manaProductions?: ManaProductionInfo[] }): ManaProductionInfo[] {
  if (def.manaProductions?.length) return def.manaProductions;
  return def.manaProduction ? [def.manaProduction] : [];
}

/**
 * Slice 4 (engine-gap): Collect mana productions granted to a battlefield
 * creature via GrantActivatedManaAbility continuousEffects (Enduring Vitality
 * family). Returns an empty array if no grants apply.
 *
 * A grant applies when:
 *   - The continuousEffect's modifier is GrantActivatedManaAbility
 *   - The source permanent is still on the battlefield
 *   - The effect's controllerId matches the card's ownerId
 *   - The card matches the effect's StaticAbilityEffect filter (creature type etc.)
 */
function getGrantedManaProductions(state: GameState, cardInstanceId: string): ManaProductionInfo[] {
  const card = state.cards.get(cardInstanceId);
  if (!card || card.zone !== 'battlefield') return [];
  const def = getCardDefinition(state, card);

  const granted: ManaProductionInfo[] = [];
  for (const ce of (state.continuousEffects ?? [])) {
    if (ce.ability.modifier.kind !== 'GrantActivatedManaAbility') continue;
    // Source must still be on the battlefield.
    const source = state.cards.get(ce.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;
    // Effect must be controlled by the card's owner.
    if (ce.controllerId !== card.ownerId) continue;
    // The card must match the filter (e.g. "creature" filter).
    const filterMatch = matchesCardFilter(def, ce.ability.filter);
    if (!filterMatch) continue;
    // excludeSelf: if the static excludes the source, skip when card IS the source.
    if (ce.ability.excludeSelf && cardInstanceId === ce.sourceInstanceId) continue;
    granted.push(ce.ability.modifier.grantedMana);
  }
  return granted;
}

function selectManaProductionForColor(def: { manaProduction?: ManaProductionInfo; manaProductions?: ManaProductionInfo[] }, color: ManaColor): ManaProductionInfo | undefined {
  return getManaProductions(def).find(production => production.colors.includes(color));
}

function getCommanderColorIdentity(state: GameState, playerId: string): Set<ManaColor> {
  const identity = new Set<ManaColor>();
  const player = state.players.find(candidate => candidate.id === playerId);
  const commanderIds = new Set<string>([
    ...(player?.commanderInstanceIds || []),
    ...(player?.commanderInstanceId ? [player.commanderInstanceId] : []),
  ]);

  for (const commanderId of commanderIds) {
    const commander = state.cards.get(commanderId);
    if (!commander) continue;
    const def = getCardDefinition(state, commander);
    for (const color of def.color_identity || []) {
      if (color !== 'C') identity.add(color);
    }
  }

  if (identity.size === 0) {
    for (const card of state.cards.values()) {
      if (card.ownerId !== playerId || !card.isCommander) continue;
      const def = getCardDefinition(state, card);
      for (const color of def.color_identity || []) {
        if (color !== 'C') identity.add(color);
      }
    }
  }

  return identity;
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

function sacrificeManaCandidateRank(state: GameState, candidateInstanceId: string): number {
  const candidate = state.cards.get(candidateInstanceId);
  if (!candidate) return 999;
  const def = getCardDefinition(state, candidate);
  let rank = 0;
  if (!candidate.isToken) rank += 20;
  if (candidate.isCommander) rank += 100;
  if (/\blegendary\b/i.test(def.type_line)) rank += 15;
  rank += Math.max(0, def.cmc);
  rank += Math.max(0, def.power ?? 0) * 0.5;
  rank += Math.max(0, def.toughness ?? 0) * 0.25;
  return rank;
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
    const def = getCardDefinition(state, card);
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
  const def = getCardDefinition(state, card);
  const playableFromExile = card.zone === 'exile'
    && typeof card.playableFromExileUntilTurn === 'number'
    && card.playableFromExileUntilTurn >= state.turnNumber;
  // Slice 4 (top-library-play): may play a land from the top of the library when
  // a PlayFromTopLibrary continuous effect is active for this player.
  const playableFromTopOfLibrary = card.zone === 'library'
    && def.card_types.includes('land')
    && canPlayCardFromTopOfLibrary(state, playerId, cardInstanceId, def);
  if (card.zone !== 'hand' && !playableFromExile && !playableFromTopOfLibrary) {
    return { legal: false, code: 'not_in_zone', reason: 'Card is not in a playable zone' };
  }

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
    ...(options.chosenColor ? { chosenColor: options.chosenColor } : {}),
  };
  const entry = buildBattlefieldEntryPlan(state, playerId, card, def, {
    payLifeToEnterUntapped: options.payLifeToEnterUntapped,
    // Slice 6: enable deterministic shock-land auto-choice (pay 2 life → untapped if
    // life >= 4, else enter tapped) only for the explicit land-play action.  Executor
    // / authority paths that put permanents onto the battlefield in other ways use
    // explicit payLifeToEnterUntapped and do not get auto-choice.
    autoChooseShockLand: options.payLifeToEnterUntapped === undefined,
    summoningSick: false,
    choices: Object.keys(entryChoices).length > 0 ? entryChoices : card.choices,
  });
  newCards.set(cardInstanceId, entry.card);

  // Apply hasPlayedLand / landsPlayedThisTurn metadata on top of entry.players.
  // When payLifeToEnterUntapped was explicitly true, entry.players already has the
  // life deduction (legacy search-to-battlefield path). When it was undefined (shock-
  // land auto-choice), entry.players == state.players and life loss is applied below
  // via executeLoseLife so that LifeLoss triggers fire correctly.
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const newPlayers = entry.players.map((p, i) =>
    i === playerIndex
      ? { ...p, hasPlayedLand: true, landsPlayedThisTurn: (p.landsPlayedThisTurn ?? 0) + 1 }
      : p,
  );

  let resultState: GameState = { ...state, cards: newCards, players: newPlayers };

  // Shock-land auto-choice: if life was paid via the auto-choice path (payLifeToEnterUntapped
  // was undefined / not supplied), route the loss through executeLoseLife so LifeLoss triggers
  // (e.g. Sanguine Bond, Necropotence) see it. The explicit true path (search-to-battlefield
  // via authority) already deducted life in entry.players and does NOT come through playLand.
  if (entry.paidLife > 0 && options.payLifeToEnterUntapped === undefined) {
    resultState = executeLoseLife(resultState, playerId, entry.paidLife);
  }

  // Register any triggered abilities the land might have (e.g., ETB triggers on lands)
  resultState = registerBattlefieldAbilities(resultState, cardInstanceId);
  resultState = createETBTriggers(resultState, cardInstanceId);

  // Fire landfall triggers ("Whenever a land enters the battlefield under your control")
  resultState = checkTriggersForEvent(resultState, {
    kind: 'LandETB',
    instanceId: cardInstanceId,
    controllerId: playerId,
  });

  // Slice 2: Fire PermanentETB for ALL permanents (used by AnotherLegendaryPermanentETB etc.)
  resultState = checkTriggersForEvent(resultState, {
    kind: 'PermanentETB',
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
  if (!def.manaProduction || !def.manaProductions?.length) {
    const parsedDef = populateParsedCache(def);
    if (parsedDef.manaProduction) {
      const hydratedDefinitions = new Map(state.cardDefinitions);
      hydratedDefinitions.set(parsedDef.id, parsedDef);
      state = { ...state, cardDefinitions: hydratedDefinitions };
      def = parsedDef;
    }
  }
  let manaProduction = selectManaProductionForColor(def, color);

  // Slice 4 (engine-gap): If the card has no own mana production for this color,
  // check if a GrantActivatedManaAbility continuous effect grants it one.
  if (!manaProduction) {
    const grantedProductions = getGrantedManaProductions(state, cardInstanceId);
    const grantedForColor = grantedProductions.find(p => p.colors.includes(color));
    if (grantedForColor) {
      manaProduction = grantedForColor;
    }
  }

  // Slice 11: Reflecting Pool — "{T}: Add one mana of any type that a land you
  // control could produce." Tap the pool itself and add the chosen color iff it
  // is in the dynamic union of other lands' productions.
  if (isReflectingPoolAbility(def.oracle_text)) {
    if (card.zone !== 'battlefield') throw new Error('Card not on battlefield');
    if (card.tapped) throw new Error('Card already tapped');
    if (isBlockedBySummoningSicknessForTap(state, cardInstanceId)) throw new Error('Summoning sick');
    const available = reflectingPoolColors(state, playerId, cardInstanceId);
    if (!available.includes(color)) throw new Error('Cannot produce chosen color');
    const newCards = new Map(state.cards);
    newCards.set(cardInstanceId, { ...card, tapped: true });
    const playerIndex = state.players.findIndex(p => p.id === playerId);
    const multiplier = manaProductionMultiplier(state, playerId, cardInstanceId);
    const newPlayers = state.players.map((p, i) =>
      i !== playerIndex ? p : { ...p, manaPool: addMana(p.manaPool, color, 1 * multiplier) }
    );
    let result: GameState = { ...state, cards: newCards, players: newPlayers };
    result = checkTriggersForEvent(result, { kind: 'PermanentTapped', instanceId: cardInstanceId, controllerId: playerId, forMana: true });
    return result;
  }

  // Slice 11: Bloom Tender — "{T}: For each color among permanents you control,
  // add one mana of that color." Tapping adds ALL colors present among the
  // controller's permanents simultaneously. The `color` parameter selects one
  // of those colors (the caller picks which pip to see in the mana pool; the
  // remaining colors are added at the same time via producedMana below).
  if (isBloomTenderAbility(def.oracle_text)) {
    if (card.zone !== 'battlefield') throw new Error('Card not on battlefield');
    if (card.tapped) throw new Error('Card already tapped');
    if (isBlockedBySummoningSicknessForTap(state, cardInstanceId)) throw new Error('Summoning sick');
    const available = bloomTenderColors(state, playerId);
    if (available.length === 0) throw new Error('Cannot produce chosen color');
    if (!available.includes(color)) throw new Error('Cannot produce chosen color');
    const newCards = new Map(state.cards);
    newCards.set(cardInstanceId, { ...card, tapped: true });
    const playerIndex = state.players.findIndex(p => p.id === playerId);
    const multiplier = manaProductionMultiplier(state, playerId, cardInstanceId);
    const newPlayers = state.players.map((p, i) => {
      if (i !== playerIndex) return p;
      let withMana = { ...p };
      // Add one of each color simultaneously (Bloom Tender adds all at once)
      for (const c of available) {
        withMana = { ...withMana, manaPool: addMana(withMana.manaPool, c, 1 * multiplier) };
      }
      return withMana;
    });
    let result: GameState = { ...state, cards: newCards, players: newPlayers };
    result = checkTriggersForEvent(result, { kind: 'PermanentTapped', instanceId: cardInstanceId, controllerId: playerId, forMana: true });
    return result;
  }

  if (!manaProduction) throw new Error('Card has no mana ability');
  if (!getAvailableManaColors(state, cardInstanceId).includes(color)) throw new Error('Cannot produce chosen color');

  const handExileAbility = manaProduction.activationZone === 'hand'
    && manaProduction.requiresExileFromHand === true;
  if (handExileAbility) {
    if (card.zone !== 'hand') throw new Error('Card not in hand');
  } else {
    if (card.zone !== 'battlefield') throw new Error('Card not on battlefield');
    if (manaProduction.isTapAbility && card.tapped) throw new Error('Card already tapped');
    if (manaProduction.isTapAbility && isBlockedBySummoningSicknessForTap(state, cardInstanceId)) {
      throw new Error('Summoning sick');
    }
  }

  const amountForColor = (manaColor: ManaColor): number => {
    let amount = manaProduction.amounts[manaColor] ?? 1;
    if (manaProduction.amountScale === 'creaturesYouControl') {
      amount *= [...state.cards.values()].filter(instance => {
        if (instance.ownerId !== playerId || instance.zone !== 'battlefield') return false;
        const cardDef = getCardDefinition(state, instance);
        return cardDef.card_types.includes('creature');
      }).length;
    }
    amount *= manaProductionMultiplier(state, playerId, cardInstanceId);
    return amount;
  };
  const producedMana = (manaProduction.producesAllColors ? manaProduction.colors : [color])
    .map(manaColor => ({ color: manaColor, amount: amountForColor(manaColor) }))
    .filter(entry => entry.amount > 0);

  // Sacrifice-cost mana abilities (Lotus Petal, Tinder Wall, Lotus Bloom, etc.)
  // move the paid permanent away as part of activation. A few silver-bordered
  // old-text cards say to remove the pieces from the game, which we model as
  // exile rather than graveyard.
  const requiresSacrifice = manaProduction.requiresSacrifice === true;
  const sacrificeDestination = manaProduction.exileAfterUse ? 'exile' : 'graveyard';

  const newCards = new Map(state.cards);
  if (manaProduction.requiresDiscardHand) {
    for (const [id, handCard] of newCards) {
      if (handCard.ownerId !== playerId || handCard.zone !== 'hand') continue;
      newCards.set(id, {
        ...handCard,
        zone: getCommanderDestinationZone(state, handCard.instanceId, 'graveyard'),
        tapped: false,
        damage: 0,
        counters: {},
      });
    }
  }

  const sacrificeFilter = manaProduction.sacrificeFilter;
  if (sacrificeFilter) {
    const candidates = [...newCards.values()]
      .filter(candidate => {
        if (candidate.instanceId === cardInstanceId) return false;
        if (candidate.ownerId !== playerId || candidate.zone !== 'battlefield') return false;
        const candidateDef = getCardDefinition(state, candidate);
        return matchesCardFilter(candidateDef, sacrificeFilter);
      })
      .sort((a, b) =>
        sacrificeManaCandidateRank(state, a.instanceId) - sacrificeManaCandidateRank(state, b.instanceId),
      );
    const sacrificed = candidates[0];
    if (!sacrificed) throw new Error('No sacrifice candidate');
    if (sacrificed.isToken) {
      newCards.delete(sacrificed.instanceId);
    } else {
      const destination = getCommanderDestinationZone(state, sacrificed.instanceId, 'graveyard');
      newCards.set(sacrificed.instanceId, {
        ...sacrificed,
        zone: destination,
        tapped: false,
        damage: 0,
        counters: {},
      });
    }
  }

  const sourceAfterCosts = newCards.get(cardInstanceId);
  if (sourceAfterCosts && sourceAfterCosts.zone === 'battlefield') {
    if (requiresSacrifice && sourceAfterCosts.isToken) {
      newCards.delete(cardInstanceId);
    } else {
      newCards.set(cardInstanceId, {
        ...sourceAfterCosts,
        tapped: handExileAbility ? false : manaProduction.isTapAbility ? true : sourceAfterCosts.tapped,
        zone: handExileAbility
          ? getCommanderDestinationZone(state, cardInstanceId, 'exile')
          : requiresSacrifice
            ? getCommanderDestinationZone(state, cardInstanceId, sacrificeDestination)
            : sourceAfterCosts.zone,
      });
    }
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
    let withMana = { ...p };
    for (const produced of producedMana) {
      withMana = {
        ...withMana,
        manaPool: addMana(withMana.manaPool, produced.color, produced.amount),
        ...(sourceProducesSnowMana
          ? {
            snowManaPool: addMana(
              withMana.snowManaPool || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
              produced.color,
              produced.amount,
            ),
          }
          : {}),
      };
      withMana = addRestrictedMana(withMana, produced.color, produced.amount, manaProduction.restriction, {
        sourceInstanceId: cardInstanceId,
        creatureType: card.choices?.chosenCreatureType,
        snow: sourceProducesSnowMana,
      });
    }
    if (manaHasSpellCopyRider(def.oracle_text)) {
      return producedMana.reduce(
        (player, produced) => addConditionalMana(player, produced.color, produced.amount, 'copyRedInstantOrSorcery', {
          sourceInstanceId: cardInstanceId,
          snow: sourceProducesSnowMana,
        }),
        withMana,
      );
    }
    return withMana;
  });

  // ── Slice 7: Tapped-for-mana riders ───────────────────────────────────────
  // Scan continuousEffects for TappedForManaRider modifiers and add bonus mana
  // to the tapping player's pool. Two families:
  //   'attachedLand' — only fires for an Aura attached to THIS land (cardInstanceId).
  //   'anyLand'      — fires for any land tap (Zhur-Taa Ancient family).
  // Resolved synchronously here (no stack trigger) as required by slice design.
  const riderBonusPlayers = newPlayers.map((p, i) => {
    if (i !== playerIndex) return p;
    let withBonus = { ...p };
    for (const ce of (state.continuousEffects ?? [])) {
      if (ce.ability.modifier.kind !== 'TappedForManaRider') continue;
      const rider = ce.ability.modifier;
      // Check scope: 'attachedLand' only fires when the source aura is attached to this land
      if (rider.scope === 'attachedLand') {
        const sourceCard = newCards.get(ce.sourceInstanceId);
        if (!sourceCard || sourceCard.attachedTo !== cardInstanceId) continue;
        if (sourceCard.zone !== 'battlefield') continue;
      } else {
        // 'anyLand' — source must be on battlefield
        const sourceCard = newCards.get(ce.sourceInstanceId);
        if (!sourceCard || sourceCard.zone !== 'battlefield') continue;
      }
      // Add the bonus mana
      if (rider.mana) {
        for (const [colorKey, amount] of Object.entries(rider.mana)) {
          if (!amount) continue;
          withBonus = {
            ...withBonus,
            manaPool: addMana(withBonus.manaPool, colorKey as ManaColor, amount),
          };
        }
      }
      if (rider.anyColor && rider.anyColor > 0) {
        // Any-color bonus: add in the same color the player chose for the land tap
        withBonus = {
          ...withBonus,
          manaPool: addMana(withBonus.manaPool, color, rider.anyColor),
        };
      }
      if (rider.twoAnyColor) {
        // Two-any-color bonus: add 1 of each of the two most-needed colors (or
        // 2 of the chosen color as a safe fallback executed by the AI). For
        // test/engine purposes we add 2 of the chosen mana color.
        withBonus = {
          ...withBonus,
          manaPool: addMana(withBonus.manaPool, color, 2),
        };
      }
      if (rider.chosenColor) {
        // Slice 3: "adds one mana of the chosen color" — Utopia Sprawl family.
        // The source permanent's choices.chosenColor stores the chosen color;
        // if it has not been set yet, produce nothing (honest no-op).
        const sourceCard = newCards.get(ce.sourceInstanceId);
        const chosenManaColor = sourceCard?.choices?.chosenColor;
        if (chosenManaColor) {
          withBonus = {
            ...withBonus,
            manaPool: addMana(withBonus.manaPool, chosenManaColor as ManaColor, 1),
          };
        }
      }
    }
    return withBonus;
  });
  // ───────────────────────────────────────────────────────────────────────────

  let resultState: GameState = { ...state, cards: newCards, players: riderBonusPlayers };
  const sourceTappedForMana = !handExileAbility
    && manaProduction.isTapAbility === true
    && card.zone === 'battlefield'
    && !card.tapped
    && resultState.cards.get(cardInstanceId)?.tapped === true;

  if (sourceTappedForMana) {
    resultState = checkTriggersForEvent(resultState, {
      kind: 'PermanentTapped',
      instanceId: cardInstanceId,
      controllerId: playerId,
      forMana: true,
    });
  }

  return resultState;
}

export function drawCards(state: GameState, playerId: string, count: number): GameState {
  const library = getCardsInZone(state, playerId, 'library');
  const toDraw = Math.min(count, library.length);

  const newCards = new Map(state.cards);
  const drawnIds: string[] = [];
  for (let i = 0; i < toDraw; i++) {
    const card = library[i];
    newCards.set(card.instanceId, { ...card, zone: 'hand' });
    drawnIds.push(card.instanceId);
  }

  const drawnState = { ...state, cards: newCards };
  return drawnIds.length > 0
    ? checkTriggersForEvent(drawnState, {
        kind: 'CardDrawn',
        playerId,
        count: drawnIds.length,
        cardInstanceIds: drawnIds,
      })
    : drawnState;
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

  // CR 613 layer 6: an attached "loses all abilities" aura suppresses the
  // permanent's own activated abilities (Darksteel Mutation, Song of the Dryads).
  if (card.zone === 'battlefield' && instanceLosesAllAbilities(state, cardInstanceId)) {
    return [];
  }

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

  // Slice 7: sorcery-speed gate for "Activate only as a sorcery." /
  // "Activate only during your turn[, and only before attackers are declared]."
  // riders.  The same conditions as casting a sorcery: active player, main phase,
  // empty stack.
  if (ability.timing === 'sorcery') {
    const playerIndex = state.players.findIndex(p => p.id === playerId);
    if (state.activePlayerIndex !== playerIndex) return false;
    if (!MAIN_PHASES.includes(state.phase)) return false;
    if (state.stack.length > 0) return false;
  }

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
    if (!player || !playerCanPayLife(state, playerId, ability.cost.payLife)) return false;
  }

  // Check "sacrifice another creature" cost: must have at least one OTHER creature on the battlefield
  if (ability.cost.sacrifice === 'another-creature') {
    const hasAnotherCreature = [...state.cards.values()].some(c =>
      c.zone === 'battlefield'
      && c.ownerId === playerId
      && c.instanceId !== cardInstanceId
      && isEffectiveCreature(state, c.instanceId)
    );
    if (!hasAnotherCreature) return false;
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
  const abilityTargets = ability.targets as TargetSpec[];
  if (abilityTargets.length > 0) {
    validateTargetChoices(state, playerId, abilityTargets, targets, cardInstanceId);
  }
  let newState = state;

  // === Pay costs (before putting on stack) ===

  // Pay tap cost
  if (ability.cost.tap) {
    const newCards = new Map(newState.cards);
    const card = newCards.get(cardInstanceId)!;
    newCards.set(cardInstanceId, { ...card, tapped: true });
    newState = { ...newState, cards: newCards };
    newState = checkTriggersForEvent(newState, {
      kind: 'PermanentTapped',
      instanceId: cardInstanceId,
      controllerId: playerId,
    });
  }

  // Pay sacrifice cost
  // Track sacrificed creature's power for "sacrifice another creature" (Brion family).
  let sacrificedCreaturePower: number | undefined;
  if (ability.cost.sacrifice === 'self') {
    newState = executeSacrificeSpecific(newState, cardInstanceId);
  } else if (ability.cost.sacrifice === 'another-creature') {
    // Find another creature the controller controls (excluding the source).
    // Selection policy: highest power first; ties broken by lowest CMC (deterministic).
    const candidates = [...newState.cards.values()].filter(c =>
      c.zone === 'battlefield'
      && c.ownerId === playerId
      && c.instanceId !== cardInstanceId
      && isEffectiveCreature(newState, c.instanceId)
    );
    if (candidates.length === 0) throw new Error('No creature to sacrifice');
    // Sort: highest power DESC, then lowest CMC ASC
    candidates.sort((a, b) => {
      const powA = getEffectivePower(newState, a.instanceId);
      const powB = getEffectivePower(newState, b.instanceId);
      if (powB !== powA) return powB - powA;
      const defA = getCardDefinition(newState, a);
      const defB = getCardDefinition(newState, b);
      return (defA.cmc ?? 0) - (defB.cmc ?? 0);
    });
    const chosen = candidates[0];
    // Capture power BEFORE the creature leaves the battlefield.
    sacrificedCreaturePower = getEffectivePower(newState, chosen.instanceId);
    newState = executeSacrificeSpecific(newState, chosen.instanceId);
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
    if (!playerCanPayLife(newState, playerId, ability.cost.payLife)) {
      throw new Error('Cannot pay life cost');
    }
    const newPlayers = newState.players.map((p, i) =>
      i === playerIndex ? { ...p, life: p.life - ability.cost.payLife! } : p
    );
    newState = { ...newState, players: newPlayers };
  }

  // === Put on stack or resolve immediately ===

  // Build namedCardChoices, including sacrificedCreaturePower if applicable.
  const namedCardChoices: Record<string, string> | undefined =
    sacrificedCreaturePower !== undefined
      ? { sacrificedCreaturePower: String(sacrificedCreaturePower) }
      : undefined;

  if (ability.isManaAbility) {
    // Mana abilities resolve immediately
    const effects = ability.effects as Effect[];
    newState = executeEffectsWithSBA(newState, effects, playerId, targets, abilityTargets);
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
      ...(namedCardChoices ? { namedCardChoices } : {}),
      // Slice 6: propagate modal if the activated ability's effect is a modal spell.
      ...(ability.modal ? { modal: ability.modal } : {}),
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
