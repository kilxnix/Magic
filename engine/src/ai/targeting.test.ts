import { describe, it, expect } from 'vitest';
import {
  scoreRemovalTarget,
  scoreDamageTarget,
  scoreCreatureDamageTarget,
  selectRemovalTargets,
  selectDamageTargets,
  selectTargetsForSpell,
  selectBestAttackTarget,
} from './targeting';
import { GameState, CardDefinition, createPlayer, Phase, Step } from '../types';
import type { TargetSpec } from '../effects/targets';

// Helper to create minimal game state
function createTestState(overrides: Partial<GameState> = {}): GameState {
  const players = [
    { ...createPlayer('p1', 'Player 1'), hasPriority: true },
    { ...createPlayer('p2', 'Player 2'), hasPriority: false },
    { ...createPlayer('p3', 'Player 3'), hasPriority: false },
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
    hasPriorityPassed: [false, false, false],
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
  options: { isCommander?: boolean; tapped?: boolean; damage?: number } = {},
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
    tapped: options.tapped ?? false,
    summoningSick: zone === 'battlefield',
    counters: {},
    damage: options.damage ?? 0,
    isCommander: options.isCommander ?? false,
  });
}

describe('scoreRemovalTarget', () => {
  it('scores opponent creatures positively', () => {
    const state = createTestState();

    addCard(state, 'opponentCreature', 'p2', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
      keywords: [],
    });

    const card = state.cards.get('opponentCreature')!;
    const score = scoreRemovalTarget(state, card, 'p1');

    expect(score).toBeGreaterThan(0);
  });

  it('scores own creatures very negatively', () => {
    const state = createTestState();

    addCard(state, 'ownCreature', 'p1', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
      keywords: [],
    });

    const card = state.cards.get('ownCreature')!;
    const score = scoreRemovalTarget(state, card, 'p1');

    expect(score).toBeLessThan(0);
  });

  it('prioritizes bigger threats', () => {
    const state = createTestState();

    addCard(state, 'small', 'p2', 'battlefield', {
      name: 'Squirrel',
      card_types: ['creature'],
      power: 1,
      toughness: 1,
      keywords: [],
    });

    addCard(state, 'big', 'p2', 'battlefield', {
      name: 'Dragon',
      card_types: ['creature'],
      power: 6,
      toughness: 6,
      keywords: ['Flying'],
    });

    const smallScore = scoreRemovalTarget(state, state.cards.get('small')!, 'p1');
    const bigScore = scoreRemovalTarget(state, state.cards.get('big')!, 'p1');

    expect(bigScore).toBeGreaterThan(smallScore);
  });

  it('prioritizes commanders', () => {
    const state = createTestState();

    addCard(state, 'regular', 'p2', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 4,
      toughness: 4,
      keywords: [],
    });

    addCard(state, 'commander', 'p2', 'battlefield', {
      name: 'Commander Bear',
      card_types: ['creature'],
      power: 4,
      toughness: 4,
      keywords: [],
    }, { isCommander: true });

    const regularScore = scoreRemovalTarget(state, state.cards.get('regular')!, 'p1');
    const commanderScore = scoreRemovalTarget(state, state.cards.get('commander')!, 'p1');

    expect(commanderScore).toBeGreaterThan(regularScore);
  });
});

describe('scoreDamageTarget', () => {
  it('scores opponent positively', () => {
    const state = createTestState();
    const p2 = state.players.find(p => p.id === 'p2')!;

    const score = scoreDamageTarget(state, p2, 'p1', 3);
    expect(score).toBeGreaterThan(0);
  });

  it('scores self very negatively', () => {
    const state = createTestState();
    const p1 = state.players.find(p => p.id === 'p1')!;

    const score = scoreDamageTarget(state, p1, 'p1', 3);
    expect(score).toBeLessThan(0);
  });

  it('prioritizes lethal damage', () => {
    const state = createTestState();
    state.players[1].life = 3; // p2 at 3 life
    state.players[2].life = 40; // p3 at full

    const p2 = state.players.find(p => p.id === 'p2')!;
    const p3 = state.players.find(p => p.id === 'p3')!;

    const lowLifeScore = scoreDamageTarget(state, p2, 'p1', 3);
    const highLifeScore = scoreDamageTarget(state, p3, 'p1', 3);

    expect(lowLifeScore).toBeGreaterThan(highLifeScore);
  });

  it('scores eliminated players very negatively', () => {
    const state = createTestState();
    state.players[1].hasLost = true;
    const p2 = state.players.find(p => p.id === 'p2')!;

    const score = scoreDamageTarget(state, p2, 'p1', 3);
    expect(score).toBeLessThan(0);
  });
});

describe('scoreCreatureDamageTarget', () => {
  it('prefers creatures that will die', () => {
    const state = createTestState();

    addCard(state, 'small', 'p2', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
      keywords: [],
    });

    addCard(state, 'big', 'p2', 'battlefield', {
      name: 'Giant',
      card_types: ['creature'],
      power: 4,
      toughness: 6,
      keywords: [],
    });

    // 3 damage kills the 2 toughness creature but not the 6 toughness one
    const smallScore = scoreCreatureDamageTarget(state, state.cards.get('small')!, 'p1', 3);
    const bigScore = scoreCreatureDamageTarget(state, state.cards.get('big')!, 'p1', 3);

    expect(smallScore).toBeGreaterThan(bigScore);
  });

  it('considers existing damage', () => {
    const state = createTestState();

    addCard(state, 'damaged', 'p2', 'battlefield', {
      name: 'Giant',
      card_types: ['creature'],
      power: 4,
      toughness: 6,
      keywords: [],
    }, { damage: 4 }); // 4 damage already, 2 remaining toughness

    addCard(state, 'fresh', 'p2', 'battlefield', {
      name: 'Giant',
      card_types: ['creature'],
      power: 4,
      toughness: 6,
      keywords: [],
    });

    // 2 damage kills the damaged one but not the fresh one
    const damagedScore = scoreCreatureDamageTarget(state, state.cards.get('damaged')!, 'p1', 2);
    const freshScore = scoreCreatureDamageTarget(state, state.cards.get('fresh')!, 'p1', 2);

    expect(damagedScore).toBeGreaterThan(freshScore);
  });
});

describe('selectRemovalTargets', () => {
  it('selects highest value target', () => {
    const state = createTestState();

    addCard(state, 'small', 'p2', 'battlefield', {
      name: 'Squirrel',
      card_types: ['creature'],
      power: 1,
      toughness: 1,
      keywords: [],
    });

    addCard(state, 'big', 'p2', 'battlefield', {
      name: 'Dragon',
      card_types: ['creature'],
      power: 6,
      toughness: 6,
      keywords: ['Flying'],
    });

    const spec: TargetSpec = { id: 't1', type: 'Creature', count: 1 };
    const result = selectRemovalTargets(state, 'p1', spec);

    expect(result.targets).toEqual(['big']);
    expect(result.reasoning).toContain('Dragon');
  });

  it('returns empty when no legal targets', () => {
    const state = createTestState();

    const spec: TargetSpec = { id: 't1', type: 'Creature', count: 1 };
    const result = selectRemovalTargets(state, 'p1', spec);

    expect(result.targets).toEqual([]);
    expect(result.reasoning).toContain('No legal targets');
  });
});

describe('selectDamageTargets', () => {
  it('selects player when damage would be lethal', () => {
    const state = createTestState();
    state.players[1].life = 3; // p2 at 3 life

    // Also add a creature that won't die
    addCard(state, 'big', 'p2', 'battlefield', {
      name: 'Giant',
      card_types: ['creature'],
      power: 4,
      toughness: 6,
      keywords: [],
    });

    const spec: TargetSpec = { id: 't1', type: 'Any', count: 1 };
    const result = selectDamageTargets(state, 'p1', spec, 3);

    // Should prefer the player since it's lethal
    expect(result.targets).toContain('p2');
  });

  it('selects creature when it would die', () => {
    const state = createTestState();

    addCard(state, 'small', 'p2', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
      keywords: [],
    });

    const spec: TargetSpec = { id: 't1', type: 'Creature', count: 1 };
    const result = selectDamageTargets(state, 'p1', spec, 3);

    expect(result.targets).toEqual(['small']);
  });
});

describe('selectTargetsForSpell', () => {
  it('uses removal heuristics for destroy spells', () => {
    const state = createTestState();

    addCard(state, 'murderSpell', 'p1', 'hand', {
      name: 'Murder',
      oracle_text: 'Destroy target creature.',
      card_types: ['instant'],
    });

    addCard(state, 'small', 'p2', 'battlefield', {
      name: 'Squirrel',
      card_types: ['creature'],
      power: 1,
      toughness: 1,
      keywords: [],
    });

    addCard(state, 'big', 'p2', 'battlefield', {
      name: 'Dragon',
      card_types: ['creature'],
      power: 6,
      toughness: 6,
      keywords: ['Flying'],
    });

    const specs: TargetSpec[] = [{ id: 't1', type: 'Creature', count: 1 }];
    const result = selectTargetsForSpell(state, 'p1', 'murderSpell', specs);

    // Should target the bigger threat
    expect(result.targets).toEqual(['big']);
  });

  it('uses damage heuristics for damage spells', () => {
    const state = createTestState();

    addCard(state, 'bolt', 'p1', 'hand', {
      name: 'Lightning Bolt',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      card_types: ['instant'],
      cmc: 1,
    });

    // Player at low life
    state.players[1].life = 3;

    const specs: TargetSpec[] = [{ id: 't1', type: 'Any', count: 1 }];
    const result = selectTargetsForSpell(state, 'p1', 'bolt', specs);

    // Should target the player for lethal
    expect(result.targets).toContain('p2');
  });
});

describe('selectBestAttackTarget', () => {
  it('selects opponent with lowest life', () => {
    const state = createTestState();
    state.players[1].life = 10;
    state.players[2].life = 30;

    addCard(state, 'attacker', 'p1', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
      keywords: [],
    });

    const target = selectBestAttackTarget(state, 'attacker');
    expect(target).toBe('p2');
  });

  it('prioritizes lethal damage', () => {
    const state = createTestState();
    state.players[1].life = 2;
    state.players[2].life = 3;

    addCard(state, 'attacker', 'p1', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
      keywords: [],
    });

    const target = selectBestAttackTarget(state, 'attacker');
    // Should prefer p2 (life = 2) since 2 power is exactly lethal
    expect(target).toBe('p2');
  });

  it('skips eliminated players', () => {
    const state = createTestState();
    state.players[1].life = 1;
    state.players[1].hasLost = true;
    state.players[2].life = 40;

    addCard(state, 'attacker', 'p1', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
      keywords: [],
    });

    const target = selectBestAttackTarget(state, 'attacker');
    expect(target).toBe('p3'); // Can't attack eliminated p2
  });

  it('considers commander damage progress', () => {
    const state = createTestState();
    state.players[1].life = 40;
    state.players[2].life = 40;
    state.players[1].commanderDamage = { commander: 19 }; // 2 more for lethal

    addCard(state, 'commander', 'p1', 'battlefield', {
      name: 'Commander',
      card_types: ['creature'],
      power: 5,
      toughness: 5,
      keywords: [],
    }, { isCommander: true });

    const target = selectBestAttackTarget(state, 'commander');
    // Should prefer p2 since commander damage is close to lethal
    expect(target).toBe('p2');
  });

  it('returns null when no valid targets', () => {
    const state = createTestState();
    state.players[1].hasLost = true;
    state.players[2].hasLost = true;

    addCard(state, 'attacker', 'p1', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
      keywords: [],
    });

    const target = selectBestAttackTarget(state, 'attacker');
    expect(target).toBeNull();
  });
});
