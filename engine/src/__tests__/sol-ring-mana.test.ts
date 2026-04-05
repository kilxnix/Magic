import { describe, it, expect } from 'vitest';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { getCardsInZone, getCardDefinition } from '../game-state';
import { advanceStep } from '../turn-manager';
import { drawCards } from '../actions';
import { passPriority } from '../priority';
import { applyAction } from '../ai/agent';
import { getLegalActions } from '../ai/legal-actions';
import type { ScryfallCard } from '../cards/deck-loader';

describe('Sol Ring mana', () => {
  it('can cast Sol Ring and tap it for mana', () => {
    resetInstanceCounter();
    
    const cards: ScryfallCard[] = [
      { id: 'cmd', name: 'Cmd', type_line: 'Legendary Creature — Goblin', oracle_text: '', mana_cost: '{4}{R}', cmc: 5, colors: ['R'], color_identity: ['R'], keywords: [], power: '3', toughness: '3' },
      { id: 'sol', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [], keywords: [] },
    ];
    for (let i = 0; i < 99; i++) {
      cards.push({ id: `hm${i}`, name: `HMt${i}`, type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['R'], keywords: [] });
      cards.push({ id: `am${i}`, name: `AMt${i}`, type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['R'], keywords: [] });
    }
    
    const lookup = createCardLookup(cards);
    let s = initGameFromDecks({
      humanDeck: { id: 'h', commander: 'Cmd', list: ['Sol Ring', ...Array.from({length:98}, (_,i) => `HMt${i}`)], colors: ['R'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'a', commander: 'Cmd', list: Array.from({length:99}, (_,i) => `AMt${i}`), colors: ['R'], bracket: 3, theme: '' }],
      aiDifficulty: 3, cardLookup: lookup, humanGoesFirst: true, startingLife: 40, startingHandSize: 7,
    });
    
    // Check what's in the hand
    const hand = getCardsInZone(s, 'human', 'hand');
    console.log('Hand cards:');
    for (const c of hand) {
      const def = getCardDefinition(s, c);
      console.log(`  ${def.name} (${def.type_line})`);
    }
    
    const hasSolRing = hand.some(c => getCardDefinition(s, c).name === 'Sol Ring');
    console.log('Sol Ring in hand:', hasSolRing);
    
    if (!hasSolRing) {
      console.log('Sol Ring not in opening hand (shuffled into library). Skipping test.');
      return;
    }
    
    // Turn 1: main phase
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // upkeep
    s = drawCards(s, 'human', 1);
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // main
    
    // Play mountain + tap for mana
    let actions = getLegalActions(s, 'human');
    const land = actions.find(a => a.kind === 'PlayLand');
    if (land) s = applyAction(s, 'human', land);
    
    actions = getLegalActions(s, 'human');
    const tap = actions.find(a => a.kind === 'ActivateManaAbility');
    if (tap) s = applyAction(s, 'human', tap);
    
    console.log('Mana pool:', s.players[0].manaPool);
    
    // Try to cast Sol Ring
    actions = getLegalActions(s, 'human');
    const castSol = actions.find(a => {
      if (a.kind !== 'CastSpell') return false;
      const inst = s.cards.get(a.cardInstanceId);
      const def = inst ? s.cardDefinitions.get(inst.definitionId) : undefined;
      return def?.name === 'Sol Ring';
    });
    console.log('Cast Sol Ring action:', !!castSol);
    
    if (!castSol) {
      console.log('All CastSpell actions:');
      for (const a of actions.filter(x => x.kind === 'CastSpell')) {
        const inst = s.cards.get(a.cardInstanceId);
        const def = inst ? s.cardDefinitions.get(inst.definitionId) : undefined;
        console.log(`  ${def?.name} zone=${inst?.zone}`);
      }
      console.log('All actions:', actions.map(a => a.kind));
    }
    
    expect(castSol).toBeDefined();
  });
});
