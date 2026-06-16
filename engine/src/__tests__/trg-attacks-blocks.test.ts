/**
 * trg-attacks-blocks: executing tests for attack-timing triggers.
 *
 * Family: "Whenever ~ attacks", "Whenever ~ attacks alone",
 *         "Whenever a creature you control attacks".
 *
 * These tests drive a real GameState through declareAttackers and assert the
 * trigger's effect actually happened (a card was drawn).
 *
 * NOTE on "Whenever ~ blocks": the engine's declareBlockers emits NO per-blocker
 * "Blocks" event (only an "Unblocked" event for unblocked attackers). A
 * "Whenever ~ blocks" condition would therefore be a dead no-op, so it is NOT
 * implemented here. See the structured report (shipped:false for blocks).
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState, getCardsInZone } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  registerBattlefieldAbilities,
} from '../stack';
import { declareAttackers } from '../combat';
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

function moveToBattlefield(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone: 'battlefield', summoningSick: false });
  return { ...state, cards: newCards };
}

function findCard(state: GameState, defId: string): CardInstance {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  throw new Error(`Card not found for def: ${defId}`);
}

function handSize(state: GameState, playerId: string): number {
  return getCardsInZone(state, playerId, 'hand' as any).length;
}

function setupCombat(state: GameState): GameState {
  return { ...state, activePlayerIndex: 0, phase: 'combat' as any, step: 'declare_attackers' as any };
}

describe('trg-attacks-blocks parsing', () => {
  it('parses "Whenever ~ attacks alone" with alone:true', () => {
    const result = parseOracleText('Whenever ~ attacks alone, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'Attacks', who: 'self', alone: true });
  });

  it('parses plain "Whenever ~ attacks" without alone (unchanged)', () => {
    const result = parseOracleText('Whenever ~ attacks, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'Attacks', who: 'self' });
  });

  it('parses "Whenever a creature you control attacks"', () => {
    const result = parseOracleText('Whenever a creature you control attacks, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CreatureYouControlAttacks' });
  });
});

describe('trg-attacks-blocks execution', () => {
  it('"Whenever ~ attacks, draw a card" fires and draws', () => {
    const attacker = makeCreature('atk-plain', 'Plain Attacker', 'Whenever ~ attacks, draw a card.');
    let state = createTestGame([attacker, makeLand('l1', 'Island'), makeLand('l2', 'Island')], [makeLand('l3', 'Island')]);
    const inst = findCard(state, 'atk-plain');
    state = moveToBattlefield(state, inst.instanceId);
    state = registerBattlefieldAbilities(state, inst.instanceId);
    state = setupCombat(state);

    const before = handSize(state, 'p1');
    state = declareAttackers(state, 'p1', [{ cardInstanceId: inst.instanceId, defendingPlayerId: 'p2' }]);
    expect(state.pendingTriggers.length).toBe(1);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(handSize(state, 'p1')).toBe(before + 1);
  });

  it('"Whenever ~ attacks alone" fires when sole attacker', () => {
    const lone = makeCreature('atk-alone', 'Lone Wolf', 'Whenever ~ attacks alone, draw a card.');
    let state = createTestGame([lone, makeLand('la', 'Island')], [makeLand('lb', 'Island')]);
    const inst = findCard(state, 'atk-alone');
    state = moveToBattlefield(state, inst.instanceId);
    state = registerBattlefieldAbilities(state, inst.instanceId);
    state = setupCombat(state);

    const before = handSize(state, 'p1');
    state = declareAttackers(state, 'p1', [{ cardInstanceId: inst.instanceId, defendingPlayerId: 'p2' }]);
    expect(state.pendingTriggers.length).toBe(1);
    expect(state.pendingTriggers[0].ability.trigger).toEqual({ kind: 'Attacks', who: 'self', alone: true });
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(handSize(state, 'p1')).toBe(before + 1);
  });

  it('"Whenever ~ attacks alone" does NOT fire when attacking with another creature', () => {
    const lone = makeCreature('atk-alone2', 'Lone Wolf', 'Whenever ~ attacks alone, draw a card.');
    const buddy = makeCreature('atk-buddy', 'Buddy', 'Vanilla.');
    let state = createTestGame([lone, buddy, makeLand('lc', 'Island')], [makeLand('ld', 'Island')]);
    const loneInst = findCard(state, 'atk-alone2');
    const buddyInst = findCard(state, 'atk-buddy');
    state = moveToBattlefield(state, loneInst.instanceId);
    state = moveToBattlefield(state, buddyInst.instanceId);
    state = registerBattlefieldAbilities(state, loneInst.instanceId);
    state = registerBattlefieldAbilities(state, buddyInst.instanceId);
    state = setupCombat(state);

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: loneInst.instanceId, defendingPlayerId: 'p2' },
      { cardInstanceId: buddyInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    // attacks-alone trigger must NOT be pending because two creatures attacked.
    expect(state.pendingTriggers.length).toBe(0);
  });

  it('"Whenever a creature you control attacks" fires per attacking creature', () => {
    const anthem = makeCreature('atk-cyc', 'War Drummer', 'Whenever a creature you control attacks, draw a card.');
    const other = makeCreature('atk-other', 'Soldier', 'Vanilla.');
    let state = createTestGame([anthem, other, makeLand('le', 'Island')], [makeLand('lf', 'Island')]);
    const anthemInst = findCard(state, 'atk-cyc');
    const otherInst = findCard(state, 'atk-other');
    state = moveToBattlefield(state, anthemInst.instanceId);
    state = moveToBattlefield(state, otherInst.instanceId);
    state = registerBattlefieldAbilities(state, anthemInst.instanceId);
    state = setupCombat(state);

    const before = handSize(state, 'p1');
    // Only the "other" creature attacks; the anthem stays back but its
    // "creature you control attacks" trigger must still fire.
    state = declareAttackers(state, 'p1', [{ cardInstanceId: otherInst.instanceId, defendingPlayerId: 'p2' }]);
    expect(state.pendingTriggers.length).toBe(1);
    expect(state.pendingTriggers[0].ability.trigger).toEqual({ kind: 'CreatureYouControlAttacks' });
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(handSize(state, 'p1')).toBe(before + 1);
  });
});
