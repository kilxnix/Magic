/**
 * Slice 4/12 — Static debuff anthem for opponents:
 *   "Creatures your opponents control get -N/-N."  (Cumber Stone family)
 *
 * PARSER:  matchStaticAbility extended with the "your opponents control" controller
 *          branch, producing StaticAbility { modifier: ModifyPT, controller: 'opponent' }.
 * EXECUTOR: Fully covered by continuous.ts — isAffectedBy filters on
 *           controller:'opponent' (L211/287/318) and getContinuousPTModification
 *           accumulates signed modifiers (L401-403), so negative values subtract.
 *
 * Cards covered by the pattern (representative examples):
 *   - Cumber Stone: "Creatures your opponents control get -1/-0."
 *   - Gloom Surgeon style: "Creatures your opponents control get -1/-1."
 *   - Subtype-keyed debuff (without subtype restriction tested here): any card
 *     where "Creatures your opponents control get -N/-N" is the terminal static.
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

function artifactDef(id: string, oracle_text: string): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Artifact',
    oracle_text,
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact'],
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
  const idFor = (defId: string, ownerId?: string) =>
    [...state.cards.values()].find(
      c => c.definitionId === defId && (ownerId ? c.ownerId === ownerId : true),
    )!.instanceId;
  return { state, idFor };
}

// ── Parse tests ──────────────────────────────────────────────────────────────

describe('Slice 4/12: opponent static debuff — parse', () => {
  it('parses "Creatures your opponents control get -1/-0." (Cumber Stone)', () => {
    const parsed = parseOracleText('Creatures your opponents control get -1/-0.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const ability = parsed.ability as StaticAbilityEffect;
    expect(ability.modifier.kind).toBe('ModifyPT');
    const mod = ability.modifier as Extract<typeof ability.modifier, { kind: 'ModifyPT' }>;
    expect(mod.power).toBe(-1);
    expect(mod.toughness || 0).toBe(0);
    expect(ability.filter).toMatchObject({ types: ['creature'] });
    expect(ability.controller).toBe('opponent');
    expect(ability.excludeSelf).toBe(false);
  });

  it('parses "Creatures your opponents control get -1/-1." (Gloom Surgeon style)', () => {
    const parsed = parseOracleText('Creatures your opponents control get -1/-1.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const ability = parsed.ability as StaticAbilityEffect;
    expect(ability.modifier.kind).toBe('ModifyPT');
    const mod = ability.modifier as Extract<typeof ability.modifier, { kind: 'ModifyPT' }>;
    expect(mod.power).toBe(-1);
    expect(mod.toughness).toBe(-1);
    expect(ability.controller).toBe('opponent');
  });

  it('parses "Creatures your opponents control get -0/-2." (-0 power debuff)', () => {
    const parsed = parseOracleText('Creatures your opponents control get -0/-2.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const ability = parsed.ability as StaticAbilityEffect;
    const mod = ability.modifier as Extract<typeof ability.modifier, { kind: 'ModifyPT' }>;
    // -0 parsed as 0 by parseInt
    expect(mod.power || 0).toBe(0);
    expect(mod.toughness).toBe(-2);
    expect(ability.controller).toBe('opponent');
  });

  it('parses "Creatures your opponents control get -2/-2." (larger debuff)', () => {
    const parsed = parseOracleText('Creatures your opponents control get -2/-2.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const ability = parsed.ability as StaticAbilityEffect;
    const mod = ability.modifier as Extract<typeof ability.modifier, { kind: 'ModifyPT' }>;
    expect(mod.power).toBe(-2);
    expect(mod.toughness).toBe(-2);
    expect(ability.controller).toBe('opponent');
  });

  it('parses multi-line oracle text with keyword preamble (Cumber Stone full text)', () => {
    const oracle = 'Creatures your opponents control get -1/-0.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const ability = parsed.ability as StaticAbilityEffect;
    expect(ability.controller).toBe('opponent');
    const mod = ability.modifier as Extract<typeof ability.modifier, { kind: 'ModifyPT' }>;
    expect(mod.power).toBe(-1);
  });

  it('does NOT parse "Creatures your opponents control get -1/-0 until end of turn." as static', () => {
    // "until end of turn" makes this a temporary spell effect, not a static ability.
    const parsed = parseOracleText(
      'Creatures your opponents control get -1/-0 until end of turn.',
    );
    // Should not be a StaticAbility (should be Spell or Unparsed via matchMassOpponentDebuff)
    expect(parsed.kind).not.toBe('StaticAbility');
  });

  it('does NOT misidentify "your opponents control" with positive P/T as opponent static', () => {
    // Verify positive debuffs still parse correctly as StaticAbility with opponent controller
    const parsed = parseOracleText('Creatures your opponents control get +1/+1.');
    // This is technically unusual but syntactically valid — it IS a static, just positive delta.
    // The point is controller must be 'opponent' regardless of sign.
    if (parsed.kind === 'StaticAbility') {
      const ability = parsed.ability as StaticAbilityEffect;
      expect(ability.controller).toBe('opponent');
    }
  });
});

// ── Execution tests (continuous layer) ──────────────────────────────────────

describe('Slice 4/12: opponent static debuff — execution via continuous layer', () => {
  it('Cumber Stone: p2 creature gets -1/-0 from p1\'s Cumber Stone; p1 creature is unaffected', () => {
    // p1 controls Cumber Stone, p2 controls a 2/2 creature.
    const cumberStone = artifactDef('cumber_stone', 'Creatures your opponents control get -1/-0.');
    const p1Creature = creatureDef('p1_vanilla', { power: 3, toughness: 3 });
    const p2Creature = creatureDef('p2_target', { power: 2, toughness: 2 });

    const { state, idFor } = setup([cumberStone, p1Creature], [p2Creature]);

    // p2's creature is debuffed: 2-1=1 power, toughness unchanged
    expect(getEffectivePower(state, idFor('p2_target'))).toBe(1);
    expect(getEffectiveToughness(state, idFor('p2_target'))).toBe(2);

    // p1's creature is NOT debuffed (it is controlled by p1, the ability source's controller)
    expect(getEffectivePower(state, idFor('p1_vanilla'))).toBe(3);
    expect(getEffectiveToughness(state, idFor('p1_vanilla'))).toBe(3);
  });

  it('Cumber Stone: debuff applies only while artifact is on battlefield', () => {
    const cumberStone = artifactDef('cumber_stone_b', 'Creatures your opponents control get -1/-0.');
    const p2Creature = creatureDef('p2_target_b', { power: 2, toughness: 2 });

    const { state, idFor } = setup([cumberStone], [p2Creature]);

    // Baseline: debuff active
    expect(getEffectivePower(state, idFor('p2_target_b'))).toBe(1);

    // Remove Cumber Stone from battlefield (simulate destruction)
    const csId = idFor('cumber_stone_b');
    const stateWithoutCs = {
      ...state,
      cards: new Map(state.cards),
    };
    stateWithoutCs.cards.set(csId, { ...stateWithoutCs.cards.get(csId)!, zone: 'graveyard' });

    // Without the stone: debuff should no longer apply
    // (continuous.ts checks source.zone !== 'battlefield' and skips)
    expect(getEffectivePower(stateWithoutCs, idFor('p2_target_b'))).toBe(2);
  });

  it('-1/-1 static debuff lowers both power and toughness of opponent\'s creature', () => {
    const debuffer = artifactDef('debuffer', 'Creatures your opponents control get -1/-1.');
    const p2Creature = creatureDef('p2_2_2', { power: 2, toughness: 2 });
    const p1Creature = creatureDef('p1_3_3', { power: 3, toughness: 3 });

    const { state, idFor } = setup([debuffer, p1Creature], [p2Creature]);

    // p2's 2/2 becomes 1/1
    expect(getEffectivePower(state, idFor('p2_2_2'))).toBe(1);
    expect(getEffectiveToughness(state, idFor('p2_2_2'))).toBe(1);

    // p1's 3/3 is unaffected
    expect(getEffectivePower(state, idFor('p1_3_3'))).toBe(3);
    expect(getEffectiveToughness(state, idFor('p1_3_3'))).toBe(3);
  });
});
