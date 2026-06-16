import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import type { Effect } from '../effects/ast';

function effects(text: string): Effect[] {
  const parsed = parseOracleText(text);
  expect(parsed.kind).toBe('Spell');
  if (parsed.kind !== 'Spell') throw new Error('not a spell');
  return parsed.effects;
}

describe('mass-effects: destroy all <color> creatures', () => {
  it('parses "destroy all green creatures" as Destroy AllOfType creature+green', () => {
    const fx = effects('Destroy all green creatures.');
    expect(fx).toHaveLength(1);
    expect(fx[0].kind).toBe('Destroy');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], colors: ['G'] },
    });
  });

  it('parses each single color', () => {
    const cases: Array<[string, 'W' | 'U' | 'B' | 'R' | 'G']> = [
      ['white', 'W'],
      ['blue', 'U'],
      ['black', 'B'],
      ['red', 'R'],
      ['green', 'G'],
    ];
    for (const [word, sym] of cases) {
      const fx = effects(`Destroy all ${word} creatures.`);
      const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
      expect(e.kind).toBe('Destroy');
      expect(e.target).toEqual({
        kind: 'AllOfType',
        filter: { types: ['creature'], colors: [sym] },
      });
    }
  });

  it('parses dual-color "red or white" via OR semantics', () => {
    const fx = effects('Destroy all red or white creatures.');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], colors: ['R', 'W'] },
    });
  });
});

describe('mass-effects: destroy all lands / basic-land subtypes', () => {
  it('parses "destroy all lands"', () => {
    const fx = effects('Destroy all lands.');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.kind).toBe('Destroy');
    expect(e.target).toEqual({ kind: 'AllOfType', filter: { types: ['land'] } });
  });

  it('parses each basic land subtype to its singular subtype term', () => {
    const cases: Array<[string, string]> = [
      ['Islands', 'Island'],
      ['Plains', 'Plains'],
      ['Swamps', 'Swamp'],
      ['Mountains', 'Mountain'],
      ['Forests', 'Forest'],
    ];
    for (const [plural, sub] of cases) {
      const fx = effects(`Destroy all ${plural}.`);
      const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
      expect(e.kind).toBe('Destroy');
      expect(e.target).toEqual({
        kind: 'AllOfType',
        filter: { types: ['land'], subtypes: [sub] },
      });
    }
  });
});

describe('mass-effects: exile all <color> creatures', () => {
  it('parses "exile all white creatures" as Exile AllOfType creature+white', () => {
    const fx = effects('Exile all white creatures.');
    expect(fx).toHaveLength(1);
    const e = fx[0] as Extract<Effect, { kind: 'Exile' }>;
    expect(e.kind).toBe('Exile');
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], colors: ['W'] },
    });
  });
});

describe('mass-effects: no regression on existing mass patterns', () => {
  it('"destroy all creatures" still maps to AllCreatures', () => {
    const fx = effects('Destroy all creatures.');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.target).toEqual({ kind: 'AllCreatures' });
  });

  it('"destroy all artifacts" still maps to AllOfType artifact', () => {
    const fx = effects('Destroy all artifacts.');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.target).toEqual({ kind: 'AllOfType', filter: { types: ['artifact'] } });
  });
});
