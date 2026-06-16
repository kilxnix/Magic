// Slice 7/12: Enter-As-Copy scope extension
//
// New source variant:
//   (A) "another creature you control" — anotherCreatureYouControl (Sakashima of a Thousand Faces)
//
// New rider absorptions (honest-skip — base EnterAsCopy still fires):
//   (B) "except it doesn't copy ..." — Vesuvan Doppelganger
//   (C) "except if <condition>, ..." — Vizier of Many Faces embalmed conditional
//   (D) "except it's a <type> <type> with <clause>" (bare, no "in addition to its other types")
//       — Imposter Mech ("except it's a Vehicle artifact with crew 3")
//
// Parser tests verify effect kind and sourceVariant / absorption.
// Executor tests verify anotherCreatureYouControl filters correctly.

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, EnterAsCopyEffect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Minimal test-state factory
// ---------------------------------------------------------------------------

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  // The entering permanent (Sakashima or clone).
  cards.set('entering', {
    instanceId: 'entering',
    definitionId: 'def-entering',
    ownerId: 'p1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: true,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set('def-entering', {
    id: 'def-entering',
    name: 'Sakashima of a Thousand Faces',
    type_line: 'Legendary Creature — Human Rogue',
    oracle_text: '',
    mana_cost: '{3}{U}',
    cmc: 4,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    power: 3,
    toughness: 1,
    card_types: ['creature'],
  });

  // Own creature (p1) — valid copy target for anotherCreatureYouControl.
  cards.set('own-creature', {
    instanceId: 'own-creature',
    definitionId: 'def-own-creature',
    ownerId: 'p1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set('def-own-creature', {
    id: 'def-own-creature',
    name: 'Consecrated Sphinx',
    type_line: 'Legendary Creature — Sphinx',
    oracle_text: 'Flying.',
    mana_cost: '{4}{U}{U}',
    cmc: 6,
    colors: ['U'],
    color_identity: ['U'],
    keywords: ['Flying'],
    power: 4,
    toughness: 6,
    card_types: ['creature'],
  });

  // Own artifact (p1) — should NOT be a valid candidate for "another creature you control".
  cards.set('own-artifact', {
    instanceId: 'own-artifact',
    definitionId: 'def-own-artifact',
    ownerId: 'p1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set('def-own-artifact', {
    id: 'def-own-artifact',
    name: 'Sol Ring',
    type_line: 'Artifact',
    oracle_text: '{T}: Add {C}{C}.',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    power: 0,
    toughness: 0,
    card_types: ['artifact'],
  });

  // Opponent's creature (p2) — must NOT be selected for anotherCreatureYouControl.
  cards.set('opp-creature', {
    instanceId: 'opp-creature',
    definitionId: 'def-opp-creature',
    ownerId: 'p2',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set('def-opp-creature', {
    id: 'def-opp-creature',
    name: 'Serra Angel',
    type_line: 'Creature — Angel',
    oracle_text: 'Flying, vigilance.',
    mana_cost: '{3}{W}{W}',
    cmc: 5,
    colors: ['W'],
    color_identity: ['W'],
    keywords: ['Flying', 'Vigilance'],
    power: 4,
    toughness: 4,
    card_types: ['creature'],
  });

  const players = [
    {
      id: 'p1',
      name: 'Player 1',
      life: 40,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      hasPlayedLand: false,
      hand: [],
      library: [],
      graveyard: [],
      commandZone: [],
      hasLost: false,
      commanderDamage: {},
      counters: {},
    },
    {
      id: 'p2',
      name: 'Player 2',
      life: 40,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      hasPlayedLand: false,
      hand: [],
      library: [],
      graveyard: [],
      commandZone: [],
      hasLost: false,
      commanderDamage: {},
      counters: {},
    },
  ];

  return {
    cards,
    cardDefinitions,
    players,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    turnNumber: 1,
    phase: 'precombat_main',
    step: 'begin_combat',
    stack: [],
    pendingTriggers: [],
    attackers: [],
    blockers: [],
    pendingDamage: [],
  } as unknown as GameState;
}

// Helper: extract first EnterAsCopyEffect from a Spell parse result, or null.
function firstEnterAsCopy(oracle: string): EnterAsCopyEffect | null {
  const result = parseOracleText(oracle);
  if (result.kind !== 'Spell') return null;
  const eff = result.effects.find(e => e.kind === 'EnterAsCopy');
  return eff ? (eff as EnterAsCopyEffect) : null;
}

// ===========================================================================
// (A) "another creature you control" — anotherCreatureYouControl
//     Sakashima of a Thousand Faces
// ===========================================================================

describe('matchEnterAsCopy — anotherCreatureYouControl (Sakashima of a Thousand Faces)', () => {

  it('(A1) parses Sakashima of a Thousand Faces oracle text: "another creature you control"', () => {
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of another creature you control, except it isn't legendary.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.sourceVariant).toBe('anotherCreatureYouControl');
    // The "except it isn't legendary" rider should be parsed normally.
    expect(eff!.nonLegendary).toBe(true);
  });

  it('(A2) parses "another creature you control" without any rider', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of another creature you control.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.sourceVariant).toBe('anotherCreatureYouControl');
    expect(eff!.nonLegendary).toBeUndefined();
  });

  it('(A3) anotherCreatureYouControl with name rider', () => {
    // Compound: another creature you control + name override
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of another creature you control, except its name is ~.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('anotherCreatureYouControl');
    expect(eff!.nameOverride).toBe('~');
  });
});

// ===========================================================================
// (A-exec) Executor: anotherCreatureYouControl — only copies own creatures, not self
// ===========================================================================

describe('executeEnterAsCopy — anotherCreatureYouControl (executor)', () => {

  it('(A-exec-1) copies a creature p1 controls, not the opponent creature', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      sourceVariant: 'anotherCreatureYouControl',
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Should have copied own-creature (p1 creature), NOT opp-creature.
    expect(card.definitionId).toBe('def-own-creature');
    expect(card.ownerId).toBe('p1');
  });

  it('(A-exec-2) does not copy non-creature artifacts even if controller matches', () => {
    // Remove opp-creature; only own-artifact and entering remain besides own-creature.
    const state = makeState();
    const noOpp: GameState = {
      ...state,
      cards: new Map([...state.cards.entries()].filter(([id]) => id !== 'opp-creature')),
    };
    const effect: Effect = {
      kind: 'EnterAsCopy',
      sourceVariant: 'anotherCreatureYouControl',
    };

    const newState = executeEffects(
      noOpp, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Sol Ring (own-artifact) must NOT be chosen — only own-creature is valid.
    expect(card.definitionId).toBe('def-own-creature');
  });

  it('(A-exec-3) stays as itself when no other creature exists for controller', () => {
    // Only the entering permanent and the opponent creature remain.
    const state = makeState();
    const isolated: GameState = {
      ...state,
      cards: new Map(
        [...state.cards.entries()].filter(([id]) => id === 'entering' || id === 'opp-creature'),
      ),
    };
    const effect: Effect = {
      kind: 'EnterAsCopy',
      sourceVariant: 'anotherCreatureYouControl',
    };

    const newState = executeEffects(
      isolated, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // No valid p1 creature — entering permanent stays as itself.
    expect(card.definitionId).toBe('def-entering');
  });
});

// ===========================================================================
// (B) "except it doesn't copy ..." — absorbed silently (Vesuvan Doppelganger)
// ===========================================================================

describe("matchEnterAsCopy — 'except it doesn't copy' absorbed (Vesuvan Doppelganger)", () => {

  it("(B1) parses Vesuvan Doppelganger oracle text — 'except it doesn't copy' absorbed silently", () => {
    // Vesuvan Doppelganger real oracle wording (simplified):
    // "You may have this creature enter as a copy of any creature on the battlefield, except
    //  it doesn't copy that creature's color and it has this ability."
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of any creature on the battlefield, except it doesn't copy that creature's color and it has this ability.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    // Default battlefield scope.
    expect(eff!.sourceVariant ?? 'battlefield').toBe('battlefield');
    // The rider is absorbed — no addedKeywords or other rider fields set.
    expect(eff!.addedKeywords).toBeUndefined();
    expect(eff!.additionalTypes).toBeUndefined();
  });

  it("(B2) bare 'except it doesn't copy' without trailing clause still absorbed", () => {
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of any creature on the battlefield, except it doesn't copy that creature's power and toughness.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
  });
});

// ===========================================================================
// (C) "except if <condition>, ..." — absorbed silently (Vizier embalmed form)
// ===========================================================================

describe("matchEnterAsCopy — 'except if' conditional rider absorbed (Vizier of Many Faces embalmed)", () => {

  it("(C1) parses Vizier of Many Faces embalmed-conditional rider — absorbed silently", () => {
    // Vizier embalmed oracle: "You may have this creature enter as a copy of any creature on the
    // battlefield, except if this creature was embalmed, it isn't legendary and it's a Zombie
    // in addition to its other types."
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of any creature on the battlefield, except if this creature was embalmed, it isn't legendary and it's a Zombie in addition to its other types.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.sourceVariant ?? 'battlefield').toBe('battlefield');
    // The conditional clause is absorbed — nonLegendary is NOT set (can't evaluate predicate).
    expect(eff!.nonLegendary).toBeUndefined();
    expect(eff!.additionalTypes).toBeUndefined();
  });

  it("(C2) bare 'except if <cond>, <effect>' is absorbed without declining whole parse", () => {
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of a creature an opponent controls, except if you control a Dragon, it gains flying.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.sourceVariant).toBe('opponentControls');
  });
});

// ===========================================================================
// (D) "except it's a Vehicle artifact with crew N" — bare form absorbed silently (Imposter Mech)
// ===========================================================================

describe("matchEnterAsCopy — bare 'except it's <types> with ...' absorbed (Imposter Mech)", () => {

  it("(D1) parses Imposter Mech oracle text — bare 'except it's a Vehicle artifact with crew 3' absorbed", () => {
    // Imposter Mech real oracle wording:
    // "You may have this Vehicle enter as a copy of a creature an opponent controls, except
    //  it's a Vehicle artifact with crew 3."
    const eff = firstEnterAsCopy(
      "You may have this Vehicle enter as a copy of a creature an opponent controls, except it's a Vehicle artifact with crew 3.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.sourceVariant).toBe('opponentControls');
    // The bare type rider without "in addition to its other types" is absorbed.
    expect(eff!.additionalTypes).toBeUndefined();
  });

  it("(D2) 'except it's a <type1> <type2>' without 'in addition' is absorbed (not declined)", () => {
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of any creature on the battlefield, except it's an artifact creature.",
    );
    // Must parse (not be declined) — additionalTypes not set because no "in addition to" tail.
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.additionalTypes).toBeUndefined();
  });

  it("(D3) 'except it's a <type> in addition to its other types' still sets additionalTypes", () => {
    // Regression: the "in addition to" form must still work correctly.
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of any creature on the battlefield, except it's an artifact in addition to its other types.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.additionalTypes).toContain('artifact');
  });
});

// ===========================================================================
// (E) Regression: existing source variants are unaffected
// ===========================================================================

describe('matchEnterAsCopy — scope extension regressions', () => {

  it('(E1) "a creature an opponent controls" (Mocking Doppelganger base) still parses', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of a creature an opponent controls.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('opponentControls');
  });

  it('(E2) "any creature on the battlefield" (default) still parses', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant ?? 'battlefield').toBe('battlefield');
  });

  it('(E3) "any creature card in a graveyard" still parses', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature card in a graveyard.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('graveyard');
  });

  it('(E4) quoted-ability rider still declined (Mocking Doppelganger)', () => {
    const result = parseOracleText(
      'You may have this creature enter as a copy of a creature an opponent controls, except it has "Whenever this creature attacks, goad each creature that player controls."',
    );
    if (result.kind === 'Spell') {
      const hasEnterAsCopy = result.effects.some(e => e.kind === 'EnterAsCopy');
      expect(hasEnterAsCopy).toBe(false);
    } else {
      expect(result.kind).toBe('Unparsed');
    }
  });
});
