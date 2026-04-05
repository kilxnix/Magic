import { describe, it, expect } from 'vitest';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { getCardsInZone, getCardDefinition } from '../game-state';
import { advanceStep, performUntapStep } from '../turn-manager';
import { drawCards } from '../actions';
import { passPriority } from '../priority';
import { runAITurn, createAIConfig, applyAction } from '../ai/agent';
import { getLegalActions } from '../ai/legal-actions';
import { resolveTopOfStack } from '../stack';
import type { ScryfallCard } from '../cards/deck-loader';

// Create a real-ish deck with creatures and lands
function makeCreature(name: string, cost: string, cmc: number, power: string, toughness: string, colors: string[]): ScryfallCard {
  return { id: name, name, type_line: 'Creature — Goblin', oracle_text: '', mana_cost: cost, cmc, colors, color_identity: colors, keywords: [], power, toughness };
}
function makeLand(name: string): ScryfallCard {
  return { id: name, name, type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['R'], keywords: [] };
}
function makeCommander(): ScryfallCard {
  return { id: 'cmd', name: 'Test Commander', type_line: 'Legendary Creature — Goblin', oracle_text: '', mana_cost: '{2}{R}', cmc: 3, colors: ['R'], color_identity: ['R'], keywords: [], power: '3', toughness: '3' };
}

describe('Full 10-turn game', () => {
  it('plays 10 complete turns with both players acting', () => {
    resetInstanceCounter();

    const allCards: ScryfallCard[] = [makeCommander()];
    // Human deck: 40 mountains, 59 goblins
    const humanList: string[] = [];
    for (let i = 0; i < 40; i++) {
      const name = `HMountain${i}`;
      allCards.push(makeLand(name));
      humanList.push(name);
    }
    for (let i = 0; i < 59; i++) {
      const name = `HGoblin${i}`;
      allCards.push(makeCreature(name, '{R}', 1, '1', '1', ['R']));
      humanList.push(name);
    }
    // AI deck: same structure
    const aiList: string[] = [];
    for (let i = 0; i < 40; i++) {
      const name = `AMountain${i}`;
      allCards.push(makeLand(name));
      aiList.push(name);
    }
    for (let i = 0; i < 59; i++) {
      const name = `AGoblin${i}`;
      allCards.push(makeCreature(name, '{R}', 1, '1', '1', ['R']));
      aiList.push(name);
    }

    const lookup = createCardLookup(allCards);
    let state = initGameFromDecks({
      humanDeck: { id: 'h', commander: 'Test Commander', list: humanList, colors: ['R'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'a', commander: 'Test Commander', list: aiList, colors: ['R'], bracket: 3, theme: '' }],
      aiDifficulty: 3,
      cardLookup: lookup,
      humanGoesFirst: true,
      startingLife: 40,
      startingHandSize: 7,
    });

    const humanId = 'human';
    const aiId = 'ai1';

    // Track what happens
    const turnLog: string[] = [];
    let totalCreaturesCast = 0;
    let totalAttacks = 0;

    for (let turn = 0; turn < 20; turn++) { // 20 half-turns = 10 full rounds
      const activePlayer = state.players[state.activePlayerIndex];
      const activeId = activePlayer.id;
      const isHuman = activeId === humanId;

      turnLog.push(`Turn ${state.turnNumber}: ${isHuman ? 'Human' : 'AI'}`);

      // 1. Untap (skip on first turn - engine starts at upkeep)
      if (state.step === 'untap') {
        state = performUntapStep(state);
        state = advanceStep(state);
      }

      // 2. Upkeep - pass both
      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> draw

      // 3. Draw
      state = drawCards(state, activeId, 1);
      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> begin_combat (precombat_main phase)

      // 4. Main phase - play a land and/or cast a creature
      const actions = getLegalActions(state, activeId);
      const landAction = actions.find(a => a.kind === 'PlayLand');
      if (landAction) {
        state = applyAction(state, activeId, landAction);
        turnLog.push(`  Played a land`);
      }

      // Try to cast a creature (need to tap a land for mana first)
      const manaActions = getLegalActions(state, activeId).filter(a => a.kind === 'ActivateManaAbility');
      const castActions = getLegalActions(state, activeId).filter(a => a.kind === 'CastSpell');

      if (manaActions.length > 0 && castActions.length === 0) {
        // Tap a land for mana
        state = applyAction(state, activeId, manaActions[0]);
        // Check for castable spells now
        const newCast = getLegalActions(state, activeId).filter(a => a.kind === 'CastSpell');
        if (newCast.length > 0) {
          state = applyAction(state, activeId, newCast[0]);
          // Resolve the spell on the stack
          // Both players pass priority on the stack item
          state = passPriority(state);
          state = passPriority(state);
          if (state.stack.length > 0) {
            state = resolveTopOfStack(state);
          }
          const inst = state.cards.get(newCast[0].cardInstanceId);
          const def = inst ? getCardDefinition(state, inst) : undefined;
          turnLog.push(`  Cast ${def?.name || 'a spell'}`);
          totalCreaturesCast++;
        }
      } else if (castActions.length > 0) {
        // Can already cast something (has mana in pool somehow)
        state = applyAction(state, activeId, castActions[0]);
        state = passPriority(state);
        state = passPriority(state);
        if (state.stack.length > 0) {
          state = resolveTopOfStack(state);
        }
        const inst = state.cards.get(castActions[0].cardInstanceId);
        const def = inst ? getCardDefinition(state, inst) : undefined;
        turnLog.push(`  Cast ${def?.name || 'a spell'}`);
        totalCreaturesCast++;
      }

      // Pass through rest of main phase
      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> declare_attackers

      // 5. Combat - declare attackers step
      // getLegalActions returns DeclareAttackers actions during this step
      const atkActions = getLegalActions(state, activeId);
      const realAttacks = atkActions.filter(a => a.kind === 'DeclareAttackers' && a.attacks.length > 0);
      if (realAttacks.length > 0) {
        state = applyAction(state, activeId, realAttacks[0]);
        turnLog.push(`  Attacked with ${realAttacks[0].attacks.length} creature(s)`);
        totalAttacks++;
        // Both pass priority after attackers
        state = passPriority(state);
        state = passPriority(state);
      } else {
        // No attacks - declare empty attackers, then pass
        const noAttack = atkActions.find(a => a.kind === 'DeclareAttackers' && a.attacks.length === 0);
        if (noAttack) {
          state = applyAction(state, activeId, noAttack);
        }
        state = passPriority(state);
        state = passPriority(state);
      }

      // Advance through remaining combat + end
      state = advanceStep(state); // declare_blockers
      // Handle blockers for defending player
      const defendingId = isHuman ? aiId : humanId;
      const blockerActions = getLegalActions(state, defendingId);
      const noBlock = blockerActions.find(a => a.kind === 'DeclareBlockers' && a.blocks.length === 0);
      if (noBlock) {
        state = applyAction(state, defendingId, noBlock);
      }
      state = passPriority(state); state = passPriority(state);
      state = advanceStep(state); // first_strike_damage
      state = passPriority(state); state = passPriority(state);
      state = advanceStep(state); // combat_damage
      state = passPriority(state); state = passPriority(state);
      state = advanceStep(state); // end_of_combat
      state = passPriority(state); state = passPriority(state);
      state = advanceStep(state); // end (postcombat_main)
      state = passPriority(state); state = passPriority(state);
      state = advanceStep(state); // cleanup
      state = advanceStep(state); // -> next turn (untap)
    }

    // Report
    console.log('=== GAME LOG ===');
    for (const line of turnLog) console.log(line);

    const humanLife = state.players.find(p => p.id === humanId)!.life;
    const aiLife = state.players.find(p => p.id === aiId)!.life;
    console.log(`\nFinal: Human ${humanLife} life, AI ${aiLife} life`);
    console.log(`Turn: ${state.turnNumber}`);
    console.log(`Total creatures cast: ${totalCreaturesCast}`);
    console.log(`Total attacks: ${totalAttacks}`);

    const humanBF = getCardsInZone(state, humanId, 'battlefield');
    const aiBF = getCardsInZone(state, aiId, 'battlefield');
    console.log(`Human battlefield: ${humanBF.length} permanents`);
    console.log(`AI battlefield: ${aiBF.length} permanents`);

    // Count creatures on each battlefield
    const humanCreatures = humanBF.filter(c => {
      const def = getCardDefinition(state, c);
      return def.card_types.includes('creature');
    });
    const aiCreatures = aiBF.filter(c => {
      const def = getCardDefinition(state, c);
      return def.card_types.includes('creature');
    });
    console.log(`Human creatures: ${humanCreatures.length}`);
    console.log(`AI creatures: ${aiCreatures.length}`);

    // Verify the game progressed
    expect(state.turnNumber).toBeGreaterThanOrEqual(10);
    expect(humanBF.length).toBeGreaterThan(0); // Should have lands at minimum
    expect(aiBF.length).toBeGreaterThan(0);
  });
});
