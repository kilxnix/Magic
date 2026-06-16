import type { EquipCostInfo, EquipmentBonusInfo, ManaProductionInfo, SearchAbilityInfo, UnlessTaxInfo } from '../effects/ast';

export interface ParserFixture {
  name: string;
  oracleText: string;
  typeLine: string;
  expected: {
    equipCost?: EquipCostInfo;
    equipmentBonus?: EquipmentBonusInfo;
    manaProduction?: ManaProductionInfo;
    searchAbility?: SearchAbilityInfo;
    unlessTax?: UnlessTaxInfo;
    entersTapped?: boolean;
  };
}

export const PARSER_FIXTURES: ParserFixture[] = [
  // --- entersTheBattlefieldTapped ---
  {
    name: 'Sacred Foundry',
    // Slice 6: shock lands are no longer "always tapped" — buildBattlefieldEntryPlan
    // now applies a deterministic auto-choice (pay when life >= 4, else tapped).
    oracleText: 'As Sacred Foundry enters the battlefield, you may pay 2 life. If you don\'t, it enters tapped.',
    typeLine: 'Land — Mountain Plains',
    expected: { entersTapped: false },
  },
  {
    name: 'Tranquil Cove',
    oracleText: 'Tranquil Cove enters the battlefield tapped.\n{T}: Add {W} or {U}.',
    typeLine: 'Land',
    expected: { entersTapped: true },
  },
  {
    name: 'Shock Land (negated)',
    oracleText: 'This land doesn\'t enter the battlefield tapped.',
    typeLine: 'Land',
    expected: { entersTapped: false },
  },
  // --- Equip cost ---
  {
    name: 'Sword of Fire and Ice',
    oracleText: 'Equipped creature gets +2/+2 and has protection from red and from blue.\nEquip {2}',
    typeLine: 'Legendary Artifact — Equipment',
    expected: { equipCost: { generic: 2, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } },
  },
  {
    name: 'Shadowspear',
    oracleText: 'Equipped creature gets +1/+1 and has trample and lifelink.\nEquip {1}',
    typeLine: 'Legendary Artifact — Equipment',
    expected: {
      equipCost: { generic: 1, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      equipmentBonus: { power: 1, toughness: 1, keywords: ['Trample', 'Lifelink'] },
    },
  },
  // --- Aura static buff (shares the equipmentBonus cache via "enchanted creature") ---
  {
    name: 'Holy Strength',
    oracleText: 'Enchant creature\nEnchanted creature gets +1/+2.',
    typeLine: 'Enchantment — Aura',
    expected: {
      equipmentBonus: { power: 1, toughness: 2, keywords: [] },
    },
  },
  {
    name: 'Unholy Strength',
    oracleText: 'Enchant creature\nEnchanted creature gets +2/+1.',
    typeLine: 'Enchantment — Aura',
    expected: {
      equipmentBonus: { power: 2, toughness: 1, keywords: [] },
    },
  },
  {
    name: 'Flight',
    oracleText: 'Enchant creature\nEnchanted creature has flying.',
    typeLine: 'Enchantment — Aura',
    expected: {
      equipmentBonus: { power: 0, toughness: 0, keywords: ['Flying'] },
    },
  },
  // --- Pacifism family: combat restrictions enforced via CannotAttack/CannotBlock ---
  {
    name: 'Pacifism',
    oracleText: 'Enchant creature\nEnchanted creature can\'t attack or block.',
    typeLine: 'Enchantment — Aura',
    expected: {
      equipmentBonus: { power: 0, toughness: 0, keywords: ['CannotAttack', 'CannotBlock'] },
    },
  },
  {
    name: 'Curse of Chains',
    oracleText: 'Enchant creature\nEnchanted creature can\'t attack.',
    typeLine: 'Enchantment — Aura',
    expected: {
      equipmentBonus: { power: 0, toughness: 0, keywords: ['CannotAttack'] },
    },
  },
  // --- Mana production ---
  {
    name: 'Sol Ring',
    oracleText: '{T}: Add {C}{C}.',
    typeLine: 'Artifact',
    expected: {
      manaProduction: {
        colors: ['C'],
        amounts: { C: 2 },
        isTapAbility: true,
        requiresSacrifice: false,
        activationZone: 'battlefield',
      },
    },
  },
  {
    name: 'Chromatic Lantern',
    oracleText: 'Lands you control have "{T}: Add one mana of any color."\n{T}: Add one mana of any color.',
    typeLine: 'Artifact',
    expected: {
      manaProduction: {
        colors: ['W', 'U', 'B', 'R', 'G'],
        amounts: { W: 1, U: 1, B: 1, R: 1, G: 1 },
        isTapAbility: true,
        requiresSacrifice: false,
        activationZone: 'battlefield',
      },
    },
  },
  {
    name: 'Somberwald Sage',
    oracleText: '{T}: Add three mana of any one color. Spend this mana only to cast creature spells.',
    typeLine: 'Creature — Human Druid',
    expected: {
      manaProduction: {
        colors: ['W', 'U', 'B', 'R', 'G'],
        amounts: { W: 3, U: 3, B: 3, R: 3, G: 3 },
        isTapAbility: true,
        requiresSacrifice: false,
        activationZone: 'battlefield',
        restriction: 'creatureSpell',
      },
    },
  },
  {
    name: "Gaea's Cradle",
    oracleText: '{T}: Add {G} for each creature you control.',
    typeLine: 'Legendary Land',
    expected: {
      manaProduction: {
        colors: ['G'],
        amounts: { G: 1 },
        isTapAbility: true,
        requiresSacrifice: false,
        activationZone: 'battlefield',
        amountScale: 'creaturesYouControl',
      },
    },
  },
  {
    name: 'Elvish Spirit Guide',
    oracleText: 'Exile Elvish Spirit Guide from your hand: Add {G}.',
    typeLine: 'Creature — Elf Spirit',
    expected: {
      manaProduction: {
        colors: ['G'],
        amounts: { G: 1 },
        isTapAbility: false,
        requiresSacrifice: false,
        activationZone: 'hand',
        requiresExileFromHand: true,
      },
    },
  },
  {
    name: 'Lotus Petal',
    oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.',
    typeLine: 'Artifact',
    expected: {
      manaProduction: {
        colors: ['W', 'U', 'B', 'R', 'G'],
        amounts: { W: 1, U: 1, B: 1, R: 1, G: 1 },
        isTapAbility: true,
        requiresSacrifice: true,
        activationZone: 'battlefield',
      },
    },
  },
  {
    name: "Lion's Eye Diamond",
    oracleText: "Discard your hand, Sacrifice Lion's Eye Diamond: Add three mana of any one color. Activate only as an instant.",
    typeLine: 'Artifact',
    expected: {
      manaProduction: {
        colors: ['W', 'U', 'B', 'R', 'G'],
        amounts: { W: 3, U: 3, B: 3, R: 3, G: 3 },
        isTapAbility: false,
        requiresSacrifice: true,
        activationZone: 'battlefield',
        requiresDiscardHand: true,
      },
    },
  },
  // --- Search ability ---
  {
    name: 'Cultivate',
    oracleText: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    typeLine: 'Sorcery',
    expected: {
      searchAbility: { filter: 'basic land', destination: 'battlefield', tapped: true, shuffle: true, count: 2 },
    },
  },
  {
    name: 'Demonic Tutor',
    oracleText: 'Search your library for a card, put that card into your hand, then shuffle.',
    typeLine: 'Sorcery',
    expected: {
      // Single-card search — count omitted (defaults to 1)
      searchAbility: { destination: 'hand', shuffle: true },
    },
  },
  {
    name: 'Kodama\'s Reach',
    oracleText: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    typeLine: 'Sorcery — Arcane',
    expected: {
      searchAbility: { filter: 'basic land', destination: 'battlefield', tapped: true, shuffle: true, count: 2 },
    },
  },
  // --- Unless tax ---
  {
    name: 'Rhystic Study',
    oracleText: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
    typeLine: 'Enchantment',
    expected: {
      unlessTax: { triggerKind: 'OpponentCastSpell', taxAmount: 1, effect: 'draw', effectCount: 1 },
    },
  },
  {
    name: 'Smothering Tithe',
    oracleText: 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.',
    typeLine: 'Enchantment',
    expected: {
      unlessTax: { triggerKind: 'CardDrawn', taxAmount: 2, effect: 'treasure', effectCount: 1 },
    },
  },
];

export function fixturesFor(field: keyof ParserFixture['expected']): ParserFixture[] {
  return PARSER_FIXTURES.filter(f => f.expected[field] !== undefined);
}
