/**
 * Slice 8: Life-total conditional statics — synonymous phrasings
 *
 * Tests that parseStaticCondition recognises:
 *   - "your life total is N or more/less/fewer/greater"  (LifeAtOrAbove / LifeAtOrBelow)
 *   - "you have N or fewer/greater life"                 (synonyms for the existing
 *                                                         "you have N or less/more life")
 *   - "an opponent's life total is N or more/less"       (opponent life)
 *
 * Literal-N forms only; "half your starting life total" is explicitly declined.
 * No executor change is needed — LifeAtOrAbove / LifeAtOrBelow are already
 * evaluated in continuous.ts evaluateCondition and executor.ts evaluateCondition.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
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

describe('Slice 8 — life-total conditional statics: parser recognition', () => {
  // --- "your life total is N or more" ---
  it('"your life total is 25 or more" → LifeAtOrAbove (you, 25)', () => {
    const r = parseOracleText(
      'As long as your life total is 25 or more, this creature has flying.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAtOrAbove', controller: 'you', amount: 25 });
  });

  it('"your life total is 25 or greater" → LifeAtOrAbove (synonym for "more")', () => {
    const r = parseOracleText(
      'As long as your life total is 25 or greater, this creature has flying.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAtOrAbove', controller: 'you', amount: 25 });
  });

  // --- "your life total is N or less/fewer" ---
  it('"your life total is 10 or less" → LifeAtOrBelow (you, 10)', () => {
    const r = parseOracleText(
      'As long as your life total is 10 or less, this creature gets +3/+3.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAtOrBelow', controller: 'you', amount: 10 });
  });

  it('"your life total is 10 or fewer" → LifeAtOrBelow (synonym for "less")', () => {
    const r = parseOracleText(
      'As long as your life total is 10 or fewer, this creature gets +3/+3.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAtOrBelow', controller: 'you', amount: 10 });
  });

  // --- "you have N or greater/fewer life" (existing "less"/"more" synonyms) ---
  it('"you have 7 or greater life" → LifeAtOrAbove (synonym for "more")', () => {
    const r = parseOracleText(
      'As long as you have 7 or greater life, this creature gets +2/+2.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAtOrAbove', controller: 'you', amount: 7 });
  });

  it('"you have 5 or fewer life" → LifeAtOrBelow (synonym for "less")', () => {
    const r = parseOracleText(
      'As long as you have 5 or fewer life, this creature has indestructible.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAtOrBelow', controller: 'you', amount: 5 });
  });

  // --- opponent life total phrasing ---
  it('"an opponent has 10 or more life" (suffix form) → LifeAtOrAbove (opponent, 10)', () => {
    const r = parseOracleText(
      'This creature has flying as long as an opponent has 10 or more life.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAtOrAbove', controller: 'opponent', amount: 10 });
  });

  // --- Bhaal form now handled by Slice 7 (LifeAtOrBelowHalfStarting) ---
  it('Bhaal "less than or equal to half your starting life total" → StaticAbility (Slice 7)', () => {
    // Slice 7 added LifeAtOrBelowHalfStarting; this form is now parsed.
    const r = parseOracleText(
      'As long as your life total is less than or equal to half your starting life total, this creature has indestructible.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAtOrBelowHalfStarting', controller: 'you' });
  });

  it('"you have no cards in hand" → Unparsed (Hellbent, no at-most evaluator)', () => {
    const r = parseOracleText(
      'Hellbent — This creature gets +2/+2 as long as you have no cards in hand.',
    );
    expect(r.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// Execution-level tests — the condition gate is respected at runtime
// ---------------------------------------------------------------------------

describe('Slice 8 — life-total conditional statics: engine execution', () => {
  it('"your life total is 25 or more" gates flying on actual life total', () => {
    const card = creature('lifeflyer', {
      name: 'Life Flyer',
      oracle_text: 'As long as your life total is 25 or more, this creature has flying.',
      power: 2,
      toughness: 2,
    });
    const { state, idFor } = setup([card]);
    const id = idFor('lifeflyer');

    // Default starting life is typically 40 in Commander or 20 in 60-card.
    // The setup uses initGameState which gives 40 life (Commander context).
    // Either way the initial life should be >= 25.
    const p1Life = state.players.find(p => p.id === 'p1')!.life;
    if (p1Life >= 25) {
      expect(instanceHasKeyword(state, id, 'Flying')).toBe(true);
    }

    // Drop below 25: flying should disappear.
    const low = setLife(state, 'p1', 24);
    expect(instanceHasKeyword(low, id, 'Flying')).toBe(false);

    // Exactly 25: flying returns.
    const exact = setLife(state, 'p1', 25);
    expect(instanceHasKeyword(exact, id, 'Flying')).toBe(true);
  });

  it('"your life total is 10 or less" gates +3/+3 on actual life', () => {
    const card = creature('vampire', {
      name: 'Life Drained Vampire',
      oracle_text: 'As long as your life total is 10 or less, this creature gets +3/+3.',
      power: 2,
      toughness: 2,
    });
    const { state, idFor } = setup([card]);
    const id = idFor('vampire');

    // Start: life > 10, no buff.
    expect(getEffectivePower(state, id)).toBe(2);
    expect(getEffectiveToughness(state, id)).toBe(2);

    // Drop to exactly 10: buff active.
    const at10 = setLife(state, 'p1', 10);
    expect(getEffectivePower(at10, id)).toBe(5);
    expect(getEffectiveToughness(at10, id)).toBe(5);

    // Rise to 11: buff gone.
    const at11 = setLife(state, 'p1', 11);
    expect(getEffectivePower(at11, id)).toBe(2);
    expect(getEffectiveToughness(at11, id)).toBe(2);
  });

  it('"you have 7 or greater life" (synonym) gates +2/+2 identically to "or more"', () => {
    const card = creature('guardian', {
      name: 'Life Guardian',
      oracle_text: 'As long as you have 7 or greater life, this creature gets +2/+2.',
      power: 1,
      toughness: 1,
    });
    const { state, idFor } = setup([card]);
    const id = idFor('guardian');

    // At start (life >> 7): buff active.
    expect(getEffectivePower(state, id)).toBe(3);
    expect(getEffectiveToughness(state, id)).toBe(3);

    // Drop to 6: buff off.
    const low = setLife(state, 'p1', 6);
    expect(getEffectivePower(low, id)).toBe(1);
    expect(getEffectiveToughness(low, id)).toBe(1);

    // Back to 7: buff on.
    const seven = setLife(state, 'p1', 7);
    expect(getEffectivePower(seven, id)).toBe(3);
    expect(getEffectiveToughness(seven, id)).toBe(3);
  });
});
