/**
 * Slice 3 — Asymmetric cast-time X pump spells
 *   "target creature gets +X/+0 until end of turn"
 *   "target creature gets +0/+X until end of turn"
 *
 * Examples: Howl from Beyond, Enrage, Bloodcurdling Scream
 *
 * The X is determined at cast time from the spell's {X} mana cost (xValue),
 * NOT from a trailing "where X is..." clause (which matchModifyPTWhereX handles).
 * The executor resolves {kind:'X'} via resolveAmount → xValue.
 *
 * Parse tests: verify the correct ModifyPT AST is emitted.
 * Execution tests: verify resolveAmount({kind:'X'}, xValue) applies the correct buff.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, AmountRef } from '../effects/ast';

// ── helpers ──────────────────────────────────────────────────────────────────

function def(
  id: string,
  name: string,
  typeLine: string,
  types: string[],
  pt?: [number, number],
): CardDefinition {
  return {
    id, name, type_line: typeLine, oracle_text: '', mana_cost: '{X}{B}',
    cmc: 1, colors: ['B'], color_identity: ['B'], keywords: [],
    card_types: types as CardDefinition['card_types'],
    ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
  };
}

const DEFS: CardDefinition[] = [
  def('d_goblin', 'Goblin', 'Creature — Goblin', ['creature'], [2, 1]),
  def('d_beast',  'Beast',  'Creature — Beast',  ['creature'], [4, 4]),
];

function mk(id: string, defId: string, owner: string, zone: CardInstance['zone']): CardInstance {
  return {
    instanceId: id, definitionId: defId, ownerId: owner, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function st(cards: CardInstance[]): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(DEFS.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 1,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function spellEffects(text: string): Effect[] {
  const parsed = parseOracleText(text);
  if (parsed.kind !== 'Spell') {
    throw new Error(`Expected Spell, got ${parsed.kind} for: ${text}`);
  }
  return parsed.effects;
}

function expectAmountX(amount: unknown): void {
  expect(typeof amount).toBe('object');
  expect((amount as AmountRef).kind).toBe('X');
}

// ── parse tests ───────────────────────────────────────────────────────────────

describe('slice3 asymmetric-X pump: parse +X/+0 (Howl from Beyond family)', () => {
  it('parses "Target creature gets +X/+0 until end of turn." (Howl from Beyond)', () => {
    const parsed = parseOracleText('Target creature gets +X/+0 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');

    const eff = parsed.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;

    // Power gets +X (cast-time X), toughness gets 0
    expectAmountX(eff.power);
    expect(eff.toughness).toBe(0);
    expect(eff.untilEndOfTurn).toBe(true);
    expect(eff.target.kind).toBe('Chosen');
  });

  it('parses "Target creature gets +X/+0 until end of turn." (Enrage)', () => {
    const es = spellEffects('Target creature gets +X/+0 until end of turn.');
    expect(es).toHaveLength(1);
    expect(es[0].kind).toBe('ModifyPT');
    if (es[0].kind !== 'ModifyPT') return;
    expectAmountX(es[0].power);
    expect(es[0].toughness).toBe(0);
    expect(es[0].untilEndOfTurn).toBe(true);
  });

  it('parses "Target creature gets +X/+0 until end of turn." (Bloodcurdling Scream)', () => {
    // Bloodcurdling Scream: {X}{B} — Target creature gets +X/+0 until end of turn.
    const parsed = parseOracleText('Target creature gets +X/+0 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const eff = parsed.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;
    expectAmountX(eff.power);
    expect(eff.toughness).toBe(0);
  });
});

describe('slice3 asymmetric-X pump: parse +0/+X (toughness-only)', () => {
  it('parses "Target creature gets +0/+X until end of turn."', () => {
    const parsed = parseOracleText('Target creature gets +0/+X until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');

    const eff = parsed.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;

    // Power stays 0, toughness gets +X
    expect(eff.power).toBe(0);
    expectAmountX(eff.toughness);
    expect(eff.untilEndOfTurn).toBe(true);
    expect(eff.target.kind).toBe('Chosen');
  });
});

describe('slice3 asymmetric-X pump: parse with controller constraint', () => {
  it('parses "Target creature you control gets +X/+0 until end of turn."', () => {
    const parsed = parseOracleText('Target creature you control gets +X/+0 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].constraints?.controllerControls).toBe(true);

    const eff = parsed.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;
    expectAmountX(eff.power);
    expect(eff.toughness).toBe(0);
  });
});

describe('slice3 asymmetric-X pump: "where X is ..." forms still go to matchModifyPTWhereX', () => {
  it('does not steal "gets +X/+0 until end of turn, where X is the number of Clerics" from matchModifyPTWhereX', () => {
    const parsed = parseOracleText(
      'Whenever ~ attacks, it gets +X/+0 until end of turn, where X is the number of Clerics on the battlefield.',
    );
    // Should parse as Triggered with a ForEach amount (not a bare {kind:'X'})
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;
    // The amount should be ForEach, NOT {kind:'X'}
    const power = eff.power as AmountRef;
    expect(typeof power).toBe('object');
    expect(power.kind).toBe('ForEach');
  });
});

describe('slice3 asymmetric-X pump: execution', () => {
  it('applies +X/+0 with xValue=3 to target creature (Howl from Beyond)', () => {
    const state = st([
      mk('goblin', 'd_goblin', 'p0', 'battlefield'),
    ]);

    const parsed = parseOracleText('Target creature gets +X/+0 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // executeEffects takes (chosenTargetIds: string[], targetSpecs: {id,count?}[])
    // TargetSpec has .id (the spec's own identifier), not .targetId
    const targetSpec = parsed.targets[0];

    const s = executeEffects(
      state,
      parsed.effects,
      'p0',
      ['goblin'],                    // chosenTargetIds
      [{ id: targetSpec.id }],       // targetSpecs — use .id, not .targetId
      3,                             // xValue = 3
    );

    const goblin = s.cards.get('goblin')!;
    // Goblin was 2/1; +3/+0 → power mod = +3, toughness mod = 0
    expect(goblin.counters['_powerMod']).toBe(3);
    expect(goblin.counters['_toughnessMod'] ?? 0).toBe(0);
  });

  it('applies +0/+X with xValue=5 to target creature (toughness pump)', () => {
    const state = st([
      mk('beast', 'd_beast', 'p0', 'battlefield'),
    ]);

    const parsed = parseOracleText('Target creature gets +0/+X until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const targetSpec = parsed.targets[0];

    const s = executeEffects(
      state,
      parsed.effects,
      'p0',
      ['beast'],                     // chosenTargetIds
      [{ id: targetSpec.id }],       // targetSpecs — use .id
      5,                             // xValue = 5
    );

    const beast = s.cards.get('beast')!;
    // Beast was 4/4; +0/+5 → power mod = 0, toughness mod = +5
    expect(beast.counters['_powerMod'] ?? 0).toBe(0);
    expect(beast.counters['_toughnessMod']).toBe(5);
  });

  it('applies +X/+0 with xValue=0 (X=0 edge case) — no modification', () => {
    const state = st([
      mk('goblin', 'd_goblin', 'p0', 'battlefield'),
    ]);

    const parsed = parseOracleText('Target creature gets +X/+0 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const targetSpec = parsed.targets[0];

    const s = executeEffects(
      state,
      parsed.effects,
      'p0',
      ['goblin'],                    // chosenTargetIds
      [{ id: targetSpec.id }],       // targetSpecs
      0,                             // xValue = 0 — no pump
    );

    const goblin = s.cards.get('goblin')!;
    // +0/+0 — no modification expected
    expect(goblin.counters['_powerMod'] ?? 0).toBe(0);
    expect(goblin.counters['_toughnessMod'] ?? 0).toBe(0);
  });
});
