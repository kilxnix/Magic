import { describe, expect, it } from 'vitest';
import { parseManaPips, colorIdentityFromManaCost } from './manaColors';

describe('parseManaPips', () => {
  it('splits each brace group into a pip token', () => {
    expect(parseManaPips('{2}{G}{G}')).toEqual(['2', 'G', 'G']);
    expect(parseManaPips('{W}{U}{B}{R}{G}')).toEqual(['W', 'U', 'B', 'R', 'G']);
  });
  it('returns [] for empty/undefined cost', () => {
    expect(parseManaPips('')).toEqual([]);
    expect(parseManaPips(undefined as unknown as string)).toEqual([]);
  });
  it('keeps hybrid/phyrexian tokens intact', () => {
    expect(parseManaPips('{G/W}{U/P}')).toEqual(['G/W', 'U/P']);
  });
});

describe('colorIdentityFromManaCost', () => {
  it('extracts distinct WUBRG in WUBRG order', () => {
    expect(colorIdentityFromManaCost('{1}{G}{W}')).toEqual(['W', 'G']);
    expect(colorIdentityFromManaCost('{G}{G}')).toEqual(['G']);
  });
  it('reads colors out of hybrid and phyrexian symbols', () => {
    expect(colorIdentityFromManaCost('{G/W}')).toEqual(['W', 'G']);
    expect(colorIdentityFromManaCost('{U/P}')).toEqual(['U']);
  });
  it('is empty for purely generic/colorless costs', () => {
    expect(colorIdentityFromManaCost('{3}')).toEqual([]);
    expect(colorIdentityFromManaCost('')).toEqual([]);
  });
});
