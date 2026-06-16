/**
 * slice7-combat-damage-tails.test.ts
 *
 * Slice 7: Combat-damage-to-player trigger modernization + three supported tails.
 *
 * Part 1 — Prefix modernization:
 *   "this creature" / "this Vehicle" / "this permanent" are now accepted
 *   alongside "~" as the self-subject in CombatDamageToPlayer triggers.
 *
 * Part 2 — Three new tail effects:
 *   (a) "create a token that's a copy of this creature"  → Copy{Source}
 *   (b) "that player exiles the top N cards of their library"  → ExileFromLibrary{EventPlayer}
 *   (c) "untap up to one target creature"  → Untap{Chosen, minCount:0}
 *
 * Each tail has a parse test AND an execution test.
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
import { executeEffectsWithSBA } from '../effects/executor';
import type { CardDefinition, GameState, CardInstance } from '../types';

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

function makeCreature(id: string, name: string, oracleText: string, power = 3, toughness = 2): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature - Test',
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

function countCardsInZone(state: GameState, playerId: string, zone: 'hand' | 'battlefield' | 'library' | 'graveyard'): number {
  return getCardsInZone(state, playerId, zone).length;
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
// Part 1: Prefix modernization — "this creature" / "this Vehicle" / "this permanent"
// ---------------------------------------------------------------------------

describe('Slice 7 — prefix modernization: "this creature" subject', () => {
  it('parses "Whenever this creature deals combat damage to a player, ..." as CombatDamageToPlayer(self)', () => {
    const result = parseOracleText('Whenever this creature deals combat damage to a player, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CombatDamageToPlayer', who: 'self' });
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('parses "Whenever this Vehicle deals combat damage to a player, ..." as CombatDamageToPlayer(self)', () => {
    const result = parseOracleText('Whenever this Vehicle deals combat damage to a player, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CombatDamageToPlayer', who: 'self' });
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('parses "Whenever this creature deals combat damage to one or more players, ..." as CombatDamageToPlayer(self)', () => {
    const result = parseOracleText('Whenever this creature deals combat damage to one or more players, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CombatDamageToPlayer', who: 'self' });
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('fires "this creature deals combat damage to a player" trigger and executes effect', () => {
    const def = makeCreature(
      'slc7-this-creature',
      'This Creature Attacker',
      'Whenever this creature deals combat damage to a player, draw a card.',
    );
    const island = makeLand('slc7-island-a', 'Island');

    let state = createTestGame([def, island], [island]);
    const inst = findCard(state, 'slc7-this-creature')!;
    state = moveToZone(state, inst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, inst.instanceId);
    state = combatSetup(state);

    const handBefore = countCardsInZone(state, 'p1', 'hand');

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: inst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    expect(state.pendingTriggers.some(t => t.ability.trigger.kind === 'CombatDamageToPlayer')).toBe(true);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    expect(countCardsInZone(state, 'p1', 'hand')).toBe(handBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// Tail (a): "create a token that's a copy of this creature"
// ---------------------------------------------------------------------------

describe('Slice 7 — tail (a): matchCopySelfCreature', () => {
  it('parses "create a token that\'s a copy of this creature" to Copy{Source}', () => {
    const result = parseOracleText(
      "Whenever this creature deals combat damage to a player, create a token that's a copy of this creature.",
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const effects = result.ability.effects;
    expect(effects.length).toBeGreaterThanOrEqual(1);
    expect(effects[0].kind).toBe('Copy');
    if (effects[0].kind !== 'Copy') return;
    expect(effects[0].target).toEqual({ kind: 'Source' });
  });

  it('parses "create a token that is a copy of this creature" to Copy{Source}', () => {
    const result = parseOracleText(
      'Whenever this creature deals combat damage to a player, create a token that is a copy of this creature.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.effects[0].kind).toBe('Copy');
    if (result.ability.effects[0].kind !== 'Copy') return;
    expect(result.ability.effects[0].target).toEqual({ kind: 'Source' });
  });

  it('parses "create a token that\'s a copy of ~" to Copy{Source}', () => {
    const result = parseOracleText(
      "Whenever ~ deals combat damage to a player, create a token that's a copy of ~.",
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.effects[0].kind).toBe('Copy');
    if (result.ability.effects[0].kind !== 'Copy') return;
    expect(result.ability.effects[0].target).toEqual({ kind: 'Source' });
  });

  it('executes copy-self trigger: creates a token copy of the attacking creature', () => {
    const naga = makeCreature(
      'slc7-naga',
      'Mist-Syndicate Naga Test',
      "Whenever this creature deals combat damage to a player, create a token that's a copy of this creature.",
      3, 1,
    );
    const island = makeLand('slc7-island-b', 'Island');

    let state = createTestGame([naga, island, island], [island, island, island]);
    const nagaInst = findCard(state, 'slc7-naga')!;
    state = moveToZone(state, nagaInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, nagaInst.instanceId);
    state = combatSetup(state);

    const battlefieldBefore = countCardsInZone(state, 'p1', 'battlefield');

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: nagaInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    expect(state.pendingTriggers.some(t => t.ability.trigger.kind === 'CombatDamageToPlayer')).toBe(true);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // A token copy of the naga should have entered the battlefield.
    const battlefieldAfter = countCardsInZone(state, 'p1', 'battlefield');
    expect(battlefieldAfter).toBe(battlefieldBefore + 1);

    // The token should share the original's definition id.
    const tokens = [...state.cards.values()].filter(
      c => c.ownerId === 'p1' && c.zone === 'battlefield' && c.definitionId === nagaInst.definitionId && c.instanceId !== nagaInst.instanceId,
    );
    expect(tokens.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tail (b): "that player exiles the top N cards of their library"
// ---------------------------------------------------------------------------

describe('Slice 7 — tail (b): matchThatPlayerExilesTopN', () => {
  it('parses "that player exiles the top ten cards of their library" to ExileFromLibrary{EventPlayer}', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player exiles the top ten cards of their library.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('ExileFromLibrary');
    if (eff.kind !== 'ExileFromLibrary') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toBe(10);
  });

  it('parses singular "that player exiles the top card of their library"', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player exiles the top card of their library.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('ExileFromLibrary');
    if (eff.kind !== 'ExileFromLibrary') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toBe(1);
  });

  it('parses "this creature deals combat damage to a player, that player exiles top 5" (modern prefix + new tail)', () => {
    const result = parseOracleText(
      'Whenever this creature deals combat damage to a player, that player exiles the top 5 cards of their library.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('ExileFromLibrary');
    if (eff.kind !== 'ExileFromLibrary') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toBe(5);
  });

  it('executes the exile-from-library effect and exiles from the DAMAGED player\'s library', () => {
    const master = makeCreature(
      'slc7-guild-master',
      'Guild Master Test',
      'Whenever this creature deals combat damage to a player, that player exiles the top 5 cards of their library.',
    );
    const island = makeLand('slc7-island-c', 'Island');

    // Give p2 enough library cards (20) to verify exactly 5 get exiled.
    const p2Cards: CardDefinition[] = [];
    for (let i = 0; i < 20; i++) {
      p2Cards.push(makeLand(`slc7-p2-island-${i}`, 'Island'));
    }

    let state = createTestGame([master, island, island], p2Cards);

    const masterInst = findCard(state, 'slc7-guild-master')!;
    state = moveToZone(state, masterInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, masterInst.instanceId);
    state = combatSetup(state);

    const p2LibBefore = countCardsInZone(state, 'p2', 'library');
    const p2ExileBefore = countCardsInZone(state, 'p2', 'graveyard'); // exile is counted separately in real game, but for this test use exile zone

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: masterInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    expect(state.pendingTriggers.some(t => t.ability.trigger.kind === 'CombatDamageToPlayer')).toBe(true);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // p2 should have 5 fewer cards in library.
    const p2LibAfter = countCardsInZone(state, 'p2', 'library');
    expect(p2LibAfter).toBe(p2LibBefore - 5);
  });
});

// ---------------------------------------------------------------------------
// Tail (c): "untap up to one target creature"
// ---------------------------------------------------------------------------

describe('Slice 7 — tail (c): matchUntapUpToOneTargetCreature', () => {
  it('parses "untap up to one target creature" to Untap{Chosen, minCount:0}', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, untap up to one target creature.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('Untap');
    if (eff.kind !== 'Untap') return;
    expect(eff.target.kind).toBe('Chosen');
    // One target spec with minCount 0 (optional).
    expect(result.targets.length).toBe(1);
    expect(result.targets[0].type).toBe('Creature');
    expect(result.targets[0].minCount).toBe(0);
    expect(result.targets[0].count).toBe(1);
  });

  it('parses "this creature deals combat damage ... untap up to one target creature" (modern wording)', () => {
    const result = parseOracleText(
      'Whenever this creature deals combat damage to a player, untap up to one target creature.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.effects[0].kind).toBe('Untap');
  });

  it('executes untap-up-to-one trigger and untaps the chosen creature', () => {
    // The attacker fires the trigger; we supply one tapped creature as the target.
    const winder = makeCreature(
      'slc7-winder',
      'Zephyr Winder Test',
      'Whenever this creature deals combat damage to a player, untap up to one target creature.',
    );
    const tapTarget = makeCreature('slc7-tap-target', 'Sleepy Creature', '');
    const island = makeLand('slc7-island-d', 'Island');

    let state = createTestGame([winder, tapTarget, island, island], [island]);

    const winderInst = findCard(state, 'slc7-winder')!;
    const tapTargetInst = findCard(state, 'slc7-tap-target')!;

    state = moveToZone(state, winderInst.instanceId, 'battlefield');
    state = moveToZone(state, tapTargetInst.instanceId, 'battlefield');
    // Manually tap the target creature.
    const tapCards = new Map(state.cards);
    tapCards.set(tapTargetInst.instanceId, { ...tapTargetInst, zone: 'battlefield', tapped: true, summoningSick: false });
    state = { ...state, cards: tapCards };

    state = registerBattlefieldAbilities(state, winderInst.instanceId);
    state = combatSetup(state);

    expect(state.cards.get(tapTargetInst.instanceId)!.tapped).toBe(true);

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: winderInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    expect(state.pendingTriggers.some(t => t.ability.trigger.kind === 'CombatDamageToPlayer')).toBe(true);

    // Resolve the trigger with tapTargetInst as the chosen target.
    const trigger = state.pendingTriggers.find(t => t.ability.trigger.kind === 'CombatDamageToPlayer')!;
    state = { ...state, pendingTriggers: [] };

    // Execute the untap effect directly with the chosen target.
    state = executeEffectsWithSBA(
      state,
      trigger.ability.effects,
      'p1',
      [tapTargetInst.instanceId],
      trigger.requiredTargets,
      0,
      { sourceInstanceId: winderInst.instanceId, eventContext: trigger.eventContext },
    );

    expect(state.cards.get(tapTargetInst.instanceId)!.tapped).toBe(false);
  });
});
