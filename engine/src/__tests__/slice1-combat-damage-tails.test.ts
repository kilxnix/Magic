/**
 * slice1-combat-damage-tails: Slice 1/12 coverage — combat-damage-to-player trigger tails.
 *
 * Covers:
 *   matchReturnThatPlayerControlsToHand — "return target <type> that player controls
 *     to its owner's hand" (Mistblade Shinobi / Ninja saboteur family).
 *   matchLookAtTargetPlayerHand extension — "look at that player's hand" (non-target
 *     EventPlayer variant, now handled via opponentControls: true chosen target).
 *
 * Parse tests verify AST shape. Execution tests verify the executor resolves
 * the effect correctly when triggered by CombatDamageToPlayer.
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

function makeCreature(id: string, name: string, oracleText: string, power = 2, toughness = 2): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature - Ninja',
    oracle_text: oracleText,
    mana_cost: '{2}{U}',
    cmc: 3,
    colors: ['U'],
    color_identity: ['U'],
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

function countCardsInZone(state: GameState, playerId: string, zone: string): number {
  return getCardsInZone(state, playerId, zone as any).length;
}

function cardsInZone(state: GameState, playerId: string, zone: string): CardInstance[] {
  return getCardsInZone(state, playerId, zone as any);
}

// ---------------------------------------------------------------------------
// Parse tests
// ---------------------------------------------------------------------------

describe('slice1-combat-damage-tails: parse tests', () => {
  // ── matchReturnThatPlayerControlsToHand ──────────────────────────────────

  it('parses "return target creature that player controls to its owner\'s hand" (Mistblade Shinobi)', () => {
    const r = parseOracleText(
      "Whenever ~ deals combat damage to a player, return target creature that player controls to its owner's hand.",
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger).toMatchObject({ kind: 'CombatDamageToPlayer', who: 'self' });
    const eff = r.ability.effects[0];
    expect(eff.kind).toBe('ReturnToHand');
    // Target must be a Creature with opponentControls
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].type).toBe('Creature');
    expect(r.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('parses "you may return target creature that player controls to its owner\'s hand"', () => {
    const r = parseOracleText(
      "Whenever ~ deals combat damage to a player, you may return target creature that player controls to its owner's hand.",
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.effects[0].kind).toBe('ReturnToHand');
    expect(r.targets[0].type).toBe('Creature');
    expect(r.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('parses "return target permanent that player controls to its owner\'s hand"', () => {
    const r = parseOracleText(
      "Whenever ~ deals combat damage to a player, return target permanent that player controls to its owner's hand.",
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.effects[0].kind).toBe('ReturnToHand');
    expect(r.targets[0].type).toBe('Permanent');
    expect(r.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('parses "return target nonland permanent that player controls to its owner\'s hand"', () => {
    const r = parseOracleText(
      "Whenever ~ deals combat damage to a player, return target nonland permanent that player controls to its owner's hand.",
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.effects[0].kind).toBe('ReturnToHand');
    expect(r.targets[0].type).toBe('NonlandPermanent');
    expect(r.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('parses "return target artifact that player controls to its owner\'s hand"', () => {
    const r = parseOracleText(
      "Whenever ~ deals combat damage to a player, return target artifact that player controls to its owner's hand.",
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.effects[0].kind).toBe('ReturnToHand');
    expect(r.targets[0].type).toBe('Artifact');
    expect(r.targets[0].constraints?.opponentControls).toBe(true);
  });

  // ── matchLookAtTargetPlayerHand extension ─────────────────────────────────

  it('parses "look at that player\'s hand" (EventPlayer/opponent variant)', () => {
    const r = parseOracleText(
      "Whenever ~ deals combat damage to a player, look at that player's hand.",
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger).toMatchObject({ kind: 'CombatDamageToPlayer', who: 'self' });
    const eff = r.ability.effects[0];
    expect(eff.kind).toBe('LookAtHand');
    // Should target a Player (opponent)
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].type).toBe('Player');
    expect(r.targets[0].constraints?.opponentControls).toBe(true);
  });

  // ── Verify already-working tails still parse correctly ───────────────────

  it('parses "that player discards a card" (pre-existing)', () => {
    const r = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player discards a card.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.effects[0].kind).toBe('Discard');
  });

  it('parses "that player mills two cards" (pre-existing)', () => {
    const r = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player mills two cards.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.effects[0].kind).toBe('Mill');
  });

  it('parses RevealUntilMatch (Bismuth Mindrender / pre-existing)', () => {
    const r = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player reveals cards from the top of their library until they reveal a nonland card. that player puts that card into their hand and the rest into their graveyard.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.effects[0].kind).toBe('RevealUntilMatch');
    const eff = r.ability.effects[0] as any;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
  });
});

// ---------------------------------------------------------------------------
// Execution tests
// ---------------------------------------------------------------------------

describe('slice1-combat-damage-tails: execution tests', () => {
  it('executes "return target creature that player controls to its owner\'s hand" — bounces opponent creature', () => {
    // p1 attacker has the Ninja saboteur trigger.
    const ninja = makeCreature(
      'ninja-bounce',
      'Mistblade-style Ninja',
      "Whenever ~ deals combat damage to a player, return target creature that player controls to its owner's hand.",
      2, 1,
    );
    const land = makeLand('island-test', 'Island');

    // p2 has a vanilla creature on the battlefield for us to bounce.
    const p2Creature = makeCreature('p2-creature', 'Defender Creature', '');

    let state = createTestGame([ninja, land, land], [p2Creature, land]);

    const ninjaInst = findCard(state, 'ninja-bounce')!;
    const p2CreatureInst = findCard(state, 'p2-creature')!;

    state = moveToZone(state, ninjaInst.instanceId, 'battlefield');
    state = moveToZone(state, p2CreatureInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, ninjaInst.instanceId);
    state = { ...state, activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'combat' as any, step: 'declare_attackers' as any };

    // p2 creature starts on the battlefield.
    expect([...state.cards.values()].filter(c => c.definitionId === 'p2-creature' && c.zone === 'battlefield')).toHaveLength(1);

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: ninjaInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    // Trigger should be pending.
    expect(state.pendingTriggers.map(t => t.ability.trigger.kind)).toContain('CombatDamageToPlayer');

    // Explicitly pass the p2 creature as target for the trigger.
    const triggerId = state.pendingTriggers.find(t => t.ability.trigger.kind === 'CombatDamageToPlayer')!.id;
    const triggerTargets: Record<string, string[]> = {
      [triggerId]: [p2CreatureInst.instanceId],
    };

    state = putTriggersOnStack(state, triggerTargets);
    state = resolveTopOfStack(state);

    // p2 creature should now be in hand, not battlefield.
    const p2CreatureAfter = state.cards.get(p2CreatureInst.instanceId)!;
    expect(p2CreatureAfter.zone).toBe('hand');
  });

  it('executes "look at that player\'s hand" — information-only, no state change', () => {
    // The LookAtHand executor is a no-op (information reveal). We verify it resolves
    // without error and the game state is otherwise unchanged.
    const spy = makeCreature(
      'hand-spy',
      'Hand Spy',
      "Whenever ~ deals combat damage to a player, look at that player's hand.",
      2, 1,
    );
    const land = makeLand('island-spy', 'Island');

    let state = createTestGame([spy, land, land], [land]);
    const spyInst = findCard(state, 'hand-spy')!;

    state = moveToZone(state, spyInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, spyInst.instanceId);
    state = { ...state, activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'combat' as any, step: 'declare_attackers' as any };

    const lifeBefore = state.players[1].life;

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: spyInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    expect(state.players[1].life).toBe(lifeBefore - 2);
    expect(state.pendingTriggers.map(t => t.ability.trigger.kind)).toContain('CombatDamageToPlayer');

    // Auto-target: LookAtHand targets the opponent (p2), default trigger target resolution
    // will pick p2 (opponentControls: true from the caster p1's perspective).
    state = putTriggersOnStack(state);
    // Should resolve cleanly without throwing.
    expect(() => { state = resolveTopOfStack(state); }).not.toThrow();
    // Life unchanged (LookAtHand is a no-op).
    expect(state.players[1].life).toBe(lifeBefore - 2);
  });

  it('executes "that player mills two cards" — mills the opponent', () => {
    // Pre-existing matcher — verify execution works in the combat-damage trigger context.
    const millCreature = makeCreature(
      'mill-attacker',
      'Mill Attacker',
      'Whenever ~ deals combat damage to a player, that player mills two cards.',
      2, 2,
    );
    const land = makeLand('island-mill', 'Island');
    const land2 = makeLand('island-mill-2', 'Island');
    const land3 = makeLand('island-mill-3', 'Island');

    // Give p2 enough cards so we can mill 2.
    let state = createTestGame([millCreature, land, land], [land2, land3, land3]);
    const millInst = findCard(state, 'mill-attacker')!;

    state = moveToZone(state, millInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, millInst.instanceId);
    state = { ...state, activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'combat' as any, step: 'declare_attackers' as any };

    // Count p2's graveyard before.
    const p2GravBefore = countCardsInZone(state, 'p2', 'graveyard');

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: millInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    expect(state.pendingTriggers.map(t => t.ability.trigger.kind)).toContain('CombatDamageToPlayer');

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // p2 should have milled 2 cards.
    const p2GravAfter = countCardsInZone(state, 'p2', 'graveyard');
    expect(p2GravAfter).toBe(p2GravBefore + 2);
  });
});
