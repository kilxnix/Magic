import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerReplacement,
  unregisterReplacement,
  clearReplacements,
  applyReplacements,
  createDamagePreventionEffect,
  createExileInsteadOfDieEffect,
  createDrawDoublingEffect,
  createCounterDoublingEffect,
  createTokenDoublingEffect,
  getReplacementsForPermanent,
} from './replacement';
import type { ReplacementEvent } from './replacement';
import type { GameState, CardInstance, CardDefinition } from '../types';
import { executeEffects, resetTokenCounter } from './executor';
import type { Effect } from './ast';

function createTestState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

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

describe('Replacement Effects Framework', () => {
  beforeEach(() => {
    clearReplacements();
  });

  describe('registerReplacement and unregisterReplacement', () => {
    it('registers and retrieves replacement effects', () => {
      const effect = createDamagePreventionEffect('source-1', 'player-1', 'player-1', 3);
      registerReplacement(effect);

      const replacements = getReplacementsForPermanent('source-1');
      expect(replacements).toHaveLength(1);
      expect(replacements[0].id).toBe('prevent_damage_source-1');
    });

    it('unregisters replacement effects', () => {
      const effect = createDamagePreventionEffect('source-1', 'player-1', 'player-1', 3);
      registerReplacement(effect);
      unregisterReplacement(effect.id);

      const replacements = getReplacementsForPermanent('source-1');
      expect(replacements).toHaveLength(0);
    });
  });

  describe('applyReplacements', () => {
    it('returns unchanged event when no replacements apply', () => {
      const state = createTestState();
      const event: ReplacementEvent = {
        type: 'DamageDealt',
        targetId: 'player-1',
        amount: 5,
      };

      const result = applyReplacements(state, event);

      expect(result.event).toEqual(event);
      expect(result.appliedReplacements).toHaveLength(0);
    });

    it('applies matching replacement effect', () => {
      const state = createTestState();
      const effect = createDamagePreventionEffect('source-1', 'player-1', 'player-1', 2);
      registerReplacement(effect);

      const event: ReplacementEvent = {
        type: 'DamageDealt',
        targetId: 'player-1',
        amount: 5,
      };

      const result = applyReplacements(state, event);

      expect(result.event?.amount).toBe(3); // 5 - 2 = 3
      expect(result.appliedReplacements).toContain(effect.id);
    });

    it('does not apply replacement to non-matching event', () => {
      const state = createTestState();
      const effect = createDamagePreventionEffect('source-1', 'player-1', 'player-1', 2);
      registerReplacement(effect);

      const event: ReplacementEvent = {
        type: 'DamageDealt',
        targetId: 'player-2', // Different player
        amount: 5,
      };

      const result = applyReplacements(state, event);

      expect(result.event?.amount).toBe(5); // No prevention
      expect(result.appliedReplacements).toHaveLength(0);
    });
  });

  describe('createDamagePreventionEffect', () => {
    it('prevents specified amount of damage', () => {
      const state = createTestState();
      const effect = createDamagePreventionEffect('source-1', 'player-1', 'player-1', 3);
      registerReplacement(effect);

      const event: ReplacementEvent = {
        type: 'DamageDealt',
        targetId: 'player-1',
        amount: 5,
      };

      const result = applyReplacements(state, event);

      expect(result.event?.amount).toBe(2);
    });

    it('prevents all damage when amount equals damage', () => {
      const state = createTestState();
      const effect = createDamagePreventionEffect('source-1', 'player-1', 'player-1', 5);
      registerReplacement(effect);

      const event: ReplacementEvent = {
        type: 'DamageDealt',
        targetId: 'player-1',
        amount: 5,
      };

      const result = applyReplacements(state, event);

      expect(result.event).toBeNull(); // All damage prevented
    });

    it('prevents all damage when set to "all"', () => {
      const state = createTestState();
      const effect = createDamagePreventionEffect('source-1', 'player-1', 'player-1', 'all');
      registerReplacement(effect);

      const event: ReplacementEvent = {
        type: 'DamageDealt',
        targetId: 'player-1',
        amount: 100,
      };

      const result = applyReplacements(state, event);

      expect(result.event).toBeNull();
    });
  });

  describe('createDrawDoublingEffect', () => {
    it('doubles card draw amount', () => {
      const state = createTestState();
      const effect = createDrawDoublingEffect('source-1', 'player-1', 'player-1');
      registerReplacement(effect);

      const event: ReplacementEvent = {
        type: 'CardDrawn',
        targetId: 'player-1',
        amount: 1,
      };

      const result = applyReplacements(state, event);

      expect(result.event?.amount).toBe(2);
    });

    it('does not affect other players', () => {
      const state = createTestState();
      const effect = createDrawDoublingEffect('source-1', 'player-1', 'player-1');
      registerReplacement(effect);

      const event: ReplacementEvent = {
        type: 'CardDrawn',
        targetId: 'player-2',
        amount: 1,
      };

      const result = applyReplacements(state, event);

      expect(result.event?.amount).toBe(1);
    });
  });

  describe('createCounterDoublingEffect', () => {
    it('doubles counters added to own permanents', () => {
      const state = createTestState();
      const effect = createCounterDoublingEffect('source-1', 'player-1');
      registerReplacement(effect);

      const event: ReplacementEvent = {
        type: 'CounterAdded',
        targetId: 'creature-1',
        amount: 1,
      };

      const result = applyReplacements(state, event);

      expect(result.event?.amount).toBe(2);
    });
  });

  describe('createTokenDoublingEffect', () => {
    it('doubles token creation', () => {
      const state = createTestState();
      const effect = createTokenDoublingEffect('source-1', 'player-1');
      registerReplacement(effect);

      const event: ReplacementEvent = {
        type: 'TokenCreated',
        targetId: 'player-1',
        amount: 1,
      };

      const result = applyReplacements(state, event);

      expect(result.event?.amount).toBe(2);
    });
  });

  describe('createExileInsteadOfDieEffect', () => {
    it('changes death destination to exile', () => {
      const state = createTestState();
      const effect = createExileInsteadOfDieEffect('source-1', 'player-1');
      registerReplacement(effect);

      const event: ReplacementEvent = {
        type: 'CreatureDies',
        cardInstanceId: 'creature-1',
      };

      const result = applyReplacements(state, event);

      expect(result.event?.type).toBe('CreatureDies');
      expect(result.event?.destinationZone).toBe('exile');
      expect(result.appliedReplacements).toHaveLength(1);
    });

    it('can filter specific creatures', () => {
      const state = createTestState();
      const effect = createExileInsteadOfDieEffect(
        'source-1',
        'player-1',
        (card) => card.ownerId === 'player-2', // Only opponent creatures
      );
      registerReplacement(effect);

      const event: ReplacementEvent = {
        type: 'CreatureDies',
        cardInstanceId: 'creature-1', // Owned by player-1
      };

      const result = applyReplacements(state, event);

      // Filter returns false, so no replacement
      expect(result.event?.type).toBe('CreatureDies');
      expect(result.appliedReplacements).toHaveLength(0);
    });
  });

  describe('multiple replacements', () => {
    it('applies multiple replacements in order', () => {
      const state = createTestState();

      // First prevention: 2 damage
      const effect1 = createDamagePreventionEffect('source-1', 'player-1', 'player-1', 2);
      // Second prevention: 1 damage
      const effect2 = createDamagePreventionEffect('source-2', 'player-1', 'player-1', 1);

      registerReplacement(effect1);
      registerReplacement(effect2);

      const event: ReplacementEvent = {
        type: 'DamageDealt',
        targetId: 'player-1',
        amount: 5,
      };

      const result = applyReplacements(state, event);

      // 5 - 2 - 1 = 2
      expect(result.event?.amount).toBe(2);
      expect(result.appliedReplacements).toHaveLength(2);
    });

    it('stops when event is fully prevented', () => {
      const state = createTestState();

      const effect1 = createDamagePreventionEffect('source-1', 'player-1', 'player-1', 'all');
      const effect2 = createDamagePreventionEffect('source-2', 'player-1', 'player-1', 2);

      registerReplacement(effect1);
      registerReplacement(effect2);

      const event: ReplacementEvent = {
        type: 'DamageDealt',
        targetId: 'player-1',
        amount: 5,
      };

      const result = applyReplacements(state, event);

      expect(result.event).toBeNull();
      expect(result.appliedReplacements).toHaveLength(1); // Only first applied
    });
  });
});


describe('Replacement Effects Integration (through executor)', () => {
  beforeEach(() => {
    clearReplacements();
    resetTokenCounter();
  });

  afterEach(() => {
    clearReplacements();
  });

  function createIntegrationState(): GameState {
    const cards = new Map<string, CardInstance>();
    const cardDefinitions = new Map<string, CardDefinition>();

    // Add a creature to the battlefield (owned by player-1)
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

    // Add library cards for draw tests
    for (let i = 1; i <= 10; i++) {
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

  describe('Damage prevention through executor', () => {
    it('prevents all damage to a player when prevention effect is active', () => {
      const state = createIntegrationState();

      // Register damage prevention for player-1
      const effect = createDamagePreventionEffect('source-1', 'player-1', 'player-1', 'all');
      registerReplacement(effect);

      // Execute DealDamage effect targeting player-1
      const effects: Effect[] = [
        {
          kind: 'DealDamage',
          source: { kind: 'ThisSpell' },
          target: { kind: 'Chosen', targetId: 'target_1' },
          amount: 5,
        },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-2',
        ['player-1'],
        [{ id: 'target_1' }],
      );

      // Player 1 should still be at 40 life (damage prevented)
      expect(newState.players[0].life).toBe(40);
    });

    it('partially prevents damage when prevention has a limit', () => {
      const state = createIntegrationState();

      // Prevent 3 damage to player-1
      const effect = createDamagePreventionEffect('source-1', 'player-1', 'player-1', 3);
      registerReplacement(effect);

      const effects: Effect[] = [
        {
          kind: 'DealDamage',
          source: { kind: 'ThisSpell' },
          target: { kind: 'Chosen', targetId: 'target_1' },
          amount: 5,
        },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-2',
        ['player-1'],
        [{ id: 'target_1' }],
      );

      // 5 - 3 = 2 damage gets through
      expect(newState.players[0].life).toBe(38);
    });

    it('does not affect other players when only one player is protected', () => {
      const state = createIntegrationState();

      // Protect only player-1
      const effect = createDamagePreventionEffect('source-1', 'player-1', 'player-1', 'all');
      registerReplacement(effect);

      // Deal damage to player-2 (not protected)
      const effects: Effect[] = [
        {
          kind: 'DealDamage',
          source: { kind: 'ThisSpell' },
          target: { kind: 'Chosen', targetId: 'target_1' },
          amount: 5,
        },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-1',
        ['player-2'],
        [{ id: 'target_1' }],
      );

      // Player-2 should take full damage
      expect(newState.players[1].life).toBe(35);
    });
  });

  describe('Draw doubling through executor', () => {
    it('doubles card draw when doubling effect is active', () => {
      const state = createIntegrationState();

      // Register draw doubling for player-1
      const effect = createDrawDoublingEffect('source-1', 'player-1', 'player-1');
      registerReplacement(effect);

      // Draw 1 card
      const effects: Effect[] = [
        { kind: 'Draw', player: { kind: 'Controller' }, count: 1 },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      // Should have drawn 2 cards (doubled)
      let handCount = 0;
      for (const [, card] of newState.cards) {
        if (card.ownerId === 'player-1' && card.zone === 'hand') {
          handCount++;
        }
      }
      expect(handCount).toBe(2);
    });

    it('doubles draw 3 to draw 6', () => {
      const state = createIntegrationState();

      const effect = createDrawDoublingEffect('source-1', 'player-1', 'player-1');
      registerReplacement(effect);

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
      expect(handCount).toBe(6);
    });

    it('does not double draws for unaffected player', () => {
      const state = createIntegrationState();

      // Only doubles for player-1
      const effect = createDrawDoublingEffect('source-1', 'player-1', 'player-1');
      registerReplacement(effect);

      // Add library cards for player-2
      const cards = new Map(state.cards);
      for (let i = 1; i <= 5; i++) {
        cards.set(`lib-p2-${i}`, {
          instanceId: `lib-p2-${i}`,
          definitionId: 'def-generic',
          ownerId: 'player-2',
          zone: 'library',
          tapped: false,
          summoningSick: false,
          counters: {},
          damage: 0,
          isCommander: false,
        });
      }
      const modifiedState = { ...state, cards };

      // Player-2 draws 1
      const effects: Effect[] = [
        { kind: 'Draw', player: { kind: 'Player', playerId: 'player-2' }, count: 1 },
      ];

      const newState = executeEffects(modifiedState, effects, 'player-2', [], []);

      let handCount = 0;
      for (const [, card] of newState.cards) {
        if (card.ownerId === 'player-2' && card.zone === 'hand') {
          handCount++;
        }
      }
      expect(handCount).toBe(1); // Not doubled
    });
  });

  describe('Counter doubling through executor', () => {
    it('doubles +1/+1 counters when doubling effect is active', () => {
      const state = createIntegrationState();

      // Register counter doubling for player-1
      const effect = createCounterDoublingEffect('source-1', 'player-1');
      registerReplacement(effect);

      // Add 1 +1/+1 counter to creature-1
      const effects: Effect[] = [
        {
          kind: 'AddCounters',
          target: { kind: 'Chosen', targetId: 'target_1' },
          counterType: '+1/+1',
          count: 1,
        },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      // Should have 2 counters (doubled from 1)
      expect(newState.cards.get('creature-1')?.counters['+1/+1']).toBe(2);
    });

    it('doubles 3 counters to 6', () => {
      const state = createIntegrationState();

      const effect = createCounterDoublingEffect('source-1', 'player-1');
      registerReplacement(effect);

      const effects: Effect[] = [
        {
          kind: 'AddCounters',
          target: { kind: 'Chosen', targetId: 'target_1' },
          counterType: '+1/+1',
          count: 3,
        },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-1',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      expect(newState.cards.get('creature-1')?.counters['+1/+1']).toBe(6);
    });
  });

  describe('Token doubling through executor', () => {
    it('doubles token creation when doubling effect is active', () => {
      const state = createIntegrationState();

      // Register token doubling for player-1
      const effect = createTokenDoublingEffect('source-1', 'player-1');
      registerReplacement(effect);

      // Create 1 token
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
          count: 1,
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
      expect(tokenCount).toBe(2); // Doubled from 1
    });

    it('doubles 3 tokens to 6', () => {
      const state = createIntegrationState();

      const effect = createTokenDoublingEffect('source-1', 'player-1');
      registerReplacement(effect);

      const effects: Effect[] = [
        {
          kind: 'CreateToken',
          controller: { kind: 'Controller' },
          token: {
            name: 'Soldier',
            colors: ['W'],
            types: ['creature'],
            subtypes: ['soldier'],
            power: 1,
            toughness: 1,
          },
          count: 3,
        },
      ];

      const newState = executeEffects(state, effects, 'player-1', [], []);

      let tokenCount = 0;
      for (const [instanceId, card] of newState.cards) {
        if (instanceId.startsWith('token_inst_') && card.zone === 'battlefield') {
          tokenCount++;
        }
      }
      expect(tokenCount).toBe(6); // Doubled from 3
    });
  });

  describe('Dies replacement through executor', () => {
    it('exiles destroyed creatures when a dies replacement is active', () => {
      const state = createIntegrationState();
      registerReplacement(createExileInsteadOfDieEffect('leyline-void', 'player-2'));

      const effects: Effect[] = [
        {
          kind: 'Destroy',
          target: { kind: 'Chosen', targetId: 'target_1' },
        },
      ];

      const newState = executeEffects(
        state,
        effects,
        'player-2',
        ['creature-1'],
        [{ id: 'target_1' }],
      );

      expect(newState.cards.get('creature-1')?.zone).toBe('exile');
    });
  });
});
