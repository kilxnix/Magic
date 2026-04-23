import { describe, it, expect } from 'vitest';
import { populateParsedCache } from './card-parser-cache';
import { PARSER_FIXTURES } from './card-parser-fixtures';
import type { CardDefinition } from '../types';

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

describe('card-parser-cache — manaProduction', () => {
  for (const f of PARSER_FIXTURES) {
    if (f.expected.manaProduction === undefined) continue;
    it(`parses mana production for ${f.name}`, () => {
      const parsed = populateParsedCache(defFrom(f.name, f.oracleText, f.typeLine));
      expect(parsed.manaProduction).toEqual(f.expected.manaProduction);
    });
  }
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
