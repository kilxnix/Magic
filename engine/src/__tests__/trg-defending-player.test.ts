/**
 * trg-defending-player: parser and execution tests for Slice 6 —
 * "defending player" tails on attack/unblocked triggers.
 *
 * Family: "Whenever ~ attacks [alone / and isn't blocked], defending player
 *          discards a card / mills N cards / sacrifices a creature / loses N life"
 *
 * Parse tests verify the AST emitted, execution tests drive real GameState through
 * declareAttackers (and optionally declareBlockers) to assert the effect happened
 * on the DEFENDING player.
 *
 * Oracle examples used:
 *   Abyssal Nightstalker / Alley Grifters:
 *     "Whenever ~ attacks and isn't blocked, defending player discards a card."
 *   Flint Golem:
 *     "Whenever ~ attacks alone, defending player mills three cards."
 *   Nefarox, Overlord of Grixis:
 *     "Whenever ~ attacks alone, defending player sacrifices a creature."
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState, getCardsInZone } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  registerBattlefieldAbilities,
} from '../stack';
import { declareAttackers, declareBlockers } from '../combat';
import type { CardDefinition, GameState, CardInstance } from '../types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCreature(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature - Test',
    oracle_text: oracleText,
    mana_cost: '{2}{B}',
    cmc: 3,
    colors: ['B'],
    color_identity: ['B'],
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
    type_line: 'Basic Land - Swamp',
    oracle_text: '{T}: Add {B}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['B'],
    keywords: [],
    card_types: ['land'],
  };
}

/** A vanilla creature used as a sacrifice target for the defending player. */
function makeVanilla(id: string): CardDefinition {
  return {
    id,
    name: 'Vanilla Creature',
    type_line: 'Creature - Test',
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    power: 1,
    toughness: 1,
    card_types: ['creature'],
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
  return getCardsInZone(state, playerId, 'hand').length;
}

function librarySize(state: GameState, playerId: string): number {
  return getCardsInZone(state, playerId, 'library').length;
}

function graveyardSize(state: GameState, playerId: string): number {
  return getCardsInZone(state, playerId, 'graveyard').length;
}

function setupCombat(state: GameState): GameState {
  return { ...state, activePlayerIndex: 0, phase: 'combat' as any, step: 'declare_attackers' as any };
}

// ---------------------------------------------------------------------------
// Parse tests
// ---------------------------------------------------------------------------

describe('trg-defending-player — parsing', () => {
  it('parses "Whenever ~ attacks and isn\'t blocked, defending player discards a card" (Alley Grifters)', () => {
    const result = parseOracleText(
      "Whenever ~ attacks and isn't blocked, defending player discards a card.",
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('Unblocked');
    const effect = result.ability.effects[0];
    expect(effect.kind).toBe('Discard');
    if (effect.kind !== 'Discard') return;
    expect(effect.player).toEqual({ kind: 'EventPlayer' });
    expect(effect.count).toBe(1);
  });

  it('parses "Whenever ~ attacks alone, defending player mills three cards" (Flint Golem)', () => {
    const result = parseOracleText(
      'Whenever ~ attacks alone, defending player mills three cards.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('Attacks');
    const effect = result.ability.effects[0];
    expect(effect.kind).toBe('Mill');
    if (effect.kind !== 'Mill') return;
    expect(effect.player).toEqual({ kind: 'EventPlayer' });
    expect(effect.count).toBe(3);
  });

  it('parses "Whenever ~ attacks alone, defending player sacrifices a creature" (Nefarox)', () => {
    const result = parseOracleText(
      'Whenever ~ attacks alone, defending player sacrifices a creature.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('Attacks');
    const effect = result.ability.effects[0];
    expect(effect.kind).toBe('Sacrifice');
    if (effect.kind !== 'Sacrifice') return;
    expect(effect.player).toEqual({ kind: 'EventPlayer' });
    expect(effect.filter).toEqual({ types: ['creature'] });
  });

  it('parses "Whenever ~ attacks, defending player loses 1 life"', () => {
    const result = parseOracleText('Whenever ~ attacks, defending player loses 1 life.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('Attacks');
    const effect = result.ability.effects[0];
    expect(effect.kind).toBe('LoseLife');
    if (effect.kind !== 'LoseLife') return;
    expect(effect.player).toEqual({ kind: 'EventPlayer' });
    expect(effect.amount).toBe(1);
  });

  it('parses "Whenever ~ attacks, defending player discards a card" (plain attacks prefix)', () => {
    const result = parseOracleText(
      'Whenever ~ attacks, defending player discards a card.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('Attacks');
    const effect = result.ability.effects[0];
    expect(effect.kind).toBe('Discard');
    if (effect.kind !== 'Discard') return;
    expect(effect.player).toEqual({ kind: 'EventPlayer' });
  });
});

// ---------------------------------------------------------------------------
// Execution tests
// ---------------------------------------------------------------------------

describe('trg-defending-player — execution', () => {
  it('"defending player discards a card" targets the DEFENDING player (p2)', () => {
    // Abyssal Nightstalker / Alley Grifters family: fires on Unblocked trigger
    // Use simple "attacks" wording to avoid needing blockers declared step
    const attacker = makeCreature(
      'dp-discard',
      'Shadow Attacker',
      'Whenever ~ attacks, defending player discards a card.',
    );
    const p2card = makeLand('p2l1', 'Swamp');
    let state = createTestGame(
      [attacker, makeLand('l1', 'Swamp')],
      [p2card, makeLand('l2', 'Swamp'), makeLand('l3', 'Swamp')],
    );
    const inst = findCard(state, 'dp-discard');
    state = moveToBattlefield(state, inst.instanceId);
    state = registerBattlefieldAbilities(state, inst.instanceId);
    state = setupCombat(state);

    const p1HandBefore = handSize(state, 'p1');
    const p2HandBefore = handSize(state, 'p2');

    state = declareAttackers(state, 'p1', [{ cardInstanceId: inst.instanceId, defendingPlayerId: 'p2' }]);
    expect(state.pendingTriggers.length).toBeGreaterThanOrEqual(1);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // p1 hand must NOT change — only p2 discards
    expect(handSize(state, 'p1')).toBe(p1HandBefore);
    // p2 discards 1 card
    expect(handSize(state, 'p2')).toBe(Math.max(0, p2HandBefore - 1));
  });

  it('"defending player mills three cards" mills the DEFENDING player (Flint Golem family)', () => {
    const attacker = makeCreature(
      'dp-mill',
      'Flint Golem',
      'Whenever ~ attacks alone, defending player mills three cards.',
    );
    // Give p2 extra cards in library so we can observe milling
    const extra = [makeLand('x1', 'L'), makeLand('x2', 'L'), makeLand('x3', 'L'), makeLand('x4', 'L')];
    let state = createTestGame(
      [attacker, makeLand('l1', 'Swamp')],
      extra,
    );
    const inst = findCard(state, 'dp-mill');
    state = moveToBattlefield(state, inst.instanceId);
    state = registerBattlefieldAbilities(state, inst.instanceId);
    state = setupCombat(state);

    const p2LibBefore = librarySize(state, 'p2');
    const p2GYBefore = graveyardSize(state, 'p2');

    state = declareAttackers(state, 'p1', [{ cardInstanceId: inst.instanceId, defendingPlayerId: 'p2' }]);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // p2 should have 3 fewer library cards (milled to graveyard)
    expect(librarySize(state, 'p2')).toBe(Math.max(0, p2LibBefore - 3));
    expect(graveyardSize(state, 'p2')).toBe(p2GYBefore + Math.min(3, p2LibBefore));
  });

  it('"defending player sacrifices a creature" causes p2 to sacrifice (Nefarox family)', () => {
    const attacker = makeCreature(
      'dp-sac',
      'Nefarox',
      'Whenever ~ attacks alone, defending player sacrifices a creature.',
    );
    const p2creature = makeVanilla('p2crt');
    let state = createTestGame(
      [attacker, makeLand('al1', 'Swamp')],
      [p2creature, makeLand('bl1', 'Swamp')],
    );
    const inst = findCard(state, 'dp-sac');
    const p2crt = findCard(state, 'p2crt');
    state = moveToBattlefield(state, inst.instanceId);
    state = moveToBattlefield(state, p2crt.instanceId);
    state = registerBattlefieldAbilities(state, inst.instanceId);
    state = setupCombat(state);

    const p2BFBefore = [...state.cards.values()].filter(
      c => c.ownerId === 'p2' && c.zone === 'battlefield',
    ).length;
    const p2GYBefore = graveyardSize(state, 'p2');

    state = declareAttackers(state, 'p1', [{ cardInstanceId: inst.instanceId, defendingPlayerId: 'p2' }]);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const p2BFAfter = [...state.cards.values()].filter(
      c => c.ownerId === 'p2' && c.zone === 'battlefield',
    ).length;
    // p2 must have one fewer battlefield permanent (the creature was sacrificed)
    expect(p2BFAfter).toBe(p2BFBefore - 1);
    expect(graveyardSize(state, 'p2')).toBe(p2GYBefore + 1);
  });
});
