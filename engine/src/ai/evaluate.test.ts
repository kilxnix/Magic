import { describe, it, expect } from 'vitest';
import {
  evaluateCreature,
  evaluatePlayerPosition,
  evaluateGameState,
  evaluateAction,
  evaluateActions,
  getBestAction,
} from './evaluate';
import { GameState, CardDefinition, createPlayer, Phase, Step } from '../types';
import type { AIAction } from './types';

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
): void {
  const fullDef: CardDefinition = {
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

  state.cardDefinitions.set(fullDef.id, fullDef);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: fullDef.id,
    ownerId,
    zone,
    tapped: false,
    summoningSick: zone === 'battlefield',
    counters: {},
    damage: 0,
    isCommander: false,
  });
}

describe('evaluateCreature', () => {
  it('scores based on power and toughness', () => {
    const state = createTestState();

    addCard(state, 'small', 'p1', 'battlefield', {
      name: 'Squire',
      card_types: ['creature'],
      power: 1,
      toughness: 2,
      keywords: [],
    });

    addCard(state, 'big', 'p1', 'battlefield', {
      name: 'Giant',
      card_types: ['creature'],
      power: 5,
      toughness: 5,
      keywords: [],
    });

    const smallCard = state.cards.get('small')!;
    const bigCard = state.cards.get('big')!;

    const smallScore = evaluateCreature(state, smallCard);
    const bigScore = evaluateCreature(state, bigCard);

    expect(bigScore).toBeGreaterThan(smallScore);
  });

  it('gives bonus for flying', () => {
    const state = createTestState();

    addCard(state, 'ground', 'p1', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
      keywords: [],
    });

    addCard(state, 'flying', 'p1', 'battlefield', {
      name: 'Bird',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
      keywords: ['Flying'],
    });

    const groundScore = evaluateCreature(state, state.cards.get('ground')!);
    const flyingScore = evaluateCreature(state, state.cards.get('flying')!);

    expect(flyingScore).toBeGreaterThan(groundScore);
  });

  it('gives bonus for commander', () => {
    const state = createTestState();

    addCard(state, 'regular', 'p1', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 4,
      toughness: 4,
      keywords: [],
    });

    addCard(state, 'commander', 'p1', 'battlefield', {
      name: 'Commander',
      card_types: ['creature'],
      power: 4,
      toughness: 4,
      keywords: [],
    });
    state.cards.get('commander')!.isCommander = true;

    const regularScore = evaluateCreature(state, state.cards.get('regular')!);
    const commanderScore = evaluateCreature(state, state.cards.get('commander')!);

    expect(commanderScore).toBeGreaterThan(regularScore);
  });
});

describe('evaluatePlayerPosition', () => {
  it('returns negative score for eliminated player', () => {
    const state = createTestState();
    state.players[0].hasLost = true;

    const score = evaluatePlayerPosition(state, 'p1');
    expect(score).toBeLessThan(0);
  });

  it('values higher life totals', () => {
    const state1 = createTestState();
    state1.players[0].life = 40;

    const state2 = createTestState();
    state2.players[0].life = 20;

    const score40 = evaluatePlayerPosition(state1, 'p1');
    const score20 = evaluatePlayerPosition(state2, 'p1');

    expect(score40).toBeGreaterThan(score20);
  });

  it('values cards in hand', () => {
    const state1 = createTestState();

    const state2 = createTestState();
    addCard(state2, 'card1', 'p1', 'hand', { card_types: ['instant'] });
    addCard(state2, 'card2', 'p1', 'hand', { card_types: ['instant'] });

    const scoreEmpty = evaluatePlayerPosition(state1, 'p1');
    const scoreCards = evaluatePlayerPosition(state2, 'p1');

    expect(scoreCards).toBeGreaterThan(scoreEmpty);
  });

  it('values creatures on battlefield', () => {
    const state1 = createTestState();

    const state2 = createTestState();
    addCard(state2, 'creature1', 'p1', 'battlefield', {
      card_types: ['creature'],
      power: 3,
      toughness: 3,
    });

    const scoreEmpty = evaluatePlayerPosition(state1, 'p1');
    const scoreCreature = evaluatePlayerPosition(state2, 'p1');

    expect(scoreCreature).toBeGreaterThan(scoreEmpty);
  });
});

describe('evaluateGameState', () => {
  it('considers opponent positions', () => {
    const state = createTestState();

    // Give p2 a big creature
    addCard(state, 'bigCreature', 'p2', 'battlefield', {
      card_types: ['creature'],
      power: 10,
      toughness: 10,
    });

    const scoreWithBigOpponent = evaluateGameState(state, 'p1');

    // Remove opponent creature
    state.cards.delete('bigCreature');
    const scoreWithoutOpponent = evaluateGameState(state, 'p1');

    // Score should be better when opponent doesn't have the creature
    expect(scoreWithoutOpponent).toBeGreaterThan(scoreWithBigOpponent);
  });
});

describe('evaluateAction', () => {
  it('scores PlayLand positively', () => {
    const state = createTestState();
    addCard(state, 'forest1', 'p1', 'hand', {
      card_types: ['land'],
      type_line: 'Basic Land — Forest',
    });

    const action: AIAction = { kind: 'PlayLand', cardInstanceId: 'forest1' };
    const evaluation = evaluateAction(state, 'p1', action);

    expect(evaluation.score).toBeGreaterThan(0);
    expect(evaluation.action).toBe(action);
  });

  it('scores CastSpell based on mana value', () => {
    const state = createTestState();

    addCard(state, 'cheap', 'p1', 'hand', {
      card_types: ['creature'],
      mana_cost: '{G}',
      cmc: 1,
      power: 1,
      toughness: 1,
    });

    addCard(state, 'expensive', 'p1', 'hand', {
      card_types: ['creature'],
      mana_cost: '{4}{G}{G}',
      cmc: 6,
      power: 6,
      toughness: 6,
    });

    const cheapAction: AIAction = { kind: 'CastSpell', cardInstanceId: 'cheap', targets: [] };
    const expensiveAction: AIAction = { kind: 'CastSpell', cardInstanceId: 'expensive', targets: [] };

    const cheapScore = evaluateAction(state, 'p1', cheapAction).score;
    const expensiveScore = evaluateAction(state, 'p1', expensiveAction).score;

    expect(expensiveScore).toBeGreaterThan(cheapScore);
  });

  it('scores PassPriority negatively', () => {
    const state = createTestState();

    const action: AIAction = { kind: 'PassPriority' };
    const evaluation = evaluateAction(state, 'p1', action);

    expect(evaluation.score).toBeLessThan(0);
  });

  it('scores attacking with damage potential', () => {
    const state = createTestState({
      phase: 'combat',
      step: 'declare_attackers',
    });

    addCard(state, 'attacker', 'p1', 'battlefield', {
      card_types: ['creature'],
      power: 5,
      toughness: 5,
    });

    const attackAction: AIAction = {
      kind: 'DeclareAttackers',
      attacks: [{ cardInstanceId: 'attacker', defendingPlayerId: 'p2' }],
    };
    const noAttackAction: AIAction = { kind: 'DeclareAttackers', attacks: [] };

    const attackScore = evaluateAction(state, 'p1', attackAction).score;
    const noAttackScore = evaluateAction(state, 'p1', noAttackAction).score;

    expect(attackScore).toBeGreaterThan(noAttackScore);
  });
});

describe('evaluateActions', () => {
  it('returns actions sorted by score', () => {
    const state = createTestState();

    const actions: AIAction[] = [
      { kind: 'PassPriority' },
      { kind: 'PlayLand', cardInstanceId: 'forest1' },
    ];

    addCard(state, 'forest1', 'p1', 'hand', {
      card_types: ['land'],
      type_line: 'Basic Land — Forest',
    });

    const evaluations = evaluateActions(state, 'p1', actions);

    // PlayLand should be ranked higher than PassPriority
    expect(evaluations[0].action.kind).toBe('PlayLand');
    expect(evaluations[1].action.kind).toBe('PassPriority');
  });
});

describe('getBestAction', () => {
  it('returns null for empty actions list', () => {
    const state = createTestState();
    const best = getBestAction(state, 'p1', []);
    expect(best).toBeNull();
  });

  it('returns highest scored action', () => {
    const state = createTestState();

    addCard(state, 'forest1', 'p1', 'hand', {
      card_types: ['land'],
      type_line: 'Basic Land — Forest',
    });

    const actions: AIAction[] = [
      { kind: 'PassPriority' },
      { kind: 'PlayLand', cardInstanceId: 'forest1' },
    ];

    const best = getBestAction(state, 'p1', actions);
    expect(best?.kind).toBe('PlayLand');
  });
});
