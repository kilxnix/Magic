import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance, TriggeredAbilityRef } from '../types';
import { createPlayer } from '../types';
import { getActivatedAbilities } from '../actions';
import { checkTriggersForEvent } from '../stack';

function makeDef(over: Partial<CardDefinition>): CardDefinition {
  return {
    id: 'def',
    name: 'Test',
    type_line: 'Creature — Test',
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
    ...over,
  };
}

function makeCard(instanceId: string, definitionId: string, over: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId: 'human',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...over,
  };
}

// A Darksteel-Mutation-style aura definition: cached as losesAllAbilities.
function mutationDef(): CardDefinition {
  const d = makeDef({
    id: 'mutation_def',
    name: 'Darksteel Mutation',
    type_line: 'Enchantment — Aura',
    card_types: ['enchantment'],
    oracle_text:
      'Enchanted creature is an Insect artifact creature with base power and toughness 0/1 and has indestructible, and it loses all other abilities.',
  });
  d.equipmentBonus = { power: 0, toughness: 0, keywords: ['Indestructible'], losesAllAbilities: true };
  return d;
}

function baseState(cards: Map<string, CardInstance>, defs: Map<string, CardDefinition>): GameState {
  return {
    players: [createPlayer('human', 'Human'), createPlayer('ai1', 'AI 1')],
    cards,
    cardDefinitions: defs,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'beginning',
    step: 'upkeep',
    turnNumber: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

describe('loses-all-abilities suppresses activated abilities', () => {
  it('a creature with a tap ability offers it normally', () => {
    const def = makeDef({ id: 'pinger', name: 'Pinger', oracle_text: '{T}: Add {C}.' });
    const cards = new Map<string, CardInstance>([['c0', makeCard('c0', 'pinger')]]);
    const defs = new Map<string, CardDefinition>([['pinger', def]]);
    const state = baseState(cards, defs);
    expect(getActivatedAbilities(state, 'c0').length).toBeGreaterThan(0);
  });

  it('the same creature offers no activated abilities once enchanted by Darksteel Mutation', () => {
    const def = makeDef({ id: 'pinger', name: 'Pinger', oracle_text: '{T}: Add {C}.' });
    const cards = new Map<string, CardInstance>([
      ['c0', makeCard('c0', 'pinger')],
      ['aura0', makeCard('aura0', 'mutation_def', { attachedTo: 'c0' })],
    ]);
    const defs = new Map<string, CardDefinition>([['pinger', def], ['mutation_def', mutationDef()]]);
    const state = baseState(cards, defs);
    expect(getActivatedAbilities(state, 'c0')).toEqual([]);
  });
});

describe('loses-all-abilities suppresses triggered abilities', () => {
  const upkeepAbility: TriggeredAbilityRef = {
    kind: 'TriggeredAbility',
    trigger: { kind: 'Upkeep', whose: 'yours' } as TriggeredAbilityRef['trigger'],
    effects: [{ kind: 'Draw', amount: 1, target: { kind: 'You' } } as never],
  };

  it('an upkeep trigger fires normally', () => {
    const def = makeDef({ id: 'oracle', name: 'Oracle', oracle_text: 'At the beginning of your upkeep, draw a card.' });
    const cards = new Map<string, CardInstance>([['c0', makeCard('c0', 'oracle')]]);
    const defs = new Map<string, CardDefinition>([['oracle', def]]);
    const state = baseState(cards, defs);
    state.battlefieldAbilities = new Map([['c0', [upkeepAbility]]]);
    const next = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'human' } as never);
    expect(next.pendingTriggers!.length).toBe(1);
  });

  it('the same upkeep trigger is suppressed once enchanted by Darksteel Mutation', () => {
    const def = makeDef({ id: 'oracle', name: 'Oracle', oracle_text: 'At the beginning of your upkeep, draw a card.' });
    const cards = new Map<string, CardInstance>([
      ['c0', makeCard('c0', 'oracle')],
      ['aura0', makeCard('aura0', 'mutation_def', { attachedTo: 'c0' })],
    ]);
    const defs = new Map<string, CardDefinition>([['oracle', def], ['mutation_def', mutationDef()]]);
    const state = baseState(cards, defs);
    state.battlefieldAbilities = new Map([['c0', [upkeepAbility]]]);
    const next = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'human' } as never);
    expect(next.pendingTriggers!.length).toBe(0);
  });
});
