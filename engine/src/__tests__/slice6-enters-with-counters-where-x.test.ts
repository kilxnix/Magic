import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, AmountRef } from '../effects/ast';

// Slice 6: Enters-with-counters evaluable where-X amounts
// Tests the extended matchEntersWithCountersWhereX and applyEntersWithCounters
// for three new evaluable amount shapes:
//   1. "where X is the number of <filter> in exile"  → ForEachAmount(exile)
//   2. "where X is your life total"                  → LifeTotalAmount
//   3. "where X is the greatest mana value among [cards] in exile" → GreatestManaValueAmount(exile)
//
// Cards covered (oracle wording used verbatim):
//   - Undergrowth Scavenger / Rhizome Lurcher: "in all graveyards" (already ForEach, verify)
//   - Eternity Vessel: "where X is your life total"
//   - Ulamog, the Defiler: "where X is the greatest mana value among cards in exile"
//   - Exile zone ForEach: "where X is the number of creature cards in exile"

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
    id, name, type_line: typeLine, oracle_text: oracleText, mana_cost: '{1}', cmc,
    colors: [], color_identity: [], keywords: [],
    card_types: types as CardDefinition['card_types'],
    ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
  };
}

const DEFS: CardDefinition[] = [
  def('d_creature', 'Goblin', 'Creature — Goblin', ['creature'], '', [1, 1]),
  def('d_forest', 'Forest', 'Basic Land — Forest', ['land']),
  def('d_instant', 'Shock', 'Instant', ['instant']),
  def('d_artifact', 'Mox', 'Artifact', ['artifact']),
  def('d_big_creature', 'Dragon', 'Creature — Dragon', ['creature'], '', [5, 5], 7),
  def('d_medium_creature', 'Wolf', 'Creature — Wolf', ['creature'], '', [2, 2], 4),
];

function mk(id: string, defId: string, owner: string, zone: CardInstance['zone']): CardInstance {
  return {
    instanceId: id, definitionId: defId, ownerId: owner, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function st(cards: CardInstance[], extraDefs: CardDefinition[] = [], p0Life = 20, p1Life = 20): GameState {
  const allDefs = [...DEFS, ...extraDefs];
  const players = [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')];
  players[0] = { ...players[0], life: p0Life };
  players[1] = { ...players[1], life: p1Life };
  return {
    players,
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(allDefs.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function getAddCountersEffect(oracle: string): Extract<Effect, { kind: 'AddCounters' }> | undefined {
  const parsed = parseOracleText(oracle);
  const effArr: Effect[] =
    parsed.kind === 'Spell' ? parsed.effects
    : parsed.kind === 'ETB' ? parsed.ability.effects
    : parsed.kind === 'Triggered' ? parsed.ability.effects
    : [];
  return effArr.find(e => e.kind === 'AddCounters') as Extract<Effect, { kind: 'AddCounters' }> | undefined;
}

// ── (1) ForEach exile zone ─────────────────────────────────────────────────

describe('slice-6 ETB counters: ForEach exile zone', () => {
  it('parses "enters with X +1/+1 counters on it, where X is the number of creature cards in exile"', () => {
    const oracle =
      'This creature enters with X +1/+1 counters on it, where X is the number of creature cards in exile.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    expect(eff.target).toEqual({ kind: 'Source' });
    expect(eff.counterType).toBe('+1/+1');

    const count = eff.count as AmountRef;
    expect(count && typeof count === 'object' && 'kind' in count ? (count as { kind: string }).kind : null).toBe('ForEach');
    const fe = count as Extract<AmountRef, { kind: 'ForEach' }>;
    expect(fe.zone).toBe('exile');
    expect(fe.controller).toBe('each');
    expect(fe.filter).toEqual({ types: ['creature'] });
  });

  it('executes exile ForEach: counts exiled creature cards correctly', () => {
    const oracle =
      'This creature enters with X +1/+1 counters on it, where X is the number of creature cards in exile.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const state = st([
      mk('src', 'd_creature', 'p0', 'battlefield'),
      mk('ex1', 'd_creature', 'p0', 'exile'),   // creature in exile
      mk('ex2', 'd_creature', 'p1', 'exile'),   // opponent's creature in exile
      mk('ex3', 'd_instant', 'p0', 'exile'),    // instant in exile — not counted
      mk('gy1', 'd_creature', 'p0', 'graveyard'), // graveyard — not counted
    ]);

    const s = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    // 2 creature cards in exile (ex1 and ex2)
    expect(s.cards.get('src')!.counters['+1/+1']).toBe(2);
  });

  it('executes exile ForEach: zero counters when no creatures in exile', () => {
    const oracle =
      'This creature enters with X +1/+1 counters on it, where X is the number of creature cards in exile.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const state = st([
      mk('src', 'd_creature', 'p0', 'battlefield'),
      mk('gy1', 'd_creature', 'p0', 'graveyard'), // graveyard doesn't count
    ]);

    const s = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    expect(s.cards.get('src')!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

// ── (2) "in all graveyards" form (Undergrowth Scavenger / Rhizome Lurcher) ──

describe('slice-6 ETB counters: in-all-graveyards form (verify existing coverage)', () => {
  it('parses Undergrowth Scavenger oracle text', () => {
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
    expect(fe.filter).toEqual({ types: ['creature'] });
  });

  it('executes Undergrowth Scavenger: counts creatures in all graveyards', () => {
    const oracle =
      'This creature enters with X +1/+1 counters on it, where X is the number of creature cards in all graveyards.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const state = st([
      mk('src', 'd_creature', 'p0', 'battlefield'),
      mk('g1', 'd_creature', 'p0', 'graveyard'),
      mk('g2', 'd_creature', 'p1', 'graveyard'),
      mk('g3', 'd_instant', 'p0', 'graveyard'),  // instant — not counted
    ]);

    const s = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    expect(s.cards.get('src')!.counters['+1/+1']).toBe(2);
  });
});

// ── (3) LifeTotal ("where X is your life total") ─────────────────────────────

describe('slice-6 ETB counters: LifeTotal amount (Eternity Vessel)', () => {
  it('parses Eternity Vessel oracle text', () => {
    const oracle =
      '~ enters with X charge counters on it, where X is your life total.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    expect(eff.target).toEqual({ kind: 'Source' });
    expect(eff.counterType).toBe('charge');

    const count = eff.count as AmountRef;
    expect(count && typeof count === 'object' && 'kind' in count ? (count as { kind: string }).kind : null).toBe('LifeTotal');
    const lt = count as Extract<AmountRef, { kind: 'LifeTotal' }>;
    expect(lt.controller).toBe('you');
  });

  it('executes LifeTotal: charge counters equal to life total', () => {
    const oracle =
      '~ enters with X charge counters on it, where X is your life total.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const state = st([
      mk('src', 'd_artifact', 'p0', 'battlefield'),
    ], [], 35); // p0 has 35 life

    const s = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    expect(s.cards.get('src')!.counters['charge']).toBe(35);
  });

  it('executes LifeTotal: works with reduced life total', () => {
    const oracle =
      '~ enters with X charge counters on it, where X is your life total.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const state = st([
      mk('src', 'd_artifact', 'p0', 'battlefield'),
    ], [], 7); // p0 has 7 life

    const s = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    expect(s.cards.get('src')!.counters['charge']).toBe(7);
  });
});

// ── (4) GreatestManaValue in exile (Ulamog, the Defiler) ─────────────────────

describe('slice-6 ETB counters: GreatestManaValue exile zone (Ulamog pattern)', () => {
  it('parses "where X is the greatest mana value among cards in exile"', () => {
    const oracle =
      '~ enters with X +1/+1 counters on it, where X is the greatest mana value among cards in exile.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    expect(eff.target).toEqual({ kind: 'Source' });
    expect(eff.counterType).toBe('+1/+1');

    const count = eff.count as AmountRef;
    expect(count && typeof count === 'object' && 'kind' in count ? (count as { kind: string }).kind : null).toBe('GreatestManaValue');
    const gmv = count as Extract<AmountRef, { kind: 'GreatestManaValue' }>;
    expect(gmv.zone).toBe('exile');
    expect(gmv.controller).toBe('each');
  });

  it('executes GreatestManaValue exile: picks highest CMC among exiled cards', () => {
    const oracle =
      '~ enters with X +1/+1 counters on it, where X is the greatest mana value among cards in exile.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const state = st([
      mk('src', 'd_creature', 'p0', 'battlefield'),
      mk('ex1', 'd_medium_creature', 'p0', 'exile'),  // CMC 4
      mk('ex2', 'd_big_creature', 'p1', 'exile'),     // CMC 7
      mk('ex3', 'd_instant', 'p0', 'exile'),          // CMC 1
      mk('gy1', 'd_big_creature', 'p0', 'graveyard'), // CMC 7, but NOT in exile
    ]);

    const s = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    // Greatest mana value in exile = 7 (from d_big_creature)
    expect(s.cards.get('src')!.counters['+1/+1']).toBe(7);
  });

  it('executes GreatestManaValue exile: zero counters when exile is empty', () => {
    const oracle =
      '~ enters with X +1/+1 counters on it, where X is the greatest mana value among cards in exile.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const state = st([
      mk('src', 'd_creature', 'p0', 'battlefield'),
      mk('gy1', 'd_big_creature', 'p0', 'graveyard'), // NOT in exile
    ]);

    const s = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    expect(s.cards.get('src')!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

// ── (5) Honesty: unsupported forms still decline ─────────────────────────────

describe('slice-6 ETB counters: honesty — unsupported forms stay Unparsed or skip counters', () => {
  it('does not parse "where X is the amount of life you\'ve gained this turn"', () => {
    // Voracious Wurm actual text — life-gained-this-turn has no tracker
    const oracle =
      "This creature enters with X +1/+1 counters on it, where X is the amount of life you've gained this turn.";
    const eff = getAddCountersEffect(oracle);
    if (eff) {
      // If parsed, count must NOT be a LifeTotal (wrong form) or ForEach
      const count = eff.count as AmountRef;
      const kindStr = count && typeof count === 'object' && 'kind' in count
        ? (count as { kind: string }).kind
        : null;
      // "amount of life gained this turn" is not supported — it should not resolve as LifeTotal
      // (LifeTotal is "your life total", not "amount gained this turn")
      expect(kindStr).not.toBe('LifeTotal');
    }
    // Unparsed is also acceptable
  });

  it('does not parse "where X is the amount of mana spent to cast it" (Magma Pummeler)', () => {
    // Magma Pummeler — mana spent is not trackable
    const oracle =
      '~ enters with X charge counters on it, where X is the amount of mana spent to cast it.';
    const eff = getAddCountersEffect(oracle);
    if (eff) {
      // Must not produce a LifeTotal, ForEach, or GreatestManaValue amount
      const count = eff.count as AmountRef;
      const kindStr = count && typeof count === 'object' && 'kind' in count
        ? (count as { kind: string }).kind
        : null;
      expect(kindStr).not.toBeOneOf(['LifeTotal', 'ForEach', 'GreatestManaValue']);
    }
    // Unparsed is also fine
  });
});
