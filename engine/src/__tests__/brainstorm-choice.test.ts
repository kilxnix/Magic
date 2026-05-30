import { describe, expect, it } from 'vitest';
import { executeEffects } from '../effects/executor';
import { getOverride } from '../effects/overrides';
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
      .toHaveLength(5);
    expect([...next.cards.values()].filter(instance => instance.ownerId === 'p1' && instance.zone === 'library').map(instance => instance.instanceId))
      .toEqual(['rest']);
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

  it('uses a deterministic larger-pile fallback for Fact or Fiction when no pile is supplied', () => {
    const next = resolveOverride(stateWithBrainstormCards(), 'Fact or Fiction');

    expect(['draw-a', 'draw-b', 'draw-c'].map(id => next.cards.get(id)?.zone)).toEqual(['hand', 'hand', 'hand']);
    expect(next.cards.get('rest')?.zone).toBe('graveyard');
  });
});
