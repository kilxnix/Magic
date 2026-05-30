import { describe, expect, it } from 'vitest';
import {
  parseCardTypesFromTypeLine,
  typeLineHasSubtype,
  typeLineHasSupertype,
  typeLineHasType,
  typeLineSectionTerms,
} from './type-line';

describe('type-line helpers', () => {
  it('parses exact card types from only the type section', () => {
    expect(parseCardTypesFromTypeLine('Creature - Island Scout')).toEqual(['creature']);
    expect(parseCardTypesFromTypeLine('Basic Land - Island')).toEqual(['land']);
    expect(typeLineHasType('Creature - Island Scout', 'land')).toBe(false);
  });

  it('matches supertypes and subtype phrases without substring leaks', () => {
    expect(typeLineHasSupertype('Legendary Creature - Time Lord Doctor', 'legendary')).toBe(true);
    expect(typeLineHasSubtype('Legendary Creature - Time Lord Doctor', 'Time Lord')).toBe(true);
    expect(typeLineHasSubtype('Creature - Island Scout', 'land')).toBe(false);
    expect(typeLineSectionTerms('Creature - Island Scout', 'subtypes')).toEqual(['island', 'scout']);
  });
});
