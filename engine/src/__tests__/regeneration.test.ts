import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { checkStateBasedActions, cleanupDamage } from '../state-based';

function creatureDef(over: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id: 'cdef', name: 'Skeleton', type_line: 'Creature — Skeleton', oracle_text: '',
    mana_cost: '{1}{B}', cmc: 2, colors: ['B'], color_identity: ['B'],
    keywords: [], card_types: ['creature'], power: 2, toughness: 2, ...over,
  };
}

function makeCard(over: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId: 'c0', definitionId: 'cdef', ownerId: 'p0', zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false, ...over,
  };
}

function stateWith(card: CardInstance, def: CardDefinition): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([[card.instanceId, card]]),
    cardDefinitions: new Map([[def.id, def]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'combat', step: 'combat_damage', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

describe('Regeneration parser', () => {
  it('parses "{B}: Regenerate this creature." as an activated ability granting a shield', () => {
    const parsed = parseOracleText('{B}: Regenerate this creature.');
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    expect(parsed.abilities.some(a => a.effects.some(e => e.kind === 'Regenerate'))).toBe(true);
  });

  it('parses "Regenerate target creature." as a spell with a creature target', () => {
    const parsed = parseOracleText('Regenerate target creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects.some(e => e.kind === 'Regenerate')).toBe(true);
    expect(parsed.targets.length).toBe(1);
  });

  it('flags "Destroy target creature. It can\'t be regenerated." with noRegen', () => {
    const parsed = parseOracleText("Destroy target creature. It can't be regenerated.");
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const destroy = parsed.effects.find(e => e.kind === 'Destroy');
    expect(destroy && (destroy as { noRegen?: boolean }).noRegen).toBe(true);
  });
});

describe('Regeneration shield behavior', () => {
  it('a shield saves a creature from lethal combat damage (tapped, damage cleared)', () => {
    let state = stateWith(makeCard({ regenerationShields: 1, damage: 5 }), creatureDef());
    state = checkStateBasedActions(state);
    const c = state.cards.get('c0')!;
    expect(c.zone).toBe('battlefield');
    expect(c.tapped).toBe(true);
    expect(c.damage).toBe(0);
    expect(c.regenerationShields ?? 0).toBe(0); // consumed
  });

  it('without a shield, lethal damage kills the creature', () => {
    let state = stateWith(makeCard({ damage: 5 }), creatureDef());
    state = checkStateBasedActions(state);
    expect(state.cards.get('c0')!.zone).toBe('graveyard');
  });

  it('a regenerate effect adds a shield, which then saves the creature', () => {
    let state = stateWith(makeCard({ damage: 5 }), creatureDef());
    state = executeEffects(state, [{ kind: 'Regenerate', target: { kind: 'Source' } } as never], 'p0', [], [], 0, { sourceInstanceId: 'c0' });
    expect(state.cards.get('c0')!.regenerationShields).toBe(1);
    state = checkStateBasedActions(state);
    expect(state.cards.get('c0')!.zone).toBe('battlefield');
  });

  it('shields expire at end-of-turn cleanup', () => {
    let state = stateWith(makeCard({ regenerationShields: 2 }), creatureDef());
    state = cleanupDamage(state);
    expect(state.cards.get('c0')!.regenerationShields).toBeUndefined();
  });

  it('"can\'t be regenerated" destruction bypasses the shield', () => {
    let state = stateWith(makeCard({ regenerationShields: 1 }), creatureDef());
    state = executeEffects(
      state,
      [{ kind: 'Destroy', target: { kind: 'AllCreatures' }, noRegen: true } as never],
      'p1', [], [],
    );
    expect(state.cards.get('c0')!.zone).toBe('graveyard');
  });

  it('a normal destroy is replaced by the shield', () => {
    let state = stateWith(makeCard({ regenerationShields: 1 }), creatureDef());
    state = executeEffects(
      state,
      [{ kind: 'Destroy', target: { kind: 'AllCreatures' } } as never],
      'p1', [], [],
    );
    const c = state.cards.get('c0')!;
    expect(c.zone).toBe('battlefield');
    expect(c.tapped).toBe(true);
    expect(c.regenerationShields ?? 0).toBe(0);
  });
});
