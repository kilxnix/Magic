// Phase 5: Keyword helpers
// Query and manage keywords on cards

import type { GameState, CardDefinition, CardInstance } from './types';
import { isEffectiveCreature, getEffectiveCardTypes } from './effective-types';
import { getCardDefinition } from './game-state';
import type { ManaColor } from './types';
import { typeLineHasSubtype, typeLineHasType, typeLineHasSupertype } from './type-line';
// Used only inside getKeywordsForInstance at query time; the keywords →
// continuous → executor → keywords import cycle is benign for the same reason
// the existing continuous ↔ executor cycle is (no module-init-time use).
import { evaluateCondition, getEffectiveColors } from './effects/continuous';
import { POWER_LESS_THAN_CANT_BLOCK_RE, ATTACKING_ALONE_EVASION_RE } from './effects/matchers/static-abilities';

export type Keyword =
  | 'Flying'
  | 'Reach'
  | 'Trample'
  | 'Deathtouch'
  | 'First Strike'
  | 'Double Strike'
  | 'Lifelink'
  | 'Vigilance'
  | 'Haste'
  | 'Menace'
  | 'Defender'
  | 'Hexproof'
  | 'Shroud'
  | 'Indestructible'
  | 'Ward'
  | 'Flash'
  | 'Unblockable'
  | 'CannotBlock'
  | 'CannotAttack'
  /**
   * Slice 6: "can attack as though it didn't have defender" — suppresses the
   * Defender check in canAttackThisTurn. Granted by static abilities (Felothar
   * the Steadfast team form, Ogre Jailbreaker as-long-as form) as a continuous
   * keyword, and by activated/triggered abilities as a turn-scoped grantedKeyword.
   * Not a printed Magic keyword; only used internally.
   */
  | 'IgnoreDefender'
  /**
   * Slice 8: "This creature can't be blocked as long as it's attacking alone."
   * (Dream Prowler family). Recognition-only marker; enforcement is in canBlock
   * (attackerHasAttackingAloneEvasion), which reads the oracle text directly and
   * gates on state.combat?.attackers.length === 1. Not a printed Magic keyword.
   */
  | 'AttackingAloneEvasion';

// Normalize keyword strings for comparison
function normalizeKeyword(keyword: string): string {
  return keyword.toLowerCase().replace(/[\s_-]/g, '');
}

// Map from normalized keyword to canonical Keyword type
const KEYWORD_MAP: Record<string, Keyword> = {
  'flying': 'Flying',
  'reach': 'Reach',
  'trample': 'Trample',
  'deathtouch': 'Deathtouch',
  'firststrike': 'First Strike',
  'doublestrike': 'Double Strike',
  'lifelink': 'Lifelink',
  'vigilance': 'Vigilance',
  'haste': 'Haste',
  'menace': 'Menace',
  'defender': 'Defender',
  'hexproof': 'Hexproof',
  'shroud': 'Shroud',
  'indestructible': 'Indestructible',
  'ward': 'Ward',
  'flash': 'Flash',
  'unblockable': 'Unblockable',
  'cannotblock': 'CannotBlock',
  'cantblock': 'CannotBlock',
  "can'tblock": 'CannotBlock',
  'cannotattack': 'CannotAttack',
  'cantattack': 'CannotAttack',
  "can'tattack": 'CannotAttack',
  // Slice 6: pseudo-keyword for "can attack as though it didn't have defender"
  'ignoredefender': 'IgnoreDefender',
};

// Set of keyword names that can be granted by keyword counters
const KEYWORD_COUNTER_NAMES = new Set([
  'flying', 'trample', 'deathtouch', 'lifelink', 'vigilance', 'menace',
  'reach', 'firststrike', 'doublestrike', 'haste', 'hexproof',
  'indestructible', 'unblockable', 'defender', 'shroud', 'ward', 'flash',
]);

const COLOR_WORD_TO_MANA: Record<string, ManaColor> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

function sourceDefinition(state: GameState, sourceId: string): CardDefinition | undefined {
  const stackItem = state.stack.find(item => {
    if (item.id === sourceId) return true;
    return 'cardInstanceId' in item && item.cardInstanceId === sourceId;
  });
  const cardId = stackItem && 'cardInstanceId' in stackItem ? stackItem.cardInstanceId : sourceId;
  const card = state.cards.get(cardId);
  return card ? getCardDefinition(state, card) : undefined;
}

function sourceColors(state: GameState, sourceId: string): Set<ManaColor> {
  const def = sourceDefinition(state, sourceId);
  return new Set(def?.colors || []);
}

function protectionClausesFor(state: GameState, instanceId: string): string[] {
  const card = state.cards.get(instanceId);
  if (!card) return [];
  const def = getCardDefinition(state, card);
  const text = `${def.oracle_text || ''}\n${def.keywords.join('\n')}`.toLowerCase();
  const ownClauses: string[] = text.match(/protection from [^.\n]+/g) || [];

  // Slice 11: also harvest "protection from <quality>" entries from grantedKeywords
  // set by the transient GrantKeyword executor (e.g. "target creature gains
  // protection from white until end of turn" / Center Soul / Brave the Elements).
  // This makes transient protection grants genuinely enforceable — they flow through
  // isProtectedFromSource / getProtectionColors exactly as printed protection does.
  const grantedClauses: string[] = [];
  for (const kw of card.grantedKeywords || []) {
    const lower = kw.toLowerCase();
    if (/^protection from /.test(lower)) {
      grantedClauses.push(lower);
    }
  }

  // Slice 5: also collect "protection from ..." clauses from attached auras /
  // equipment that grant protection to this permanent ("enchanted/equipped
  // creature has protection from the chosen color").
  const auraClauses: string[] = [];
  for (const [, other] of state.cards) {
    if (other.attachedTo !== instanceId || other.zone !== 'battlefield') continue;
    const otherDef = getCardDefinition(state, other);
    const otherText = `${otherDef.oracle_text || ''}\n${otherDef.keywords.join('\n')}`.toLowerCase();
    // Only pick up "protection from X" clauses that appear in an
    // "enchanted/equipped creature has/gains protection from X" context.
    const matches = otherText.match(/(?:enchanted|equipped) creature [^.]*protection from [^.\n]+/g) || [];
    for (const match of matches) {
      const protMatch = match.match(/protection from [^.\n]+/g);
      if (protMatch) auraClauses.push(...protMatch);
    }
  }

  return [...ownClauses, ...grantedClauses, ...auraClauses];
}

/**
 * Parse color-specific protection clauses from oracle text.
 * This intentionally handles the common Commander/Arena-critical case:
 * "protection from red", "protection from white and from black", etc.
 *
 * Slice 5: also resolves "protection from the chosen color" by looking up
 * choices.chosenColor on the protecting permanent or its attached aura/equipment
 * (Floating Shield, Order of the Stars, Glory family).
 */
export function getProtectionColors(state: GameState, instanceId: string): Set<ManaColor> {
  const colors = new Set<ManaColor>();

  const card = state.cards.get(instanceId);
  // Own stored chosen color.
  const ownChosenColor = card?.choices?.chosenColor;

  // Build a map from aura instanceId → its chosenColor, for "protection from the
  // chosen color" clauses that come from attached auras (Floating Shield family).
  const auraChosenColors = new Map<string, 'W' | 'U' | 'B' | 'R' | 'G'>();
  for (const [, other] of state.cards) {
    if (other.attachedTo !== instanceId || other.zone !== 'battlefield') continue;
    if (other.choices?.chosenColor) {
      auraChosenColors.set(other.instanceId, other.choices.chosenColor);
    }
  }

  for (const clause of protectionClausesFor(state, instanceId)) {
    // Slice 5: "protection from the chosen color" — resolve via stored choice.
    if (/\bthe\s+chosen\s+color\b/.test(clause)) {
      // If the own permanent has a chosenColor (Order of Stars, Glory), use it.
      if (ownChosenColor) colors.add(ownChosenColor);
      // Also add colors from any attached aura's chosenColor (Floating Shield).
      for (const auraColor of auraChosenColors.values()) {
        colors.add(auraColor);
      }
      continue;
    }
    for (const [word, color] of Object.entries(COLOR_WORD_TO_MANA)) {
      if (new RegExp(`\\b${word}\\b`).test(clause)) {
        colors.add(color);
      }
    }
  }

  return colors;
}

function sourceMatchesProtectionClause(def: CardDefinition, clause: string): boolean {
  const sourceTypes = new Set(def.card_types.map(type => type.toLowerCase()));
  const hasType = (type: string) => sourceTypes.has(type) || typeLineHasType(def.type_line, type);

  if (/\bartifacts?\b/.test(clause) && hasType('artifact')) return true;
  if (/\bcreatures?\b/.test(clause) && hasType('creature')) return true;
  if (/\benchantments?\b/.test(clause) && hasType('enchantment')) return true;
  if (/\bplaneswalkers?\b/.test(clause) && hasType('planeswalker')) return true;
  if (/\binstants?\b/.test(clause) && hasType('instant')) return true;
  if (/\bsorceries?\b/.test(clause) && hasType('sorcery')) return true;
  if (/\bmonocolored\b/.test(clause) && def.colors.length === 1) return true;
  if (/\bmulticolored\b/.test(clause) && def.colors.length > 1) return true;
  if (/\bcolorless\b/.test(clause) && def.colors.length === 0) return true;

  return false;
}

export function isProtectedFromSource(
  state: GameState,
  permanentId: string,
  sourceId: string | undefined,
): boolean {
  if (!sourceId) return false;
  const protectionColors = getProtectionColors(state, permanentId);
  for (const color of sourceColors(state, sourceId)) {
    if (protectionColors.has(color)) return true;
  }
  const def = sourceDefinition(state, sourceId);
  if (!def) return false;
  return protectionClausesFor(state, permanentId)
    .some(clause => sourceMatchesProtectionClause(def, clause));
}

/**
 * Check if a card definition has a specific keyword.
 * Overload: hasKeyword(state, instanceId, keyword) — checks definition, continuous effects,
 * equipment, AND keyword counters.
 */
export function hasKeyword(def: CardDefinition, keyword: Keyword): boolean;
export function hasKeyword(state: GameState, instanceId: string, keyword: string): boolean;
export function hasKeyword(
  defOrState: CardDefinition | GameState,
  keywordOrInstanceId: Keyword | string,
  keywordStr?: string,
): boolean {
  // 3-arg form: (state, instanceId, keyword)
  if (keywordStr !== undefined) {
    const state = defOrState as GameState;
    const instanceId = keywordOrInstanceId as string;

    // Check via instanceHasKeyword (definition + continuous effects + equipment)
    const normalizedLookup = normalizeKeyword(keywordStr);
    const canonicalKeyword = KEYWORD_MAP[normalizedLookup] as Keyword | undefined;
    if (canonicalKeyword && instanceHasKeyword(state, instanceId, canonicalKeyword)) {
      return true;
    }

    // Keyword counter grant
    const card = state.cards.get(instanceId);
    if (card?.counters) {
      for (const counterName of Object.keys(card.counters)) {
        const counterNorm = normalizeKeyword(counterName);
        if (!KEYWORD_COUNTER_NAMES.has(counterNorm)) continue;
        if (counterNorm === normalizedLookup && (card.counters[counterName] ?? 0) > 0) {
          return true;
        }
      }
    }

    return false;
  }

  // 2-arg form: (def, keyword)
  const def = defOrState as CardDefinition;
  const keyword = keywordOrInstanceId as Keyword;
  const normalizedTarget = normalizeKeyword(keyword);
  for (const k of def.keywords) {
    if (normalizeKeyword(k) === normalizedTarget) {
      return true;
    }
  }
  return false;
}

/**
 * Get all keywords for a card definition.
 */
export function getKeywordsFromDefinition(def: CardDefinition): Set<Keyword> {
  const result = new Set<Keyword>();
  for (const k of def.keywords) {
    const normalized = normalizeKeyword(k);
    const canonical = KEYWORD_MAP[normalized];
    if (canonical) {
      result.add(canonical);
    }
  }
  return result;
}

/**
 * Get all keywords for a card instance.
 * Returns definition keywords plus any keywords granted by continuous effects.
 */
export function getKeywordsForInstance(state: GameState, instanceId: string): Set<Keyword> {
  const card = state.cards.get(instanceId);
  if (!card) return new Set();

  const def = getCardDefinition(state, card);

  // Base keywords from definition
  const keywords = getKeywordsFromDefinition(def);

  // One-shot keyword grants such as "target creature gains trample until end of turn".
  for (const granted of card.grantedKeywords || []) {
    const canonical = KEYWORD_MAP[normalizeKeyword(granted)];
    if (canonical) {
      keywords.add(canonical);
    }
  }

  for (const [counterName, count] of Object.entries(card.counters || {})) {
    if (count <= 0) continue;
    const normalized = normalizeKeyword(counterName);
    if (!KEYWORD_COUNTER_NAMES.has(normalized)) continue;
    const canonical = KEYWORD_MAP[normalized];
    if (canonical) {
      keywords.add(canonical);
    }
  }

  // Phase 15: Add keywords granted by continuous effects
  if (state.continuousEffects) {
    for (const ce of state.continuousEffects) {
      if (ce.ability.modifier.kind !== 'GrantKeyword' && ce.ability.modifier.kind !== 'GrantKeywords') continue;

      // Check source is still on the battlefield
      const source = state.cards.get(ce.sourceInstanceId);
      if (!source || source.zone !== 'battlefield') continue;

      // Conditional statics ("as long as <condition>, ... has <keyword>")
      // only grant while the condition holds.
      if (ce.ability.condition
          && !evaluateCondition(state, ce.ability.condition, ce.controllerId, ce.sourceInstanceId)) continue;

      // Check selfOnly ("~ has <keyword> ..." grants to the source only) —
      // mirrors continuous.ts isAffectedBy.
      if (ce.ability.selfOnly && instanceId !== ce.sourceInstanceId) continue;

      // Check excludeSelf
      if (ce.ability.excludeSelf && instanceId === ce.sourceInstanceId) continue;

      // Check controller filter
      if (ce.ability.controller === 'you' && card.ownerId !== ce.controllerId) continue;
      if (ce.ability.controller === 'opponent' && card.ownerId === ce.controllerId) continue;

      // Must be on battlefield
      if (card.zone !== 'battlefield') continue;

      // Check card filter
      const filter = ce.ability.filter;
      if (filter.types || filter.subtypes || filter.colors || filter.cmc || filter.power || filter.chosenCreatureTypeFromSource) {
        // Simple filter matching inline (avoid circular import from executor.ts)
        let matches = true;
        if (filter.types) {
          const hasType = filter.types.some((t: string) =>
            def.card_types.includes(t as any) || typeLineHasType(def.type_line, t)
          );
          if (!hasType) matches = false;
        }
        if (matches && filter.subtypes) {
          const hasSub = filter.subtypes.some((st: string) => typeLineHasSubtype(def.type_line, st));
          if (!hasSub) matches = false;
        }
        if (matches && filter.excludeSubtypes) {
          const hasExcludedSub = filter.excludeSubtypes.some((st: string) => typeLineHasSubtype(def.type_line, st));
          if (hasExcludedSub) matches = false;
        }
        if (matches && filter.power) {
          const effectivePower = (def.power ?? 0)
            + (card.counters['+1/+1'] || 0)
            - (card.counters['-1/-1'] || 0)
            + (card.counters['_powerMod'] || 0);
          const { op, value } = filter.power;
          if (op === 'eq' && effectivePower !== value) matches = false;
          if (op === 'lte' && effectivePower > value) matches = false;
          if (op === 'gte' && effectivePower < value) matches = false;
        }
        // Slice 5/11: chosen creature type filter — only grant the keyword to
        // creatures whose subtype matches the source's stored chosenCreatureType.
        // Mirrors the matchesCardFilter (executor.ts) check used by isAffectedBy
        // (continuous.ts) so keyword queries stay consistent with P/T queries.
        if (matches && filter.chosenCreatureTypeFromSource) {
          const source = state.cards.get(ce.sourceInstanceId);
          const chosenType = source?.choices?.chosenCreatureType?.trim().toLowerCase();
          if (!chosenType || !typeLineHasSubtype(def.type_line, chosenType)) matches = false;
        }
        if (!matches) continue;
      }

      const modifierKeywords = ce.ability.modifier.kind === 'GrantKeyword'
        ? [ce.ability.modifier.keyword]
        : ce.ability.modifier.keywords;
      for (const keyword of modifierKeywords) {
        const canonical = KEYWORD_MAP[normalizeKeyword(keyword)];
        if (canonical) {
          keywords.add(canonical);
        }
      }
    }
  }

  for (const lost of card.lostKeywords || []) {
    const canonical = KEYWORD_MAP[normalizeKeyword(lost)];
    if (canonical) {
      keywords.delete(canonical);
    }
  }

  return keywords;
}

/**
 * CR 613 layer 6: true when an attached "loses all abilities" aura
 * (Darksteel Mutation, Song of the Dryads, Lignify, Ovinize, Kenrith's
 * Transformation) is suppressing the permanent's OWN printed abilities.
 * Used to gate keywords, triggered abilities, and activated abilities alike.
 */
export function instanceLosesAllAbilities(state: GameState, instanceId: string): boolean {
  // Slice 7 (transient polymorph): "Until end of turn, target creature loses all
  // abilities ..." (Turn to Frog / Dance of the Skywise / Turn//Burn family).
  const card = state.cards.get(instanceId);
  if (card?.transientLosesAllAbilities) return true;

  for (const [, otherCard] of state.cards) {
    if (otherCard.attachedTo === instanceId && otherCard.zone === 'battlefield'
        && getCardDefinition(state, otherCard).equipmentBonus?.losesAllAbilities) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a card instance has a specific keyword.
 * Includes keywords from the card definition, continuous effects, and attached equipment.
 */
export function instanceHasKeyword(state: GameState, instanceId: string, keyword: Keyword): boolean {
  const card = state.cards.get(instanceId);
  if (card?.lostKeywords?.some(lost => normalizeKeyword(lost) === normalizeKeyword(keyword))) {
    return false;
  }

  // CR 613 layer 6: an attached "loses all abilities" aura (Darksteel Mutation,
  // Lignify, Ovinize) suppresses the permanent's OWN printed + continuous
  // keywords. Keywords GRANTED by an attached aura/equipment (the cached
  // equipmentBonus.keywords loop below) still apply — they have a later timestamp.
  const losesAllAbilities = instanceLosesAllAbilities(state, instanceId);

  if (!losesAllAbilities && getKeywordsForInstance(state, instanceId).has(keyword)) {
    return true;
  }

  // Check equipment keywords from cached data
  for (const [, otherCard] of state.cards) {
    if (otherCard.attachedTo !== instanceId || otherCard.zone !== 'battlefield') continue;
    const equipDef = getCardDefinition(state, otherCard);
    if (equipDef?.equipmentBonus?.keywords.some(
      k => k.toLowerCase() === keyword.toLowerCase()
    )) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a creature can attack this turn (considering summoning sickness and haste).
 */
export function canAttackThisTurn(state: GameState, instanceId: string): boolean {
  const card = state.cards.get(instanceId);
  if (!card) return false;
  if (card.zone !== 'battlefield') return false;

  if (!isEffectiveCreature(state, instanceId)) return false;

  // Check defender — bypass if the creature has IgnoreDefender (pseudo-keyword
  // granted by "can attack as though it didn't have defender" statics/activations).
  // IgnoreDefender is in KEYWORD_MAP so instanceHasKeyword covers both the
  // turn-scoped grantedKeywords path and the continuous static path.
  if (instanceHasKeyword(state, instanceId, 'Defender')
      && !instanceHasKeyword(state, instanceId, 'IgnoreDefender')) {
    return false;
  }
  if (instanceHasKeyword(state, instanceId, 'CannotAttack')) {
    return false;
  }

  // Check summoning sickness (haste ignores it)
  if (card.summoningSick && !instanceHasKeyword(state, instanceId, 'Haste')) {
    return false;
  }

  return true;
}

/**
 * Check if a creature should tap when attacking (vigilance prevents this).
 */
export function shouldTapWhenAttacking(state: GameState, instanceId: string): boolean {
  return !instanceHasKeyword(state, instanceId, 'Vigilance');
}

// ============================================================================
// Slice 8: "attacking alone" evasion
// (Dream Prowler family: "This creature can't be blocked as long as it's attacking alone.")
// Enforcement: read oracle text directly; state.combat.attackers.length === 1 is the
// "attacking alone" predicate (exactly one creature is attacking, CR 508.4).
// canBlock() is the single enforcement site, mirroring attackerHasConditionalEvasion.
// ============================================================================

/**
 * True when the attacker's oracle text carries the attacking-alone evasion sentence
 * AND there is currently exactly one attacker (i.e. it IS attacking alone).
 * Suppressed when the attacker has "loses all abilities" aura.
 */
function attackerHasAttackingAloneEvasion(
  state: GameState,
  attackerId: string,
): boolean {
  const card = state.cards.get(attackerId);
  if (!card) return false;
  if (instanceLosesAllAbilities(state, attackerId)) return false;
  const def = getCardDefinition(state, card);
  const text = (def.oracle_text || '').toLowerCase().replace(/\([^)]*\)/g, '');
  if (!ATTACKING_ALONE_EVASION_RE.test(text)) return false;
  // The creature is attacking alone if it's the only attacker in current combat.
  return (state.combat?.attackers.length ?? 0) === 1;
}

/**
 * Check if a creature can block another creature (considering flying/reach).
 */
export function canBlock(
  state: GameState,
  blockerId: string,
  attackerId: string,
): boolean {
  if (instanceHasKeyword(state, blockerId, 'CannotBlock')) {
    return false;
  }

  if (instanceHasKeyword(state, attackerId, 'Unblockable')) {
    return false;
  }

  // "This creature can't be blocked." read straight from oracle text (CR
  // 509.1b). Mirrors getLandwalkKeys' oracle scan so a face whose only evasion
  // is the inline sentence (not a keywords-array entry) is genuinely enforced.
  if (attackerHasCantBeBlockedText(state, attackerId)) {
    return false;
  }

  if (isProtectedFromSource(state, attackerId, blockerId)) {
    return false;
  }

  // Landwalk (CR 702.14): the attacker can't be blocked while the defending
  // player (the blocker's controller) controls a land of the walked type.
  // Also covers snow-walk variants (snow forestwalk etc.).
  const blocker = state.cards.get(blockerId);
  if (blocker && hasActiveLandwalk(state, attackerId, blocker.ownerId)) {
    return false;
  }

  // Conditional evasion: "can't be blocked as long as defending player controls X"
  // (Hazy Homunculus, Tanglewalker, and others). Enforced by reading oracle text
  // directly; attackerHasConditionalEvasion is the single enforcement site.
  if (blocker && attackerHasConditionalEvasion(state, attackerId, blocker.ownerId)) {
    return false;
  }

  // Slice 8: "attacking alone" evasion — "can't be blocked as long as it's attacking alone"
  // (Dream Prowler family). Enforced by reading oracle text directly;
  // attackerHasAttackingAloneEvasion is the single enforcement site.
  if (attackerHasAttackingAloneEvasion(state, attackerId)) {
    return false;
  }

  // Flying creatures can only be blocked by creatures with flying or reach
  if (instanceHasKeyword(state, attackerId, 'Flying')) {
    if (!instanceHasKeyword(state, blockerId, 'Flying') &&
        !instanceHasKeyword(state, blockerId, 'Reach')) {
      return false;
    }
  }

  // "This creature can block only creatures with flying." (Welkin Tern family):
  // the BLOCKER's own restriction, read straight from its oracle text — it may
  // block only attackers with flying.
  if (!instanceHasKeyword(state, attackerId, 'Flying')
      && blockerCanBlockOnlyFlyingText(state, blockerId)) {
    return false;
  }

  // Other evasion keywords: fear / intimidate / shadow / horsemanship / skulk.
  if (!blockerSatisfiesEvasion(state, blockerId, attackerId)) {
    return false;
  }

  // Slice 10 (combat statics): "Creatures with power less than this creature's power
  // can't block it." (Wandering Wolf family). Like skulk (which prevents big creatures
  // from blocking small skulk attackers), this prevents small creatures from blocking
  // this attacker. The blocker's effective power must be ≥ the attacker's effective power.
  if (attackerHasPowerLessRestriction(state, attackerId)) {
    if (inlineEffectivePower(state, blockerId) < inlineEffectivePower(state, attackerId)) {
      return false;
    }
  }

  return true;
}

/**
 * Landwalk: a creature with "<type>walk" can't be blocked as long as the
 * defending player controls a land of that type (CR 702.14). Generic "landwalk"
 * applies if the defender controls any land. We read the landwalk keyword(s)
 * straight from the creature's printed/granted keywords and oracle text — the
 * KEYWORD_MAP intentionally does NOT contain landwalk (it's enforced only here
 * in combat, never queried generically), mirroring how MustAttackEachCombat is
 * read directly by combat.ts. canBlock() is the single enforcement site.
 */
const LANDWALK_SUBTYPES: Record<string, string | null> = {
  swampwalk: 'Swamp',
  forestwalk: 'Forest',
  islandwalk: 'Island',
  mountainwalk: 'Mountain',
  plainswalk: 'Plains',
  plainwalk: 'Plains',
  landwalk: null, // generic: any land
};

/**
 * Snow-walk variants: "Snow <Basictype>walk" means "can't be blocked while the
 * defending player controls a SNOW land of that basic type" (CR 702.14 extended).
 * Keys are normalized forms of the oracle keyword (e.g. "snowforestwalk").
 * Values are the required land subtype (e.g. "Forest").
 */
const SNOW_LANDWALK_SUBTYPES: Record<string, string> = {
  snowswampwalk: 'Swamp',
  snowforestwalk: 'Forest',
  snowislandwalk: 'Island',
  snowmountainwalk: 'Mountain',
  snowplainswalk: 'Plains',
  snowplainwalk: 'Plains',
};

function landwalkKey(token: string): string | undefined {
  const normalized = token.toLowerCase().replace(/[\s_-]/g, '');
  if (normalized in LANDWALK_SUBTYPES) return normalized;
  if (normalized in SNOW_LANDWALK_SUBTYPES) return normalized;
  return undefined;
}

/**
 * Return the set of landwalk keys (e.g. "swampwalk", "landwalk") a creature has,
 * reading printed keywords, granted keywords, and a scan of its oracle text. An
 * attached "loses all abilities" aura suppresses the creature's own landwalk.
 */
function getLandwalkKeys(state: GameState, instanceId: string): Set<string> {
  const result = new Set<string>();
  const card = state.cards.get(instanceId);
  if (!card) return result;

  if (instanceLosesAllAbilities(state, instanceId)) return result;

  const def = getCardDefinition(state, card);
  const sources: string[] = [...def.keywords, ...(card.grantedKeywords || [])];
  for (const kw of sources) {
    const key = landwalkKey(kw);
    if (key) result.add(key);
  }

  // Oracle-text scan catches faces that carry the landwalk word inline rather
  // than in the keywords array (the parser marker path relies on this too).
  // We skip plain landwalk keys when preceded by "snow" (e.g. "snow forestwalk"
  // should not also trigger plain "forestwalk"). The negative-lookbehind regex
  // `(?<!snow\s)` guards against this.
  const text = (def.oracle_text || '').toLowerCase();
  for (const key of Object.keys(LANDWALK_SUBTYPES)) {
    // Match the landwalk key but not when it's immediately preceded by "snow "
    // (which would mean it's part of a snow-walk form handled separately below).
    if (new RegExp(`(?<![a-z])(?<!snow\\s)${key}\\b`).test(text)) result.add(key);
  }
  // Snow-walk variants: "snow forestwalk" etc. (normalized: "snowforestwalk").
  // These appear as a two-word phrase in oracle text, so we match the normalized
  // form after stripping spaces: "snow forestwalk" → "snowforestwalk".
  const textNoSpaces = text.replace(/\s+/g, '');
  for (const key of Object.keys(SNOW_LANDWALK_SUBTYPES)) {
    if (textNoSpaces.includes(key)) result.add(key);
  }

  // A landwalk keyword the creature was explicitly made to lose.
  for (const lost of card.lostKeywords || []) {
    const key = landwalkKey(lost);
    if (key) result.delete(key);
  }

  return result;
}

/** True if `playerId` controls a land of the given subtype (null = any land). */
function controlsLandOfType(state: GameState, playerId: string, subtype: string | null): boolean {
  for (const card of state.cards.values()) {
    if (card.ownerId !== playerId || card.zone !== 'battlefield') continue;
    const types = getEffectiveCardTypes(state, card.instanceId);
    if (!types.includes('land')) continue;
    if (subtype === null) return true;
    const def = getCardDefinition(state, card);
    if (typeLineHasSubtype(def.type_line, subtype)) return true;
  }
  return false;
}

/** True if `playerId` controls a SNOW land of the given subtype. */
function controlsSnowLandOfType(state: GameState, playerId: string, subtype: string): boolean {
  for (const card of state.cards.values()) {
    if (card.ownerId !== playerId || card.zone !== 'battlefield') continue;
    const types = getEffectiveCardTypes(state, card.instanceId);
    if (!types.includes('land')) continue;
    const def = getCardDefinition(state, card);
    if (!typeLineHasSupertype(def.type_line, 'snow')) continue;
    if (typeLineHasSubtype(def.type_line, subtype)) return true;
  }
  return false;
}

/**
 * CR 702.14: true when `attackerId` has a landwalk ability that the
 * `defendingPlayerId` is currently subject to (controls a land of that type),
 * making the attacker unblockable by that player's creatures.
 */
export function hasActiveLandwalk(
  state: GameState,
  attackerId: string,
  defendingPlayerId: string,
): boolean {
  const keys = getLandwalkKeys(state, attackerId);
  for (const key of keys) {
    if (key in SNOW_LANDWALK_SUBTYPES) {
      // Snow-walk: defender must control a SNOW land of the required subtype.
      if (controlsSnowLandOfType(state, defendingPlayerId, SNOW_LANDWALK_SUBTYPES[key])) {
        return true;
      }
    } else {
      if (controlsLandOfType(state, defendingPlayerId, LANDWALK_SUBTYPES[key])) {
        return true;
      }
    }
  }
  return false;
}

// ============================================================================
// Conditional evasion: "can't be blocked as long as defending player controls X"
// (Hazy Homunculus / Tanglewalker / Bouncing Beebles family). Like landwalk,
// enforcement is read straight from the attacker's oracle text; canBlock() is
// the single site. Supported filter predicates: untapped land, artifact land,
// basic/snow land subtype, artifact, enchantment, creature, untapped/tapped
// creature, and a <color> permanent. Exotic predicates are declined (honest-only).
// ============================================================================

/**
 * Conditional-evasion board filter parsed from oracle text.
 * Describes what the defending player must control for the attacker to be unblockable.
 */
type ConditionalEvasionFilter =
  | { kind: 'untappedLand' }
  | { kind: 'artifactLand' }
  | { kind: 'snowLandOfSubtype'; subtype: string }
  | { kind: 'landOfSubtype'; subtype: string }
  | { kind: 'artifact' }
  | { kind: 'enchantment' }
  | { kind: 'creature' }
  | { kind: 'untappedCreature' }
  | { kind: 'tappedCreature' }
  | { kind: 'colorPermanent'; color: ManaColor };

/**
 * Supported basic land subtypes for conditional evasion (the oracle text mentions
 * "an Island", "a Forest", "a snow Forest", etc.). Only the five basic types are
 * checked here — exotic subtypes are declined for honesty.
 */
const BASIC_LAND_SUBTYPES = new Set(['plains', 'island', 'swamp', 'mountain', 'forest']);

/**
 * Color name → ManaColor symbol mapping for conditional evasion filters.
 * Matches "a <color> permanent" oracle text forms.
 */
const COLOR_NAME_TO_MANA: Record<string, ManaColor> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

/**
 * Parse the conditional defending-player-board predicate from an explicit
 * "can't be blocked as long as defending player controls <filter>" clause.
 *
 * Accepted forms for <filter>:
 *   "an untapped land"           → { kind: 'untappedLand' }
 *   "an artifact land"           → { kind: 'artifactLand' }
 *   "a snow <BasicType>"         → { kind: 'snowLandOfSubtype', subtype }
 *   "an <BasicType>"             → { kind: 'landOfSubtype', subtype }
 *   "an artifact"                → { kind: 'artifact' }
 *   "an enchantment"             → { kind: 'enchantment' }
 *   "a creature"                 → { kind: 'creature' }
 *   "an untapped creature"       → { kind: 'untappedCreature' }
 *   "a tapped creature"          → { kind: 'tappedCreature' }
 *   "a <color> permanent"        → { kind: 'colorPermanent', color }
 *
 * Returns null for unrecognized predicates (honest: decline rather than misfire).
 */
function parseConditionalEvasionFilter(filterText: string): ConditionalEvasionFilter | null {
  const t = filterText.trim().toLowerCase();
  if (t === 'an untapped land') return { kind: 'untappedLand' };
  if (t === 'an artifact land') return { kind: 'artifactLand' };
  // "a snow <BasicType>" (Rime Dryad: "a snow Forest")
  const snowMatch = /^a snow\s+(\w+)$/.exec(t);
  if (snowMatch && BASIC_LAND_SUBTYPES.has(snowMatch[1])) {
    return { kind: 'snowLandOfSubtype', subtype: snowMatch[1] };
  }
  // Non-land board conditions — must check before the generic "an <word>" branch.
  if (t === 'an artifact') return { kind: 'artifact' };
  if (t === 'an enchantment') return { kind: 'enchantment' };
  if (t === 'a creature') return { kind: 'creature' };
  if (t === 'an untapped creature') return { kind: 'untappedCreature' };
  if (t === 'a tapped creature') return { kind: 'tappedCreature' };
  // "a <color> permanent" (Bouncing/Bubbling Beebles family)
  const colorPermMatch = /^a (white|blue|black|red|green) permanent$/.exec(t);
  if (colorPermMatch) {
    const color = COLOR_NAME_TO_MANA[colorPermMatch[1]];
    if (color) return { kind: 'colorPermanent', color };
  }
  // "an <BasicType>" (Islandwalk reminder: "an Island") — basic land subtypes only
  const basicMatch = /^an?\s+(\w+)$/.exec(t);
  if (basicMatch && BASIC_LAND_SUBTYPES.has(basicMatch[1])) {
    return { kind: 'landOfSubtype', subtype: basicMatch[1] };
  }
  return null;
}

/** True when the defending player satisfies the conditional evasion board filter. */
function filterMatchesDefendingPlayer(
  state: GameState,
  defendingPlayerId: string,
  filter: ConditionalEvasionFilter,
): boolean {
  switch (filter.kind) {
    case 'untappedLand':
      for (const card of state.cards.values()) {
        if (card.ownerId !== defendingPlayerId || card.zone !== 'battlefield') continue;
        const types = getEffectiveCardTypes(state, card.instanceId);
        if (!types.includes('land')) continue;
        if (!card.tapped) return true;
      }
      return false;
    case 'artifactLand':
      for (const card of state.cards.values()) {
        if (card.ownerId !== defendingPlayerId || card.zone !== 'battlefield') continue;
        const types = getEffectiveCardTypes(state, card.instanceId);
        if (!types.includes('land') || !types.includes('artifact')) continue;
        return true;
      }
      return false;
    case 'snowLandOfSubtype':
      return controlsSnowLandOfType(state, defendingPlayerId, filter.subtype);
    case 'landOfSubtype':
      return controlsLandOfType(state, defendingPlayerId, filter.subtype);
    case 'artifact':
      for (const card of state.cards.values()) {
        if (card.ownerId !== defendingPlayerId || card.zone !== 'battlefield') continue;
        const types = getEffectiveCardTypes(state, card.instanceId);
        if (types.includes('artifact')) return true;
      }
      return false;
    case 'enchantment':
      for (const card of state.cards.values()) {
        if (card.ownerId !== defendingPlayerId || card.zone !== 'battlefield') continue;
        const types = getEffectiveCardTypes(state, card.instanceId);
        if (types.includes('enchantment')) return true;
      }
      return false;
    case 'creature':
      for (const card of state.cards.values()) {
        if (card.ownerId !== defendingPlayerId || card.zone !== 'battlefield') continue;
        if (isEffectiveCreature(state, card.instanceId)) return true;
      }
      return false;
    case 'untappedCreature':
      for (const card of state.cards.values()) {
        if (card.ownerId !== defendingPlayerId || card.zone !== 'battlefield') continue;
        if (!isEffectiveCreature(state, card.instanceId)) continue;
        if (!card.tapped) return true;
      }
      return false;
    case 'tappedCreature':
      for (const card of state.cards.values()) {
        if (card.ownerId !== defendingPlayerId || card.zone !== 'battlefield') continue;
        if (!isEffectiveCreature(state, card.instanceId)) continue;
        if (card.tapped) return true;
      }
      return false;
    case 'colorPermanent':
      for (const card of state.cards.values()) {
        if (card.ownerId !== defendingPlayerId || card.zone !== 'battlefield') continue;
        const colors = getEffectiveColors(state, card.instanceId);
        if (colors.includes(filter.color)) return true;
      }
      return false;
  }
}

/**
 * Regex matching the explicit conditional-evasion sentence forms:
 *  "This creature can't be blocked as long as defending player controls <filter>."
 *  "Each creature you control can't be blocked as long as defending player controls <filter>."
 *  (Also matches the reminder-text form found inside parentheses, already stripped by the
 *   caller via oracle text preprocessing.)
 */
const CONDITIONAL_EVASION_RE =
  /\bcan['']?t be blocked as long as defending player controls (.+?)\.?\s*$/i;

/**
 * CR 702.14 extension: true when the attacker's oracle text carries a conditional
 * "can't be blocked as long as defending player controls <filter>" sentence that
 * currently fires (the filter matches the defending player's board).
 *
 * Only claims sentences the engine can actually evaluate (see parseConditionalEvasionFilter).
 * Suppressed by an attached "loses all abilities" aura. The parser marker added
 * by matchConditionalEvasion in static-abilities.ts is recognition-only; this
 * function is the single enforcement site.
 */
function attackerHasConditionalEvasion(
  state: GameState,
  attackerId: string,
  defendingPlayerId: string,
): boolean {
  const card = state.cards.get(attackerId);
  if (!card) return false;
  if (instanceLosesAllAbilities(state, attackerId)) return false;
  const def = getCardDefinition(state, card);
  // Check oracle text for "can't be blocked as long as defending player controls X".
  // We scan the full oracle text (reminder text included) because some cards spell
  // this out only in the reminder text (e.g. Rime Dryad's snow forestwalk reminder).
  // However, snow-walk and basic-type-walk are already handled by hasActiveLandwalk
  // (which reads the keyword name). We still enforce the explicit sentence form so
  // Hazy Homunculus / Tanglewalker parse correctly when the sentence is standalone.
  const text = (def.oracle_text || '').toLowerCase();
  let match: RegExpExecArray | null;
  const re = new RegExp(CONDITIONAL_EVASION_RE.source, 'gi');
  while ((match = re.exec(text)) !== null) {
    const filterText = match[1];
    const filter = parseConditionalEvasionFilter(filterText);
    if (filter && filterMatchesDefendingPlayer(state, defendingPlayerId, filter)) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// Other evasion keywords (fear, intimidate, shadow, horsemanship, skulk) and
// the generic "can't be blocked except by <quality>" restriction. Like
// landwalk, these are enforced ONLY here in canBlock (the single blocking
// gate); KEYWORD_MAP intentionally omits them. We read the keyword/restriction
// straight from the attacker's printed + granted keywords and a scan of its
// oracle text, so the parser markers added for these faces are honest.
// ============================================================================

/**
 * CR 509.1b: true when the attacker's oracle text carries the unconditional
 * "This creature can't be blocked." sentence (the Unblockable static spelled
 * out inline rather than as a keywords-array entry). We match ONLY the bare,
 * unconditional sentence — never a conditional "can't be blocked except by ..."
 * or "as long as ..." form, which carry their own (unenforced-here) restriction.
 * Suppressed when an attached "loses all abilities" aura is present.
 */
function attackerHasCantBeBlockedText(state: GameState, instanceId: string): boolean {
  const card = state.cards.get(instanceId);
  if (!card) return false;
  if (instanceLosesAllAbilities(state, instanceId)) return false;
  const def = getCardDefinition(state, card);
  // Strip reminder text in parentheses, then look for the standalone sentence.
  const text = (def.oracle_text || '').toLowerCase().replace(/\([^)]*\)/g, '');
  return /(?:^|[.\n])\s*(?:this creature|this permanent|~)\s+can['’]?t be blocked\s*(?:[.\n]|$)/.test(text);
}

/**
 * CR 509.1b: true when the BLOCKER's own oracle text carries the standalone
 * "can block only creatures with flying" restriction (the Welkin Tern / Cloud
 * Elemental family). Like attackerHasCantBeBlockedText we read the sentence
 * straight from the creature's oracle text, so the parser marker added for
 * these faces is honest — canBlock() is the single enforcement site. The
 * sentence subject must be the creature itself ("This creature ...", "~ ...",
 * or the card's own name) so a granted form on some other permanent's text is
 * never misread. Suppressed by an attached "loses all abilities" aura.
 */
function blockerCanBlockOnlyFlyingText(state: GameState, instanceId: string): boolean {
  const card = state.cards.get(instanceId);
  if (!card) return false;
  if (instanceLosesAllAbilities(state, instanceId)) return false;
  const def = getCardDefinition(state, card);
  // Strip reminder text in parentheses, then look for the standalone sentence.
  const text = (def.oracle_text || '').toLowerCase().replace(/\([^)]*\)/g, '');
  if (!text.includes('can block only creatures with flying')) return false;

  // Self subjects: "this creature"/"this permanent"/"~" plus the card's own
  // name (older oracle texts use the printed name, e.g. "Welkin Tern can block
  // only creatures with flying.") and its pre-comma short form.
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const subjects = ['this creature', 'this permanent', '~'];
  const name = (def.name || '').toLowerCase();
  if (name) {
    subjects.push(escapeRe(name));
    const shortName = name.split(',')[0]?.trim();
    if (shortName && shortName.length >= 3 && shortName !== name) {
      subjects.push(escapeRe(shortName));
    }
  }
  return new RegExp(
    `(?:^|[.\\n])\\s*(?:${subjects.join('|')})\\s+can block only creatures with flying\\s*(?:[.\\n]|$)`,
  ).test(text);
}

const EVASION_KEYWORDS = ['fear', 'intimidate', 'shadow', 'horsemanship', 'skulk'] as const;
type EvasionKeyword = typeof EVASION_KEYWORDS[number];

/** Return the set of "other evasion" keyword names an attacker has (printed,
 * granted, or in oracle text), respecting "loses all abilities" and lostKeywords. */
function getEvasionKeywords(state: GameState, instanceId: string): Set<EvasionKeyword> {
  const result = new Set<EvasionKeyword>();
  const card = state.cards.get(instanceId);
  if (!card) return result;
  if (instanceLosesAllAbilities(state, instanceId)) return result;

  const def = getCardDefinition(state, card);
  const sources: string[] = [...def.keywords, ...(card.grantedKeywords || [])];
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
  for (const kw of sources) {
    const n = norm(kw);
    for (const ev of EVASION_KEYWORDS) {
      if (n === ev) result.add(ev);
    }
  }
  const text = (def.oracle_text || '').toLowerCase();
  for (const ev of EVASION_KEYWORDS) {
    // Match the bare keyword word (reminder text in parens may follow). Avoid
    // matching e.g. "fearsome" by requiring a word boundary.
    if (new RegExp(`\\b${ev}\\b`).test(text)) result.add(ev);
  }
  for (const lost of card.lostKeywords || []) {
    const n = norm(lost);
    for (const ev of EVASION_KEYWORDS) {
      if (n === ev) result.delete(ev);
    }
  }
  return result;
}

function instanceColors(state: GameState, instanceId: string): Set<ManaColor> {
  const card = state.cards.get(instanceId);
  if (!card) return new Set();
  return new Set(getCardDefinition(state, card).colors);
}

function instanceIsArtifact(state: GameState, instanceId: string): boolean {
  return getEffectiveCardTypes(state, instanceId).includes('artifact');
}

/** Effective power of a creature from its base printed power plus counters and
 * temporary power mods (inlined to avoid importing continuous.ts here; mirrors
 * the inline read in getKeywordsForInstance). Used by skulk. */
function inlineEffectivePower(state: GameState, instanceId: string): number {
  const card = state.cards.get(instanceId);
  if (!card) return 0;
  const def = getCardDefinition(state, card);
  const base = def.power ?? 0;
  const counters = card.counters || {};
  return base
    + (counters['+1/+1'] || 0)
    - (counters['-1/-1'] || 0)
    + (counters['_powerMod'] || 0);
}

/**
 * Slice 10 (combat statics): "Creatures with power less than this creature's power
 * can't block it."  (Wandering Wolf family.)
 *
 * Returns true when the attacker's oracle text carries this restriction (read
 * directly, like attackerHasCantBeBlockedText / attackerHasConditionalEvasion).
 * Called from canBlock: if true and the blocker's effective power is strictly less
 * than the attacker's effective power, the block is illegal.
 *
 * Suppressed when the attacker has "loses all abilities" (same as other oracle-text
 * evasion checks).
 */
function attackerHasPowerLessRestriction(state: GameState, instanceId: string): boolean {
  const card = state.cards.get(instanceId);
  if (!card) return false;
  if (instanceLosesAllAbilities(state, instanceId)) return false;
  const def = getCardDefinition(state, card);
  return POWER_LESS_THAN_CANT_BLOCK_RE.test(def.oracle_text || '');
}

/**
 * CR 702.x: true when `blockerId` is a LEGAL blocker for `attackerId` with
 * respect to the attacker's "other evasion" keywords. Returns false when the
 * blocker fails the restriction (so canBlock should forbid the block).
 *   - fear (702.36): only artifact and/or black creatures may block.
 *   - intimidate (702.13): only artifact creatures and creatures sharing a
 *     color with the attacker may block.
 *   - shadow (702.28): only creatures with shadow may block (and shadow can
 *     only block shadow — enforced from the blocker side below).
 *   - horsemanship (702.31): only creatures with horsemanship may block.
 *   - skulk (702.72): can't be blocked by creatures with greater power.
 */
function blockerSatisfiesEvasion(state: GameState, blockerId: string, attackerId: string): boolean {
  const evasion = getEvasionKeywords(state, attackerId);

  if (evasion.has('fear')) {
    if (!instanceIsArtifact(state, blockerId) && !instanceColors(state, blockerId).has('B')) {
      return false;
    }
  }

  if (evasion.has('intimidate')) {
    const attackerColors = instanceColors(state, attackerId);
    const blockerColors = instanceColors(state, blockerId);
    const sharesColor = [...attackerColors].some(c => blockerColors.has(c));
    if (!instanceIsArtifact(state, blockerId) && !sharesColor) {
      return false;
    }
  }

  if (evasion.has('shadow')) {
    if (!getEvasionKeywords(state, blockerId).has('shadow')) return false;
  }

  if (evasion.has('horsemanship')) {
    if (!getEvasionKeywords(state, blockerId).has('horsemanship')) return false;
  }

  if (evasion.has('skulk')) {
    if (inlineEffectivePower(state, blockerId) > inlineEffectivePower(state, attackerId)) {
      return false;
    }
  }

  // Shadow is symmetric (CR 509.1b / 702.28b): a creature WITHOUT shadow can't
  // block one without shadow if the BLOCKER has shadow. A creature with shadow
  // can only block other creatures with shadow.
  if (getEvasionKeywords(state, blockerId).has('shadow')
      && !getEvasionKeywords(state, attackerId).has('shadow')) {
    return false;
  }

  return true;
}

/**
 * Check if a blocker assignment satisfies menace (needs 2+ blockers).
 * Returns true if the attacker doesn't have menace, or if blocked by 2+ creatures.
 */
export function satisfiesMenace(
  state: GameState,
  attackerId: string,
  blockerIds: string[],
): boolean {
  if (!instanceHasKeyword(state, attackerId, 'Menace')) {
    return true; // No menace, any number of blockers is fine
  }
  // Menace requires 2+ blockers or 0 blockers (unblocked)
  return blockerIds.length === 0 || blockerIds.length >= 2;
}

/**
 * Check if damage from a source is lethal to a creature (considering deathtouch).
 */
export function isLethalDamage(
  state: GameState,
  sourceId: string,
  targetId: string,
  damageAmount: number,
): boolean {
  const target = state.cards.get(targetId);
  if (!target) return false;

  const def = getCardDefinition(state, target);
  if (!isEffectiveCreature(state, targetId)) return false;

  const toughness = def.toughness ?? 0;
  const currentDamage = target.damage;

  // Deathtouch: any positive damage is lethal
  if (instanceHasKeyword(state, sourceId, 'Deathtouch') && damageAmount > 0) {
    return true;
  }

  // Normal lethal damage check
  return currentDamage + damageAmount >= toughness;
}

/**
 * Check if a permanent is a valid target for an opponent's spell/ability.
 * Returns false if the permanent has hexproof or shroud.
 */
export function canBeTargetedByOpponent(state: GameState, permanentId: string): boolean {
  if (instanceHasKeyword(state, permanentId, 'Shroud')) {
    return false;
  }
  if (instanceHasKeyword(state, permanentId, 'Hexproof')) {
    return false;
  }
  return true;
}

export function canBeTargetedByOpponentSource(
  state: GameState,
  permanentId: string,
  sourceId?: string,
): boolean {
  return canBeTargetedByOpponent(state, permanentId)
    && !isProtectedFromSource(state, permanentId, sourceId);
}

/**
 * Tam, Mindful First-Year — "hexproof from each of its colors":
 * Returns true when `permanentId` has HexproofFromOwnColors active from at
 * least one continuous effect AND the targeting source (`sourceId`) shares at
 * least one color with the permanent's own colors.
 *
 * Only blocks opponent targeting (hexproof never prevents self-targeting).
 */
export function isBlockedByHexproofFromOwnColors(
  state: GameState,
  permanentId: string,
  sourceId: string | undefined,
): boolean {
  if (!sourceId) return false;
  if (!state.continuousEffects || state.continuousEffects.length === 0) return false;

  // Check whether any live continuous effect grants HexproofFromOwnColors to this permanent.
  const targetCard = state.cards.get(permanentId);
  if (!targetCard || targetCard.zone !== 'battlefield') return false;
  const targetDef = getCardDefinition(state, targetCard);

  let hasModifier = false;
  for (const ce of state.continuousEffects) {
    if (ce.ability.modifier.kind !== 'HexproofFromOwnColors') continue;

    // Source must still be on the battlefield
    const source = state.cards.get(ce.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;

    // selfOnly guard (Tam excludes itself via excludeSelf, but guard anyway)
    if (ce.ability.selfOnly && permanentId !== ce.sourceInstanceId) continue;
    if (ce.ability.excludeSelf && permanentId === ce.sourceInstanceId) continue;

    // Controller filter — Tam uses 'you', so only the effect controller's creatures qualify
    if (ce.ability.controller === 'you' && targetCard.ownerId !== ce.controllerId) continue;
    if (ce.ability.controller === 'opponent' && targetCard.ownerId === ce.controllerId) continue;

    // Card filter — must be a creature
    const filter = ce.ability.filter;
    if (filter.types) {
      const hasType = filter.types.some((t: string) =>
        targetDef.card_types.includes(t as any)
      );
      if (!hasType) continue;
    }

    hasModifier = true;
    break;
  }

  if (!hasModifier) return false;

  // Collect the target creature's own colors
  const targetColors = new Set<string>(targetDef.colors);
  if (targetColors.size === 0) return false; // colorless — no colors to be hexproof from

  // Collect the source's colors
  const srcColors = sourceColors(state, sourceId);
  if (srcColors.size === 0) return false; // colorless source — never blocked

  // Block if any color overlap
  for (const c of srcColors) {
    if (targetColors.has(c)) return true;
  }
  return false;
}

/**
 * Check if a permanent is a valid target for its controller's spell/ability.
 * Returns false only if the permanent has shroud (hexproof allows self-targeting).
 */
export function canBeTargetedByController(state: GameState, permanentId: string): boolean {
  if (instanceHasKeyword(state, permanentId, 'Shroud')) {
    return false;
  }
  return true;
}

export function canBeTargetedByControllerSource(
  state: GameState,
  permanentId: string,
  sourceId?: string,
): boolean {
  return canBeTargetedByController(state, permanentId)
    && !isProtectedFromSource(state, permanentId, sourceId);
}

/**
 * Check if a creature is indestructible.
 */
export function isIndestructible(state: GameState, instanceId: string): boolean {
  return instanceHasKeyword(state, instanceId, 'Indestructible');
}
