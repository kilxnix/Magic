import { describe, expect, it } from 'vitest';
import { typeLineHasSubtype, typeLineHasSupertype, typeLineHasType } from '../src/lib/typeLine';

describe('typeLine helpers', () => {
  it('matches only exact card types from the type section', () => {
    expect(typeLineHasType('Creature - Island Scout', 'creature')).toBe(true);
    expect(typeLineHasType('Creature - Island Scout', 'land')).toBe(false);
    expect(typeLineHasType('Basic Land - Island', 'land')).toBe(true);
  });

  it('matches supertypes and subtype phrases without substring leaks', () => {
    expect(typeLineHasSupertype('Legendary Creature - Time Lord Doctor', 'legendary')).toBe(true);
    expect(typeLineHasSubtype('Legendary Creature - Time Lord Doctor', 'Time Lord')).toBe(true);
    expect(typeLineHasSubtype('Creature - Island Scout', 'land')).toBe(false);
  });
});
