// Slice 7: Enter-as-copy "except" rider tolerance
//
// Tests that matchEnterAsCopy (zones.ts) accepts:
//   (a) Name-override rider using possessive pronouns other than "its"
//       (Chameleon, Master of Disguise: "except his name is ~")
//   (b) Unenforced-keyword riders (vanishing, fading, etc.) absorbed silently
//       (Flesh Duplicate: "except it has vanishing 3 if that creature doesn't have vanishing")
//
// And correctly declines:
//   (c) Quoted-ability riders that the engine cannot grant
//       (Mocking Doppelganger: "except it has \"Other creatures with the same name...\"")
//
// All parse tests are followed by execution tests to verify the EnterAsCopy
// executor still fires correctly when a rider is absorbed.

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

  // The entering permanent (shapeshifter / clone).
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
    name: 'Flesh Duplicate',
    type_line: 'Creature — Shapeshifter',
    oracle_text: '',
    mana_cost: '{3}{U}',
    cmc: 4,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    power: 0,
    toughness: 0,
    card_types: ['creature'],
  });

  // Opponent's battlefield creature (primary copy target).
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
    name: 'Ancient Sphinx',
    type_line: 'Creature — Sphinx',
    oracle_text: 'Flying.',
    mana_cost: '{5}{U}',
    cmc: 6,
    colors: ['U'],
    color_identity: ['U'],
    keywords: ['flying'],
    power: 5,
    toughness: 6,
    card_types: ['creature'],
  });

  // Own battlefield creature (for youControl variant tests).
  cards.set('own-creature', {
    instanceId: 'own-creature',
    definitionId: 'def-own',
    ownerId: 'p1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-own', {
    id: 'def-own',
    name: 'Ally Warrior',
    type_line: 'Creature — Human Warrior',
    oracle_text: '',
    mana_cost: '{1}{W}',
    cmc: 2,
    colors: ['W'],
    color_identity: ['W'],
    keywords: [],
    power: 2,
    toughness: 2,
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

// Helper: extract the first EnterAsCopyEffect from a Spell parse result.
function firstEnterAsCopy(oracle: string): EnterAsCopyEffect | null {
  const result = parseOracleText(oracle);
  if (result.kind !== 'Spell') return null;
  const eff = result.effects.find(e => e.kind === 'EnterAsCopy');
  return eff ? (eff as EnterAsCopyEffect) : null;
}

// ===========================================================================
// (a) Pronoun-tolerant name-override rider
// ===========================================================================

describe('matchEnterAsCopy — Slice-7 pronoun-tolerant name rider', () => {

  it('accepts "except his name is ~" (Chameleon, Master of Disguise oracle pattern)', () => {
    // Real Chameleon oracle: "You may have ~ enter as a copy of a creature you control,
    // except his name is ~."
    const eff = firstEnterAsCopy(
      'You may have ~ enter as a copy of a creature you control, except his name is ~.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.nameOverride).toBe('~');
    expect(eff!.sourceVariant).toBe('youControl');
  });

  it('accepts "except her name is ~" (hypothetical feminine pronoun variant)', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except her name is ~.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.nameOverride).toBe('~');
  });

  it('canonical "except its name is ~" still works after Slice-7 change', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except its name is ~.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.nameOverride).toBe('~');
  });

  it('still declines literal-name subject ("Chameleon") — unsupported subject form', () => {
    // The subject "Chameleon" is a literal card name, not "this creature" or "~".
    // Even though the pronoun "his" is now supported, the subject is still unrecognised.
    const eff = firstEnterAsCopy(
      'You may have Chameleon enter as a copy of a creature you control, except his name is ~.',
    );
    expect(eff).toBeNull();
  });

});

// ===========================================================================
// (b) Unenforced-keyword rider absorption
// ===========================================================================

describe('matchEnterAsCopy — Slice-7 unenforced keyword rider absorption', () => {

  it('absorbs "except it has vanishing 3" (Flesh Duplicate style) — parse succeeds, no entryCounter', () => {
    // Flesh Duplicate: "You may have this creature enter as a copy of any creature on the
    // battlefield, except it has vanishing 3 if that creature doesn't have vanishing."
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of any creature on the battlefield, except it has vanishing 3 if that creature doesn't have vanishing.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    // The base copy effect is valid; the unenforced rider is absorbed (not reflected in any field).
    expect(eff!.addedKeywords).toBeUndefined();
    expect(eff!.entryCounter).toBeUndefined();
    expect(eff!.additionalTypes).toBeUndefined();
    // sourceVariant defaults to battlefield (undefined in AST).
    expect(eff!.sourceVariant).toBeUndefined();
  });

  it('absorbs "except it has vanishing 3" (bare form, no conditional)', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has vanishing 3.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.addedKeywords).toBeUndefined();
  });

  it('absorbs "except it has fading 4" (fading is also unenforced)', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has fading 4.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.addedKeywords).toBeUndefined();
  });

  it('absorbs bare unenforced keyword (no numeric argument)', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has phasing.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.addedKeywords).toBeUndefined();
  });

});

// ===========================================================================
// (c) Quoted-ability rider declined
// ===========================================================================

describe('matchEnterAsCopy — Slice-7 quoted-ability rider decline', () => {

  it('declines "except it has \\"Other creatures with the same name...\\"" (Mocking Doppelganger)', () => {
    // Mocking Doppelganger: "...except it has \"Other creatures with the same name as this
    // creature get -1/-1.\""  — the engine cannot grant arbitrary quoted ability clauses.
    const result = parseOracleText(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has "Other creatures with the same name as this creature get -1/-1."',
    );
    if (result.kind === 'Spell') {
      const hasEnterAsCopy = result.effects.some(e => e.kind === 'EnterAsCopy');
      expect(hasEnterAsCopy).toBe(false);
    }
    // Either Unparsed or Spell without EnterAsCopy — both are honest.
  });

  it('declines short quoted ability rider as well', () => {
    const result = parseOracleText(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has "flying."',
    );
    if (result.kind === 'Spell') {
      const hasEnterAsCopy = result.effects.some(e => e.kind === 'EnterAsCopy');
      expect(hasEnterAsCopy).toBe(false);
    }
  });

});

// ===========================================================================
// Execution tests — base EnterAsCopy still fires with absorbed/new riders
// ===========================================================================

describe('executeEnterAsCopy — Slice-7 rider execution', () => {

  it('"his name is ~" rider: executor sets nameOverride and copies correctly', () => {
    // Parse the Chameleon-style oracle to get the effect, then execute it.
    const parsed = parseOracleText(
      'You may have ~ enter as a copy of a creature you control, except his name is ~.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const effect = parsed.effects.find(e => e.kind === 'EnterAsCopy') as EnterAsCopyEffect;
    expect(effect).toBeDefined();

    const state = makeState();
    const newState = executeEffects(
      state, [effect as Effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Should have copied own-creature (youControl — only p1 creature on battlefield).
    expect(card.definitionId).toBe('def-own');
    expect(card.copiedFromDefinitionId).toBe('def-own');
    // nameOverride should be the entering permanent's original name ("Flesh Duplicate").
    expect(card.nameOverride).toBe('Flesh Duplicate');
  });

  it('unenforced-keyword rider absorbed: executor still copies correctly', () => {
    // Flesh Duplicate oracle pattern — after absorption the base EnterAsCopy runs.
    const parsed = parseOracleText(
      "You may have this creature enter as a copy of any creature on the battlefield, except it has vanishing 3 if that creature doesn't have vanishing.",
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const effect = parsed.effects.find(e => e.kind === 'EnterAsCopy') as EnterAsCopyEffect;
    expect(effect).toBeDefined();

    const state = makeState();
    const newState = executeEffects(
      state, [effect as Effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Opponent's Ancient Sphinx has the highest P+T on the battlefield; it is selected.
    expect(card.definitionId).toBe('def-opp');
    expect(card.copiedFromDefinitionId).toBe('def-opp');
    // No counter or keyword should have been applied (rider was absorbed, not executed).
    expect(Object.keys(card.counters)).toHaveLength(0);
    expect(card.grantedKeywords ?? []).toHaveLength(0);
  });

  it('direct effect: EnterAsCopy with unenforced rider absorbed (no addedKeywords field) executes cleanly', () => {
    // Build the effect directly as the parser would produce it after absorption.
    const effect: Effect = {
      kind: 'EnterAsCopy',
      // No addedKeywords — the unenforced vanishing rider was absorbed, not stored.
    };

    const state = makeState();
    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    expect(card.definitionId).toBe('def-opp'); // copied highest-value candidate
    expect(card.copiedFromDefinitionId).toBe('def-opp');
  });

});
