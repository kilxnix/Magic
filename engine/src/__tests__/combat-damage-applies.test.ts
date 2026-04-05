import { describe, it, expect } from 'vitest';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { getCardsInZone } from '../game-state';
import { advanceStep, performUntapStep } from '../turn-manager';
import { drawCards } from '../actions';
import { passPriority } from '../priority';
import { applyAction } from '../ai/agent';
import { getLegalActions } from '../ai/legal-actions';
import { resolveCombatDamage } from '../combat';
import type { ScryfallCard } from '../cards/deck-loader';

describe('Combat damage applies to life totals', () => {
  it('attacking with a creature reduces defender life', () => {
    resetInstanceCounter();
    
    const cards: ScryfallCard[] = [
      { id: 'cmd', name: 'Cmd', type_line: 'Legendary Creature', oracle_text: '', mana_cost: '{6}', cmc: 6, colors: ['R'], color_identity: ['R'], keywords: [], power: '1', toughness: '1' },
      { id: 'goblin', name: 'Goblin', type_line: 'Creature — Goblin', oracle_text: 'Haste', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'], keywords: ['Haste'], power: '2', toughness: '1' },
    ];
    for (let i = 0; i < 99; i++) {
      cards.push({ id: `hm${i}`, name: `HMt${i}`, type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['R'], keywords: [] });
      cards.push({ id: `am${i}`, name: `AMt${i}`, type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['R'], keywords: [] });
    }
    
    const humanList = ['Goblin', ...Array.from({length: 98}, (_, i) => `HMt${i}`)];
    const aiList = Array.from({length: 99}, (_, i) => `AMt${i}`);
    
    const lookup = createCardLookup(cards);
    let s = initGameFromDecks({
      humanDeck: { id: 'h', commander: 'Cmd', list: humanList, colors: ['R'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'a', commander: 'Cmd', list: aiList, colors: ['R'], bracket: 3, theme: '' }],
      aiDifficulty: 3, cardLookup: lookup, humanGoesFirst: true, startingLife: 40, startingHandSize: 7,
    });
    
    // Turn 1: upkeep -> draw -> main
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // upkeep -> draw
    s = drawCards(s, 'human', 1);
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // draw -> begin_combat (main)
    
    // Play a mountain
    let actions = getLegalActions(s, 'human');
    const land = actions.find(a => a.kind === 'PlayLand');
    if (land) s = applyAction(s, 'human', land);
    
    // Tap mountain for R
    actions = getLegalActions(s, 'human');
    const mana = actions.find(a => a.kind === 'ActivateManaAbility');
    if (mana) s = applyAction(s, 'human', mana);
    
    // Cast Goblin (has Haste!)
    actions = getLegalActions(s, 'human');
    const cast = actions.find(a => a.kind === 'CastSpell');
    if (cast) {
      s = applyAction(s, 'human', cast);
      console.log('Cast goblin');
    }
    
    // Pass to combat
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // -> declare_attackers
    
    // Declare attackers
    actions = getLegalActions(s, 'human');
    const attack = actions.find(a => a.kind === 'DeclareAttackers' && a.attacks.length > 0);
    if (attack) {
      s = applyAction(s, 'human', attack);
      console.log('Attacked with goblin');
    }
    
    // Pass through to combat_damage
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // -> declare_blockers
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // -> first_strike
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // -> combat_damage
    
    // RESOLVE COMBAT DAMAGE
    const lifeBefore = s.players.find(p => p.id === 'ai1')!.life;
    s = resolveCombatDamage(s);
    const lifeAfter = s.players.find(p => p.id === 'ai1')!.life;
    
    console.log(`AI life: ${lifeBefore} -> ${lifeAfter}`);
    expect(lifeAfter).toBeLessThan(lifeBefore);
    expect(lifeAfter).toBe(38); // 2 power goblin = 2 damage
  });
});
