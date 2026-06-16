/**
 * slice9-fynn-poison: Slice 9/11 — Fynn, the Fangbearer poison trigger.
 *
 * Covers:
 *   - Parse: "Whenever a creature you control with deathtouch deals combat damage
 *     to a player, that player gets two poison counters." parses to a
 *     CombatDamageToPlayer(creatureYouControl, requiresDeathtouch) trigger with
 *     an AddCounters(EventPlayer, 'poison', 2) body effect.
 *   - Execution: a deathtouch creature dealing combat damage fires the trigger and
 *     adds 2 poison counters to the damaged player.
 *   - Deathtouch gate: a non-deathtouch creature dealing combat damage does NOT
 *     fire the trigger.
 *   - State-based: a player at 10+ poison counters loses the game.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  registerBattlefieldAbilities,
} from '../stack';
import { declareAttackers, resolveCombatDamage } from '../combat';
import { checkStateBasedActions } from '../state-based';
import type { CardDefinition, GameState, CardInstance } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCreature(
  id: string,
  name: string,
  oracleText: string,
  power = 1,
  toughness = 1,
  keywords: string[] = [],
): CardDefinition {
  return {
    id,
    name,
    type_line: 'Legendary Creature - Human Warrior',
    oracle_text: oracleText,
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords,
    power,
    toughness,
    card_types: ['creature'],
  };
}

function makeLand(id: string): CardDefinition {
  return {
    id,
    name: 'Forest',
    type_line: 'Basic Land - Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
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

function moveToZone(
  state: GameState,
  instanceId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard',
): GameState {
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

// ---------------------------------------------------------------------------
// Parse tests
// ---------------------------------------------------------------------------

const FYNN_ORACLE =
  'Whenever a creature you control with deathtouch deals combat damage to a player, that player gets two poison counters.';

describe('slice9-fynn-poison: parse tests', () => {
  it('parses Fynn oracle text to a Triggered ability', () => {
    const r = parseOracleText(FYNN_ORACLE);
    expect(r.kind).toBe('Triggered');
  });

  it('parses trigger kind as CombatDamageToPlayer with creatureYouControl and requiresDeathtouch', () => {
    const r = parseOracleText(FYNN_ORACLE);
    if (r.kind !== 'Triggered') throw new Error('Expected Triggered');
    expect(r.ability.trigger.kind).toBe('CombatDamageToPlayer');
    const trigger = r.ability.trigger as { kind: 'CombatDamageToPlayer'; who: string; requiresDeathtouch?: boolean };
    expect(trigger.who).toBe('creatureYouControl');
    expect(trigger.requiresDeathtouch).toBe(true);
  });

  it('parses body effect as AddCounters(EventPlayer, poison, 2)', () => {
    const r = parseOracleText(FYNN_ORACLE);
    if (r.kind !== 'Triggered') throw new Error('Expected Triggered');
    expect(r.ability.effects).toHaveLength(1);
    const eff = r.ability.effects[0] as any;
    expect(eff.kind).toBe('AddCounters');
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    expect(eff.counterType).toBe('poison');
    expect(eff.count).toBe(2);
  });

  it('does NOT parse requiresDeathtouch for plain creature-you-control combat damage trigger', () => {
    const plain = 'Whenever a creature you control deals combat damage to a player, draw a card.';
    const r = parseOracleText(plain);
    if (r.kind !== 'Triggered') throw new Error('Expected Triggered');
    const trigger = r.ability.trigger as { kind: 'CombatDamageToPlayer'; who: string; requiresDeathtouch?: boolean };
    expect(trigger.who).toBe('creatureYouControl');
    expect(trigger.requiresDeathtouch).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Execution tests
// ---------------------------------------------------------------------------

describe('slice9-fynn-poison: execution tests', () => {
  it('deals 2 poison counters to opponent when a deathtouch creature deals combat damage', () => {
    // Fynn is on p1's side. A deathtouch attacker also on p1's side.
    const fynn = makeCreature('fynn-def', 'Fynn, the Fangbearer', FYNN_ORACLE, 1, 3);
    const deathtouchCreature = makeCreature(
      'deathtouch-creature',
      'Deathtouch Attacker',
      'Deathtouch',
      2, 1,
      ['Deathtouch'],
    );
    const land = makeLand('forest-1');

    let state = createTestGame([fynn, deathtouchCreature, land], [land]);

    const fynnInst = findCard(state, 'fynn-def')!;
    const dtInst = findCard(state, 'deathtouch-creature')!;

    // Put Fynn and the deathtouch attacker on the battlefield (not summoning sick).
    state = moveToZone(state, fynnInst.instanceId, 'battlefield');
    state = moveToZone(state, dtInst.instanceId, 'battlefield');

    // Register Fynn's triggered abilities.
    state = registerBattlefieldAbilities(state, fynnInst.instanceId);

    state = {
      ...state,
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'combat' as any,
      step: 'declare_attackers' as any,
    };

    const p2Before = state.players.find(p => p.id === 'p2')!;
    expect(p2Before.poisonCounters).toBe(0);

    // Declare the deathtouch creature as attacker.
    state = declareAttackers(state, 'p1', [
      { cardInstanceId: dtInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    // Fynn's trigger should be pending.
    expect(state.pendingTriggers.length).toBeGreaterThan(0);
    const trigger = state.pendingTriggers.find(
      t => t.ability.trigger.kind === 'CombatDamageToPlayer',
    );
    expect(trigger).toBeDefined();

    // Resolve the trigger (no targets needed — EventPlayer is implicit).
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const p2After = state.players.find(p => p.id === 'p2')!;
    expect(p2After.poisonCounters).toBe(2);
  });

  it('does NOT fire Fynn trigger when attacker lacks deathtouch', () => {
    const fynn = makeCreature('fynn-def2', 'Fynn, the Fangbearer', FYNN_ORACLE, 1, 3);
    // Vanilla attacker — no deathtouch keyword.
    const vanillaAttacker = makeCreature('vanilla-atk', 'Vanilla Attacker', '', 3, 3);
    const land = makeLand('forest-2');

    let state = createTestGame([fynn, vanillaAttacker, land], [land]);

    const fynnInst = findCard(state, 'fynn-def2')!;
    const atkInst = findCard(state, 'vanilla-atk')!;

    state = moveToZone(state, fynnInst.instanceId, 'battlefield');
    state = moveToZone(state, atkInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, fynnInst.instanceId);

    state = {
      ...state,
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'combat' as any,
      step: 'declare_attackers' as any,
    };

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: atkInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    // No CombatDamageToPlayer trigger from Fynn should fire for a non-deathtouch creature.
    const fynnTrigger = state.pendingTriggers.find(
      t => t.ability.trigger.kind === 'CombatDamageToPlayer' &&
        (t.ability.trigger as any).requiresDeathtouch === true,
    );
    expect(fynnTrigger).toBeUndefined();

    // p2 should still have 0 poison counters.
    const p2 = state.players.find(p => p.id === 'p2')!;
    expect(p2.poisonCounters).toBe(0);
  });

  it('player loses the game at 10 poison counters (SBA)', () => {
    const land = makeLand('forest-3');
    let state = createTestGame([land], [land]);

    // Manually set p2's poison counters to 10.
    state = {
      ...state,
      players: state.players.map(p =>
        p.id === 'p2' ? { ...p, poisonCounters: 10 } : p,
      ),
    };

    // Run state-based actions.
    state = checkStateBasedActions(state);

    const p2 = state.players.find(p => p.id === 'p2')!;
    expect(p2.hasLost).toBe(true);
  });

  it('player does not lose at 9 poison counters', () => {
    const land = makeLand('forest-4');
    let state = createTestGame([land], [land]);

    state = {
      ...state,
      players: state.players.map(p =>
        p.id === 'p2' ? { ...p, poisonCounters: 9 } : p,
      ),
    };

    state = checkStateBasedActions(state);

    const p2 = state.players.find(p => p.id === 'p2')!;
    expect(p2.hasLost).toBe(false);
  });

  it('Fynn itself attacking with deathtouch fires the trigger (self is also a creature you control)', () => {
    const fynnOracle =
      'Deathtouch\n' + FYNN_ORACLE;
    const fynn = makeCreature('fynn-self', 'Fynn, the Fangbearer', fynnOracle, 1, 3, ['Deathtouch']);
    const land = makeLand('forest-5');

    let state = createTestGame([fynn, land], [land]);
    const fynnInst = findCard(state, 'fynn-self')!;

    state = moveToZone(state, fynnInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, fynnInst.instanceId);

    state = {
      ...state,
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'combat' as any,
      step: 'declare_attackers' as any,
    };

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: fynnInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    const trigger = state.pendingTriggers.find(
      t => t.ability.trigger.kind === 'CombatDamageToPlayer',
    );
    expect(trigger).toBeDefined();

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const p2 = state.players.find(p => p.id === 'p2')!;
    expect(p2.poisonCounters).toBe(2);
  });
});
