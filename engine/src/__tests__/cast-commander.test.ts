import { describe, it, expect } from 'vitest';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { getCardsInZone } from '../game-state';
import { advanceStep, performUntapStep } from '../turn-manager';
import { drawCards } from '../actions';
import { passPriority } from '../priority';
import { applyAction } from '../ai/agent';
import { getLegalActions } from '../ai/legal-actions';
import type { ScryfallCard } from '../cards/deck-loader';

describe('Cast commander from command zone', () => {
  it('can cast a 3-cost commander with 3 mountains', () => {
    resetInstanceCounter();
    
    const cards: ScryfallCard[] = [
      { id: 'cmd', name: 'Test Commander', type_line: 'Legendary Creature — Goblin', oracle_text: '', mana_cost: '{2}{R}', cmc: 3, colors: ['R'], color_identity: ['R'], keywords: [], power: '3', toughness: '3' },
    ];
    for (let i = 0; i < 99; i++) {
      cards.push({ id: `hm${i}`, name: `HMt${i}`, type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['R'], keywords: [] });
      cards.push({ id: `am${i}`, name: `AMt${i}`, type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['R'], keywords: [] });
    }
    
    const lookup = createCardLookup(cards);
    let s = initGameFromDecks({
      humanDeck: { id: 'h', commander: 'Test Commander', list: Array.from({length:99}, (_,i) => `HMt${i}`), colors: ['R'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'a', commander: 'Test Commander', list: Array.from({length:99}, (_,i) => `AMt${i}`), colors: ['R'], bracket: 3, theme: '' }],
      aiDifficulty: 3, cardLookup: lookup, humanGoesFirst: true, startingLife: 40, startingHandSize: 7,
    });
    
    // Verify commander is in command zone
    const cmdZone = getCardsInZone(s, 'human', 'command');
    console.log('Commander in command zone:', cmdZone.length);
    expect(cmdZone.length).toBe(1);
    
    // Play 3 turns to get 3 lands on battlefield
    for (let turn = 0; turn < 3; turn++) {
      // Handle untap/upkeep
      if (s.step === 'untap') { s = performUntapStep(s); s = advanceStep(s); }
      s = passPriority(s); s = passPriority(s); s = advanceStep(s); // upkeep -> draw
      s = drawCards(s, 'human', 1);
      s = passPriority(s); s = passPriority(s); s = advanceStep(s); // draw -> main
      
      // Play a land
      let actions = getLegalActions(s, 'human');
      const land = actions.find(a => a.kind === 'PlayLand');
      if (land) s = applyAction(s, 'human', land);
      
      // Pass through rest of turn
      s = passPriority(s); s = passPriority(s); s = advanceStep(s); // -> declare_attackers
      for (let i = 0; i < 5; i++) { s = passPriority(s); s = passPriority(s); s = advanceStep(s); }
      s = passPriority(s); s = passPriority(s); s = advanceStep(s); // end
      s = advanceStep(s); // cleanup -> next turn
      
      // AI turn - skip entirely
      if (s.step === 'untap') { s = performUntapStep(s); s = advanceStep(s); }
      s = passPriority(s); s = passPriority(s); s = advanceStep(s); // upkeep
      s = drawCards(s, 'ai1', 1);
      s = passPriority(s); s = passPriority(s); s = advanceStep(s); // draw
      s = passPriority(s); s = passPriority(s); s = advanceStep(s); // main
      for (let i = 0; i < 5; i++) { s = passPriority(s); s = passPriority(s); s = advanceStep(s); }
      s = passPriority(s); s = passPriority(s); s = advanceStep(s); // end
      s = advanceStep(s); // next turn
    }
    
    // Should have 3 mountains on battlefield
    const bf = getCardsInZone(s, 'human', 'battlefield');
    console.log('Lands on battlefield:', bf.length);
    expect(bf.length).toBe(3);
    
    // Now it's human's turn 4 main phase
    if (s.step === 'untap') { s = performUntapStep(s); s = advanceStep(s); }
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // upkeep
    s = drawCards(s, 'human', 1);
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // main
    
    // Tap 3 mountains
    let actions = getLegalActions(s, 'human');
    const manaActions = actions.filter(a => a.kind === 'ActivateManaAbility');
    console.log('Mana actions available:', manaActions.length);
    for (let i = 0; i < 3 && i < manaActions.length; i++) {
      s = applyAction(s, 'human', manaActions[i]);
    }
    console.log('Mana pool after tapping:', s.players[0].manaPool);
    
    // Check if we can cast commander
    actions = getLegalActions(s, 'human');
    const castCmd = actions.filter(a => a.kind === 'CastSpell');
    console.log('CastSpell actions:', castCmd.length);
    for (const a of castCmd) {
      const inst = s.cards.get(a.cardInstanceId);
      const def = inst ? s.cardDefinitions.get(inst.definitionId) : undefined;
      console.log('  Can cast:', def?.name, 'zone:', inst?.zone);
    }
    
    const cmdCast = castCmd.find(a => {
      const inst = s.cards.get(a.cardInstanceId);
      return inst?.zone === 'command';
    });
    
    expect(cmdCast).toBeDefined();
    console.log('Commander IS castable from command zone!');
    
    // Actually cast it
    if (cmdCast) {
      s = applyAction(s, 'human', cmdCast);
      const cmdOnBF = getCardsInZone(s, 'human', 'battlefield').filter(c => c.isCommander);
      console.log('Commander on battlefield:', cmdOnBF.length);
      // It might be on the stack first, resolve it
      if (s.stack.length > 0) {
        console.log('Stack:', s.stack.length, 'items (commander spell on stack)');
      }
    }
  });
});
