/**
 * Slice 7: Self-pump trigger tails with computed X.
 *
 * Tests cover:
 *  1. "that creature gets +N/+N until end of turn" — EventCreature target parsed
 *     and executed via matchThatCreatureGetsPT.
 *  2. "where X is the greatest power among OTHER [subtypes] you control" — the
 *     "other" qualifier is now stripped from the filter words, and notSource is
 *     set on the GreatestPowerAmount so resolveGreatestPower excludes the source.
 *  3. Execution of the GreatestPower where-X amount (both with and without the
 *     source-exclusion flag), plus honesty-bar checks.
 *
 * Real oracle wording examples used:
 *  - Skanos Dragonheart ("where X is the greatest power among other Dragons you control")
 *  - Primal Forcemage ("that creature gets +2/+2" — fixture; real text uses ETB)
 *  - Threnody Singer (already covered by cov-where-x-amounts; smoke-tested here)
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, GreatestPowerAmount } from '../effects/ast';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function defCreature(id: string, name: string, subtypes: string[], power: number, toughness: number): CardDefinition {
  return {
    id, name,
    type_line: `Creature — ${subtypes.join(' ')}`,
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
  };
}

function mk(instanceId: string, definitionId: string, ownerId: string, zone: CardInstance['zone'] = 'battlefield'): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function baseState(cards: CardInstance[], defs: CardDefinition[]): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(defs.map(d => [d.id, d])),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ---------------------------------------------------------------------------
// 1. "that creature gets +N/+N until end of turn" — EventCreature target
// ---------------------------------------------------------------------------

describe('slice 7: that creature gets +N/+N (EventCreature target)', () => {
  /**
   * Real-card pattern: Primal Forcemage — "Whenever another creature enters
   * the battlefield under your control, it gets +3/+3 until end of turn."
   * Fixture: Using "that creature" (the grammatical equivalent used by many
   * modern cards and in trigger bodies that reference the entering creature).
   */
  it('parses "that creature gets +N/+N until end of turn" as EventCreature target', () => {
    const parsed = parseOracleText(
      'Whenever a creature enters the battlefield under your control, that creature gets +2/+2 until end of turn.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;

    // Must target the EventCreature (the entering creature), not Source.
    expect(eff.target).toEqual({ kind: 'EventCreature' });
    expect(eff.power).toBe(2);
    expect(eff.toughness).toBe(2);
    expect(eff.untilEndOfTurn).toBe(true);

    // No extra targeting specs — EventCreature is resolved from eventContext.
    expect(parsed.targets).toHaveLength(0);
  });

  it('executes the +N/+N buff on the event creature', () => {
    const defs = [defCreature('d_src', 'Trigger Source', ['Beast'], 2, 2)];
    const cards = [
      mk('src', 'd_src', 'p0'),
      mk('evt', 'd_src', 'p0'),
    ];
    const state = baseState(cards, defs);

    const parsed = parseOracleText(
      'Whenever a creature enters the battlefield under your control, that creature gets +2/+2 until end of turn.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');

    const after = executeEffects(
      state,
      parsed.ability.effects,
      'p0',
      [],
      [],
      0,
      {
        sourceInstanceId: 'src',
        eventContext: { cardInstanceId: 'evt' },
      },
    );

    // The entering creature (evt) gets buffed.
    expect(after.cards.get('evt')!.counters['_powerMod']).toBe(2);
    expect(after.cards.get('evt')!.counters['_toughnessMod']).toBe(2);
    // The source (the trigger-holder) is untouched.
    expect(after.cards.get('src')!.counters['_powerMod'] ?? 0).toBe(0);
  });

  it('safely no-ops when there is no event context (no crash)', () => {
    const defs = [defCreature('d_src', 'Trigger Source', ['Beast'], 2, 2)];
    const state = baseState([mk('src', 'd_src', 'p0')], defs);

    const parsed = parseOracleText(
      'Whenever a creature enters the battlefield under your control, that creature gets +2/+2 until end of turn.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');

    // No eventContext → resolves to '' → no modification, no crash.
    const after = executeEffects(state, parsed.ability.effects, 'p0', [], []);
    expect(after.cards.get('src')!.counters['_powerMod'] ?? 0).toBe(0);
  });

  it('parses "that creature gets +N/+N and gains <keyword>" in attack trigger body', () => {
    const parsed = parseOracleText(
      'Whenever ~ attacks, that creature gets +2/+0 and gains trample until end of turn.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const effects = parsed.ability.effects;
    expect(effects).toHaveLength(2);
    expect(effects[0].kind).toBe('ModifyPT');
    expect(effects[1].kind).toBe('GrantKeyword');
    if (effects[0].kind !== 'ModifyPT') return;
    expect(effects[0].target).toEqual({ kind: 'EventCreature' });
    expect(effects[0].power).toBe(2);
    expect(effects[0].toughness).toBe(0);
    if (effects[1].kind !== 'GrantKeyword') return;
    expect((effects[1] as Extract<Effect, { kind: 'GrantKeyword' }>).keyword).toBe('Trample');
    expect(effects[1].target).toEqual({ kind: 'EventCreature' });
  });
});

// ---------------------------------------------------------------------------
// 2. Skanos Dragonheart — "where X is the greatest power among other Dragons"
// ---------------------------------------------------------------------------

describe('slice 7: GreatestPower where-X with "other" prefix (Skanos Dragonheart family)', () => {
  /**
   * Real card text: "Whenever ~ attacks, it gets +X/+X until end of turn,
   * where X is the greatest power among other Dragons you control."
   */
  it('parses Skanos Dragonheart oracle text as Triggered with GreatestPower + notSource', () => {
    const parsed = parseOracleText(
      'Whenever ~ attacks, it gets +X/+X until end of turn, where X is the greatest power among other Dragons you control.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;
    expect(eff.target).toEqual({ kind: 'Source' });
    expect(eff.untilEndOfTurn).toBe(true);

    const power = eff.power as GreatestPowerAmount;
    expect(power.kind).toBe('GreatestPower');
    expect(power.zone).toBe('battlefield');
    expect(power.controller).toBe('you');
    expect(power.filter).toMatchObject({ types: ['creature'], subtypes: ['dragon'] });
    // "other" prefix sets notSource — the source is excluded from the pool.
    expect(power.notSource).toBe(true);
    expect(eff.toughness).toEqual(power); // symmetric +X/+X
  });

  it('executes GreatestPower where-X, excluding the source (notSource: true)', () => {
    // Skanos (power 3) + two other dragons (power 5 and power 2) + a non-dragon.
    // Expected X: greatest power among OTHER dragons = 5 (not Skanos itself).
    const DEFS = [
      defCreature('d_dragon', 'Dragon', ['Dragon'], 3, 3),
      defCreature('d_dragon2', 'Big Dragon', ['Dragon'], 5, 5),
      defCreature('d_dragon3', 'Small Dragon', ['Dragon'], 2, 2),
      defCreature('d_beast', 'Beast', ['Beast'], 10, 10), // non-dragon — irrelevant
    ];

    const cards = [
      mk('skanos', 'd_dragon', 'p0'),       // the source (power 3 — excluded by notSource)
      mk('big_dragon', 'd_dragon2', 'p0'),  // power 5 — highest among "other dragons"
      mk('small_dragon', 'd_dragon3', 'p0'), // power 2
      mk('beast', 'd_beast', 'p0'),         // non-dragon — not matched by filter
    ];

    const state = baseState(cards, DEFS);

    const parsed = parseOracleText(
      'Whenever ~ attacks, it gets +X/+X until end of turn, where X is the greatest power among other Dragons you control.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');

    const after = executeEffects(
      state,
      parsed.ability.effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'skanos' },
    );

    // Skanos itself gets +5/+5 (greatest power among OTHER dragons = big_dragon's 5).
    expect(after.cards.get('skanos')!.counters['_powerMod']).toBe(5);
    expect(after.cards.get('skanos')!.counters['_toughnessMod']).toBe(5);
  });

  it('executes GreatestPower where-X: source IS the strongest dragon — X = next best', () => {
    // Skanos (power 6) is the strongest dragon. Other dragon has power 4.
    // Expected X = 4 (source excluded by notSource).
    const DEFS = [
      defCreature('d_strong', 'Strong Dragon', ['Dragon'], 6, 6),
      defCreature('d_weak', 'Weak Dragon', ['Dragon'], 4, 4),
    ];
    const cards = [mk('skanos', 'd_strong', 'p0'), mk('other', 'd_weak', 'p0')];
    const state = baseState(cards, DEFS);

    const parsed = parseOracleText(
      'Whenever ~ attacks, it gets +X/+X until end of turn, where X is the greatest power among other Dragons you control.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');

    const after = executeEffects(
      state,
      parsed.ability.effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'skanos' },
    );

    // X = 4 (other dragon), not 6 (skanos itself which is excluded).
    expect(after.cards.get('skanos')!.counters['_powerMod']).toBe(4);
  });

  it('parses "where X is the greatest power among other creatures you control" (no subtype)', () => {
    const parsed = parseOracleText(
      'Whenever ~ attacks, it gets +X/+X until end of turn, where X is the greatest power among other creatures you control.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    if (eff.kind !== 'ModifyPT') return;
    const power = eff.power as GreatestPowerAmount;
    expect(power.kind).toBe('GreatestPower');
    expect(power.notSource).toBe(true);
    expect(power.filter).toEqual({ types: ['creature'] });
  });

  it('honesty bar: truly unrecognized filter word in "other" clause stays Unparsed', () => {
    // "among other Horcrux creatures" — "Horcrux" is not a recognized creature
    // subtype nor a type in parseStaticFilterType → filter parse fails → Unparsed.
    const parsed = parseOracleText(
      'Whenever ~ attacks, it gets +X/+X until end of turn, where X is the greatest power among other Horcrux creatures you control.',
    );
    // "Horcrux" isn't a known subtype → parseForEachFilterWords returns null → Unparsed.
    expect(parsed.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// 3. Threnody Singer / ForEach self-pump smoke test
// ---------------------------------------------------------------------------

describe('slice 7: ForEach self-pump trigger tail (Threnody Singer)', () => {
  it('still parses correctly after slice-7 changes', () => {
    const parsed = parseOracleText(
      'Whenever ~ attacks, it gets +X/+X until end of turn, where X is the number of creatures you control.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;
    expect(eff.target).toEqual({ kind: 'Source' });
    const power = eff.power as import('../effects/ast').ForEachAmount;
    expect(power.kind).toBe('ForEach');
    expect(power.controller).toBe('you');
    expect(power.filter).toEqual({ types: ['creature'] });
  });
});
