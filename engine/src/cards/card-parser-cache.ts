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
  CardFilter,
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
  if (!oracle.toLowerCase().includes('equipped creature') && !oracle.toLowerCase().includes('enchanted creature')) return undefined;
  let power = 0, toughness = 0;

  const subject = '(?:equipped|enchanted) creature';

  const ptMatch = oracle.match(new RegExp(`${subject} gets? ([+-]\\d+)\\/([+-]\\d+)`, 'i'));
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
  // Search for any "has" or "gains" clause in the sentence containing the attached creature.
  const sentenceMatch = oracle.match(new RegExp(`${subject}[^.]+`, 'i'));
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
  const parseSacrificeFilter = (word: string): CardFilter => {
    const subtypeMap: Record<string, string> = {
      goblin: 'Goblin', goblins: 'Goblin',
      elf: 'Elf', elves: 'Elf',
      dragon: 'Dragon', dragons: 'Dragon',
      creature: 'Creature', creatures: 'Creature',
      artifact: 'Artifact', artifacts: 'Artifact',
    };
    const normalized = subtypeMap[word.toLowerCase()] || word.replace(/s$/, '').replace(/^\w/, c => c.toUpperCase());
    if (normalized === 'Creature') return { types: ['creature'] };
    if (normalized === 'Artifact') return { types: ['artifact'] };
    return { types: ['creature'], subtypes: [normalized] };
  };

  const parseSpendRestriction = (): ManaProductionInfo['restriction'] | undefined => {
    if (/\bspend\s+this\s+mana\s+only\s+to\s+cast\s+your\s+commander\b/i.test(oracle)) {
      return 'commanderSpell';
    }
    if (/\bspend\s+this\s+mana\s+only\s+to\s+cast\s+a\s+creature\s+spell\s+of\s+the\s+chosen\s+type\b/i.test(oracle)) {
      return 'creatureTypeSpell';
    }
    if (/\bspend\s+this\s+mana\s+only\s+to\s+cast\s+legendary\s+spells?\b/i.test(oracle)) {
      return 'legendarySpell';
    }
    if (/\bspend\s+this\s+mana\s+only\s+to\s+cast\s+(?:a\s+)?creature\s+spells?\b/i.test(oracle)) {
      return 'creatureSpell';
    }
    return undefined;
  };

  const restriction = parseSpendRestriction();

  const parseAddPart = (
    addPart: string,
    options: {
      isTapAbility: boolean;
      requiresSacrifice: boolean;
      exileAfterUse?: boolean;
      activationZone?: 'battlefield' | 'hand';
      requiresExileFromHand?: boolean;
    },
  ): ManaProductionInfo => {
    const amountScale = /for each creature you control/i.test(addPart)
      ? 'creaturesYouControl' as const
      : undefined;
    const extras = {
      ...options,
      ...(amountScale ? { amountScale } : {}),
      ...(restriction ? { restriction } : {}),
    };

    // "any color" / "any one color" / "any combination of colors" variants.
    // Chrome Mox-style dynamic colors are narrowed later from the imprinted card.
    if (
      /any\s+(?:one\s+)?color/i.test(addPart)
      || /any\s+combination\s+of\s+colors/i.test(addPart)
      || /any\s+of\s+the\s+exiled\s+card'?s\s+colors/i.test(addPart)
    ) {
      const textNumbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
      let amount = 1;
      const numMatch = addPart.match(/\b(one|two|three|four|five)\b/i);
      if (numMatch) amount = textNumbers[numMatch[1].toLowerCase()];
      return {
        colors: ['W', 'U', 'B', 'R', 'G'],
        amounts: { W: amount, U: amount, B: amount, R: amount, G: amount },
        ...extras,
      };
    }

    // Count explicit mana symbols
    const colors: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> = [];
    const amounts: Record<string, number> = {};
    const symbolMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G' | 'C'> = {
      w: 'W', u: 'U', b: 'B', r: 'R', g: 'G', c: 'C',
    };
    const syms = addPart.match(/\{([wubrgc])\}/gi) ?? [];
    for (const sym of syms) {
      const color = symbolMap[sym.slice(1, -1).toLowerCase()];
      if (!amounts[color]) { colors.push(color); amounts[color] = 0; }
      amounts[color] += 1;
    }

    if (colors.length === 0) {
      colors.push('C');
      amounts['C'] = 1;
    }

    const producesAllColors = colors.length > 1 && !/\bor\b/i.test(addPart);
    return {
      colors,
      amounts,
      ...extras,
      ...(producesAllColors ? { producesAllColors: true } : {}),
    };
  };

  // Basic-land subtype shortcut
  const subtypeColors: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> = [];
  const tl = typeLine.toLowerCase();
  if (tl.includes('plains')) subtypeColors.push('W');
  if (tl.includes('island')) subtypeColors.push('U');
  if (tl.includes('swamp')) subtypeColors.push('B');
  if (tl.includes('mountain')) subtypeColors.push('R');
  if (tl.includes('forest')) subtypeColors.push('G');
  if (subtypeColors.length > 0) {
    const amounts: Record<string, number> = {};
    for (const c of subtypeColors) amounts[c] = 1;
    return {
      colors: subtypeColors,
      amounts,
      isTapAbility: true,
      requiresSacrifice: false,
      activationZone: 'battlefield',
      ...(restriction ? { restriction } : {}),
    };
  }

  const exileHandAdd = oracle.match(/exile\s+[^:]+?\s+from your hand:\s*add\s+([^."\n]+)/i);
  if (exileHandAdd) {
    return parseAddPart(exileHandAdd[1], {
      isTapAbility: false,
      requiresSacrifice: false,
      activationZone: 'hand',
      requiresExileFromHand: true,
    });
  }

  const sacrificePermanentAdd = oracle.match(/sacrifice\s+(?:a|an)\s+([a-z]+):\s*add\s+([^."\n]+)/i);
  if (sacrificePermanentAdd) {
    return {
      ...parseAddPart(sacrificePermanentAdd[2], {
        isTapAbility: false,
        requiresSacrifice: false,
        activationZone: 'battlefield',
      }),
      sacrificeFilter: parseSacrificeFilter(sacrificePermanentAdd[1]),
    };
  }

  const scoreManaCandidate = (info: ManaProductionInfo): number => {
    const nonColorless = info.colors.filter(c => c !== 'C').length;
    const bestAmount = Math.max(...info.colors.map(c => info.amounts[c] ?? 1));
    return nonColorless * 100 + info.colors.length * 10 + bestAmount;
  };

  const tapCandidates: ManaProductionInfo[] = [];
  const pushTapCandidate = (fullClause: string, addPart: string) => {
    const requiresSacrifice = /sacrifice|tear\s+(?:this\s+artifact|[^:]+?)\s+into\s+pieces|remove\s+[^.]+from\s+the\s+game/i.test(fullClause);
    const exileAfterUse = requiresSacrifice && /remove\s+[^.]+from\s+the\s+game/i.test(oracle);
    tapCandidates.push(parseAddPart(addPart, {
      isTapAbility: true,
      requiresSacrifice,
      ...(exileAfterUse ? { exileAfterUse: true } : {}),
      activationZone: 'battlefield',
    }));
  };

  // Find all "{T}: Add ..." clauses. Cards such as Cavern of Souls and
  // Delighted Halfling have a colorless line first and a richer colored line
  // later; choosing the first clause makes them feel broken in play.
  for (const tapAdd of oracle.matchAll(/\{t\}\s*(?:,\s*[^:]+)?:\s*add\s+([^."\n]+)/gi)) {
    pushTapCandidate(tapAdd[0], tapAdd[1]);
  }

  // Weird old-card text can put a non-add instruction between the tap cost and
  // the Add sentence ("{T}: Tear this artifact into pieces. Add four mana...").
  for (const delayedTapAdd of oracle.matchAll(/\{t\}:[^.]*\.\s*add\s+([^."\n]+)/gi)) {
    pushTapCandidate(delayedTapAdd[0], delayedTapAdd[1]);
  }

  if (tapCandidates.length === 0) return undefined;

  return tapCandidates.sort((a, b) => scoreManaCandidate(b) - scoreManaCandidate(a))[0];
}

// ========== Search Ability ==========

function parseSearchAbility(oracle: string): SearchAbilityInfo | undefined {
  if (!/search\s+(?:your|their)\s+library/i.test(oracle)) return undefined;

  let filter: string | undefined;
  // Anchor the card-type phrase on "card" or a comma/period
  const forMatch = oracle.match(/search your library for (?:an?\s+|up to \w+\s+)?([^,.]+?)\s+cards?/i);
  if (forMatch) {
    const target = forMatch[1].toLowerCase();
    const filters = [
      'basic land', 'artifact or enchantment', 'artifact', 'enchantment',
      'creature', 'instant or sorcery', 'instant', 'sorcery', 'land', 'planeswalker',
    ];
    filter = filters.find(f => target.includes(f));
  }

  // Extract the count: "a card" / "an X" / "up to two", "up to N" / "N basic land cards"
  let count = 1;
  const TEXT_NUMBERS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  // "up to N basic land cards" or "up to two basic land cards"
  const upToMatch = oracle.match(/search your library for up to (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+/i);
  if (upToMatch) {
    const n = upToMatch[1].toLowerCase();
    count = /^\d+$/.test(n) ? parseInt(n, 10) : (TEXT_NUMBERS[n] ?? 1);
  } else {
    // "search your library for two basic land cards" (no "up to")
    const numberedMatch = oracle.match(/search your library for (\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?!color)/i);
    if (numberedMatch) {
      const n = numberedMatch[1].toLowerCase();
      count = /^\d+$/.test(n) ? parseInt(n, 10) : (TEXT_NUMBERS[n] ?? 1);
    }
  }

  let destination: SearchAbilityInfo['destination'] = 'hand';
  if (/onto the battlefield/i.test(oracle)) destination = 'battlefield';
  else if (/on top of your library/i.test(oracle)) destination = 'top';
  else if (/into your graveyard/i.test(oracle)) destination = 'graveyard';
  else if (/into your hand/i.test(oracle)) destination = 'hand';

  const tapped = destination === 'battlefield' && /onto the battlefield tapped/i.test(oracle);
  const shuffle = /\bshuffle\b/i.test(oracle);

  return {
    filter,
    destination,
    tapped: tapped || undefined,
    shuffle,
    count: count > 1 ? count : undefined,
  };
}

// ========== Tax Triggers ==========

function parseUnlessTax(oracle: string): UnlessTaxInfo | undefined {
  if (!(/\bunless\b/i.test(oracle) || /\bdoesn['’]?t\b/i.test(oracle)) || !/\bpays?\b/i.test(oracle)) return undefined;

  let triggerKind = '';
  if (/whenever an opponent casts a spell/i.test(oracle)) triggerKind = 'OpponentCastSpell';
  else if (/whenever a player draws a card/i.test(oracle)) triggerKind = 'CardDrawn';
  else if (/whenever an opponent draws a card/i.test(oracle)) triggerKind = 'CardDrawn';
  else return undefined;

  const taxMatch = oracle.match(/pays?\s*\{(\d+|[wubrgcxWUBRGCX])\}/);
  const taxAmount = taxMatch
    ? (/^\d+$/.test(taxMatch[1]) ? parseInt(taxMatch[1], 10) : 1)
    : 1;

  let effect: UnlessTaxInfo['effect'] = 'other';
  let effectCount = 1;
  if (/draw\s+two\s+cards?/i.test(oracle)) { effect = 'draw'; effectCount = 2; }
  else if (/draw\s+a\s+card/i.test(oracle)) { effect = 'draw'; effectCount = 1; }
  else if (/\btreasure\b/i.test(oracle)) { effect = 'treasure'; }

  return { triggerKind, taxAmount, effect, effectCount };
}
