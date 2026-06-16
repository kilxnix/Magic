import { describe, it, expect } from 'vitest';
import { tokenizeOracleText } from '../effects/tokens';
import { matchETBTutorFilterExtensions } from '../effects/matchers/search-dig';

describe('debug slice 12 matcher', () => {
  it('shows what tokens look like', () => {
    const text = 'When this creature enters, you may search your library for a nonlegendary green creature card with mana value 3 or less, reveal it, put it into your hand, then shuffle.';
    const tokens = tokenizeOracleText(text);
    console.log('tokens:', JSON.stringify(tokens));
    console.log('token[7]:', tokens[7]);
    const result = matchETBTutorFilterExtensions(tokens, 7);
    console.log('result:', JSON.stringify(result));
    expect(result).not.toBeNull();
  });
});
