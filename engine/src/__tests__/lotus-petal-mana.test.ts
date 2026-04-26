import { describe, it, expect } from 'vitest';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { getCardsInZone, getCardDefinition } from '../game-state';
import { tapLandForMana } from '../actions';
import { getLegalActions } from '../ai/legal-actions';
import type { ScryfallCard } from '../cards/deck-loader';

describe('Lotus Petal-style sacrifice mana abilities', () => {
  it('exposes a tap-for-mana legal action and sacrifices on activation', () => {
    resetInstanceCounter();

    const cards: ScryfallCard[] = [
      { id: 'cmd', name: 'Cmd', type_line: 'Legendary Creature — Goblin', oracle_text: '', mana_cost: '{4}{R}', cmc: 5, colors: ['R'], color_identity: ['R'], keywords: [], power: '3', toughness: '3' },
      { id: 'lotus', name: 'Lotus Petal', type_line: 'Artifact',
        oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
        mana_cost: '{0}', cmc: 0, colors: [], color_identity: [], keywords: [] },
    ];
    for (let i = 0; i < 99; i++) {
      cards.push({ id: `hm${i}`, name: `HMt${i}`, type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['R'], keywords: [] });
      cards.push({ id: `am${i}`, name: `AMt${i}`, type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['R'], keywords: [] });
    }

    const lookup = createCardLookup(cards);
    let s = initGameFromDecks({
      humanDeck: { id: 'h', commander: 'Cmd', list: ['Lotus Petal', ...Array.from({length:98}, (_,i) => `HMt${i}`)], colors: ['R'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'a', commander: 'Cmd', list: Array.from({length:99}, (_,i) => `AMt${i}`), colors: ['R'], bracket: 3, theme: '' }],
      aiDifficulty: 3, cardLookup: lookup, humanGoesFirst: true, startingLife: 40, startingHandSize: 7,
    });

    // Find Lotus Petal anywhere (library is fine — we'll move it manually) and put it on the battlefield.
    let petal = [...s.cards.values()].find(c => getCardDefinition(s, c).name === 'Lotus Petal');
    expect(petal).toBeDefined();
    petal = petal!;
    const newCards = new Map(s.cards);
    newCards.set(petal.instanceId, { ...petal, zone: 'battlefield', tapped: false, summoningSick: false });
    s = { ...s, cards: newCards, phase: 'precombat_main', step: 'main', priorityPlayerIndex: 0 };

    // Sanity: parser cached manaProduction with requiresSacrifice true and any-color
    const def = getCardDefinition(s, petal);
    expect(def.manaProduction).toBeDefined();
    expect(def.manaProduction!.requiresSacrifice).toBe(true);

    // Mana ability action should now appear in legal actions
    const actions = getLegalActions(s, 'human');
    const tapActions = actions.filter(a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === petal!.instanceId);
    expect(tapActions.length, 'Lotus Petal should expose at least one mana ability').toBeGreaterThan(0);

    // Activate one of the colors and verify the petal goes to graveyard
    const greenAction = tapActions.find(a => a.kind === 'ActivateManaAbility' && a.color === 'G');
    expect(greenAction, 'Lotus Petal should offer green among colors').toBeDefined();
    const next = tapLandForMana(s, 'human', petal.instanceId, 'G');
    expect(next.players[0].manaPool.G).toBe(1);
    expect(next.cards.get(petal.instanceId)!.zone).toBe('graveyard');
  });
});
