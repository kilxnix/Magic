import { describe, it, expect } from 'vitest';
import {
  assessPlayerThreat,
  assessAllThreats,
  getArchenemy,
  hasArchenemy,
  getNormalizedThreat,
} from './threat';
import { GameState, CardDefinition, createPlayer, Phase, Step } from '../types';

// Helper to create minimal game state
function createTestState(playerCount: number = 4): GameState {
  const players = [];
  for (let i = 1; i <= playerCount; i++) {
    players.push({ ...createPlayer(`p${i}`, `Player ${i}`), hasPriority: i === 1 });
  }

  return {
    players,
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as Phase,
    step: 'upkeep' as Step,
    turnNumber: 1,
    hasPriorityPassed: players.map(() => false),
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// Helper to add a card
function addCard(
  state: GameState,
  instanceId: string,
  ownerId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard' | 'command',
  def: Partial<CardDefinition>,
  options: { tapped?: boolean; isCommander?: boolean } = {},
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
    damage: 0,
    isCommander: options.isCommander ?? false,
  });

  if (options.isCommander) {
    const player = state.players.find(p => p.id === ownerId);
    if (player) {
      player.commanderInstanceId = instanceId;
    }
  }
}

describe('assessPlayerThreat', () => {
  it('returns 0 for self', () => {
    const state = createTestState(4);
    const assessment = assessPlayerThreat(state, 'p1', 'p1');

    expect(assessment.threatScore).toBe(0);
    expect(assessment.reasons).toContain('Self');
  });

  it('returns 0 for eliminated player', () => {
    const state = createTestState(4);
    state.players[1].hasLost = true;

    const assessment = assessPlayerThreat(state, 'p2', 'p1');

    expect(assessment.threatScore).toBe(0);
    expect(assessment.reasons).toContain('Player eliminated');
  });

  it('higher life means higher threat', () => {
    const state = createTestState(4);
    state.players[1].life = 40;
    state.players[2].life = 20;

    const threat40 = assessPlayerThreat(state, 'p2', 'p1');
    const threat20 = assessPlayerThreat(state, 'p3', 'p1');

    expect(threat40.threatScore).toBeGreaterThan(threat20.threatScore);
  });

  it('more creatures means higher threat', () => {
    const state = createTestState(4);

    // Give p2 many creatures
    for (let i = 0; i < 5; i++) {
      addCard(state, `creature_p2_${i}`, 'p2', 'battlefield', {
        name: `Bear ${i}`,
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      });
    }

    // Give p3 one creature
    addCard(state, 'creature_p3_0', 'p3', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    const threatMany = assessPlayerThreat(state, 'p2', 'p1');
    const threatFew = assessPlayerThreat(state, 'p3', 'p1');

    expect(threatMany.threatScore).toBeGreaterThan(threatFew.threatScore);
    expect(threatMany.reasons.some(r => r.includes('creatures'))).toBe(true);
  });

  it('higher power creatures means higher threat', () => {
    const state = createTestState(4);

    // Give p2 a big creature
    addCard(state, 'big_creature', 'p2', 'battlefield', {
      name: 'Giant',
      card_types: ['creature'],
      power: 10,
      toughness: 10,
    });

    // Give p3 a small creature
    addCard(state, 'small_creature', 'p3', 'battlefield', {
      name: 'Squirrel',
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    });

    const threatBig = assessPlayerThreat(state, 'p2', 'p1');
    const threatSmall = assessPlayerThreat(state, 'p3', 'p1');

    expect(threatBig.threatScore).toBeGreaterThan(threatSmall.threatScore);
    expect(threatBig.reasons.some(r => r.includes('power'))).toBe(true);
  });

  it('cards in hand increase threat', () => {
    const state = createTestState(4);

    // Give p2 many cards
    for (let i = 0; i < 7; i++) {
      addCard(state, `card_p2_${i}`, 'p2', 'hand', {
        name: `Card ${i}`,
        card_types: ['instant'],
      });
    }

    const threatFull = assessPlayerThreat(state, 'p2', 'p1');
    const threatEmpty = assessPlayerThreat(state, 'p3', 'p1');

    expect(threatFull.threatScore).toBeGreaterThan(threatEmpty.threatScore);
    expect(threatFull.reasons.some(r => r.includes('hand'))).toBe(true);
  });

  it('commander damage dealt increases threat', () => {
    const state = createTestState(4);

    // Set up commander for p2
    addCard(state, 'commander_p2', 'p2', 'battlefield', {
      name: 'Commander',
      card_types: ['creature'],
      power: 5,
      toughness: 5,
    }, { isCommander: true });

    // p2 has dealt commander damage to p1
    state.players[0].commanderDamage = { commander_p2: 15 };

    const threat = assessPlayerThreat(state, 'p2', 'p1');

    expect(threat.reasons.some(r => r.includes('Commander damage'))).toBe(true);
  });

  it('commander on battlefield increases threat', () => {
    const state = createTestState(4);

    // p2 has commander on battlefield
    addCard(state, 'commander_p2', 'p2', 'battlefield', {
      name: 'Commander',
      card_types: ['creature'],
      power: 4,
      toughness: 4,
    }, { isCommander: true });

    // p3 has commander in command zone
    addCard(state, 'commander_p3', 'p3', 'command', {
      name: 'Commander',
      card_types: ['creature'],
      power: 4,
      toughness: 4,
    }, { isCommander: true });

    const threatOnField = assessPlayerThreat(state, 'p2', 'p1');
    const threatInZone = assessPlayerThreat(state, 'p3', 'p1');

    expect(threatOnField.threatScore).toBeGreaterThan(threatInZone.threatScore);
    expect(threatOnField.reasons.some(r => r.includes('Commander on battlefield'))).toBe(true);
  });

  it('open mana increases threat', () => {
    const state = createTestState(4);

    // Give p2 many untapped lands
    for (let i = 0; i < 6; i++) {
      addCard(state, `land_p2_${i}`, 'p2', 'battlefield', {
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        card_types: ['land'],
      });
    }

    // Give p3 tapped lands
    for (let i = 0; i < 6; i++) {
      addCard(state, `land_p3_${i}`, 'p3', 'battlefield', {
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        card_types: ['land'],
      }, { tapped: true });
    }

    const threatOpen = assessPlayerThreat(state, 'p2', 'p1');
    const threatTapped = assessPlayerThreat(state, 'p3', 'p1');

    expect(threatOpen.threatScore).toBeGreaterThan(threatTapped.threatScore);
    expect(threatOpen.reasons.some(r => r.includes('mana'))).toBe(true);
  });
});

describe('assessAllThreats', () => {
  it('returns assessments sorted by threat descending', () => {
    const state = createTestState(4);

    // Make p3 most threatening (high life, many creatures)
    state.players[2].life = 50;
    for (let i = 0; i < 5; i++) {
      addCard(state, `creature_p3_${i}`, 'p3', 'battlefield', {
        name: 'Bear',
        card_types: ['creature'],
        power: 3,
        toughness: 3,
      });
    }

    // Make p4 moderately threatening
    state.players[3].life = 30;

    // Make p2 least threatening
    state.players[1].life = 15;

    const threats = assessAllThreats(state, 'p1');

    expect(threats.length).toBe(3); // 3 opponents
    expect(threats[0].playerId).toBe('p3'); // Most threatening
    expect(threats[0].threatScore).toBeGreaterThan(threats[1].threatScore);
    expect(threats[1].threatScore).toBeGreaterThan(threats[2].threatScore);
  });

  it('excludes self from assessments', () => {
    const state = createTestState(4);
    const threats = assessAllThreats(state, 'p1');

    const ids = threats.map(t => t.playerId);
    expect(ids).not.toContain('p1');
  });

  it('excludes eliminated players', () => {
    const state = createTestState(4);
    state.players[1].hasLost = true;

    const threats = assessAllThreats(state, 'p1');

    const ids = threats.map(t => t.playerId);
    expect(ids).not.toContain('p2');
    expect(threats.length).toBe(2);
  });
});

describe('getArchenemy', () => {
  it('returns highest threat player', () => {
    const state = createTestState(4);

    // Make p3 most threatening
    state.players[2].life = 50;
    for (let i = 0; i < 8; i++) {
      addCard(state, `creature_p3_${i}`, 'p3', 'battlefield', {
        name: 'Dragon',
        card_types: ['creature'],
        power: 5,
        toughness: 5,
      });
    }

    const archenemy = getArchenemy(state, 'p1');

    expect(archenemy).not.toBeNull();
    expect(archenemy!.playerId).toBe('p3');
  });

  it('returns null when no opponents', () => {
    const state = createTestState(2);
    state.players[1].hasLost = true;

    const archenemy = getArchenemy(state, 'p1');
    expect(archenemy).toBeNull();
  });
});

describe('hasArchenemy', () => {
  it('returns true when one player is significantly ahead', () => {
    const state = createTestState(4);

    // Make p3 much more threatening
    state.players[2].life = 40;
    for (let i = 0; i < 10; i++) {
      addCard(state, `creature_p3_${i}`, 'p3', 'battlefield', {
        name: 'Giant',
        card_types: ['creature'],
        power: 5,
        toughness: 5,
      });
    }

    // Others are weak
    state.players[1].life = 20;
    state.players[3].life = 20;

    expect(hasArchenemy(state, 'p1')).toBe(true);
  });

  it('returns false when threats are balanced', () => {
    const state = createTestState(4);

    // All players have similar threat levels
    for (let p = 2; p <= 4; p++) {
      state.players[p - 1].life = 35;
      addCard(state, `creature_p${p}`, `p${p}`, 'battlefield', {
        name: 'Bear',
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      });
    }

    expect(hasArchenemy(state, 'p1')).toBe(false);
  });
});

describe('getNormalizedThreat', () => {
  it('returns 1.0 for highest threat', () => {
    const state = createTestState(4);

    // Make p3 most threatening
    state.players[2].life = 50;
    for (let i = 0; i < 5; i++) {
      addCard(state, `creature_p3_${i}`, 'p3', 'battlefield', {
        name: 'Bear',
        card_types: ['creature'],
        power: 3,
        toughness: 3,
      });
    }

    const normalized = getNormalizedThreat(state, 'p3', 'p1');
    expect(normalized).toBe(1.0);
  });

  it('returns value between 0 and 1 for other players', () => {
    const state = createTestState(4);

    // Make p3 most threatening
    state.players[2].life = 50;

    // p2 is less threatening
    state.players[1].life = 20;

    const normalized = getNormalizedThreat(state, 'p2', 'p1');
    expect(normalized).toBeGreaterThan(0);
    expect(normalized).toBeLessThan(1);
  });

  it('returns 0 for non-existent player', () => {
    const state = createTestState(4);
    const normalized = getNormalizedThreat(state, 'nonexistent', 'p1');
    expect(normalized).toBe(0);
  });
});
