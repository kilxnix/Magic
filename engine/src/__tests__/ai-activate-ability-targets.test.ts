import { describe, it, expect } from 'vitest';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { getCardDefinition } from '../game-state';
import { getLegalActions } from '../ai/legal-actions';
import { applyAction } from '../ai/agent';
import type { ScryfallCard } from '../cards/deck-loader';

describe('AI activated-ability targeting', () => {
  it('legal-actions enumerates one ActivateAbility per legal target', () => {
    resetInstanceCounter();
    // A creature with a targeted activated ability: "{T}: ~ deals 1 damage to any target."
    const cards: ScryfallCard[] = [
      { id: 'cmd', name: 'Cmd', type_line: 'Legendary Creature — Goblin', oracle_text: '', mana_cost: '{4}{R}', cmc: 5, colors: ['R'], color_identity: ['R'], keywords: [], power: '3', toughness: '3' },
      {
        id: 'pinger',
        name: 'Pinger',
        type_line: 'Creature — Beast',
        oracle_text: '{T}: ~ deals 1 damage to any target.',
        mana_cost: '{2}{R}',
        cmc: 3,
        colors: ['R'],
        color_identity: ['R'],
        keywords: [],
        power: '1',
        toughness: '1',
      },
      {
        id: 'bear',
        name: 'Bear',
        type_line: 'Creature — Bear',
        oracle_text: '',
        mana_cost: '{1}{G}',
        cmc: 2,
        colors: ['G'],
        color_identity: ['G'],
        keywords: [],
        power: '2',
        toughness: '2',
      },
    ];
    for (let i = 0; i < 99; i++) {
      cards.push({ id: `hf${i}`, name: `HF${i}`, type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [] });
      cards.push({ id: `af${i}`, name: `AF${i}`, type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [] });
    }

    const lookup = createCardLookup(cards);
    let s = initGameFromDecks({
      humanDeck: { id: 'h', commander: 'Cmd', list: ['Pinger', 'Bear', ...Array.from({ length: 97 }, (_, i) => `HF${i}`)], colors: ['R', 'G'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'a', commander: 'Cmd', list: Array.from({ length: 99 }, (_, i) => `AF${i}`), colors: ['G'], bracket: 3, theme: '' }],
      aiDifficulty: 3, cardLookup: lookup, humanGoesFirst: true, startingLife: 40, startingHandSize: 7,
    });

    // Force Pinger and Bear onto the human battlefield (no summoning sickness)
    const pinger = [...s.cards.values()].find(c => getCardDefinition(s, c).name === 'Pinger')!;
    const bear = [...s.cards.values()].find(c => getCardDefinition(s, c).name === 'Bear')!;
    const newCards = new Map(s.cards);
    newCards.set(pinger.instanceId, { ...pinger, zone: 'battlefield', tapped: false, summoningSick: false });
    newCards.set(bear.instanceId, { ...bear, zone: 'battlefield', tapped: false, summoningSick: false });
    s = { ...s, cards: newCards, phase: 'precombat_main', step: 'main', priorityPlayerIndex: 0 };

    const actions = getLegalActions(s, 'human');
    const activates = actions.filter(a => a.kind === 'ActivateAbility' && a.cardInstanceId === pinger.instanceId);

    // Pinger's ability targets "any target" — should produce at least one action with a non-empty target list
    expect(activates.length, 'ActivateAbility should be enumerated for the pinger').toBeGreaterThan(0);
    for (const a of activates) {
      if (a.kind !== 'ActivateAbility') continue;
      expect(a.targets.length, 'each ActivateAbility action must include a target').toBeGreaterThan(0);
    }

    // Applying any of these actions must not throw "Missing chosen target".
    const first = activates[0];
    expect(() => applyAction(s, 'human', first)).not.toThrow();
  });
});
