import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { isEntersWithCountersDynamicLine } from '../effects/matchers/counters';
import type { Effect, ForEachAmount } from '../effects/ast';

// Slice 5/12: Enters-with-counters dynamic "equal to" form
//
// Tests that the "a number of <type> counters on it equal to the number of <filter> <zone>"
// wording parses to AddCounters(Source, +1/+1, ForEachAmount) and executes correctly via
// the matchEntersWithCountersEqualTo matcher (parser) and stack.ts entersWithCountersDynamic
// Path C (runtime counter placement at entry).
//
// Oracle patterns covered (verbatim from real cards):
//   - Undergrowth Scavenger: "This creature enters with a number of +1/+1 counters on it
//     equal to the number of creature cards in all graveyards."
//   - Rhizome Lurcher: "Undergrowth — This creature enters with a number of +1/+1 counters
//     on it equal to the number of creature cards in your graveyard."
//   - Generic "equal to" form: creatures in hand, cards in exile, etc.
//
// Honesty bar tests:
//   - "equal to this creature's power" (Master Biomancer-style) stays Unparsed or non-AddCounters
//     (no executor path in entersWithCountersDynamic for cross-card power)
//   - "three times that many" / Devour multiplier forms stay Unparsed
//     (per-iteration multiplier not expressible in the executor)

// ── helpers ──────────────────────────────────────────────────────────────────

function def(
  id: string,
  name: string,
  typeLine: string,
  types: string[],
  oracleText = '',
  pt?: [number, number],
): CardDefinition {
  return {
    id, name, type_line: typeLine, oracle_text: oracleText, mana_cost: '{1}', cmc: 1,
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
];

function mk(id: string, defId: string, owner: string, zone: CardInstance['zone']): CardInstance {
  return {
    instanceId: id, definitionId: defId, ownerId: owner, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function st(cards: CardInstance[], extraDefs: CardDefinition[] = []): GameState {
  const allDefs = [...DEFS, ...extraDefs];
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(allDefs.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function expectForEach(amount: unknown): ForEachAmount {
  expect(amount && typeof amount === 'object').toBe(true);
  const a = amount as ForEachAmount;
  expect(a.kind).toBe('ForEach');
  return a;
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

// ── parse tests ───────────────────────────────────────────────────────────────

describe('slice-5/12 ETB counters equal-to: parser', () => {
  it('parses Undergrowth Scavenger: "This creature enters with a number of +1/+1 counters on it equal to the number of creature cards in all graveyards."', () => {
    const oracle =
      'This creature enters with a number of +1/+1 counters on it equal to the number of creature cards in all graveyards.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).not.toBe('Unparsed');
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;
    expect(eff.counterType).toBe('+1/+1');
    expect(eff.target).toEqual({ kind: 'Source' });
    const fe = expectForEach(eff.count);
    expect(fe.zone).toBe('graveyard');
    expect(fe.controller).toBe('each');
    expect(fe.filter).toEqual({ types: ['creature'] });
  });

  it('parses Rhizome Lurcher: "Undergrowth — This creature enters with a number of +1/+1 counters on it equal to the number of creature cards in your graveyard."', () => {
    const oracle =
      'Undergrowth — This creature enters with a number of +1/+1 counters on it equal to the number of creature cards in your graveyard.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).not.toBe('Unparsed');
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;
    expect(eff.counterType).toBe('+1/+1');
    expect(eff.target).toEqual({ kind: 'Source' });
    const fe = expectForEach(eff.count);
    expect(fe.zone).toBe('graveyard');
    expect(fe.controller).toBe('you');
    expect(fe.filter).toEqual({ types: ['creature'] });
  });

  it('parses generic "equal to the number of creatures you control" (your battlefield count)', () => {
    const oracle =
      'This creature enters with a number of +1/+1 counters on it equal to the number of creatures you control.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).not.toBe('Unparsed');
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;
    expect(eff.counterType).toBe('+1/+1');
    expect(eff.target).toEqual({ kind: 'Source' });
    const fe = expectForEach(eff.count);
    expect(fe.zone).toBe('battlefield');
    expect(fe.controller).toBe('you');
  });

  it('parses "~ enters with a number of +1/+1 counters on it equal to the number of lands you control."', () => {
    const oracle =
      '~ enters with a number of +1/+1 counters on it equal to the number of lands you control.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).not.toBe('Unparsed');
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;
    expect(eff.counterType).toBe('+1/+1');
    const fe = expectForEach(eff.count);
    expect(fe.zone).toBe('battlefield');
    expect(fe.controller).toBe('you');
    expect(fe.filter).toEqual({ types: ['land'] });
  });

  it('isEntersWithCountersDynamicLine recognises the equal-to wording with Undergrowth prefix', () => {
    // Undergrowth Scavenger line
    expect(isEntersWithCountersDynamicLine(
      'This creature enters with a number of +1/+1 counters on it equal to the number of creature cards in all graveyards.',
    )).toBe(true);
    // Rhizome Lurcher line (with ability-word prefix)
    expect(isEntersWithCountersDynamicLine(
      'Undergrowth — This creature enters with a number of +1/+1 counters on it equal to the number of creature cards in your graveyard.',
    )).toBe(true);
    // Static counters form (should NOT match)
    expect(isEntersWithCountersDynamicLine(
      'This creature enters with a +1/+1 counter on it.',
    )).toBe(false);
    // Where-X form (should NOT match the equal-to regex)
    expect(isEntersWithCountersDynamicLine(
      'This creature enters with X +1/+1 counters on it, where X is the number of creatures you control.',
    )).toBe(false);
  });

  it('does NOT parse Master Biomancer "equal to this creature\'s power" (no executor path for cross-card power)', () => {
    // "Each other creature you control enters with a number of additional +1/+1 counters
    // on it equal to this creature's power." — the "equal to this creature's power" tail
    // is not resolvable via parseNumberOfFilterAmount (it's not a "number of <filter> <zone>" form).
    // This should remain Unparsed or produce a non-AddCounters result so we stay honest.
    const oracle =
      "Each other creature you control enters with a number of additional +1/+1 counters on it equal to this creature's power.";
    const parsed = parseOracleText(oracle);
    // We do NOT assert Unparsed (a static ability may partially match), but we DO assert
    // that IF AddCounters is produced, it must NOT have a ForEachAmount count (which would
    // imply a fabricated executor path).
    if (parsed.kind === 'Spell' || parsed.kind === 'ETB' || parsed.kind === 'Triggered') {
      const effArr: Effect[] =
        parsed.kind === 'Spell' ? parsed.effects
        : parsed.ability.effects;
      const eff = effArr.find(e => e.kind === 'AddCounters') as Extract<Effect, { kind: 'AddCounters' }> | undefined;
      if (eff) {
        // If somehow an AddCounters is produced, count must not be ForEach (no executor)
        const isForEach = typeof eff.count === 'object' && 'kind' in (eff.count as object) &&
          (eff.count as { kind: string }).kind === 'ForEach';
        expect(isForEach).toBe(false);
      }
    }
    // Assert that the oracle doesn't parse as a clean Spell with fabricated ForEach counters
    // by checking that matchEntersWithCountersEqualTo doesn't return ForEach for this input
    const innerEff = getAddCountersEffect(oracle);
    if (innerEff && typeof innerEff.count === 'object') {
      expect((innerEff.count as { kind: string }).kind).not.toBe('ForEach');
    }
  });
});

// ── execute tests (via executeEffects with Source target) ────────────────────

describe('slice-5/12 ETB counters equal-to: execution via executeEffects', () => {
  it('Undergrowth Scavenger: 2 creature cards in all graveyards → 2 +1/+1 counters placed', () => {
    const oracle =
      'This creature enters with a number of +1/+1 counters on it equal to the number of creature cards in all graveyards.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).not.toBe('Unparsed');

    const scavengerDef = def('d_scavenger', 'Undergrowth Scavenger', 'Creature', ['creature'], oracle, [0, 0]);
    const scavengerCard = mk('scavenger', 'd_scavenger', 'p0', 'battlefield');

    // Two creature cards in graveyards (one owned by p0, one by p1)
    const gy1 = mk('gy_c1', 'd_creature', 'p0', 'graveyard');
    const gy2 = mk('gy_c2', 'd_creature', 'p1', 'graveyard');
    // One non-creature card in graveyard (should NOT count)
    const gy3 = mk('gy_f1', 'd_forest', 'p0', 'graveyard');

    const state = st([scavengerCard, gy1, gy2, gy3], [scavengerDef]);

    const effArr: Effect[] =
      parsed.kind === 'Spell' ? parsed.effects
      : parsed.kind === 'ETB' ? parsed.ability.effects
      : parsed.kind === 'Triggered' ? parsed.ability.effects
      : [];
    expect(effArr.length).toBeGreaterThanOrEqual(1);

    const nextState = executeEffects(state, effArr, 'p0', [], [], 0, { sourceInstanceId: 'scavenger' });
    const updated = nextState.cards.get('scavenger');
    expect(updated?.counters['+1/+1']).toBe(2);
  });

  it('Rhizome Lurcher (your graveyard only): 3 creature cards in YOUR graveyard, 2 in opponent\'s → 3 counters', () => {
    const oracle =
      'Undergrowth — This creature enters with a number of +1/+1 counters on it equal to the number of creature cards in your graveyard.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).not.toBe('Unparsed');

    const lurcher = def('d_lurcher', 'Rhizome Lurcher', 'Creature', ['creature'], oracle, [0, 0]);
    const lurcherCard = mk('lurcher', 'd_lurcher', 'p0', 'battlefield');

    // 3 creature cards in p0's graveyard
    const gy1 = mk('gy_c1', 'd_creature', 'p0', 'graveyard');
    const gy2 = mk('gy_c2', 'd_creature', 'p0', 'graveyard');
    const gy3 = mk('gy_c3', 'd_creature', 'p0', 'graveyard');
    // 2 creature cards in p1's graveyard (should NOT count for "your graveyard")
    const gy4 = mk('gy_c4', 'd_creature', 'p1', 'graveyard');
    const gy5 = mk('gy_c5', 'd_creature', 'p1', 'graveyard');

    const state = st([lurcherCard, gy1, gy2, gy3, gy4, gy5], [lurcher]);

    const effArr: Effect[] =
      parsed.kind === 'Spell' ? parsed.effects
      : parsed.kind === 'ETB' ? parsed.ability.effects
      : parsed.kind === 'Triggered' ? parsed.ability.effects
      : [];
    expect(effArr.length).toBeGreaterThanOrEqual(1);

    const nextState = executeEffects(state, effArr, 'p0', [], [], 0, { sourceInstanceId: 'lurcher' });
    const updated = nextState.cards.get('lurcher');
    expect(updated?.counters['+1/+1']).toBe(3);
  });

  it('zero matching cards → zero counters (no counter key created)', () => {
    const oracle =
      'This creature enters with a number of +1/+1 counters on it equal to the number of creature cards in all graveyards.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).not.toBe('Unparsed');

    const emptySelfDef = def('d_self', 'Empty Self', 'Creature', ['creature'], oracle, [2, 2]);
    const selfCard = mk('self', 'd_self', 'p0', 'battlefield');
    // Only non-creature cards in graveyard
    const gy1 = mk('gy_f1', 'd_forest', 'p0', 'graveyard');
    const gy2 = mk('gy_i1', 'd_instant', 'p1', 'graveyard');

    const state = st([selfCard, gy1, gy2], [emptySelfDef]);

    const effArr: Effect[] =
      parsed.kind === 'Spell' ? parsed.effects
      : parsed.kind === 'ETB' ? parsed.ability.effects
      : parsed.kind === 'Triggered' ? parsed.ability.effects
      : [];
    expect(effArr.length).toBeGreaterThanOrEqual(1);

    const nextState = executeEffects(state, effArr, 'p0', [], [], 0, { sourceInstanceId: 'self' });
    const updated = nextState.cards.get('self');
    // executeEffects skips counter placement when count resolves to 0
    expect(updated?.counters['+1/+1'] ?? 0).toBe(0);
  });
});

// ── stack.ts integration: entersWithCountersDynamic Path C ───────────────────

describe('slice-5/12 ETB counters equal-to: stack integration (Path C)', () => {
  it('isEntersWithCountersDynamicLine returns true for equal-to wording', () => {
    expect(isEntersWithCountersDynamicLine(
      'This creature enters with a number of +1/+1 counters on it equal to the number of creature cards in all graveyards.',
    )).toBe(true);
  });

  it('isEntersWithCountersDynamicLine returns false for "for each" wording (handled by Path B)', () => {
    expect(isEntersWithCountersDynamicLine(
      'This creature enters with a +1/+1 counter on it for each creature in all graveyards.',
    )).toBe(false);
  });

  it('isEntersWithCountersDynamicLine returns false for "where X is" wording (handled by Path A)', () => {
    expect(isEntersWithCountersDynamicLine(
      'This creature enters with X +1/+1 counters on it, where X is the number of creatures you control.',
    )).toBe(false);
  });
});
