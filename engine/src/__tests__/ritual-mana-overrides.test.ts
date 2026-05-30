import { describe, expect, it } from 'vitest';
import { executeEffects } from '../effects/executor';
import { getOverride } from '../effects/overrides';
import type { CardDefinition, CardInstance, GameState } from '../types';

type Zone = CardInstance['zone'];

function definition(id: string, name: string, typeLine: string, cardTypes: CardDefinition['card_types']): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: cardTypes,
    power: cardTypes.includes('creature') ? 1 : undefined,
    toughness: cardTypes.includes('creature') ? 1 : undefined,
  };
}

function instance(instanceId: string, definitionId: string, ownerId: string, zone: Zone): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
}

function baseState(): GameState {
  return {
    players: [
      {
        id: 'p1',
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
        id: 'p2',
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
    cards: new Map(),
    cardDefinitions: new Map([
      ['creature-def', definition('creature-def', 'Graveyard Creature', 'Creature - Test', ['creature'])],
      ['spell-def', definition('spell-def', 'Spent Spell', 'Instant', ['instant'])],
      ['rite-def', definition('rite-def', 'Rite of Flame', 'Sorcery', ['sorcery'])],
    ]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'main',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
  };
}

function withCards(state: GameState, cards: CardInstance[]): GameState {
  return { ...state, cards: new Map(cards.map(card => [card.instanceId, card])) };
}

function resolveSpellOverride(state: GameState, name: string): GameState {
  const override = getOverride('any', name);
  expect(override?.kind).toBe('Spell');
  if (!override || override.kind !== 'Spell') return state;
  return executeEffects(state, override.effects, 'p1', [], []);
}

describe('ritual mana overrides', () => {
  it('applies Cabal Ritual threshold only at seven cards in your graveyard', () => {
    const sixCards = withCards(baseState(), Array.from({ length: 6 }, (_, index) =>
      instance(`spent-${index}`, 'spell-def', 'p1', 'graveyard')
    ));
    const withoutThreshold = resolveSpellOverride(sixCards, 'Cabal Ritual');
    expect(withoutThreshold.players[0].manaPool.B).toBe(3);

    const sevenCards = withCards(baseState(), Array.from({ length: 7 }, (_, index) =>
      instance(`spent-${index}`, 'spell-def', 'p1', 'graveyard')
    ));
    const withThreshold = resolveSpellOverride(sevenCards, 'Cabal Ritual');
    expect(withThreshold.players[0].manaPool.B).toBe(5);
  });

  it('scales Rite of Flame from cards named Rite of Flame in every graveyard', () => {
    const state = withCards(baseState(), [
      instance('p1-rite', 'rite-def', 'p1', 'graveyard'),
      instance('p2-rite', 'rite-def', 'p2', 'graveyard'),
      instance('p1-other', 'spell-def', 'p1', 'graveyard'),
    ]);

    const next = resolveSpellOverride(state, 'Rite of Flame');
    expect(next.players[0].manaPool.R).toBe(4);
  });

  it('counts only your creature cards for Songs of the Damned', () => {
    const state = withCards(baseState(), [
      instance('p1-creature-1', 'creature-def', 'p1', 'graveyard'),
      instance('p1-creature-2', 'creature-def', 'p1', 'graveyard'),
      instance('p1-creature-3', 'creature-def', 'p1', 'graveyard'),
      instance('p1-spell', 'spell-def', 'p1', 'graveyard'),
      instance('p2-creature', 'creature-def', 'p2', 'graveyard'),
    ]);

    const next = resolveSpellOverride(state, 'Songs of the Damned');
    expect(next.players[0].manaPool.B).toBe(3);
  });
});
