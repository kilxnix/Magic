import { describe, it, expect, beforeEach } from 'vitest';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import type { GeneratedDeck, ScryfallCard } from '../cards/deck-loader';
import { createCardLookup } from '../cards/deck-loader';
import { getCardsInZone } from '../game-state';
import { advanceStep, performUntapStep } from '../turn-manager';
import { drawCards } from '../actions';
import { passPriority } from '../priority';
import { runAITurn, createAIConfig } from '../ai/agent';

function makeCard(name: string, isLand: boolean): ScryfallCard {
  if (isLand) {
    return { id: name, name, type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [] };
  }
  return { id: name, name, type_line: 'Creature — Elf', oracle_text: '', mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'], keywords: [], power: '1', toughness: '1' };
}

describe('AI Turn with runAITurn', () => {
  it('runs a complete AI turn without hanging', () => {
    resetInstanceCounter();
    
    const cards: ScryfallCard[] = [];
    cards.push({ id: 'cmd1', name: 'Commander A', type_line: 'Legendary Creature — Treefolk', oracle_text: '', mana_cost: '{4}{G}{G}', cmc: 6, colors: ['G'], color_identity: ['G'], keywords: [], power: '4', toughness: '4' });
    cards.push({ id: 'cmd2', name: 'Commander B', type_line: 'Legendary Creature — Treefolk', oracle_text: '', mana_cost: '{4}{G}{G}', cmc: 6, colors: ['G'], color_identity: ['G'], keywords: [], power: '4', toughness: '4' });
    
    for (let i = 0; i < 99; i++) {
      cards.push(makeCard(`HForest${i}`, true));
      cards.push(makeCard(`AForest${i}`, true));
    }
    
    const lookup = createCardLookup(cards);
    const state = initGameFromDecks({
      humanDeck: { id: 'h', commander: 'Commander A', list: Array.from({length: 99}, (_, i) => `HForest${i}`), colors: ['G'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'a', commander: 'Commander B', list: Array.from({length: 99}, (_, i) => `AForest${i}`), colors: ['G'], bracket: 3, theme: '' }],
      aiDifficulty: 3,
      cardLookup: lookup,
      humanGoesFirst: true,
      startingLife: 40,
      startingHandSize: 7,
    });
    
    // Advance human turn 1 quickly (just pass everything)
    let s = state;
    // upkeep -> pass both -> advance
    s = passPriority(s); s = passPriority(s); s = advanceStep(s);
    // draw -> draw card -> pass both -> advance  
    s = drawCards(s, 'human', 1); s = passPriority(s); s = passPriority(s); s = advanceStep(s);
    // precombat main -> pass both -> advance
    s = passPriority(s); s = passPriority(s); s = advanceStep(s);
    // combat steps -> pass through
    for (let i = 0; i < 5; i++) { s = passPriority(s); s = passPriority(s); s = advanceStep(s); }
    // end -> pass -> advance
    s = passPriority(s); s = passPriority(s); s = advanceStep(s);
    // cleanup -> advance to AI turn
    s = advanceStep(s);
    
    expect(s.turnNumber).toBe(2);
    expect(s.players[s.activePlayerIndex].id).toBe('ai1');
    
    // NOW: AI's turn. Use runAITurn at precombat main
    // First advance through beginning phase
    s = performUntapStep(s); s = advanceStep(s); // untap -> upkeep
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // upkeep -> draw
    s = drawCards(s, 'ai1', 1);
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // draw -> begin_combat (precombat_main)
    
    expect(s.phase).toBe('precombat_main');
    
    // Run AI turn at precombat main
    console.time('runAITurn');
    const config = createAIConfig('ai1', 3);
    const { finalState, decisions } = runAITurn(s, config, 50);
    console.timeEnd('runAITurn');
    
    console.log('AI decisions:', decisions.length);
    for (const d of decisions) {
      console.log('  -', d.action.kind);
    }
    
    // AI should have done something (at least pass)
    expect(decisions.length).toBeGreaterThan(0);
    
    // Now pass for human and advance through rest of AI's turn
    let after = finalState;
    after = passPriority(after); // human passes
    // If all passed, advance
    after = advanceStep(after); // -> declare_attackers
    
    // Pass through combat
    for (let i = 0; i < 5; i++) { after = passPriority(after); after = passPriority(after); after = advanceStep(after); }
    // end -> pass -> advance
    after = passPriority(after); after = passPriority(after); after = advanceStep(after);
    // cleanup -> next turn
    after = advanceStep(after);
    
    expect(after.turnNumber).toBe(3);
    expect(after.players[after.activePlayerIndex].id).toBe('human');
    
    console.log('SUCCESS: Full AI turn completed, back to human turn 3');
  });
});
