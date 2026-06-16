import { describe, it, expect } from 'vitest';
import { tokenizeOracleText } from '../effects/tokens';
import { parseManaValueFilterSuffix, parseManaValueXSuffix } from '../effects/parser';

describe('debug slice 12 helper calls', () => {
  it('checks parseManaValueFilterSuffix with slice', () => {
    const text = 'When this creature enters, you may search your library for a nonlegendary green creature card with mana value 3 or less, reveal it, put it into your hand, then shuffle.';
    const tokens = tokenizeOracleText(text);
    const slice = tokens.slice(7); // starts at "search"
    console.log('slice:', JSON.stringify(slice));
    // After consuming "search your library for a nonlegendary green creature card"
    // indices: 0=search 1=your 2=library 3=for 4=a 5=nonlegendary 6=green 7=creature 8=card 9=with
    console.log('slice[8]:', slice[8], '(should be card)');
    console.log('slice[9]:', slice[9], '(should be with)');
    const mvX = parseManaValueXSuffix(slice, 9);
    console.log('parseManaValueXSuffix(slice, 9):', JSON.stringify(mvX));
    const mvN = parseManaValueFilterSuffix(slice, 9);
    console.log('parseManaValueFilterSuffix(slice, 9):', JSON.stringify(mvN));
  });
});
