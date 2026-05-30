import { describe, expect, it } from 'vitest';
import { cleanDeckListCardName, parseRoomDeckList } from '../src/lib/deckListParser';

describe('room deck parser', () => {
  it('strips export quantity, set codes, collector numbers, and repeated tags', () => {
    expect(cleanDeckListCardName('1x Chaos Orb (2ED) 233 *F* *CMDR*')).toBe('Chaos Orb');
    expect(cleanDeckListCardName('2 [CMM:401] Forest [CMM] 401')).toBe('Forest');
  });

  it('keeps partner commanders out of the room deck list', () => {
    const list = parseRoomDeckList(
      [
        'Commander',
        '1 The Fourteenth Doctor',
        '1 Clara Oswald',
        'Deck',
        '1 Sol Ring',
        '10 Forest',
        'Sideboard',
        '1 Chaos Orb',
      ].join('\n'),
      'The Fourteenth Doctor / Clara Oswald',
    );

    expect(list).toHaveLength(11);
    expect(list).not.toContain('The Fourteenth Doctor');
    expect(list).not.toContain('Clara Oswald');
    expect(list).not.toContain('Chaos Orb');
    expect(list.filter(card => card === 'Forest')).toHaveLength(10);
  });
});
