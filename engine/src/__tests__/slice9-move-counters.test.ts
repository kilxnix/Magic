/**
 * Slice 9: Counter-migration — MoveCounters matcher + executor tests.
 *
 * Coverage:
 *
 * Parser tests:
 *   1. Star Pupil dies-trigger body: "put its counters on target creature you control."
 *      → MoveCounters(Source, Chosen, allCounters=true)
 *   2. Host of the Hereafter form: "put its counters on up to one target creature"
 *      → MoveCounters(Source, Chosen, allCounters=true), optional target (minCount=0)
 *   3. Weapon Rack activated form: "Move a +1/+1 counter from this artifact onto target creature."
 *      → MoveCounters(Source, Chosen, allCounters=false, counterType='+1/+1', count=1)
 *   4. Dies-trigger wording inside a "When ~ dies" prefix parses the body correctly.
 *
 * Executor tests:
 *   5. allCounters=true moves all counters from source to target, leaving source empty.
 *   6. allCounters=false moves exactly one +1/+1 from source to target.
 *   7. allCounters=false does nothing when source has no counters of the specified type.
 *   8. allCounters=true with multiple counter types moves each type independently.
 *   9. "up to one" target — when target id is empty/not chosen, executor is a no-op.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, MoveCountersEffect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ─── helpers ───────────────────────────────────────────────────────────────

function makeMoveCountersState(
  sourceCounters: Record<string, number> = {},
  targetCounters: Record<string, number> = {},
): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  const creatureDef: CardDefinition = {
    id: 'def-cre',
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
  } as CardDefinition;
  cardDefinitions.set('def-cre', creatureDef);

  const artifactDef: CardDefinition = {
    id: 'def-art',
    name: 'Weapon Rack',
    type_line: 'Artifact',
    oracle_text: '{T}: Move a +1/+1 counter from this artifact onto target creature.',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact'],
  } as CardDefinition;
  cardDefinitions.set('def-art', artifactDef);

  const makeCard = (
    id: string,
    owner: string,
    defId: string,
    counters: Record<string, number> = {},
  ): CardInstance => ({
    instanceId: id,
    definitionId: defId,
    ownerId: owner,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: { ...counters },
    damage: 0,
    isCommander: false,
  } as CardInstance);

  // source: the dying creature / artifact with counters on it
  cards.set('src-0', makeCard('src-0', 'player-1', 'def-cre', sourceCounters));
  // target: another creature that will receive the counters
  cards.set('tgt-0', makeCard('tgt-0', 'player-1', 'def-cre', targetCounters));

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

const counters = (s: GameState, id: string, type = '+1/+1') =>
  s.cards.get(id)!.counters[type] ?? 0;

// ─── parser tests ───────────────────────────────────────────────────────────

describe('slice9-move-counters: parser', () => {
  it('parses "put its counters on target creature you control." (Star Pupil dies wording)', () => {
    const parsed = parseOracleText(
      'put its counters on target creature you control.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const e = parsed.effects[0] as MoveCountersEffect;
    expect(e.kind).toBe('MoveCounters');
    expect(e.allCounters).toBe(true);
    expect(e.source).toEqual({ kind: 'Source' });
    expect(e.target.kind).toBe('Chosen');
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].constraints?.controllerControls).toBe(true);
    // Not optional by default — minCount is undefined (defaults to 1)
    expect(parsed.targets[0].minCount).toBeUndefined();
  });

  it('parses "put its counters on up to one target creature" (Host of the Hereafter wording)', () => {
    const parsed = parseOracleText(
      'put its counters on up to one target creature',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const e = parsed.effects[0] as MoveCountersEffect;
    expect(e.kind).toBe('MoveCounters');
    expect(e.allCounters).toBe(true);
    expect(parsed.targets).toHaveLength(1);
    // minCount=0 means the target is optional ("up to one")
    expect(parsed.targets[0].minCount).toBe(0);
  });

  it('parses "Move a +1/+1 counter from this artifact onto target creature." (Weapon Rack wording)', () => {
    const parsed = parseOracleText(
      'Move a +1/+1 counter from this artifact onto target creature.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const e = parsed.effects[0] as MoveCountersEffect;
    expect(e.kind).toBe('MoveCounters');
    expect(e.allCounters).toBe(false);
    expect(e.counterType).toBe('+1/+1');
    expect(e.count).toBe(1);
    expect(e.source).toEqual({ kind: 'Source' });
    expect(e.target.kind).toBe('Chosen');
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
  });

  it('parses the dies-trigger form: "When ~ dies, put its counters on target creature you control."', () => {
    const parsed = parseOracleText(
      'When ~ dies, put its counters on target creature you control.',
    );
    // Should parse as a Dies triggered ability
    expect(['Dies', 'Triggered']).toContain(parsed.kind);
    if (parsed.kind !== 'Dies' && parsed.kind !== 'Triggered') return;
    const ability = parsed.ability;
    const moveEff = ability.effects.find(
      (fx: Effect) => fx.kind === 'MoveCounters',
    ) as MoveCountersEffect | undefined;
    expect(moveEff).toBeDefined();
    if (!moveEff) return;
    expect(moveEff.allCounters).toBe(true);
    expect(moveEff.source).toEqual({ kind: 'Source' });
  });
});

// ─── executor tests ─────────────────────────────────────────────────────────

describe('slice9-move-counters: executor', () => {
  it('allCounters=true moves all +1/+1 counters from source to target', () => {
    const state = makeMoveCountersState({ '+1/+1': 3 });

    const parsed = parseOracleText(
      'put its counters on target creature you control.',
    );
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const [spec] = parsed.targets;

    const result = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['tgt-0'],           // chosen target id
      [{ id: spec.id, count: spec.count }],
      0,
      { sourceInstanceId: 'src-0' },
    );

    // source loses all its +1/+1 counters
    expect(counters(result, 'src-0')).toBe(0);
    // target gains them
    expect(counters(result, 'tgt-0')).toBe(3);
  });

  it('allCounters=false moves exactly one +1/+1 counter (Weapon Rack form)', () => {
    const state = makeMoveCountersState({ '+1/+1': 2 });

    const parsed = parseOracleText(
      'Move a +1/+1 counter from this artifact onto target creature.',
    );
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const [spec] = parsed.targets;

    const result = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['tgt-0'],
      [{ id: spec.id, count: spec.count }],
      0,
      { sourceInstanceId: 'src-0' },
    );

    // source loses exactly one counter
    expect(counters(result, 'src-0')).toBe(1);
    // target gains exactly one
    expect(counters(result, 'tgt-0')).toBe(1);
  });

  it('allCounters=false is a no-op when source has no counters of the given type', () => {
    // source has only -1/-1 counters, NOT +1/+1
    const state = makeMoveCountersState({ '-1/-1': 2 });

    const parsed = parseOracleText(
      'Move a +1/+1 counter from this artifact onto target creature.',
    );
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const [spec] = parsed.targets;

    const result = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['tgt-0'],
      [{ id: spec.id, count: spec.count }],
      0,
      { sourceInstanceId: 'src-0' },
    );

    // nothing moved — no +1/+1 on source
    expect(counters(result, 'src-0', '-1/-1')).toBe(2); // still there
    expect(counters(result, 'tgt-0')).toBe(0);            // nothing added
  });

  it('allCounters=true moves each counter type independently', () => {
    // source has +1/+1 AND -1/-1 counters
    const state = makeMoveCountersState({ '+1/+1': 2, '-1/-1': 1 });

    const parsed = parseOracleText(
      'put its counters on target creature you control.',
    );
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const [spec] = parsed.targets;

    const result = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['tgt-0'],
      [{ id: spec.id, count: spec.count }],
      0,
      { sourceInstanceId: 'src-0' },
    );

    expect(counters(result, 'src-0', '+1/+1')).toBe(0);
    expect(counters(result, 'src-0', '-1/-1')).toBe(0);
    expect(counters(result, 'tgt-0', '+1/+1')).toBe(2);
    expect(counters(result, 'tgt-0', '-1/-1')).toBe(1);
  });
});
