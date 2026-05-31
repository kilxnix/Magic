import { describe, it, expect } from 'vitest';
import { populateParsedCache } from './card-parser-cache';
import { PARSER_FIXTURES } from './card-parser-fixtures';
import type { CardDefinition } from '../types';
import { entersTheBattlefieldTappedForTest } from '../actions';

function defFrom(name: string, oracle: string, typeLine: string): CardDefinition {
  return {
    id: name, name, oracle_text: oracle, type_line: typeLine, mana_cost: '', cmc: 0,
    colors: [], color_identity: [], keywords: [], card_types: [],
  };
}

describe('card-parser-cache — equipCost', () => {
  for (const f of PARSER_FIXTURES) {
    if (f.expected.equipCost === undefined) continue;
    it(`parses equip cost for ${f.name}`, () => {
      const parsed = populateParsedCache(defFrom(f.name, f.oracleText, f.typeLine));
      expect(parsed.equipCost).toEqual(f.expected.equipCost);
    });
  }
});

describe('card-parser-cache — equipmentBonus', () => {
  for (const f of PARSER_FIXTURES) {
    if (f.expected.equipmentBonus === undefined) continue;
    it(`parses equipment bonus for ${f.name}`, () => {
      const parsed = populateParsedCache(defFrom(f.name, f.oracleText, f.typeLine));
      expect(parsed.equipmentBonus).toEqual(f.expected.equipmentBonus);
    });
  }
});

describe('card-parser-cache - equipment type detection', () => {
  it('marks real Equipment by exact subtype only', () => {
    const equipment = populateParsedCache(defFrom(
      'Goblin Morningstar',
      'Equipped creature gets +1/+0 and has trample. Equip {1}.',
      'Artifact - Equipment',
    ));
    const fakeSubtype = populateParsedCache(defFrom(
      'Equipmentalist',
      'Equipped creature gets +1/+0 and has trample. Equip {1}.',
      'Artifact - Equipmentalist',
    ));

    expect(equipment.isEquipment).toBe(true);
    expect(fakeSubtype.isEquipment).toBe(false);
  });
});

describe('card-parser-cache — manaProduction', () => {
  for (const f of PARSER_FIXTURES) {
    if (f.expected.manaProduction === undefined) continue;
    it(`parses mana production for ${f.name}`, () => {
      const parsed = populateParsedCache(defFrom(f.name, f.oracleText, f.typeLine));
      expect(parsed.manaProduction).toEqual(f.expected.manaProduction);
    });
  }

  it('does not infer land-subtype mana from subtype substrings', () => {
    const parsed = populateParsedCache(defFrom(
      'Islander Scout',
      '',
      'Creature - Islander Scout',
    ));

    expect(parsed.manaProduction).toBeUndefined();
  });

  it('infers basic land-subtype mana from exact subtype terms', () => {
    const parsed = populateParsedCache(defFrom(
      'Breeding Pool',
      '',
      'Land - Forest Island',
    ));

    expect(parsed.manaProduction?.colors).toEqual(['U', 'G']);
  });

  it('does not turn parenthetical token reminder text into a source mana ability', () => {
    const parsed = populateParsedCache(defFrom(
      'Mahadi, Emporium Master',
      'At the beginning of your end step, create a Treasure token for each creature that died this turn. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
      'Legendary Creature - Devil',
    ));

    expect(parsed.manaProduction).toBeUndefined();
  });

  it('still parses real Treasure token mana text when it belongs to the token', () => {
    const parsed = populateParsedCache(defFrom(
      'Treasure',
      '{T}, Sacrifice this token: Add one mana of any color.',
      'Token Artifact - Treasure',
    ));

    expect(parsed.manaProduction?.colors).toEqual(['W', 'U', 'B', 'R', 'G']);
  });
});

describe('card-parser-cache — searchAbility', () => {
  for (const f of PARSER_FIXTURES) {
    if (f.expected.searchAbility === undefined) continue;
    it(`parses search ability for ${f.name}`, () => {
      const parsed = populateParsedCache(defFrom(f.name, f.oracleText, f.typeLine));
      expect(parsed.searchAbility).toEqual(f.expected.searchAbility);
    });
  }
});

describe('card-parser-cache — unlessTax', () => {
  for (const f of PARSER_FIXTURES) {
    if (f.expected.unlessTax === undefined) continue;
    it(`parses unless-tax for ${f.name}`, () => {
      const parsed = populateParsedCache(defFrom(f.name, f.oracleText, f.typeLine));
      expect(parsed.unlessTax).toEqual(f.expected.unlessTax);
    });
  }
});

describe('actions — entersTheBattlefieldTapped', () => {
  for (const f of PARSER_FIXTURES) {
    if (f.expected.entersTapped === undefined) continue;
    it(`returns ${f.expected.entersTapped} for ${f.name}`, () => {
      expect(entersTheBattlefieldTappedForTest(f.oracleText)).toBe(f.expected.entersTapped);
    });
  }
});
