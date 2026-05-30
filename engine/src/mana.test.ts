import { describe, it, expect } from 'vitest';
import { parseManaString, addMana, canPayCost, payManaCost, totalMana, canPaySpellCost, paySpellCost, getCreatureSubtypes } from './mana';
import { emptyManaPool, ManaPool, ManaCost, createPlayer, CardDefinition } from './types';

describe('Mana System', () => {
  describe('parseManaString', () => {
    it('parses {2}{G}{G}', () => {
      const cost = parseManaString('{2}{G}{G}');
      expect(cost).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 2, C: 0, generic: 2 });
    });

    it('parses {W}{U}{B}{R}{G}', () => {
      const cost = parseManaString('{W}{U}{B}{R}{G}');
      expect(cost).toEqual({ W: 1, U: 1, B: 1, R: 1, G: 1, C: 0, generic: 0 });
    });

    it('parses {5}', () => {
      const cost = parseManaString('{5}');
      expect(cost).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 5 });
    });

    it('parses empty string (lands)', () => {
      const cost = parseManaString('');
      expect(cost).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 });
    });

    it('parses {3}{W}{W}', () => {
      const cost = parseManaString('{3}{W}{W}');
      expect(cost).toEqual({ W: 2, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 3 });
    });

    it('parses {C} for colorless', () => {
      const cost = parseManaString('{2}{C}');
      expect(cost).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 1, generic: 2 });
    });

    it('parses two-color hybrid mana symbols', () => {
      const cost = parseManaString('{R/G}{W}{U}');
      expect(cost).toEqual({
        W: 1,
        U: 1,
        B: 0,
        R: 0,
        G: 0,
        C: 0,
        generic: 0,
        hybrid: [['R', 'G']],
      });
    });

    it('parses colored Phyrexian mana symbols', () => {
      const cost = parseManaString('{2}{G/P}{U/P}');
      expect(cost).toEqual({
        W: 0,
        U: 0,
        B: 0,
        R: 0,
        G: 0,
        C: 0,
        generic: 2,
        phyrexian: ['G', 'U'],
      });
    });

    it('parses snow mana symbols', () => {
      const cost = parseManaString('{S}{S}{1}');
      expect(cost).toEqual({
        W: 0,
        U: 0,
        B: 0,
        R: 0,
        G: 0,
        C: 0,
        generic: 1,
        snow: 2,
      });
    });
  });

  describe('addMana', () => {
    it('adds colored mana to pool', () => {
      const pool = emptyManaPool();
      const result = addMana(pool, 'G', 1);
      expect(result.G).toBe(1);
    });

    it('accumulates mana', () => {
      let pool = emptyManaPool();
      pool = addMana(pool, 'R', 2);
      pool = addMana(pool, 'R', 1);
      expect(pool.R).toBe(3);
    });
  });

  describe('canPayCost', () => {
    it('returns true when pool has exact mana', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0, generic: 0 };
      expect(canPayCost(pool, cost)).toBe(true);
    });

    it('returns true when pool has excess for generic', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 3, G: 2, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0, generic: 2 };
      expect(canPayCost(pool, cost)).toBe(true);
    });

    it('returns false when not enough colored mana', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0, generic: 0 };
      expect(canPayCost(pool, cost)).toBe(false);
    });

    it('returns false when not enough total mana for generic', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0, generic: 3 };
      expect(canPayCost(pool, cost)).toBe(false);
    });

    it('handles colorless mana requirement', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1, generic: 0 };
      expect(canPayCost(pool, cost)).toBe(true);
    });

    it('colored mana cannot pay colorless requirement', () => {
      const pool: ManaPool = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1, generic: 0 };
      expect(canPayCost(pool, cost)).toBe(false);
    });

    it('requires a legal color for a hybrid symbol', () => {
      const cost = parseManaString('{R/G}{W}{U}');

      expect(canPayCost({ W: 1, U: 1, B: 0, R: 1, G: 0, C: 0 }, cost)).toBe(true);
      expect(canPayCost({ W: 1, U: 1, B: 0, R: 0, G: 1, C: 0 }, cost)).toBe(true);
      expect(canPayCost({ W: 1, U: 1, B: 1, R: 0, G: 0, C: 1 }, cost)).toBe(false);
    });

    it('requires colored mana for Phyrexian symbols in pool-only checks', () => {
      const cost = parseManaString('{G/P}');

      expect(canPayCost({ W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 }, cost)).toBe(true);
      expect(canPayCost(emptyManaPool(), cost)).toBe(false);
    });

    it('does not allow pool-only snow costs without snow source information', () => {
      const cost = parseManaString('{S}');

      expect(canPayCost({ W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 }, cost)).toBe(false);
    });
  });

  describe('payManaCost', () => {
    it('removes colored mana first, then generic from remainder', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 2, G: 3, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0, generic: 1 };
      const result = payManaCost(pool, cost);
      expect(result.G).toBe(1);
      expect(result.R).toBe(1);
    });

    it('throws if cannot pay', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0, generic: 0 };
      expect(() => payManaCost(pool, cost)).toThrow();
    });

    it('spends one legal color for a hybrid symbol', () => {
      const cost = parseManaString('{R/G}{W}{U}');
      const result = payManaCost({ W: 1, U: 1, B: 0, R: 0, G: 1, C: 0 }, cost);
      expect(result).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    });

    it('spends colored mana for Phyrexian symbols when using pool-only payment', () => {
      const cost = parseManaString('{G/P}{1}');
      const result = payManaCost({ W: 0, U: 0, B: 0, R: 1, G: 1, C: 0 }, cost);
      expect(result).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    });
  });

  describe('paySpellCost', () => {
    const spellDef: CardDefinition = {
      id: 'test_phyrexian_spell',
      name: 'Test Phyrexian Spell',
      type_line: 'Sorcery',
      oracle_text: '',
      mana_cost: '{G/P}',
      cmc: 1,
      colors: ['G'],
      color_identity: ['G'],
      keywords: [],
      card_types: ['sorcery'],
    };

    it('allows Phyrexian spell costs to be paid with life when the color is unavailable', () => {
      const player = createPlayer('p1', 'Alice');
      const cost = parseManaString('{G/P}');

      expect(canPaySpellCost(player, cost, spellDef)).toBe(true);

      const paid = paySpellCost(player, cost, spellDef);
      expect(paid.life).toBe(38);
      expect(paid.manaPool).toEqual(emptyManaPool());
    });

    it('prefers matching colored mana over life for Phyrexian spell costs', () => {
      const player = {
        ...createPlayer('p1', 'Alice'),
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
      };
      const cost = parseManaString('{G/P}');

      const paid = paySpellCost(player, cost, spellDef);
      expect(paid.life).toBe(40);
      expect(paid.manaPool.G).toBe(0);
    });

    it('rejects Phyrexian life payment when the player does not have enough life', () => {
      const player = { ...createPlayer('p1', 'Alice'), life: 1 };
      const cost = parseManaString('{G/P}');

      expect(canPaySpellCost(player, cost, spellDef)).toBe(false);
      expect(() => paySpellCost(player, cost, spellDef)).toThrow('Cannot pay mana cost');
    });

    it('requires snow mana for snow spell costs', () => {
      const player = {
        ...createPlayer('p1', 'Alice'),
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        snowManaPool: emptyManaPool(),
      };
      const cost = parseManaString('{S}');

      expect(canPaySpellCost(player, cost, spellDef)).toBe(false);
    });

    it('spends mana marked as snow for snow spell costs', () => {
      const player = {
        ...createPlayer('p1', 'Alice'),
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        snowManaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
      };
      const cost = parseManaString('{S}');

      const paid = paySpellCost(player, cost, spellDef);
      expect(paid.manaPool.G).toBe(0);
      expect(paid.snowManaPool?.G).toBe(0);
    });

    it('allows creature-type restricted mana for multi-word creature types', () => {
      const doctorDef: CardDefinition = {
        id: 'doctor',
        name: 'The Test Doctor',
        type_line: 'Legendary Creature - Time Lord Doctor',
        oracle_text: '',
        mana_cost: '{U}',
        cmc: 1,
        colors: ['U'],
        color_identity: ['U'],
        keywords: [],
        card_types: ['creature'],
      };
      const player = {
        ...createPlayer('p1', 'Alice'),
        manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
        restrictedMana: [{ color: 'U' as const, amount: 1, restriction: 'creatureTypeSpell' as const, creatureType: 'Time Lord' }],
      };

      expect(getCreatureSubtypes(doctorDef)).toEqual(['time', 'lord', 'doctor']);
      expect(canPaySpellCost(player, parseManaString('{U}'), doctorDef)).toBe(true);
    });

    it('does not allow legendary-restricted mana for Legendary as subtype text', () => {
      const fakeLegendDef: CardDefinition = {
        id: 'fake-legend',
        name: 'Mistitled Bear',
        type_line: 'Creature - Legendary Bear',
        oracle_text: '',
        mana_cost: '{G}',
        cmc: 1,
        colors: ['G'],
        color_identity: ['G'],
        keywords: [],
        card_types: ['creature'],
      };
      const player = {
        ...createPlayer('p1', 'Alice'),
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        restrictedMana: [{ color: 'G' as const, amount: 1, restriction: 'legendarySpell' as const }],
      };

      expect(canPaySpellCost(player, parseManaString('{G}'), fakeLegendDef)).toBe(false);
    });

    it('preserves snow mana for snow symbols when colored mana can be paid another way', () => {
      const player = {
        ...createPlayer('p1', 'Alice'),
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
        snowManaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
      };
      const cost = parseManaString('{G}{S}');

      const paid = paySpellCost(player, cost, spellDef);
      expect(paid.manaPool.G).toBe(0);
      expect(paid.snowManaPool?.G).toBe(0);
    });
  });

  describe('totalMana', () => {
    it('sums all colors', () => {
      const pool: ManaPool = { W: 1, U: 2, B: 0, R: 1, G: 3, C: 0 };
      expect(totalMana(pool)).toBe(7);
    });
  });
});
