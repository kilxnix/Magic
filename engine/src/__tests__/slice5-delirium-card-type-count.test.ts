/**
 * Slice 5: Delirium card-type-count conditional static
 *
 * Tests that parseStaticCondition recognises and evaluateCondition evaluates:
 *   "there are four or more card types among cards in your graveyard"
 *   → CardTypesInGraveyardAtLeast { count: 4 }
 *
 * The ability-word dash prefix "Delirium —" is stripped by
 * matchConditionalStaticAbility before parseStaticCondition is called, so
 * the full oracle wording works end-to-end via the same path.
 *
 * Real oracle wordings tested:
 *   Thraben Foulbloods:
 *     "Delirium — This creature gets +1/+1 and has menace as long as there are
 *      four or more card types among cards in your graveyard."
 *   Inquisitor's Ox:
 *     "Delirium — This creature gets +1/+0 and has vigilance as long as there are
 *      four or more card types among cards in your graveyard."
 *   Gnarlwood Dryad:
 *     "Delirium — This creature has deathtouch as long as there are four or more
 *      card types among cards in your graveyard."
 *
 * Executor route: CardTypesInGraveyardAtLeast is evaluated in continuous.ts
 * evaluateCondition (new case added in slice 5) and mirrored in the executor
 * evaluateConditionForExecutor (also slice 5). No new subsystem required.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { instanceHasKeyword } from '../keywords';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition, GameState } from '../types';

// ---------------------------------------------------------------------------
// Card-definition helpers
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
    mana_cost: opts.mana_cost ?? '{2}',
    cmc: opts.cmc ?? 2,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeCard(
  id: string,
  cardTypes: string[],
  typeLine: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: typeLine,
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: cardTypes as CardDefinition['card_types'],
    power: undefined,
    toughness: undefined,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// State-setup helpers
// ---------------------------------------------------------------------------

/**
 * Build a two-player state. All cards start on battlefield so continuous
 * statics are registered, then callers can move cards to graveyard via
 * toGraveyard().
 */
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

/** Move a card instance to the graveyard zone. */
function toGraveyard(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) return state;
  const next = new Map(state.cards);
  next.set(instanceId, { ...card, zone: 'graveyard' });
  return { ...state, cards: next };
}

// ---------------------------------------------------------------------------
// PARSER tests
// ---------------------------------------------------------------------------

describe('Delirium card-type-count — parser recognition', () => {

  it('Thraben Foulbloods: suffix form with Delirium ability-word prefix parses correctly', () => {
    const r = parseOracleText(
      'Delirium — This creature gets +1/+1 and has menace as long as there are four or more card types among cards in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'CardTypesInGraveyardAtLeast', count: 4 });
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.selfOnly).toBe(true);
  });

  it("Inquisitor's Ox: suffix form (+1/+0 and vigilance) parses as CardTypesInGraveyardAtLeast", () => {
    const r = parseOracleText(
      "Delirium — This creature gets +1/+0 and has vigilance as long as there are four or more card types among cards in your graveyard.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'CardTypesInGraveyardAtLeast', count: 4 });
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 1, toughness: 0 });
  });

  it('Gnarlwood Dryad: keyword-only suffix form (deathtouch) parses as CardTypesInGraveyardAtLeast', () => {
    const r = parseOracleText(
      'Delirium — This creature has deathtouch as long as there are four or more card types among cards in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'CardTypesInGraveyardAtLeast', count: 4 });
    expect(r.ability.modifier).toMatchObject({ kind: 'GrantKeyword', keyword: 'deathtouch' });
    expect(r.ability.selfOnly).toBe(true);
  });

  it('prefix form: "As long as there are four or more card types among cards in your graveyard, ..." parses', () => {
    const r = parseOracleText(
      'Delirium — As long as there are four or more card types among cards in your graveyard, this creature gets +2/+2.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'CardTypesInGraveyardAtLeast', count: 4 });
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 2, toughness: 2 });
  });

  it('no ability-word prefix: bare "as long as there are four or more card types among cards in your graveyard" suffix form', () => {
    const r = parseOracleText(
      'This creature gets +1/+1 as long as there are four or more card types among cards in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'CardTypesInGraveyardAtLeast', count: 4 });
  });

  it('different count: "two or more card types among cards in your graveyard" parses with count 2', () => {
    const r = parseOracleText(
      'This creature has flying as long as there are two or more card types among cards in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'CardTypesInGraveyardAtLeast', count: 2 });
  });

  it('existing DistinctManaValues branch is not disturbed by new CardTypes branch', () => {
    const r = parseOracleText(
      'This creature gets +2/+2 as long as there are four or more mana values among cards in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'DistinctManaValuesInGraveyardAtLeast', count: 4 });
  });
});

// ---------------------------------------------------------------------------
// EXECUTION tests
// ---------------------------------------------------------------------------

describe('Delirium card-type-count — engine EXECUTES the condition gate', () => {

  it('Thraben Foulbloods: +1/+1 only while four distinct card types are in graveyard', () => {
    const foulbloods = creature('foulbloods', {
      name: 'Thraben Foulbloods',
      power: 3,
      toughness: 2,
      oracle_text:
        'Delirium — This creature gets +1/+1 and has menace as long as there are four or more card types among cards in your graveyard.',
    });
    // Cards to put in graveyard covering 4 distinct types: creature, instant, sorcery, land
    const creatureCard = makeCard('gy-creature', ['creature'], 'Creature — Test', { cmc: 1 });
    const instantCard = makeCard('gy-instant', ['instant'], 'Instant', { cmc: 1 });
    const sorceryCard = makeCard('gy-sorcery', ['sorcery'], 'Sorcery', { cmc: 2 });
    const landCard = makeCard('gy-land', ['land'], 'Land', { cmc: 0 });
    const artifactCard = makeCard('gy-artifact', ['artifact'], 'Artifact', { cmc: 3 });

    const { state: base, idFor } = setup(
      [foulbloods, creatureCard, instantCard, sorceryCard, landCard, artifactCard],
    );
    const fbId = idFor('foulbloods');

    // Baseline: nothing in graveyard — buff off
    expect(getEffectivePower(base, fbId)).toBe(3);
    expect(getEffectiveToughness(base, fbId)).toBe(2);

    // Add 3 types (creature, instant, sorcery) — still below threshold
    let s3 = toGraveyard(base, idFor('gy-creature'));
    s3 = toGraveyard(s3, idFor('gy-instant'));
    s3 = toGraveyard(s3, idFor('gy-sorcery'));
    expect(getEffectivePower(s3, fbId)).toBe(3);
    expect(getEffectiveToughness(s3, fbId)).toBe(2);

    // Add 4th type (land) — buff activates
    let s4 = toGraveyard(s3, idFor('gy-land'));
    expect(getEffectivePower(s4, fbId)).toBe(4);    // 3 + 1
    expect(getEffectiveToughness(s4, fbId)).toBe(3); // 2 + 1

    // Add a 5th type (artifact) — buff still active (>= 4 is enough)
    let s5 = toGraveyard(s4, idFor('gy-artifact'));
    expect(getEffectivePower(s5, fbId)).toBe(4);
    expect(getEffectiveToughness(s5, fbId)).toBe(3);
  });

  it("Gnarlwood Dryad: deathtouch keyword is granted only when 4+ card types are in graveyard", () => {
    const dryad = creature('dryad', {
      name: 'Gnarlwood Dryad',
      power: 1,
      toughness: 1,
      oracle_text:
        'Delirium — This creature has deathtouch as long as there are four or more card types among cards in your graveyard.',
    });
    const creatureCard = makeCard('gy2-creature', ['creature'], 'Creature — Test', { cmc: 1 });
    const instantCard = makeCard('gy2-instant', ['instant'], 'Instant', { cmc: 1 });
    const sorceryCard = makeCard('gy2-sorcery', ['sorcery'], 'Sorcery', { cmc: 2 });
    const enchantCard = makeCard('gy2-enchant', ['enchantment'], 'Enchantment', { cmc: 2 });

    const { state: base, idFor } = setup(
      [dryad, creatureCard, instantCard, sorceryCard, enchantCard],
    );
    const dryadId = idFor('dryad');

    // No graveyard cards — no deathtouch
    expect(instanceHasKeyword(base, dryadId, 'Deathtouch')).toBe(false);

    // 3 types in graveyard — still no deathtouch
    let s = toGraveyard(base, idFor('gy2-creature'));
    s = toGraveyard(s, idFor('gy2-instant'));
    s = toGraveyard(s, idFor('gy2-sorcery'));
    expect(instanceHasKeyword(s, dryadId, 'Deathtouch')).toBe(false);

    // 4th type (enchantment) — deathtouch now active
    s = toGraveyard(s, idFor('gy2-enchant'));
    expect(instanceHasKeyword(s, dryadId, 'Deathtouch')).toBe(true);
  });

  it('opponent graveyard does NOT count — only controller graveyard matters', () => {
    const foulbloods = creature('fb2', {
      name: 'Thraben Foulbloods',
      power: 3,
      toughness: 2,
      oracle_text:
        'Delirium — This creature gets +1/+1 and has menace as long as there are four or more card types among cards in your graveyard.',
    });
    // Cards owned by p2 covering 4 card types
    const oppCreature = makeCard('opp-creature', ['creature'], 'Creature — Test', { cmc: 1 });
    const oppInstant = makeCard('opp-instant', ['instant'], 'Instant', { cmc: 1 });
    const oppSorcery = makeCard('opp-sorcery', ['sorcery'], 'Sorcery', { cmc: 2 });
    const oppLand = makeCard('opp-land', ['land'], 'Land', { cmc: 0 });

    const { state: base, idFor } = setup(
      [foulbloods],
      [oppCreature, oppInstant, oppSorcery, oppLand],
    );
    const fbId = idFor('fb2');

    // Move all 4 opponent cards to the graveyard (they're owned by p2)
    let s = toGraveyard(base, idFor('opp-creature'));
    s = toGraveyard(s, idFor('opp-instant'));
    s = toGraveyard(s, idFor('opp-sorcery'));
    s = toGraveyard(s, idFor('opp-land'));

    // Buff must NOT activate — those are in p2's graveyard, not the controller's
    expect(getEffectivePower(s, fbId)).toBe(3);
    expect(getEffectiveToughness(s, fbId)).toBe(2);
  });
});
