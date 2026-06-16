/**
 * Slice 12 — Event-pump "gets +X/+0 until end of turn, where X is <amount>"
 *
 * Tests the extended matchModifyPTWhereX matcher which now accepts:
 *   • EventSpellManaValue  — "where X is that spell's mana value"  (Erratic Cyclops)
 *   • GreatestPower        — "where X is the greatest power among creatures you control"
 *                            (Skanos Dragonheart battlefield half)
 *   • ForEach (existing)   — "where X is the number of <filter> <place>"
 *
 * Declined amounts (honesty bar):
 *   • Die-roll, mana-symbol-count, defending-player-graveyard — stay Unparsed.
 *   • SourcePower — no AmountRef kind exists; skip Brambleguard Captain.
 *
 * For Source/EventCreature targets the executor handles them inline (no call to
 * resolveTargetRef); execution tests are included for the Source case.
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
  cmc?: number,
): CardDefinition {
  return {
    id, name, type_line: typeLine, oracle_text: '', mana_cost: '{1}',
    cmc: cmc ?? 1, colors: [], color_identity: [], keywords: [],
    card_types: types as CardDefinition['card_types'],
    ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
  };
}

const DEFS: CardDefinition[] = [
  def('d_cyclops', 'Erratic Cyclops', 'Creature — Cyclops', ['creature'], [1, 8]),
  def('d_skanos',  'Skanos Dragonheart', 'Creature — Dragon', ['creature'], [4, 4]),
  def('d_beater',  'Beater',   'Creature — Beast', ['creature'], [5, 5]),
  def('d_small',   'Small',    'Creature — Goblin', ['creature'], [2, 1]),
  def('d_instant', 'Big Spell', 'Instant', ['instant'], undefined, 7),
  def('d_land',    'Forest',   'Basic Land — Forest', ['land']),
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
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function triggeredEffects(text: string): Effect[] {
  const parsed = parseOracleText(text);
  expect(parsed.kind).toBe('Triggered');
  if (parsed.kind !== 'Triggered') throw new Error(`Expected Triggered, got ${parsed.kind}`);
  return parsed.ability.effects;
}

function expectAmountKind(amount: unknown, kind: string): AmountRef {
  const a = amount as AmountRef;
  expect(typeof a).toBe('object');
  expect((a as { kind: string }).kind).toBe(kind);
  return a;
}

// ── parse tests ───────────────────────────────────────────────────────────────

describe('slice12 pump-where-x: EventSpellManaValue (Erratic Cyclops)', () => {
  it('parses "it gets +X/+0 until end of turn, where X is that spell\'s mana value" as triggered ability', () => {
    const parsed = parseOracleText(
      "Whenever you cast an instant or sorcery spell, it gets +X/+0 until end of turn, where X is that spell's mana value.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;

    // Target is the source creature itself ("it" in trigger tail).
    expect(eff.target).toEqual({ kind: 'Source' });
    expect(eff.untilEndOfTurn).toBe(true);

    // Power axis uses EventSpellManaValue; toughness axis is fixed 0.
    expectAmountKind(eff.power, 'EventSpellManaValue');
    expect(eff.toughness).toBe(0);
  });

  it('parses the "this creature gets +X/+0" variant with EventSpellManaValue', () => {
    const parsed = parseOracleText(
      "Whenever you cast an instant or sorcery spell, this creature gets +X/+0 until end of turn, where X is that spell's mana value.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;
    expect(eff.target).toEqual({ kind: 'Source' });
    expectAmountKind(eff.power, 'EventSpellManaValue');
    expect(eff.toughness).toBe(0);
  });

  it('executes EventSpellManaValue correctly (source gets +cmc/+0)', () => {
    // Trigger context: eventCardInstanceId points to the cast spell (cmc=7)
    const state = st([
      mk('cyclops', 'd_cyclops', 'p0', 'battlefield'),
      mk('spell',   'd_instant', 'p0', 'stack'),      // cmc = 7
    ]);
    const parsed = parseOracleText(
      "Whenever you cast an instant or sorcery spell, it gets +X/+0 until end of turn, where X is that spell's mana value.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const s = executeEffects(
      state,
      parsed.ability.effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'cyclops', eventContext: { cardInstanceId: 'spell' } },
    );
    // cyclops._powerMod should be +7 (the spell's cmc)
    expect(s.cards.get('cyclops')!.counters['_powerMod']).toBe(7);
    // toughness axis not modified
    expect(s.cards.get('cyclops')!.counters['_toughnessMod'] ?? 0).toBe(0);
  });
});

describe('slice12 pump-where-x: GreatestPower (Skanos Dragonheart)', () => {
  it('parses "it gets +X/+0 until end of turn, where X is the greatest power among creatures you control"', () => {
    const parsed = parseOracleText(
      'Whenever ~ attacks, it gets +X/+0 until end of turn, where X is the greatest power among creatures you control.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;

    expect(eff.target).toEqual({ kind: 'Source' });
    expect(eff.untilEndOfTurn).toBe(true);

    const amount = expectAmountKind(eff.power, 'GreatestPower') as { kind: 'GreatestPower'; zone: string; controller: string; filter?: object };
    expect(amount.zone).toBe('battlefield');
    expect(amount.controller).toBe('you');
    expect(amount.filter).toEqual({ types: ['creature'] });
    expect(eff.toughness).toBe(0);
  });

  it('parses "target creature gets +X/+0, where X is the greatest power among creatures you control"', () => {
    const parsed = parseOracleText(
      'Target creature gets +X/+0 until end of turn, where X is the greatest power among creatures you control.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');

    const eff = parsed.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;
    expect(eff.target.kind).toBe('Chosen');
    const amount = expectAmountKind(eff.power, 'GreatestPower') as { kind: 'GreatestPower'; controller: string };
    expect(amount.controller).toBe('you');
  });

  it('executes GreatestPower correctly (source gets +greatest/+0)', () => {
    // Battlefield: skanos (4/4), beater (5/5), small (2/1) — all controlled by p0
    const state = st([
      mk('skanos', 'd_skanos', 'p0', 'battlefield'),
      mk('beater', 'd_beater', 'p0', 'battlefield'),
      mk('small',  'd_small',  'p0', 'battlefield'),
      mk('foe',    'd_small',  'p1', 'battlefield'),   // opponent's creature — must NOT be counted
    ]);
    const parsed = parseOracleText(
      'Whenever ~ attacks, it gets +X/+0 until end of turn, where X is the greatest power among creatures you control.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const s = executeEffects(
      state,
      parsed.ability.effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'skanos' },
    );
    // Greatest power among p0's creatures is 5 (beater). Skanos gets +5/+0.
    expect(s.cards.get('skanos')!.counters['_powerMod']).toBe(5);
    expect(s.cards.get('skanos')!.counters['_toughnessMod'] ?? 0).toBe(0);
  });
});

describe('slice12 pump-where-x: ForEach existing path still works', () => {
  it('parses "it gets +X/+X until end of turn, where X is the number of Clerics on the battlefield"', () => {
    const parsed = parseOracleText(
      'Whenever ~ attacks, it gets +X/+X until end of turn, where X is the number of Clerics on the battlefield.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;
    expect(eff.target).toEqual({ kind: 'Source' });

    const fe = expectAmountKind(eff.power, 'ForEach') as { kind: 'ForEach'; zone: string; controller: string; filter?: { types?: string[]; subtypes?: string[] } };
    expect(fe.zone).toBe('battlefield');
    expect(fe.controller).toBe('each');
    expect(fe.filter).toMatchObject({ types: ['creature'] });
  });
});

describe('slice12 pump-where-x: honesty bar — declined amounts stay Unparsed', () => {
  it('declines "where X is the number of mana symbols in its mana cost" (Heartlash Cinder style)', () => {
    const result = parseOracleText(
      'Whenever ~ attacks, it gets +X/+0 until end of turn, where X is the number of mana symbols in its mana cost.',
    );
    expect(result.kind).toBe('Unparsed');
  });

  it('declines "where X is the result of a die roll" (fictional, sanity check)', () => {
    const result = parseOracleText(
      'Whenever ~ attacks, it gets +X/+0 until end of turn, where X is the result of a die roll.',
    );
    expect(result.kind).toBe('Unparsed');
  });
});
