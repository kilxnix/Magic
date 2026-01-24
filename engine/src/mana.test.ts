import { describe, it, expect } from 'vitest';
import { parseManaString, addMana, canPayCost, payManaCost, totalMana } from './mana';
import { emptyManaPool, ManaPool, ManaCost } from './types';

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
  });

  describe('totalMana', () => {
    it('sums all colors', () => {
      const pool: ManaPool = { W: 1, U: 2, B: 0, R: 1, G: 3, C: 0 };
      expect(totalMana(pool)).toBe(7);
    });
  });
});
