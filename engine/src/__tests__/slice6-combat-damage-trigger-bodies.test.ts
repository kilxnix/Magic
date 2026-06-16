/**
 * slice6-combat-damage-trigger-bodies.test.ts
 *
 * Slice 6/12 — Combat-damage-to-player trigger bodies: clean counter/exile sub-forms.
 *
 * New matchers:
 *   (a) "put a +1/+1 counter on each attacking creature you control"
 *       → AddCounters { target: AllAttackingCreaturesYouControl }
 *
 *   (b) "exile the top X cards of their library, where X is the amount of damage dealt"
 *       → ExileFromLibrary { player: EventPlayer, count: EventDamageAmount }
 *       (Kotis, the Fangkeeper family)
 *
 * Already-working body (Ruination Guide / Ingest family):
 *   (c) "that player exiles the top card of their library"
 *       → ExileFromLibrary { player: EventPlayer, count: 1 }
 *       (handled by pre-existing matchThatPlayerExilesTopN — regression test included)
 *
 * Explicitly declined bodies (honesty bar — remain Unparsed):
 *   - "roll a d20" bodies (Ancient Gold Dragon)
 *   - "venture into the dungeon" bodies
 *   - "transform ~" bodies when found in combat-damage triggers not already covered
 *
 * Each supported sub-form has a parse test AND an execution test.
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
// Test helpers
// ---------------------------------------------------------------------------

function makeCreature(
  id: string,
  name: string,
  oracleText: string,
  power = 3,
  toughness = 2,
): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature - Test',
    oracle_text: oracleText,
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
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

function countCardsInZone(
  state: GameState,
  playerId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard' | 'exile',
): number {
  return getCardsInZone(state, playerId, zone as any).length;
}

function getCounters(state: GameState, instanceId: string, type: string): number {
  const card = state.cards.get(instanceId);
  return card?.counters?.[type] ?? 0;
}

function combatSetup(state: GameState): GameState {
  return {
    ...state,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'combat' as any,
    step: 'declare_attackers' as any,
  };
}

// ---------------------------------------------------------------------------
// (a) AddCounters on AllAttackingCreaturesYouControl — parse tests
// ---------------------------------------------------------------------------

describe('Slice 6 — counter body: "put a +1/+1 counter on each attacking creature you control"', () => {
  it('parses to AddCounters with AllAttackingCreaturesYouControl target', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, put a +1/+1 counter on each attacking creature you control.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toMatchObject({ kind: 'CombatDamageToPlayer', who: 'self' });
    expect(result.ability.effects).toHaveLength(1);
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('AddCounters');
    if (eff.kind !== 'AddCounters') return;
    expect(eff.target).toEqual({ kind: 'AllAttackingCreaturesYouControl' });
    expect(eff.counterType).toBe('+1/+1');
    expect(eff.count).toBe(1);
  });

  it('parses "this creature" subject variant to same effect', () => {
    const result = parseOracleText(
      'Whenever this creature deals combat damage to a player, put a +1/+1 counter on each attacking creature you control.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('AddCounters');
    if (eff.kind !== 'AddCounters') return;
    expect(eff.target).toEqual({ kind: 'AllAttackingCreaturesYouControl' });
  });

  it('parses with "one or more players" trigger prefix variant', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to one or more players, put a +1/+1 counter on each attacking creature you control.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('AddCounters');
    if (eff.kind !== 'AddCounters') return;
    expect(eff.target).toEqual({ kind: 'AllAttackingCreaturesYouControl' });
    expect(eff.counterType).toBe('+1/+1');
  });
});

// ---------------------------------------------------------------------------
// (a) AddCounters on AllAttackingCreaturesYouControl — execution test
// ---------------------------------------------------------------------------

describe('Slice 6 — counter body execution: attacking creatures get +1/+1 counters', () => {
  it('counters land on all attacking creatures you control after combat damage trigger fires', () => {
    // The payoff creature has the trigger.
    const payoff = makeCreature(
      'sl6-counter-payoff',
      'Counter Payoff',
      'Whenever ~ deals combat damage to a player, put a +1/+1 counter on each attacking creature you control.',
      2,
      2,
    );
    // A second attacker that should also receive the counter.
    const ally = makeCreature('sl6-counter-ally', 'Ally Attacker', '', 1, 1);
    const land = makeLand('sl6-land-a');
    const opponentLand = makeLand('sl6-land-opp');

    let state = createTestGame([payoff, ally, land], [opponentLand]);

    const payoffInst = findCard(state, 'sl6-counter-payoff')!;
    const allyInst = findCard(state, 'sl6-counter-ally')!;

    // Put both attackers on the battlefield (not summoning sick).
    state = moveToZone(state, payoffInst.instanceId, 'battlefield');
    state = moveToZone(state, allyInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, payoffInst.instanceId);
    state = combatSetup(state);

    // Declare both as attackers.
    state = declareAttackers(state, 'p1', [
      { cardInstanceId: payoffInst.instanceId, defendingPlayerId: 'p2' },
      { cardInstanceId: allyInst.instanceId, defendingPlayerId: 'p2' },
    ]);

    const countersBefore_payoff = getCounters(state, payoffInst.instanceId, '+1/+1');
    const countersBefore_ally = getCounters(state, allyInst.instanceId, '+1/+1');
    expect(countersBefore_payoff).toBe(0);
    expect(countersBefore_ally).toBe(0);

    state = resolveCombatDamage(state);

    // The CombatDamageToPlayer trigger should be pending.
    expect(state.pendingTriggers.some(t => t.ability.trigger.kind === 'CombatDamageToPlayer')).toBe(true);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // Both attacking creatures should have received a +1/+1 counter.
    expect(getCounters(state, payoffInst.instanceId, '+1/+1')).toBe(countersBefore_payoff + 1);
    expect(getCounters(state, allyInst.instanceId, '+1/+1')).toBe(countersBefore_ally + 1);
  });

  it('counter body does not affect non-attacking creatures you control', () => {
    const payoff = makeCreature(
      'sl6-counter-payoff2',
      'Counter Payoff 2',
      'Whenever ~ deals combat damage to a player, put a +1/+1 counter on each attacking creature you control.',
      2,
      2,
    );
    // A creature that stays home — should NOT receive a counter.
    const sitter = makeCreature('sl6-counter-sitter', 'Home Sitter', '', 1, 1);
    const land = makeLand('sl6-land-b');
    const opponentLand = makeLand('sl6-land-opp2');

    let state = createTestGame([payoff, sitter, land], [opponentLand]);

    const payoffInst = findCard(state, 'sl6-counter-payoff2')!;
    const sitterInst = findCard(state, 'sl6-counter-sitter')!;

    state = moveToZone(state, payoffInst.instanceId, 'battlefield');
    state = moveToZone(state, sitterInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, payoffInst.instanceId);
    state = combatSetup(state);

    // Only payoff attacks; sitter stays on defense.
    state = declareAttackers(state, 'p1', [
      { cardInstanceId: payoffInst.instanceId, defendingPlayerId: 'p2' },
    ]);

    state = resolveCombatDamage(state);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // Payoff attacker got a counter; home sitter did not.
    expect(getCounters(state, payoffInst.instanceId, '+1/+1')).toBe(1);
    expect(getCounters(state, sitterInst.instanceId, '+1/+1')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (b) ExileFromLibrary with EventDamageAmount — parse tests
// ---------------------------------------------------------------------------

describe('Slice 6 — exile body: "exile the top X cards of their library, where X is the amount of damage dealt"', () => {
  it('parses Kotis-style wording to ExileFromLibrary{EventPlayer, EventDamageAmount}', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, exile the top X cards of their library, where X is the amount of damage dealt.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toMatchObject({ kind: 'CombatDamageToPlayer', who: 'self' });
    expect(result.ability.effects).toHaveLength(1);
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('ExileFromLibrary');
    if (eff.kind !== 'ExileFromLibrary') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toEqual({ kind: 'EventDamageAmount' });
  });

  it('parses "this creature" prefix variant to same effect', () => {
    const result = parseOracleText(
      'Whenever this creature deals combat damage to a player, exile the top X cards of their library, where X is the amount of damage dealt.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('ExileFromLibrary');
    if (eff.kind !== 'ExileFromLibrary') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toEqual({ kind: 'EventDamageAmount' });
  });
});

// ---------------------------------------------------------------------------
// (b) ExileFromLibrary with EventDamageAmount — execution test
// ---------------------------------------------------------------------------

describe('Slice 6 — exile body execution: opponent exiles X cards where X = damage', () => {
  it('exiles cards equal to combat damage dealt from hit player library', () => {
    const attacker = makeCreature(
      'sl6-exile-attacker',
      'Kotis Proxy',
      'Whenever ~ deals combat damage to a player, exile the top X cards of their library, where X is the amount of damage dealt.',
      3,  // power = 3 → will deal 3 damage → opponent exiles 3 cards
      2,
    );
    const land = makeLand('sl6-land-c');
    const opponentLand = makeLand('sl6-land-opp3');
    // Add extra library cards for the opponent to have enough to exile.
    const opponentCard1 = makeCreature('sl6-opp-card-1', 'Opp1', '', 1, 1);
    const opponentCard2 = makeCreature('sl6-opp-card-2', 'Opp2', '', 1, 1);
    const opponentCard3 = makeCreature('sl6-opp-card-3', 'Opp3', '', 1, 1);
    const opponentCard4 = makeCreature('sl6-opp-card-4', 'Opp4', '', 1, 1);

    let state = createTestGame(
      [attacker, land],
      [opponentLand, opponentCard1, opponentCard2, opponentCard3, opponentCard4],
    );

    const attackerInst = findCard(state, 'sl6-exile-attacker')!;
    state = moveToZone(state, attackerInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, attackerInst.instanceId);
    state = combatSetup(state);

    const exileBefore = countCardsInZone(state, 'p2', 'exile');
    const libraryBefore = countCardsInZone(state, 'p2', 'library');

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    expect(state.players[1].life).toBe(37); // started 40, took 3 damage

    expect(state.pendingTriggers.some(t => t.ability.trigger.kind === 'CombatDamageToPlayer')).toBe(true);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // Opponent should have 3 more cards in exile and 3 fewer in library.
    const exileAfter = countCardsInZone(state, 'p2', 'exile');
    const libraryAfter = countCardsInZone(state, 'p2', 'library');
    expect(exileAfter).toBe(exileBefore + 3);
    expect(libraryAfter).toBe(libraryBefore - 3);
  });
});

// ---------------------------------------------------------------------------
// (c) Regression: "that player exiles the top card of their library" (Ruination Guide/Ingest)
// ---------------------------------------------------------------------------

describe('Slice 6 — regression: Ingest / "that player exiles the top card of their library"', () => {
  it('parses to ExileFromLibrary{EventPlayer, 1}', () => {
    const result = parseOracleText(
      'Whenever this creature deals combat damage to a player, that player exiles the top card of their library.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(result.ability.effects).toHaveLength(1);
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('ExileFromLibrary');
    if (eff.kind !== 'ExileFromLibrary') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Honesty bar: decline unsupported bodies
// ---------------------------------------------------------------------------

describe('Slice 6 — honesty: unsupported bodies remain Unparsed', () => {
  it('declines venture-into-the-dungeon body', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, venture into the dungeon.',
    );
    // The venture body has no executor; must remain Unparsed.
    expect(result.kind).toBe('Unparsed');
  });

  it('declines time-travel body', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, time travel.',
    );
    expect(result.kind).toBe('Unparsed');
  });
});
