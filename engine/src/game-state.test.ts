import { describe, it, expect } from 'vitest';
import {
  initGameState,
  getPlayer,
  getActivePlayer,
  getCardsInZone,
  getSideboard,
  moveSideboardCardIntoGame,
  returnSideboardCardsToSideboard,
} from './game-state';
import { CardDefinition } from './types';

function makeLand(id: string, name: string, color: 'W' | 'U' | 'B' | 'R' | 'G'): CardDefinition {
  return {
    id,
    name,
    type_line: 'Basic Land',
    oracle_text: `{T}: Add {${color}}.`,
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [color],
    keywords: [],
    card_types: ['land'],
  };
}

function makeCreature(id: string, name: string, power: number, toughness: number): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature',
    oracle_text: '',
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
  };
}

describe('Game State', () => {
  it('initializes a 2-player game with correct defaults', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [] as CardDefinition[], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [] as CardDefinition[], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);

    expect(state.players).toHaveLength(2);
    expect(state.players[0].life).toBe(40);
    expect(state.players[1].life).toBe(40);
    expect(state.activePlayerIndex).toBe(0);
    expect(state.turnNumber).toBe(1);
    expect(state.phase).toBe('beginning');
    expect(state.step).toBe('untap');
  });

  it('places deck cards in library zone', () => {
    const cards = [makeLand('l1', 'Forest', 'G'), makeCreature('c1', 'Bear', 2, 2)];
    const decks = [
      { playerId: 'p1', name: 'Alice', cards, commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);

    const libraryCards = getCardsInZone(state, 'p1', 'library');
    expect(libraryCards).toHaveLength(2);
  });

  it('getPlayer returns the correct player', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [] as CardDefinition[], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [] as CardDefinition[], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    const player = getPlayer(state, 'p1');
    expect(player.name).toBe('Alice');
  });

  it('getActivePlayer returns the player whose turn it is', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [] as CardDefinition[], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [] as CardDefinition[], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    const active = getActivePlayer(state);
    expect(active.id).toBe('p1');
  });

  it('supports 4-player games', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [] as CardDefinition[], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [] as CardDefinition[], commanderId: 'cmd2' },
      { playerId: 'p3', name: 'Carol', cards: [] as CardDefinition[], commanderId: 'cmd3' },
      { playerId: 'p4', name: 'Dave', cards: [] as CardDefinition[], commanderId: 'cmd4' },
    ];
    const state = initGameState(decks);
    expect(state.players).toHaveLength(4);
    expect(state.hasPriorityPassed).toHaveLength(4);
  });

  it('keeps sideboard cards outside game zones until an outside-game effect moves them', () => {
    const forest = makeLand('l1', 'Forest', 'G');
    const wishCard = makeCreature('c-side', 'Sideboard Bear', 2, 2);
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [forest], commanderId: 'cmd1', sideboardCards: [wishCard] },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ]);

    expect(getCardsInZone(state, 'p1', 'library')).toHaveLength(1);
    expect(getSideboard(state, 'p1').map(card => card.name)).toEqual(['Sideboard Bear']);

    const withCard = moveSideboardCardIntoGame(state, 'p1', 'Sideboard Bear', 'library');

    expect(getSideboard(withCard, 'p1')).toHaveLength(0);
    expect(getCardsInZone(withCard, 'p1', 'library')[0].fromSideboard).toBe(true);
    expect(withCard.cardDefinitions.get(getCardsInZone(withCard, 'p1', 'library')[0].definitionId)?.name).toBe('Sideboard Bear');

    const cleaned = returnSideboardCardsToSideboard(withCard);

    expect(getCardsInZone(cleaned, 'p1', 'library')).toHaveLength(1);
    expect(getSideboard(cleaned, 'p1').map(card => card.name)).toEqual(['Sideboard Bear']);
  });
});
