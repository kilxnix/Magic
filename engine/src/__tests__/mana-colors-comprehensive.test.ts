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
  });
});
