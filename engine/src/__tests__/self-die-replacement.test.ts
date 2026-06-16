import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { checkStateBasedActions } from '../state-based';
import { getSelfDieReplacementZone } from '../effects/replacement';

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
    power: 1,
    toughness: 0, // dies on SBA
    ...over,
  };
}

function makeStateWithCreature(def: CardDefinition): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();
  cardDefinitions.set(def.id, def);
  const inst: CardInstance = {
    instanceId: 'c0',
    definitionId: def.id,
    ownerId: 'human',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
  cards.set('c0', inst);
  return {
    players: [createPlayer('human', 'Human'), createPlayer('ai1', 'AI 1')],
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

describe('getSelfDieReplacementZone', () => {
  it('detects "exile it instead" with the card name', () => {
    const def = makeDef({ name: 'Spark Reaper', oracle_text: 'If Spark Reaper would die, exile it instead.' });
    expect(getSelfDieReplacementZone(def)).toBe('exile');
  });

  it('detects "this creature would die ... exile ... instead"', () => {
    const def = makeDef({ oracle_text: 'If this creature would die, exile it instead.' });
    expect(getSelfDieReplacementZone(def)).toBe('exile');
  });

  it('detects "instead exile" word order', () => {
    const def = makeDef({ name: 'Foo', oracle_text: 'If Foo would die, instead exile it.' });
    expect(getSelfDieReplacementZone(def)).toBe('exile');
  });

  it('detects return-to-hand replacement', () => {
    const def = makeDef({
      name: 'Bouncer',
      oracle_text: "If Bouncer would die, return it to its owner's hand instead.",
    });
    expect(getSelfDieReplacementZone(def)).toBe('hand');
  });

  it('returns null for a normal dies trigger (not a replacement)', () => {
    const def = makeDef({ name: 'Watcher', oracle_text: 'When Watcher dies, draw a card.' });
    expect(getSelfDieReplacementZone(def)).toBeNull();
  });

  it('returns null for vanilla creature', () => {
    expect(getSelfDieReplacementZone(makeDef({ oracle_text: '' }))).toBeNull();
  });
});

describe('self die-replacement at the SBA death chokepoint', () => {
  it('a dying creature with "exile it instead" goes to exile, not graveyard', () => {
    const def = makeDef({ name: 'Reaper', oracle_text: 'If Reaper would die, exile it instead.' });
    const state = makeStateWithCreature(def);
    const next = checkStateBasedActions(state);
    expect(next.cards.get('c0')!.zone).toBe('exile');
  });

  it('a dying creature with return-to-hand goes to hand', () => {
    const def = makeDef({
      name: 'Bouncer',
      oracle_text: "If Bouncer would die, return it to its owner's hand instead.",
    });
    const state = makeStateWithCreature(def);
    const next = checkStateBasedActions(state);
    expect(next.cards.get('c0')!.zone).toBe('hand');
  });

  it('a vanilla dying creature still goes to graveyard', () => {
    const def = makeDef({ name: 'Grunt', oracle_text: '' });
    const state = makeStateWithCreature(def);
    const next = checkStateBasedActions(state);
    expect(next.cards.get('c0')!.zone).toBe('graveyard');
  });
});
