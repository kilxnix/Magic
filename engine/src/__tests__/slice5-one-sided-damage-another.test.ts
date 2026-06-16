import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardInstance, CardDefinition } from '../types';

/**
 * Slice 5 — One-sided deal-damage-by-power: "another target creature" + "twice its power"
 *
 * Tests that matchOneSidedDealDamageByPower now handles:
 *   (a) "another target creature" on the destination (Fall of the Hammer family)
 *       — sets notSource constraint on fighterB so the same creature can't fill
 *         both the source and destination roles.
 *   (b) "twice its power" multiplier (Animist's Might family) — emits TargetPower
 *       with multiplier: 2.
 */

// ---------------------------------------------------------------------------
// Minimal test state: a 3/3 source creature (player-1) and a 2/2 target (player-2)
// ---------------------------------------------------------------------------

function makeBaseState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  const mkDef = (id: string, name: string, power: number, toughness: number): CardDefinition => ({
    id,
    name,
    type_line: 'Creature',
    oracle_text: '',
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
  });

  cardDefinitions.set('def-fighter', mkDef('def-fighter', 'Fighter', 3, 3));
  cardDefinitions.set('def-target', mkDef('def-target', 'Target', 2, 4));
  cardDefinitions.set('def-other', mkDef('def-other', 'OtherCreature', 1, 1));

  const mk = (instanceId: string, defId: string, ownerId: string): CardInstance => ({
    instanceId,
    definitionId: defId,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  // fighter is player-1's 3/3; tgt is player-2's 2/4; other is player-1's 1/1
  cards.set('fighter', mk('fighter', 'def-fighter', 'player-1'));
  cards.set('tgt', mk('tgt', 'def-target', 'player-2'));
  cards.set('other', mk('other', 'def-other', 'player-1'));

  const players = ['player-1', 'player-2'].map((id, i) => ({
    id,
    name: id,
    life: 20,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    hasPlayedLand: false,
    hasPriority: i === 0,
    hasLost: false,
  }));

  return {
    players,
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
  } as GameState;
}

function dmg(state: GameState, id: string): number {
  return state.cards.get(id)?.damage ?? -1;
}

// ---------------------------------------------------------------------------
// (a) "another target creature" — Fall of the Hammer / Contest of Claws family
// ---------------------------------------------------------------------------

describe('slice5-one-sided-damage-another: another target creature (Fall of the Hammer family)', () => {
  it('parses Fall of the Hammer oracle text into DealDamage with TargetPower and notSource on dest', () => {
    const result = parseOracleText(
      'Target creature you control deals damage equal to its power to another target creature.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;

    // Two target specs: fighterA (creature you control) and fighterB (another creature)
    expect(result.targets).toHaveLength(2);
    const [specA, specB] = result.targets;
    expect(specA.type).toBe('Creature');
    expect(specA.constraints?.controllerControls).toBe(true);

    expect(specB.type).toBe('Creature');
    // "another" keyword enforced via notSource — cannot pick the same creature
    expect(specB.constraints?.notSource).toBe(true);

    // amount is TargetPower referencing specA
    expect(eff.amount).toMatchObject({
      kind: 'TargetPower',
      target: { kind: 'Chosen', targetId: specA.id },
    });
    // no multiplier for the plain form
    expect((eff.amount as any).multiplier).toBeUndefined();

    // destination is specB
    expect(eff.target).toEqual({ kind: 'Chosen', targetId: specB.id });
  });

  it('parses Contest of Claws oracle text identically to Fall of the Hammer', () => {
    const result = parseOracleText(
      'Target creature you control deals damage equal to its power to another target creature.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    const eff = result.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;

    // Sanity: two targets, notSource on the second
    expect(result.targets[1].constraints?.notSource).toBe(true);
    expect(eff.amount).toMatchObject({ kind: 'TargetPower' });
  });

  it('executes DealDamage TargetPower (another target) — fighter deals power to target', () => {
    const state = makeBaseState();
    // Parse and execute: fighter (3/3) deals damage equal to its power to 'tgt' (2/4)
    const result = parseOracleText(
      'Target creature you control deals damage equal to its power to another target creature.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    const [specA, specB] = result.targets;

    const afterState = executeEffects(
      state,
      result.effects,
      'player-1',
      ['fighter', 'tgt'],
      [{ id: specA.id }, { id: specB.id }],
      0,
      { sourceInstanceId: 'fighter' },
    );

    // 'tgt' should take 3 damage (fighter's power)
    expect(dmg(afterState, 'tgt')).toBe(3);
    // 'fighter' itself must NOT be damaged (one-sided)
    expect(dmg(afterState, 'fighter')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (b) "twice its power" — Animist's Might family
// ---------------------------------------------------------------------------

describe('slice5-one-sided-damage-another: twice its power (Animist\'s Might family)', () => {
  it('parses "deals damage equal to twice its power to target creature or planeswalker you don\'t control"', () => {
    const result = parseOracleText(
      "Target creature you control deals damage equal to twice its power to target creature or planeswalker you don't control.",
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;

    expect(result.targets).toHaveLength(2);
    const [specA, specB] = result.targets;

    // fighterA: creature you control
    expect(specA.type).toBe('Creature');
    expect(specA.constraints?.controllerControls).toBe(true);

    // fighterB: creature or planeswalker you don't control
    expect(specB.type).toBe('CreatureOrPlaneswalker');
    expect(specB.constraints?.opponentControls).toBe(true);

    // amount: TargetPower with multiplier 2
    expect(eff.amount).toMatchObject({
      kind: 'TargetPower',
      target: { kind: 'Chosen', targetId: specA.id },
      multiplier: 2,
    });
    expect(eff.target).toEqual({ kind: 'Chosen', targetId: specB.id });
  });

  it('executes twice-power DealDamage — fighter (3/3) deals 6 to opponent creature', () => {
    const state = makeBaseState();
    const result = parseOracleText(
      "Target creature you control deals damage equal to twice its power to target creature or planeswalker you don't control.",
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    const [specA, specB] = result.targets;

    const afterState = executeEffects(
      state,
      result.effects,
      'player-1',
      ['fighter', 'tgt'],
      [{ id: specA.id }, { id: specB.id }],
      0,
      { sourceInstanceId: 'fighter' },
    );

    // fighter has power 3, twice = 6 damage on 'tgt'
    expect(dmg(afterState, 'tgt')).toBe(6);
    expect(dmg(afterState, 'fighter')).toBe(0);
  });

  it('parses "twice its power to another target creature" (combo case)', () => {
    // Hypothetical but valid wording: tests both widening paths simultaneously
    const result = parseOracleText(
      'Target creature you control deals damage equal to twice its power to another target creature.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    const eff = result.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;

    const [specA, specB] = result.targets;
    expect(specB.constraints?.notSource).toBe(true); // "another"
    expect(eff.amount).toMatchObject({
      kind: 'TargetPower',
      target: { kind: 'Chosen', targetId: specA.id },
      multiplier: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: existing controller-qualifier form still works
// ---------------------------------------------------------------------------

describe('slice5-one-sided-damage-another: regression — original qualifier form', () => {
  it('still parses "deals damage equal to its power to target creature you don\'t control"', () => {
    const result = parseOracleText(
      "Target creature you control deals damage equal to its power to target creature you don't control.",
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    const eff = result.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;

    const [specA, specB] = result.targets;
    expect(specA.constraints?.controllerControls).toBe(true);
    expect(specB.constraints?.opponentControls).toBe(true);
    // no multiplier on the base form
    expect((eff.amount as any).multiplier).toBeUndefined();
  });
});
