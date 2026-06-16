import { describe, it, expect } from 'vitest';
import { tokenizeOracleText } from '../effects/tokens';
import { COLOR_WORDS, parseManaValueFilterSuffix, parseManaValueXSuffix, mergeStaticFilters, titleCaseCardName } from '../effects/parser';
import type { CardFilter, Effect } from '../effects/ast';

// Mini-replicate the matcher logic step by step
describe('debug: step through matchETBTutorFilterExtensions manually', () => {
  it('traces the nonlegendary path', () => {
    const text = 'When this creature enters, you may search your library for a nonlegendary green creature card with mana value 3 or less, reveal it, put it into your hand, then shuffle.';
    const tokens = tokenizeOracleText(text);
    const startIndex = 7;
    const slice = tokens.slice(startIndex);
    
    console.log('slice:', JSON.stringify(slice));
    
    // Must start with "search your library"
    expect(slice[0]).toBe('search');
    expect(slice[1]).toBe('your');
    expect(slice[2]).toBe('library');
    
    let idx = 3;
    let searchGraveyard = false;
    
    // "and/or" check
    if (slice[idx] === 'and/or' && slice[idx + 1] === 'graveyard') {
      searchGraveyard = true;
      idx += 2;
    }
    console.log('after and/or check, idx:', idx, 'searchGraveyard:', searchGraveyard);
    
    // Must continue with "for"
    expect(slice[idx]).toBe('for');
    idx++;
    console.log('after for, idx:', idx);
    
    // Article
    expect(slice[idx]).toBe('a');
    idx++;
    console.log('after article, idx:', idx);
    
    let filter: CardFilter = {};
    
    // nonlegendary check
    if (slice[idx] === 'nonlegendary') {
      filter = mergeStaticFilters(filter, { excludeSupertypes: ['Legendary'] });
      idx++;
    }
    console.log('after nonlegendary, idx:', idx, 'filter:', JSON.stringify(filter));
    
    const hasNonLegendaryPrefix = filter.excludeSupertypes?.includes('Legendary') ?? false;
    console.log('hasNonLegendaryPrefix:', hasNonLegendaryPrefix);
    
    // Color
    if (COLOR_WORDS[slice[idx]]) {
      const colorCode = COLOR_WORDS[slice[idx]];
      filter = mergeStaticFilters(filter, { colors: [colorCode] });
      idx++;
    }
    console.log('after color, idx:', idx, 'filter:', JSON.stringify(filter));
    
    // Type
    const TYPE_WORDS: Record<string, string> = {
      creature: 'creature', artifact: 'artifact', enchantment: 'enchantment',
      instant: 'instant', sorcery: 'sorcery', land: 'land', planeswalker: 'planeswalker',
    };
    if (TYPE_WORDS[slice[idx]]) {
      filter = mergeStaticFilters(filter, { types: [TYPE_WORDS[slice[idx]]] });
      idx++;
    }
    console.log('after type, idx:', idx, 'filter:', JSON.stringify(filter));
    
    // Hyphen check
    const isHyphenSubtype = (
      slice[idx] !== undefined
      && slice[idx + 1] === '-'
      && slice[idx + 2] !== undefined
      && /^[a-z]+$/.test(slice[idx])
      && /^[a-z]+$/.test(slice[idx + 2])
    );
    console.log('isHyphenSubtype:', isHyphenSubtype, 'slice[idx]:', slice[idx]);
    
    // card keyword check
    console.log('slice[idx] for card check:', slice[idx], '(expected "card")');
    expect(slice[idx]).toBe('card');
    idx++;
    
    // mv suffix
    const mvResult = parseManaValueXSuffix(slice, idx) ?? parseManaValueFilterSuffix(slice, idx);
    console.log('mvResult:', JSON.stringify(mvResult), 'idx:', idx);
    
    expect(mvResult).not.toBeNull();
  });
});
