/**
 * Full Game Loop Integration Test
 *
 * Proves the commander-engine can run a complete 2-player game
 * for 5 turns using initGameFromDecks, getLegalActions, applyAction,
 * passPriority, allPlayersPassed, advanceStep, and drawCards.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initGameFromDecks,
  GameInitConfig,
  resetInstanceCounter,
} from '../game-init';
import type { GeneratedDeck, ScryfallCard } from '../cards/deck-loader';
import { createCardLookup } from '../cards/deck-loader';
import { getCardsInZone } from '../game-state';
import { advanceStep, performUntapStep, STEP_ORDER } from '../turn-manager';
import { drawCards } from '../actions';
import { passPriority, allPlayersPassed } from '../priority';
import { getLegalActions } from '../ai/legal-actions';
import { applyAction } from '../ai/agent';

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

/** Create a simple Forest ScryfallCard for deck building. */
function makeForestScryfall(index: number): ScryfallCard {
  return {
    id: `forest-${index}`,
    name: `Forest ${index}`,
    type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
  };
}

/** Create a minimal legendary creature to serve as a commander. */
function makeCommanderScryfall(id: string, name: string): ScryfallCard {
  return {
    id,
    name,
    type_line: 'Legendary Creature — Treefolk',
    oracle_text: '',
    mana_cost: '{4}{G}{G}',
    cmc: 6,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: '4',
    toughness: '4',
  };
}

/** Build a GeneratedDeck of 99 uniquely-named forests + a commander. */
function buildForestDeck(commanderName: string, prefix: string): GeneratedDeck {
  const list: string[] = [];
  for (let i = 0; i < 99; i++) {
    list.push(`${prefix} Forest ${i}`);
  }
  return {
    id: `deck-${prefix}`,
    commander: commanderName,
    list,
    colors: ['G'],
    bracket: 1,
    theme: 'Forests',
  };
}

/** Create a card database containing commanders + forests for both decks. */
function buildCardDatabase(): ScryfallCard[] {
  const cards: ScryfallCard[] = [];

  // Commanders
  cards.push(makeCommanderScryfall('cmd-p1', 'Oakshade Elder'));
  cards.push(makeCommanderScryfall('cmd-p2', 'Mosswood Sentinel'));

  // 99 forests for player 1 deck
  for (let i = 0; i < 99; i++) {
    const f = makeForestScryfall(i);
    f.id = `p1-forest-${i}`;
    f.name = `P1 Forest ${i}`;
    cards.push(f);
  }

  // 99 forests for player 2 deck
  for (let i = 0; i < 99; i++) {
    const f = makeForestScryfall(i);
    f.id = `p2-forest-${i}`;
    f.name = `P2 Forest ${i}`;
    cards.push(f);
  }

  return cards;
}

// ---------------------------------------------------------------------------
// Utility: advance through all steps of one full turn
// ---------------------------------------------------------------------------

/**
 * Advance the game state through a complete turn for the active player.
 *
 * The sequence per turn:
 *  1. Untap step  (performUntapStep)
 *  2. Advance to upkeep, pass priority round
 *  3. Advance to draw, draw a card, pass priority round
 *  4. Advance to begin_combat (phase becomes precombat_main)
 *     -> play a land if legal, pass priority round
 *  5. Advance through combat steps (declare_attackers .. end_of_combat)
 *     -> pass priority each step
 *  6. Advance to end step (phase becomes postcombat_main)
 *     -> pass priority
 *  7. Advance to cleanup
 *  8. Advance past cleanup -> next turn
 *
 * Returns the updated state plus how many lands were played.
 */
interface TurnResult {
  state: typeof import('../types').GameState extends never ? never : ReturnType<typeof initGameFromDecks>;
  landsPlayed: number;
  landInstancesPlayed: string[];
}

function passAllPriority(state: ReturnType<typeof initGameFromDecks>): ReturnType<typeof initGameFromDecks> {
  let s = state;
  // Both players need to pass priority
  for (let i = 0; i < s.players.length; i++) {
    if (!s.hasPriorityPassed[i] && !s.players[i].hasLost) {
      s = passPriority(s);
    }
  }
  return s;
}

function runOneTurn(inputState: ReturnType<typeof initGameFromDecks>, skipDraw: boolean = false): TurnResult {
  let state = inputState;
  const activeIdx = state.activePlayerIndex;
  const activePlayerId = state.players[activeIdx].id;
  let landsPlayed = 0;
  const landInstancesPlayed: string[] = [];

  // The game starts at 'upkeep' on the very first turn (from initGameFromDecks),
  // but at 'untap' on subsequent turns (from advanceToNextTurn).
  // Handle both cases.

  if (state.step === 'untap') {
    state = performUntapStep(state);
    state = advanceStep(state); // -> upkeep
  }

  // We should now be at 'upkeep'
  expect(state.step).toBe('upkeep');
  state = passAllPriority(state);
  state = advanceStep(state); // -> draw

  expect(state.step).toBe('draw');
  // Draw a card (unless first turn of the game where player on the play skips draw)
  if (!skipDraw) {
    state = drawCards(state, activePlayerId, 1);
  }
  state = passAllPriority(state);
  state = advanceStep(state); // -> begin_combat (phase = precombat_main)

  expect(state.step).toBe('begin_combat');
  expect(state.phase).toBe('precombat_main');

  // Try to play a land using getLegalActions
  const actions = getLegalActions(state, activePlayerId);
  const playLandAction = actions.find(a => a.kind === 'PlayLand');
  if (playLandAction) {
    state = applyAction(state, activePlayerId, playLandAction);
    landsPlayed++;
    landInstancesPlayed.push((playLandAction as any).cardInstanceId);
  }

  // Pass priority through precombat main
  state = passAllPriority(state);

  // Advance through combat: declare_attackers, declare_blockers, first_strike_damage, combat_damage, end_of_combat
  state = advanceStep(state); // -> declare_attackers
  expect(state.step).toBe('declare_attackers');
  state = passAllPriority(state);

  state = advanceStep(state); // -> declare_blockers
  expect(state.step).toBe('declare_blockers');
  state = passAllPriority(state);

  state = advanceStep(state); // -> first_strike_damage
  expect(state.step).toBe('first_strike_damage');
  state = passAllPriority(state);

  state = advanceStep(state); // -> combat_damage
  expect(state.step).toBe('combat_damage');
  state = passAllPriority(state);

  state = advanceStep(state); // -> end_of_combat
  expect(state.step).toBe('end_of_combat');
  state = passAllPriority(state);

  // Advance to end step (phase = postcombat_main)
  state = advanceStep(state); // -> end
  expect(state.step).toBe('end');
  expect(state.phase).toBe('postcombat_main');
  state = passAllPriority(state);

  // Advance to cleanup
  state = advanceStep(state); // -> cleanup
  expect(state.step).toBe('cleanup');

  // Advance past cleanup to start the next turn
  state = advanceStep(state); // -> untap of next player's turn

  return { state, landsPlayed, landInstancesPlayed };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Full Game Loop: 2-player 5-turn integration', () => {
  let state: ReturnType<typeof initGameFromDecks>;

  beforeEach(() => {
    resetInstanceCounter();

    const cardDb = buildCardDatabase();
    const lookup = createCardLookup(cardDb);

    const config: GameInitConfig = {
      humanDeck: buildForestDeck('Oakshade Elder', 'P1'),
      aiDecks: [buildForestDeck('Mosswood Sentinel', 'P2')],
      aiDifficulty: 1,
      cardLookup: lookup,
      humanGoesFirst: true,
      startingLife: 40,
      startingHandSize: 7,
    };

    state = initGameFromDecks(config);
  });

  it('initializes correctly with 2 players, 7-card hands, 40 life', () => {
    expect(state.players).toHaveLength(2);
    expect(state.players[0].life).toBe(40);
    expect(state.players[1].life).toBe(40);

    const p1Hand = getCardsInZone(state, 'human', 'hand');
    const p2Hand = getCardsInZone(state, 'ai1', 'hand');
    expect(p1Hand).toHaveLength(7);
    expect(p2Hand).toHaveLength(7);

    expect(state.turnNumber).toBe(1);
    expect(state.phase).toBe('beginning');
    expect(state.step).toBe('upkeep');
    expect(state.activePlayerIndex).toBe(0);
  });

  it('runs a complete 5-turn game loop (10 half-turns)', () => {
    let totalLandsP1 = 0;
    let totalLandsP2 = 0;

    // Track initial hand sizes
    const initialP1Hand = getCardsInZone(state, 'human', 'hand').length;
    const initialP2Hand = getCardsInZone(state, 'ai1', 'hand').length;
    expect(initialP1Hand).toBe(7);
    expect(initialP2Hand).toBe(7);

    // =====================================================================
    // Turn 1: Player 1 (human) — skip draw on the very first turn of the game
    // =====================================================================
    expect(state.turnNumber).toBe(1);
    expect(state.activePlayerIndex).toBe(0);

    let result = runOneTurn(state, /* skipDraw */ true);
    state = result.state;
    totalLandsP1 += result.landsPlayed;

    // After P1's turn, it should be P2's turn
    expect(state.turnNumber).toBe(2);
    expect(state.activePlayerIndex).toBe(1);

    // Turn 1: Player 2 (AI)
    result = runOneTurn(state, /* skipDraw */ false);
    state = result.state;
    totalLandsP2 += result.landsPlayed;

    expect(state.turnNumber).toBe(3);
    expect(state.activePlayerIndex).toBe(0);

    // =====================================================================
    // Turns 2-5: Both players draw and play lands normally
    // =====================================================================
    for (let turn = 2; turn <= 5; turn++) {
      // Player 1's turn
      result = runOneTurn(state, false);
      state = result.state;
      totalLandsP1 += result.landsPlayed;

      // Player 2's turn
      result = runOneTurn(state, false);
      state = result.state;
      totalLandsP2 += result.landsPlayed;
    }

    // =====================================================================
    // Verification
    // =====================================================================

    // Turn number: Started at 1, each player's turn increments.
    // After 5 full rounds (10 half-turns), we should be at turn 11.
    expect(state.turnNumber).toBe(11);

    // Active player should be back to player 1
    expect(state.activePlayerIndex).toBe(0);

    // Life totals should remain at 40 (no combat, no damage)
    expect(state.players[0].life).toBe(40);
    expect(state.players[1].life).toBe(40);

    // Each player should have played lands (all cards are forests)
    // P1: turn 1 (no draw) played 1 land from opening 7, turns 2-5 drew + played = 4 more => 5 lands
    // P2: turns 1-5, drew each turn, played each turn => 5 lands
    expect(totalLandsP1).toBe(5);
    expect(totalLandsP2).toBe(5);

    // Check battlefield: each player should have 5 lands on battlefield
    const p1Battlefield = getCardsInZone(state, 'human', 'battlefield');
    const p2Battlefield = getCardsInZone(state, 'ai1', 'battlefield');
    expect(p1Battlefield).toHaveLength(5);
    expect(p2Battlefield).toHaveLength(5);

    // All battlefield cards should be lands
    for (const card of p1Battlefield) {
      const def = state.cardDefinitions.get(card.definitionId)!;
      expect(def.card_types).toContain('land');
    }
    for (const card of p2Battlefield) {
      const def = state.cardDefinitions.get(card.definitionId)!;
      expect(def.card_types).toContain('land');
    }

    // Hand sizes:
    // P1: started with 7, didn't draw turn 1, played 1 land => 6. Turns 2-5: drew 4, played 4 => 6.
    // P2: started with 7, drew 5 over 5 turns = 12, played 5 lands => 7.
    const p1Hand = getCardsInZone(state, 'human', 'hand');
    const p2Hand = getCardsInZone(state, 'ai1', 'hand');
    expect(p1Hand).toHaveLength(6);
    expect(p2Hand).toHaveLength(7);

    // Lands should all be untapped (untap step runs each turn)
    for (const card of p1Battlefield) {
      expect(card.tapped).toBe(false);
    }
    for (const card of p2Battlefield) {
      expect(card.tapped).toBe(false);
    }
  });

  it('turn number advances correctly each half-turn', () => {
    // Turn 1: P1
    let result = runOneTurn(state, true);
    state = result.state;
    expect(state.turnNumber).toBe(2);

    // Turn 2: P2
    result = runOneTurn(state, false);
    state = result.state;
    expect(state.turnNumber).toBe(3);

    // Turn 3: P1
    result = runOneTurn(state, false);
    state = result.state;
    expect(state.turnNumber).toBe(4);
  });

  it('getLegalActions returns PlayLand during main phase for active player', () => {
    // Advance to precombat main (from upkeep start)
    state = passAllPriority(state);
    state = advanceStep(state); // -> draw
    state = drawCards(state, 'human', 1);
    state = passAllPriority(state);
    state = advanceStep(state); // -> begin_combat (precombat_main)

    const actions = getLegalActions(state, 'human');
    const landActions = actions.filter(a => a.kind === 'PlayLand');
    expect(landActions.length).toBeGreaterThan(0);

    // Non-active player should NOT have PlayLand
    const p2Actions = getLegalActions(state, 'ai1');
    const p2LandActions = p2Actions.filter(a => a.kind === 'PlayLand');
    expect(p2LandActions).toHaveLength(0);
  });

  it('priority passing works correctly with allPlayersPassed', () => {
    // Initially no one has passed
    expect(allPlayersPassed(state)).toBe(false);

    // Player 1 passes
    state = passPriority(state);
    expect(allPlayersPassed(state)).toBe(false);

    // Player 2 passes
    state = passPriority(state);
    expect(allPlayersPassed(state)).toBe(true);
  });

  it('lands appear on battlefield after being played', () => {
    // Get to precombat main
    state = passAllPriority(state);
    state = advanceStep(state); // draw
    state = passAllPriority(state);
    state = advanceStep(state); // begin_combat = precombat_main

    const handBefore = getCardsInZone(state, 'human', 'hand');
    const bfBefore = getCardsInZone(state, 'human', 'battlefield');

    expect(handBefore.length).toBe(7);
    expect(bfBefore.length).toBe(0);

    // Play a land
    const actions = getLegalActions(state, 'human');
    const playLand = actions.find(a => a.kind === 'PlayLand')!;
    state = applyAction(state, 'human', playLand);

    const handAfter = getCardsInZone(state, 'human', 'hand');
    const bfAfter = getCardsInZone(state, 'human', 'battlefield');

    expect(handAfter.length).toBe(6);
    expect(bfAfter.length).toBe(1);
    expect(bfAfter[0].zone).toBe('battlefield');
  });
});
