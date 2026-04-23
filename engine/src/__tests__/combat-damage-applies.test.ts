import { describe, it, expect } from 'vitest';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { advanceStep } from '../turn-manager';
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

    // Find the Goblin instance (it may be anywhere after the library shuffle) and
    // place it directly on the battlefield with no summoning sickness (Haste).
    const goblinInstanceId = [...s.cards.entries()]
      .find(([, c]) => c.ownerId === 'human' && c.definitionId === 'goblin')?.[0];
    expect(goblinInstanceId).toBeDefined();
    const newCards = new Map(s.cards);
    newCards.set(goblinInstanceId!, { ...newCards.get(goblinInstanceId!)!, zone: 'battlefield', summoningSick: false, tapped: false });
    s = { ...s, cards: newCards };

    // Advance from upkeep -> draw -> precombat_main (begin_combat step) -> declare_attackers
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // upkeep -> draw
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // draw -> begin_combat
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // begin_combat -> declare_attackers

    // Declare attackers — Goblin has Haste so it can attack immediately
    const actions = getLegalActions(s, 'human');
    const attack = actions.find(a => a.kind === 'DeclareAttackers' && a.attacks.length > 0);
    expect(attack).toBeDefined();
    s = applyAction(s, 'human', attack!);
    console.log('Attacked with goblin');

    // Advance through declare_blockers -> first_strike_damage -> combat_damage
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // -> declare_blockers
    s = passPriority(s); s = passPriority(s); s = advanceStep(s); // -> first_strike_damage
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
