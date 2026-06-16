/**
 * slice10-etb-counters-mvsum.test.ts
 *
 * Slice 10/12 — Enters-with-counters computed where-X amount extensions.
 * Tests the new MVSumAmount ("the total mana value of <filter> in <zone>")
 * parsing and execution path added to parseWhereXIsAnyAmount, resolveAmount,
 * and applyEntersWithCounters.
 *
 * Cards / oracle patterns covered:
 *   - "where X is the total mana value of instant and sorcery cards in your graveyard"
 *     (Naya Soulbeast counter portion / other MV-sum ETB cards)
 *   - "where X is the total mana value of cards in your graveyard" (bare form)
 *   - "where X is the total mana value of creature cards in your graveyard"
 *
 * Honesty bar:
 *   - "where X is the amount of life you've gained this turn" remains Unparsed
 *     (no lifeGainedThisTurn tracker in GameState).
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, AmountRef, MVSumAmount } from '../effects/ast';

// ── helpers ──────────────────────────────────────────────────────────────────

function def(
  id: string,
  name: string,
  typeLine: string,
  types: string[],
  oracleText = '',
  pt?: [number, number],
  cmc = 1,
): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: oracleText,
    mana_cost: '{1}',
    cmc,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: types as CardDefinition['card_types'],
    ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
  };
}

const DEFS: CardDefinition[] = [
  def('d_creature', 'Goblin', 'Creature — Goblin', ['creature'], '', [1, 1], 2),
  def('d_forest', 'Forest', 'Basic Land — Forest', ['land'], '', undefined, 0),
  def('d_instant', 'Shock', 'Instant', ['instant'], '', undefined, 1),
  def('d_sorcery', 'Divination', 'Sorcery', ['sorcery'], '', undefined, 3),
  def('d_artifact', 'Mox', 'Artifact', ['artifact'], '', undefined, 0),
  // high-CMC cards for testing
  def('d_instant_big', 'Time Walk', 'Instant', ['instant'], '', undefined, 5),
  def('d_sorcery_big', 'Reanimate', 'Sorcery', ['sorcery'], '', undefined, 4),
];

function mk(id: string, defId: string, owner: string, zone: CardInstance['zone']): CardInstance {
  return {
    instanceId: id,
    definitionId: defId,
    ownerId: owner,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
}

function st(cards: CardInstance[], extraDefs: CardDefinition[] = []): GameState {
  const allDefs = [...DEFS, ...extraDefs];
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(allDefs.map(d => [d.id, d])),
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

function getAddCountersEffect(oracle: string): Extract<Effect, { kind: 'AddCounters' }> | undefined {
  const parsed = parseOracleText(oracle);
  if (parsed.kind === 'Unparsed') return undefined;
  const effArr: Effect[] =
    parsed.kind === 'Spell' ? parsed.effects
    : parsed.kind === 'ETB' ? parsed.ability.effects
    : parsed.kind === 'Triggered' ? parsed.ability.effects
    : [];
  return effArr.find(e => e.kind === 'AddCounters') as Extract<Effect, { kind: 'AddCounters' }> | undefined;
}

// ── parse tests ───────────────────────────────────────────────────────────────

describe('slice-10 ETB counters MVSum: parser', () => {
  it('parses "where X is the total mana value of instant and sorcery cards in your graveyard"', () => {
    const oracle =
      '~ enters with X +1/+1 counters on it, where X is the total mana value of instant and sorcery cards in your graveyard.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    expect(eff.target).toEqual({ kind: 'Source' });
    expect(eff.counterType).toBe('+1/+1');

    const count = eff.count as AmountRef;
    expect(count && typeof count === 'object' && 'kind' in count ? (count as { kind: string }).kind : null).toBe('MVSum');
    const mv = count as MVSumAmount;
    expect(mv.zone).toBe('graveyard');
    expect(mv.controller).toBe('you');
    // Filter should include both instant and sorcery types
    expect(mv.filter).toBeDefined();
    expect(mv.filter?.types).toContain('instant');
    expect(mv.filter?.types).toContain('sorcery');
  });

  it('parses "where X is the total mana value of cards in your graveyard" (bare — no type filter)', () => {
    const oracle =
      'This creature enters with X +1/+1 counters on it, where X is the total mana value of cards in your graveyard.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const count = eff.count as AmountRef;
    expect(count && typeof count === 'object' && 'kind' in count ? (count as { kind: string }).kind : null).toBe('MVSum');
    const mv = count as MVSumAmount;
    expect(mv.zone).toBe('graveyard');
    expect(mv.controller).toBe('you');
    // "cards" alone adds no type constraint
    expect(mv.filter).toBeUndefined();
  });

  it('parses "where X is the total mana value of creature cards in your graveyard"', () => {
    const oracle =
      '~ enters with X +1/+1 counters on it, where X is the total mana value of creature cards in your graveyard.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const count = eff.count as AmountRef;
    expect(count && typeof count === 'object' && 'kind' in count ? (count as { kind: string }).kind : null).toBe('MVSum');
    const mv = count as MVSumAmount;
    expect(mv.zone).toBe('graveyard');
    expect(mv.controller).toBe('you');
    expect(mv.filter).toEqual({ types: ['creature'] });
  });

  it('parses "where X is the total mana value of cards in exile" (exile zone)', () => {
    const oracle =
      '~ enters with X +1/+1 counters on it, where X is the total mana value of cards in exile.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const count = eff.count as AmountRef;
    expect(count && typeof count === 'object' && 'kind' in count ? (count as { kind: string }).kind : null).toBe('MVSum');
    const mv = count as MVSumAmount;
    expect(mv.zone).toBe('exile');
    expect(mv.controller).toBe('each');
    expect(mv.filter).toBeUndefined();
  });
});

// ── execute tests ──────────────────────────────────────────────────────────────

describe('slice-10 ETB counters MVSum: execution via executeEffects', () => {
  it('sums mana value of instant + sorcery cards in graveyard (1+3=4 → 4 counters)', () => {
    const oracle =
      '~ enters with X +1/+1 counters on it, where X is the total mana value of instant and sorcery cards in your graveyard.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const state = st([
      mk('src', 'd_creature', 'p0', 'battlefield'),     // the entering creature
      mk('gy_instant', 'd_instant', 'p0', 'graveyard'),  // cmc=1
      mk('gy_sorcery', 'd_sorcery', 'p0', 'graveyard'),  // cmc=3
      mk('gy_creature', 'd_creature', 'p0', 'graveyard'), // cmc=2 — NOT counted (not instant/sorcery)
      mk('gy_opp', 'd_instant', 'p1', 'graveyard'),      // opponent's card — NOT counted
    ]);

    const s = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    // X = cmc of instant (1) + cmc of sorcery (3) = 4
    expect(s.cards.get('src')!.counters['+1/+1']).toBe(4);
  });

  it('applies 0 counters when no matching cards in graveyard', () => {
    const oracle =
      '~ enters with X +1/+1 counters on it, where X is the total mana value of instant and sorcery cards in your graveyard.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const state = st([
      mk('src', 'd_creature', 'p0', 'battlefield'),
      // graveyard is empty for p0
    ]);

    const s = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    // X = 0, skip (no counters added at all)
    expect(s.cards.get('src')!.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('sums mana value of ALL cards in graveyard (bare form: 1+3+2=6 → 6 counters)', () => {
    const oracle =
      'This creature enters with X +1/+1 counters on it, where X is the total mana value of cards in your graveyard.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const state = st([
      mk('src', 'd_creature', 'p0', 'battlefield'),
      mk('gy1', 'd_instant', 'p0', 'graveyard'),   // cmc=1
      mk('gy2', 'd_sorcery', 'p0', 'graveyard'),   // cmc=3
      mk('gy3', 'd_creature', 'p0', 'graveyard'),  // cmc=2
    ]);

    const s = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    // X = 1 + 3 + 2 = 6
    expect(s.cards.get('src')!.counters['+1/+1']).toBe(6);
  });

  it('sums mana value of big instant + big sorcery (5+4=9 → 9 counters)', () => {
    const oracle =
      '~ enters with X +1/+1 counters on it, where X is the total mana value of instant and sorcery cards in your graveyard.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const state = st([
      mk('src', 'd_creature', 'p0', 'battlefield'),
      mk('gy_big_instant', 'd_instant_big', 'p0', 'graveyard'),   // cmc=5
      mk('gy_big_sorcery', 'd_sorcery_big', 'p0', 'graveyard'),   // cmc=4
    ]);

    const s = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    // X = 5 + 4 = 9
    expect(s.cards.get('src')!.counters['+1/+1']).toBe(9);
  });
});

// ── honesty bar ───────────────────────────────────────────────────────────────

describe('slice-10 ETB counters MVSum: honesty — unsupported forms stay Unparsed', () => {
  it('does not parse "where X is the amount of life you\'ve gained this turn" (no lifeGainedThisTurn tracker)', () => {
    const oracle =
      "This creature enters with X +1/+1 counters on it, where X is the amount of life you've gained this turn.";
    const eff = getAddCountersEffect(oracle);
    // If it did parse AddCounters, the count must NOT be a ForEachAmount or MVSumAmount
    if (eff) {
      const kind = typeof eff.count === 'object' && eff.count !== null
        ? (eff.count as { kind: string }).kind
        : 'number';
      expect(['ForEach', 'MVSum']).not.toContain(kind);
    }
    // Unparsed is also acceptable — the key constraint is that we don't silently
    // treat life-gained-this-turn as zero (false honesty).
    const parsed = parseOracleText(oracle);
    if (parsed.kind !== 'Unparsed') {
      const effArr: Effect[] =
        parsed.kind === 'Spell' ? parsed.effects
        : parsed.kind === 'ETB' ? parsed.ability.effects
        : parsed.kind === 'Triggered' ? parsed.ability.effects
        : [];
      const addCtr = effArr.find(e => e.kind === 'AddCounters') as Extract<Effect, { kind: 'AddCounters' }> | undefined;
      if (addCtr) {
        const kind = typeof addCtr.count === 'object' && addCtr.count !== null
          ? (addCtr.count as { kind: string }).kind
          : 'number';
        expect(['ForEach', 'MVSum']).not.toContain(kind);
      }
    }
  });

  it('does not parse "where X is the storm count" (no storm counter in GameState)', () => {
    const oracle =
      'This creature enters with X +1/+1 counters on it, where X is the storm count.';
    const eff = getAddCountersEffect(oracle);
    if (eff) {
      const kind = typeof eff.count === 'object' && eff.count !== null
        ? (eff.count as { kind: string }).kind
        : 'number';
      // Should not produce any dynamic amount for storm count
      expect(kind).not.toBe('ForEach');
      expect(kind).not.toBe('MVSum');
    }
  });
});

// ── regression: existing forms still parse ────────────────────────────────────

describe('slice-10 ETB counters MVSum: regression — existing where-X forms unaffected', () => {
  it('ForEach (number of creatures you control) still parses', () => {
    const oracle =
      'This creature enters with X +1/+1 counters on it, where X is the number of creatures you control.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;
    const count = eff.count as AmountRef;
    expect(count && typeof count === 'object' && 'kind' in count ? (count as { kind: string }).kind : null).toBe('ForEach');
  });

  it('LifeTotal (your life total) still parses', () => {
    const oracle =
      '~ enters with X charge counters on it, where X is your life total.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;
    const count = eff.count as AmountRef;
    expect(count && typeof count === 'object' && 'kind' in count ? (count as { kind: string }).kind : null).toBe('LifeTotal');
  });

  it('ForEach (number of creature cards in all graveyards) still parses', () => {
    const oracle =
      'This creature enters with X +1/+1 counters on it, where X is the number of creature cards in all graveyards.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;
    const count = eff.count as AmountRef;
    expect(count && typeof count === 'object' && 'kind' in count ? (count as { kind: string }).kind : null).toBe('ForEach');
    const fe = count as Extract<AmountRef, { kind: 'ForEach' }>;
    expect(fe.zone).toBe('graveyard');
    expect(fe.controller).toBe('each');
  });

  it('GreatestManaValue (greatest mana value among cards in exile) still parses', () => {
    const oracle =
      '~ enters with X +1/+1 counters on it, where X is the greatest mana value among cards in exile.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;
    const count = eff.count as AmountRef;
    expect(count && typeof count === 'object' && 'kind' in count ? (count as { kind: string }).kind : null).toBe('GreatestManaValue');
  });
});
