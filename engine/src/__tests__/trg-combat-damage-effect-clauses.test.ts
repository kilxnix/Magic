/**
 * trg-combat-damage-effect-clauses: Slice 2 coverage tests for self
 * combat-damage-to-player trigger EFFECT clause matchers.
 *
 * Verifies that existing effect-clause matchers already work under the
 * self-combat-damage prefix AND that the new matchTheyGetThatManyCounters
 * matcher parses AND executes correctly.
 *
 * Test cases:
 *  1. "they get that many rad counters" — new matcher (Infesting Radroach)
 *  2. "they get that many poison counters" — new matcher (poison variant)
 *  3. "they get that many energy counters" — new matcher (energy variant)
 *  4. "draw a card" — existing matcher already works under this prefix
 *  5. "each opponent loses 1 life" — existing matcher already works
 *  6. "that player mills 3 cards" — existing matcher already works
 *  7. "that player exiles the top 3 cards of their library" — existing
 *  8. Execution: "they get that many rad counters" actually applies counters
 *     equal to combat-damage dealt
 *  9. Execution: "they get that many poison counters" via poison path
 * 10. Decline: "you get that many additional upkeep steps" (unsupported)
 * 11. Decline: "that player exiles cards ... you may cast" (unsupported cast-from-exile)
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCreature(id: string, name: string, oracleText: string, power = 3, toughness = 2): CardDefinition {
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
    power,
    toughness,
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

function getPlayer(state: GameState, playerId: string) {
  return state.players.find(p => p.id === playerId)!;
}

// ---------------------------------------------------------------------------
// Parse-only tests
// ---------------------------------------------------------------------------

describe('trg-combat-damage-effect-clauses parsing (matchTheyGetThatManyCounters)', () => {
  it('parses "they get that many rad counters" (Infesting Radroach wording)', () => {
    const result = parseOracleText(
      'Flying This creature can\'t block. Whenever this creature deals combat damage to a player, they get that many rad counters.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CombatDamageToPlayer', who: 'self' });
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('AddCounters');
    if (eff.kind !== 'AddCounters') return;
    expect(eff.counterType).toBe('rad');
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toEqual({ kind: 'EventDamageAmount' });
  });

  it('parses "they get that many poison counters" variant', () => {
    const result = parseOracleText(
      'Whenever this creature deals combat damage to a player, they get that many poison counters.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CombatDamageToPlayer', who: 'self' });
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('AddCounters');
    if (eff.kind !== 'AddCounters') return;
    expect(eff.counterType).toBe('poison');
    expect(eff.count).toEqual({ kind: 'EventDamageAmount' });
  });

  it('parses "they get that many energy counters" variant', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, they get that many energy counters.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('AddCounters');
    if (eff.kind !== 'AddCounters') return;
    expect(eff.counterType).toBe('energy');
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
  });
});

describe('trg-combat-damage-effect-clauses: existing effect clauses work under self-combat-damage prefix', () => {
  it('parses "draw a card" tail (existing matcher, sanity check)', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, draw a card.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('parses "each opponent loses 1 life" tail (existing matcher — emits LoseLife with EachOpponent player)', () => {
    const result = parseOracleText(
      'Whenever this creature deals combat damage to a player, each opponent loses 1 life.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('CombatDamageToPlayer');
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('LoseLife');
    if (eff.kind !== 'LoseLife') return;
    expect(eff.player).toEqual({ kind: 'EachOpponent' });
  });

  it('parses "that player mills 3 cards" tail (existing matcher)', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player mills 3 cards.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(result.ability.effects[0].kind).toBe('Mill');
  });

  it('parses "that player exiles the top 3 cards of their library" (existing matchThatPlayerExilesTopN)', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player exiles the top 3 cards of their library.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('CombatDamageToPlayer');
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('ExileFromLibrary');
    if (eff.kind !== 'ExileFromLibrary') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toBe(3);
  });
});

describe('trg-combat-damage-effect-clauses: honesty declines', () => {
  it('declines "you get that many additional upkeep steps" (Obeka — no executor support)', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, you get that many additional upkeep steps.',
    );
    // Should not parse as a Triggered ability with a known effect
    // (may be Unparsed or parse only partial keyword lines)
    expect(result.kind).toBe('Unparsed');
  });

  it('declines "that player exiles cards ... You may cast that card without paying its mana cost" (cast-from-exile unsupported)', () => {
    const result = parseOracleText(
      'Flying Whenever this creature deals combat damage to a player, that player exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost.',
    );
    // The "you may cast" rider is not supported; should remain Unparsed
    expect(result.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// Execution tests
// ---------------------------------------------------------------------------

describe('trg-combat-damage-effect-clauses execution', () => {
  it('applies rad counters equal to combat damage dealt (they get that many rad counters)', () => {
    // Attacker with power 3 → p2 takes 3 damage → p2 gets 3 rad counters
    const attacker = makeCreature(
      'radroach',
      'Infesting Radroach',
      'Flying This creature can\'t block. Whenever this creature deals combat damage to a player, they get that many rad counters.',
      3, // power 3
      1,
    );
    const land = makeLand('island-r1', 'Island');

    let state = createTestGame([attacker, land, land], [land, land]);
    const attackerInst = findCard(state, 'radroach')!;
    state = moveToZone(state, attackerInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, attackerInst.instanceId);
    state = {
      ...state,
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'combat' as any,
      step: 'declare_attackers' as any,
    };

    const p2Before = getPlayer(state, 'p2');
    const radBefore = p2Before.playerCounters?.['rad'] ?? 0;

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    // Trigger should be pending
    expect(state.pendingTriggers.length).toBeGreaterThan(0);
    expect(state.pendingTriggers[0].ability.trigger.kind).toBe('CombatDamageToPlayer');

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const p2After = getPlayer(state, 'p2');
    const radAfter = p2After.playerCounters?.['rad'] ?? 0;

    // Power 3 → 3 rad counters added
    expect(radAfter).toBe(radBefore + 3);
  });

  it('applies poison counters equal to combat damage dealt (they get that many poison counters)', () => {
    // Attacker with power 2 → p2 gets 2 poison counters
    const infector = makeCreature(
      'poison-striker',
      'Poison Striker',
      'Whenever this creature deals combat damage to a player, they get that many poison counters.',
      2,
      2,
    );
    const land = makeLand('island-p1', 'Island');

    let state = createTestGame([infector, land], [land, land]);
    const attackerInst = findCard(state, 'poison-striker')!;
    state = moveToZone(state, attackerInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, attackerInst.instanceId);
    state = {
      ...state,
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'combat' as any,
      step: 'declare_attackers' as any,
    };

    const p2Before = getPlayer(state, 'p2');
    const poisonBefore = p2Before.poisonCounters ?? 0;

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    expect(state.pendingTriggers.length).toBeGreaterThan(0);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const p2After = getPlayer(state, 'p2');
    // Power 2 → 2 poison counters
    expect(p2After.poisonCounters ?? 0).toBe(poisonBefore + 2);
  });
});
