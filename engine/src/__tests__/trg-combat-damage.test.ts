/**
 * trg-combat-damage: executing tests for combat-damage trigger CONDITIONS.
 *
 * Verifies that the new trigger wordings parse to a CombatDamageToPlayer trigger
 * AND that the engine (combat.ts -> checkTriggersForEvent) actually fires the
 * registered ability when the source deals combat damage to a player.
 *
 * Covered new conditions (modern 2023+ "one or more players" templating):
 *   - "Whenever ~ deals combat damage to one or more players, ..."           (who: self)
 *   - "Whenever a creature you control deals combat damage to one or more
 *      players, ..."                                                          (who: creatureYouControl)
 *
 * SKIPPED (no engine event emitted): "...deals combat damage to a creature".
 * combat.ts only pushes CombatDamageToPlayer events (player-directed damage);
 * blocker/blocked-creature combat damage is applied to card.damage but never
 * emitted as an event, so a "to a creature" trigger would be a dead no-op.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState, getCardsInZone } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  registerBattlefieldAbilities,
} from '../stack';
import { declareAttackers, resolveCombatDamage } from '../combat';
import type { CardDefinition, GameState, CardInstance } from '../types';

function makeCreature(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature - Test',
    oracle_text: oracleText,
    mana_cost: '{2}{R}',
    cmc: 3,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    power: 3,
    toughness: 2,
    card_types: ['creature'],
  };
}

function makeLand(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Basic Land - Island',
    oracle_text: '{T}: Add {U}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['U'],
    keywords: [],
    card_types: ['land'],
  };
}

function createTestGame(p1Cards: CardDefinition[], p2Cards: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-cmd-1' },
    { playerId: 'p2', name: 'Player 2', cards: p2Cards, commanderId: 'nonexistent-cmd-2' },
  ]);
}

function moveToZone(state: GameState, instanceId: string, zone: 'hand' | 'battlefield' | 'library' | 'graveyard'): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone, summoningSick: false });
  return { ...state, cards: newCards };
}

function findCard(state: GameState, defId: string): CardInstance | undefined {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  return undefined;
}

function countCardsInZone(state: GameState, playerId: string, zone: string): number {
  return getCardsInZone(state, playerId, zone as any).length;
}

describe('trg-combat-damage parsing', () => {
  it('parses "Whenever ~ deals combat damage to a player, ..." (self)', () => {
    const result = parseOracleText('Whenever ~ deals combat damage to a player, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CombatDamageToPlayer', who: 'self' });
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('parses "Whenever ~ deals combat damage to one or more players, ..." (self)', () => {
    const result = parseOracleText('Whenever ~ deals combat damage to one or more players, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CombatDamageToPlayer', who: 'self' });
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('parses "Whenever a creature you control deals combat damage to one or more players, ..."', () => {
    const result = parseOracleText('Whenever a creature you control deals combat damage to one or more players, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CombatDamageToPlayer', who: 'creatureYouControl' });
    expect(result.ability.effects[0].kind).toBe('Draw');
  });
});

describe('trg-combat-damage execution', () => {
  it('fires self "to one or more players" trigger from combat damage and draws a card', () => {
    const attacker = makeCreature(
      'cd-self-payoff',
      'Combat Damage Self',
      'Whenever ~ deals combat damage to one or more players, draw a card.',
    );
    const island = makeLand('island-a', 'Island');

    let state = createTestGame([attacker, island, island], [island]);
    const attackerInst = findCard(state, 'cd-self-payoff')!;
    state = moveToZone(state, attackerInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, attackerInst.instanceId);
    state = { ...state, activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'combat' as any, step: 'declare_attackers' as any };

    const handBefore = countCardsInZone(state, 'p1', 'hand');
    const lifeBefore = state.players[1].life;

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    // Defender took 3 combat damage.
    expect(state.players[1].life).toBe(lifeBefore - 3);

    // The combat-damage trigger should be pending.
    expect(state.pendingTriggers.map(t => t.ability.trigger.kind)).toEqual(['CombatDamageToPlayer']);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // Effect actually ran: a card was drawn.
    expect(countCardsInZone(state, 'p1', 'hand')).toBe(handBefore + 1);
  });

  it('fires "a creature you control ... to one or more players" trigger from a different attacker', () => {
    // Payoff enchantment-style permanent that watches a creature you control.
    const payoff: CardDefinition = {
      id: 'cd-team-payoff',
      name: 'Team Combat Damage',
      type_line: 'Enchantment',
      oracle_text: 'Whenever a creature you control deals combat damage to one or more players, draw a card.',
      mana_cost: '{2}{U}',
      cmc: 3,
      colors: ['U'],
      color_identity: ['U'],
      keywords: [],
      card_types: ['enchantment'],
    };
    const beater = makeCreature('cd-beater', 'Beater', '');
    beater.oracle_text = '';
    const island = makeLand('island-b', 'Island');

    let state = createTestGame([payoff, beater, island], [island]);
    const payoffInst = findCard(state, 'cd-team-payoff')!;
    const beaterInst = findCard(state, 'cd-beater')!;
    state = moveToZone(state, payoffInst.instanceId, 'battlefield');
    state = moveToZone(state, beaterInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, payoffInst.instanceId);
    state = { ...state, activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'combat' as any, step: 'declare_attackers' as any };

    const handBefore = countCardsInZone(state, 'p1', 'hand');

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: beaterInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    expect(state.pendingTriggers.map(t => t.ability.trigger.kind)).toEqual(['CombatDamageToPlayer']);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    expect(countCardsInZone(state, 'p1', 'hand')).toBe(handBefore + 1);
  });
});
