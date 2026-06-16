/**
 * Slice 1: OptionalPay X-cost and for-each counter inner-effect expansion.
 *
 * Covers:
 * 1. {X} and {X}{R} costs in matchOptionalPay — parses with xCost=true and the
 *    executor taps xValue lands (plus colored pips) to pay.
 * 2. matchAddCountersForEach — "put a +1/+1 counter on target <Subtype> for each
 *    <Subtype> you control" parsed as AddCounters with a ForEachAmount count.
 * 3. matchDealXDamage extended to handle "it deals X damage to any target" (source
 *    = ThisPermanent) inside an OptionalPay inner body.
 *
 * All oracle texts are real wordings (normalized per engine conventions).
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, OptionalPayEffect, AddCountersEffect } from '../effects/ast';

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function landDef(id: string, name: string, color: string): CardDefinition {
  return {
    id, name, type_line: `Basic Land — ${name}`, oracle_text: `{T}: Add {${color}}.`,
    mana_cost: '', cmc: 0, colors: [], color_identity: [color], keywords: [], card_types: ['land'],
  };
}

const BASE_DEFS: CardDefinition[] = [
  landDef('forest', 'Forest', 'G'),
  landDef('mountain', 'Mountain', 'R'),
  landDef('plains', 'Plains', 'W'),
  landDef('island', 'Island', 'U'),
  {
    id: 'shrine_def',
    name: 'Test Shrine',
    type_line: 'Legendary Enchantment — Shrine',
    oracle_text: '',
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['enchantment'],
    subtypes: ['Shrine'],
  },
  {
    id: 'creature_def',
    name: 'Bear',
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  },
];

function baseState(): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map<string, CardInstance>(),
    cardDefinitions: new Map(BASE_DEFS.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function addCard(
  s: GameState,
  instanceId: string,
  definitionId: string,
  zone: CardInstance['zone'] = 'battlefield',
  owner = 'p0',
): void {
  s.cards.set(instanceId, {
    instanceId, definitionId, ownerId: owner, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  });
}

function firstOptionalPay(effects: Effect[]): OptionalPayEffect {
  const op = effects.find(e => e.kind === 'OptionalPay') as OptionalPayEffect | undefined;
  if (!op) throw new Error('expected an OptionalPay effect');
  return op;
}

function tappedLandCount(s: GameState): number {
  return [...s.cards.values()].filter(c => c.zone === 'battlefield' && c.tapped).length;
}

// ---------------------------------------------------------------------------
// Section 1: {X} cost in matchOptionalPay
// ---------------------------------------------------------------------------

describe('Slice 1 — OptionalPay {X} cost (xCost=true)', () => {
  it('parses "you may pay {X}. If you do, draw a card." with xCost=true', () => {
    const p = parseOracleText('You may pay {X}. If you do, draw a card.');
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    const op = firstOptionalPay(p.effects);
    expect(op.xCost).toBe(true);
    expect(op.manaCost).toBeUndefined();
    expect(op.effects[0].kind).toBe('Draw');
  });

  it('pays {X} by tapping xValue lands when affordable', () => {
    const p = parseOracleText('You may pay {X}. If you do, draw a card.');
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    let s = baseState();
    // 3 forests, xValue=2 — should tap exactly 2
    addCard(s, 'f0', 'forest');
    addCard(s, 'f1', 'forest');
    addCard(s, 'f2', 'forest');
    addCard(s, 'lib', 'forest', 'library');
    const xValue = 2;
    s = executeEffects(s, p.effects, 'p0', [], [], xValue);
    expect(tappedLandCount(s)).toBe(2); // paid {2} (X=2) using 2 forests
    // Drew a card
    const handCount = [...s.cards.values()].filter(c => c.ownerId === 'p0' && c.zone === 'hand').length;
    expect(handCount).toBe(1);
  });

  it('declines {X} cost when not enough untapped lands (xValue=3, only 2 lands)', () => {
    const p = parseOracleText('You may pay {X}. If you do, draw a card.');
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    let s = baseState();
    addCard(s, 'f0', 'forest');
    addCard(s, 'f1', 'forest');
    addCard(s, 'lib', 'forest', 'library');
    const xValue = 3;
    s = executeEffects(s, p.effects, 'p0', [], [], xValue);
    // Can't afford: 2 lands < 3 needed
    expect(tappedLandCount(s)).toBe(0);
    const handCount = [...s.cards.values()].filter(c => c.ownerId === 'p0' && c.zone === 'hand').length;
    expect(handCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Section 2: {X}{R} cost in matchOptionalPay
// ---------------------------------------------------------------------------

describe('Slice 1 — OptionalPay {X}{R} cost (xCost=true with colored pip)', () => {
  it('parses "you may pay {X}{R}. If you do, it deals X damage to any target." with xCost=true and manaCost={R}', () => {
    // Flameblast Dragon inner-body form: the activated ability "body" triggers an OptionalPay
    // that mirrors the X-damage inner clause.
    const p = parseOracleText('At the beginning of your end step, you may pay {X}{R}. If you do, it deals X damage to any target.');
    if (p.kind !== 'Triggered') throw new Error(`expected Triggered, got ${p.kind}`);
    const op = firstOptionalPay(p.ability.effects);
    expect(op.xCost).toBe(true);
    expect(op.manaCost).toBe('{R}'); // non-X colored pip stored in manaCost
    expect(op.effects[0].kind).toBe('DealDamage');
  });

  it('pays {X}{R}: taps xValue+1 lands (1 mountain for R, xValue forests for generic)', () => {
    const p = parseOracleText('At the beginning of your end step, you may pay {X}{R}. If you do, it deals X damage to any target.');
    if (p.kind !== 'Triggered') throw new Error(`expected Triggered, got ${p.kind}`);
    let s = baseState();
    // 2 forests + 1 mountain, xValue=2 → should tap 1 mountain (R pip) + 2 forests (X=2)
    addCard(s, 'f0', 'forest');
    addCard(s, 'f1', 'forest');
    addCard(s, 'mt', 'mountain');
    // Add a target creature so DealDamage has something to hit
    addCard(s, 'bear', 'creature_def');
    const xValue = 2;
    s = executeEffects(s, p.ability.effects, 'p0', ['bear'], [{ id: p.targets?.[0]?.id ?? '' }], xValue);
    expect(tappedLandCount(s)).toBe(3); // 1 mountain + 2 forests
  });

  it('declines {X}{R} when no mountain available (can\'t pay R pip)', () => {
    const p = parseOracleText('At the beginning of your end step, you may pay {X}{R}. If you do, it deals X damage to any target.');
    if (p.kind !== 'Triggered') throw new Error(`expected Triggered, got ${p.kind}`);
    let s = baseState();
    addCard(s, 'f0', 'forest');
    addCard(s, 'f1', 'forest');
    addCard(s, 'f2', 'forest');
    addCard(s, 'bear', 'creature_def');
    const xValue = 2;
    s = executeEffects(s, p.ability.effects, 'p0', [], [], xValue);
    expect(tappedLandCount(s)).toBe(0); // can't pay R, so decline
  });
});

// ---------------------------------------------------------------------------
// Section 3: matchAddCountersForEach — counter on target subtype for each subtype
// ---------------------------------------------------------------------------

describe('Slice 1 — matchAddCountersForEach (counter on target Shrine for each Shrine)', () => {
  it('parses "put a +1/+1 counter on target Shrine for each Shrine you control" correctly', () => {
    // Go-Shintai of Boundless Vigor inner body (after "when you do,")
    const p = parseOracleText('At the beginning of your end step, you may pay {1}. When you do, put a +1/+1 counter on target shrine for each shrine you control.');
    if (p.kind !== 'Triggered') throw new Error(`expected Triggered, got ${p.kind}`);
    const op = firstOptionalPay(p.ability.effects);
    expect(op.effects.length).toBeGreaterThan(0);
    const counterEffect = op.effects[0] as AddCountersEffect;
    expect(counterEffect.kind).toBe('AddCounters');
    expect(counterEffect.counterType).toBe('+1/+1');
    expect(typeof counterEffect.count).toBe('object');
    if (typeof counterEffect.count !== 'object') throw new Error('expected object count');
    expect((counterEffect.count as { kind: string }).kind).toBe('ForEach');
  });

  it('executes: 2 Shrines on battlefield → target Shrine gets 2 +1/+1 counters', () => {
    // Parse as a plain Spell for simplicity (avoids needing trigger scaffolding)
    const p = parseOracleText('Put a +1/+1 counter on target shrine for each shrine you control.');
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    expect(p.targets.length).toBe(1);

    let s = baseState();
    // 2 shrines on battlefield (p0 controls both); target the first one
    addCard(s, 'shrine1', 'shrine_def');
    addCard(s, 'shrine2', 'shrine_def');

    const targetSpec = p.targets[0];
    s = executeEffects(s, p.effects, 'p0', ['shrine1'], [{ id: targetSpec.id }]);
    const shrine1 = s.cards.get('shrine1')!;
    // ForEach counts 2 shrines you control → 2 counters placed on shrine1
    expect(shrine1.counters['+1/+1']).toBe(2);
    // shrine2 is unaffected
    const shrine2 = s.cards.get('shrine2')!;
    expect(shrine2.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('executes: 0 Shrines controlled → target Shrine gets 0 counters', () => {
    const p = parseOracleText('Put a +1/+1 counter on target shrine for each shrine you control.');
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);

    let s = baseState();
    // Shrine belongs to p1, not p0 — p0 controls 0 shrines
    addCard(s, 'shrine1', 'shrine_def', 'battlefield', 'p1');

    const targetSpec = p.targets[0];
    s = executeEffects(s, p.effects, 'p0', ['shrine1'], [{ id: targetSpec.id }]);
    const shrine1 = s.cards.get('shrine1')!;
    // p0 controls 0 shrines → ForEach = 0 → no counters
    expect(shrine1.counters['+1/+1'] ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Section 4: matchDealXDamage extended to "it deals X damage"
// ---------------------------------------------------------------------------

describe('Slice 1 — matchDealXDamage extended to "it deals X damage to any target"', () => {
  it('parses "it deals X damage to any target" as DealDamage with amount {kind:X}', () => {
    const p = parseOracleText('It deals X damage to any target.');
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    expect(p.effects.length).toBe(1);
    const e = p.effects[0];
    if (e.kind !== 'DealDamage') throw new Error(`expected DealDamage, got ${e.kind}`);
    expect(typeof e.amount).toBe('object');
    expect((e.amount as { kind: string }).kind).toBe('X');
    expect(e.source?.kind).toBe('ThisPermanent');
    expect(p.targets.length).toBe(1);
  });

  it('executes "it deals X damage to any target" applying xValue damage', () => {
    const p = parseOracleText('It deals X damage to any target.');
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);

    let s = baseState();
    addCard(s, 'bear', 'creature_def');
    const targetSpec = p.targets[0];
    const xValue = 3;
    s = executeEffects(s, p.effects, 'p0', ['bear'], [{ id: targetSpec.id }], xValue);
    const bear = s.cards.get('bear')!;
    expect(bear.damage).toBe(3);
  });
});
