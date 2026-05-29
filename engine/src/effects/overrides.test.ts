import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerOverrideById,
  registerOverrideByName,
  getOverride,
  hasOverride,
  clearOverrides,
  getOverrideCounts,
} from './overrides';
import type { OverrideDefinition } from './overrides';

describe('overrides registry', () => {
  // Note: We don't clear before each test because the module has pre-registered
  // overrides for common cards. Instead, test with unique names/ids.

  const testOverride: OverrideDefinition = {
    kind: 'Spell',
    effects: [
      {
        kind: 'Draw',
        player: { kind: 'Controller' },
        count: 5,
      },
    ],
    targets: [],
  };

  describe('registerOverrideById', () => {
    it('registers and retrieves by definitionId', () => {
      registerOverrideById('test-def-123', testOverride);

      const result = getOverride('test-def-123', 'Some Card');
      expect(result).toBe(testOverride);
    });
  });

  describe('registerOverrideByName', () => {
    it('registers and retrieves by name (case-insensitive)', () => {
      registerOverrideByName('Test Card Name', testOverride);

      const result = getOverride('nonexistent-id', 'test card name');
      expect(result).toBe(testOverride);
    });

    it('matches regardless of case', () => {
      registerOverrideByName('UPPER CASE CARD', testOverride);

      const result = getOverride('nonexistent-id', 'upper case card');
      expect(result).toBe(testOverride);
    });
  });

  describe('getOverride priority', () => {
    it('prefers definitionId over name', () => {
      const idOverride: OverrideDefinition = {
        kind: 'Spell',
        effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: 1 }],
        targets: [],
      };
      const nameOverride: OverrideDefinition = {
        kind: 'Spell',
        effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: 2 }],
        targets: [],
      };

      registerOverrideById('priority-test-id', idOverride);
      registerOverrideByName('Priority Test Card', nameOverride);

      // When both match, definitionId wins
      const result = getOverride('priority-test-id', 'Priority Test Card');
      expect(result).toBe(idOverride);
    });

    it('falls back to name when id not found', () => {
      const nameOverride: OverrideDefinition = {
        kind: 'Spell',
        effects: [{ kind: 'GainLife', player: { kind: 'Controller' }, amount: 10 }],
        targets: [],
      };

      registerOverrideByName('Fallback Card', nameOverride);

      const result = getOverride('unknown-id', 'Fallback Card');
      expect(result).toBe(nameOverride);
    });

    it('returns null when neither matches', () => {
      const result = getOverride('no-such-id', 'No Such Card');
      expect(result).toBeNull();
    });
  });

  describe('hasOverride', () => {
    it('returns true when override exists', () => {
      registerOverrideByName('Has Override Card', testOverride);
      expect(hasOverride('any-id', 'Has Override Card')).toBe(true);
    });

    it('returns false when no override exists', () => {
      expect(hasOverride('missing-id', 'Missing Card')).toBe(false);
    });
  });

  describe('pre-registered overrides', () => {
    it('has Blasphemous Act registered', () => {
      const result = getOverride('any', 'Blasphemous Act');
      expect(result).not.toBeNull();
      expect(result?.kind).toBe('Spell');
      if (result?.kind === 'Spell') {
        expect(result.effects[0].kind).toBe('DealDamage');
      }
    });

    it('has Beast Within registered', () => {
      const result = getOverride('any', 'Beast Within');
      expect(result).not.toBeNull();
      if (result?.kind === 'Spell') {
        expect(result.effects[0].kind).toBe('Destroy');
      }
    });

    it('has Wrath of God registered', () => {
      const result = getOverride('any', 'Wrath of God');
      expect(result).not.toBeNull();
      if (result?.kind === 'Spell') {
        expect(result.effects[0].kind).toBe('Destroy');
      }
    });

    it('has Wheel of Fortune registered as discard hands then draw seven', () => {
      const result = getOverride('any', 'Wheel of Fortune');
      expect(result).not.toBeNull();
      if (result?.kind === 'Spell') {
        expect(result.effects).toHaveLength(2);
        expect(result.effects[0]).toMatchObject({
          kind: 'Discard',
          player: { kind: 'EachPlayer' },
          count: 99,
        });
        expect(result.effects[1]).toMatchObject({
          kind: 'Draw',
          player: { kind: 'EachPlayer' },
          count: 7,
        });
      }
    });
  });

  describe('getOverrideCounts', () => {
    it('returns count of registered overrides', () => {
      const counts = getOverrideCounts();
      // Pre-registered overrides
      expect(counts.byName).toBeGreaterThanOrEqual(4);
    });
  });
});
