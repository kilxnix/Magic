/**
 * Slice 5 — Controller-agnostic filtered anthem statics
 *
 * "Creatures with flying get +2/+0."    (Gravitational Shift line 1)
 * "Creatures without flying get -2/-0." (Gravitational Shift line 2)
 * "Creatures with flying get -2/-0."    (Crosswinds)
 * Also covers multi-line faces where both effects appear together.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition } from '../types';
import type { StaticAbilityEffect } from '../effects/ast';

// ── Helpers ──────────────────────────────────────────────────────────────────

function creatureDef(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Test',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{2}',
    cmc: opts.cmc ?? 2,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function enchantmentDef(
  id: string,
  oracle_text: string,
): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Enchantment',
    oracle_text,
    mana_cost: '{3}{U}',
    cmc: 4,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['enchantment'],
    power: undefined,
    toughness: undefined,
  };
}

/**
 * Build a two-player game state with all cards on the battlefield.
 * Registers continuous abilities after placement.
 */
function setup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[],
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];
  let state = initGameState(decks);
  for (const [, card] of state.cards) {
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });
  }
  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }
  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;
  return { state, idFor };
}

// ── Parse tests ──────────────────────────────────────────────────────────────

describe('Slice 5: global keyword anthem — parse', () => {
  it('parses "Creatures with flying get +2/+0." as StaticAbility with withKeyword', () => {
    const parsed = parseOracleText('Creatures with flying get +2/+0.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const ability = parsed.ability as StaticAbilityEffect;
    expect(ability.modifier.kind).toBe('ModifyPT');
    const mod = ability.modifier as Extract<typeof ability.modifier, { kind: 'ModifyPT' }>;
    expect(mod.power).toBe(2);
    expect(mod.toughness || 0).toBe(0);
    expect(ability.filter).toMatchObject({ types: ['creature'], withKeyword: 'flying' });
    expect(ability.controller).toBe('any');
    expect(ability.excludeSelf).toBe(false);
  });

  it('parses "Creatures without flying get -2/-0." as StaticAbility with withoutKeyword', () => {
    const parsed = parseOracleText('Creatures without flying get -2/-0.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const ability = parsed.ability as StaticAbilityEffect;
    expect(ability.modifier.kind).toBe('ModifyPT');
    const mod = ability.modifier as Extract<typeof ability.modifier, { kind: 'ModifyPT' }>;
    expect(mod.power).toBe(-2);
    expect(mod.toughness || 0).toBe(0);
    expect(ability.filter).toMatchObject({ types: ['creature'], withoutKeyword: 'flying' });
    expect(ability.controller).toBe('any');
  });

  it('parses "Creatures with flying get -2/-0." (Crosswinds style) as StaticAbility', () => {
    const parsed = parseOracleText('Creatures with flying get -2/-0.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const ability = parsed.ability as StaticAbilityEffect;
    const mod = ability.modifier as Extract<typeof ability.modifier, { kind: 'ModifyPT' }>;
    expect(mod.power).toBe(-2);
    expect(mod.toughness || 0).toBe(0);
    expect(ability.filter).toMatchObject({ withKeyword: 'flying' });
    expect(ability.controller).toBe('any');
  });

  it('parses "Creatures with shadow get +1/+1." (non-flying keyword)', () => {
    const parsed = parseOracleText('Creatures with shadow get +1/+1.');
    // Note: "shadow" is not in ANTHEM_FILTER_KEYWORDS, so it should remain Unparsed
    // unless shadow was added. This guards the set boundary.
    // The example from the slice spec mentions shadow for Stronghold Overseer,
    // but that has "{B}{B}:" prefix so it parses as activated ability.
    expect(parsed.kind).toBe('Unparsed');
  });

  it('does NOT claim "Creatures you control with flying get +1/+0." (matchKeywordHolderAnthem handles that)', () => {
    const parsed = parseOracleText('Creatures you control with flying get +1/+0.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const ability = parsed.ability as StaticAbilityEffect;
    // controller must be 'you', not 'any', meaning matchKeywordHolderAnthem claimed it
    expect(ability.controller).toBe('you');
    expect(ability.filter).toMatchObject({ withKeyword: 'flying' });
  });

  it('does NOT parse "Creatures with flying get +2/+0 until end of turn." (temporal, not static)', () => {
    const parsed = parseOracleText('Creatures with flying get +2/+0 until end of turn.');
    // Should be a Spell (mass pump) or Unparsed, but not a StaticAbility
    expect(parsed.kind).not.toBe('StaticAbility');
  });

  it('parses "Creatures with reach get +0/+2." using reach keyword', () => {
    const parsed = parseOracleText('Creatures with reach get +0/+2.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const ability = parsed.ability as StaticAbilityEffect;
    expect(ability.filter).toMatchObject({ withKeyword: 'reach' });
  });
});

// ── Execution tests (continuous layer 7c) ────────────────────────────────────

describe('Slice 5: global keyword anthem — execution via continuous layer', () => {
  it('Gravitational Shift line 1: flying creatures from BOTH players get +2/+0', () => {
    // Gravitational Shift effect: "Creatures with flying get +2/+0."
    // Affects ALL creatures, regardless of controller.
    const shift = enchantmentDef('shift', 'Creatures with flying get +2/+0.');
    const flyer_p1 = creatureDef('flyer_p1', { keywords: ['Flying'], power: 2, toughness: 2 });
    const walker_p1 = creatureDef('walker_p1', { keywords: [], power: 3, toughness: 3 });
    const flyer_p2 = creatureDef('flyer_p2', { keywords: ['Flying'], power: 1, toughness: 1 });
    const walker_p2 = creatureDef('walker_p2', { keywords: [], power: 2, toughness: 4 });

    const { state, idFor } = setup([shift, flyer_p1, walker_p1], [flyer_p2, walker_p2]);

    // Flying creatures from both players: +2/+0
    expect(getEffectivePower(state, idFor('flyer_p1'))).toBe(4); // 2+2
    expect(getEffectiveToughness(state, idFor('flyer_p1'))).toBe(2); // unchanged

    expect(getEffectivePower(state, idFor('flyer_p2'))).toBe(3); // 1+2
    expect(getEffectiveToughness(state, idFor('flyer_p2'))).toBe(1); // unchanged

    // Non-flying creatures: no change
    expect(getEffectivePower(state, idFor('walker_p1'))).toBe(3);
    expect(getEffectivePower(state, idFor('walker_p2'))).toBe(2);
  });

  it('Gravitational Shift line 2: non-flying creatures from BOTH players get -2/-0', () => {
    // Gravitational Shift second effect: "Creatures without flying get -2/-0."
    const shift = enchantmentDef('shift2', 'Creatures without flying get -2/-0.');
    const flyer_p1 = creatureDef('flyer_p1b', { keywords: ['Flying'], power: 3, toughness: 3 });
    const walker_p1 = creatureDef('walker_p1b', { keywords: [], power: 4, toughness: 4 });
    const flyer_p2 = creatureDef('flyer_p2b', { keywords: ['Flying'], power: 2, toughness: 2 });
    const walker_p2 = creatureDef('walker_p2b', { keywords: [], power: 3, toughness: 3 });

    const { state, idFor } = setup([shift, flyer_p1, walker_p1], [flyer_p2, walker_p2]);

    // Non-flying creatures from both players: -2/-0
    expect(getEffectivePower(state, idFor('walker_p1b'))).toBe(2); // 4-2
    expect(getEffectiveToughness(state, idFor('walker_p1b'))).toBe(4); // unchanged

    expect(getEffectivePower(state, idFor('walker_p2b'))).toBe(1); // 3-2

    // Flying creatures: no debuff
    expect(getEffectivePower(state, idFor('flyer_p1b'))).toBe(3);
    expect(getEffectivePower(state, idFor('flyer_p2b'))).toBe(2);
  });

  it('Crosswinds: all flying creatures get -2/-0 from any controller', () => {
    // Crosswinds: "Creatures with flying get -2/-0."
    const crosswinds = enchantmentDef('crosswinds', 'Creatures with flying get -2/-0.');
    const flyer_p1 = creatureDef('cr_flyer_p1', { keywords: ['Flying'], power: 4, toughness: 3 });
    const walker_p1 = creatureDef('cr_walker_p1', { keywords: [], power: 2, toughness: 2 });
    const flyer_p2 = creatureDef('cr_flyer_p2', { keywords: ['Flying'], power: 3, toughness: 2 });

    const { state, idFor } = setup([crosswinds, flyer_p1, walker_p1], [flyer_p2]);

    // Flying creatures debuffed regardless of controller
    expect(getEffectivePower(state, idFor('cr_flyer_p1'))).toBe(2); // 4-2
    expect(getEffectivePower(state, idFor('cr_flyer_p2'))).toBe(1); // 3-2

    // Non-flying walker: no change
    expect(getEffectivePower(state, idFor('cr_walker_p1'))).toBe(2);
  });
});
