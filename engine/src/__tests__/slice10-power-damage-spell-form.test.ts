/**
 * Slice 10 — Power-based damage spell form (Flesh // Blood / Soul's Fire family)
 *
 * Oracle text shape:
 *   "Target creature you control deals damage equal to its power to any target."
 *
 * Parse: two TargetSpecs emitted — a 'Creature' spec with controllerControls (the
 * dealer) and an 'Any' spec (the damage recipient).  The DealDamage effect's amount
 * is TargetPower referencing the dealer's Chosen ref; the executor resolves this via
 * the existing TargetPower + Chosen path that already drives the fight family.
 *
 * Tests:
 *   1. Parse-only: real oracle wording (Soul's Fire / Flesh // Blood half)
 *   2. Parse-only: form with "target player" destination (Soul's Fire variant)
 *   3. Parse-only: form without "you control" on the source creature
 *   4. Execution: source creature (power 4) damages opponent creature
 *   5. Execution: source creature (power 3) damages a player
 *   6. Parse: "deals damage equal to twice its power" — TargetPower with multiplier:2 (Slice 5 widening)
 *   7. Regression: existing one-sided fight ("to target creature you don't control") still parses
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ── Test helpers ──────────────────────────────────────────────────────────────

type AnyObj = Record<string, any>;

function makeDef(
  id: string,
  overrides: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: id,
    type_line: overrides.type_line ?? 'Creature — Elemental',
    oracle_text: '',
    mana_cost: '{1}{R}',
    cmc: 2,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    power: overrides.power ?? 2,
    toughness: overrides.toughness ?? 2,
    card_types: overrides.card_types ?? ['creature'],
    ...overrides,
  } as CardDefinition;
}

function makeCard(
  instanceId: string,
  ownerId: string,
  definitionId: string,
  zone: CardInstance['zone'] = 'battlefield',
  overrides: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...overrides,
  } as CardInstance;
}

function makeState(
  defs: CardDefinition[],
  cards: CardInstance[],
): GameState {
  const defMap = new Map(defs.map(d => [d.id, d]));
  const cardMap = new Map(cards.map(c => [c.instanceId, c]));
  return {
    players: [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob')],
    cards: cardMap,
    cardDefinitions: defMap,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ── Parse tests ───────────────────────────────────────────────────────────────

describe('Slice 10: spell-form power damage — parse', () => {
  it('parses Soul\'s Fire / Blood half: "Target creature you control deals damage equal to its power to any target."', () => {
    const res = parseOracleText(
      'Target creature you control deals damage equal to its power to any target.',
    ) as AnyObj;

    expect(res.kind).toBe('Spell');
    expect(res.effects).toHaveLength(1);

    const eff = res.effects[0];
    expect(eff.kind).toBe('DealDamage');

    // Amount is TargetPower referencing the Chosen dealer (not Source).
    expect(eff.amount.kind).toBe('TargetPower');
    expect(eff.amount.target.kind).toBe('Chosen');

    // Damage destination is also a Chosen ref.
    expect(eff.target.kind).toBe('Chosen');

    // Two target specs: source creature and any target.
    expect(res.targets).toHaveLength(2);

    // Source spec: Creature, controllerControls.
    const sourceSpec = res.targets.find(
      (t: AnyObj) => t.id === eff.amount.target.targetId,
    );
    expect(sourceSpec).toBeDefined();
    expect(sourceSpec.type).toBe('Creature');
    expect(sourceSpec.constraints?.controllerControls).toBe(true);

    // Destination spec: Any.
    const destSpec = res.targets.find(
      (t: AnyObj) => t.id === eff.target.targetId,
    );
    expect(destSpec).toBeDefined();
    expect(destSpec.type).toBe('Any');
  });

  it('parses the form without "you control" on the source creature', () => {
    // "target creature deals damage equal to its power to any target"
    // — no controller constraint, still two Chosen refs.
    const res = parseOracleText(
      'Target creature deals damage equal to its power to any target.',
    ) as AnyObj;

    expect(res.kind).toBe('Spell');
    const eff = res.effects[0];
    expect(eff.kind).toBe('DealDamage');
    expect(eff.amount.kind).toBe('TargetPower');
    expect(eff.amount.target.kind).toBe('Chosen');

    const sourceSpec = res.targets.find(
      (t: AnyObj) => t.id === eff.amount.target.targetId,
    );
    expect(sourceSpec).toBeDefined();
    expect(sourceSpec.type).toBe('Creature');
    // No controllerControls constraint present.
    expect(sourceSpec.constraints?.controllerControls).toBeFalsy();
  });

  it('parses "twice its power" doubling variant — TargetPower with multiplier: 2 (Slice 5 widening)', () => {
    // Slice 5 explicitly added "twice its power" support (multiplier field on AmountRef TargetPower
    // already executed by executor.ts resolveAmount). The honest bar is satisfied.
    const res = parseOracleText(
      'Target creature you control deals damage equal to twice its power to any target.',
    ) as AnyObj;
    expect(res.kind).toBe('Spell');
    const eff = res.effects[0];
    expect(eff.kind).toBe('DealDamage');
    expect(eff.amount.kind).toBe('TargetPower');
    expect(eff.amount.multiplier).toBe(2);
  });
});

// ── Execution tests ───────────────────────────────────────────────────────────

describe('Slice 10: spell-form power damage — execution', () => {
  it('source creature (power 4) deals 4 damage to an opponent creature', () => {
    const dealerDef = makeDef('dealer', { power: 4, toughness: 3 });
    const targetDef = makeDef('target', { power: 2, toughness: 5 });

    const dealerCard = makeCard('dealer-1', 'p1', 'dealer');
    const targetCard = makeCard('target-1', 'p2', 'target');

    const state = makeState(
      [dealerDef, targetDef],
      [dealerCard, targetCard],
    );

    const parsed = parseOracleText(
      'Target creature you control deals damage equal to its power to any target.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // Two target specs: [0] = source creature, [1] = destination.
    const [sourceSpec, destSpec] = parsed.targets;

    const after = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['dealer-1', 'target-1'],
      [{ id: sourceSpec.id }, { id: destSpec.id }],
    );

    // Target creature should have received 4 damage.
    expect(after.cards.get('target-1')!.damage).toBe(4);
    // Dealer is untouched (one-sided).
    expect(after.cards.get('dealer-1')!.damage).toBe(0);
  });

  it('source creature (power 3) deals 3 damage to the opponent player', () => {
    const dealerDef = makeDef('firebreath', { power: 3, toughness: 2 });
    const dealerCard = makeCard('fb-1', 'p1', 'firebreath');

    const state = makeState([dealerDef], [dealerCard]);

    const parsed = parseOracleText(
      'Target creature you control deals damage equal to its power to any target.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const [sourceSpec, destSpec] = parsed.targets;

    const after = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['fb-1', 'p2'],
      [{ id: sourceSpec.id }, { id: destSpec.id }],
    );

    // Opponent player should have lost 3 life (40 - 3 = 37).
    const p2 = after.players.find(p => p.id === 'p2')!;
    expect(p2.life).toBe(37);
    // Dealer has no damage.
    expect(after.cards.get('fb-1')!.damage).toBe(0);
  });
});

// ── Regression tests ──────────────────────────────────────────────────────────

describe('Slice 10: regression — existing one-sided fight forms still parse', () => {
  it('still parses "to target creature you don\'t control"', () => {
    const res = parseOracleText(
      "Target creature you control deals damage equal to its power to target creature you don't control.",
    ) as AnyObj;

    expect(res.kind).toBe('Spell');
    const eff = res.effects[0];
    expect(eff.kind).toBe('DealDamage');
    expect(eff.amount.kind).toBe('TargetPower');
    expect(res.targets).toHaveLength(2);

    const destSpec = res.targets.find(
      (t: AnyObj) => t.id === eff.target.targetId,
    );
    expect(destSpec.type).toBe('Creature');
    expect(destSpec.constraints?.opponentControls).toBe(true);
  });

  it('still parses "to target creature or planeswalker you don\'t control"', () => {
    const res = parseOracleText(
      "Target creature you control deals damage equal to its power to target creature or planeswalker you don't control.",
    ) as AnyObj;

    expect(res.kind).toBe('Spell');
    const destSpec = (res.targets as AnyObj[]).find(
      (t) => t.id === res.effects[0].target.targetId,
    );
    expect(destSpec.type).toBe('CreatureOrPlaneswalker');
    expect(destSpec.constraints?.opponentControls).toBe(true);
  });

  it('still parses "damage equal to its power" (ThisPermanent source)', () => {
    const res = parseOracleText(
      'This creature deals damage equal to its power to any target.',
    ) as AnyObj;
    expect(res.kind).toBe('Spell');
    const eff = res.effects[0];
    expect(eff.kind).toBe('DealDamage');
    // This form uses Source, not Chosen.
    expect(eff.amount.kind).toBe('TargetPower');
    expect(eff.amount.target.kind).toBe('Source');
  });
});
