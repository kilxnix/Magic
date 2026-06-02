import { describe, expect, it } from 'vitest';
import { executeEffects } from '../effects/executor';
import { getOverride } from '../effects/overrides';
import { resolveTopOfStack } from '../stack';
import type { CardDefinition, CardInstance, GameState } from '../types';

function def(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Instant',
    oracle_text: '',
    mana_cost: '{U}',
    cmc: 1,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['instant'],
  };
}

function card(instanceId: string, definitionId: string, zone: CardInstance['zone']): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId: 'p1',
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
}

function stateWithBrainstormCards(): GameState {
  const definitions = [
    def('hand-a-def', 'Hand A'),
    def('hand-b-def', 'Hand B'),
    def('draw-a-def', 'Draw A'),
    def('draw-b-def', 'Draw B'),
    def('draw-c-def', 'Draw C'),
    def('rest-def', 'Rest'),
    def('fact-def', 'Fact or Fiction'),
  ];
  return {
    players: [{
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
    }],
    cards: new Map([
      ['hand-a', card('hand-a', 'hand-a-def', 'hand')],
      ['hand-b', card('hand-b', 'hand-b-def', 'hand')],
      ['draw-a', card('draw-a', 'draw-a-def', 'library')],
      ['draw-b', card('draw-b', 'draw-b-def', 'library')],
      ['draw-c', card('draw-c', 'draw-c-def', 'library')],
      ['rest', card('rest', 'rest-def', 'library')],
      ['fact', card('fact', 'fact-def', 'hand')],
    ]),
    cardDefinitions: new Map(definitions.map(definition => [definition.id, definition])),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'main',
    turnNumber: 1,
    hasPriorityPassed: [false],
    stack: [],
    combat: null,
  };
}

function resolveOverride(state: GameState, name: string, choices?: Record<string, string>): GameState {
  const override = getOverride('any', name);
  expect(override?.kind).toBe('Spell');
  if (!override || override.kind !== 'Spell') return state;
  return executeEffects(state, override.effects, 'p1', [], [], 0, { namedCardChoices: choices });
}

function resolveBrainstorm(state: GameState, choices?: Record<string, string>): GameState {
  return resolveOverride(state, 'Brainstorm', choices);
}

describe('Brainstorm card selection', () => {
  it('puts chosen hand cards back on top in chosen order after drawing three', () => {
    const next = resolveBrainstorm(stateWithBrainstormCards(), {
      putOnTopIds: 'draw-b,hand-a',
    });

    const libraryOrder = [...next.cards.values()]
      .filter(instance => instance.ownerId === 'p1' && instance.zone === 'library')
      .map(instance => instance.instanceId);

    expect(libraryOrder).toEqual(['draw-b', 'hand-a', 'rest']);
    expect(next.cards.get('draw-a')?.zone).toBe('hand');
    expect(next.cards.get('draw-c')?.zone).toBe('hand');
    expect(next.cards.get('hand-b')?.zone).toBe('hand');
  });

  it('waits for a follow-up choice instead of silently bottoming cards when no selection is supplied', () => {
    const next = resolveBrainstorm(stateWithBrainstormCards());

    expect([...next.cards.values()].filter(instance => instance.ownerId === 'p1' && instance.zone === 'hand'))
      .toHaveLength(6);
    expect([...next.cards.values()].filter(instance => instance.ownerId === 'p1' && instance.zone === 'library').map(instance => instance.instanceId))
      .toEqual(['rest']);
  });
});

describe('See Beyond card selection', () => {
  it('draws two, then shuffles the selected hand card into the library', () => {
    const next = resolveOverride(stateWithBrainstormCards(), 'See Beyond', {
      shuffleIntoLibraryIds: 'hand-a',
    });

    const handIds = [...next.cards.values()]
      .filter(instance => instance.ownerId === 'p1' && instance.zone === 'hand')
      .map(instance => instance.instanceId);
    const libraryIds = [...next.cards.values()]
      .filter(instance => instance.ownerId === 'p1' && instance.zone === 'library')
      .map(instance => instance.instanceId);

    expect(next.cards.get('draw-a')?.zone).toBe('hand');
    expect(next.cards.get('draw-b')?.zone).toBe('hand');
    expect(next.cards.get('hand-a')?.zone).toBe('library');
    expect(handIds).toHaveLength(4);
    expect(libraryIds).toHaveLength(3);
  });
});

describe('top-library pile choices', () => {
  it('resolves Fact or Fiction selected cards to hand and the rest to graveyard', () => {
    const next = resolveOverride(stateWithBrainstormCards(), 'Fact or Fiction', {
      factOrFictionPileIds: 'draw-b,draw-a',
    });

    expect(next.cards.get('draw-a')?.zone).toBe('hand');
    expect(next.cards.get('draw-b')?.zone).toBe('hand');
    expect(next.cards.get('draw-c')?.zone).toBe('graveyard');
    expect(next.cards.get('rest')?.zone).toBe('graveyard');
  });

  it('does not choose a Fact or Fiction pile when no selection is supplied', () => {
    const next = resolveOverride(stateWithBrainstormCards(), 'Fact or Fiction');

    expect(['draw-a', 'draw-b', 'draw-c', 'rest'].map(id => next.cards.get(id)?.zone)).toEqual([
      'library',
      'library',
      'library',
      'library',
    ]);
  });

  it('leaves Fact or Fiction on the stack until its pile choice is supplied', () => {
    const state = stateWithBrainstormCards();
    const fact = state.cards.get('fact')!;
    const onStack: GameState = {
      ...state,
      cards: new Map(state.cards).set('fact', { ...fact, zone: 'stack' }),
      stack: [{
        kind: 'Spell',
        id: 'stack_fact',
        cardInstanceId: 'fact',
        casterId: 'p1',
        targets: [],
      }],
    };

    const next = resolveTopOfStack(onStack);

    expect(next.stack).toHaveLength(1);
    expect(next.cards.get('fact')?.zone).toBe('stack');
    expect(next.cards.get('draw-a')?.zone).toBe('library');
  });
});
