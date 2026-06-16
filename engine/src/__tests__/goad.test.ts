import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { isGoaded, mustAttackIfAble, declareAttackers, getRequiredAttackers } from '../combat';
import { performUntapStep } from '../turn-manager';

function creatureDef(id: string, name = id): CardDefinition {
  return {
    id, name, type_line: 'Creature — Test', oracle_text: '',
    mana_cost: '{2}', cmc: 2, colors: [], color_identity: [],
    keywords: [], card_types: ['creature'], power: 3, toughness: 3,
  };
}

function makeCard(instanceId: string, definitionId: string, ownerId: string, over: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false, ...over,
  };
}

// 4-player pod: p0 active, p1/p2/p3 opponents.
function podState(): GameState {
  const defs = new Map<string, CardDefinition>([['cdef', creatureDef('cdef', 'Goblin')]]);
  const cards = new Map<string, CardInstance>([
    ['atk', makeCard('atk', 'cdef', 'p1', { summoningSick: false })], // p1's creature (the one we goad)
  ]);
  return {
    players: [
      createPlayer('p0', 'P0'), createPlayer('p1', 'P1'),
      createPlayer('p2', 'P2'), createPlayer('p3', 'P3'),
    ],
    cards,
    cardDefinitions: defs,
    activePlayerIndex: 1, // p1's turn — p1 must attack with the goaded creature
    priorityPlayerIndex: 1,
    phase: 'combat',
    step: 'declare_attackers',
    turnNumber: 5,
    hasPriorityPassed: [false, false, false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    playersWhoAttackedThisTurn: [],
  };
}

describe('Goad parser', () => {
  it('parses "Goad target creature." as a Goad spell with a creature target', () => {
    const parsed = parseOracleText('Goad target creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects.some(e => e.kind === 'Goad')).toBe(true);
    expect(parsed.targets.length).toBe(1);
  });

  it("parses \"Goad all creatures you don't control.\" with no targets (AllCreatures)", () => {
    const parsed = parseOracleText("Goad all creatures you don't control.");
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const goad = parsed.effects.find(e => e.kind === 'Goad');
    expect(goad).toBeTruthy();
    expect(parsed.targets.length).toBe(0);
  });
});

describe('Goad execution + combat enforcement', () => {
  it('goading sets goadedBy and forces the creature to attack', () => {
    const parsed = parseOracleText('Goad target creature.');
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    let state = podState();
    // p0 casts the goad targeting p1's creature 'atk'
    state = executeEffects(state, parsed.effects, 'p0', ['atk'], parsed.targets);
    expect(isGoaded(state, 'atk')).toBe(true);
    expect(mustAttackIfAble(state, 'atk')).toBe(true);
    expect(getRequiredAttackers(state, 'p1')).toContain('atk');
  });

  it('a goaded creature may not attack its goader when another opponent exists', () => {
    let state = podState();
    state = executeEffects(state, [{ kind: 'Goad', target: { kind: 'AllCreatures' } } as never], 'p0', [], []);
    expect(isGoaded(state, 'atk')).toBe(true);
    // p1 tries to send the goaded creature back at p0 (the goader) — illegal, p2/p3 available
    expect(() => declareAttackers(state, 'p1', [{ cardInstanceId: 'atk', defendingPlayerId: 'p0' }])).toThrow(/goad/i);
    // attacking a non-goader (p2) is allowed
    expect(() => declareAttackers(state, 'p1', [{ cardInstanceId: 'atk', defendingPlayerId: 'p2' }])).not.toThrow();
  });

  it("goad wears off at the goader's next turn (untap step)", () => {
    let state = podState();
    state = executeEffects(state, [{ kind: 'Goad', target: { kind: 'AllCreatures' } } as never], 'p0', [], []);
    expect(isGoaded(state, 'atk')).toBe(true);
    // p0's turn begins → p0's goads end
    state = { ...state, activePlayerIndex: 0 };
    state = performUntapStep(state);
    expect(isGoaded(state, 'atk')).toBe(false);
  });
});
