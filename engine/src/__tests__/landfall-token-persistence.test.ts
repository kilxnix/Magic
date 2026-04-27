import { describe, it, expect } from 'vitest';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { getCardsInZone, getCardDefinition } from '../game-state';
import { playLand } from '../actions';
import { putTriggersOnStack, resolveTopOfStack, registerBattlefieldAbilities } from '../stack';
import { checkStateBasedActions } from '../state-based';
import type { ScryfallCard } from '../cards/deck-loader';

describe('Landfall token persistence (Scute Swarm reproduction)', () => {
  it('1/1 Insect token created by landfall stays on the battlefield after SBAs', () => {
    resetInstanceCounter();
    const cards: ScryfallCard[] = [
      { id: 'cmd', name: 'Cmd', type_line: 'Legendary Creature — Goblin', oracle_text: '', mana_cost: '{4}{R}', cmc: 5, colors: ['R'], color_identity: ['R'], keywords: [], power: '3', toughness: '3' },
      {
        id: 'scute',
        name: 'Scute Swarm',
        type_line: 'Creature — Insect',
        oracle_text: 'Landfall — Whenever a land you control enters, create a 1/1 green Insect creature token.',
        mana_cost: '{2}{G}',
        cmc: 3,
        colors: ['G'],
        color_identity: ['G'],
        keywords: [],
        power: '1',
        toughness: '1',
      },
    ];
    for (let i = 0; i < 99; i++) {
      cards.push({ id: `hf${i}`, name: `HF${i}`, type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [] });
      cards.push({ id: `af${i}`, name: `AF${i}`, type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [] });
    }

    const lookup = createCardLookup(cards);
    let s = initGameFromDecks({
      humanDeck: { id: 'h', commander: 'Cmd', list: ['Scute Swarm', ...Array.from({ length: 98 }, (_, i) => `HF${i}`)], colors: ['G'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'a', commander: 'Cmd', list: Array.from({ length: 99 }, (_, i) => `AF${i}`), colors: ['G'], bracket: 3, theme: '' }],
      aiDifficulty: 3, cardLookup: lookup, humanGoesFirst: true, startingLife: 40, startingHandSize: 7,
    });

    // Force Scute Swarm onto the battlefield (skip the cast flow)
    const scuteInst = [...s.cards.values()].find(c => getCardDefinition(s, c).name === 'Scute Swarm');
    expect(scuteInst).toBeDefined();
    const newCards = new Map(s.cards);
    newCards.set(scuteInst!.instanceId, { ...scuteInst!, zone: 'battlefield', summoningSick: false, tapped: false });
    s = { ...s, cards: newCards, phase: 'precombat_main', step: 'main', priorityPlayerIndex: 0 };

    // Register Scute Swarm's triggers (this is what playLand does for new permanents,
    // but we placed it manually so we must register explicitly).
    s = registerBattlefieldAbilities(s, scuteInst!.instanceId);
    const registeredAbilities = s.battlefieldAbilities.get(scuteInst!.instanceId);
    expect(registeredAbilities, 'Scute Swarm should register its landfall trigger').toBeDefined();
    expect(registeredAbilities!.length).toBeGreaterThan(0);
    expect(registeredAbilities!.some(a => a.trigger.kind === 'Landfall')).toBe(true);

    // Find and play a Forest from hand. Pre-flight: confirm Scute is currently on battlefield.
    expect(s.cards.get(scuteInst!.instanceId)!.zone).toBe('battlefield');

    const forest = [...s.cards.values()].find(c => c.zone === 'hand' && getCardDefinition(s, c).type_line.includes('Forest'));
    expect(forest).toBeDefined();
    s = playLand(s, 'human', forest!.instanceId);

    // Run SBAs (mirrors what the engine does after each action)
    s = checkStateBasedActions(s);

    // After playLand + SBAs, Scute Swarm must still be on the battlefield
    const scuteAfter = s.cards.get(scuteInst!.instanceId);
    expect(scuteAfter?.zone, 'Scute Swarm must still be on the battlefield after a land enters').toBe('battlefield');

    // The landfall trigger should be queued as a pending trigger
    expect(s.pendingTriggers.length, 'Landfall trigger should be pending').toBeGreaterThan(0);

    // Put trigger on stack and resolve it
    s = putTriggersOnStack(s);
    expect(s.stack.length).toBeGreaterThan(0);
    while (s.stack.length > 0) {
      s = resolveTopOfStack(s);
    }
    s = checkStateBasedActions(s);

    // Now check that:
    // (1) An Insect token exists
    // (2) The token is on the battlefield (NOT in graveyard)
    // (3) Scute Swarm is still on the battlefield
    const tokens = [...s.cards.values()].filter(c => c.isToken);
    const insectTokens = tokens.filter(c => getCardDefinition(s, c).name === 'Insect');
    expect(insectTokens.length, 'one Insect token should be created').toBeGreaterThanOrEqual(1);

    for (const tok of insectTokens) {
      expect(tok.zone, 'Insect token should be on the battlefield, not in graveyard').toBe('battlefield');
    }

    expect(s.cards.get(scuteInst!.instanceId)?.zone).toBe('battlefield');
  });
});
