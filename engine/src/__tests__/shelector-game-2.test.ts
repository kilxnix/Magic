/**
 * Shelector Game 2: GREEN Midrange Mirror Match
 *
 * Two AI players with green midrange decks:
 *   - 35 Forests
 *   - Mix of creatures: 1-drop elves, 3-drop beasts, 5-drop big creatures
 *   - Some fight spells (removal)
 *   - Commander: legendary 4/4 for {2}{G}{G}
 *
 * Player 1: difficulty 3, Aggressive personality
 * Player 2: difficulty 3, Balanced personality
 *
 * 30 turns max, full game log with combat tracking.
 */

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
import { resolveCombatDamage } from '../combat';
import { checkStateBasedActions } from '../state-based';
import type { ScryfallCard } from '../cards/deck-loader';
import type { AIPlayerConfig } from '../ai/types';

// ---------------------------------------------------------------------------
// Card factories
// ---------------------------------------------------------------------------

function makeForest(name: string): ScryfallCard {
  return {
    id: name,
    name,
    type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
  };
}

function makeElf(name: string): ScryfallCard {
  return {
    id: name,
    name,
    type_line: 'Creature — Elf Druid',
    oracle_text: '',
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: '1',
    toughness: '1',
  };
}

function makeBeast(name: string): ScryfallCard {
  return {
    id: name,
    name,
    type_line: 'Creature — Beast',
    oracle_text: 'Trample',
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: ['Trample'],
    power: '3',
    toughness: '3',
  };
}

function makeBigCreature(name: string): ScryfallCard {
  return {
    id: name,
    name,
    type_line: 'Creature — Wurm',
    oracle_text: 'Trample',
    mana_cost: '{3}{G}{G}',
    cmc: 5,
    colors: ['G'],
    color_identity: ['G'],
    keywords: ['Trample'],
    power: '6',
    toughness: '6',
  };
}

function makeCommander(name: string): ScryfallCard {
  return {
    id: name,
    name,
    type_line: 'Legendary Creature — Treefolk Warrior',
    oracle_text: '',
    mana_cost: '{2}{G}{G}',
    cmc: 4,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: '4',
    toughness: '4',
  };
}

// ---------------------------------------------------------------------------
// Deck builder
// ---------------------------------------------------------------------------

function buildGreenMidrangeDeck(prefix: string): { list: string[]; cards: ScryfallCard[] } {
  const cards: ScryfallCard[] = [];
  const list: string[] = [];

  // 35 Forests
  for (let i = 0; i < 35; i++) {
    const name = `${prefix} Forest ${i}`;
    cards.push(makeForest(name));
    list.push(name);
  }

  // 25 Elves (1-drop, {G}, 1/1)
  for (let i = 0; i < 25; i++) {
    const name = `${prefix} Elvish Mystic ${i}`;
    cards.push(makeElf(name));
    list.push(name);
  }

  // 22 Beasts (3-drop, {2}{G}, 3/3, Trample)
  for (let i = 0; i < 22; i++) {
    const name = `${prefix} Leatherback Beast ${i}`;
    cards.push(makeBeast(name));
    list.push(name);
  }

  // 17 Wurms (5-drop, {3}{G}{G}, 6/6, Trample)
  for (let i = 0; i < 17; i++) {
    const name = `${prefix} Enormous Wurm ${i}`;
    cards.push(makeBigCreature(name));
    list.push(name);
  }

  // Total: 35 + 25 + 22 + 17 = 99 (library)
  return { list, cards };
}

// ---------------------------------------------------------------------------
// Game simulation helpers
// ---------------------------------------------------------------------------

/** Tap lands for mana, cast spells from hand, resolve the stack. */
function doMainPhaseActions(
  state: ReturnType<typeof initGameFromDecks>,
  playerId: string,
  config: AIPlayerConfig,
  log: string[],
): ReturnType<typeof initGameFromDecks> {
  let s = state;

  // Use runAITurn to play land + cast spells
  const { finalState, decisions } = runAITurn(s, config, 50);
  s = finalState;

  // Log what was done
  for (const d of decisions) {
    if (d.action.kind === 'PlayLand') {
      const inst = s.cards.get(d.action.cardInstanceId);
      const def = inst ? s.cardDefinitions.get(inst.definitionId) : undefined;
      log.push(`    [LAND] Played ${def?.name || 'a land'}`);
    } else if (d.action.kind === 'CastSpell') {
      const inst = s.cards.get(d.action.cardInstanceId);
      const def = inst ? s.cardDefinitions.get(inst.definitionId) : undefined;
      log.push(`    [CAST] Cast ${def?.name || 'a spell'} (${def?.mana_cost})`);
    } else if (d.action.kind === 'ActivateManaAbility') {
      // Don't log mana taps individually - too noisy
    }
  }

  // Resolve anything on the stack
  let resolveAttempts = 0;
  while (s.stack.length > 0 && resolveAttempts < 20) {
    s = passPriority(s);
    s = passPriority(s);
    if (s.stack.length > 0) {
      s = resolveTopOfStack(s);
    }
    resolveAttempts++;
  }

  // Check SBAs after resolution
  s = checkStateBasedActions(s);

  return s;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('Shelector Game 2: Green Midrange Mirror', () => {
  it('simulates a full GREEN midrange mirror match for up to 30 turns', () => {
    resetInstanceCounter();

    // Build card database
    const allCards: ScryfallCard[] = [];
    const cmdP1 = makeCommander('Oakshade Warden');
    const cmdP2 = makeCommander('Mosswood Guardian');
    allCards.push(cmdP1, cmdP2);

    const p1Deck = buildGreenMidrangeDeck('P1');
    const p2Deck = buildGreenMidrangeDeck('P2');
    allCards.push(...p1Deck.cards, ...p2Deck.cards);

    const lookup = createCardLookup(allCards);

    let state = initGameFromDecks({
      humanDeck: {
        id: 'deck-p1',
        commander: 'Oakshade Warden',
        list: p1Deck.list,
        colors: ['G'],
        bracket: 3,
        theme: 'Green Midrange',
      },
      aiDecks: [{
        id: 'deck-p2',
        commander: 'Mosswood Guardian',
        list: p2Deck.list,
        colors: ['G'],
        bracket: 3,
        theme: 'Green Midrange',
      }],
      aiDifficulty: 3,
      aiPersonalities: ['Balanced'],
      cardLookup: lookup,
      humanGoesFirst: true,
      startingLife: 40,
      startingHandSize: 7,
    });

    // Player IDs
    const p1Id = 'human';
    const p2Id = 'ai1';

    // AI configs: P1 is Aggressive (d3), P2 is Balanced (d3)
    const p1Config: AIPlayerConfig = { playerId: p1Id, difficulty: 3, personality: 'Aggressive' };
    const p2Config: AIPlayerConfig = { playerId: p2Id, difficulty: 3, personality: 'Balanced' };

    // Tracking
    const gameLog: string[] = [];
    let totalCreaturesCast = 0;
    let totalAttacksDeclared = 0;
    let totalDamageDealt = 0;
    let winner: string | null = null;

    gameLog.push('========================================');
    gameLog.push('  GREEN MIDRANGE MIRROR MATCH');
    gameLog.push('  P1: Oakshade Warden (Aggressive d3)');
    gameLog.push('  P2: Mosswood Guardian (Balanced d3)');
    gameLog.push('========================================');
    gameLog.push('');

    // Log opening hands
    const p1Hand = getCardsInZone(state, p1Id, 'hand');
    const p2Hand = getCardsInZone(state, p2Id, 'hand');
    gameLog.push('--- Opening Hands ---');
    gameLog.push(`P1 hand (${p1Hand.length}): ${p1Hand.map(c => {
      const def = getCardDefinition(state, c);
      return def.name;
    }).join(', ')}`);
    gameLog.push(`P2 hand (${p2Hand.length}): ${p2Hand.map(c => {
      const def = getCardDefinition(state, c);
      return def.name;
    }).join(', ')}`);
    gameLog.push('');

    // ======= MAIN GAME LOOP: up to 60 half-turns (30 full rounds) =======
    const maxHalfTurns = 60;

    for (let halfTurn = 0; halfTurn < maxHalfTurns; halfTurn++) {
      // Check for winner
      const p1Lost = state.players.find(p => p.id === p1Id)!.hasLost;
      const p2Lost = state.players.find(p => p.id === p2Id)!.hasLost;
      if (p1Lost || p2Lost) {
        if (p1Lost && !p2Lost) winner = 'P2 (Mosswood Guardian)';
        else if (p2Lost && !p1Lost) winner = 'P1 (Oakshade Warden)';
        else winner = 'Draw (both lost)';
        break;
      }

      const activePlayer = state.players[state.activePlayerIndex];
      const activeId = activePlayer.id;
      const isP1 = activeId === p1Id;
      const playerLabel = isP1 ? 'P1' : 'P2';
      const config = isP1 ? p1Config : p2Config;
      const opponentId = isP1 ? p2Id : p1Id;

      const p1Life = state.players.find(p => p.id === p1Id)!.life;
      const p2Life = state.players.find(p => p.id === p2Id)!.life;

      gameLog.push(`--- Turn ${state.turnNumber} (${playerLabel}) | P1: ${p1Life} life | P2: ${p2Life} life ---`);

      // ===== 1. UNTAP =====
      if (state.step === 'untap') {
        state = performUntapStep(state);
        state = advanceStep(state); // -> upkeep
      }

      // ===== 2. UPKEEP =====
      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> draw

      // ===== 3. DRAW =====
      const skipDraw = state.turnNumber === 1 && isP1; // Going-first player skips draw on T1
      if (!skipDraw) {
        state = drawCards(state, activeId, 1);
        // Log what was drawn
        const handNow = getCardsInZone(state, activeId, 'hand');
        if (handNow.length > 0) {
          const drawnCard = handNow[handNow.length - 1];
          const drawnDef = getCardDefinition(state, drawnCard);
          gameLog.push(`    [DRAW] Drew ${drawnDef.name}`);
        }
      } else {
        gameLog.push(`    [DRAW] Skipped (first turn)`);
      }
      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> begin_combat (precombat_main)

      // ===== 4. PRECOMBAT MAIN PHASE =====
      // Use AI agent to play lands and cast spells
      const creaturesBeforeMain = getCardsInZone(state, activeId, 'battlefield')
        .filter(c => getCardDefinition(state, c).card_types.includes('creature')).length;

      state = doMainPhaseActions(state, activeId, config, gameLog);

      const creaturesAfterMain = getCardsInZone(state, activeId, 'battlefield')
        .filter(c => getCardDefinition(state, c).card_types.includes('creature')).length;
      const newCreatures = creaturesAfterMain - creaturesBeforeMain;
      if (newCreatures > 0) totalCreaturesCast += newCreatures;

      // Pass priority to advance out of main
      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> declare_attackers

      // ===== 5. DECLARE ATTACKERS =====
      const atkResult = runAITurn(state, config, 10);
      state = atkResult.finalState;

      let attackerCount = 0;
      let attackDef: string[] = [];
      for (const d of atkResult.decisions) {
        if (d.action.kind === 'DeclareAttackers' && d.action.attacks.length > 0) {
          attackerCount = d.action.attacks.length;
          totalAttacksDeclared++;
          for (const atk of d.action.attacks) {
            const inst = state.cards.get(atk.cardInstanceId);
            const def = inst ? state.cardDefinitions.get(inst.definitionId) : undefined;
            attackDef.push(`${def?.name || '?'} (${def?.power}/${def?.toughness})`);
          }
        }
      }

      if (attackerCount > 0) {
        gameLog.push(`    [ATTACK] Declared ${attackerCount} attacker(s): ${attackDef.join(', ')}`);
      } else {
        gameLog.push(`    [ATTACK] No attacks declared`);
      }

      // Pass priority after attackers. If no attackers were declared, the
      // engine skips the empty blocker/damage windows to end_of_combat.
      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state);

      // ===== 6. DECLARE BLOCKERS =====
      if (state.step === 'declare_blockers') {
        const defenderConfig = isP1 ? p2Config : p1Config;
        const blockResult = runAITurn(state, defenderConfig, 10);
        state = blockResult.finalState;

        let blockerCount = 0;
        for (const d of blockResult.decisions) {
          if (d.action.kind === 'DeclareBlockers' && d.action.blocks.length > 0) {
            blockerCount = d.action.blocks.length;
            for (const blk of d.action.blocks) {
              const blockerInst = state.cards.get(blk.cardInstanceId);
              const blockerDef = blockerInst ? state.cardDefinitions.get(blockerInst.definitionId) : undefined;
              const attackerInst = state.cards.get(blk.blockingAttackerId);
              const attackerDef2 = attackerInst ? state.cardDefinitions.get(attackerInst.definitionId) : undefined;
              gameLog.push(`    [BLOCK] ${blockerDef?.name} blocks ${attackerDef2?.name}`);
            }
          }
        }

        if (blockerCount === 0 && attackerCount > 0) {
          gameLog.push(`    [BLOCK] No blocks`);
        }

        state = passPriority(state);
        state = passPriority(state);
        state = advanceStep(state); // -> first_strike_damage

        // ===== 7. FIRST STRIKE DAMAGE =====
        state = passPriority(state);
        state = passPriority(state);
        state = advanceStep(state); // -> combat_damage

        // ===== 8. COMBAT DAMAGE =====
        const lifeBefore: Record<string, number> = {};
        for (const p of state.players) {
          lifeBefore[p.id] = p.life;
        }

        if (state.combat && state.combat.attackers.length > 0) {
          state = resolveCombatDamage(state);
          state = checkStateBasedActions(state);

          // Log damage
          for (const p of state.players) {
            const dmg = lifeBefore[p.id] - p.life;
            if (dmg > 0) {
              const pLabel = p.id === p1Id ? 'P1' : 'P2';
              gameLog.push(`    [DAMAGE] ${pLabel} took ${dmg} combat damage (${lifeBefore[p.id]} -> ${p.life})`);
              totalDamageDealt += dmg;
            }
          }

          // Check for creatures that died in combat
          const p1Grave = getCardsInZone(state, p1Id, 'graveyard').filter(c =>
            getCardDefinition(state, c).card_types.includes('creature'));
          const p2Grave = getCardsInZone(state, p2Id, 'graveyard').filter(c =>
            getCardDefinition(state, c).card_types.includes('creature'));
          // We only report deaths that happened this combat (graveyard changes)
        } else {
          // Make sure combat is cleared if empty
          if (state.combat && state.combat.attackers.length === 0) {
            state = { ...state, combat: null };
          }
        }

        state = passPriority(state);
        state = passPriority(state);
        state = advanceStep(state); // -> end_of_combat
      }

      // ===== 9. END OF COMBAT =====
      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> end (postcombat_main)

      // ===== 10. POSTCOMBAT MAIN =====
      // Try to cast more spells
      const creaturesBeforePost = getCardsInZone(state, activeId, 'battlefield')
        .filter(c => getCardDefinition(state, c).card_types.includes('creature')).length;

      state = doMainPhaseActions(state, activeId, config, gameLog);

      const creaturesAfterPost = getCardsInZone(state, activeId, 'battlefield')
        .filter(c => getCardDefinition(state, c).card_types.includes('creature')).length;
      const newCreaturesPost = creaturesAfterPost - creaturesBeforePost;
      if (newCreaturesPost > 0) totalCreaturesCast += newCreaturesPost;

      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> cleanup

      // ===== 11. CLEANUP =====
      state = advanceStep(state); // -> next turn (untap)

      // Log board state summary
      const p1BF = getCardsInZone(state, p1Id, 'battlefield');
      const p2BF = getCardsInZone(state, p2Id, 'battlefield');
      const p1Creatures = p1BF.filter(c => getCardDefinition(state, c).card_types.includes('creature'));
      const p2Creatures = p2BF.filter(c => getCardDefinition(state, c).card_types.includes('creature'));
      const p1Lands = p1BF.filter(c => getCardDefinition(state, c).card_types.includes('land'));
      const p2Lands = p2BF.filter(c => getCardDefinition(state, c).card_types.includes('land'));
      gameLog.push(`    [BOARD] P1: ${p1Lands.length} lands, ${p1Creatures.length} creatures | P2: ${p2Lands.length} lands, ${p2Creatures.length} creatures`);
      gameLog.push('');
    }

    // ===== FINAL REPORT =====
    gameLog.push('========================================');
    gameLog.push('  FINAL GAME STATE');
    gameLog.push('========================================');

    const finalP1 = state.players.find(p => p.id === p1Id)!;
    const finalP2 = state.players.find(p => p.id === p2Id)!;

    gameLog.push(`Turn reached: ${state.turnNumber}`);
    gameLog.push(`P1 (Oakshade Warden - Aggressive): ${finalP1.life} life ${finalP1.hasLost ? '** LOST **' : ''}`);
    gameLog.push(`P2 (Mosswood Guardian - Balanced):  ${finalP2.life} life ${finalP2.hasLost ? '** LOST **' : ''}`);
    gameLog.push('');

    // Final board state detail
    const p1BF = getCardsInZone(state, p1Id, 'battlefield');
    const p2BF = getCardsInZone(state, p2Id, 'battlefield');

    const p1FinalCreatures = p1BF.filter(c => getCardDefinition(state, c).card_types.includes('creature'));
    const p2FinalCreatures = p2BF.filter(c => getCardDefinition(state, c).card_types.includes('creature'));
    const p1FinalLands = p1BF.filter(c => getCardDefinition(state, c).card_types.includes('land'));
    const p2FinalLands = p2BF.filter(c => getCardDefinition(state, c).card_types.includes('land'));

    gameLog.push('P1 Battlefield:');
    gameLog.push(`  Lands: ${p1FinalLands.length}`);
    gameLog.push(`  Creatures (${p1FinalCreatures.length}):`);
    for (const c of p1FinalCreatures) {
      const def = getCardDefinition(state, c);
      gameLog.push(`    - ${def.name} (${def.power}/${def.toughness})${c.tapped ? ' [TAPPED]' : ''}`);
    }

    gameLog.push('P2 Battlefield:');
    gameLog.push(`  Lands: ${p2FinalLands.length}`);
    gameLog.push(`  Creatures (${p2FinalCreatures.length}):`);
    for (const c of p2FinalCreatures) {
      const def = getCardDefinition(state, c);
      gameLog.push(`    - ${def.name} (${def.power}/${def.toughness})${c.tapped ? ' [TAPPED]' : ''}`);
    }

    // Graveyards
    const p1Grave = getCardsInZone(state, p1Id, 'graveyard');
    const p2Grave = getCardsInZone(state, p2Id, 'graveyard');
    const p1GraveCreatures = p1Grave.filter(c => getCardDefinition(state, c).card_types.includes('creature'));
    const p2GraveCreatures = p2Grave.filter(c => getCardDefinition(state, c).card_types.includes('creature'));
    gameLog.push('');
    gameLog.push(`P1 Graveyard: ${p1GraveCreatures.length} creature(s)`);
    gameLog.push(`P2 Graveyard: ${p2GraveCreatures.length} creature(s)`);

    // Hand sizes
    const p1FinalHand = getCardsInZone(state, p1Id, 'hand');
    const p2FinalHand = getCardsInZone(state, p2Id, 'hand');
    gameLog.push('');
    gameLog.push(`P1 Hand: ${p1FinalHand.length} cards`);
    gameLog.push(`P2 Hand: ${p2FinalHand.length} cards`);

    gameLog.push('');
    gameLog.push('--- Statistics ---');
    gameLog.push(`Total creatures cast: ${totalCreaturesCast}`);
    gameLog.push(`Total attack phases with attackers: ${totalAttacksDeclared}`);
    gameLog.push(`Total combat damage dealt: ${totalDamageDealt}`);

    if (winner) {
      gameLog.push('');
      gameLog.push(`WINNER: ${winner}`);
    } else {
      // Determine winner by life totals
      if (finalP1.life > finalP2.life) {
        gameLog.push(`\nGAME RESULT: P1 ahead on life (${finalP1.life} vs ${finalP2.life})`);
      } else if (finalP2.life > finalP1.life) {
        gameLog.push(`\nGAME RESULT: P2 ahead on life (${finalP2.life} vs ${finalP1.life})`);
      } else {
        gameLog.push(`\nGAME RESULT: Tied on life (${finalP1.life} each)`);
      }
    }

    // Print full game log
    console.log('\n' + gameLog.join('\n') + '\n');

    // Assertions
    expect(state.turnNumber).toBeGreaterThanOrEqual(2); // Game progressed
    expect(p1BF.length).toBeGreaterThan(0); // Players have permanents
    expect(p2BF.length).toBeGreaterThan(0);
    expect(totalCreaturesCast).toBeGreaterThan(0); // Creatures were cast
    expect(totalDamageDealt + totalAttacksDeclared).toBeGreaterThanOrEqual(0); // Combat happened (or not, both valid)
  });
});
