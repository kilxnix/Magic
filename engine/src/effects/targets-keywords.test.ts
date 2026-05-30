import { describe, it, expect } from 'vitest';
import { validateTargetChoices } from './targets';
import type { GameState, CardInstance, CardDefinition } from '../types';

function createStateWithCreature(keywords: string[] = [], ownerId: string = 'player-2'): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  cards.set('creature-1', {
    instanceId: 'creature-1',
    definitionId: 'def-creature',
    ownerId,
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
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords,
    power: 2,
    toughness: 2,
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

function addSource(
  state: GameState,
  id: string,
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G'>,
  typeLine = 'Instant',
  cardTypes: CardDefinition['card_types'] = ['instant'],
): GameState {
  state.cards.set(id, {
    instanceId: id,
    definitionId: `def-${id}`,
    ownerId: 'player-1',
    zone: 'stack',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  state.cardDefinitions.set(`def-${id}`, {
    id: `def-${id}`,
    name: `${colors.join('')} Source`,
    type_line: typeLine,
    oracle_text: 'Test source deals damage.',
    mana_cost: '{R}',
    cmc: 1,
    colors,
    color_identity: colors,
    keywords: [],
    card_types: cardTypes,
  });
  state.stack.push({
    kind: 'Spell',
    id: `stack-${id}`,
    cardInstanceId: id,
    casterId: 'player-1',
    targets: ['creature-1'],
  });
  return state;
}

describe('Target Validation with Keywords', () => {
  describe('Color constraints', () => {
    it('requires selected creature to match required color constraints', () => {
      const state = createStateWithCreature([], 'player-2');
      state.cardDefinitions.set('def-creature', {
        ...state.cardDefinitions.get('def-creature')!,
        colors: ['R'],
      });
      const specs = [{ id: 'target_1', type: 'Creature' as const, count: 1, constraints: { colors: ['G' as const] } }];

      expect(() => {
        validateTargetChoices(state, 'player-1', specs, ['creature-1']);
      }).toThrow('missing a required color');
    });

    it('accepts selected creature with a required color', () => {
      const state = createStateWithCreature([], 'player-2');
      state.cardDefinitions.set('def-creature', {
        ...state.cardDefinitions.get('def-creature')!,
        colors: ['G'],
      });
      const specs = [{ id: 'target_1', type: 'Creature' as const, count: 1, constraints: { colors: ['G' as const] } }];

      expect(() => {
        validateTargetChoices(state, 'player-1', specs, ['creature-1']);
      }).not.toThrow();
    });

    it('prevents targeting from a source of a protected card type', () => {
      const state = addSource(
        createStateWithCreature([], 'player-2'),
        'artifact-source',
        [],
        'Artifact',
        ['artifact'],
      );
      state.cardDefinitions.set('def-creature', {
        ...state.cardDefinitions.get('def-creature')!,
        oracle_text: 'Protection from artifacts',
      });
      const specs = [{ id: 'target_1', type: 'Creature' as const, count: 1 }];

      expect(() => {
        validateTargetChoices(state, 'player-1', specs, ['creature-1'], 'artifact-source');
      }).toThrow('protection from the source');
    });
  });

  describe('Hexproof', () => {
    it('prevents opponent from targeting', () => {
      const state = createStateWithCreature(['Hexproof'], 'player-2');
      const specs = [{ id: 'target_1', type: 'Creature' as const, count: 1 }];

      // Player 1 (opponent) tries to target player 2's hexproof creature
      expect(() => {
        validateTargetChoices(state, 'player-1', specs, ['creature-1']);
      }).toThrow('hexproof or shroud');
    });

    it('allows controller to target their own hexproof creature', () => {
      const state = createStateWithCreature(['Hexproof'], 'player-1');
      const specs = [{ id: 'target_1', type: 'Creature' as const, count: 1 }];

      // Player 1 (controller) targets their own hexproof creature
      expect(() => {
        validateTargetChoices(state, 'player-1', specs, ['creature-1']);
      }).not.toThrow();
    });
  });

  describe('Shroud', () => {
    it('prevents opponent from targeting', () => {
      const state = createStateWithCreature(['Shroud'], 'player-2');
      const specs = [{ id: 'target_1', type: 'Creature' as const, count: 1 }];

      expect(() => {
        validateTargetChoices(state, 'player-1', specs, ['creature-1']);
      }).toThrow('hexproof or shroud');
    });

    it('prevents controller from targeting their own shroud creature', () => {
      const state = createStateWithCreature(['Shroud'], 'player-1');
      const specs = [{ id: 'target_1', type: 'Creature' as const, count: 1 }];

      expect(() => {
        validateTargetChoices(state, 'player-1', specs, ['creature-1']);
      }).toThrow('shroud');
    });
  });

  describe('Protection', () => {
    it('prevents targeting from a source of the protected color', () => {
      const state = addSource(createStateWithCreature([], 'player-2'), 'red-source', ['R']);
      state.cardDefinitions.set('def-creature', {
        ...state.cardDefinitions.get('def-creature')!,
        oracle_text: 'Protection from red',
      });
      const specs = [{ id: 'target_1', type: 'Creature' as const, count: 1 }];

      expect(() => {
        validateTargetChoices(state, 'player-1', specs, ['creature-1'], 'red-source');
      }).toThrow('protection from the source');
    });

    it('allows targeting from a source that does not match the protection color', () => {
      const state = addSource(createStateWithCreature([], 'player-2'), 'blue-source', ['U']);
      state.cardDefinitions.set('def-creature', {
        ...state.cardDefinitions.get('def-creature')!,
        oracle_text: 'Protection from red',
      });
      const specs = [{ id: 'target_1', type: 'Creature' as const, count: 1 }];

      expect(() => {
        validateTargetChoices(state, 'player-1', specs, ['creature-1'], 'blue-source');
      }).not.toThrow();
    });
  });

  describe('Normal creatures', () => {
    it('allows targeting normal creatures by opponent', () => {
      const state = createStateWithCreature([], 'player-2');
      const specs = [{ id: 'target_1', type: 'Creature' as const, count: 1 }];

      expect(() => {
        validateTargetChoices(state, 'player-1', specs, ['creature-1']);
      }).not.toThrow();
    });

    it('allows targeting normal creatures by controller', () => {
      const state = createStateWithCreature([], 'player-1');
      const specs = [{ id: 'target_1', type: 'Creature' as const, count: 1 }];

      expect(() => {
        validateTargetChoices(state, 'player-1', specs, ['creature-1']);
      }).not.toThrow();
    });
  });
});
