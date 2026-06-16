/**
 * Tests for Leyline of the Guildpact — "Each nonland permanent you control is
 * all colors." (Layer 5, CR 613.4b)
 *
 * Covers:
 *   1. Parser recognition (real oracle wording)
 *   2. getEffectiveColors: colorless artifact creature counts as all 5 colors
 *      when the Leyline is on the battlefield
 *   3. matchesCardFilter color check via the isAffectedBy + continuous layer
 *      (a colorless artifact creature satisfies a "green" filter while Leyline
 *      is active)
 *   4. Lands are unaffected (excluded by filter.excludeTypes: ['land'])
 *   5. Removing the Leyline reverts to the printed colors (no more all-colors)
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getEffectiveColors, unregisterContinuousEffects } from '../effects/continuous';
import { matchesCardFilter } from '../effects/executor';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition, CardInstance } from '../types';

// ─── Minimal card builders ───────────────────────────────────────────────────

function permanent(
  id: string,
  opts: Partial<CardDefinition> & { card_types: CardDefinition['card_types'] },
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Artifact',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types,
    power: opts.power,
    toughness: opts.toughness,
  };
}

/** Leyline of the Guildpact (enchantment, no creature types) */
const leylineDef: CardDefinition = permanent('leyline', {
  name: 'Leyline of the Guildpact',
  type_line: 'Enchantment',
  card_types: ['enchantment'],
  colors: ['W', 'U', 'B', 'R', 'G'],
  color_identity: ['W', 'U', 'B', 'R', 'G'],
  oracle_text: 'Each nonland permanent you control is all colors.',
});

/** Colorless 0/0 artifact creature (Phyrexian Marauder style) */
const marauderDef: CardDefinition = permanent('marauder', {
  name: 'Artifact Marauder',
  type_line: 'Artifact Creature — Construct',
  card_types: ['artifact', 'creature'],
  power: 0,
  toughness: 0,
});

/** A basic land — should never be affected by Leyline */
const forestDef: CardDefinition = permanent('forest', {
  name: 'Forest',
  type_line: 'Basic Land — Forest',
  card_types: ['land'],
  cmc: 0,
});

/** A monocolor green creature — also becomes all colors under Leyline */
const bearDef: CardDefinition = permanent('bear', {
  name: 'Grizzly Bears',
  type_line: 'Creature — Bear',
  card_types: ['creature'],
  colors: ['G'],
  color_identity: ['G'],
  power: 2,
  toughness: 2,
});

// ─── Setup helpers ───────────────────────────────────────────────────────────

/**
 * Build a minimal game state with both players' permanents on the battlefield,
 * and register continuous statics for all battlefield permanents.
 */
function setup(p1Defs: CardDefinition[], p2Defs: CardDefinition[] = []) {
  const dummyLand: CardDefinition = permanent('dummy_land', {
    name: 'Plains',
    type_line: 'Basic Land — Plains',
    card_types: ['land'],
    cmc: 0,
  });

  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs.length ? p2Defs : [dummyLand], commanderId: 'none2' },
  ];
  let state = initGameState(decks);

  // Move everything to battlefield, clear summoning sickness
  for (const [id, card] of state.cards) {
    state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
  }

  // Register continuous statics (same path as real ETB pipeline)
  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }

  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;

  return { state, idFor };
}

// ─── 1. Parser tests ─────────────────────────────────────────────────────────

describe('Leyline of the Guildpact — parser', () => {
  it('parses the exact Leyline oracle text as StaticAbility with SetAllColors modifier', () => {
    const result = parseOracleText(
      'Each nonland permanent you control is all colors.',
    );
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('SetAllColors');
    expect(result.ability.filter.excludeTypes).toContain('land');
    expect(result.ability.controller).toBe('you');
    expect(result.ability.excludeSelf).toBe(false);
  });

  it('parses a generic "each nonland permanent is all colors." wording (no controller clause)', () => {
    // Hypothetical wording without "you control" — controller defaults to 'any'
    const result = parseOracleText('Each nonland permanent is all colors.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('SetAllColors');
    expect(result.ability.controller).toBe('any');
  });

  it('does NOT parse unrelated static text as SetAllColors', () => {
    const r = parseOracleText('Creatures you control get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).not.toBe('SetAllColors');
  });
});

// ─── 2. getEffectiveColors — Layer 5 overlay ─────────────────────────────────

describe('Leyline of the Guildpact — getEffectiveColors', () => {
  it('colorless artifact creature has all 5 colors while Leyline is on the battlefield', () => {
    const { state, idFor } = setup([leylineDef, marauderDef]);
    const marauderId = idFor('marauder');
    const colors = getEffectiveColors(state, marauderId);
    expect(colors).toContain('W');
    expect(colors).toContain('U');
    expect(colors).toContain('B');
    expect(colors).toContain('R');
    expect(colors).toContain('G');
  });

  it('green creature also has all 5 colors while Leyline is on the battlefield', () => {
    const { state, idFor } = setup([leylineDef, bearDef]);
    const bearId = idFor('bear');
    const colors = getEffectiveColors(state, bearId);
    expect(colors).toContain('W');
    expect(colors).toContain('U');
    expect(colors).toContain('B');
    expect(colors).toContain('R');
    expect(colors).toContain('G');
  });

  it('land is NOT affected — Forest stays colorless under Leyline', () => {
    const { state, idFor } = setup([leylineDef, forestDef]);
    const forestId = idFor('forest');
    const colors = getEffectiveColors(state, forestId);
    // Forest has no colors in its definition
    expect(colors).toEqual([]);
  });

  it('colorless artifact returns only [] (no SetAllColors) when Leyline is absent', () => {
    const { state, idFor } = setup([marauderDef]);
    const marauderId = idFor('marauder');
    const colors = getEffectiveColors(state, marauderId);
    expect(colors).toEqual([]);
  });

  it('removing the Leyline reverts colors to printed values', () => {
    const { state: stateWith, idFor } = setup([leylineDef, marauderDef]);
    const marauderId = idFor('marauder');
    const leylineId = idFor('leyline');

    // Verify it's all colors with Leyline present
    expect(getEffectiveColors(stateWith, marauderId)).toContain('G');

    // Remove the Leyline's continuous effects (simulates leaving the battlefield)
    const stateWithout = unregisterContinuousEffects(stateWith, leylineId);

    // Now the artifact's effective colors revert to the printed definition: []
    const colorsAfter = getEffectiveColors(stateWithout, marauderId);
    expect(colorsAfter).toEqual([]);
  });
});

// ─── 3. matchesCardFilter integration — color filter reflects Layer 5 ─────────

describe('Leyline of the Guildpact — matchesCardFilter color integration', () => {
  it('colorless artifact creature satisfies a "green" filter while Leyline is active', () => {
    const { state, idFor } = setup([leylineDef, marauderDef]);
    const marauderId = idFor('marauder');
    const matches = matchesCardFilter(
      marauderDef,
      { colors: ['G'] },
      { state, instanceId: marauderId },
    );
    expect(matches).toBe(true);
  });

  it('colorless artifact creature satisfies a "white" filter while Leyline is active', () => {
    const { state, idFor } = setup([leylineDef, marauderDef]);
    const marauderId = idFor('marauder');
    const matches = matchesCardFilter(
      marauderDef,
      { colors: ['W'] },
      { state, instanceId: marauderId },
    );
    expect(matches).toBe(true);
  });

  it('colorless artifact creature does NOT satisfy a "green" filter without Leyline', () => {
    const { state, idFor } = setup([marauderDef]);
    const marauderId = idFor('marauder');
    const matches = matchesCardFilter(
      marauderDef,
      { colors: ['G'] },
      { state, instanceId: marauderId },
    );
    expect(matches).toBe(false);
  });

  it('land is NOT affected — Forest does not satisfy a "white" filter even with Leyline', () => {
    const { state, idFor } = setup([leylineDef, forestDef]);
    const forestId = idFor('forest');
    const matches = matchesCardFilter(
      forestDef,
      { colors: ['W'] },
      { state, instanceId: forestId },
    );
    expect(matches).toBe(false);
  });

  it('multicolored filter is satisfied by colorless artifact while Leyline is active', () => {
    const { state, idFor } = setup([leylineDef, marauderDef]);
    const marauderId = idFor('marauder');
    const matches = matchesCardFilter(
      marauderDef,
      { multicolored: true },
      { state, instanceId: marauderId },
    );
    expect(matches).toBe(true);
  });
});
