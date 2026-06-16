/**
 * Slice 9/11: Self-static pump with this-turn / count conditions.
 *
 * Tests that parseStaticCondition recognises and evaluateCondition evaluates:
 *   - "you've cast N or more spells this turn"  → SpellsCastThisTurnAtLeast
 *   - "you control no untapped lands"            → ControlsNone { filter: { types:['land'], tapped:false } }
 *   - "there are N or more mana values among cards in your graveyard"
 *                                                → DistinctManaValuesInGraveyardAtLeast
 *
 * Real oracle wordings from:
 *   Brightspear Zealot: "This creature gets +2/+0 as long as you've cast two or more spells this turn."
 *   Spur Grappler:      "This creature gets +2/+1 as long as you control no untapped lands."
 *   Syndicate Infiltrator: "As long as there are five or more mana values among cards in your graveyard,
 *                           this creature gets +2/+2."
 *
 * NOTE: "you've committed a crime this turn" (Slickshot Vault-Buster) is NOT claimed
 * because there is no per-controller crime tracker in the engine state — the face
 * correctly stays Unparsed (honesty constraint).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getEffectivePower, getEffectiveToughness, evaluateCondition } from '../effects/continuous';
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

function land(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Land',
    oracle_text: opts.oracle_text ?? '{T}: Add {C}.',
    mana_cost: opts.mana_cost ?? null as unknown as string,
    cmc: opts.cmc ?? 0,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['land'],
    power: undefined,
    toughness: undefined,
  };
}

function spell(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Instant',
    oracle_text: opts.oracle_text ?? 'Draw a card.',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['instant'],
    power: undefined,
    toughness: undefined,
  };
}

/** Build a two-player state with all cards on the battlefield. */
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

/** Move a card to graveyard by instance ID. */
function toGraveyard(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) return state;
  const next = new Map(state.cards);
  next.set(instanceId, { ...card, zone: 'graveyard' });
  return { ...state, cards: next };
}

/** Mark a card tapped by instance ID. */
function tapCard(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) return state;
  const next = new Map(state.cards);
  next.set(instanceId, { ...card, tapped: true });
  return { ...state, cards: next };
}

// ---------------------------------------------------------------------------
// PARSER tests
// ---------------------------------------------------------------------------

describe('Slice 9/11 — self-static pump conditions: parser recognition', () => {

  // --- SpellsCastThisTurnAtLeast ---

  it('Brightspear Zealot (prefix form) → SpellsCastThisTurnAtLeast { count: 2 }', () => {
    const r = parseOracleText(
      "This creature gets +2/+0 as long as you've cast two or more spells this turn.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'SpellsCastThisTurnAtLeast', count: 2 });
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 2, toughness: 0 });
  });

  it('"as long as you\'ve cast three or more spells this turn" → SpellsCastThisTurnAtLeast { count: 3 }', () => {
    const r = parseOracleText(
      "This creature gets +1/+1 as long as you've cast three or more spells this turn.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'SpellsCastThisTurnAtLeast', count: 3 });
  });

  it('prefix form "As long as you\'ve cast two or more spells this turn, ..." also works', () => {
    const r = parseOracleText(
      "As long as you've cast two or more spells this turn, this creature gets +2/+2.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'SpellsCastThisTurnAtLeast', count: 2 });
  });

  // --- ControlsNone with untapped lands ---

  it('Spur Grappler → ControlsNone { filter: { types: ["land"], tapped: false } }', () => {
    const r = parseOracleText(
      'This creature gets +2/+1 as long as you control no untapped lands.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({
      kind: 'ControlsNone',
      controller: 'you',
      filter: { types: ['land'], tapped: false },
    });
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 2, toughness: 1 });
  });

  it('prefix form "As long as you control no untapped lands, ..." also parses', () => {
    const r = parseOracleText(
      'As long as you control no untapped lands, this creature gets +3/+0.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({
      kind: 'ControlsNone',
      controller: 'you',
      filter: { types: ['land'], tapped: false },
    });
  });

  // --- DistinctManaValuesInGraveyardAtLeast ---

  it('Syndicate Infiltrator → DistinctManaValuesInGraveyardAtLeast { count: 5 }', () => {
    const r = parseOracleText(
      'As long as there are five or more mana values among cards in your graveyard, this creature gets +2/+2.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'DistinctManaValuesInGraveyardAtLeast', count: 5 });
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 2, toughness: 2 });
  });

  it('"there are three or more mana values among cards in your graveyard" → DistinctManaValuesInGraveyardAtLeast { count: 3 }', () => {
    const r = parseOracleText(
      'This creature gets +1/+1 as long as there are three or more mana values among cards in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'DistinctManaValuesInGraveyardAtLeast', count: 3 });
  });

  it('"there are four or more mana values among cards in your graveyard" suffix form', () => {
    const r = parseOracleText(
      'As long as there are four or more mana values among cards in your graveyard, this creature has flying.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'DistinctManaValuesInGraveyardAtLeast', count: 4 });
  });

  // Plain "there are N or more cards in your graveyard" must still work (regression)
  it('"there are seven or more cards in your graveyard" → CardsInZoneAtLeast (regression)', () => {
    const r = parseOracleText(
      'As long as there are seven or more cards in your graveyard, this creature has trample.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({
      kind: 'CardsInZoneAtLeast',
      controller: 'you',
      zone: 'graveyard',
      count: 7,
    });
  });

  // --- Honesty: crime-this-turn NOT claimed ---

  it('Slickshot Vault-Buster "committed a crime this turn" → Unparsed (no crime tracker)', () => {
    const r = parseOracleText(
      "Slickshot Vault-Buster gets +2/+0 as long as you've committed a crime this turn.",
    );
    // Engine has no crime-this-turn tracker: the condition is unsupported → Unparsed.
    expect(r.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// EXECUTION tests
// ---------------------------------------------------------------------------

describe('Slice 9/11 — self-static pump conditions: engine execution', () => {

  // ── SpellsCastThisTurnAtLeast ──────────────────────────────────────────────

  it('Brightspear Zealot: +2/+0 only when spellsCastThisTurn >= 2', () => {
    const brightspear = creature('brightspear', {
      name: 'Brightspear Zealot',
      oracle_text: "This creature gets +2/+0 as long as you've cast two or more spells this turn.",
      power: 2,
      toughness: 2,
    });
    const { state, idFor } = setup([brightspear]);
    const id = idFor('brightspear');

    // 0 spells cast: no buff
    const s0 = { ...state, spellsCastThisTurn: 0 };
    expect(getEffectivePower(s0, id)).toBe(2);
    expect(getEffectiveToughness(s0, id)).toBe(2);

    // 1 spell cast: no buff (need 2+)
    const s1 = { ...state, spellsCastThisTurn: 1 };
    expect(getEffectivePower(s1, id)).toBe(2);

    // 2 spells cast: buff active → power becomes 4
    const s2 = { ...state, spellsCastThisTurn: 2 };
    expect(getEffectivePower(s2, id)).toBe(4);
    expect(getEffectiveToughness(s2, id)).toBe(2); // toughness unchanged

    // 5 spells cast: still buffed
    const s5 = { ...state, spellsCastThisTurn: 5 };
    expect(getEffectivePower(s5, id)).toBe(4);
  });

  // ── ControlsNone (untapped lands) ─────────────────────────────────────────

  it('Spur Grappler: +2/+1 only when you control no untapped lands', () => {
    const spur = creature('spur', {
      name: 'Spur Grappler',
      oracle_text: 'This creature gets +2/+1 as long as you control no untapped lands.',
      power: 2,
      toughness: 2,
    });
    const testLand = land('testland', { name: 'Test Land' });
    const { state, idFor } = setup([spur, testLand]);
    const spurId = idFor('spur');
    const landId = idFor('testland');

    // Land is untapped by default after setup (battlefield entry untaps it).
    // With at least one untapped land, the condition is false → no buff.
    expect(getEffectivePower(state, spurId)).toBe(2);
    expect(getEffectiveToughness(state, spurId)).toBe(2);

    // Tap the land → now you control no untapped lands → buff active
    const tapped = tapCard(state, landId);
    expect(getEffectivePower(tapped, spurId)).toBe(4);
    expect(getEffectiveToughness(tapped, spurId)).toBe(3);

    // Untap the land again (simulate by using original state with untapped land)
    expect(getEffectivePower(state, spurId)).toBe(2);
  });

  it('Spur Grappler: buff active when there are no lands at all', () => {
    const spur = creature('spur2', {
      name: 'Spur Grappler',
      oracle_text: 'This creature gets +2/+1 as long as you control no untapped lands.',
      power: 1,
      toughness: 1,
    });
    const { state, idFor } = setup([spur]);
    const spurId = idFor('spur2');
    // No lands at all → "you control no untapped lands" is trivially true → buff active
    expect(getEffectivePower(state, spurId)).toBe(3);
    expect(getEffectiveToughness(state, spurId)).toBe(2);
  });

  // ── DistinctManaValuesInGraveyardAtLeast ──────────────────────────────────

  it('Syndicate Infiltrator: +2/+2 when 5+ distinct mana values in your graveyard', () => {
    const syndicate = creature('syndicate', {
      name: 'Syndicate Infiltrator',
      oracle_text: 'As long as there are five or more mana values among cards in your graveyard, this creature gets +2/+2.',
      power: 2,
      toughness: 2,
    });
    // Five spells with distinct CMCs: 0, 1, 2, 3, 4
    const sp0 = spell('sp0', { name: 'Sp0', cmc: 0, mana_cost: '' });
    const sp1 = spell('sp1', { name: 'Sp1', cmc: 1, mana_cost: '{1}' });
    const sp2 = spell('sp2', { name: 'Sp2', cmc: 2, mana_cost: '{2}' });
    const sp3 = spell('sp3', { name: 'Sp3', cmc: 3, mana_cost: '{3}' });
    const sp4 = spell('sp4', { name: 'Sp4', cmc: 4, mana_cost: '{4}' });
    const { state, idFor } = setup([syndicate, sp0, sp1, sp2, sp3, sp4]);
    const synId = idFor('syndicate');

    // All on battlefield: 0 graveyard cards → no buff
    expect(getEffectivePower(state, synId)).toBe(2);
    expect(getEffectiveToughness(state, synId)).toBe(2);

    // Move 4 to graveyard: 4 distinct CMCs → still no buff (need 5)
    let s = toGraveyard(state, idFor('sp0'));
    s = toGraveyard(s, idFor('sp1'));
    s = toGraveyard(s, idFor('sp2'));
    s = toGraveyard(s, idFor('sp3'));
    expect(getEffectivePower(s, synId)).toBe(2);

    // Move 5th to graveyard: 5 distinct CMCs → buff active
    s = toGraveyard(s, idFor('sp4'));
    expect(getEffectivePower(s, synId)).toBe(4);
    expect(getEffectiveToughness(s, synId)).toBe(4);
  });

  it('DistinctManaValuesInGraveyardAtLeast: duplicate CMCs do not double-count', () => {
    const syndicate = creature('syndicate2', {
      name: 'Syndicate Infiltrator',
      oracle_text: 'As long as there are five or more mana values among cards in your graveyard, this creature gets +2/+2.',
      power: 1,
      toughness: 1,
    });
    // Five cards but only 2 distinct CMCs (0 and 1)
    const sp0a = spell('sp0a', { name: 'Sp0a', cmc: 0, mana_cost: '' });
    const sp0b = spell('sp0b', { name: 'Sp0b', cmc: 0, mana_cost: '' });
    const sp0c = spell('sp0c', { name: 'Sp0c', cmc: 0, mana_cost: '' });
    const sp1a = spell('sp1a', { name: 'Sp1a', cmc: 1, mana_cost: '{1}' });
    const sp1b = spell('sp1b', { name: 'Sp1b', cmc: 1, mana_cost: '{1}' });
    const { state, idFor } = setup([syndicate, sp0a, sp0b, sp0c, sp1a, sp1b]);
    const synId = idFor('syndicate2');

    let s = toGraveyard(state, idFor('sp0a'));
    s = toGraveyard(s, idFor('sp0b'));
    s = toGraveyard(s, idFor('sp0c'));
    s = toGraveyard(s, idFor('sp1a'));
    s = toGraveyard(s, idFor('sp1b'));

    // 5 cards but only 2 distinct CMCs → NO buff (need 5 distinct)
    expect(getEffectivePower(s, synId)).toBe(1);
    expect(getEffectiveToughness(s, synId)).toBe(1);
  });

  // ── evaluateCondition unit tests ───────────────────────────────────────────

  it('evaluateCondition SpellsCastThisTurnAtLeast returns true when count met', () => {
    const baseState = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'none1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'none2' },
    ]);

    const cond = { kind: 'SpellsCastThisTurnAtLeast' as const, count: 2 };
    expect(evaluateCondition({ ...baseState, spellsCastThisTurn: 0 }, cond, 'p1')).toBe(false);
    expect(evaluateCondition({ ...baseState, spellsCastThisTurn: 1 }, cond, 'p1')).toBe(false);
    expect(evaluateCondition({ ...baseState, spellsCastThisTurn: 2 }, cond, 'p1')).toBe(true);
    expect(evaluateCondition({ ...baseState, spellsCastThisTurn: 10 }, cond, 'p1')).toBe(true);
  });

  it('evaluateCondition DistinctManaValuesInGraveyardAtLeast counts distinct CMCs', () => {
    const baseState = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [
        spell('gv0', { name: 'Gv0', cmc: 0 }),
        spell('gv1', { name: 'Gv1', cmc: 1 }),
        spell('gv2', { name: 'Gv2', cmc: 2 }),
      ], commanderId: 'none1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'none2' },
    ]);

    // Move all to graveyard
    let s = { ...baseState, cards: new Map(baseState.cards) };
    for (const [, card] of s.cards) {
      if (card.ownerId === 'p1') {
        s.cards.set(card.instanceId, { ...card, zone: 'graveyard' });
      }
    }

    const cond3 = { kind: 'DistinctManaValuesInGraveyardAtLeast' as const, count: 3 };
    const cond4 = { kind: 'DistinctManaValuesInGraveyardAtLeast' as const, count: 4 };
    expect(evaluateCondition(s, cond3, 'p1')).toBe(true);   // 0,1,2 → 3 distinct → true
    expect(evaluateCondition(s, cond4, 'p1')).toBe(false);  // only 3 distinct → false
  });
});
