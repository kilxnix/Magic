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
import { typeLineHasSubtype } from '../type-line';

/**
 * Parse all cached fields for a CardDefinition from its oracle text.
 * Called once at card load time.
 */
/**
 * Slice 1: Strip the outer parenthesis from mana-ability-only land oracle text.
 *
 * Basic/dual/snow lands store their mana line wrapped in parens (e.g.
 * '({T}: Add {W} or {U}.)').  stripParentheticalReminderText strips the ENTIRE
 * group, leaving nothing for parseManaProductions to find.  Detect this pattern
 * before stripping so the inner mana ability text survives.
 * Returns the original text when the pattern does not match.
 */
function stripOuterManaParensForCache(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return text;
  // Find the matching ')' for the opening '('
  let depth = 0;
  let closeIdx = -1;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '(') depth++;
    else if (trimmed[i] === ')') { depth--; if (depth === 0) { closeIdx = i; break; } }
  }
  if (closeIdx !== trimmed.length - 1) return text;
  const inner = trimmed.slice(1, -1).trim();
  // Only unwrap if the inner text is a tap mana ability
  if (!/^\{t\}:\s*add\s+\{[wubrgcs]\}/i.test(inner)) return text;
  return inner;
}

export function populateParsedCache(def: CardDefinition): CardDefinition {
  const rawOracle = def.oracle_text.toLowerCase();
  // Slice 1: unwrap outer-paren mana ability text before reminder stripping
  const oracle = stripOuterManaParensForCache(rawOracle);
  const typeLine = def.type_line.toLowerCase();
  const manaOracle = stripParentheticalReminderText(oracle);
  const manaProductions = parseManaProductions(manaOracle, typeLine);

  return {
    ...def,
    isEquipment: typeLineHasSubtype(def.type_line, 'equipment'),
    equipCost: parseEquipCost(oracle),
    equipmentBonus: parseEquipmentBonus(oracle),
    manaProduction: manaProductions[0],
    ...(manaProductions.length > 0 ? { manaProductions } : {}),
    searchAbility: parseSearchAbility(oracle),
    unlessTax: parseUnlessTax(oracle),
  };
}

function stripParentheticalReminderText(text: string): string {
  return text.replace(/\([^()]*\)/g, ' ');
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

  // Pacifism family: "Enchanted creature can't attack and/or block." The engine
  // enforces the CannotAttack/CannotBlock keywords in canAttackThisTurn/canBlock
  // (keywords.ts), and instanceHasKeyword reads an attached card's
  // equipmentBonus.keywords — so emitting them here makes the restriction real.
  const cantSentence = oracle.match(new RegExp(`${subject} can'?t ([^.]+)`, 'i'));
  if (cantSentence) {
    const clause = cantSentence[1].toLowerCase();
    if (/\battack\b/.test(clause)) keywords.push('CannotAttack');
    if (/\bblock\b/.test(clause)) keywords.push('CannotBlock');
  }

  // Layer 7b (CR 613.4): aura/effect SETS base power and toughness, e.g.
  // "Enchanted creature is a Treefolk with base power and toughness 0/4" (Lignify)
  // or "Enchanted creature has base power and toughness 1/1" (Cursed). Enforced in
  // continuous.ts getEffectivePower/Toughness, which substitute the base before
  // adding counters/pumps, so the value is genuinely applied end-to-end.
  let setBasePower: number | undefined;
  let setBaseToughness: number | undefined;
  const setPTMatch = oracle.match(new RegExp(`${subject}[^.]*\\bbase power and toughness (\\d+)\\/(\\d+)`, 'i'));
  if (setPTMatch) {
    setBasePower = parseInt(setPTMatch[1], 10);
    setBaseToughness = parseInt(setPTMatch[2], 10);
  }

  // Layer 4 (CR 613): aura SETS or ADDS card types to the attached creature.
  // Only the 8 card TYPES are modeled — subtypes ("Treefolk"/"Frog") are dropped
  // (no consumer reads effective subtypes; they read def.type_line directly). So
  // Lignify ("is a Treefolk ...") yields no type change, while Darksteel Mutation
  // ("is an Insect artifact creature ...") correctly adds 'artifact'.
  const CARD_TYPE_WORDS: Record<string, import('../types').CardType> = {
    creature: 'creature', artifact: 'artifact', enchantment: 'enchantment',
    land: 'land', planeswalker: 'planeswalker', battle: 'battle',
  };
  const pickTypes = (phrase: string): import('../types').CardType[] => {
    const out: import('../types').CardType[] = [];
    for (const [w, t] of Object.entries(CARD_TYPE_WORDS)) {
      if (new RegExp(`\\b${w}\\b`, 'i').test(phrase) && !out.includes(t)) out.push(t);
    }
    return out;
  };
  let setTypes: import('../types').CardType[] | undefined;
  let addTypes: import('../types').CardType[] | undefined;
  // Also match the Frogify/Reprobation compound form:
  //   "Enchanted creature loses all abilities and is a <phrase>"
  // The base regex `subject (?:is|becomes) an? ([^.]+)` already handles the
  // direct form (Lignify, Darksteel Mutation). The alternative prefix
  // `(?:loses all (?:other )?abilities(?:\s+\w+)*\s+and\s+)?` extends it to
  // the combined sentence (Slice 3 addition).
  const becomeSentence = oracle.match(
    new RegExp(
      `${subject}\\s+(?:loses\\s+all\\s+(?:other\\s+)?abilities\\s+and\\s+)?(?:is|becomes)\\s+an?\\s+([^.]+)`,
      'i',
    ),
  );
  if (becomeSentence) {
    const phrase = becomeSentence[1];
    const types = pickTypes(phrase);
    if (types.length) {
      if (/\bin addition\b/i.test(phrase)) addTypes = types;
      else setTypes = types;
    }
  }

  // Layer 6 (CR 613): "loses all [other] abilities" (Darksteel Mutation, Lignify).
  // An Aura's whole oracle is about the attached permanent, so a plain match is safe.
  const losesAllAbilities = /\bloses all (?:other )?abilities\b/i.test(oracle) || undefined;

  if (power === 0 && toughness === 0 && keywords.length === 0
      && setBasePower === undefined && setBaseToughness === undefined
      && setTypes === undefined && addTypes === undefined
      && losesAllAbilities === undefined) {
    return undefined;
  }
  return {
    power, toughness, keywords,
    ...(setBasePower !== undefined ? { setBasePower } : {}),
    ...(setBaseToughness !== undefined ? { setBaseToughness } : {}),
    ...(setTypes !== undefined ? { setTypes } : {}),
    ...(addTypes !== undefined ? { addTypes } : {}),
    ...(losesAllAbilities ? { losesAllAbilities } : {}),
  };
}

// ========== Mana Production ==========

function parseManaProductions(oracle: string, typeLine: string): ManaProductionInfo[] {
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
  if (typeLineHasSubtype(typeLine, 'plains')) subtypeColors.push('W');
  if (typeLineHasSubtype(typeLine, 'island')) subtypeColors.push('U');
  if (typeLineHasSubtype(typeLine, 'swamp')) subtypeColors.push('B');
  if (typeLineHasSubtype(typeLine, 'mountain')) subtypeColors.push('R');
  if (typeLineHasSubtype(typeLine, 'forest')) subtypeColors.push('G');
  if (subtypeColors.length > 0) {
    const amounts: Record<string, number> = {};
    for (const c of subtypeColors) amounts[c] = 1;
    return [{
      colors: subtypeColors,
      amounts,
      isTapAbility: true,
      requiresSacrifice: false,
      activationZone: 'battlefield',
      ...(restriction ? { restriction } : {}),
    }];
  }

  const exileHandAdd = oracle.match(/exile\s+[^:]+?\s+from your hand:\s*add\s+([^."\n]+)/i);
  if (exileHandAdd) {
    return [parseAddPart(exileHandAdd[1], {
      isTapAbility: false,
      requiresSacrifice: false,
      activationZone: 'hand',
      requiresExileFromHand: true,
    })];
  }

  const sacrificePermanentAdd = oracle.match(/sacrifice\s+(?:a|an)\s+([a-z]+):\s*add\s+([^."\n]+)/i);
  if (sacrificePermanentAdd) {
    return [{
      ...parseAddPart(sacrificePermanentAdd[2], {
        isTapAbility: false,
        requiresSacrifice: false,
        activationZone: 'battlefield',
      }),
      sacrificeFilter: parseSacrificeFilter(sacrificePermanentAdd[1]),
    }];
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

  if (tapCandidates.length === 0) {
    const selfSacrificeAdd = oracle.match(/(?:discard\s+your\s+hand,\s*)?sacrifice\s+(?!a\b|an\b)[^:]+:\s*add\s+([^."\n]+)/i);
    if (selfSacrificeAdd) {
      return [parseAddPart(selfSacrificeAdd[1], {
        isTapAbility: false,
        requiresSacrifice: true,
        activationZone: 'battlefield',
        ...(/discard\s+your\s+hand/i.test(selfSacrificeAdd[0])
          ? { requiresDiscardHand: true }
          : {}),
      })];
    }
    return [];
  }

  const normalizedTapCandidates = tapCandidates.length > 1
    ? tapCandidates.map(candidate => {
      const isStandaloneColorless = candidate.colors.length === 1
        && candidate.colors[0] === 'C'
        && candidate.producesAllColors !== true;
      return isStandaloneColorless ? { ...candidate, restriction: undefined } : candidate;
    })
    : tapCandidates;

  return normalizedTapCandidates.sort((a, b) => scoreManaCandidate(b) - scoreManaCandidate(a));
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
      'snow land', 'basic land', 'artifact or enchantment', 'artifact', 'enchantment',
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
