import { describe, expect, it } from 'vitest';
import { initGameState } from './game-state';
import { validateStateInvariants } from './invariants';
import type { CardDefinition } from './types';

function commander(): CardDefinition {
  return {
    id: 'cmd',
    name: 'Test Commander',
    type_line: 'Legendary Creature - Human',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
}

describe('validateStateInvariants', () => {
  it('accepts a normal initialized game state', () => {
    const cmd = commander();
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [cmd], commanderId: cmd.id },
      { playerId: 'p2', name: 'Bob', cards: [cmd], commanderId: cmd.id },
    ]);

    expect(validateStateInvariants(state)).toEqual({ ok: true, violations: [] });
  });

  it('rejects stack objects that reference missing cards', () => {
    const cmd = commander();
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [cmd], commanderId: cmd.id },
      { playerId: 'p2', name: 'Bob', cards: [cmd], commanderId: cmd.id },
    ]);
    state.stack = [{
      kind: 'Spell',
      id: 'ghost-spell',
      cardInstanceId: 'missing-card',
      casterId: 'p1',
      targets: [],
    }];

    const report = validateStateInvariants(state);
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual(expect.objectContaining({
      code: 'missing_stack_spell_card',
    }));
  });
});
