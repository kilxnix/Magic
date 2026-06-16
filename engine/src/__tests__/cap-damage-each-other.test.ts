import { describe, it, expect } from 'vitest';
import { executeEffects } from '../effects/executor';
import { parseOracleText } from '../effects/parser';
import type { Effect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

/**
 * Capability: damage-each-other
 * DealDamage now supports the AllOtherCreatures target kind — every creature on
 * the battlefield EXCEPT the source permanent itself (Chaos Maw / Pyrohemia
 * style). The parser recognizes "~ deals N damage to each other creature".
 * Crucially, the source creature is never damaged.
 */

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  // A 5/5 source ("Chaos Maw").
  cardDefinitions.set('def-maw', {
    id: 'def-maw',
    name: 'Chaos Maw',
    type_line: 'Creature — Beast',
    oracle_text: '',
    mana_cost: '{5}{R}',
    cmc: 6,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    card_types: ['creature'],
    power: 5,
    toughness: 5,
  });

  // Generic 2/2 creatures.
  cardDefinitions.set('def-bear', {
    id: 'def-bear',
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
  });

  // A non-creature permanent (artifact) that must NOT be damaged.
  cardDefinitions.set('def-rock', {
    id: 'def-rock',
    name: 'Mana Rock',
    type_line: 'Artifact',
    oracle_text: '',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact'],
  });

  const mk = (
    instanceId: string,
    definitionId: string,
    ownerId: string,
  ): CardInstance => ({
    instanceId,
    definitionId,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  // The source belongs to player-1.
  cards.set('maw', mk('maw', 'def-maw', 'player-1'));
  // Other creatures across both players.
  cards.set('bear-1', mk('bear-1', 'def-bear', 'player-1')); // controller's own creature
  cards.set('bear-2', mk('bear-2', 'def-bear', 'player-2'));
  cards.set('bear-3', mk('bear-3', 'def-bear', 'player-2'));
  // A non-creature permanent — should be untouched.
  cards.set('rock', mk('rock', 'def-rock', 'player-2'));

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

function dmg(state: GameState, id: string): number {
  return state.cards.get(id)?.damage ?? -1;
}

describe('cap-damage-each-other', () => {
  it('AllOtherCreatures damages every creature except the source', () => {
    const state = makeState();
    const effects: Effect[] = [
      {
        kind: 'DealDamage',
        source: { kind: 'ThisPermanent' },
        target: { kind: 'AllOtherCreatures' },
        amount: 3,
      },
    ];
    const result = executeEffects(state, effects, 'player-1', [], [], 0, {
      sourceInstanceId: 'maw',
    });

    // Source is NEVER damaged.
    expect(dmg(result, 'maw')).toBe(0);
    // All OTHER creatures take 3 — including the controller's own creature.
    expect(dmg(result, 'bear-1')).toBe(3);
    expect(dmg(result, 'bear-2')).toBe(3);
    expect(dmg(result, 'bear-3')).toBe(3);
    // Non-creature permanent untouched.
    expect(dmg(result, 'rock')).toBe(0);
    // Players' life totals are untouched (this is a creature-only effect).
    expect(result.players[0].life).toBe(40);
    expect(result.players[1].life).toBe(40);
  });

  it('parser: "~ deals 3 damage to each other creature" -> AllOtherCreatures, executes correctly', () => {
    const parsed = parseOracleText('~ deals 3 damage to each other creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'AllOtherCreatures' });
    expect(eff.amount).toBe(3);

    const result = executeEffects(makeState(), parsed.effects, 'player-1', [], [], 0, {
      sourceInstanceId: 'maw',
    });
    expect(dmg(result, 'maw')).toBe(0); // source spared
    expect(dmg(result, 'bear-1')).toBe(3);
    expect(dmg(result, 'bear-2')).toBe(3);
    expect(dmg(result, 'bear-3')).toBe(3);
    expect(dmg(result, 'rock')).toBe(0);
  });

  it('parser: "it deals 1 damage to each other creature" (Pyrohemia) -> AllOtherCreatures', () => {
    const parsed = parseOracleText('It deals 1 damage to each other creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'AllOtherCreatures' });
    expect(eff.amount).toBe(1);
  });

  it('plain "each creature" still maps to AllCreatures (regression)', () => {
    const parsed = parseOracleText('~ deals 2 damage to each creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'AllCreatures' });
  });
});
