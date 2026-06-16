/**
 * Slice 7: Life-total-threshold-as-fraction-of-starting-life conditions
 *
 * Tests that parseStaticCondition recognises:
 *   - "your life total is less than or equal to half your starting life total"
 *     → LifeAtOrBelowHalfStarting (Bhaal / Myrkul family)
 *   - "your life total is greater than your starting life total"
 *     → LifeAboveStarting (Elenda, Saint of Dusk family)
 *
 * Both new conditions are evaluated in continuous.ts evaluateCondition and
 * executor.ts evaluateCondition using player.startingLife (defaults to 40).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getEffectivePower, getEffectiveToughness, evaluateCondition } from '../effects/continuous';
import { instanceHasKeyword } from '../keywords';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition, GameState } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function creature(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Test',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function setup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[] = [creature('dummy')],
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];
  let state = initGameState(decks);
  for (const [, card] of state.cards) {
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });
  }
  for (const card of state.cards.values()) {
    state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
  }
  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;
  return { state, idFor };
}

function setLife(state: GameState, playerId: string, life: number): GameState {
  return {
    ...state,
    players: state.players.map(p => (p.id === playerId ? { ...p, life } : p)),
  };
}

// ---------------------------------------------------------------------------
// Parse-level tests
// ---------------------------------------------------------------------------

describe('Slice 7 — life-fraction conditions: parser recognition', () => {
  // NOTE: parseOracleText is called directly here, so card names must use '~'
  // (the placeholder the engine uses after normalizeOracleText substitutes the
  // real card name). Production code goes through normalizeOracleText first.

  it('Bhaal (normalised): "~ has indestructible" with half-starting-life condition', () => {
    // After normalizeOracleText, "Bhaal" is replaced by "~".
    const r = parseOracleText(
      'As long as your life total is less than or equal to half your starting life total, ~ has indestructible.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAtOrBelowHalfStarting', controller: 'you' });
  });

  it('Myrkul (normalised): "~ has indestructible" with half-starting-life condition', () => {
    // Same normalised form as Bhaal.
    const r = parseOracleText(
      'As long as your life total is less than or equal to half your starting life total, ~ has indestructible.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAtOrBelowHalfStarting', controller: 'you' });
  });

  it('"this creature has indestructible" with half-starting-life condition → LifeAtOrBelowHalfStarting', () => {
    const r = parseOracleText(
      'As long as your life total is less than or equal to half your starting life total, this creature has indestructible.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAtOrBelowHalfStarting', controller: 'you' });
  });

  it('Elenda variant: "this creature has flying" with greater-than-starting-life condition → LifeAboveStarting', () => {
    const r = parseOracleText(
      'As long as your life total is greater than your starting life total, this creature has flying.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAboveStarting', controller: 'you' });
  });

  it('"~ has flying" with greater-than-starting-life condition → LifeAboveStarting', () => {
    // Normalised form of Elenda's self-referencing oracle text.
    const r = parseOracleText(
      'As long as your life total is greater than your starting life total, ~ has flying.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAboveStarting', controller: 'you' });
  });
});

// ---------------------------------------------------------------------------
// Execution-level tests — conditions gate abilities correctly at runtime
// ---------------------------------------------------------------------------

describe('Slice 7 — life-fraction conditions: engine execution', () => {
  it('LifeAtOrBelowHalfStarting: indestructible active at or below half starting life (20)', () => {
    // Use "this creature" form so parseOracleText works without name normalization.
    const card = creature('bhaal', {
      name: 'Bhaal, Lord of Murder',
      oracle_text:
        'As long as your life total is less than or equal to half your starting life total, this creature has indestructible.',
      power: 4,
      toughness: 4,
    });
    const { state, idFor } = setup([card]);
    const id = idFor('bhaal');

    // Default starting life = 40; half = 20.
    // At game start life == 40 → indestructible should NOT be active.
    expect(instanceHasKeyword(state, id, 'Indestructible')).toBe(false);

    // Drop to exactly 20 (half of 40): indestructible active.
    const at20 = setLife(state, 'p1', 20);
    expect(instanceHasKeyword(at20, id, 'Indestructible')).toBe(true);

    // Drop to 15 (below half): still active.
    const at15 = setLife(state, 'p1', 15);
    expect(instanceHasKeyword(at15, id, 'Indestructible')).toBe(true);

    // Rise to 21 (above half): inactive.
    const at21 = setLife(state, 'p1', 21);
    expect(instanceHasKeyword(at21, id, 'Indestructible')).toBe(false);
  });

  it('LifeAtOrBelowHalfStarting: respects different starting life values via evaluateCondition', () => {
    // Directly test evaluateCondition with a player whose startingLife is 20 (limited format).
    const baseState = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'none1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'none2' },
    ]);
    // Set p1 startingLife to 20, current life to 10 → should be at or below half (10).
    const state20 = {
      ...baseState,
      players: baseState.players.map(p =>
        p.id === 'p1' ? { ...p, life: 10, startingLife: 20 } : p,
      ),
    };
    const condition = { kind: 'LifeAtOrBelowHalfStarting' as const, controller: 'you' as const };
    expect(evaluateCondition(state20, condition, 'p1', undefined)).toBe(true);

    // At 11 life with startingLife 20 → above half (10): false.
    const state20High = {
      ...baseState,
      players: baseState.players.map(p =>
        p.id === 'p1' ? { ...p, life: 11, startingLife: 20 } : p,
      ),
    };
    expect(evaluateCondition(state20High, condition, 'p1', undefined)).toBe(false);
  });

  it('LifeAboveStarting: flying active only when life exceeds starting life (40)', () => {
    // Use "this creature" form so parseOracleText works without name normalization.
    const card = creature('elendavariant', {
      name: 'Elenda Variant',
      oracle_text:
        'As long as your life total is greater than your starting life total, this creature has flying.',
      power: 3,
      toughness: 3,
    });
    const { state, idFor } = setup([card]);
    const id = idFor('elendavariant');

    // Default starting life = 40; current life = 40 → NOT greater than → no flying.
    expect(instanceHasKeyword(state, id, 'Flying')).toBe(false);

    // Life drops to 39 → still not greater: no flying.
    const at39 = setLife(state, 'p1', 39);
    expect(instanceHasKeyword(at39, id, 'Flying')).toBe(false);

    // Life raised above 40 (e.g. gained life → 41): flying active.
    const at41 = setLife(state, 'p1', 41);
    expect(instanceHasKeyword(at41, id, 'Flying')).toBe(true);

    // At 50: still active.
    const at50 = setLife(state, 'p1', 50);
    expect(instanceHasKeyword(at50, id, 'Flying')).toBe(true);
  });
});
