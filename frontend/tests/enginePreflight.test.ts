import { describe, expect, it } from 'vitest';
import {
  findUnsupportedEngineCards,
  formatUnsupportedEngineCards,
} from '../src/lib/enginePreflight';

describe('engine preflight', () => {
  it('reports hard unsupported cards with deck labels and reasons', () => {
    const unsupported = findUnsupportedEngineCards([
      {
        label: 'Your deck',
        commander: 'Talrand, Sky Summoner',
        cards: ['1x Chaos Orb (2ED)', 'Island'],
      },
      {
        label: 'Shelector AI 1',
        cards: ['Shahrazad'],
      },
    ]);

    expect(unsupported).toEqual([
      {
        deckLabel: 'Your deck',
        name: 'Chaos Orb',
        reason: 'Manual dexterity / physical-card resolution is not automated.',
      },
      {
        deckLabel: 'Shelector AI 1',
        name: 'Shahrazad',
        reason: 'Subgame creation is not automated.',
      },
    ]);
    expect(formatUnsupportedEngineCards(unsupported)).toContain('Engine preflight failed');
  });

  it('deduplicates repeated unsupported card names per deck', () => {
    const unsupported = findUnsupportedEngineCards([
      {
        label: 'Your deck',
        cards: ['Chaos Orb', '1x Chaos Orb (2ED) 233 *F* *CMDR*', 'Falling Star'],
      },
    ]);

    expect(unsupported.map(card => card.name)).toEqual(['Chaos Orb', 'Falling Star']);
  });
});
