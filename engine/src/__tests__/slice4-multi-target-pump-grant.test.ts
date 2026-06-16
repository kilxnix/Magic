/**
 * slice4-multi-target-pump-grant — Slice 4/12
 *
 * Parse and execute tests for multi-target pump/grant:
 *   - "N target creatures each get +P/+T until end of turn"         (exact-count form)
 *   - "up to N target creatures each get +P/+T until end of turn"   (up-to form)
 *   - "one or two target creatures each get +P/+T until end of turn" (range form)
 *   - Plus "and gain[s] <keyword>" suffix variant
 *   - "up to N target creatures each get +X/+X ..., where X is the number of..." (Allied Assault)
 *   - "Support N" keyword action (= put a +1/+1 counter on each of up to N other target creatures)
 *
 * Uses real oracle-wording fragments from the slice examples:
 *   Cutthroat Maneuver, Nahiri's Stoneblades, Allied Assault, Terrific Team-Up, Expedition Raptor.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardInstance, CardDefinition } from '../types';
import type { Effect } from '../effects/ast';

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function makeDef(id: string): CardDefinition {
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
  } as CardDefinition;
}

function makeCreature(instanceId: string, ownerId: string): CardInstance {
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
  } as CardInstance;
}

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();
  cardDefinitions.set('def-bear', makeDef('def-bear'));

  // player-1 controls c1, c2, c3 ; player-2 controls e1, e2
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

const counters = (s: GameState, id: string) => s.cards.get(id)?.counters ?? {};
const ptMod = (s: GameState, id: string) => {
  const c = s.cards.get(id)?.counters ?? {};
  return { power: (c['_powerMod'] as number) ?? 0, toughness: (c['_toughnessMod'] as number) ?? 0 };
};

// ---------------------------------------------------------------------------
// PARSER: "up to N target creatures each get +P/+T until end of turn"
// ---------------------------------------------------------------------------

describe('slice4-multi-target-pump-grant: parser', () => {
  it('parses "Up to two target creatures each get +1/+1 until end of turn." (Cutthroat Maneuver)', () => {
    const parsed = parseOracleText('Up to two target creatures each get +1/+1 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].count).toBe(2);
    expect(parsed.targets[0].minCount).toBe(1);

    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0] as Extract<Effect, { kind: 'ModifyPT' }>;
    expect(eff.kind).toBe('ModifyPT');
    expect(eff.power).toBe(1);
    expect(eff.toughness).toBe(1);
    expect(eff.untilEndOfTurn).toBe(true);
    // The effect targets the same spec
    expect((eff.target as { targetId: string }).targetId).toBe(parsed.targets[0].id);
  });

  it('parses "Two target creatures each get +1/+1 until end of turn." (Nahiri\'s Stoneblades)', () => {
    const parsed = parseOracleText('Two target creatures each get +1/+1 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(2);
    // Exact count — no minCount (must pick exactly 2)
    expect(parsed.targets[0].minCount).toBeUndefined();

    expect(parsed.effects).toHaveLength(1);
    expect(parsed.effects[0].kind).toBe('ModifyPT');
  });

  it('parses "Two target creatures each get +1/+1 and gain trample until end of turn." (Terrific Team-Up)', () => {
    const parsed = parseOracleText('Two target creatures each get +1/+1 and gain trample until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(2);

    expect(parsed.effects).toHaveLength(2);
    const pt = parsed.effects[0] as Extract<Effect, { kind: 'ModifyPT' }>;
    expect(pt.kind).toBe('ModifyPT');
    expect(pt.power).toBe(1);
    expect(pt.toughness).toBe(1);

    const kw = parsed.effects[1] as Extract<Effect, { kind: 'GrantKeyword' }>;
    expect(kw.kind).toBe('GrantKeyword');
    expect(kw.keyword).toBe('Trample');
    expect(kw.untilEndOfTurn).toBe(true);

    // Both effects target the same spec
    const specId = parsed.targets[0].id;
    expect((pt.target as { targetId: string }).targetId).toBe(specId);
    expect((kw.target as { targetId: string }).targetId).toBe(specId);
  });

  it('parses "One or two target creatures each get +1/+1 until end of turn." (range form)', () => {
    const parsed = parseOracleText('One or two target creatures each get +1/+1 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(2);
    expect(parsed.targets[0].minCount).toBe(1);

    expect(parsed.effects).toHaveLength(1);
    expect(parsed.effects[0].kind).toBe('ModifyPT');
  });

  it('parses "Two target creatures each get +2/+2 and gain vigilance until end of turn." (When We Were Young)', () => {
    const parsed = parseOracleText('Two target creatures each get +2/+2 and gain vigilance until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects.some(e => e.kind === 'ModifyPT')).toBe(true);
    expect(parsed.effects.some(e => e.kind === 'GrantKeyword'
      && (e as Extract<Effect, { kind: 'GrantKeyword' }>).keyword === 'Vigilance')).toBe(true);
  });

  it('parses "Support 2" (Expedition Raptor keyword form)', () => {
    const parsed = parseOracleText('Support 2.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].count).toBe(2);
    expect(parsed.targets[0].minCount).toBe(0); // up to 2
    expect(parsed.targets[0].constraints?.notSource).toBe(true); // other target creatures

    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(eff.kind).toBe('AddCounters');
    expect(eff.counterType).toBe('+1/+1');
    expect(eff.count).toBe(1);
  });

  it('parses "Support 3" (three-target form)', () => {
    const parsed = parseOracleText('Support 3.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets[0].count).toBe(3);
    expect(parsed.effects[0].kind).toBe('AddCounters');
  });
});

// ---------------------------------------------------------------------------
// EXECUTOR: ModifyPT applies to each chosen creature in a multi-target spec
// ---------------------------------------------------------------------------

describe('slice4-multi-target-pump-grant: executor', () => {
  it('ModifyPT with count=2 applies +1/+1 to BOTH chosen creatures', () => {
    const parsed = parseOracleText('Up to two target creatures each get +1/+1 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const result = executeEffects(makeState(), parsed.effects, 'player-1', ['c1', 'c2'], parsed.targets);

    // Both targeted creatures receive the pump
    expect(ptMod(result, 'c1').power).toBe(1);
    expect(ptMod(result, 'c1').toughness).toBe(1);
    expect(ptMod(result, 'c2').power).toBe(1);
    expect(ptMod(result, 'c2').toughness).toBe(1);
    // Unchosen creatures are untouched
    expect(ptMod(result, 'c3').power).toBe(0);
    expect(ptMod(result, 'e1').power).toBe(0);
  });

  it('ModifyPT with "one or two" form applies to only one chosen creature when given one', () => {
    const parsed = parseOracleText('One or two target creatures each get +2/+0 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // Choose only one target
    const result = executeEffects(makeState(), parsed.effects, 'player-1', ['e1'], parsed.targets);

    expect(ptMod(result, 'e1').power).toBe(2);
    expect(ptMod(result, 'e1').toughness).toBe(0);
    // Others untouched
    expect(ptMod(result, 'c1').power).toBe(0);
    expect(ptMod(result, 'c2').power).toBe(0);
  });

  it('Multi-target pump + keyword grant applies both effects to all chosen creatures', () => {
    const parsed = parseOracleText('Two target creatures each get +1/+1 and gain trample until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const result = executeEffects(makeState(), parsed.effects, 'player-1', ['c1', 'e1'], parsed.targets);

    // Both targets get +1/+1
    expect(ptMod(result, 'c1').power).toBe(1);
    expect(ptMod(result, 'c1').toughness).toBe(1);
    expect(ptMod(result, 'e1').power).toBe(1);
    expect(ptMod(result, 'e1').toughness).toBe(1);

    // Both targets gain Trample keyword
    const c1 = result.cards.get('c1');
    const e1 = result.cards.get('e1');
    expect(c1?.grantedKeywords?.includes('Trample')).toBe(true);
    expect(e1?.grantedKeywords?.includes('Trample')).toBe(true);

    // Unchosen creatures unchanged
    expect(ptMod(result, 'c2').power).toBe(0);
    const c2 = result.cards.get('c2');
    expect(!c2?.grantedKeywords?.includes('Trample')).toBe(true);
  });

  it('Support 2: AddCounters with count=2 spec puts +1/+1 on each of two chosen creatures', () => {
    const parsed = parseOracleText('Support 2.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const result = executeEffects(makeState(), parsed.effects, 'player-1', ['c1', 'c2'], parsed.targets);

    // Both chosen creatures get one +1/+1 counter
    expect(counters(result, 'c1')['+1/+1']).toBe(1);
    expect(counters(result, 'c2')['+1/+1']).toBe(1);
    // Unchosen unchanged
    expect(counters(result, 'c3')['+1/+1'] ?? 0).toBe(0);
    expect(counters(result, 'e1')['+1/+1'] ?? 0).toBe(0);
  });

  it('Support 2: choosing zero targets is legal (minCount=0)', () => {
    const parsed = parseOracleText('Support 2.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // Empty target array = chose 0 out of "up to 2"
    const result = executeEffects(makeState(), parsed.effects, 'player-1', [], parsed.targets);

    // No counters on any creature
    expect(counters(result, 'c1')['+1/+1'] ?? 0).toBe(0);
    expect(counters(result, 'c2')['+1/+1'] ?? 0).toBe(0);
  });
});
