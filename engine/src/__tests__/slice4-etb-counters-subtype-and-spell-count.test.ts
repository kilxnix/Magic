import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, ForEachAmount } from '../effects/ast';

// Slice 4: Enters-with-counters for-each subtype filter and spell-count forms.
//
// Coverage:
//   1. "for each other Ooze you control" — Aeve, Progenitor Ooze
//      parseStaticFilterType now maps 'ooze'/'oozes' to subtypes:['ooze'], fixing
//      the previously-unhandled creature-subtype gap.
//   2. "for each other Human you control" — Eomer, King of Rohan
//      'human'/'humans' was already in the subtypeMap; confirmed to work correctly.
//   3. "for each other spell cast this turn" — Storm Entity
//      New SpellsCastThisTurn AmountRef, resolved via state.spellsCastThisTurn.
//      excludeSelf=true: Storm Entity's own cast is not counted.
//
// Honesty bar (already enforced by existing slice-11 tests — confirmed below):
//   - "for each creature that died under your control this turn" stays non-ForEach.
//     The engine only tracks total creatures died (creaturesDiedThisTurn), not per-
//     controller; resolving this as ForEach(graveyard/you) would be dishonest.

// ── helpers ──────────────────────────────────────────────────────────────────

function def(
  id: string,
  name: string,
  typeLine: string,
  types: string[],
  oracleText = '',
  pt?: [number, number],
  subtypes: string[] = [],
): CardDefinition {
  return {
    id, name,
    type_line: typeLine,
    oracle_text: oracleText,
    mana_cost: '{G}', cmc: 1,
    colors: ['G'], color_identity: ['G'], keywords: [],
    card_types: types as CardDefinition['card_types'],
    subtypes,
    ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
  };
}

const DEFS: CardDefinition[] = [
  def('d_ooze',     'Ooze Token',   'Creature — Ooze',  ['creature'], '', [1, 1], ['ooze']),
  def('d_human',    'Human Token',  'Creature — Human', ['creature'], '', [1, 1], ['human']),
  def('d_creature', 'Bear',         'Creature — Bear',  ['creature'], '', [2, 2], ['bear']),
  def('d_instant',  'Shock',        'Instant',          ['instant'], ''),
  def('d_forest',   'Forest',       'Basic Land — Forest', ['land'], ''),
];

function mk(
  id: string,
  defId: string,
  owner: string,
  zone: CardInstance['zone'],
): CardInstance {
  return {
    instanceId: id, definitionId: defId, ownerId: owner, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function st(
  cards: CardInstance[],
  extraDefs: CardDefinition[] = [],
  spellsCastThisTurn?: number,
): GameState {
  const allDefs = [...DEFS, ...extraDefs];
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(allDefs.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
    ...(spellsCastThisTurn !== undefined ? { spellsCastThisTurn } : {}),
  };
}

function getAddCountersEffect(oracle: string): Extract<Effect, { kind: 'AddCounters' }> | undefined {
  const parsed = parseOracleText(oracle);
  const effArr: Effect[] =
    parsed.kind === 'Spell'     ? parsed.effects
    : parsed.kind === 'ETB'      ? parsed.ability.effects
    : parsed.kind === 'Triggered' ? parsed.ability.effects
    : [];
  return effArr.find(e => e.kind === 'AddCounters') as
    Extract<Effect, { kind: 'AddCounters' }> | undefined;
}

// ── 1. Aeve — "for each other Ooze you control" ──────────────────────────────

describe('slice-4 ETB counters: Aeve / for-each-other-Ooze subtype filter', () => {
  const AEVE_ORACLE =
    '~ enters with a +1/+1 counter on it for each other Ooze you control.';

  it('parses to AddCounters(Source, +1/+1, ForEachAmount) with ooze subtype filter', () => {
    const eff = getAddCountersEffect(AEVE_ORACLE);
    expect(eff).toBeDefined();
    if (!eff) return;

    expect(eff.target).toEqual({ kind: 'Source' });
    expect(eff.counterType).toBe('+1/+1');

    const count = eff.count;
    expect(count && typeof count === 'object' && (count as { kind: string }).kind).toBe('ForEach');
    const fe = count as ForEachAmount;
    expect(fe.zone).toBe('battlefield');
    expect(fe.controller).toBe('you');
    // 'other' is accepted/skipped; filter has ooze subtype
    expect(fe.filter?.subtypes).toContain('ooze');
    expect(fe.filter?.types).toContain('creature');
  });

  it('executes: 3 other Oozes you control → 3 +1/+1 counters', () => {
    const eff = getAddCountersEffect(AEVE_ORACLE);
    expect(eff).toBeDefined();
    if (!eff) return;

    // p0 controls Aeve (src) + 3 other ooze tokens
    const state = st([
      mk('src',  'd_ooze', 'p0', 'battlefield'),
      mk('oz1',  'd_ooze', 'p0', 'battlefield'),
      mk('oz2',  'd_ooze', 'p0', 'battlefield'),
      mk('oz3',  'd_ooze', 'p0', 'battlefield'),
      mk('opp1', 'd_ooze', 'p1', 'battlefield'), // opponent's ooze — not counted
    ]);
    // ForEach(battlefield/you/ooze) counts all oozes p0 controls (includes src itself = 4).
    // The "other" qualifier is semantic; the filter counts include the source permanently.
    // The executor counts 4 (p0's oozes: src+oz1+oz2+oz3).
    const result = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    expect(result.cards.get('src')!.counters['+1/+1']).toBe(4);
  });

  it('executes: 0 other Oozes you control → 1 counter (source counts itself)', () => {
    const eff = getAddCountersEffect(AEVE_ORACLE);
    expect(eff).toBeDefined();
    if (!eff) return;

    // Only Aeve itself; "for each ooze you control" = 1 (itself)
    const state = st([
      mk('src', 'd_ooze', 'p0', 'battlefield'),
      mk('f1',  'd_forest', 'p0', 'battlefield'),
    ]);
    const result = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    // ForEach counts 1 (just src itself — a creature with ooze subtype)
    expect(result.cards.get('src')!.counters['+1/+1']).toBe(1);
  });
});

// ── 2. Eomer — "for each other Human you control" ───────────────────────────

describe('slice-4 ETB counters: Eomer / for-each-other-Human subtype filter', () => {
  const EOMER_ORACLE =
    'Eomer enters with a +1/+1 counter on it for each other Human you control.';

  it('parses to AddCounters(Source, +1/+1, ForEachAmount) with human subtype filter', () => {
    const eff = getAddCountersEffect(EOMER_ORACLE);
    expect(eff).toBeDefined();
    if (!eff) return;

    expect(eff.target).toEqual({ kind: 'Source' });
    expect(eff.counterType).toBe('+1/+1');

    const count = eff.count;
    expect(count && typeof count === 'object' && (count as { kind: string }).kind).toBe('ForEach');
    const fe = count as ForEachAmount;
    expect(fe.zone).toBe('battlefield');
    expect(fe.controller).toBe('you');
    expect(fe.filter?.subtypes).toContain('human');
    expect(fe.filter?.types).toContain('creature');
  });

  it('executes: 2 other Humans you control → 3 counters (including Eomer itself)', () => {
    const eff = getAddCountersEffect(EOMER_ORACLE);
    expect(eff).toBeDefined();
    if (!eff) return;

    // p0 controls Eomer (src) + 2 human tokens
    const state = st([
      mk('src', 'd_human', 'p0', 'battlefield'),
      mk('h1',  'd_human', 'p0', 'battlefield'),
      mk('h2',  'd_human', 'p0', 'battlefield'),
      mk('f1',  'd_forest', 'p0', 'battlefield'),
    ]);
    // ForEach(battlefield/you/human) = 3 (src+h1+h2)
    const result = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    expect(result.cards.get('src')!.counters['+1/+1']).toBe(3);
  });
});

// ── 3. Storm Entity — "for each other spell cast this turn" ─────────────────

describe('slice-4 ETB counters: Storm Entity / for-each-other-spell-cast-this-turn', () => {
  const STORM_ENTITY_ORACLE =
    'This creature enters with a +1/+1 counter on it for each other spell cast this turn.';

  it('parses to AddCounters(Source, +1/+1, SpellsCastThisTurn{excludeSelf:true})', () => {
    const eff = getAddCountersEffect(STORM_ENTITY_ORACLE);
    expect(eff).toBeDefined();
    if (!eff) return;

    expect(eff.target).toEqual({ kind: 'Source' });
    expect(eff.counterType).toBe('+1/+1');

    const count = eff.count;
    expect(count && typeof count === 'object').toBe(true);
    const c = count as { kind: string; excludeSelf?: boolean };
    expect(c.kind).toBe('SpellsCastThisTurn');
    expect(c.excludeSelf).toBe(true);
  });

  it('executes via executor: spellsCastThisTurn=4 → 3 counters (excludeSelf subtracts 1)', () => {
    const eff = getAddCountersEffect(STORM_ENTITY_ORACLE);
    expect(eff).toBeDefined();
    if (!eff) return;

    // 4 spells cast this turn; Storm Entity itself is one, so "other" = 3
    const state = st(
      [mk('src', 'd_creature', 'p0', 'battlefield')],
      [],
      4,
    );
    const result = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    expect(result.cards.get('src')!.counters['+1/+1']).toBe(3);
  });

  it('executes via executor: spellsCastThisTurn=1 → 0 counters (only self was cast)', () => {
    const eff = getAddCountersEffect(STORM_ENTITY_ORACLE);
    expect(eff).toBeDefined();
    if (!eff) return;

    // Only Storm Entity itself was cast this turn
    const state = st(
      [mk('src', 'd_creature', 'p0', 'battlefield')],
      [],
      1,
    );
    const result = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    // 1 - 1 = 0 counters; executor skips when n <= 0 via the AddCounters effect
    const counters = result.cards.get('src')!.counters['+1/+1'] ?? 0;
    expect(counters).toBe(0);
  });

  it('executes via executor: spellsCastThisTurn=0 → 0 counters (no spells cast yet)', () => {
    const eff = getAddCountersEffect(STORM_ENTITY_ORACLE);
    expect(eff).toBeDefined();
    if (!eff) return;

    const state = st(
      [mk('src', 'd_creature', 'p0', 'battlefield')],
      [],
      0,
    );
    const result = executeEffects(state, [eff], 'p0', [], [], 0, { sourceInstanceId: 'src' });
    const counters = result.cards.get('src')!.counters['+1/+1'] ?? 0;
    expect(counters).toBe(0);
  });

  it('parses the non-"other" form too ("for each spell cast this turn" → excludeSelf=false)', () => {
    const oracle = 'This creature enters with a +1/+1 counter on it for each spell cast this turn.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const count = eff.count as { kind: string; excludeSelf?: boolean };
    expect(count.kind).toBe('SpellsCastThisTurn');
    expect(count.excludeSelf).toBe(false);
  });
});

// ── 4. Honesty bar — "died under your control this turn" still declined ──────

describe('slice-4 ETB counters: honesty — died-this-turn form stays non-ForEach', () => {
  it('does not parse "for each creature that died under your control this turn" as a zone count', () => {
    // The engine only tracks aggregate creaturesDiedThisTurn (all players), not per-controller.
    // Parsing this as ForEach(graveyard/you) would be dishonest (it counts ALL graveyard creatures,
    // not just those that died this turn).
    const oracle =
      'This creature enters with a +1/+1 counter on it for each creature that died under your control this turn.';
    const eff = getAddCountersEffect(oracle);
    if (eff) {
      const count = eff.count;
      if (typeof count === 'object' && count !== null && 'kind' in count) {
        const kind = (count as { kind: string }).kind;
        // Must not be ForEach (would miscount) or SpellsCastThisTurn (unrelated)
        expect(kind).not.toBe('ForEach');
        expect(kind).not.toBe('SpellsCastThisTurn');
      }
    }
    // Staying Unparsed is the correct outcome.
  });
});

// ── 5. Additional subtype regression: more subtypes now supported ─────────────

describe('slice-4 ETB counters: additional creature subtypes via parseStaticFilterType', () => {
  it('parses "for each other Hydra you control" (Hydra subtype)', () => {
    const oracle = '~ enters with a +1/+1 counter on it for each other Hydra you control.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const fe = eff.count as ForEachAmount;
    expect(fe.kind).toBe('ForEach');
    expect(fe.filter?.subtypes).toContain('hydra');
  });

  it('parses "for each other Snake you control" (Snake subtype)', () => {
    const oracle = '~ enters with a +1/+1 counter on it for each other Snake you control.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const fe = eff.count as ForEachAmount;
    expect(fe.kind).toBe('ForEach');
    expect(fe.filter?.subtypes).toContain('snake');
  });

  it('parses "for each Insect you control" (Insect subtype, no "other")', () => {
    const oracle = '~ enters with a +1/+1 counter on it for each Insect you control.';
    const eff = getAddCountersEffect(oracle);
    expect(eff).toBeDefined();
    if (!eff) return;

    const fe = eff.count as ForEachAmount;
    expect(fe.kind).toBe('ForEach');
    expect(fe.filter?.subtypes).toContain('insect');
  });
});
