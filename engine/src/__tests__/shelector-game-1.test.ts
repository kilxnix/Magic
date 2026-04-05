/**
 * Shelector Game 1: Red Aggro vs Blue Control - Full 30-Turn Commander Game
 *
 * Two AI players battle it out:
 *  - Player 1 (human): RED aggro -- Krenko-style legendary goblin commander
 *    35 Mountains, 20 Goblin creatures ({R}, 2/1 haste), 44 more goblins in library
 *  - Player 2 (ai1): BLUE control -- Legendary wizard commander
 *    35 Islands, 10 blue creatures, 10 instants (counterspells/draw), 44 filler wizards
 *
 * Both players are driven by runAITurn with difficulty 3.
 * Game runs until someone's life hits 0 or 30 turns pass.
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
import { cleanupDamage } from '../state-based';
import type { ScryfallCard } from '../cards/deck-loader';
import type { GameState } from '../types';

// ============================================================================
// Card Factories
// ============================================================================

function makeGoblinCreature(name: string, power: string = '2', toughness: string = '1'): ScryfallCard {
  return {
    id: name,
    name,
    type_line: 'Creature — Goblin',
    oracle_text: 'Haste',
    mana_cost: '{R}',
    cmc: 1,
    colors: ['R'],
    color_identity: ['R'],
    keywords: ['Haste'],
    power,
    toughness,
  };
}

function makeMountain(name: string): ScryfallCard {
  return {
    id: name,
    name,
    type_line: 'Basic Land — Mountain',
    oracle_text: '{T}: Add {R}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['R'],
    keywords: [],
  };
}

function makeIsland(name: string): ScryfallCard {
  return {
    id: name,
    name,
    type_line: 'Basic Land — Island',
    oracle_text: '{T}: Add {U}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['U'],
    keywords: [],
  };
}

function makeBlueCreature(name: string, cost: string, cmc: number, power: string, toughness: string): ScryfallCard {
  return {
    id: name,
    name,
    type_line: 'Creature — Wizard',
    oracle_text: '',
    mana_cost: cost,
    cmc,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    power,
    toughness,
  };
}

function makeBlueInstant(name: string, cost: string, cmc: number, text: string): ScryfallCard {
  return {
    id: name,
    name,
    type_line: 'Instant',
    oracle_text: text,
    mana_cost: cost,
    cmc,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
  };
}

function makeRedCommander(): ScryfallCard {
  return {
    id: 'red-commander',
    name: 'Krenko, Goblin Warchief',
    type_line: 'Legendary Creature — Goblin Warrior',
    oracle_text: 'Haste',
    mana_cost: '{2}{R}',
    cmc: 3,
    colors: ['R'],
    color_identity: ['R'],
    keywords: ['Haste'],
    power: '3',
    toughness: '3',
  };
}

function makeBlueCommander(): ScryfallCard {
  return {
    id: 'blue-commander',
    name: 'Azami, Lady of Scrolls',
    type_line: 'Legendary Creature — Human Wizard',
    oracle_text: '',
    mana_cost: '{3}{U}{U}',
    cmc: 5,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    power: '0',
    toughness: '2',
  };
}

// ============================================================================
// Deck Building
// ============================================================================

function buildDecks() {
  const allCards: ScryfallCard[] = [];

  // Commanders
  allCards.push(makeRedCommander());
  allCards.push(makeBlueCommander());

  // === RED AGGRO DECK (99 cards) ===
  const redList: string[] = [];

  // 35 Mountains
  for (let i = 0; i < 35; i++) {
    const name = `RedMountain${i}`;
    allCards.push(makeMountain(name));
    redList.push(name);
  }

  // 20 Goblin creatures with Haste (2/1 for {R})
  for (let i = 0; i < 20; i++) {
    const name = `GoblinRaider${i}`;
    allCards.push(makeGoblinCreature(name, '2', '1'));
    redList.push(name);
  }

  // 44 more goblins (1/1 with haste, filler)
  for (let i = 0; i < 44; i++) {
    const name = `GoblinPeon${i}`;
    allCards.push(makeGoblinCreature(name, '1', '1'));
    redList.push(name);
  }

  // === BLUE CONTROL DECK (99 cards) ===
  const blueList: string[] = [];

  // 35 Islands
  for (let i = 0; i < 35; i++) {
    const name = `BlueIsland${i}`;
    allCards.push(makeIsland(name));
    blueList.push(name);
  }

  // 10 Blue creatures (various costs)
  for (let i = 0; i < 5; i++) {
    const name = `SeaGateOracle${i}`;
    allCards.push(makeBlueCreature(name, '{2}{U}', 3, '1', '3'));
    blueList.push(name);
  }
  for (let i = 0; i < 5; i++) {
    const name = `AetherAdept${i}`;
    allCards.push(makeBlueCreature(name, '{1}{U}{U}', 3, '2', '2'));
    blueList.push(name);
  }

  // 10 Blue instants (draw spells -- simple oracle text the engine can parse)
  for (let i = 0; i < 5; i++) {
    const name = `Counterspell${i}`;
    allCards.push(makeBlueInstant(name, '{U}{U}', 2, 'Counter target spell.'));
    blueList.push(name);
  }
  for (let i = 0; i < 5; i++) {
    const name = `Divination${i}`;
    // Make these sorceries for simplicity (draw 2)
    const card: ScryfallCard = {
      id: name,
      name,
      type_line: 'Sorcery',
      oracle_text: 'Draw two cards.',
      mana_cost: '{2}{U}',
      cmc: 3,
      colors: ['U'],
      color_identity: ['U'],
      keywords: [],
    };
    allCards.push(card);
    blueList.push(name);
  }

  // 44 filler wizards (1/1 for {U})
  for (let i = 0; i < 44; i++) {
    const name = `WizardApprentice${i}`;
    allCards.push(makeBlueCreature(name, '{U}', 1, '1', '1'));
    blueList.push(name);
  }

  return { allCards, redList, blueList };
}

// ============================================================================
// Game Loop Helpers
// ============================================================================

/**
 * Safely try to run an AI turn at the current priority window.
 * Returns the updated state and logs any actions taken.
 */
function runPlayerAI(state: GameState, playerId: string, log: string[]): GameState {
  const config = createAIConfig(playerId, 3);
  const { finalState, decisions } = runAITurn(state, config, 50);

  for (const d of decisions) {
    if (d.action.kind === 'PlayLand') {
      const inst = finalState.cards.get(d.action.cardInstanceId);
      const def = inst ? getCardDefinition(finalState, inst) : undefined;
      log.push(`    [${playerId}] Played land: ${def?.name || '???'}`);
    } else if (d.action.kind === 'CastSpell') {
      const inst = finalState.cards.get(d.action.cardInstanceId);
      const def = inst ? getCardDefinition(finalState, inst) : undefined;
      log.push(`    [${playerId}] Cast spell: ${def?.name || '???'}`);
    } else if (d.action.kind === 'ActivateManaAbility') {
      // Don't log every mana tap -- too noisy
    } else if (d.action.kind === 'DeclareAttackers') {
      if (d.action.attacks.length > 0) {
        log.push(`    [${playerId}] Declared ${d.action.attacks.length} attacker(s)`);
      }
    } else if (d.action.kind === 'DeclareBlockers') {
      if (d.action.blocks.length > 0) {
        log.push(`    [${playerId}] Declared ${d.action.blocks.length} blocker(s)`);
      }
    }
  }

  return finalState;
}

/**
 * Resolve all spells currently on the stack (both players pass, then resolve top).
 */
function resolveStack(state: GameState): GameState {
  let s = state;
  let safety = 0;
  while (s.stack.length > 0 && safety < 20) {
    s = passPriority(s);
    s = passPriority(s);
    s = resolveTopOfStack(s);
    s = checkStateBasedActions(s);
    safety++;
  }
  return s;
}

// ============================================================================
// The Test
// ============================================================================

describe('Shelector Game 1: Red Aggro vs Blue Control', () => {
  it('plays a full game until someone wins or 30 turns pass', () => {
    resetInstanceCounter();

    const { allCards, redList, blueList } = buildDecks();
    const lookup = createCardLookup(allCards);

    let state = initGameFromDecks({
      humanDeck: {
        id: 'red',
        commander: 'Krenko, Goblin Warchief',
        list: redList,
        colors: ['R'],
        bracket: 3,
        theme: 'Goblin Aggro',
      },
      aiDecks: [{
        id: 'blue',
        commander: 'Azami, Lady of Scrolls',
        list: blueList,
        colors: ['U'],
        bracket: 3,
        theme: 'Blue Control',
      }],
      aiDifficulty: 3,
      cardLookup: lookup,
      humanGoesFirst: true,
      startingLife: 40,
      startingHandSize: 7,
    });

    const p1Id = 'human';  // Red aggro
    const p2Id = 'ai1';    // Blue control

    const gameLog: string[] = [];
    let winner: string | null = null;
    let totalDamageDealtToP1 = 0;
    let totalDamageDealtToP2 = 0;
    let totalSpellsCast = 0;
    let totalAttacks = 0;
    let totalLandsPlayed = 0;

    const MAX_TURNS = 60; // 60 half-turns = 30 full rounds

    gameLog.push('=== SHELECTOR GAME 1: RED AGGRO vs BLUE CONTROL ===');
    gameLog.push(`Starting life: P1(Red)=${state.players[0].life}, P2(Blue)=${state.players[1].life}`);
    gameLog.push('');

    for (let halfTurn = 0; halfTurn < MAX_TURNS; halfTurn++) {
      const activePlayer = state.players[state.activePlayerIndex];
      const activeId = activePlayer.id;
      const isP1 = activeId === p1Id;
      const playerLabel = isP1 ? 'RED (Aggro)' : 'BLUE (Control)';
      const opponentId = isP1 ? p2Id : p1Id;

      const p1LifeBefore = state.players.find(p => p.id === p1Id)!.life;
      const p2LifeBefore = state.players.find(p => p.id === p2Id)!.life;

      const turnLog: string[] = [];
      turnLog.push(`--- Turn ${state.turnNumber} | ${playerLabel} ---`);

      // Check for game over
      if (activePlayer.hasLost) {
        // Skip lost player turns
        continue;
      }

      // ==================== UNTAP ====================
      if (state.step === 'untap') {
        state = performUntapStep(state);
        state = advanceStep(state); // -> upkeep
      }

      // ==================== UPKEEP ====================
      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> draw

      // ==================== DRAW ====================
      const libSize = getCardsInZone(state, activeId, 'library').length;
      if (libSize === 0) {
        turnLog.push(`    ${playerLabel} has no cards to draw -- would lose!`);
        // Mark player as lost
        const pIdx = state.players.findIndex(p => p.id === activeId);
        const newPlayers = state.players.map((p, i) => i === pIdx ? { ...p, hasLost: true } : p);
        state = { ...state, players: newPlayers };
        winner = opponentId;
        gameLog.push(...turnLog);
        break;
      }
      state = drawCards(state, activeId, 1);
      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> begin_combat (precombat_main)

      // ==================== PRECOMBAT MAIN ====================
      // Let AI play lands, tap mana, cast spells
      const spellsBefore = totalSpellsCast;
      state = runPlayerAI(state, activeId, turnLog);

      // Resolve anything on the stack from the AI's actions
      state = resolveStack(state);

      // Count new spells
      // (We count from the log entries instead)

      // Pass priority to move on
      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> declare_attackers

      // ==================== COMBAT ====================
      // Declare attackers
      const atkActions = getLegalActions(state, activeId);
      const attackOptions = atkActions.filter(a => a.kind === 'DeclareAttackers');
      const attackWithCreatures = attackOptions.filter(a => a.attacks.length > 0);

      if (attackWithCreatures.length > 0) {
        // Pick the attack option with the most creatures (all-out attack)
        const bestAttack = attackWithCreatures.reduce((best, current) =>
          current.attacks.length > best.attacks.length ? current : best
        );
        state = applyAction(state, activeId, bestAttack);
        turnLog.push(`    [${activeId}] Attacking with ${bestAttack.attacks.length} creature(s)`);
        totalAttacks++;

        // Pass priority after attackers
        state = passPriority(state);
        state = passPriority(state);
      } else {
        // No attacks - declare empty
        const noAttack = attackOptions.find(a => a.kind === 'DeclareAttackers' && a.attacks.length === 0);
        if (noAttack) {
          state = applyAction(state, activeId, noAttack);
        }
        state = passPriority(state);
        state = passPriority(state);
      }

      state = advanceStep(state); // -> declare_blockers

      // Declare blockers for defending player
      const defenderActions = getLegalActions(state, opponentId);
      const blockOptions = defenderActions.filter(a => a.kind === 'DeclareBlockers');

      if (blockOptions.length > 0) {
        // AI picks blocks: use the option with most blocks (greedy defense)
        const bestBlock = blockOptions.reduce((best, current) =>
          current.blocks.length > best.blocks.length ? current : best
        );
        if (bestBlock.blocks.length > 0) {
          state = applyAction(state, opponentId, bestBlock);
          turnLog.push(`    [${opponentId}] Blocking with ${bestBlock.blocks.length} creature(s)`);
        } else {
          state = applyAction(state, opponentId, bestBlock);
        }
      }

      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> first_strike_damage
      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> combat_damage

      // Resolve combat damage if there are attackers
      if (state.combat && state.combat.attackers.length > 0) {
        state = resolveCombatDamage(state);
        state = checkStateBasedActions(state);
      }

      state = passPriority(state);
      state = passPriority(state);
      state = advanceStep(state); // -> end_of_combat
      state = passPriority(state);
      state = passPriority(state);

      // ==================== POSTCOMBAT MAIN ====================
      state = advanceStep(state); // -> end (postcombat_main)

      // Let AI play more stuff in postcombat main
      state = runPlayerAI(state, activeId, turnLog);
      state = resolveStack(state);

      state = passPriority(state);
      state = passPriority(state);

      // ==================== END / CLEANUP ====================
      state = advanceStep(state); // -> cleanup
      state = cleanupDamage(state);
      state = advanceStep(state); // -> next turn (untap)

      // Track damage dealt this turn
      const p1LifeAfter = state.players.find(p => p.id === p1Id)!.life;
      const p2LifeAfter = state.players.find(p => p.id === p2Id)!.life;
      const dmgToP1 = p1LifeBefore - p1LifeAfter;
      const dmgToP2 = p2LifeBefore - p2LifeAfter;

      if (dmgToP1 > 0) {
        turnLog.push(`    >> RED took ${dmgToP1} damage (${p1LifeBefore} -> ${p1LifeAfter})`);
        totalDamageDealtToP1 += dmgToP1;
      }
      if (dmgToP2 > 0) {
        turnLog.push(`    >> BLUE took ${dmgToP2} damage (${p2LifeBefore} -> ${p2LifeAfter})`);
        totalDamageDealtToP2 += dmgToP2;
      }

      // Count lands & spells from turn log
      for (const line of turnLog) {
        if (line.includes('Played land')) totalLandsPlayed++;
        if (line.includes('Cast spell')) totalSpellsCast++;
      }

      turnLog.push(`    Life totals: RED=${p1LifeAfter} | BLUE=${p2LifeAfter}`);
      gameLog.push(...turnLog);

      // Check for winner
      if (p1LifeAfter <= 0) {
        winner = p2Id;
        gameLog.push(`\n*** BLUE CONTROL WINS! Red life dropped to ${p1LifeAfter} ***`);
        break;
      }
      if (p2LifeAfter <= 0) {
        winner = p1Id;
        gameLog.push(`\n*** RED AGGRO WINS! Blue life dropped to ${p2LifeAfter} ***`);
        break;
      }
      if (state.players.find(p => p.id === p1Id)!.hasLost) {
        winner = p2Id;
        gameLog.push(`\n*** BLUE CONTROL WINS! Red player lost ***`);
        break;
      }
      if (state.players.find(p => p.id === p2Id)!.hasLost) {
        winner = p1Id;
        gameLog.push(`\n*** RED AGGRO WINS! Blue player lost ***`);
        break;
      }
    }

    // ==================== FINAL REPORT ====================
    gameLog.push('');
    gameLog.push('========================================');
    gameLog.push('         FINAL GAME REPORT');
    gameLog.push('========================================');

    const finalP1Life = state.players.find(p => p.id === p1Id)!.life;
    const finalP2Life = state.players.find(p => p.id === p2Id)!.life;

    gameLog.push(`Final Life Totals:`);
    gameLog.push(`  RED (Aggro):   ${finalP1Life}`);
    gameLog.push(`  BLUE (Control): ${finalP2Life}`);
    gameLog.push('');

    // Board state
    const p1BF = getCardsInZone(state, p1Id, 'battlefield');
    const p2BF = getCardsInZone(state, p2Id, 'battlefield');

    const p1Creatures = p1BF.filter(c => {
      const def = getCardDefinition(state, c);
      return def.card_types.includes('creature');
    });
    const p2Creatures = p2BF.filter(c => {
      const def = getCardDefinition(state, c);
      return def.card_types.includes('creature');
    });
    const p1Lands = p1BF.filter(c => {
      const def = getCardDefinition(state, c);
      return def.card_types.includes('land');
    });
    const p2Lands = p2BF.filter(c => {
      const def = getCardDefinition(state, c);
      return def.card_types.includes('land');
    });

    gameLog.push(`Board State:`);
    gameLog.push(`  RED:  ${p1Lands.length} lands, ${p1Creatures.length} creatures`);
    gameLog.push(`  BLUE: ${p2Lands.length} lands, ${p2Creatures.length} creatures`);

    if (p1Creatures.length > 0) {
      gameLog.push(`  RED creatures:`);
      for (const c of p1Creatures) {
        const def = getCardDefinition(state, c);
        gameLog.push(`    - ${def.name} (${def.power}/${def.toughness}) ${c.tapped ? '[tapped]' : ''}`);
      }
    }
    if (p2Creatures.length > 0) {
      gameLog.push(`  BLUE creatures:`);
      for (const c of p2Creatures) {
        const def = getCardDefinition(state, c);
        gameLog.push(`    - ${def.name} (${def.power}/${def.toughness}) ${c.tapped ? '[tapped]' : ''}`);
      }
    }

    gameLog.push('');
    gameLog.push(`Game Statistics:`);
    gameLog.push(`  Turns played: ${state.turnNumber - 1}`);
    gameLog.push(`  Total lands played: ${totalLandsPlayed}`);
    gameLog.push(`  Total spells cast: ${totalSpellsCast}`);
    gameLog.push(`  Total attacks: ${totalAttacks}`);
    gameLog.push(`  Damage dealt to RED: ${totalDamageDealtToP1}`);
    gameLog.push(`  Damage dealt to BLUE: ${totalDamageDealtToP2}`);
    gameLog.push('');

    if (winner) {
      const winnerLabel = winner === p1Id ? 'RED AGGRO' : 'BLUE CONTROL';
      gameLog.push(`WINNER: ${winnerLabel}`);
    } else {
      gameLog.push(`RESULT: Draw (30 turn limit reached)`);
    }

    // Print the full log
    console.log('\n' + gameLog.join('\n') + '\n');

    // Assertions: game must have progressed meaningfully
    expect(state.turnNumber).toBeGreaterThan(1);
    expect(totalLandsPlayed).toBeGreaterThan(0);
    // At least some battlefield permanents
    expect(p1BF.length + p2BF.length).toBeGreaterThan(0);
  });
});
