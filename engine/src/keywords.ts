// Phase 5: Keyword helpers
// Query and manage keywords on cards

import type { GameState, CardDefinition, CardInstance } from './types';
import { isEffectiveCreature } from './effective-types';
import { getCardDefinition } from './game-state';
import type { ManaColor } from './types';

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
  | 'CannotAttack';

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
  return text.match(/protection from [^.\n]+/g) || [];
}

/**
 * Parse color-specific protection clauses from oracle text.
 * This intentionally handles the common Commander/Arena-critical case:
 * "protection from red", "protection from white and from black", etc.
 */
export function getProtectionColors(state: GameState, instanceId: string): Set<ManaColor> {
  const colors = new Set<ManaColor>();

  for (const clause of protectionClausesFor(state, instanceId)) {
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
  const typeLine = def.type_line.toLowerCase();
  const hasType = (type: string) => sourceTypes.has(type) || typeLine.includes(type);

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

      // Check excludeSelf
      if (ce.ability.excludeSelf && instanceId === ce.sourceInstanceId) continue;

      // Check controller filter
      if (ce.ability.controller === 'you' && card.ownerId !== ce.controllerId) continue;
      if (ce.ability.controller === 'opponent' && card.ownerId === ce.controllerId) continue;

      // Must be on battlefield
      if (card.zone !== 'battlefield') continue;

      // Check card filter
      const filter = ce.ability.filter;
      if (filter.types || filter.subtypes || filter.colors || filter.cmc || filter.power) {
        // Simple filter matching inline (avoid circular import)
        let matches = true;
        if (filter.types) {
          const hasType = filter.types.some((t: string) =>
            def.card_types.includes(t as any) || def.type_line.toLowerCase().includes(t.toLowerCase())
          );
          if (!hasType) matches = false;
        }
        if (matches && filter.subtypes) {
          const typeLine = def.type_line.toLowerCase();
          const hasSub = filter.subtypes.some((st: string) => typeLine.includes(st.toLowerCase()));
          if (!hasSub) matches = false;
        }
        if (matches && filter.excludeSubtypes) {
          const typeLine = def.type_line.toLowerCase();
          const hasExcludedSub = filter.excludeSubtypes.some((st: string) => typeLine.includes(st.toLowerCase()));
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
 * Check if a card instance has a specific keyword.
 * Includes keywords from the card definition, continuous effects, and attached equipment.
 */
export function instanceHasKeyword(state: GameState, instanceId: string, keyword: Keyword): boolean {
  const card = state.cards.get(instanceId);
  if (card?.lostKeywords?.some(lost => normalizeKeyword(lost) === normalizeKeyword(keyword))) {
    return false;
  }

  if (getKeywordsForInstance(state, instanceId).has(keyword)) {
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

  // Check defender
  if (instanceHasKeyword(state, instanceId, 'Defender')) {
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

  if (isProtectedFromSource(state, attackerId, blockerId)) {
    return false;
  }

  // Flying creatures can only be blocked by creatures with flying or reach
  if (instanceHasKeyword(state, attackerId, 'Flying')) {
    if (!instanceHasKeyword(state, blockerId, 'Flying') &&
        !instanceHasKeyword(state, blockerId, 'Reach')) {
      return false;
    }
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
