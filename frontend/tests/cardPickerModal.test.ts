import { describe, expect, it } from 'vitest';
import { cardPickerAvailabilityLabel, sortCardPickerCards } from '../src/components/CardPickerModal';

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
});
