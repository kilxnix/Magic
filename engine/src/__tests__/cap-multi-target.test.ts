import { describe, it, expect } from 'vitest';
import { executeEffects } from '../effects/executor';
import { parseOracleText } from '../effects/parser';
import type { Effect } from '../effects/ast';
import type { TargetSpec } from '../effects/targets';
import type { GameState, CardInstance, CardDefinition } from '../types';

/**
 * Capability: multi-target
 *
 * Tap / Destroy / Exile now honour TargetSpec.count > 1. A single spec that
 * requires N target choices is fed N ids in chosenTargetIds; the executor maps
 * spec.id -> ALL N ids (chosenTargetsMulti) and applies the effect to EVERY
 * chosen target, not just the first.
 *
 * Parser recognises:
 *   "tap up to N target creatures"
 *   "destroy up to N target creatures"
 *   "exile up to N target creatures"
 * each producing a SINGLE TargetSpec { type: 'Creature', count: N }.
 *
 * "Honest": the executor taps/destroys/exiles each chosen creature and only
 * those chosen — never the wrong permanent, never a no-op on the 2nd+ target.
 */

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

  // player-1 controls c1, c2, c3 ; player-2 controls e1, e2 (must stay untouched
  // unless explicitly chosen).
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

const zone = (s: GameState, id: string) => s.cards.get(id)?.zone;
const tapped = (s: GameState, id: string) => s.cards.get(id)?.tapped;

// A multi-target creature spec with the given count.
function multiSpec(count: number): TargetSpec {
  return { id: 'multi', type: 'Creature', count };
}

describe('cap-multi-target', () => {
  // ----- EXECUTOR: applies to ALL chosen targets -----

  it('Tap with count=3 taps every chosen creature and nothing else', () => {
    const effects: Effect[] = [{ kind: 'Tap', target: { kind: 'Chosen', targetId: 'multi' } }];
    const r = executeEffects(makeState(), effects, 'player-1', ['e1', 'e2', 'c1'], [multiSpec(3)]);

    expect(tapped(r, 'e1')).toBe(true);
    expect(tapped(r, 'e2')).toBe(true);
    expect(tapped(r, 'c1')).toBe(true);
    // Unchosen creatures untouched.
    expect(tapped(r, 'c2')).toBe(false);
    expect(tapped(r, 'c3')).toBe(false);
  });

  it('Destroy with count=2 sends BOTH chosen creatures to the graveyard', () => {
    const effects: Effect[] = [{ kind: 'Destroy', target: { kind: 'Chosen', targetId: 'multi' } }];
    const r = executeEffects(makeState(), effects, 'player-1', ['e1', 'e2'], [multiSpec(2)]);

    expect(zone(r, 'e1')).toBe('graveyard');
    expect(zone(r, 'e2')).toBe('graveyard');
    // Others remain on the battlefield.
    expect(zone(r, 'c1')).toBe('battlefield');
    expect(zone(r, 'c2')).toBe('battlefield');
    expect(zone(r, 'c3')).toBe('battlefield');
  });

  it('Exile with count=3 exiles all three chosen creatures', () => {
    const effects: Effect[] = [{ kind: 'Exile', target: { kind: 'Chosen', targetId: 'multi' } }];
    const r = executeEffects(makeState(), effects, 'player-1', ['c1', 'c2', 'e1'], [multiSpec(3)]);

    expect(zone(r, 'c1')).toBe('exile');
    expect(zone(r, 'c2')).toBe('exile');
    expect(zone(r, 'e1')).toBe('exile');
    expect(zone(r, 'c3')).toBe('battlefield');
    expect(zone(r, 'e2')).toBe('battlefield');
  });

  it('count=N but fewer chosen ids applies only to the ids actually chosen ("up to")', () => {
    // "up to 3" but only one target was picked.
    const effects: Effect[] = [{ kind: 'Destroy', target: { kind: 'Chosen', targetId: 'multi' } }];
    const r = executeEffects(makeState(), effects, 'player-1', ['c2'], [multiSpec(3)]);

    expect(zone(r, 'c2')).toBe('graveyard');
    expect(zone(r, 'c1')).toBe('battlefield');
    expect(zone(r, 'c3')).toBe('battlefield');
    expect(zone(r, 'e1')).toBe('battlefield');
  });

  it('single-target spec (count=1) still affects exactly one creature (regression)', () => {
    const effects: Effect[] = [{ kind: 'Tap', target: { kind: 'Chosen', targetId: 't' } }];
    const r = executeEffects(makeState(), effects, 'player-1', ['c1'], [{ id: 't', type: 'Creature', count: 1 }]);

    expect(tapped(r, 'c1')).toBe(true);
    expect(tapped(r, 'c2')).toBe(false);
    expect(tapped(r, 'e1')).toBe(false);
  });

  // ----- PARSER: produces a single spec with count=N -----

  it('parser: "tap up to two target creatures" -> Tap Chosen, spec count 2, executes on both', () => {
    const parsed = parseOracleText('Tap up to two target creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].count).toBe(2);
    expect(parsed.effects).toHaveLength(1);
    expect(parsed.effects[0].kind).toBe('Tap');

    const specId = parsed.targets[0].id;
    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['e1', 'c1'], parsed.targets);
    expect(tapped(r, 'e1')).toBe(true);
    expect(tapped(r, 'c1')).toBe(true);
    expect(tapped(r, 'c2')).toBe(false);
    // sanity: the effect actually referenced the parsed spec id
    expect((parsed.effects[0] as { target: { targetId: string } }).target.targetId).toBe(specId);
  });

  it('parser: "destroy up to three target creatures" -> Destroy Chosen, spec count 3, destroys all chosen', () => {
    const parsed = parseOracleText('Destroy up to three target creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(3);
    expect(parsed.effects[0].kind).toBe('Destroy');

    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['c1', 'e1', 'e2'], parsed.targets);
    expect(zone(r, 'c1')).toBe('graveyard');
    expect(zone(r, 'e1')).toBe('graveyard');
    expect(zone(r, 'e2')).toBe('graveyard');
    expect(zone(r, 'c2')).toBe('battlefield');
  });

  it('parser: "exile up to two target creatures" -> Exile Chosen, spec count 2, exiles both', () => {
    const parsed = parseOracleText('Exile up to two target creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(2);
    expect(parsed.effects[0].kind).toBe('Exile');

    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['c1', 'c2'], parsed.targets);
    expect(zone(r, 'c1')).toBe('exile');
    expect(zone(r, 'c2')).toBe('exile');
    expect(zone(r, 'c3')).toBe('battlefield');
  });

  it('parser: singular "up to one target creature" still parses as a single (count 1) target (regression)', () => {
    const parsed = parseOracleText('Destroy up to one target creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(1);
    expect(parsed.effects[0].kind).toBe('Destroy');
  });

  it('parser: plain "destroy target creature" unchanged (count 1)', () => {
    const parsed = parseOracleText('Destroy target creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(1);
  });
});
