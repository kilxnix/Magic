import { describe, expect, it } from 'vitest';
import { cardPickerAvailabilityLabel, cardPickerDestinationLabel, cardPickerRevealLabel, sortCardPickerCards } from '../src/components/CardPickerModal';

describe('CardPickerModal helpers', () => {
  it('sorts legal search choices before disabled choices, then by name', () => {
    const sorted = sortCardPickerCards([
      { name: 'Arcane Signet', typeLine: 'Artifact', legal: false },
      { name: 'Yoshimaru, Ever Faithful', typeLine: 'Legendary Creature - Dog', legal: true },
      { name: 'Ajani, Caller of the Pride', typeLine: 'Legendary Planeswalker - Ajani', legal: true },
      { name: 'Counterspell', typeLine: 'Instant', legal: false },
    ]);

    expect(sorted.map(card => card.name)).toEqual([
      'Ajani, Caller of the Pride',
      'Yoshimaru, Ever Faithful',
      'Arcane Signet',
      'Counterspell',
    ]);
  });

  it('uses availability wording instead of overclaiming full rules legality', () => {
    expect(cardPickerAvailabilityLabel({ legal: true })).toBe('Selectable');
    expect(cardPickerAvailabilityLabel({})).toBe('Selectable');
    expect(cardPickerAvailabilityLabel({ legal: false })).toBe('Unavailable');
  });

  it('uses explicit destination wording for library and command-zone movement', () => {
    expect(cardPickerDestinationLabel({ destination: 'top' })).toBe('To top of library');
    expect(cardPickerDestinationLabel({ destination: 'bottom' })).toBe('To bottom of library');
    expect(cardPickerDestinationLabel({ destination: 'command' })).toBe('To command zone');
    expect(cardPickerDestinationLabel({ destination: 'choice' })).toBe('Destination choice');
    expect(cardPickerDestinationLabel({})).toBeUndefined();
  });

  it('uses explicit reveal wording for hidden and revealed choices', () => {
    expect(cardPickerRevealLabel({ mustReveal: true })).toBe('Reveal pick');
    expect(cardPickerRevealLabel({ mustReveal: false })).toBe('Hidden pick');
    expect(cardPickerRevealLabel({})).toBeUndefined();
  });
});
