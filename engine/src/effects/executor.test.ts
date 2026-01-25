import { describe, it, expect } from 'vitest';
import { executeEffects, executeEffectsWithSBA } from './executor';
import type { Effect } from './ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

function createTestState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  // Add a creature to the battlefield
  cards.set('creature-1', {
    instanceId: 'creature-1',
    definitionId: 'def-creature',
    ownerId: 'player-1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-creature', {
    id: 'def-creature',
    name: 'Test Creature',
    type_line: 'Creature — Test',
    oracle_text: '',
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: 3,
    toughness: 3,
    card_types: ['creature'],
  });

  // Add cards to library
  for (let i = 1; i <= 5; i++) {
    cards.set(`lib-card-${i}`, {
      instanceId: `lib-card-${i}`,
      definitionId: 'def-generic',
      ownerId: 'player-1',
      zone: 'library',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
  }

  cardDefinitions.set('def-generic', {
    id: 'def-generic',
    name: 'Generic Card',
    type_line: 'Instant',
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['instant'],
  });

  return {
    players: [
      {
        id: 'player-1',
        name: 'Player 1',
        life: 40,
        commanderDamage: {},
        commanderTax: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'player-2',
        name: 'Player 2',
        life: 40,
        commanderDamage: {},
        commanderTax: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
  };
}

describe('executeEffects', () => {
  describe('Draw effect', () => {
    it('moves cards from library to hand', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'Draw', player: { kind: 'Controller' }, count: 2 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // Count cards in hand for player-1
      let handCount = 0;
      for (const [, card] of newState.cards) {
        if (card.ownerId === 'player-1' && card.zone === 'hand') {
          handCount++;
        }
      }
      expect(handCount).toBe(2);
    });

    it('draws specified number of cards', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'Draw', player: { kind: 'Controller' }, count: 3 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      let handCount = 0;
      for (const [, card] of newState.cards) {
        if (card.ownerId === 'player-1' && card.zone === 'hand') {
          handCount++;
        }
      }
      expect(handCount).toBe(3);
    });
  });

  describe('Destroy effect', () => {
    it('moves creature to graveyard', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'Destroy', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-2',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      const creature = newState.cards.get('creature-1');
      expect(creature?.zone).toBe('graveyard');
    });

    it('does nothing if target not on battlefield', () => {
      const state = createTestState();
      // Move creature to graveyard first
      const cards = new Map(state.cards);
      const creature = cards.get('creature-1')!;
      cards.set('creature-1', { ...creature, zone: 'graveyard' });
      const modifiedState = { ...state, cards };

      const effects: Effect[] = [
        { kind: 'Destroy', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(
        modifiedState,
        effects,
        'player-2',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      // Should still be in graveyard (no change)
      expect(newState.cards.get('creature-1')?.zone).toBe('graveyard');
    });
  });

  describe('DealDamage effect', () => {
    it('deals damage to player (reduces life)', () => {
      const state = createTestState();
      const effects: Effect[] = [
        {
          kind: 'DealDamage',
          source: { kind: 'ThisSpell' },
          target: { kind: 'Chosen', targetId: 'target_1' },
          amount: 3,
        },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-1',
        ['player-2'],
        [{ id: 'target_1' }],
      );

      expect(newState.players[1].life).toBe(37);
    });

    it('deals damage to creature (marks damage)', () => {
      const state = createTestState();
      const effects: Effect[] = [
        {
          kind: 'DealDamage',
          source: { kind: 'ThisSpell' },
          target: { kind: 'Chosen', targetId: 'target_1' },
          amount: 2,
        },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      expect(newState.cards.get('creature-1')?.damage).toBe(2);
    });
  });

  describe('GainLife effect', () => {
    it('increases player life', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'GainLife', player: { kind: 'Controller' }, amount: 5 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      expect(newState.players[0].life).toBe(45);
    });
  });

  describe('LoseLife effect', () => {
    it('decreases player life', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'LoseLife', player: { kind: 'Controller' }, amount: 3 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      expect(newState.players[0].life).toBe(37);
    });
  });
});

describe('executeEffectsWithSBA', () => {
  it('kills creature with lethal damage after effects', () => {
    const state = createTestState();
    const effects: Effect[] = [
      {
        kind: 'DealDamage',
        source: { kind: 'ThisSpell' },
        target: { kind: 'Chosen', targetId: 'target_1' },
        amount: 3,
      },
    ];

    const newState = executeEffectsWithSBA(
      state,
      effects,
      'player-1',
      ['creature-1'],
      [{ id: 'target_1' }],
    );

    // 3/3 creature takes 3 damage -> dies via SBA
    expect(newState.cards.get('creature-1')?.zone).toBe('graveyard');
  });

  it('marks player as lost when life drops to 0', () => {
    const state = createTestState();
    // Set player 2 to 3 life
    const modifiedPlayers = state.players.map((p, i) =>
      i === 1 ? { ...p, life: 3 } : p
    );
    const modifiedState = { ...state, players: modifiedPlayers };

    const effects: Effect[] = [
      {
        kind: 'DealDamage',
        source: { kind: 'ThisSpell' },
        target: { kind: 'Chosen', targetId: 'target_1' },
        amount: 3,
      },
    ];

    const newState = executeEffectsWithSBA(
      modifiedState,
      effects,
      'player-1',
      ['player-2'],
      [{ id: 'target_1' }],
    );

    expect(newState.players[1].life).toBe(0);
    expect(newState.players[1].hasLost).toBe(true);
  });
});
