/**
 * Slice 4 — All-subtype anthem tests.
 *
 * Covers:
 *   - Parser recognition for P/T-boost and keyword-grant forms
 *   - Execution via the continuous layer (modifyPT + grantKeyword)
 *   - "All Slivers" (plural-only form) and "All Sliver creatures" (explicit form)
 *   - controller:'any' scope: anthems from p1's Sliver buff ALL matching creatures,
 *     including p2's creatures of the same subtype
 *   - Negative cases that must NOT parse as static abilities (temporary spell forms)
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import {
  getEffectivePower,
  getEffectiveToughness,
  getGrantedKeywords,
} from '../effects/continuous';
import { getCardsInZone, initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition } from '../types';

// ============================================================================
// Helpers
// ============================================================================

function creature(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Test',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 1,
    toughness: opts.toughness ?? 1,
  };
}

/**
 * Build a two-player game state with all provided defs on the battlefield and
 * continuous effects registered — mirrors the real ETB pipeline.
 */
function setup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[] = [creature('p2dummy')],
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];
  let state = initGameState(decks);
  // Put everything on the battlefield (not in library).
  for (const [id, card] of state.cards) {
    state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
  }
  // Register continuous statics for every battlefield permanent.
  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }
  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;
  return { state, idFor };
}

// ============================================================================
// Parser-level tests
// ============================================================================

describe('matchAllSubtypeAnthem — parser recognition', () => {
  it('Muscle Sliver: "All Sliver creatures get +1/+1" parses as StaticAbility', () => {
    const r = parseOracleText('All Sliver creatures get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['sliver'] });
    expect(r.ability.controller).toBe('any');
    expect(r.ability.excludeSelf).toBe(false);
    expect(r.ability.selfOnly).toBeFalsy();
  });

  it('Winged Sliver: "All Slivers have flying" parses as StaticAbility (plural-only form)', () => {
    const r = parseOracleText('All Slivers have flying.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'flying' });
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['sliver'] });
    expect(r.ability.controller).toBe('any');
  });

  it('Fury Sliver: "All Sliver creatures have double strike" parses as StaticAbility', () => {
    const r = parseOracleText('All Sliver creatures have double strike.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'double strike' });
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['sliver'] });
    expect(r.ability.controller).toBe('any');
  });

  it('Goblin King style: "All Goblin creatures get +1/+1" parses correctly', () => {
    const r = parseOracleText('All Goblin creatures get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['goblin'] });
    expect(r.ability.controller).toBe('any');
  });

  it('Haste-granting sliver: "All Slivers have haste" parses as StaticAbility', () => {
    const r = parseOracleText('All Slivers have haste.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'haste' });
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['sliver'] });
  });

  it('first strike form: "All Sliver creatures have first strike" parses correctly', () => {
    const r = parseOracleText('All Sliver creatures have first strike.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'first strike' });
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['sliver'] });
    expect(r.ability.controller).toBe('any');
  });

  it('unknown subtype does NOT parse as StaticAbility', () => {
    // "Phyrexian" is not in the known-subtype map, so we decline
    const r = parseOracleText('All Phyrexian creatures get +1/+1.');
    expect(r.kind).not.toBe('StaticAbility');
  });

  it('temporary form "All Slivers get +1/+1 until end of turn" does NOT parse as StaticAbility', () => {
    const r = parseOracleText('All Slivers get +1/+1 until end of turn.');
    // Should NOT be claimed as a static ability (it's a spell effect)
    expect(r.kind).not.toBe('StaticAbility');
  });
});

// ============================================================================
// Execution tests — continuous layer applies the anthem correctly
// ============================================================================

describe('matchAllSubtypeAnthem — execution (continuous layer)', () => {
  it('Muscle Sliver P/T boost applies to all Slivers on the battlefield (both players)', () => {
    // p1 has Muscle Sliver (the anthem source) + a plain Sliver
    // p2 has a Sliver too; all three should be boosted
    const muscleDef = creature('muscle', {
      name: 'Muscle Sliver',
      type_line: 'Creature — Sliver',
      oracle_text: 'All Sliver creatures get +1/+1.',
      power: 1,
      toughness: 1,
    });
    const plainSliver1 = creature('sliver1', {
      name: 'Sliver1',
      type_line: 'Creature — Sliver',
      power: 1,
      toughness: 1,
    });
    const plainSliver2 = creature('sliver2', {
      name: 'Sliver2',
      type_line: 'Creature — Sliver',
      power: 1,
      toughness: 1,
    });

    const { state, idFor } = setup(
      [muscleDef, plainSliver1],
      [plainSliver2],
    );

    // All three Slivers should be 2/2 after the +1/+1 boost
    expect(getEffectivePower(state, idFor('muscle'))).toBe(2);
    expect(getEffectiveToughness(state, idFor('muscle'))).toBe(2);
    expect(getEffectivePower(state, idFor('sliver1'))).toBe(2);
    expect(getEffectiveToughness(state, idFor('sliver1'))).toBe(2);
    expect(getEffectivePower(state, idFor('sliver2'))).toBe(2);
    expect(getEffectiveToughness(state, idFor('sliver2'))).toBe(2);
  });

  it('Winged Sliver keyword grant gives flying to all Slivers', () => {
    const wingedDef = creature('winged', {
      name: 'Winged Sliver',
      type_line: 'Creature — Sliver',
      oracle_text: 'All Slivers have flying.',
      power: 1,
      toughness: 1,
    });
    const plainSliver = creature('plain', {
      name: 'Plain Sliver',
      type_line: 'Creature — Sliver',
      power: 1,
      toughness: 1,
    });
    const nonSliver = creature('non', {
      name: 'Non-Sliver',
      type_line: 'Creature — Elf',
      power: 1,
      toughness: 1,
    });

    const { state, idFor } = setup([wingedDef, plainSliver, nonSliver]);

    const wingedKws = getGrantedKeywords(state, idFor('winged'));
    const plainKws = getGrantedKeywords(state, idFor('plain'));
    const nonKws = getGrantedKeywords(state, idFor('non'));

    // Both Slivers get flying
    expect(wingedKws).toContain('flying');
    expect(plainKws).toContain('flying');
    // Non-Sliver should NOT get flying
    expect(nonKws).not.toContain('flying');
  });

  it('anthem does NOT boost non-Slivers', () => {
    const muscleDef = creature('muscle', {
      name: 'Muscle Sliver',
      type_line: 'Creature — Sliver',
      oracle_text: 'All Sliver creatures get +1/+1.',
      power: 1,
      toughness: 1,
    });
    const elfDef = creature('elf', {
      name: 'Llanowar Elves',
      type_line: 'Creature — Elf Druid',
      power: 1,
      toughness: 1,
    });

    const { state, idFor } = setup([muscleDef, elfDef]);

    // Sliver gets boosted to 2/2
    expect(getEffectivePower(state, idFor('muscle'))).toBe(2);
    // Elf stays at 1/1
    expect(getEffectivePower(state, idFor('elf'))).toBe(1);
    expect(getEffectiveToughness(state, idFor('elf'))).toBe(1);
  });

  it('stacking two Sliver anthems gives cumulative P/T boost', () => {
    // Two Muscle Sliver instances: each gives +1/+1, so all Slivers should be +2/+2
    const muscle1 = creature('muscle1', {
      name: 'Muscle Sliver 1',
      type_line: 'Creature — Sliver',
      oracle_text: 'All Sliver creatures get +1/+1.',
      power: 1,
      toughness: 1,
    });
    const muscle2 = creature('muscle2', {
      name: 'Muscle Sliver 2',
      type_line: 'Creature — Sliver',
      oracle_text: 'All Sliver creatures get +1/+1.',
      power: 1,
      toughness: 1,
    });

    const { state, idFor } = setup([muscle1, muscle2]);

    // Each is boosted by both anthems: base 1 + 2 = 3/3
    expect(getEffectivePower(state, idFor('muscle1'))).toBe(3);
    expect(getEffectiveToughness(state, idFor('muscle1'))).toBe(3);
    expect(getEffectivePower(state, idFor('muscle2'))).toBe(3);
    expect(getEffectiveToughness(state, idFor('muscle2'))).toBe(3);
  });
});
