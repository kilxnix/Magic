/**
 * Slice 8 — Filtered mass P/T effects
 *
 * Two adjacent static/mass gaps:
 *  1. "Creatures your opponents control get -2/-0 until end of turn."
 *     (Turn the Tide family, 10 faces) — mass opponent debuff spell effect.
 *  2. "Other creatures you control with flying get +1/+1."
 *     (Thunderclap Wyvern family, 4+ faces) — keyword-holder static anthem.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition, GameState, CardInstance } from '../types';
import { createPlayer } from '../types';
import type { Effect, ModifyPTEffect, StaticAbilityEffect } from '../effects/ast';

// ── Helpers ──────────────────────────────────────────────────────────────────

function spellEffects(text: string): Effect[] {
  const parsed = parseOracleText(text);
  if (parsed.kind !== 'Spell') {
    throw new Error(`Expected Spell, got ${parsed.kind} for: ${text}`);
  }
  return parsed.effects;
}

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

/**
 * Build a two-player game state with the given card definitions.
 * All cards start on the battlefield; continuous abilities are registered.
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

// ── Part 1: Mass opponent debuff (Turn the Tide family) ───────────────────────

describe('Slice 8: mass opponent debuff — parse (Turn the Tide family)', () => {
  it('parses "Creatures your opponents control get -2/-0 until end of turn."', () => {
    const es = spellEffects('Creatures your opponents control get -2/-0 until end of turn.');
    expect(es).toHaveLength(1);
    const e = es[0] as ModifyPTEffect;
    expect(e.kind).toBe('ModifyPT');
    expect(e.power).toBe(-2);
    // parseInt('-0') gives -0; normalise for the assertion
    expect(e.toughness || 0).toBe(0);
    expect(e.untilEndOfTurn).toBe(true);
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'] },
      opponentControls: true,
    });
  });

  it('parses the "each creature your opponents control gets" variant', () => {
    const es = spellEffects('Each creature your opponents control gets -1/-1 until end of turn.');
    expect(es).toHaveLength(1);
    const e = es[0] as ModifyPTEffect;
    expect(e.kind).toBe('ModifyPT');
    expect(e.power).toBe(-1);
    expect(e.toughness).toBe(-1);
    expect(e.untilEndOfTurn).toBe(true);
    expect(e.target).toMatchObject({ kind: 'AllOfType', opponentControls: true });
  });

  it('parses combined -2/-0 inside a multi-line face (trigger body) via parseEffectClauseInternal', () => {
    // A triggered ability body also goes through parseEffectClauseInternal.
    const parsed = parseOracleText(
      'When ~ enters, creatures your opponents control get -2/-0 until end of turn.',
    );
    expect(parsed.kind).not.toBe('Unparsed');
    // It may parse as ETB or Triggered; either way the effect should be present.
    const ability = (parsed as { ability?: { effects: Effect[] } }).ability;
    if (ability) {
      const e = ability.effects[0] as ModifyPTEffect;
      expect(e.kind).toBe('ModifyPT');
      expect(e.power).toBe(-2);
      expect(e.target).toMatchObject({ kind: 'AllOfType', opponentControls: true });
    }
  });

  it('does NOT parse a positive-delta "opponents get +N/+N" (would need a different matcher)', () => {
    // Positive grants to opponents are unusual and not claimed by this matcher.
    const parsed = parseOracleText('Creatures your opponents control get +2/+2 until end of turn.');
    // This should NOT match matchMassOpponentDebuff (power > 0 && toughness > 0 rejected).
    // It may parse via another matcher or remain Unparsed — either is acceptable.
    if (parsed.kind === 'Spell') {
      const e = parsed.effects[0] as ModifyPTEffect;
      // If it did parse, it must not have used the opponentControls path.
      expect(e.target).not.toMatchObject({ opponentControls: true });
    }
  });
});

describe('Slice 8: mass opponent debuff — execution', () => {
  it('applies -2/-0 only to opponents\' creatures, not the caster\'s', () => {
    // p1 owns the spell (caster). p2's creatures should be debuffed.
    const p1Creature = creatureDef('p1_creature', { power: 3, toughness: 3 });
    const p2Creature = creatureDef('p2_creature', { power: 3, toughness: 3 });
    const { state, idFor } = setup([p1Creature], [p2Creature]);

    const p1Id = idFor('p1_creature');
    const p2Id = idFor('p2_creature');

    // Parse the spell
    const parsed = parseOracleText('Creatures your opponents control get -2/-0 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const newState = executeEffects(state, parsed.effects, 'p1', [], [], 0, {});

    // p2's creature gets -2 power; toughness unchanged
    const p2After = newState.cards.get(p2Id)!;
    expect(p2After.counters['_powerMod'] ?? 0).toBe(-2);

    // p1's creature is untouched
    const p1After = newState.cards.get(p1Id)!;
    expect(p1After.counters['_powerMod'] ?? 0).toBe(0);
  });

  it('effects are scoped to battlefield creatures (not graveyard)', () => {
    const p2Creature = creatureDef('p2_dead', { power: 3, toughness: 3 });
    const { state, idFor } = setup(
      [creatureDef('p1_dummy')],
      [p2Creature],
    );
    const p2Id = idFor('p2_dead');
    // Move p2's creature to graveyard
    let stateWithDead = state;
    stateWithDead.cards.set(p2Id, { ...stateWithDead.cards.get(p2Id)!, zone: 'graveyard' });

    const parsed = parseOracleText('Creatures your opponents control get -2/-0 until end of turn.');
    if (parsed.kind !== 'Spell') return;

    const newState = executeEffects(stateWithDead, parsed.effects, 'p1', [], [], 0, {});
    // Graveyard creature should be unmodified
    expect(newState.cards.get(p2Id)!.counters['_powerMod'] ?? 0).toBe(0);
  });
});

// ── Part 2: Keyword-holder static anthem (Thunderclap Wyvern family) ──────────

describe('Slice 8: keyword-holder anthem — parse (Thunderclap Wyvern family)', () => {
  it('parses "Other creatures you control with flying get +1/+1." as StaticAbility', () => {
    const parsed = parseOracleText(
      'Flash\nFlying\nOther creatures you control with flying get +1/+1.',
    );
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const ability = parsed.ability as StaticAbilityEffect;
    expect(ability.modifier.kind).toBe('ModifyPT');
    const mod = ability.modifier as Extract<typeof ability.modifier, { kind: 'ModifyPT' }>;
    expect(mod.power).toBe(1);
    expect(mod.toughness).toBe(1);
    expect(ability.filter).toMatchObject({ types: ['creature'], withKeyword: 'flying' });
    expect(ability.excludeSelf).toBe(true);
    expect(ability.controller).toBe('you');
  });

  it('parses the plain "Creatures you control with flying get +1/+0." variant', () => {
    const parsed = parseOracleText('Creatures you control with flying get +1/+0.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const ability = parsed.ability as StaticAbilityEffect;
    const mod = ability.modifier as Extract<typeof ability.modifier, { kind: 'ModifyPT' }>;
    expect(mod.power).toBe(1);
    expect(mod.toughness).toBe(0);
    expect(ability.excludeSelf).toBe(false);
    expect(ability.filter).toMatchObject({ withKeyword: 'flying' });
  });

  it('parses keyword-holder anthem with trample ("Creatures you control with trample get +0/+1.")', () => {
    const parsed = parseOracleText('Creatures you control with trample get +0/+1.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const ability = parsed.ability as StaticAbilityEffect;
    expect(ability.filter.withKeyword).toBe('trample');
  });
});

describe('Slice 8: keyword-holder anthem — execution via continuous layer', () => {
  it('Thunderclap Wyvern: only flying creatures owned by p1 get +1/+1 (excludes source itself)', () => {
    // Thunderclap Wyvern-like card: "Other creatures you control with flying get +1/+1."
    const wyvern = creatureDef('wyvern', {
      oracle_text: 'Other creatures you control with flying get +1/+1.',
      keywords: ['Flying'],
      power: 2,
      toughness: 4,
    });
    // A flying creature owned by p1 — should get the buff
    const flyer = creatureDef('flyer_p1', {
      keywords: ['Flying'],
      power: 1,
      toughness: 1,
    });
    // A non-flying creature owned by p1 — should NOT get the buff
    const walker = creatureDef('walker_p1', {
      keywords: [],
      power: 2,
      toughness: 2,
    });
    // A flying creature owned by p2 — should NOT get the buff (different controller)
    const enemy_flyer = creatureDef('flyer_p2', {
      keywords: ['Flying'],
      power: 1,
      toughness: 1,
    });

    const { state, idFor } = setup(
      [wyvern, flyer, walker],
      [enemy_flyer],
    );

    const wyvernId = idFor('wyvern');
    const flyerId = idFor('flyer_p1');
    const walkerId = idFor('walker_p1');
    const enemyFlyerId = idFor('flyer_p2');

    // Wyvern itself: excludeSelf = true, so no buff even though it has flying
    expect(getEffectivePower(state, wyvernId)).toBe(2);
    expect(getEffectiveToughness(state, wyvernId)).toBe(4);

    // p1's flyer gets +1/+1
    expect(getEffectivePower(state, flyerId)).toBe(2);
    expect(getEffectiveToughness(state, flyerId)).toBe(2);

    // p1's walker gets no buff
    expect(getEffectivePower(state, walkerId)).toBe(2);
    expect(getEffectiveToughness(state, walkerId)).toBe(2);

    // p2's flyer gets no buff (different controller)
    expect(getEffectivePower(state, enemyFlyerId)).toBe(1);
    expect(getEffectiveToughness(state, enemyFlyerId)).toBe(1);
  });

  it('keyword-holder anthem does not affect the source (Thunderclap Wyvern excludeSelf check)', () => {
    const wyvern = creatureDef('wyvern2', {
      oracle_text: 'Other creatures you control with flying get +1/+1.',
      keywords: ['Flying'],
      power: 2,
      toughness: 4,
    });
    const { state, idFor } = setup([wyvern], [creatureDef('dummy_p2')]);
    const wyvernId = idFor('wyvern2');
    // No buff on the source itself
    expect(getEffectivePower(state, wyvernId)).toBe(2);
    expect(getEffectiveToughness(state, wyvernId)).toBe(4);
  });
});

// ── Part 3: "Creatures with flying get -N/-N until end of turn" spell form ────

describe('Slice 8: mass keyword-holder debuff spell — parse', () => {
  it('parses "Creatures with flying get -1/-1 until end of turn."', () => {
    const es = spellEffects('Creatures with flying get -1/-1 until end of turn.');
    expect(es).toHaveLength(1);
    const e = es[0] as ModifyPTEffect;
    expect(e.kind).toBe('ModifyPT');
    expect(e.power).toBe(-1);
    expect(e.toughness).toBe(-1);
    expect(e.untilEndOfTurn).toBe(true);
    expect(e.target).toMatchObject({
      kind: 'AllOfType',
      filter: { types: ['creature'], withKeyword: 'flying' },
    });
  });

  it('parses "All creatures with flying get -2/-0 until end of turn."', () => {
    const es = spellEffects('All creatures with flying get -2/-0 until end of turn.');
    expect(es).toHaveLength(1);
    const e = es[0] as ModifyPTEffect;
    expect(e.power).toBe(-2);
    // parseInt('-0') gives -0; normalise for the assertion
    expect(e.toughness || 0).toBe(0);
    expect(e.target).toMatchObject({ kind: 'AllOfType', filter: { withKeyword: 'flying' } });
  });
});
