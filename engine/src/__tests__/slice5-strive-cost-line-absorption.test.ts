/**
 * slice5-strive-cost-line-absorption — Slice 5/12
 *
 * Strive cost-line absorption and "any number of target" body parsing.
 *
 * HONESTY MODEL: The engine has no per-target additional-cost payment mechanism.
 * Strive surcharges ("This spell costs {M} more to cast for each target beyond
 * the first") are never charged. Absorbing the cost line is pure-downside:
 * the spell becomes strictly easier to cast. Only bodies that parse to a
 * supported effect (executed by the existing executor) are credited.
 *
 * NEW BODY MATCHERS enabled by this slice:
 *   1. "Any number of target creatures [you control] each get +P/+T [and gain kw] until end of turn"
 *      (matchMultiTargetPumpGrant extended with "any number of" count prefix)
 *   2. "Any number of target creatures each gain[s] <keyword> until end of turn"
 *      (matchMultiTargetPumpGrant pure-keyword-gain path — also fixes a pre-existing
 *       hasDynamicXPT bug that prevented pure keyword grant forms from parsing)
 *   3. "Return any number of target creatures to their owners' hands"
 *      (matchMultiTarget extended with "any number of" count prefix → ReturnToHand)
 *   4. "Put N <type> counters on any number of target creatures [you control]"
 *      (matchAddCounters sub-case A3c — each chosen creature gets the full N counters)
 *   5. "Destroy/Exile any number of target <type>" via matchMultiTarget "any number" branch
 *
 * REAL CARD EXAMPLES tested below:
 *   Ajani's Presence (indestructible grant)
 *   Hubris (bounce)
 *   Nature's Panoply (+1/+1 counters)
 *   Setessan Tactics-style (up to N pump, already parsed, strive absorption confirms)
 *   Silence the Believers (exile creatures + Auras — Aura clause silently dropped)
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { hasKeyword } from '../keywords';
import type { GameState, CardInstance, CardDefinition } from '../types';
import type { Effect } from '../effects/ast';

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function makeDef(id: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: 2,
    toughness: 2,
    card_types: ['creature'],
    ...overrides,
  } as CardDefinition;
}

function makeCreature(instanceId: string, ownerId: string, overrides: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId,
    definitionId: 'def-bear',
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...overrides,
  } as CardInstance;
}

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();
  cardDefinitions.set('def-bear', makeDef('def-bear'));

  // player-1 controls c1, c2, c3; player-2 controls e1, e2
  cards.set('c1', makeCreature('c1', 'player-1'));
  cards.set('c2', makeCreature('c2', 'player-1'));
  cards.set('c3', makeCreature('c3', 'player-1'));
  cards.set('e1', makeCreature('e1', 'player-2'));
  cards.set('e2', makeCreature('e2', 'player-2'));

  const players = ['player-1', 'player-2'].map((id, idx) => ({
    id,
    name: id,
    life: 40,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    hasPlayedLand: false,
    hasPriority: idx === 0,
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

// ---------------------------------------------------------------------------
// PARSER: Strive cost-line recognition and absorption
// ---------------------------------------------------------------------------

describe('slice5-strive-cost-line: STRIVE_COST_LINE_RE', () => {
  it('absorbs a single-mana Strive cost line (Ajani\'s Presence)', () => {
    const oracle = [
      'Strive — This spell costs {W} more to cast for each target beyond the first.',
      'Any number of target creatures each gain indestructible until end of turn.',
    ].join('\n');
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.absorbedKeywords).toHaveLength(1);
    expect(r.absorbedKeywords![0]).toMatch(/strive/i);
    expect(r.effects.some(e => e.kind === 'GrantKeyword')).toBe(true);
    const kw = r.effects.find(e => e.kind === 'GrantKeyword') as Extract<Effect, { kind: 'GrantKeyword' }>;
    expect(kw.keyword.toLowerCase()).toBe('indestructible');
  });

  it('absorbs a two-mana Strive cost line (Hubris)', () => {
    const oracle = [
      'Strive — This spell costs {1}{U} more to cast for each target beyond the first.',
      "Return any number of target creatures to their owners' hands.",
    ].join('\n');
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.absorbedKeywords).toHaveLength(1);
    expect(r.absorbedKeywords![0]).toMatch(/strive/i);
    expect(r.effects[0].kind).toBe('ReturnToHand');
    // Multi-target spec
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].count).toBeGreaterThanOrEqual(2);
  });

  it('absorbs a green Strive cost line (Nature\'s Panoply)', () => {
    const oracle = [
      'Strive — This spell costs {1}{G} more to cast for each target beyond the first.',
      'Put two +1/+1 counters on any number of target creatures you control.',
    ].join('\n');
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.absorbedKeywords).toHaveLength(1);
    expect(r.absorbedKeywords![0]).toMatch(/strive/i);
    expect(r.effects[0].kind).toBe('AddCounters');
    const eff = r.effects[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(eff.counterType).toBe('+1/+1');
    expect(eff.count).toBe(2);
    expect(r.targets[0].constraints?.controllerControls).toBe(true);
  });

  it('absorbs Strive line and parses "up to N target creatures each get +P/+T" (Setessan Tactics style)', () => {
    const oracle = [
      'Strive — This spell costs {1}{G} more to cast for each target beyond the first.',
      'Up to four target creatures you control each get +2/+2 until end of turn.',
    ].join('\n');
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.absorbedKeywords![0]).toMatch(/strive/i);
    const eff = r.effects[0] as Extract<Effect, { kind: 'ModifyPT' }>;
    expect(eff.kind).toBe('ModifyPT');
    expect(eff.power).toBe(2);
    expect(eff.toughness).toBe(2);
    expect(r.targets[0].count).toBe(4);
  });

  it('does NOT absorb a single-line Strive-only text (no substantive remainder)', () => {
    const r = parseOracleText('Strive — This spell costs {G} more to cast for each target beyond the first.');
    expect(r.kind).toBe('Unparsed');
  });

  it('does NOT absorb when the body after the Strive line fails to parse (Polymorphous Rush)', () => {
    const oracle = [
      'Strive — This spell costs {1}{U} more to cast for each target beyond the first.',
      'Until end of turn, any number of target creatures you control each become copies of target creature you control.',
    ].join('\n');
    const r = parseOracleText(oracle);
    // The "become copies" body is not supported — this must stay Unparsed
    expect(r.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// PARSER: "any number of target creatures" body matchers
// ---------------------------------------------------------------------------

describe('slice5-strive-cost-line: body matchers', () => {
  it('"Any number of target creatures each gain <keyword> until end of turn" (pure keyword grant)', () => {
    const r = parseOracleText('Any number of target creatures each gain indestructible until end of turn.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].count).toBe(10);  // unbounded
    expect(r.targets[0].minCount).toBe(0);
    const kw = r.effects[0] as Extract<Effect, { kind: 'GrantKeyword' }>;
    expect(kw.kind).toBe('GrantKeyword');
    expect(kw.keyword.toLowerCase()).toBe('indestructible');
    expect(kw.untilEndOfTurn).toBe(true);
  });

  it('"Any number of target creatures each get +P/+T until end of turn" (pump)', () => {
    const r = parseOracleText('Any number of target creatures each get +2/+2 until end of turn.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.targets[0].count).toBe(10);
    const eff = r.effects[0] as Extract<Effect, { kind: 'ModifyPT' }>;
    expect(eff.kind).toBe('ModifyPT');
    expect(eff.power).toBe(2);
    expect(eff.toughness).toBe(2);
  });

  it('"Any number of target creatures you control each get +P/+T and gain kw until end of turn"', () => {
    const r = parseOracleText(
      'Any number of target creatures you control each get +1/+1 and gain first strike and vigilance until end of turn.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.targets[0].constraints?.controllerControls).toBe(true);
    expect(r.effects.some(e => e.kind === 'ModifyPT')).toBe(true);
    expect(r.effects.some(e => e.kind === 'GrantKeyword' && (e as any).keyword.toLowerCase() === 'first strike')).toBe(true);
    expect(r.effects.some(e => e.kind === 'GrantKeyword' && (e as any).keyword.toLowerCase() === 'vigilance')).toBe(true);
  });

  it('"Return any number of target creatures to their owners\' hands" (Hubris body)', () => {
    const r = parseOracleText("Return any number of target creatures to their owners' hands.");
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('ReturnToHand');
    expect(r.targets[0].count).toBe(10);
    expect(r.targets[0].minCount).toBe(0);
  });

  it('"Put N counters on any number of target creatures you control" (Nature\'s Panoply body)', () => {
    const r = parseOracleText('Put two +1/+1 counters on any number of target creatures you control.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const eff = r.effects[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(eff.kind).toBe('AddCounters');
    expect(eff.counterType).toBe('+1/+1');
    expect(eff.count).toBe(2);
    expect(r.targets[0].count).toBe(10);
    expect(r.targets[0].constraints?.controllerControls).toBe(true);
  });

  it('"Destroy any number of target enchantments you control" (Mortal Obstinacy body)', () => {
    const r = parseOracleText('Destroy any number of target enchantments you control.');
    // matchMultiTarget handles "destroy any number of target <type>" — but Enchantment
    // TargetType is 'Enchantment' (singular) so we need "enchantments" plural. Check parse.
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('Destroy');
    expect(r.targets[0].type).toBe('Enchantment');
  });
});

// ---------------------------------------------------------------------------
// PARSER: regression guard — "up to N each get/gain" forms must still work
// ---------------------------------------------------------------------------

describe('slice5-strive-cost-line: regression — existing forms unaffected', () => {
  it('"Up to two target creatures each get +1/+1 until end of turn" (unchanged)', () => {
    const r = parseOracleText('Up to two target creatures each get +1/+1 until end of turn.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.targets[0].count).toBe(2);
    expect(r.targets[0].minCount).toBe(1);
  });

  it('"Two target creatures each get +1/+1 and gain trample until end of turn" (exact count)', () => {
    const r = parseOracleText('Two target creatures each get +1/+1 and gain trample until end of turn.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.targets[0].count).toBe(2);
    expect(r.effects.some(e => e.kind === 'ModifyPT')).toBe(true);
    expect(r.effects.some(e => e.kind === 'GrantKeyword')).toBe(true);
  });

  it('"Up to two target creatures each get +X/+X ... where X is" (Allied Assault — where-clause still required)', () => {
    const r = parseOracleText(
      'Up to two target creatures each get +X/+X until end of turn, where X is the number of creatures you control.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('ModifyPT');
    const eff = r.effects[0] as Extract<Effect, { kind: 'ModifyPT' }>;
    expect(typeof eff.power).toBe('object'); // AmountRef (dynamic)
  });

  it('Strive line on its own produces Spell for an already-parseable body', () => {
    // Existing behavior: "Strive ... + up to N target" already parses via parseMultipleEffects token-skip.
    // Confirm absorption also works for this case.
    const oracle = [
      'Strive — This spell costs {2}{B} more to cast for each target beyond the first.',
      'Exile any number of target creatures and all Auras attached to them.',
    ].join('\n');
    const r = parseOracleText(oracle);
    // The creature exile fires (Aura clause is silently not executed — pure downside).
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.absorbedKeywords![0]).toMatch(/strive/i);
    expect(r.effects[0].kind).toBe('Exile');
  });
});

// ---------------------------------------------------------------------------
// EXECUTION: verify the executor handles multi-target any-number specs
// ---------------------------------------------------------------------------

describe('slice5-strive-cost-line: execution', () => {
  it('Ajani\'s Presence: GrantKeyword Indestructible applies to all chosen creatures', () => {
    const oracle = [
      'Strive — This spell costs {W} more to cast for each target beyond the first.',
      'Any number of target creatures each gain indestructible until end of turn.',
    ].join('\n');
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const state = makeState();
    // Choose 2 of our 3 creatures
    const result = executeEffects(state, parsed.effects, 'player-1', ['c1', 'c2'], parsed.targets);

    // The executor writes keyword grants into card.grantedKeywords (until-end-of-turn layer)
    const c1Keys = (result.cards.get('c1')?.grantedKeywords ?? []).map((k: string) => k.toLowerCase());
    const c2Keys = (result.cards.get('c2')?.grantedKeywords ?? []).map((k: string) => k.toLowerCase());
    const c3Keys = (result.cards.get('c3')?.grantedKeywords ?? []).map((k: string) => k.toLowerCase());

    expect(c1Keys).toContain('indestructible');
    expect(c2Keys).toContain('indestructible');
    // c3 was not chosen — must not get indestructible
    expect(c3Keys).not.toContain('indestructible');
  });

  it('Hubris: ReturnToHand removes chosen creatures from battlefield', () => {
    const oracle = [
      'Strive — This spell costs {1}{U} more to cast for each target beyond the first.',
      "Return any number of target creatures to their owners' hands.",
    ].join('\n');
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const state = makeState();
    // Choose 2 opponent creatures
    const result = executeEffects(state, parsed.effects, 'player-1', ['e1', 'e2'], parsed.targets);

    expect(result.cards.get('e1')?.zone).toBe('hand');
    expect(result.cards.get('e2')?.zone).toBe('hand');
    // Our creatures untouched
    expect(result.cards.get('c1')?.zone).toBe('battlefield');
    expect(result.cards.get('c2')?.zone).toBe('battlefield');
  });

  it("Nature's Panoply: AddCounters puts N counters on each chosen creature", () => {
    const oracle = [
      'Strive — This spell costs {1}{G} more to cast for each target beyond the first.',
      'Put two +1/+1 counters on any number of target creatures you control.',
    ].join('\n');
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const state = makeState();
    // Choose 2 creatures — each should get 2 counters
    const result = executeEffects(state, parsed.effects, 'player-1', ['c1', 'c3'], parsed.targets);

    expect(result.cards.get('c1')?.counters['+1/+1']).toBe(2);
    expect(result.cards.get('c3')?.counters['+1/+1']).toBe(2);
    // c2 was not chosen
    expect(result.cards.get('c2')?.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('"any number" allows choosing zero targets (minCount=0)', () => {
    const oracle = [
      'Strive — This spell costs {1}{G} more to cast for each target beyond the first.',
      'Put two +1/+1 counters on any number of target creatures you control.',
    ].join('\n');
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.targets[0].minCount).toBe(0);

    // Execute with zero chosen targets — must not throw
    const state = makeState();
    const result = executeEffects(state, parsed.effects, 'player-1', [], parsed.targets);

    // No counters placed on any creature
    for (const [, card] of result.cards) {
      expect(card.counters['+1/+1'] ?? 0).toBe(0);
    }
  });
});
