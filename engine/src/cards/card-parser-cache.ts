/**
 * Card Parser Cache
 *
 * Parses oracle text once at card load time and populates
 * cached fields on CardDefinition. This is the SINGLE SOURCE
 * OF TRUTH for all card mechanics — no other code should parse
 * oracle text directly.
 */

import type { CardDefinition } from '../types';
import type {
  ManaProductionInfo,
  EquipmentBonusInfo,
  EquipCostInfo,
  UnlessTaxInfo,
  SearchAbilityInfo,
} from '../effects/ast';

/**
 * Parse all cached fields for a CardDefinition from its oracle text.
 * Called once at card load time.
 */
export function populateParsedCache(def: CardDefinition): CardDefinition {
  const oracle = def.oracle_text.toLowerCase();
  const typeLine = def.type_line.toLowerCase();

  return {
    ...def,
    isEquipment: typeLine.includes('equipment'),
    equipCost: parseEquipCost(oracle),
    equipmentBonus: parseEquipmentBonus(oracle),
    manaProduction: parseManaProduction(oracle, typeLine),
    searchAbility: parseSearchAbility(oracle),
    unlessTax: parseUnlessTax(oracle),
  };
}

// ========== Equipment ==========

function parseEquipCost(oracle: string): EquipCostInfo | undefined {
  // Match the whole cost chunk after "equip" — handles:
  //  equip {2}, equip {1}{W}, equip {W}{W}, equip {U/R}, equip 2
  const m = oracle.match(/equip\s+((?:\{[^}]+\}\s*)+|\d+)/i);
  if (!m) return undefined;
  const tail = m[1].trim();
  const cost: EquipCostInfo = { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

  if (/^\d+$/.test(tail)) { cost.generic = parseInt(tail, 10); return cost; }

  const symbols = tail.match(/\{[^}]+\}/g) ?? [];
  for (const sym of symbols) {
    const inner = sym.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(inner)) {
      cost.generic += parseInt(inner, 10);
    } else if (['W', 'U', 'B', 'R', 'G', 'C'].includes(inner)) {
      cost[inner as keyof EquipCostInfo] += 1;
    } else if (inner.includes('/')) {
      const first = inner.split('/')[0];
      if (['W', 'U', 'B', 'R', 'G', 'C'].includes(first)) cost[first as keyof EquipCostInfo] += 1;
    }
  }
  return cost;
}

function parseEquipmentBonus(oracle: string): EquipmentBonusInfo | undefined {
  if (!oracle.toLowerCase().includes('equipped creature')) return undefined;
  let power = 0, toughness = 0;

  const ptMatch = oracle.match(/equipped creature gets? ([+-]\d+)\/([+-]\d+)/i);
  if (ptMatch) { power = parseInt(ptMatch[1], 10); toughness = parseInt(ptMatch[2], 10); }

  // Extract keyword clause: "equipped creature has X, Y, and Z" or "gains X, Y, and Z"
  // Also handles "equipped creature gets +N/+N and has X, Y, and Z"
  const kwList = [
    'flying', 'trample', 'deathtouch', 'lifelink', 'vigilance', 'haste',
    'first strike', 'double strike', 'menace', 'hexproof', 'shroud',
    'indestructible', 'reach', 'protection', 'ward', 'fear', 'intimidate',
    'unblockable',
  ];
  const keywords: string[] = [];
  // Search for any "has" or "gains" clause in the sentence containing "equipped creature"
  const sentenceMatch = oracle.match(/equipped creature[^.]+/i);
  if (sentenceMatch) {
    const sentence = sentenceMatch[0].toLowerCase();
    // Find "has" or "gains" keyword clause within the sentence
    const clauseMatch = sentence.match(/(?:has|gains) ([^.]+)/);
    if (clauseMatch) {
      const clause = clauseMatch[1];
      for (const kw of kwList) {
        if (new RegExp(`\\b${kw}\\b`, 'i').test(clause)) {
          keywords.push(kw.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' '));
        }
      }
    }
  }

  if (power === 0 && toughness === 0 && keywords.length === 0) return undefined;
  return { power, toughness, keywords };
}

// ========== Mana Production ==========

function parseManaProduction(oracle: string, typeLine: string): ManaProductionInfo | undefined {
  // Check land subtypes first
  const subtypeColors: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> = [];
  if (typeLine.includes('plains')) subtypeColors.push('W');
  if (typeLine.includes('island')) subtypeColors.push('U');
  if (typeLine.includes('swamp')) subtypeColors.push('B');
  if (typeLine.includes('mountain')) subtypeColors.push('R');
  if (typeLine.includes('forest')) subtypeColors.push('G');

  if (subtypeColors.length > 0) {
    const amounts: Record<string, number> = {};
    for (const c of subtypeColors) amounts[c] = 1;
    return { colors: subtypeColors, amounts, isTapAbility: true, requiresSacrifice: false };
  }

  // Check "{T}: Add" patterns
  const tapAddMatch = oracle.match(/\{t\}:\s*add\s+([^."\n]+)/i);
  if (!tapAddMatch) return undefined;

  const addPart = tapAddMatch[1];
  const colors: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> = [];
  const amounts: Record<string, number> = {};

  // "any color" / "any one color"
  if (addPart.includes('any color') || addPart.includes('any one color')) {
    const textNumbers: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
    let amount = 1;
    for (const [word, num] of Object.entries(textNumbers)) {
      if (addPart.includes(word)) { amount = num; break; }
    }
    return {
      colors: ['W', 'U', 'B', 'R', 'G'],
      amounts: { W: amount, U: amount, B: amount, R: amount, G: amount },
      isTapAbility: true,
      requiresSacrifice: oracle.includes('sacrifice') && oracle.indexOf('sacrifice') < oracle.indexOf('add'),
    };
  }

  // Count individual mana symbols
  for (const [symbol, color] of Object.entries({ '{w}': 'W', '{u}': 'U', '{b}': 'B', '{r}': 'R', '{g}': 'G', '{c}': 'C' })) {
    const regex = new RegExp(symbol.replace('{', '\\{').replace('}', '\\}'), 'gi');
    const matches = addPart.match(regex);
    if (matches && matches.length > 0) {
      colors.push(color as 'W' | 'U' | 'B' | 'R' | 'G' | 'C');
      amounts[color] = matches.length;
    }
  }

  if (colors.length === 0) {
    colors.push('C');
    amounts['C'] = 1;
  }

  return {
    colors,
    amounts,
    isTapAbility: true,
    requiresSacrifice: oracle.includes('sacrifice') && oracle.indexOf('sacrifice') < oracle.indexOf('add'),
  };
}

// ========== Search Ability ==========

function parseSearchAbility(oracle: string): SearchAbilityInfo | undefined {
  if (!oracle.includes('search your library') && !oracle.includes('search their library')) {
    return undefined;
  }

  let filter: string | undefined;
  const forMatch = oracle.match(/search your library for (?:an? |up to \w+ )?(.+?)(?:\s+card)?(?:,|\.|and put| then| with| reveal)/);
  if (forMatch) {
    const target = forMatch[1].trim();
    if (target.includes('basic land')) filter = 'basic land';
    else if (target.includes('artifact or enchantment')) filter = 'artifact or enchantment';
    else if (target.includes('artifact')) filter = 'artifact';
    else if (target.includes('enchantment')) filter = 'enchantment';
    else if (target.includes('creature')) filter = 'creature';
    else if (target.includes('instant or sorcery')) filter = 'instant or sorcery';
    else if (target.includes('instant')) filter = 'instant';
    else if (target.includes('sorcery')) filter = 'sorcery';
    else if (target.includes('land')) filter = 'land';
    else if (target.includes('planeswalker')) filter = 'planeswalker';
  }

  let destination: SearchAbilityInfo['destination'] = 'hand';
  if (oracle.includes('onto the battlefield') || oracle.includes('put it onto the battlefield')) destination = 'battlefield';
  else if (oracle.includes('on top of your library') || oracle.includes('on top')) destination = 'top';
  else if (oracle.includes('into your graveyard') || oracle.includes('put that card into your graveyard')) destination = 'graveyard';
  else if (oracle.includes('put it into your hand') || oracle.includes('put that card into your hand')) destination = 'hand';

  const tapped = destination === 'battlefield' && oracle.includes('tapped');
  const shuffle = oracle.includes('shuffle');

  return { filter, destination, tapped: tapped || undefined, shuffle };
}

// ========== Tax Triggers ==========

function parseUnlessTax(oracle: string): UnlessTaxInfo | undefined {
  // "whenever an opponent casts a spell, you may draw a card unless that player pays {1}"
  // "whenever an opponent casts a spell, create a Treasure token unless that player pays {2}"
  if (!oracle.includes('unless') || !oracle.includes('pays')) return undefined;

  let triggerKind = '';
  if (oracle.includes('whenever an opponent casts a spell')) triggerKind = 'OpponentCastSpell';
  else if (oracle.includes('whenever a player draws a card')) triggerKind = 'CardDrawn';
  else if (oracle.includes('whenever an opponent draws a card')) triggerKind = 'CardDrawn';
  else return undefined;

  // Parse tax amount
  const taxMatch = oracle.match(/pays?\s*\{(\d+)\}/);
  const taxAmount = taxMatch ? parseInt(taxMatch[1]) : 1;

  // Parse effect
  let effect: UnlessTaxInfo['effect'] = 'other';
  let effectCount = 1;
  if (oracle.includes('draw a card') || oracle.includes('draw two')) {
    effect = 'draw';
    effectCount = oracle.includes('draw two') ? 2 : 1;
  } else if (oracle.includes('treasure')) {
    effect = 'treasure';
  }

  return { triggerKind, taxAmount, effect, effectCount };
}
