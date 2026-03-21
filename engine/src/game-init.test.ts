import { describe, it, expect, beforeEach } from 'vitest';
import {
  initGameFromDecks,
  GameInitConfig,
  resetInstanceCounter,
  getHumanPlayer,
  getAIPlayers,
  isAIControlled,
} from './game-init';
import type { GeneratedDeck, ScryfallCard } from './cards/deck-loader';
import { createCardLookup } from './cards/deck-loader';

// Create test cards
function createTestCards(): ScryfallCard[] {
  const cards: ScryfallCard[] = [];

  // Add commanders
  cards.push({
    id: 'commander-human',
    name: 'Human Commander',
    type_line: 'Legendary Creature — Human Wizard',
    oracle_text: 'Test commander ability.',
    mana_cost: '{2}{U}{U}',
    cmc: 4,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    power: '3',
    toughness: '3',
  });

  cards.push({
    id: 'commander-ai1',
    name: 'AI Commander 1',
    type_line: 'Legendary Creature — Dragon',
    oracle_text: 'Flying',
    mana_cost: '{4}{R}{R}',
    cmc: 6,
    colors: ['R'],
    color_identity: ['R'],
    keywords: ['Flying'],
    power: '5',
    toughness: '5',
  });

  cards.push({
    id: 'commander-ai2',
    name: 'AI Commander 2',
    type_line: 'Legendary Creature — Elf Druid',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: '1',
    toughness: '1',
  });

  cards.push({
    id: 'commander-ai3',
    name: 'AI Commander 3',
    type_line: 'Legendary Creature — Zombie',
    oracle_text: 'Deathtouch',
    mana_cost: '{1}{B}{B}',
    cmc: 3,
    colors: ['B'],
    color_identity: ['B'],
    keywords: ['Deathtouch'],
    power: '2',
    toughness: '2',
  });

  // Add 99 unique cards for each deck (we'll reuse some)
  for (let i = 0; i < 100; i++) {
    cards.push({
      id: `card-${i}`,
      name: `Test Card ${i}`,
      type_line: i % 10 === 0 ? 'Basic Land — Island' : 'Creature — Test',
      oracle_text: i % 10 === 0 ? '({T}: Add {U}.)' : `Test creature ${i}`,
      mana_cost: i % 10 === 0 ? '' : `{${(i % 5) + 1}}`,
      cmc: i % 10 === 0 ? 0 : (i % 5) + 1,
      colors: i % 10 === 0 ? [] : ['U'],
      color_identity: ['U'],
      keywords: [],
      power: i % 10 === 0 ? undefined : '2',
      toughness: i % 10 === 0 ? undefined : '2',
    });
  }

  return cards;
}

function createTestDeck(commanderName: string): GeneratedDeck {
  const list: string[] = [];
  for (let i = 0; i < 99; i++) {
    list.push(`Test Card ${i}`);
  }

  return {
    id: `deck-${commanderName}`,
    commander: commanderName,
    list,
    colors: ['U'],
    bracket: 3,
    theme: 'Test',
  };
}

describe('initGameFromDecks', () => {
  let testCards: ScryfallCard[];
  let cardLookup: ReturnType<typeof createCardLookup>;

  beforeEach(() => {
    resetInstanceCounter();
    testCards = createTestCards();
    cardLookup = createCardLookup(testCards);
  });

  it('initializes a 2-player game', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [createTestDeck('AI Commander 1')],
      aiDifficulty: 3,
      cardLookup,
    };

    const state = initGameFromDecks(config);

    expect(state.players.length).toBe(2);
    expect(state.players[0].isAI).toBe(false);
    expect(state.players[1].isAI).toBe(true);
  });

  it('initializes a 4-player game', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [
        createTestDeck('AI Commander 1'),
        createTestDeck('AI Commander 2'),
        createTestDeck('AI Commander 3'),
      ],
      aiDifficulty: 3,
      cardLookup,
    };

    const state = initGameFromDecks(config);

    expect(state.players.length).toBe(4);
    expect(state.players[0].isAI).toBe(false);
    expect(state.players[1].isAI).toBe(true);
    expect(state.players[2].isAI).toBe(true);
    expect(state.players[3].isAI).toBe(true);
  });

  it('places commanders in command zone', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [createTestDeck('AI Commander 1')],
      aiDifficulty: 3,
      cardLookup,
    };

    const state = initGameFromDecks(config);

    // Check human commander
    const humanCommanderId = state.players[0].commanderInstanceId;
    expect(humanCommanderId).toBeDefined();
    const humanCommander = state.cards.get(humanCommanderId!);
    expect(humanCommander).toBeDefined();
    expect(humanCommander!.zone).toBe('command');
    expect(humanCommander!.isCommander).toBe(true);

    // Check AI commander
    const aiCommanderId = state.players[1].commanderInstanceId;
    expect(aiCommanderId).toBeDefined();
    const aiCommander = state.cards.get(aiCommanderId!);
    expect(aiCommander).toBeDefined();
    expect(aiCommander!.zone).toBe('command');
    expect(aiCommander!.isCommander).toBe(true);
  });

  it('draws opening hands', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [createTestDeck('AI Commander 1')],
      aiDifficulty: 3,
      cardLookup,
      startingHandSize: 7,
    };

    const state = initGameFromDecks(config);

    // Count cards in human's hand
    const humanHandCount = Array.from(state.cards.values())
      .filter(c => c.ownerId === 'human' && c.zone === 'hand').length;
    expect(humanHandCount).toBe(7);

    // Count cards in AI's hand
    const aiHandCount = Array.from(state.cards.values())
      .filter(c => c.ownerId === 'ai1' && c.zone === 'hand').length;
    expect(aiHandCount).toBe(7);
  });

  it('respects custom starting hand size', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [createTestDeck('AI Commander 1')],
      aiDifficulty: 3,
      cardLookup,
      startingHandSize: 5,
    };

    const state = initGameFromDecks(config);

    const humanHandCount = Array.from(state.cards.values())
      .filter(c => c.ownerId === 'human' && c.zone === 'hand').length;
    expect(humanHandCount).toBe(5);
  });

  it('sets correct starting life', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [createTestDeck('AI Commander 1')],
      aiDifficulty: 3,
      cardLookup,
      startingLife: 40,
    };

    const state = initGameFromDecks(config);

    expect(state.players[0].life).toBe(40);
    expect(state.players[1].life).toBe(40);
  });

  it('assigns AI personalities', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [
        createTestDeck('AI Commander 1'),
        createTestDeck('AI Commander 2'),
      ],
      aiDifficulty: 3,
      aiPersonalities: ['Aggressive', 'Political'],
      cardLookup,
    };

    const state = initGameFromDecks(config);

    expect(state.players[1].personality).toBe('Aggressive');
    expect(state.players[2].personality).toBe('Political');
  });

  it('defaults AI personality to Balanced', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [createTestDeck('AI Commander 1')],
      aiDifficulty: 3,
      cardLookup,
    };

    const state = initGameFromDecks(config);

    expect(state.players[1].personality).toBe('Balanced');
  });

  it('assigns AI difficulty', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [createTestDeck('AI Commander 1')],
      aiDifficulty: 4,
      cardLookup,
    };

    const state = initGameFromDecks(config);

    expect(state.players[1].difficulty).toBe(4);
  });

  it('human goes first by default', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [createTestDeck('AI Commander 1')],
      aiDifficulty: 3,
      cardLookup,
    };

    const state = initGameFromDecks(config);

    expect(state.activePlayerIndex).toBe(0);
    expect(state.priorityPlayerIndex).toBe(0);
    expect(state.players[0].hasPriority).toBe(true);
  });

  it('throws for invalid AI count (0)', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [],
      aiDifficulty: 3,
      cardLookup,
    };

    expect(() => initGameFromDecks(config)).toThrow('Invalid AI count');
  });

  it('throws for invalid AI count (4)', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [
        createTestDeck('AI Commander 1'),
        createTestDeck('AI Commander 2'),
        createTestDeck('AI Commander 3'),
        createTestDeck('Human Commander'), // 4th AI
      ],
      aiDifficulty: 3,
      cardLookup,
    };

    expect(() => initGameFromDecks(config)).toThrow('Invalid AI count');
  });

  it('throws for invalid difficulty', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [createTestDeck('AI Commander 1')],
      aiDifficulty: 6,
      cardLookup,
    };

    expect(() => initGameFromDecks(config)).toThrow('Invalid difficulty');
  });

  it('initializes turn and phase correctly', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [createTestDeck('AI Commander 1')],
      aiDifficulty: 3,
      cardLookup,
    };

    const state = initGameFromDecks(config);

    expect(state.turnNumber).toBe(1);
    expect(state.phase).toBe('beginning');
    expect(state.step).toBe('upkeep');
  });

  it('cards in library minus hand equals 92', () => {
    const config: GameInitConfig = {
      humanDeck: createTestDeck('Human Commander'),
      aiDecks: [createTestDeck('AI Commander 1')],
      aiDifficulty: 3,
      cardLookup,
      startingHandSize: 7,
    };

    const state = initGameFromDecks(config);

    // 99 cards - 7 in hand = 92 in library
    const humanLibraryCount = Array.from(state.cards.values())
      .filter(c => c.ownerId === 'human' && c.zone === 'library').length;
    expect(humanLibraryCount).toBe(92);
  });
});

describe('helper functions', () => {
  let testCards: ScryfallCard[];
  let cardLookup: ReturnType<typeof createCardLookup>;

  beforeEach(() => {
    resetInstanceCounter();
    testCards = createTestCards();
    cardLookup = createCardLookup(testCards);
  });

  describe('getHumanPlayer', () => {
    it('returns the human player', () => {
      const config: GameInitConfig = {
        humanDeck: createTestDeck('Human Commander'),
        aiDecks: [createTestDeck('AI Commander 1')],
        aiDifficulty: 3,
        cardLookup,
      };

      const state = initGameFromDecks(config);
      const human = getHumanPlayer(state);

      expect(human).toBeDefined();
      expect(human!.isAI).toBe(false);
      expect(human!.id).toBe('human');
    });
  });

  describe('getAIPlayers', () => {
    it('returns all AI players', () => {
      const config: GameInitConfig = {
        humanDeck: createTestDeck('Human Commander'),
        aiDecks: [
          createTestDeck('AI Commander 1'),
          createTestDeck('AI Commander 2'),
        ],
        aiDifficulty: 3,
        cardLookup,
      };

      const state = initGameFromDecks(config);
      const aiPlayers = getAIPlayers(state);

      expect(aiPlayers.length).toBe(2);
      expect(aiPlayers.every(p => p.isAI)).toBe(true);
    });
  });

  describe('isAIControlled', () => {
    it('returns true for AI player', () => {
      const config: GameInitConfig = {
        humanDeck: createTestDeck('Human Commander'),
        aiDecks: [createTestDeck('AI Commander 1')],
        aiDifficulty: 3,
        cardLookup,
      };

      const state = initGameFromDecks(config);

      expect(isAIControlled(state, 'ai1')).toBe(true);
    });

    it('returns false for human player', () => {
      const config: GameInitConfig = {
        humanDeck: createTestDeck('Human Commander'),
        aiDecks: [createTestDeck('AI Commander 1')],
        aiDifficulty: 3,
        cardLookup,
      };

      const state = initGameFromDecks(config);

      expect(isAIControlled(state, 'human')).toBe(false);
    });

    it('returns false for unknown player', () => {
      const config: GameInitConfig = {
        humanDeck: createTestDeck('Human Commander'),
        aiDecks: [createTestDeck('AI Commander 1')],
        aiDifficulty: 3,
        cardLookup,
      };

      const state = initGameFromDecks(config);

      expect(isAIControlled(state, 'unknown')).toBe(false);
    });
  });
});
