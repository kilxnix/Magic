import { describe, it, expect } from 'vitest';
import { executeEffects } from '../effects/executor';
import { parseOracleText } from '../effects/parser';
import type { Effect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

/**
 * Capability: mill-each
 * Mill executor now honors EachPlayer / EachOpponent player refs (looping every
 * relevant non-lost player), and the parser recognizes "each player mills N" and
 * "each opponent mills N". "target player mills N" continues to work.
 */

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  cardDefinitions.set('def-generic', {
    id: 'def-generic',
    name: 'Generic Card',
    type_line: 'Instant',
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['instant'],
  });

  // 3 players, each with 5-card library.
  const playerIds = ['player-1', 'player-2', 'player-3'];
  for (const pid of playerIds) {
    for (let i = 1; i <= 5; i++) {
      const id = `${pid}-lib-${i}`;
      cards.set(id, {
        instanceId: id,
        definitionId: 'def-generic',
        ownerId: pid,
        zone: 'library',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
    }
  }

  const players = playerIds.map((id, idx) => ({
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
    hasPriorityPassed: [false, false, false],
    stack: [],
    combat: null,
  } as GameState;
}

function graveCount(state: GameState, ownerId: string): number {
  let n = 0;
  for (const c of state.cards.values()) {
    if (c.ownerId === ownerId && c.zone === 'graveyard') n++;
  }
  return n;
}

function libCount(state: GameState, ownerId: string): number {
  let n = 0;
  for (const c of state.cards.values()) {
    if (c.ownerId === ownerId && c.zone === 'library') n++;
  }
  return n;
}

describe('cap-mill-each', () => {
  it('EachPlayer mills every non-lost player (including the caster)', () => {
    const state = makeState();
    const effects: Effect[] = [
      { kind: 'Mill', player: { kind: 'EachPlayer' }, count: 2 },
    ];
    const result = executeEffects(state, effects, 'player-1', [], []);

    expect(graveCount(result, 'player-1')).toBe(2);
    expect(graveCount(result, 'player-2')).toBe(2);
    expect(graveCount(result, 'player-3')).toBe(2);
    expect(libCount(result, 'player-1')).toBe(3);
    expect(libCount(result, 'player-2')).toBe(3);
    expect(libCount(result, 'player-3')).toBe(3);
  });

  it('EachOpponent mills every opponent but NOT the caster', () => {
    const state = makeState();
    const effects: Effect[] = [
      { kind: 'Mill', player: { kind: 'EachOpponent' }, count: 3 },
    ];
    const result = executeEffects(state, effects, 'player-1', [], []);

    // caster untouched
    expect(graveCount(result, 'player-1')).toBe(0);
    expect(libCount(result, 'player-1')).toBe(5);
    // opponents milled
    expect(graveCount(result, 'player-2')).toBe(3);
    expect(graveCount(result, 'player-3')).toBe(3);
  });

  it('EachPlayer mill skips players who have already lost', () => {
    const state = makeState();
    state.players[2].hasLost = true; // player-3 out of the game
    const effects: Effect[] = [
      { kind: 'Mill', player: { kind: 'EachPlayer' }, count: 1 },
    ];
    const result = executeEffects(state, effects, 'player-1', [], []);

    expect(graveCount(result, 'player-1')).toBe(1);
    expect(graveCount(result, 'player-2')).toBe(1);
    expect(graveCount(result, 'player-3')).toBe(0); // lost -> skipped
    expect(libCount(result, 'player-3')).toBe(5);
  });

  it('parser: "each player mills three cards" -> EachPlayer Mill, executes for all', () => {
    const parsed = parseOracleText('Each player mills three cards.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Mill');
    if (eff.kind !== 'Mill') return;
    expect(eff.player).toEqual({ kind: 'EachPlayer' });
    expect(eff.count).toBe(3);

    const result = executeEffects(makeState(), parsed.effects, 'player-1', [], []);
    expect(graveCount(result, 'player-1')).toBe(3);
    expect(graveCount(result, 'player-2')).toBe(3);
    expect(graveCount(result, 'player-3')).toBe(3);
  });

  it('parser: "each opponent mills 2 cards" -> EachOpponent Mill, spares caster', () => {
    const parsed = parseOracleText('Each opponent mills 2 cards.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Mill');
    if (eff.kind !== 'Mill') return;
    expect(eff.player).toEqual({ kind: 'EachOpponent' });
    expect(eff.count).toBe(2);

    const result = executeEffects(makeState(), parsed.effects, 'player-1', [], []);
    expect(graveCount(result, 'player-1')).toBe(0);
    expect(graveCount(result, 'player-2')).toBe(2);
    expect(graveCount(result, 'player-3')).toBe(2);
  });

  it('parser: "target player mills 4 cards" still works (Chosen target)', () => {
    const parsed = parseOracleText('Target player mills 4 cards.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Mill');
    if (eff.kind !== 'Mill') return;
    expect(eff.count).toBe(4);
    expect(parsed.targets.length).toBe(1);

    // resolve the chosen target to player-2 (parallel arrays: ids + specs)
    const spec = parsed.targets[0];
    const result = executeEffects(
      makeState(),
      parsed.effects,
      'player-1',
      ['player-2'],
      [{ id: spec.id }],
    );
    expect(graveCount(result, 'player-2')).toBe(4);
    expect(graveCount(result, 'player-1')).toBe(0);
  });
});
