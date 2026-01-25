import { describe, it, expect } from 'vitest';
import { castSpell, resolveTopOfStack } from './stack';
import type { GameState, CardInstance, CardDefinition, ManaPool } from './types';

function createIntegrationState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  // Lightning Bolt in hand
  cards.set('bolt-1', {
    instanceId: 'bolt-1',
    definitionId: 'def-bolt',
    ownerId: 'player-1',
    zone: 'hand',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-bolt', {
    id: 'def-bolt',
    name: 'Lightning Bolt',
    type_line: 'Instant',
    oracle_text: '~ deals 3 damage to any target.',
    mana_cost: '{R}',
    cmc: 1,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    card_types: ['instant'],
  });

  // Murder in hand
  cards.set('murder-1', {
    instanceId: 'murder-1',
    definitionId: 'def-murder',
    ownerId: 'player-1',
    zone: 'hand',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-murder', {
    id: 'def-murder',
    name: 'Murder',
    type_line: 'Instant',
    oracle_text: 'Destroy target creature.',
    mana_cost: '{1}{B}{B}',
    cmc: 3,
    colors: ['B'],
    color_identity: ['B'],
    keywords: [],
    card_types: ['instant'],
  });

  // Divination in hand
  cards.set('divination-1', {
    instanceId: 'divination-1',
    definitionId: 'def-divination',
    ownerId: 'player-1',
    zone: 'hand',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-divination', {
    id: 'def-divination',
    name: 'Divination',
    type_line: 'Sorcery',
    oracle_text: 'Draw 2 cards.',
    mana_cost: '{2}{U}',
    cmc: 3,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['sorcery'],
  });

  // Target creature on opponent's battlefield
  cards.set('creature-1', {
    instanceId: 'creature-1',
    definitionId: 'def-creature',
    ownerId: 'player-2',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-creature', {
    id: 'def-creature',
    name: 'Grizzly Bears',
    type_line: 'Creature — Bear',
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

  // Add cards to player-1's library for draw tests
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

  const fullMana: ManaPool = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 };

  return {
    players: [
      {
        id: 'player-1',
        name: 'Player 1',
        life: 40,
        commanderDamage: {},
        commanderTax: 0,
        manaPool: { ...fullMana },
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
        manaPool: { ...fullMana },
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

describe('Stack + Effect System Integration', () => {
  describe('Lightning Bolt', () => {
    it('deals 3 damage to a creature and kills it via SBA', () => {
      let state = createIntegrationState();

      // Cast Lightning Bolt targeting creature-1 (2/2)
      state = castSpell(state, 'player-1', 'bolt-1', ['creature-1']);
      expect(state.stack.length).toBe(1);
      expect(state.cards.get('bolt-1')?.zone).toBe('stack');

      // Resolve
      state = resolveTopOfStack(state);

      // Bolt should be in graveyard
      expect(state.cards.get('bolt-1')?.zone).toBe('graveyard');

      // Creature took 3 damage (lethal for 2/2) and died
      expect(state.cards.get('creature-1')?.zone).toBe('graveyard');
    });

    it('deals 3 damage to a player', () => {
      let state = createIntegrationState();

      // Cast Lightning Bolt targeting player-2
      state = castSpell(state, 'player-1', 'bolt-1', ['player-2']);

      // Resolve
      state = resolveTopOfStack(state);

      // Player 2 should have lost 3 life
      expect(state.players[1].life).toBe(37);
    });
  });

  describe('Murder', () => {
    it('destroys target creature', () => {
      let state = createIntegrationState();

      // Cast Murder targeting creature-1
      state = castSpell(state, 'player-1', 'murder-1', ['creature-1']);

      // Resolve
      state = resolveTopOfStack(state);

      // Murder in graveyard
      expect(state.cards.get('murder-1')?.zone).toBe('graveyard');

      // Creature destroyed
      expect(state.cards.get('creature-1')?.zone).toBe('graveyard');
    });
  });

  describe('Divination', () => {
    it('draws 2 cards', () => {
      let state = createIntegrationState();

      // Count cards in hand before
      const handBefore = Array.from(state.cards.values()).filter(
        c => c.ownerId === 'player-1' && c.zone === 'hand'
      ).length;

      // Cast Divination (no targets)
      state = castSpell(state, 'player-1', 'divination-1', []);

      // Resolve
      state = resolveTopOfStack(state);

      // Divination in graveyard
      expect(state.cards.get('divination-1')?.zone).toBe('graveyard');

      // Count cards in hand after (should be +2, but divination left hand so net +1)
      const handAfter = Array.from(state.cards.values()).filter(
        c => c.ownerId === 'player-1' && c.zone === 'hand'
      ).length;

      // Started with divination + some spells in hand, divination went to graveyard, drew 2
      // Net change: -1 (divination) + 2 (drawn) = +1
      expect(handAfter).toBe(handBefore + 1);
    });
  });

  describe('Target Validation', () => {
    it('rejects invalid target types', () => {
      let state = createIntegrationState();

      // Cast Murder targeting a player (invalid - Murder targets creatures)
      state = castSpell(state, 'player-1', 'murder-1', ['player-2']);

      // Resolution should throw due to invalid target
      expect(() => resolveTopOfStack(state)).toThrow();
    });
  });

  describe('Unparsed spells', () => {
    it('resolves gracefully without effects', () => {
      let state = createIntegrationState();

      // Create an unparseable spell
      const cards = new Map(state.cards);
      const defs = new Map(state.cardDefinitions);

      cards.set('weird-spell', {
        instanceId: 'weird-spell',
        definitionId: 'def-weird',
        ownerId: 'player-1',
        zone: 'hand',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });

      defs.set('def-weird', {
        id: 'def-weird',
        name: 'Weird Spell',
        type_line: 'Instant',
        oracle_text: 'Do something complex that the parser cannot handle.',
        mana_cost: '{1}',
        cmc: 1,
        colors: [],
        color_identity: [],
        keywords: [],
        card_types: ['instant'],
      });

      state = { ...state, cards, cardDefinitions: defs };

      // Cast the weird spell
      state = castSpell(state, 'player-1', 'weird-spell', []);

      // Should resolve without throwing (just goes to graveyard)
      state = resolveTopOfStack(state);

      expect(state.cards.get('weird-spell')?.zone).toBe('graveyard');
    });
  });
});
