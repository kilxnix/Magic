/**
 * trg-phase-steps: executing tests for "each upkeep / each end step / each combat"
 * phase-step trigger CONDITIONS.
 *
 * Verifies end-to-end that the parser recognizes the new trigger phrasings AND that
 * the engine actually fires the registered ability when the corresponding phase/step
 * event is emitted by checkTriggersForEvent (the same events turn-manager emits:
 * UpkeepStart / BeginningCombatStart / EndStepStart).
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  checkTriggersForEvent,
  registerBattlefieldAbilities,
} from '../stack';
import type { CardDefinition, GameState, CardInstance } from '../types';

function makeEnchantment(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Enchantment',
    oracle_text: oracleText,
    mana_cost: '{2}{U}',
    cmc: 3,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['enchantment'],
  };
}

function makeLand(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Basic Land - Island',
    oracle_text: '{T}: Add {U}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['U'],
    keywords: [],
    card_types: ['land'],
  };
}

function createTestGame(p1Cards: CardDefinition[], p2Cards: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-cmd-1' },
    { playerId: 'p2', name: 'Player 2', cards: p2Cards, commanderId: 'nonexistent-cmd-2' },
  ]);
}

function moveToZone(state: GameState, instanceId: string, zone: 'battlefield'): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone, summoningSick: false });
  return { ...state, cards: newCards };
}

function findCard(state: GameState, defId: string): CardInstance | undefined {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  return undefined;
}

function handCount(state: GameState, playerId: string): number {
  let n = 0;
  for (const card of state.cards.values()) {
    if (card.ownerId === playerId && card.zone === 'hand') n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// PARSING
// ---------------------------------------------------------------------------

describe('trg-phase-steps parsing', () => {
  it('parses "At the beginning of each upkeep" as Upkeep/each', () => {
    const r = parseOracleText('At the beginning of each upkeep, you draw a card.');
    expect(r.kind).toBe('Triggered');
    if (r.kind === 'Triggered') {
      expect(r.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    }
  });

  it('parses "At the beginning of each end step" as EndStep/each', () => {
    const r = parseOracleText('At the beginning of each end step, you draw a card.');
    expect(r.kind).toBe('Triggered');
    if (r.kind === 'Triggered') {
      expect(r.ability.trigger).toEqual({ kind: 'EndStep', whose: 'each' });
    }
  });

  it("parses \"At the beginning of each player's end step\" as EndStep/each", () => {
    const r = parseOracleText("At the beginning of each player's end step, you draw a card.");
    expect(r.kind).toBe('Triggered');
    if (r.kind === 'Triggered') {
      expect(r.ability.trigger).toEqual({ kind: 'EndStep', whose: 'each' });
    }
  });

  it("parses \"At the beginning of combat on each player's turn\" as BeginningCombat/each", () => {
    const r = parseOracleText("At the beginning of combat on each player's turn, you draw a card.");
    expect(r.kind).toBe('Triggered');
    if (r.kind === 'Triggered') {
      expect(r.ability.trigger).toEqual({ kind: 'BeginningCombat', whose: 'each' });
    }
  });

  it('parses "At the beginning of each combat" as BeginningCombat/each', () => {
    const r = parseOracleText('At the beginning of each combat, you draw a card.');
    expect(r.kind).toBe('Triggered');
    if (r.kind === 'Triggered') {
      expect(r.ability.trigger).toEqual({ kind: 'BeginningCombat', whose: 'each' });
    }
  });

  // Regression: the more-specific "your"/"opponent's" variants still parse.
  it('still parses "At the beginning of your end step" as EndStep/yours', () => {
    const r = parseOracleText('At the beginning of your end step, you draw a card.');
    expect(r.kind).toBe('Triggered');
    if (r.kind === 'Triggered') {
      expect(r.ability.trigger).toEqual({ kind: 'EndStep', whose: 'yours' });
    }
  });

  it("still parses \"At the beginning of each opponent's end step\" as EndStep/opponents", () => {
    const r = parseOracleText("At the beginning of each opponent's end step, you draw a card.");
    expect(r.kind).toBe('Triggered');
    if (r.kind === 'Triggered') {
      expect(r.ability.trigger).toEqual({ kind: 'EndStep', whose: 'opponents' });
    }
  });
});

// ---------------------------------------------------------------------------
// EXECUTION — engine actually fires the ability and the draw happens
// ---------------------------------------------------------------------------

describe('trg-phase-steps execution', () => {
  it('"each end step" fires the controller\'s draw on BOTH players\' end steps', () => {
    const card = makeEnchantment(
      'each-end-draw',
      'Each End Draw',
      'At the beginning of each end step, you draw a card.',
    );
    let state = createTestGame([card, makeLand('l1', 'Island')], [makeLand('l2', 'Island')]);
    const inst = findCard(state, 'each-end-draw')!;
    state = moveToZone(state, inst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, inst.instanceId);

    const baseline = handCount(state, 'p1');

    // p1's own end step -> p1 (the controller) draws.
    state = { ...state, phase: 'ending', step: 'end', activePlayerIndex: 0, priorityPlayerIndex: 0 };
    state = checkTriggersForEvent(state, { kind: 'EndStepStart', activePlayerId: 'p1' });
    expect(state.pendingTriggers).toHaveLength(1);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(handCount(state, 'p1')).toBe(baseline + 1);

    // p2's end step -> the trigger STILL FIRES, because "each" fires on every player's
    // end step (this is the new CONDITION this family adds). Verify the engine queues
    // the ability for p1's permanent even though p2 is the active player.
    state = { ...state, phase: 'ending', step: 'end', activePlayerIndex: 1, priorityPlayerIndex: 1 };
    state = checkTriggersForEvent(state, { kind: 'EndStepStart', activePlayerId: 'p2' });
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].controllerId).toBe('p1');
    expect(state.pendingTriggers[0].ability.trigger).toEqual({ kind: 'EndStep', whose: 'each' });
  });

  it('"each upkeep" fires on both players\' upkeeps', () => {
    const card = makeEnchantment(
      'each-upkeep-draw',
      'Each Upkeep Draw',
      'At the beginning of each upkeep, you draw a card.',
    );
    let state = createTestGame([card, makeLand('l1', 'Island')], [makeLand('l2', 'Island')]);
    const inst = findCard(state, 'each-upkeep-draw')!;
    state = moveToZone(state, inst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, inst.instanceId);

    // p2's upkeep -> p1's "each upkeep" permanent still fires (the new condition).
    state = { ...state, phase: 'beginning', step: 'upkeep', activePlayerIndex: 1, priorityPlayerIndex: 1 };
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p2' });
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].controllerId).toBe('p1');

    // And on p1's own upkeep the effect executes: the controller draws a card.
    state = { ...state, pendingTriggers: [], phase: 'beginning', step: 'upkeep', activePlayerIndex: 0, priorityPlayerIndex: 0 };
    const baseline = handCount(state, 'p1');
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p1' });
    expect(state.pendingTriggers).toHaveLength(1);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(handCount(state, 'p1')).toBe(baseline + 1);
  });

  it('"combat on each player\'s turn" fires on a non-controller\'s combat', () => {
    const card = makeEnchantment(
      'each-combat-draw',
      'Each Combat Draw',
      "At the beginning of combat on each player's turn, you draw a card.",
    );
    let state = createTestGame([card, makeLand('l1', 'Island')], [makeLand('l2', 'Island')]);
    const inst = findCard(state, 'each-combat-draw')!;
    state = moveToZone(state, inst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, inst.instanceId);

    // p2's combat -> the trigger fires for p1's permanent because "each player's turn".
    state = { ...state, phase: 'combat', step: 'begin_combat', activePlayerIndex: 1, priorityPlayerIndex: 1 };
    state = checkTriggersForEvent(state, { kind: 'BeginningCombatStart', activePlayerId: 'p2' });
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].controllerId).toBe('p1');

    // And on p1's own combat the controller draws.
    state = { ...state, pendingTriggers: [], phase: 'combat', step: 'begin_combat', activePlayerIndex: 0, priorityPlayerIndex: 0 };
    const baseline = handCount(state, 'p1');
    state = checkTriggersForEvent(state, { kind: 'BeginningCombatStart', activePlayerId: 'p1' });
    expect(state.pendingTriggers).toHaveLength(1);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(handCount(state, 'p1')).toBe(baseline + 1);
  });
});
