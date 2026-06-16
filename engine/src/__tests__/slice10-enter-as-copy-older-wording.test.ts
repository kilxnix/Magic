// Slice 10: EnterAsCopy wording modernization
//
// Older printings of Clone-family cards use three superficially different forms
// that the original matcher rejected:
//
//   (a) Subject "~" instead of "this creature"
//       e.g. "You may have ~ enter the battlefield as a copy of any
//             artifact or creature on the battlefield, except ..."
//
//   (b) Optional "the battlefield" infix after "enter"
//       e.g. "... enter the battlefield as a copy of ..."  (vs modern "enter as a copy of")
//
//   (c) Reversed type order "artifact or creature"
//       e.g. "any artifact or creature on the battlefield"
//       (modern wording is "any creature or artifact")
//
//   (d) Subject "this artifact" (artifact-type shapeshifters)
//
// All four normalizations should parse to EnterAsCopy with correct fields and
// execute successfully using the existing executor case (no executor changes needed).

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, EnterAsCopyEffect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Minimal test-state factory (same pattern as slice6 test)
// ---------------------------------------------------------------------------

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  // The entering permanent (the older-wording clone before copy resolves).
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
    name: 'Phyrexian Metamorph',
    type_line: 'Artifact Creature — Shapeshifter',
    oracle_text:
      'You may have ~ enter the battlefield as a copy of any artifact or creature on the battlefield, except it\'s an artifact in addition to its other types.',
    mana_cost: '{3}{U}',
    cmc: 4,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    power: 0,
    toughness: 0,
    card_types: ['artifact', 'creature'],
  });

  // A battlefield creature to copy (opponent's).
  cards.set('opp-creature', {
    instanceId: 'opp-creature',
    definitionId: 'def-opp',
    ownerId: 'p2',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-opp', {
    id: 'def-opp',
    name: 'Blightsteel Colossus',
    type_line: 'Artifact Creature — Golem',
    oracle_text: 'Trample, infect.',
    mana_cost: '{12}',
    cmc: 12,
    colors: [],
    color_identity: [],
    keywords: ['trample', 'infect'],
    power: 11,
    toughness: 11,
    card_types: ['artifact', 'creature'],
  });

  // An artifact-only permanent (to confirm includesArtifacts allows it).
  cards.set('opp-artifact', {
    instanceId: 'opp-artifact',
    definitionId: 'def-opp-artifact',
    ownerId: 'p2',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-opp-artifact', {
    id: 'def-opp-artifact',
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

// Helper: parse oracle text and return first EnterAsCopyEffect, or null.
function firstEnterAsCopy(oracle: string): EnterAsCopyEffect | null {
  const result = parseOracleText(oracle);
  if (result.kind !== 'Spell') return null;
  const eff = result.effects.find(e => e.kind === 'EnterAsCopy');
  return eff ? (eff as EnterAsCopyEffect) : null;
}

// ===========================================================================
// Parser tests — older wording variants
// ===========================================================================

describe('matchEnterAsCopy — Slice-10 older wording (parser)', () => {

  // ── (a) "~" subject ──────────────────────────────────────────────────────

  it('(a) parses "~ enter the battlefield as a copy of any artifact or creature" (Phyrexian Metamorph-era wording)', () => {
    const eff = firstEnterAsCopy(
      "You may have ~ enter the battlefield as a copy of any artifact or creature on the battlefield, except it's an artifact in addition to its other types.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.includesArtifacts).toBe(true);
    expect(eff!.additionalTypes).toEqual(['artifact']);
    // Default sourceVariant (battlefield) is omitted from the effect object.
    expect(eff!.sourceVariant).toBeUndefined();
  });

  it('(a) parses "~ enter the battlefield as a copy of any creature on the battlefield" (tilde, no artifact)', () => {
    const eff = firstEnterAsCopy(
      'You may have ~ enter the battlefield as a copy of any creature on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.includesArtifacts).toBeUndefined();
    expect(eff!.sourceVariant).toBeUndefined();
  });

  // ── (b) "enter the battlefield as a copy" infix ───────────────────────────

  it('(b) parses "this creature enter the battlefield as a copy of any creature" (battlefield infix)', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter the battlefield as a copy of any creature on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.includesArtifacts).toBeUndefined();
    expect(eff!.sourceVariant).toBeUndefined();
  });

  it('(b) parses "this creature enter the battlefield as a copy of any creature or artifact" (infix + modern order)', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter the battlefield as a copy of any creature or artifact on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.includesArtifacts).toBe(true);
  });

  // ── (c) Reversed "artifact or creature" type order ──────────────────────

  it('(c) parses "any artifact or creature on the battlefield" (reversed order, modern subject)', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any artifact or creature on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.includesArtifacts).toBe(true);
    expect(eff!.subtypeFilter).toBeUndefined();
  });

  it('(c) parses "artifact or creature" with "the battlefield" infix and "except" rider', () => {
    const eff = firstEnterAsCopy(
      "You may have this artifact enter the battlefield as a copy of any artifact or creature on the battlefield, except it's an artifact in addition to its other types.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.includesArtifacts).toBe(true);
    expect(eff!.additionalTypes).toEqual(['artifact']);
  });

  // ── (d) "this artifact" subject ──────────────────────────────────────────

  it('(d) parses "this artifact enter as a copy of any artifact or creature" (artifact subject)', () => {
    const eff = firstEnterAsCopy(
      'You may have this artifact enter as a copy of any artifact or creature on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.includesArtifacts).toBe(true);
  });

  it('(d) parses "this artifact enter the battlefield as a copy of any artifact or creature" (artifact + infix)', () => {
    const eff = firstEnterAsCopy(
      "You may have this artifact enter the battlefield as a copy of any artifact or creature on the battlefield, except it's an artifact in addition to its other types.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.includesArtifacts).toBe(true);
    expect(eff!.additionalTypes).toEqual(['artifact']);
  });

  // ── Combination: all three wording differences at once ───────────────────

  it('full canonical Phyrexian Metamorph wording parses correctly', () => {
    // This is the actual oracle text pattern from older Metamorph printings.
    const eff = firstEnterAsCopy(
      "You may have ~ enter the battlefield as a copy of any artifact or creature on the battlefield, except it's an artifact in addition to its other types.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.includesArtifacts).toBe(true);
    expect(eff!.additionalTypes).toEqual(['artifact']);
    expect(eff!.sourceVariant).toBeUndefined(); // battlefield is default
    expect(eff!.subtypeFilter).toBeUndefined();
  });

  // ── Unchanged modern wordings still parse ─────────────────────────────────

  it('modern wording still works after changes (regression guard)', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.includesArtifacts).toBeUndefined();
  });

  // ── Declined / unsupported forms still return null ─────────────────────────

  it('declines unknown "except" rider (vanishing) to maintain honesty bar', () => {
    // A rider the executor cannot handle must still cause the parse to return null.
    const result = parseOracleText(
      'You may have ~ enter the battlefield as a copy of any artifact or creature on the battlefield, except it gains vanishing 3.',
    );
    if (result.kind === 'Spell') {
      const hasEnterAsCopy = result.effects.some(e => e.kind === 'EnterAsCopy');
      expect(hasEnterAsCopy).toBe(false);
    }
  });
});

// ===========================================================================
// Executor tests — older wording forms execute correctly
// ===========================================================================

describe('executeEnterAsCopy — Slice-10 older wording (executor)', () => {

  it('executes "~" subject wording: copies highest-value creature on battlefield', () => {
    const state = makeState();
    // Effect produced by "~ enter the battlefield as a copy of any artifact or creature"
    const effect: Effect = {
      kind: 'EnterAsCopy',
      includesArtifacts: true,
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    expect(card).toBeDefined();
    // Executor picks the best-match permanent; Blightsteel Colossus (11/11) wins.
    expect(card.definitionId).toBe('def-opp');
    expect(card.copiedFromDefinitionId).toBe('def-opp');
    // Owner stays with p1.
    expect(card.ownerId).toBe('p1');
    expect(card.zone).toBe('battlefield');
  });

  it('executes full Phyrexian Metamorph effect with additionalTypes rider', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      includesArtifacts: true,
      additionalTypes: ['artifact'],
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    expect(card.definitionId).toBe('def-opp');
    // The additionalTypes overlay must be set.
    expect(card.additionalTypes).toEqual(['artifact']);
  });

  it('executes "this artifact" subject wording: no-op when sourceInstanceId absent', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      includesArtifacts: true,
    };

    // No sourceInstanceId → entering permanent cannot be identified → no-op.
    const newState = executeEffects(state, [effect], 'p1', [], []);

    const card = newState.cards.get('entering')!;
    // Definition stays as-is.
    expect(card.definitionId).toBe('def-entering');
  });
});
