import { describe, it, expect } from 'vitest';
import type {
  AIAction,
  CastSpellAction,
  PlayLandAction,
  ActivateManaAbilityAction,
  ManualUntapManaSourceAction,
  ManualAdjustCountersAction,
  ManualAdjustPlayerCounterAction,
  ManualCreateTokenAction,
  DeclareAttackersAction,
  DeclareBlockersAction,
  PassPriorityAction,
  AIDifficulty,
  AIPlayerConfig,
  ActionEvaluation,
} from './types';

describe('AI Types', () => {
  it('creates CastSpellAction correctly', () => {
    const action: CastSpellAction = {
      kind: 'CastSpell',
      cardInstanceId: 'card_1',
      targets: ['target_1', 'target_2'],
    };

    expect(action.kind).toBe('CastSpell');
    expect(action.cardInstanceId).toBe('card_1');
    expect(action.targets).toEqual(['target_1', 'target_2']);
  });

  it('creates PlayLandAction correctly', () => {
    const action: PlayLandAction = {
      kind: 'PlayLand',
      cardInstanceId: 'land_1',
    };

    expect(action.kind).toBe('PlayLand');
    expect(action.cardInstanceId).toBe('land_1');
  });

  it('creates ActivateManaAbilityAction correctly', () => {
    const action: ActivateManaAbilityAction = {
      kind: 'ActivateManaAbility',
      cardInstanceId: 'land_1',
      color: 'G',
    };

    expect(action.kind).toBe('ActivateManaAbility');
    expect(action.cardInstanceId).toBe('land_1');
    expect(action.color).toBe('G');
  });

  it('creates ManualUntapManaSourceAction correctly', () => {
    const action: ManualUntapManaSourceAction = {
      kind: 'ManualUntapManaSource',
      cardInstanceId: 'land_1',
      color: 'G',
      amount: 1,
    };

    expect(action.kind).toBe('ManualUntapManaSource');
    expect(action.cardInstanceId).toBe('land_1');
    expect(action.color).toBe('G');
    expect(action.amount).toBe(1);
  });

  it('creates ManualAdjustCountersAction correctly', () => {
    const action: ManualAdjustCountersAction = {
      kind: 'ManualAdjustCounters',
      cardInstanceId: 'creature_1',
      counterType: '+1/+1',
      delta: 1,
    };

    expect(action.kind).toBe('ManualAdjustCounters');
    expect(action.cardInstanceId).toBe('creature_1');
    expect(action.counterType).toBe('+1/+1');
    expect(action.delta).toBe(1);
  });

  it('creates ManualCreateTokenAction correctly', () => {
    const action: ManualCreateTokenAction = {
      kind: 'ManualCreateToken',
      name: 'Goblin',
      count: 2,
      power: 1,
      toughness: 1,
      colors: ['R'],
      types: ['creature'],
      subtypes: ['Goblin'],
      keywords: [],
    };

    expect(action.kind).toBe('ManualCreateToken');
    expect(action.name).toBe('Goblin');
    expect(action.count).toBe(2);
    expect(action.subtypes).toEqual(['Goblin']);
  });

  it('creates ManualAdjustPlayerCounterAction correctly', () => {
    const action: ManualAdjustPlayerCounterAction = {
      kind: 'ManualAdjustPlayerCounter',
      playerId: 'player_1',
      counterType: 'experience',
      delta: 1,
    };

    expect(action.kind).toBe('ManualAdjustPlayerCounter');
    expect(action.playerId).toBe('player_1');
    expect(action.counterType).toBe('experience');
    expect(action.delta).toBe(1);
  });

  it('creates DeclareAttackersAction correctly', () => {
    const action: DeclareAttackersAction = {
      kind: 'DeclareAttackers',
      attacks: [
        { cardInstanceId: 'creature_1', defendingPlayerId: 'player_2' },
        { cardInstanceId: 'creature_2', defendingPlayerId: 'player_3' },
      ],
    };

    expect(action.kind).toBe('DeclareAttackers');
    expect(action.attacks).toHaveLength(2);
    expect(action.attacks[0].cardInstanceId).toBe('creature_1');
    expect(action.attacks[1].defendingPlayerId).toBe('player_3');
  });

  it('creates DeclareBlockersAction correctly', () => {
    const action: DeclareBlockersAction = {
      kind: 'DeclareBlockers',
      blocks: [
        { cardInstanceId: 'blocker_1', blockingAttackerId: 'attacker_1' },
      ],
    };

    expect(action.kind).toBe('DeclareBlockers');
    expect(action.blocks).toHaveLength(1);
    expect(action.blocks[0].cardInstanceId).toBe('blocker_1');
  });

  it('creates PassPriorityAction correctly', () => {
    const action: PassPriorityAction = {
      kind: 'PassPriority',
    };

    expect(action.kind).toBe('PassPriority');
  });

  it('AIAction union accepts all action types', () => {
    const actions: AIAction[] = [
      { kind: 'CastSpell', cardInstanceId: 'c1', targets: [] },
      { kind: 'PlayLand', cardInstanceId: 'l1' },
      { kind: 'ActivateManaAbility', cardInstanceId: 'l1', color: 'U' },
      { kind: 'ManualUntapManaSource', cardInstanceId: 'l1', color: 'U', amount: 1 },
      { kind: 'ManualAdjustCounters', cardInstanceId: 'c1', counterType: '+1/+1', delta: 1 },
      { kind: 'ManualAdjustPlayerCounter', playerId: 'p1', counterType: 'experience', delta: 1 },
      { kind: 'ManualCreateToken', name: 'Treasure', count: 1, power: 0, toughness: 0, colors: [], types: ['artifact'], subtypes: ['Treasure'] },
      { kind: 'DeclareAttackers', attacks: [] },
      { kind: 'DeclareBlockers', blocks: [] },
      { kind: 'PassPriority' },
    ];

    expect(actions).toHaveLength(10);
    expect(actions.map(a => a.kind)).toEqual([
      'CastSpell',
      'PlayLand',
      'ActivateManaAbility',
      'ManualUntapManaSource',
      'ManualAdjustCounters',
      'ManualAdjustPlayerCounter',
      'ManualCreateToken',
      'DeclareAttackers',
      'DeclareBlockers',
      'PassPriority',
    ]);
  });

  it('AIDifficulty represents valid bracket levels', () => {
    const difficulties: AIDifficulty[] = [1, 2, 3, 4, 5];
    expect(difficulties).toHaveLength(5);
  });

  it('creates AIPlayerConfig correctly', () => {
    const config: AIPlayerConfig = {
      playerId: 'ai_player_1',
      difficulty: 3,
    };

    expect(config.playerId).toBe('ai_player_1');
    expect(config.difficulty).toBe(3);
  });

  it('creates ActionEvaluation correctly', () => {
    const evaluation: ActionEvaluation = {
      action: { kind: 'PassPriority' },
      score: 0.5,
      reasoning: 'No beneficial actions available',
    };

    expect(evaluation.action.kind).toBe('PassPriority');
    expect(evaluation.score).toBe(0.5);
    expect(evaluation.reasoning).toBe('No beneficial actions available');
  });

  it('ActionEvaluation works without optional reasoning', () => {
    const evaluation: ActionEvaluation = {
      action: { kind: 'CastSpell', cardInstanceId: 'c1', targets: [] },
      score: 8.5,
    };

    expect(evaluation.score).toBe(8.5);
    expect(evaluation.reasoning).toBeUndefined();
  });
});
