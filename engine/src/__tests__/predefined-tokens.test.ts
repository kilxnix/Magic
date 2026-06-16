import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { tapLandForMana, getAvailableManaColors, getActivatedAbilities } from '../actions';

function baseState(): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map<string, CardInstance>(),
    cardDefinitions: new Map<string, CardDefinition>(),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function makeTreasure(state: GameState): { state: GameState; id: string } {
  const parsed = parseOracleText('Create a Treasure token.');
  if (parsed.kind !== 'Spell') throw new Error('expected spell');
  const next = executeEffects(state, parsed.effects, 'p0', [], []);
  const id = [...next.cards.values()].find(c => c.isToken)!.instanceId;
  return { state: next, id };
}

describe('Predefined artifact tokens are functional', () => {
  it('a Treasure token can be tapped+sacrificed for one mana of any color', () => {
    const { state, id } = makeTreasure(baseState());
    const token = state.cards.get(id)!;
    expect(token.zone).toBe('battlefield');
    // Treasure produces any color
    const colors = getAvailableManaColors(state, id);
    expect(colors).toEqual(expect.arrayContaining(['W', 'U', 'B', 'R', 'G']));
    // Tap for green
    const after = tapLandForMana(state, 'p0', id, 'G');
    expect(after.players[0].manaPool.G).toBe(1);
    // Treasure is sacrificed (tokens cease to exist off the battlefield)
    const stillThere = after.cards.get(id);
    expect(!stillThere || stillThere.zone !== 'battlefield').toBe(true);
  });

  it('a Clue token offers a "{2}, Sacrifice: Draw a card" activated ability', () => {
    const parsed = parseOracleText('Create a Clue token.');
    if (parsed.kind !== 'Spell') throw new Error('expected spell');
    const state = executeEffects(baseState(), parsed.effects, 'p0', [], []);
    const id = [...state.cards.values()].find(c => c.isToken)!.instanceId;
    const abilities = getActivatedAbilities(state, id);
    expect(abilities.length).toBeGreaterThan(0);
    expect(abilities[0].effects.some(e => e.kind === 'Draw')).toBe(true);
    expect(abilities[0].cost.sacrifice).toBeTruthy();
  });

  it('"Investigate" creates a functional Clue token', () => {
    const parsed = parseOracleText('Investigate.');
    if (parsed.kind !== 'Spell') throw new Error('expected spell');
    const state = executeEffects(baseState(), parsed.effects, 'p0', [], []);
    const token = [...state.cards.values()].find(c => c.isToken);
    expect(token).toBeTruthy();
    const def = state.cardDefinitions.get(token!.definitionId)!;
    expect(def.type_line).toMatch(/Clue/);
    expect(getActivatedAbilities(state, token!.instanceId).some(a => a.effects.some(e => e.kind === 'Draw'))).toBe(true);
  });

  it('a Food token offers a lifegain activated ability', () => {
    const parsed = parseOracleText('Create a Food token.');
    if (parsed.kind !== 'Spell') throw new Error('expected spell');
    const state = executeEffects(baseState(), parsed.effects, 'p0', [], []);
    const id = [...state.cards.values()].find(c => c.isToken)!.instanceId;
    const abilities = getActivatedAbilities(state, id);
    expect(abilities.some(a => a.effects.some(e => e.kind === 'GainLife'))).toBe(true);
  });
});
