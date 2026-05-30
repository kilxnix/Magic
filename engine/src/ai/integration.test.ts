import { describe, it, expect } from 'vitest';
import {
  makeDecision,
  applyAction,
  dispatchAIAction,
  runAITurn,
  createAIConfig,
} from './agent';
import { GameState, CardDefinition, createPlayer, Phase, Step } from '../types';
import type { AIAction } from './types';
import { populateParsedCache } from '../cards/card-parser-cache';

// Helper to create minimal game state
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

// Helper to add a card to the game state
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

describe('applyAction', () => {
  it('applies PlayLand action', () => {
    const state = createTestState({
      activePlayerIndex: 0,
      phase: 'precombat_main',
    });

    addCard(state, 'forest1', 'p1', 'hand', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });

    const action: AIAction = { kind: 'PlayLand', cardInstanceId: 'forest1' };
    const newState = applyAction(state, 'p1', action);

    expect(newState.cards.get('forest1')!.zone).toBe('battlefield');
    expect(newState.players[0].hasPlayedLand).toBe(true);
  });

  it('applies ActivateManaAbility action', () => {
    const state = createTestState();

    addCard(state, 'forest1', 'p1', 'battlefield', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });

    const action: AIAction = { kind: 'ActivateManaAbility', cardInstanceId: 'forest1', color: 'G' };
    const newState = applyAction(state, 'p1', action);

    expect(newState.cards.get('forest1')!.tapped).toBe(true);
    expect(newState.players[0].manaPool.G).toBe(1);
  });

  it('applies CastSpell action', () => {
    const state = createTestState({
      activePlayerIndex: 0,
      phase: 'precombat_main',
    });

    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 };

    addCard(state, 'bear1', 'p1', 'hand', {
      name: 'Grizzly Bears',
      mana_cost: '{1}{G}',
      cmc: 2,
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    const action: AIAction = { kind: 'CastSpell', cardInstanceId: 'bear1', targets: [] };
    const newState = applyAction(state, 'p1', action);

    expect(newState.cards.get('bear1')!.zone).toBe('stack');
    expect(newState.stack.length).toBe(1);
  });

  it('fills named-card choices for AI exile-until-named spells before they hit the stack', () => {
    const state = createTestState({
      activePlayerIndex: 0,
      phase: 'precombat_main',
    });

    state.players[0].manaPool = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 1 };

    addCard(state, 'pact1', 'p1', 'hand', {
      id: 'tainted-pact',
      name: 'Tainted Pact',
      type_line: 'Instant',
      mana_cost: '{1}{B}',
      cmc: 2,
      card_types: ['instant'],
      oracle_text: 'Exile the top card of your library. You may put that card into your hand unless it has the same name as another card exiled this way. Repeat this process until you put a card into your hand or you exile two cards with the same name, whichever comes first.',
    });
    addCard(state, 'oracle1', 'p1', 'library', {
      name: "Thassa's Oracle",
      type_line: 'Creature — Merfolk Wizard',
      mana_cost: '{U}{U}',
      cmc: 2,
      card_types: ['creature'],
      oracle_text: '',
    });

    const action: AIAction = { kind: 'CastSpell', cardInstanceId: 'pact1', targets: [] };
    const result = dispatchAIAction(state, 'p1', action, { autoNameMissingCardChoices: true });

    expect(result.ok).toBe(true);
    expect(result.state.stack).toHaveLength(1);
    expect((result.state.stack[0] as { namedCardChoices?: Record<string, string> }).namedCardChoices)
      .toEqual({ namedCard: "Thassa's Oracle" });
  });

  it('applies PassPriority action', () => {
    const state = createTestState();

    const action: AIAction = { kind: 'PassPriority' };
    const newState = applyAction(state, 'p1', action);

    expect(newState.hasPriorityPassed[0]).toBe(true);
  });

  it('applies DeclareAttackers action', () => {
    const state = createTestState({
      activePlayerIndex: 0,
      phase: 'combat',
      step: 'declare_attackers',
    });

    addCard(state, 'creature1', 'p1', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    }, { summoningSick: false });

    const action: AIAction = {
      kind: 'DeclareAttackers',
      attacks: [{ cardInstanceId: 'creature1', defendingPlayerId: 'p2' }],
    };
    const newState = applyAction(state, 'p1', action);

    expect(newState.combat).not.toBeNull();
    expect(newState.combat!.attackers).toHaveLength(1);
  });
});

describe('makeDecision', () => {
  it('returns null when no legal actions', () => {
    const state = createTestState({ priorityPlayerIndex: 1 }); // p1 doesn't have priority

    const config = createAIConfig('p1', 3);
    const decision = makeDecision(state, config);

    expect(decision).toBeNull();
  });

  it('plays land when available during main phase', () => {
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

    const config = createAIConfig('p1', 5); // High difficulty for deterministic behavior
    const decision = makeDecision(state, config);

    expect(decision).not.toBeNull();
    expect(decision!.action.kind).toBe('PlayLand');
  });

  it('casts creature when mana available', () => {
    const state = createTestState({
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
    });

    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 };

    addCard(state, 'bear1', 'p1', 'hand', {
      name: 'Grizzly Bears',
      mana_cost: '{1}{G}',
      cmc: 2,
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    const config = createAIConfig('p1', 5);
    const decision = makeDecision(state, config);

    expect(decision).not.toBeNull();
    expect(decision!.action.kind).toBe('CastSpell');
  });

  it('passes priority when no beneficial actions', () => {
    const state = createTestState({
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
    });

    // No cards in hand, no mana, nothing to do
    const config = createAIConfig('p1', 5);
    const decision = makeDecision(state, config);

    expect(decision).not.toBeNull();
    expect(decision!.action.kind).toBe('PassPriority');
  });

  it('prefers attacking over not attacking', () => {
    const state = createTestState({
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'combat',
      step: 'declare_attackers',
    });

    addCard(state, 'creature1', 'p1', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 4,
      toughness: 4,
      keywords: [],
    }, { summoningSick: false });

    const config = createAIConfig('p1', 5);
    const decision = makeDecision(state, config);

    expect(decision).not.toBeNull();
    expect(decision!.action.kind).toBe('DeclareAttackers');
    if (decision!.action.kind === 'DeclareAttackers') {
      // Should attack (4 power is good)
      expect(decision!.action.attacks.length).toBeGreaterThan(0);
    }
  });
});

describe('runAITurn', () => {
  it('plays land and then passes', () => {
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
    const { finalState, decisions } = runAITurn(state, config);

    // Should have played land and then passed
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions.some(d => d.action.kind === 'PlayLand')).toBe(true);
    expect(decisions[decisions.length - 1].action.kind).toBe('PassPriority');

    // Land should be on battlefield
    expect(finalState.cards.get('forest1')!.zone).toBe('battlefield');
  });

  it('taps lands, casts spell, then passes', () => {
    const state = createTestState({
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
    });

    // Add two forests
    addCard(state, 'forest1', 'p1', 'battlefield', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });
    addCard(state, 'forest2', 'p1', 'battlefield', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });

    // Add a creature to cast
    addCard(state, 'bear1', 'p1', 'hand', {
      name: 'Grizzly Bears',
      mana_cost: '{1}{G}',
      cmc: 2,
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    const config = createAIConfig('p1', 5);
    const { finalState, decisions } = runAITurn(state, config);

    // Should have tapped lands, cast the bear, and passed
    const manaActions = decisions.filter(d => d.action.kind === 'ActivateManaAbility');
    const castActions = decisions.filter(d => d.action.kind === 'CastSpell');

    expect(manaActions.length).toBeGreaterThanOrEqual(2);
    expect(castActions.length).toBe(1);

    // Bear should be on the stack
    expect(finalState.cards.get('bear1')!.zone).toBe('stack');
  });

  it('does not cash in Skirk Prospector mana when no spell needs it', () => {
    const state = createTestState({
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
    });

    addCard(state, 'skirk1', 'p1', 'battlefield', {
      name: 'Skirk Prospector',
      type_line: 'Creature - Goblin',
      oracle_text: 'Sacrifice a Goblin: Add {R}.',
      mana_cost: '{R}',
      cmc: 1,
      colors: ['R'],
      color_identity: ['R'],
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    }, { summoningSick: false });
    addCard(state, 'token1', 'p1', 'battlefield', {
      name: 'Goblin Token',
      type_line: 'Creature - Goblin',
      mana_cost: '',
      cmc: 0,
      colors: ['R'],
      color_identity: ['R'],
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    }, { summoningSick: false });
    state.cards.set('token1', { ...state.cards.get('token1')!, isToken: true });

    const { finalState, decisions } = runAITurn(state, createAIConfig('p1', 5));

    expect(decisions.some(d =>
      d.action.kind === 'ActivateManaAbility' && d.action.cardInstanceId === 'skirk1'
    )).toBe(false);
    expect(finalState.cards.get('skirk1')!.zone).toBe('battlefield');
    expect(finalState.cards.get('token1')!.zone).toBe('battlefield');
  });

  it('uses lands before Skirk Prospector when lands can pay the hand spell', () => {
    const state = createTestState({
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
    });

    addCard(state, 'skirk1', 'p1', 'battlefield', {
      name: 'Skirk Prospector',
      type_line: 'Creature - Goblin',
      oracle_text: 'Sacrifice a Goblin: Add {R}.',
      mana_cost: '{R}',
      cmc: 1,
      colors: ['R'],
      color_identity: ['R'],
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    }, { summoningSick: false });
    addCard(state, 'token1', 'p1', 'battlefield', {
      name: 'Goblin Token',
      type_line: 'Creature - Goblin',
      mana_cost: '',
      cmc: 0,
      colors: ['R'],
      color_identity: ['R'],
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    }, { summoningSick: false });
    state.cards.set('token1', { ...state.cards.get('token1')!, isToken: true });
    addCard(state, 'mountain1', 'p1', 'battlefield', {
      name: 'Mountain',
      type_line: 'Basic Land - Mountain',
      card_types: ['land'],
    });
    addCard(state, 'mountain2', 'p1', 'battlefield', {
      name: 'Mountain',
      type_line: 'Basic Land - Mountain',
      card_types: ['land'],
    });
    addCard(state, 'bear1', 'p1', 'hand', {
      name: 'Goblin Piker',
      mana_cost: '{1}{R}',
      cmc: 2,
      colors: ['R'],
      color_identity: ['R'],
      card_types: ['creature'],
      power: 2,
      toughness: 1,
    });

    const { finalState, decisions } = runAITurn(state, createAIConfig('p1', 5));
    const manaActions = decisions.filter(d => d.action.kind === 'ActivateManaAbility');

    expect(manaActions.map(d => d.action.kind === 'ActivateManaAbility' ? d.action.cardInstanceId : '')).toEqual([
      'mountain1',
      'mountain2',
    ]);
    expect(decisions.some(d => d.action.kind === 'CastSpell' && d.action.cardInstanceId === 'bear1')).toBe(true);
    expect(finalState.cards.get('token1')!.zone).toBe('battlefield');
  });

  it('stops after max iterations', () => {
    const state = createTestState({
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
    });

    // Add many lands to tap
    for (let i = 0; i < 20; i++) {
      addCard(state, `forest${i}`, 'p1', 'battlefield', {
        id: `forest_def_${i}`,
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        card_types: ['land'],
      });
    }

    const config = createAIConfig('p1', 5);
    const { decisions } = runAITurn(state, config, 5); // Max 5 iterations

    // Should stop at max iterations
    expect(decisions.length).toBeLessThanOrEqual(5);
  });
});

describe('createAIConfig', () => {
  it('creates config with specified difficulty', () => {
    const config = createAIConfig('p1', 4);

    expect(config.playerId).toBe('p1');
    expect(config.difficulty).toBe(4);
  });

  it('defaults to difficulty 3', () => {
    const config = createAIConfig('p2');

    expect(config.playerId).toBe('p2');
    expect(config.difficulty).toBe(3);
  });
});
