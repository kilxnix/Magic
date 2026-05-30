/**
 * agent.test.ts
 *
 * Unit tests for AI action dispatch and the 5-retry budget introduced in Task 8.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  chooseAction,
  dispatchAIAction,
  makeDecision,
  runAITurn,
  createAIConfig,
} from './agent';
import { GameState, CardDefinition, createPlayer, Phase, Step } from '../types';
import type { AIAction } from './types';
import { populateParsedCache } from '../cards/card-parser-cache';
import * as legalActions from './legal-actions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestState(overrides: Partial<GameState> = {}): GameState {
  const players = [
    { ...createPlayer('p1', 'Player 1'), hasPriority: true },
    { ...createPlayer('p2', 'Player 2'), hasPriority: false },
  ];

  return {
    players,
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as Phase,
    step: 'upkeep' as Step,
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    ...overrides,
  };
}

function addCard(
  state: GameState,
  instanceId: string,
  ownerId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard' | 'command',
  def: Partial<CardDefinition>,
  options: { tapped?: boolean; summoningSick?: boolean } = {},
): void {
  const baseDef: CardDefinition = {
    id: def.id ?? instanceId,
    name: def.name ?? 'Test Card',
    type_line: def.type_line ?? 'Creature',
    oracle_text: def.oracle_text ?? '',
    mana_cost: def.mana_cost ?? '',
    cmc: def.cmc ?? 0,
    colors: def.colors ?? [],
    color_identity: def.color_identity ?? [],
    keywords: def.keywords ?? [],
    card_types: def.card_types ?? ['creature'],
    power: def.power,
    toughness: def.toughness,
  };

  const fullDef = populateParsedCache(baseDef);
  state.cardDefinitions.set(fullDef.id, fullDef);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: fullDef.id,
    ownerId,
    zone,
    tapped: options.tapped ?? false,
    summoningSick: options.summoningSick ?? (zone === 'battlefield'),
    counters: {},
    damage: 0,
    isCommander: false,
  });
}

// ---------------------------------------------------------------------------
// dispatchAIAction tests
// ---------------------------------------------------------------------------

describe('dispatchAIAction', () => {
  it('returns ok:true when PlayLand succeeds', () => {
    const state = createTestState({
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
    });

    addCard(state, 'forest1', 'p1', 'hand', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });

    const action: AIAction = { kind: 'PlayLand', cardInstanceId: 'forest1' };
    const result = dispatchAIAction(state, 'p1', action);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.cards.get('forest1')!.zone).toBe('battlefield');
    }
  });

  it('returns ok:false for PlayLand when card does not exist', () => {
    const state = createTestState();

    const action: AIAction = { kind: 'PlayLand', cardInstanceId: 'nonexistent' };
    const result = dispatchAIAction(state, 'p1', action);

    expect(result.ok).toBe(false);
  });

  it('returns ok:true when ActivateManaAbility succeeds', () => {
    const state = createTestState();

    addCard(state, 'forest1', 'p1', 'battlefield', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });

    const action: AIAction = { kind: 'ActivateManaAbility', cardInstanceId: 'forest1', color: 'G' };
    const result = dispatchAIAction(state, 'p1', action);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.players[0].manaPool.G).toBe(1);
    }
  });

  it('returns ok:false when tapping an already-tapped land', () => {
    const state = createTestState();

    addCard(state, 'forest1', 'p1', 'battlefield', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    }, { tapped: true });

    const action: AIAction = { kind: 'ActivateManaAbility', cardInstanceId: 'forest1', color: 'G' };
    const result = dispatchAIAction(state, 'p1', action);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('already_tapped');
    }
  });

  it('returns ok:true when PassPriority succeeds', () => {
    const state = createTestState({ priorityPlayerIndex: 0 });

    const action: AIAction = { kind: 'PassPriority' };
    const result = dispatchAIAction(state, 'p1', action);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.hasPriorityPassed[0]).toBe(true);
    }
  });

  it('returns ok:false when player does not have priority', () => {
    const state = createTestState({ priorityPlayerIndex: 1 }); // p2 has priority

    const action: AIAction = { kind: 'PassPriority' };
    const result = dispatchAIAction(state, 'p1', action);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('priority_not_yours');
    }
  });

  it('returns ok:false for unknown card in DeclareAttackers', () => {
    const state = createTestState({
      activePlayerIndex: 0,
      phase: 'combat',
      step: 'declare_attackers',
    });

    const action: AIAction = {
      kind: 'DeclareAttackers',
      attacks: [{ cardInstanceId: 'ghost_creature', defendingPlayerId: 'p2' }],
    };
    // DeclareAttackers wraps declareAttackers which may throw; dispatchAIAction should catch that
    const result = dispatchAIAction(state, 'p1', action);

    // Either ok:false (guarded) or the action itself triggers an error caught as internal_error
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Non-mutating action choice tests
// ---------------------------------------------------------------------------

describe('chooseAction', () => {
  it('selects an action without applying it to the game state', () => {
    const state = createTestState({
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
      step: 'main',
    });

    addCard(state, 'forest1', 'p1', 'hand', {
      name: 'Forest',
      type_line: 'Basic Land - Forest',
      card_types: ['land'],
    });

    const choice = chooseAction(state, createAIConfig('p1', 5));

    expect(choice).not.toBeNull();
    expect(choice?.action.kind).toBe('PlayLand');
    expect(state.cards.get('forest1')?.zone).toBe('hand');
    expect(state.players[0].landsPlayed ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Retry budget tests
// ---------------------------------------------------------------------------

describe('AI action dispatch with try* retry budget', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forces PassPriority after 5 consecutive action failures (retry budget)', () => {
    // Build a minimal state where p1 has priority.
    const state = createTestState({
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
    });

    // Mock getLegalActions to return only a failing action (no PassPriority fallback).
    // makeDecision will return null on each call, and runAITurn will accumulate
    // consecutiveFailures until it hits AI_RETRY_BUDGET and forces a pass.
    vi.spyOn(legalActions, 'getLegalActions').mockReturnValue([
      { kind: 'PlayLand', cardInstanceId: 'ghost_card' } as AIAction,
    ]);

    const config = createAIConfig('p1', 5);
    const { decisions } = runAITurn(state, config);

    // The loop must have exited — not run 100 times.
    // After AI_RETRY_BUDGET (5) null-returns, the budget fires and forces PassPriority.
    expect(decisions.length).toBeLessThanOrEqual(10);

    // The budget-forced pass should appear as the last (and only) decision.
    const passed = decisions.some(d => d.action.kind === 'PassPriority');
    expect(passed).toBe(true);
  });

  it('does not exhaust retry budget on legitimate consecutive actions', () => {
    // A normal turn: forest in hand, should play it then pass.
    const state = createTestState({
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
    });

    addCard(state, 'forest1', 'p1', 'hand', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });

    const config = createAIConfig('p1', 5);
    const { decisions } = runAITurn(state, config);

    // Should play land and pass — two successful decisions, no budget consumed.
    expect(decisions.some(d => d.action.kind === 'PlayLand')).toBe(true);
    const lastDecision = decisions[decisions.length - 1];
    expect(lastDecision.action.kind).toBe('PassPriority');
  });

  it('makeDecision falls back to PassPriority when best action fails but pass is legal', () => {
    // State where p1 has priority.
    const state = createTestState({
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
    });

    // Provide a failing action plus a PassPriority fallback.
    vi.spyOn(legalActions, 'getLegalActions').mockReturnValue([
      { kind: 'PlayLand', cardInstanceId: 'does_not_exist' } as AIAction,
      { kind: 'PassPriority' } as AIAction,
    ]);

    const config = createAIConfig('p1', 5);

    // makeDecision should not throw; it should use the PassPriority fallback.
    let result: ReturnType<typeof makeDecision> = null;
    expect(() => {
      result = makeDecision(state, config);
    }).not.toThrow();

    // The fallback pass should have been chosen.
    expect(result).not.toBeNull();
    if (result !== null) {
      expect((result as NonNullable<typeof result>).action.kind).toBe('PassPriority');
    }
  });

  it('makeDecision returns null when chosen action fails and no PassPriority is available', () => {
    // State where p1 has priority but only a failing action is offered (no pass).
    const state = createTestState({
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
    });

    vi.spyOn(legalActions, 'getLegalActions').mockReturnValue([
      { kind: 'PlayLand', cardInstanceId: 'does_not_exist' } as AIAction,
    ]);

    const config = createAIConfig('p1', 5);

    let result: ReturnType<typeof makeDecision> = null;
    expect(() => {
      result = makeDecision(state, config);
    }).not.toThrow();

    // No fallback available, so null is returned to signal a failure.
    expect(result).toBeNull();
  });
});
