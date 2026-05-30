import { describe, it, expect, beforeEach } from 'vitest';
import { executeEffects, executeEffectsWithSBA, resetTokenCounter } from './executor';
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

  cardDefinitions.set('def-land', {
    id: 'def-land',
    name: 'Test Land',
    type_line: 'Land',
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['land'],
  });

  cardDefinitions.set('def-gold-permanent', {
    id: 'def-gold-permanent',
    name: 'Gold Permanent',
    type_line: 'Creature - Test',
    oracle_text: '',
    mana_cost: '{G}{W}',
    cmc: 2,
    colors: ['G', 'W'],
    color_identity: ['G', 'W'],
    keywords: [],
    power: 2,
    toughness: 2,
    card_types: ['creature'],
  });

  cardDefinitions.set('def-mono-permanent', {
    id: 'def-mono-permanent',
    name: 'Mono Permanent',
    type_line: 'Creature - Test',
    oracle_text: '',
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: 1,
    toughness: 1,
    card_types: ['creature'],
  });

  return {
    players: [
      {
        id: 'player-1',
        name: 'Player 1',
        life: 40,
        poisonCounters: 0,
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
        poisonCounters: 0,
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

    it('deals damage equal to greatest mana value among permanents you control', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      cards.set('gold-1', {
        instanceId: 'gold-1',
        definitionId: 'def-gold-permanent',
        ownerId: 'player-1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });

      const effects: Effect[] = [
        {
          kind: 'DealDamage',
          source: { kind: 'ThisSpell' },
          target: { kind: 'Chosen', targetId: 'target_1' },
          amount: {
            kind: 'GreatestManaValue',
            zone: 'battlefield',
            filter: { permanent: true },
            controller: 'you',
          },
        },
      ];

      const newState = executeEffects(
        { ...state, cards },
        effects,
        'player-1',
        ['player-2'],
        [{ id: 'target_1' }],
      );

      expect(newState.players[1].life).toBe(37);
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

// Phase 10: New effect types
describe('Phase 10 effects', () => {
  beforeEach(() => {
    resetTokenCounter();
  });

  describe('Exile effect', () => {
    it('moves creature to exile zone', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'Exile', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      expect(newState.cards.get('creature-1')?.zone).toBe('exile');
    });

    it('can exile from graveyard', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      const creature = cards.get('creature-1')!;
      cards.set('creature-1', { ...creature, zone: 'graveyard' });
      const modifiedState = { ...state, cards };

      const effects: Effect[] = [
        { kind: 'Exile', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(
        modifiedState,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      expect(newState.cards.get('creature-1')?.zone).toBe('exile');
    });

    it('exiles all multicolored permanents without touching monocolored permanents', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      cards.set('gold-1', {
        instanceId: 'gold-1',
        definitionId: 'def-gold-permanent',
        ownerId: 'player-1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      cards.set('mono-1', {
        instanceId: 'mono-1',
        definitionId: 'def-mono-permanent',
        ownerId: 'player-1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      const modifiedState = { ...state, cards };

      const effects: Effect[] = [
        { kind: 'Exile', target: { kind: 'AllOfType', filter: { multicolored: true } } },
      ];

      const newState = executeEffects(modifiedState, effects, 'player-1', [], []);

      expect(newState.cards.get('gold-1')?.zone).toBe('exile');
      expect(newState.cards.get('mono-1')?.zone).toBe('battlefield');
    });
  });

  describe('ReturnToHand effect', () => {
    it('moves creature from battlefield to hand', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'ReturnToHand', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      const creature = newState.cards.get('creature-1');
      expect(creature?.zone).toBe('hand');
      expect(creature?.tapped).toBe(false);
      expect(creature?.damage).toBe(0);
    });

    it('resets counters when returning to hand', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      const creature = cards.get('creature-1')!;
      cards.set('creature-1', { ...creature, counters: { '+1/+1': 3 } });
      const modifiedState = { ...state, cards };

      const effects: Effect[] = [
        { kind: 'ReturnToHand', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(
        modifiedState,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      expect(newState.cards.get('creature-1')?.counters).toEqual({});
    });

    it('returns commanders to the command zone by default when bounced', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      const commander = cards.get('creature-1')!;
      cards.set('creature-1', { ...commander, isCommander: true });
      const modifiedState = {
        ...state,
        cards,
        players: state.players.map(player =>
          player.id === 'player-1'
            ? { ...player, commanderInstanceId: 'creature-1' }
            : player,
        ),
      };
      const effects: Effect[] = [
        { kind: 'ReturnToHand', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(
        modifiedState,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      expect(newState.cards.get('creature-1')?.zone).toBe('command');
    });
  });

  describe('Mill effect', () => {
    it('moves cards from library to graveyard', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'Mill', player: { kind: 'Controller' }, count: 3 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // Count cards in graveyard for player-1
      let graveyardCount = 0;
      for (const [, card] of newState.cards) {
        if (card.ownerId === 'player-1' && card.zone === 'graveyard') {
          graveyardCount++;
        }
      }
      expect(graveyardCount).toBe(3);
    });

    it('mills only as many cards as available', () => {
      const state = createTestState();
      // Library has 5 cards, try to mill 10
      const effects: Effect[] = [
        { kind: 'Mill', player: { kind: 'Controller' }, count: 10 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      let graveyardCount = 0;
      for (const [, card] of newState.cards) {
        if (card.ownerId === 'player-1' && card.zone === 'graveyard') {
          graveyardCount++;
        }
      }
      expect(graveyardCount).toBe(5);
    });
  });

  describe('AddCounters effect', () => {
    it('adds +1/+1 counters to creature', () => {
      const state = createTestState();
      const effects: Effect[] = [
        {
          kind: 'AddCounters',
          target: { kind: 'Chosen', targetId: 'target_1' },
          counterType: '+1/+1',
          count: 2,
        },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      expect(newState.cards.get('creature-1')?.counters['+1/+1']).toBe(2);
    });

    it('stacks with existing counters', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      const creature = cards.get('creature-1')!;
      cards.set('creature-1', { ...creature, counters: { '+1/+1': 1 } });
      const modifiedState = { ...state, cards };

      const effects: Effect[] = [
        {
          kind: 'AddCounters',
          target: { kind: 'Chosen', targetId: 'target_1' },
          counterType: '+1/+1',
          count: 2,
        },
      ];

      const newState = executeEffects(
        modifiedState,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      expect(newState.cards.get('creature-1')?.counters['+1/+1']).toBe(3);
    });

    it('adds generic player counters such as energy', () => {
      const state = createTestState();
      const effects: Effect[] = [
        {
          kind: 'AddCounters',
          target: { kind: 'Controller' },
          counterType: 'energy',
          count: 2,
        },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      expect(newState.players[0].playerCounters?.energy).toBe(2);
    });
  });

  describe('RemoveCounters effect', () => {
    it('removes counters from creature', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      const creature = cards.get('creature-1')!;
      cards.set('creature-1', { ...creature, counters: { '+1/+1': 3 } });
      const modifiedState = { ...state, cards };

      const effects: Effect[] = [
        {
          kind: 'RemoveCounters',
          target: { kind: 'Chosen', targetId: 'target_1' },
          counterType: '+1/+1',
          count: 2,
        },
      ];

      const newState = executeEffects(
        modifiedState,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      expect(newState.cards.get('creature-1')?.counters['+1/+1']).toBe(1);
    });

    it('removes counter type when count reaches 0', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      const creature = cards.get('creature-1')!;
      cards.set('creature-1', { ...creature, counters: { '+1/+1': 2 } });
      const modifiedState = { ...state, cards };

      const effects: Effect[] = [
        {
          kind: 'RemoveCounters',
          target: { kind: 'Chosen', targetId: 'target_1' },
          counterType: '+1/+1',
          count: 5, // More than available
        },
      ];

      const newState = executeEffects(
        modifiedState,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      expect(newState.cards.get('creature-1')?.counters['+1/+1']).toBeUndefined();
    });
  });

  describe('Tap effect', () => {
    it('taps an untapped creature', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'Tap', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      expect(newState.cards.get('creature-1')?.tapped).toBe(true);
    });
  });

  describe('Untap effect', () => {
    it('untaps a tapped creature', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      const creature = cards.get('creature-1')!;
      cards.set('creature-1', { ...creature, tapped: true });
      const modifiedState = { ...state, cards };

      const effects: Effect[] = [
        { kind: 'Untap', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(
        modifiedState,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      expect(newState.cards.get('creature-1')?.tapped).toBe(false);
    });

    it('untaps only up to the requested number of matching permanents', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      for (let i = 1; i <= 8; i++) {
        cards.set(`land-${i}`, {
          instanceId: `land-${i}`,
          definitionId: 'def-land',
          ownerId: 'player-1',
          zone: 'battlefield',
          tapped: true,
          summoningSick: false,
          counters: {},
          damage: 0,
          isCommander: false,
        });
      }
      const modifiedState = { ...state, cards };

      const effects: Effect[] = [
        { kind: 'Untap', target: { kind: 'AllOfType', filter: { types: ['land'] } }, maxCount: 7 },
      ];

      const newState = executeEffects(modifiedState, effects, 'player-1', [], []);
      const untapped = [...newState.cards.values()]
        .filter(card => card.definitionId === 'def-land' && card.zone === 'battlefield' && !card.tapped);

      expect(untapped).toHaveLength(7);
    });
  });

  describe('Discard effect', () => {
    it('moves cards from hand to graveyard', () => {
      const state = createTestState();
      // Put some cards in hand
      const cards = new Map(state.cards);
      cards.set('hand-card-1', {
        instanceId: 'hand-card-1',
        definitionId: 'def-generic',
        ownerId: 'player-1',
        zone: 'hand',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      cards.set('hand-card-2', {
        instanceId: 'hand-card-2',
        definitionId: 'def-generic',
        ownerId: 'player-1',
        zone: 'hand',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      const modifiedState = { ...state, cards };

      const effects: Effect[] = [
        { kind: 'Discard', player: { kind: 'Controller' }, count: 1 },
      ];

      const newState = executeEffects(modifiedState, effects, 'player-1', [], []);

      let handCount = 0;
      let graveyardCount = 0;
      for (const [, card] of newState.cards) {
        if (card.ownerId === 'player-1' && card.zone === 'hand') handCount++;
        if (card.ownerId === 'player-1' && card.zone === 'graveyard') graveyardCount++;
      }
      expect(handCount).toBe(1);
      expect(graveyardCount).toBe(1);
    });
  });

  describe('CreateToken effect', () => {
    it('creates token creatures on battlefield', () => {
      const state = createTestState();
      const effects: Effect[] = [
        {
          kind: 'CreateToken',
          controller: { kind: 'Controller' },
          token: {
            name: 'Goblin',
            colors: ['R'],
            types: ['creature'],
            subtypes: ['goblin'],
            power: 1,
            toughness: 1,
          },
          count: 2,
        },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // Count tokens on battlefield
      let tokenCount = 0;
      for (const [instanceId, card] of newState.cards) {
        if (instanceId.startsWith('token_inst_') && card.zone === 'battlefield') {
          tokenCount++;
        }
      }
      expect(tokenCount).toBe(2);
    });

    it('creates token definition with correct properties', () => {
      const state = createTestState();
      const effects: Effect[] = [
        {
          kind: 'CreateToken',
          controller: { kind: 'Controller' },
          token: {
            name: 'Spirit',
            colors: ['W'],
            types: ['creature'],
            subtypes: ['spirit'],
            power: 1,
            toughness: 1,
            keywords: ['flying'],
          },
          count: 1,
        },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      const def = newState.cardDefinitions.get('token_spirit');
      expect(def).toBeDefined();
      expect(def?.power).toBe(1);
      expect(def?.toughness).toBe(1);
      expect(def?.keywords).toContain('flying');
    });
  });

  describe('RollD20 effect', () => {
    it('uses the matching outcome and attaches the source to the created token', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      const cardDefinitions = new Map(state.cardDefinitions);

      cards.set('morningstar-1', {
        instanceId: 'morningstar-1',
        definitionId: 'def-morningstar',
        ownerId: 'player-1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      cardDefinitions.set('def-morningstar', {
        id: 'def-morningstar',
        name: 'Goblin Morningstar',
        type_line: 'Artifact â€” Equipment',
        oracle_text: '',
        mana_cost: '{1}{R}',
        cmc: 2,
        colors: [],
        color_identity: ['R'],
        keywords: [],
        card_types: ['artifact'],
        isEquipment: true,
        equipCost: { generic: 2, W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
        equipmentBonus: { power: 1, toughness: 0, keywords: ['Trample'] },
      });

      const modifiedState = { ...state, cards, cardDefinitions };
      const effects: Effect[] = [
        {
          kind: 'RollD20',
          rollOverride: 20,
          outcomes: [
            {
              min: 1,
              max: 9,
              effects: [
                {
                  kind: 'CreateToken',
                  controller: { kind: 'Controller' },
                  token: { name: 'Goblin', colors: ['R'], types: ['creature'], subtypes: ['goblin'], power: 1, toughness: 1 },
                  count: 1,
                },
              ],
            },
            {
              min: 10,
              max: 20,
              effects: [
                {
                  kind: 'CreateToken',
                  controller: { kind: 'Controller' },
                  token: { name: 'Goblin', colors: ['R'], types: ['creature'], subtypes: ['goblin'], power: 1, toughness: 1 },
                  count: 1,
                  attachSourceToCreated: true,
                },
              ],
            },
          ],
        },
      ];

      const newState = executeEffects(modifiedState, effects, 'player-1', [], [], 0, {
        sourceInstanceId: 'morningstar-1',
      });
      const token = [...newState.cards.values()].find(card => card.isToken && card.zone === 'battlefield');
      const morningstar = newState.cards.get('morningstar-1');

      expect(token).toBeDefined();
      expect(morningstar?.attachedTo).toBe(token?.instanceId);
      expect(newState.diceRolls).toEqual([
        expect.objectContaining({
          playerId: 'player-1',
          sourceInstanceId: 'morningstar-1',
          sourceName: 'Goblin Morningstar',
          sides: 20,
          result: 20,
          outcomeMin: 10,
          outcomeMax: 20,
        }),
      ]);
    });
  });

  describe('X cost support', () => {
    it('resolves X amount for damage', () => {
      const state = createTestState();
      const effects: Effect[] = [
        {
          kind: 'DealDamage',
          source: { kind: 'ThisSpell' },
          target: { kind: 'Chosen', targetId: 'target_1' },
          amount: { kind: 'X' },
        },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-1',
        ['player-2'],
        [{ id: 'target_1' }],
        5, // X = 5
      );

      expect(newState.players[1].life).toBe(35);
    });

    it('resolves X amount for draw', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'X' } },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-1',
        [],
        [],
        3, // X = 3
      );

      let handCount = 0;
      for (const [, card] of newState.cards) {
        if (card.ownerId === 'player-1' && card.zone === 'hand') {
          handCount++;
        }
      }
      expect(handCount).toBe(3);
    });

    it('resolves XMultiplied amount', () => {
      const state = createTestState();
      const effects: Effect[] = [
        {
          kind: 'GainLife',
          player: { kind: 'Controller' },
          amount: { kind: 'XMultiplied', multiplier: 2 },
        },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-1',
        [],
        [],
        3, // X = 3, result = 6
      );

      expect(newState.players[0].life).toBe(46);
    });
  });
});

// EachOpponent and AllCreatures tests
describe('EachOpponent and AllCreatures effects', () => {
  function createFourPlayerState(): GameState {
    const cards = new Map<string, CardInstance>();
    const cardDefinitions = new Map<string, CardDefinition>();

    // Creature definition
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

    // Artifact definition (non-creature)
    cardDefinitions.set('def-artifact', {
      id: 'def-artifact',
      name: 'Test Artifact',
      type_line: 'Artifact',
      oracle_text: '',
      mana_cost: '{3}',
      cmc: 3,
      colors: [],
      color_identity: [],
      keywords: [],
      card_types: ['artifact'],
    });

    // Add creatures for each player
    for (let p = 1; p <= 4; p++) {
      cards.set(`creature-p${p}`, {
        instanceId: `creature-p${p}`,
        definitionId: 'def-creature',
        ownerId: `player-${p}`,
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
    }

    // Add an artifact for player 1 (should NOT be destroyed by "destroy all creatures")
    cards.set('artifact-p1', {
      instanceId: 'artifact-p1',
      definitionId: 'def-artifact',
      ownerId: 'player-1',
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });

    // Add hand cards for opponents to discard
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

    for (let p = 1; p <= 4; p++) {
      for (let c = 1; c <= 3; c++) {
        cards.set(`hand-p${p}-${c}`, {
          instanceId: `hand-p${p}-${c}`,
          definitionId: 'def-generic',
          ownerId: `player-${p}`,
          zone: 'hand',
          tapped: false,
          summoningSick: false,
          counters: {},
          damage: 0,
          isCommander: false,
        });
      }
    }

    return {
      players: [
        {
          id: 'player-1',
          name: 'Player 1',
          life: 40,
          poisonCounters: 0,
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
          poisonCounters: 0,
          commanderDamage: {},
          commanderTax: 0,
          manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
          hasPlayedLand: false,
          hasPriority: false,
          hasLost: false,
        },
        {
          id: 'player-3',
          name: 'Player 3',
          life: 40,
          poisonCounters: 0,
          commanderDamage: {},
          commanderTax: 0,
          manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
          hasPlayedLand: false,
          hasPriority: false,
          hasLost: false,
        },
        {
          id: 'player-4',
          name: 'Player 4',
          life: 40,
          poisonCounters: 0,
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
      hasPriorityPassed: [false, false, false, false],
      stack: [],
      combat: null,
    };
  }

  describe('EachOpponent LoseLife', () => {
    it('each opponent loses life in a 4-player game', () => {
      const state = createFourPlayerState();
      const effects: Effect[] = [
        { kind: 'LoseLife', player: { kind: 'EachOpponent' }, amount: 2 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // Caster (player-1) should NOT lose life
      expect(newState.players[0].life).toBe(40);
      // All 3 opponents should lose 2 life
      expect(newState.players[1].life).toBe(38);
      expect(newState.players[2].life).toBe(38);
      expect(newState.players[3].life).toBe(38);
    });

    it('skips opponents who have already lost', () => {
      const state = createFourPlayerState();
      // Mark player-3 as having lost
      const modifiedPlayers = state.players.map(p =>
        p.id === 'player-3' ? { ...p, hasLost: true } : p
      );
      const modifiedState = { ...state, players: modifiedPlayers };

      const effects: Effect[] = [
        { kind: 'LoseLife', player: { kind: 'EachOpponent' }, amount: 3 },
      ];

      const newState = executeEffects(modifiedState, effects, 'player-1', [], []);

      expect(newState.players[0].life).toBe(40); // caster unaffected
      expect(newState.players[1].life).toBe(37); // loses 3
      expect(newState.players[2].life).toBe(40); // already lost, skipped
      expect(newState.players[3].life).toBe(37); // loses 3
    });
  });

  describe('AllCreatures Destroy', () => {
    it('destroys all creatures on the battlefield', () => {
      const state = createFourPlayerState();
      const effects: Effect[] = [
        { kind: 'Destroy', target: { kind: 'AllCreatures' } },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // All 4 creatures should be in graveyard
      for (let p = 1; p <= 4; p++) {
        expect(newState.cards.get(`creature-p${p}`)?.zone).toBe('graveyard');
      }
    });

    it('does not destroy non-creature permanents', () => {
      const state = createFourPlayerState();
      const effects: Effect[] = [
        { kind: 'Destroy', target: { kind: 'AllCreatures' } },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // Artifact should remain on battlefield
      expect(newState.cards.get('artifact-p1')?.zone).toBe('battlefield');
    });
  });

  describe('CounterSpell effect', () => {
    it('removes the countered spell from the stack and puts it into graveyard', () => {
      const state = createTestState();
      state.cards.set('spell-1', {
        instanceId: 'spell-1',
        definitionId: 'def-generic',
        ownerId: 'player-2',
        zone: 'stack',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      state.stack = [{
        kind: 'Spell',
        id: 'stack_1',
        cardInstanceId: 'spell-1',
        casterId: 'player-2',
        targets: [],
      }];

      const newState = executeEffects(
        state,
        [{ kind: 'CounterSpell', target: { kind: 'Chosen', targetId: 'target_1' } }],
        'player-1',
        ['spell-1'],
        [{ id: 'target_1', type: 'Spell', count: 1 }],
      );

      expect(newState.stack).toHaveLength(0);
      expect(newState.cards.get('spell-1')?.zone).toBe('graveyard');
    });

    it('exiles a countered creature-or-enchantment spell when the rider says exile it instead', () => {
      const state = createTestState();
      state.cardDefinitions.set('def-enchantment', {
        id: 'def-enchantment',
        name: 'Test Enchantment',
        type_line: 'Enchantment',
        oracle_text: '',
        mana_cost: '{1}{W}',
        cmc: 2,
        colors: ['W'],
        color_identity: ['W'],
        keywords: [],
        card_types: ['enchantment'],
      });
      state.cards.set('spell-2', {
        instanceId: 'spell-2',
        definitionId: 'def-enchantment',
        ownerId: 'player-2',
        zone: 'stack',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      state.stack = [{
        kind: 'Spell',
        id: 'stack_2',
        cardInstanceId: 'spell-2',
        casterId: 'player-2',
        targets: [],
      }];

      const newState = executeEffects(
        state,
        [{
          kind: 'CounterSpell',
          target: { kind: 'Chosen', targetId: 'target_1' },
          filter: 'creatureOrEnchantment',
          exileInstead: true,
        }],
        'player-1',
        ['spell-2'],
        [{ id: 'target_1', type: 'CreatureOrEnchantmentSpell', count: 1 }],
      );

      expect(newState.stack).toHaveLength(0);
      expect(newState.cards.get('spell-2')?.zone).toBe('exile');
    });
  });

  describe('Fight effect', () => {
    it('deals simultaneous creature damage and lets SBAs destroy lethally damaged creatures', () => {
      const state = createTestState();
      state.cardDefinitions.set('def-small-creature', {
        id: 'def-small-creature',
        name: 'Small Creature',
        type_line: 'Creature - Test',
        oracle_text: '',
        mana_cost: '{1}{G}',
        cmc: 2,
        colors: ['G'],
        color_identity: ['G'],
        keywords: [],
        power: 2,
        toughness: 2,
        card_types: ['creature'],
      });
      state.cards.set('creature-2', {
        instanceId: 'creature-2',
        definitionId: 'def-small-creature',
        ownerId: 'player-2',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });

      const newState = executeEffectsWithSBA(
        state,
        [{
          kind: 'Fight',
          fighterA: { kind: 'Chosen', targetId: 'target_1' },
          fighterB: { kind: 'Chosen', targetId: 'target_2' },
        }],
        'player-1',
        ['creature-1', 'creature-2'],
        [
          { id: 'target_1', type: 'Creature', count: 1 },
          { id: 'target_2', type: 'Creature', count: 1 },
        ],
      );

      expect(newState.cards.get('creature-1')?.zone).toBe('battlefield');
      expect(newState.cards.get('creature-2')?.zone).toBe('graveyard');
    });
  });

  describe('EachOpponent Discard', () => {
    it('each opponent discards a card in a 4-player game', () => {
      const state = createFourPlayerState();
      const effects: Effect[] = [
        { kind: 'Discard', player: { kind: 'EachOpponent' }, count: 1 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // Count hand cards for each player
      const handCounts: Record<string, number> = {};
      for (const [, card] of newState.cards) {
        if (card.zone === 'hand') {
          handCounts[card.ownerId] = (handCounts[card.ownerId] || 0) + 1;
        }
      }

      // Caster keeps all 3 cards
      expect(handCounts['player-1']).toBe(3);
      // Each opponent should have 2 cards left (discarded 1 from 3)
      expect(handCounts['player-2']).toBe(2);
      expect(handCounts['player-3']).toBe(2);
      expect(handCounts['player-4']).toBe(2);
    });
  });

  describe('Scry effect', () => {
    it('keeps low CMC cards on top and sends high CMC to bottom', () => {
      const state = createTestState();

      // Clear existing library cards
      for (const [id, card] of state.cards) {
        if (card.zone === 'library') {
          state.cards.delete(id);
        }
      }

      // Add library cards in specific order: high CMC first, then low CMC
      // Map iteration order = library order, so first inserted = top
      state.cards.set('lib-high', {
        instanceId: 'lib-high',
        definitionId: 'def-high-cmc',
        ownerId: 'player-1',
        zone: 'library',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      state.cards.set('lib-low-2', {
        instanceId: 'lib-low-2',
        definitionId: 'def-low-cmc-2',
        ownerId: 'player-1',
        zone: 'library',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      state.cards.set('lib-low-1', {
        instanceId: 'lib-low-1',
        definitionId: 'def-low-cmc-1',
        ownerId: 'player-1',
        zone: 'library',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });

      // Add card definitions
      state.cardDefinitions.set('def-high-cmc', {
        id: 'def-high-cmc',
        name: 'Expensive Spell',
        type_line: 'Creature — Dragon',
        oracle_text: 'Flying',
        mana_cost: '{4}{R}{R}',
        cmc: 6,
        colors: ['R'],
        color_identity: ['R'],
        keywords: ['flying'],
        power: 6,
        toughness: 6,
        card_types: ['creature'],
      });
      state.cardDefinitions.set('def-low-cmc-2', {
        id: 'def-low-cmc-2',
        name: 'Cheap Spell',
        type_line: 'Instant',
        oracle_text: 'Deal 2 damage.',
        mana_cost: '{1}{R}',
        cmc: 2,
        colors: ['R'],
        color_identity: ['R'],
        keywords: [],
        card_types: ['instant'],
      });
      state.cardDefinitions.set('def-low-cmc-1', {
        id: 'def-low-cmc-1',
        name: 'Very Cheap Spell',
        type_line: 'Sorcery',
        oracle_text: 'Scry 1.',
        mana_cost: '{R}',
        cmc: 1,
        colors: ['R'],
        color_identity: ['R'],
        keywords: [],
        card_types: ['sorcery'],
      });

      const effects: Effect[] = [
        { kind: 'Scry', player: { kind: 'Controller' }, count: 3 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // After scry 3, low CMC cards should be on top, high CMC on bottom
      const libraryOrder: string[] = [];
      for (const [, card] of newState.cards) {
        if (card.ownerId === 'player-1' && card.zone === 'library') {
          libraryOrder.push(card.instanceId);
        }
      }

      // Low CMC cards (lib-low-2, lib-low-1) should come before high CMC (lib-high)
      expect(libraryOrder.length).toBe(3);
      const highIndex = libraryOrder.indexOf('lib-high');
      const low2Index = libraryOrder.indexOf('lib-low-2');
      const low1Index = libraryOrder.indexOf('lib-low-1');
      expect(low2Index).toBeLessThan(highIndex);
      expect(low1Index).toBeLessThan(highIndex);
    });

    it('keeps lands on top regardless of CMC', () => {
      const state = createTestState();

      // Clear existing library cards
      for (const [id, card] of state.cards) {
        if (card.zone === 'library') {
          state.cards.delete(id);
        }
      }

      // Add a high-CMC spell then a land
      state.cards.set('lib-spell', {
        instanceId: 'lib-spell',
        definitionId: 'def-big-spell',
        ownerId: 'player-1',
        zone: 'library',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      state.cards.set('lib-land', {
        instanceId: 'lib-land',
        definitionId: 'def-land',
        ownerId: 'player-1',
        zone: 'library',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });

      state.cardDefinitions.set('def-big-spell', {
        id: 'def-big-spell',
        name: 'Big Sorcery',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all creatures.',
        mana_cost: '{5}{B}{B}',
        cmc: 7,
        colors: ['B'],
        color_identity: ['B'],
        keywords: [],
        card_types: ['sorcery'],
      });
      state.cardDefinitions.set('def-land', {
        id: 'def-land',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '({T}: Add {G}.)',
        mana_cost: '',
        cmc: 0,
        colors: [],
        color_identity: ['G'],
        keywords: [],
        card_types: ['land'],
      });

      const effects: Effect[] = [
        { kind: 'Scry', player: { kind: 'Controller' }, count: 2 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // Land should be on top (first in iteration order)
      const libraryOrder: string[] = [];
      for (const [, card] of newState.cards) {
        if (card.ownerId === 'player-1' && card.zone === 'library') {
          libraryOrder.push(card.instanceId);
        }
      }

      expect(libraryOrder.length).toBe(2);
      expect(libraryOrder[0]).toBe('lib-land');
      expect(libraryOrder[1]).toBe('lib-spell');
    });

    it('scry 1 with a single card keeps it in library', () => {
      const state = createTestState();

      // Clear existing library cards
      for (const [id, card] of state.cards) {
        if (card.zone === 'library') {
          state.cards.delete(id);
        }
      }

      // Add one low-CMC card
      state.cards.set('lib-only', {
        instanceId: 'lib-only',
        definitionId: 'def-generic',
        ownerId: 'player-1',
        zone: 'library',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });

      const effects: Effect[] = [
        { kind: 'Scry', player: { kind: 'Controller' }, count: 1 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // Card should still be in library
      const libCard = newState.cards.get('lib-only');
      expect(libCard).toBeDefined();
      expect(libCard!.zone).toBe('library');
    });

    it('scry 0 is a no-op', () => {
      const state = createTestState();

      const effects: Effect[] = [
        { kind: 'Scry', player: { kind: 'Controller' }, count: 0 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // State should be unchanged
      expect(newState).toBe(state);
    });

    it('scry on empty library is a no-op', () => {
      const state = createTestState();

      // Clear all library cards
      for (const [id, card] of state.cards) {
        if (card.zone === 'library') {
          state.cards.delete(id);
        }
      }

      const effects: Effect[] = [
        { kind: 'Scry', player: { kind: 'Controller' }, count: 3 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // State should be unchanged (no library cards to scry)
      expect(newState).toBe(state);
    });

    it('does not lose or duplicate cards during scry', () => {
      const state = createTestState();

      // Count total cards before scry
      const totalBefore = state.cards.size;

      const effects: Effect[] = [
        { kind: 'Scry', player: { kind: 'Controller' }, count: 3 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // Count total cards after scry - should be the same
      expect(newState.cards.size).toBe(totalBefore);

      // All original card IDs should still exist
      for (const [id] of state.cards) {
        expect(newState.cards.has(id)).toBe(true);
      }
    });

    it('uses explicit player choices for top and bottom order', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'Scry', player: { kind: 'Controller' }, count: 3 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], [], 0, {
        namedCardChoices: {
          scryTopIds: 'lib-card-3,lib-card-1',
          scryBottomIds: 'lib-card-2',
        },
      });

      const libraryOrder = [...newState.cards.values()]
        .filter(card => card.ownerId === 'player-1' && card.zone === 'library')
        .map(card => card.instanceId);

      expect(libraryOrder.slice(0, 5)).toEqual([
        'lib-card-3',
        'lib-card-1',
        'lib-card-4',
        'lib-card-5',
        'lib-card-2',
      ]);
    });

    it('uses explicit player choices for surveil top and graveyard', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'Surveil', player: { kind: 'Controller' }, count: 3 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], [], 0, {
        namedCardChoices: {
          surveilTopIds: 'lib-card-2',
          surveilGraveyardIds: 'lib-card-1,lib-card-3',
        },
      });

      const libraryOrder = [...newState.cards.values()]
        .filter(card => card.ownerId === 'player-1' && card.zone === 'library')
        .map(card => card.instanceId);

      expect(libraryOrder.slice(0, 3)).toEqual(['lib-card-2', 'lib-card-4', 'lib-card-5']);
      expect(newState.cards.get('lib-card-1')?.zone).toBe('graveyard');
      expect(newState.cards.get('lib-card-3')?.zone).toBe('graveyard');
    });
  });

});
