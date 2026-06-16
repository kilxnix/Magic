/**
 * trg-cast-lifegain: executing tests for the trg-cast-lifegain family.
 *
 * Family conditions:
 *   - "Whenever you cast a spell, ..."                  (YouCastSpell)       [pre-existing, fires]
 *   - "Whenever you cast a noncreature spell, ..."      (CastNoncreatureSpell)[pre-existing, fires]
 *   - "Whenever you cast an instant or sorcery spell"   (CastInstantOrSorcery)[pre-existing, fires]
 *   - "Whenever you gain life, ..."                     (LifeGain)           [pre-existing, fires]
 *   - "Whenever you lose life, ..."                     (LifeLoss)           [NEW this round]
 *
 * The four cast/lifegain conditions already parsed AND fired before this round
 * (parser.ts matchTriggerPrefix + stack.ts SpellCast/LifeGained dispatch +
 * executor enqueueLifeGainTriggers). This round ADDS the LifeLoss condition
 * end-to-end:
 *   - ast.ts / types.ts: new { kind: 'LifeLoss' } Trigger variant
 *   - parser.ts: matchLifeLossPrefix wired into matchTriggerPrefix
 *   - executor.ts: executeLoseLife now calls enqueueLifeLossTriggers (mirrors
 *     LifeGain) so the engine actually fires "Whenever you lose life" abilities
 *   - stack.ts: LifeLost GameEvent + dispatch branch
 *
 * These tests EXECUTE: they register a battlefield ability, cause the event
 * (gain/lose life), put the trigger on the stack, resolve it, and assert the
 * effect actually happened.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState, getCardsInZone } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  registerBattlefieldAbilities,
} from '../stack';
import { executeEffects } from '../effects/executor';
import type { CardDefinition, GameState, CardInstance, Effect } from '../types';

function makeEnchantment(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Enchantment',
    oracle_text: oracleText,
    mana_cost: '{1}{B}',
    cmc: 2,
    colors: ['B'],
    color_identity: ['B'],
    keywords: [],
    card_types: ['enchantment'],
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

describe('trg-cast-lifegain parsing', () => {
  it('parses "Whenever you cast a spell, ..." => YouCastSpell', () => {
    const result = parseOracleText('Whenever you cast a spell, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'YouCastSpell' });
  });

  it('parses "Whenever you cast a noncreature spell, ..." => CastNoncreatureSpell', () => {
    const result = parseOracleText('Whenever you cast a noncreature spell, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CastNoncreatureSpell' });
  });

  it('parses "Whenever you cast an instant or sorcery spell, ..." => CastInstantOrSorcery', () => {
    const result = parseOracleText('Whenever you cast an instant or sorcery spell, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CastInstantOrSorcery' });
  });

  it('parses "Whenever you gain life, ..." => LifeGain', () => {
    const result = parseOracleText('Whenever you gain life, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'LifeGain' });
  });

  it('parses "Whenever you lose life, ..." => LifeLoss (NEW)', () => {
    const result = parseOracleText('Whenever you lose life, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'LifeLoss' });
  });
});

describe('trg-cast-lifegain execution: LifeGain (regression — pre-existing)', () => {
  it('fires "Whenever you gain life" and draws a card', () => {
    const payoff = makeEnchantment(
      'lg-payoff',
      'Life Gain Payoff',
      'Whenever you gain life, draw a card.',
    );

    let state = createTestGame([payoff, makeLand('lg-lib-1', 'Swamp'), makeLand('lg-lib-2', 'Swamp')], []);
    const inst = findCard(state, 'lg-payoff')!;
    state = moveToZone(state, inst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, inst.instanceId);

    const handBefore = countCardsInZone(state, 'p1', 'hand');
    const lifeBefore = state.players[0].life;

    // Cause p1 to gain life through the executor (emits the LifeGain event path).
    const effects: Effect[] = [
      { kind: 'GainLife', player: { kind: 'Controller' }, amount: 3 } as unknown as Effect,
    ];
    state = executeEffects(state, effects, 'p1', [], []);

    expect(state.players[0].life).toBe(lifeBefore + 3);
    expect(state.pendingTriggers.map(t => t.ability.trigger.kind)).toEqual(['LifeGain']);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    expect(countCardsInZone(state, 'p1', 'hand')).toBe(handBefore + 1);
  });
});

describe('trg-cast-lifegain execution: LifeLoss (NEW)', () => {
  it('fires "Whenever you lose life" and draws a card', () => {
    const payoff = makeEnchantment(
      'll-payoff',
      'Life Loss Payoff',
      'Whenever you lose life, draw a card.',
    );

    let state = createTestGame([payoff, makeLand('ll-lib-1', 'Swamp'), makeLand('ll-lib-2', 'Swamp')], []);
    const inst = findCard(state, 'll-payoff')!;
    state = moveToZone(state, inst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, inst.instanceId);

    const handBefore = countCardsInZone(state, 'p1', 'hand');
    const lifeBefore = state.players[0].life;

    // Cause p1 to lose life through the executor (emits the new LifeLoss path).
    const effects: Effect[] = [
      { kind: 'LoseLife', player: { kind: 'Controller' }, amount: 2 } as unknown as Effect,
    ];
    state = executeEffects(state, effects, 'p1', [], []);

    // Life actually decreased.
    expect(state.players[0].life).toBe(lifeBefore - 2);

    // The LifeLoss trigger should be pending.
    expect(state.pendingTriggers.map(t => t.ability.trigger.kind)).toEqual(['LifeLoss']);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // Effect actually ran: a card was drawn.
    expect(countCardsInZone(state, 'p1', 'hand')).toBe(handBefore + 1);
  });

  it('does NOT fire LifeLoss for a different player losing life', () => {
    const payoff = makeEnchantment(
      'll-payoff-2',
      'Life Loss Payoff 2',
      'Whenever you lose life, draw a card.',
    );

    let state = createTestGame([payoff], []);
    const inst = findCard(state, 'll-payoff-2')!;
    state = moveToZone(state, inst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, inst.instanceId);

    // p2 loses life — p1's "Whenever you lose life" must not trigger.
    const effects: Effect[] = [
      { kind: 'LoseLife', player: { kind: 'Player', playerId: 'p2' }, amount: 2 } as unknown as Effect,
    ];
    state = executeEffects(state, effects, 'p1', [], []);

    expect(state.pendingTriggers.map(t => t.ability.trigger.kind)).toEqual([]);
  });
});
