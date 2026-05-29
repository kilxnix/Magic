import { describe, it, expect } from 'vitest';
import { populateParsedCache } from '../cards/card-parser-cache';
import type { CardDefinition, ManaColor } from '../types';

/**
 * Shorthand to build a CardDefinition for a land / artifact.
 */
function landDef(
  name: string,
  typeLine: string,
  oracleText: string,
): CardDefinition {
  const lower = typeLine.toLowerCase();
  const cardTypes: CardDefinition['card_types'] = [];
  if (lower.includes('land')) cardTypes.push('land');
  if (lower.includes('artifact')) cardTypes.push('artifact');
  if (lower.includes('creature')) cardTypes.push('creature');

  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    type_line: typeLine,
    oracle_text: oracleText,
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: cardTypes,
  };
}

/**
 * Helper: get mana colors from cached manaProduction data.
 */
function colorsOf(def: CardDefinition): ManaColor[] {
  const cached = populateParsedCache(def);
  return cached.manaProduction?.colors ?? [];
}

function parsed(def: CardDefinition): CardDefinition {
  return populateParsedCache(def);
}

// ─────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────

describe('manaProduction cache — comprehensive', () => {
  // ── 1. Basic lands ──────────────────────────────────────
  describe('basic lands', () => {
    it('Forest → G', () => {
      const colors = colorsOf(
        landDef('Forest', 'Basic Land — Forest', '{T}: Add {G}.'),
      );
      expect(colors).toEqual(['G']);
    });

    it('Island → U', () => {
      const colors = colorsOf(
        landDef('Island', 'Basic Land — Island', '{T}: Add {U}.'),
      );
      expect(colors).toEqual(['U']);
    });

    it('Swamp → B', () => {
      const colors = colorsOf(
        landDef('Swamp', 'Basic Land — Swamp', '{T}: Add {B}.'),
      );
      expect(colors).toEqual(['B']);
    });

    it('Mountain → R', () => {
      const colors = colorsOf(
        landDef('Mountain', 'Basic Land — Mountain', '{T}: Add {R}.'),
      );
      expect(colors).toEqual(['R']);
    });

    it('Plains → W', () => {
      const colors = colorsOf(
        landDef('Plains', 'Basic Land — Plains', '{T}: Add {W}.'),
      );
      expect(colors).toEqual(['W']);
    });
  });

  // ── 2. Dual type lands ──────────────────────────────────
  describe('dual type lands', () => {
    it('"Land — Swamp Mountain" → B and R', () => {
      const colors = colorsOf(
        landDef('Badlands', 'Land — Swamp Mountain', ''),
      );
      expect(colors).toContain('B');
      expect(colors).toContain('R');
      expect(colors).toHaveLength(2);
    });
  });

  // ── 3. Shock lands ──────────────────────────────────────
  describe('shock lands', () => {
    it('Blood Crypt (Land — Swamp Mountain, oracle: "{T}: Add {B} or {R}.") → B and R', () => {
      const colors = colorsOf(
        landDef(
          'Blood Crypt',
          'Land — Swamp Mountain',
          'As Blood Crypt enters the battlefield, you may pay 2 life. If you don\'t, it enters tapped.\n{T}: Add {B} or {R}.',
        ),
      );
      expect(colors).toContain('B');
      expect(colors).toContain('R');
      expect(colors).toHaveLength(2);
    });
  });

  // ── 4. "Any color" lands ────────────────────────────────
  describe('"any color" lands', () => {
    it('Command Tower → W, U, B, R, G', () => {
      const colors = colorsOf(
        landDef(
          'Command Tower',
          'Land',
          "{T}: Add one mana of any color in your commander's color identity.",
        ),
      );
      expect(colors).toContain('W');
      expect(colors).toContain('U');
      expect(colors).toContain('B');
      expect(colors).toContain('R');
      expect(colors).toContain('G');
      expect(colors).toHaveLength(5);
    });

    it('Cavern of Souls exposes its colored creature-mana clause, not only {C}', () => {
      const def = parsed(
        landDef(
          'Cavern of Souls',
          'Land',
          'As Cavern of Souls enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can\'t be countered.',
        ),
      );
      expect(def.manaProduction?.colors).toEqual(['W', 'U', 'B', 'R', 'G']);
      expect(def.manaProduction?.restriction).toBe('creatureTypeSpell');
    });

    it('Delighted Halfling exposes its legendary-spell colored mana clause', () => {
      const colors = colorsOf(
        landDef(
          'Delighted Halfling',
          'Creature — Halfling Citizen',
          '{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast legendary spells, and that spell can\'t be countered.',
        ),
      );
      expect(colors).toEqual(['W', 'U', 'B', 'R', 'G']);
    });
  });

  // ── 5. Sol Ring (artifact producing {C}{C}) ─────────────
  describe('colorless mana producers', () => {
    it('Sol Ring (oracle: "{T}: Add {C}{C}.") → C', () => {
      const colors = colorsOf(
        landDef('Sol Ring', 'Artifact', '{T}: Add {C}{C}.'),
      );
      expect(colors).toContain('C');
      expect(colors).toHaveLength(1);
    });

    it('Blacker Lotus parses old delayed Add text as a four-mana sacrifice tap ability', () => {
      const def = parsed(
        landDef(
          'Blacker Lotus',
          'Artifact',
          '{T}: Tear this artifact into pieces. Add four mana of any one color. Remove the pieces from the game.',
        ),
      );
      expect(def.manaProduction?.colors).toEqual(['W', 'U', 'B', 'R', 'G']);
      expect(def.manaProduction?.amounts.G).toBe(4);
      expect(def.manaProduction?.requiresSacrifice).toBe(true);
      expect(def.manaProduction?.exileAfterUse).toBe(true);
    });

    it('Chrome Mox parses exiled-card colors as dynamic selectable mana', () => {
      const colors = colorsOf(
        landDef(
          'Chrome Mox',
          'Artifact',
          'Imprint — When Chrome Mox enters the battlefield, you may exile a nonartifact, nonland card from your hand.\n{T}: Add one mana of any of the exiled card\'s colors.',
        ),
      );
      expect(colors).toEqual(['W', 'U', 'B', 'R', 'G']);
    });
  });

  // ── 6. Lands with "{T}: Add {U} or {B}." ───────────────
  describe('oracle-text-based dual producers', () => {
    it('Land with "{T}: Add {U}{B}." → U and B', () => {
      const colors = colorsOf(
        landDef(
          'Dimir Aqueduct',
          'Land',
          'Dimir Aqueduct enters tapped.\nWhen Dimir Aqueduct enters, return a land you control to its owner\'s hand.\n{T}: Add {U}{B}.',
        ),
      );
      expect(colors).toContain('U');
      expect(colors).toContain('B');
      expect(colors).toHaveLength(2);
    });

    it('Somberwald Sage parses three mana of any one color', () => {
      const def = parsed(
        landDef(
          'Somberwald Sage',
          'Creature — Human Druid',
          '{T}: Add three mana of any one color. Spend this mana only to cast creature spells.',
        ),
      );
      expect(def.manaProduction?.colors).toEqual(['W', 'U', 'B', 'R', 'G']);
      expect(def.manaProduction?.amounts.R).toBe(3);
      expect(def.manaProduction?.restriction).toBe('creatureSpell');
    });

    it('Shaman of Forgotten Ways parses two mana in any combination of colors', () => {
      const def = parsed(
        landDef(
          'Shaman of Forgotten Ways',
          'Creature — Human Shaman',
          '{T}: Add two mana in any combination of colors. Spend this mana only to cast creature spells.',
        ),
      );
      expect(def.manaProduction?.colors).toEqual(['W', 'U', 'B', 'R', 'G']);
      expect(def.manaProduction?.amounts.G).toBe(2);
      expect(def.manaProduction?.restriction).toBe('creatureSpell');
    });

    it('Jeweled Lotus parses commander-only mana restriction', () => {
      const def = parsed(
        landDef(
          'Jeweled Lotus',
          'Artifact',
          '{T}, Sacrifice Jeweled Lotus: Add three mana of any one color. Spend this mana only to cast your commander.',
        ),
      );
      expect(def.manaProduction?.colors).toEqual(['W', 'U', 'B', 'R', 'G']);
      expect(def.manaProduction?.amounts.G).toBe(3);
      expect(def.manaProduction?.restriction).toBe('commanderSpell');
    });
  });
});
