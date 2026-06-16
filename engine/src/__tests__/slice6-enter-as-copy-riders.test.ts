// Slice 6: Enter-as-copy 'except' riders and source variants
//
// Tests that matchEnterAsCopy (zones.ts) and executeEnterAsCopy (executor.ts)
// correctly handle:
//   (1) "except it enters with a <type> counter on it [if <cond>]"
//   (2) "except it's a[n] <type> in addition to its other types"
//   (3) "except it has <keyword>"
//   (4) "except its name is <name>" -> nameOverride
//
// Source variants:
//   - "any creature on the battlefield"       (default, already tested in slice-9)
//   - "any creature card in a graveyard"      (graveyard variant)
//   - "a creature you control"                (youControl variant)
//
// Also confirms declined riders (quoted ability text) still return null.

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

  // The entering permanent (shapeshifter/clone that uses EnterAsCopy).
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
    name: 'Chameleon',
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

  // Battlefield creature to copy (opponent's).
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
    name: 'Big Dragon',
    type_line: 'Creature — Dragon',
    oracle_text: 'Flying.',
    mana_cost: '{5}{R}',
    cmc: 6,
    colors: ['R'],
    color_identity: ['R'],
    keywords: ['flying'],
    power: 5,
    toughness: 5,
    card_types: ['creature'],
  });

  // Graveyard creature card (for the graveyard source-variant tests).
  cards.set('grave-creature', {
    instanceId: 'grave-creature',
    definitionId: 'def-grave',
    ownerId: 'p2',
    zone: 'graveyard',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-grave', {
    id: 'def-grave',
    name: 'Graveyard Zombie',
    type_line: 'Creature — Zombie',
    oracle_text: '',
    mana_cost: '{2}{B}',
    cmc: 3,
    colors: ['B'],
    color_identity: ['B'],
    keywords: [],
    power: 3,
    toughness: 2,
    card_types: ['creature'],
  });

  // Player-1's own battlefield creature (for youControl source variant).
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
    name: 'Ally Soldier',
    type_line: 'Creature — Human Soldier',
    oracle_text: '',
    mana_cost: '{W}',
    cmc: 1,
    colors: ['W'],
    color_identity: ['W'],
    keywords: [],
    power: 1,
    toughness: 1,
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
// Parser tests — rider forms
// ===========================================================================

describe('matchEnterAsCopy — Slice-6 rider forms (parser)', () => {

  // ── (1) entryCounter rider ───────────────────────────────────────────────

  it('(1) parses Undercover Operative: except it enters with a shield counter on it (conditional dropped)', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except it enters with a shield counter on it if you control that creature.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.entryCounter).toEqual({ counterType: 'shield', count: 1 });
    expect(eff!.sourceVariant).toBeUndefined(); // battlefield is the default
  });

  it('(1) parses "except it enters with a +1/+1 counter on it" (bare form, no conditional)', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except it enters with a +1/+1 counter on it.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.entryCounter).toEqual({ counterType: '+1/+1', count: 1 });
  });

  // ── (2) additionalTypes rider ────────────────────────────────────────────

  it('(2) parses Phyrexian Metamorph: except it\'s an artifact in addition to its other types', () => {
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of any creature or artifact on the battlefield, except it's an artifact in addition to its other types.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.additionalTypes).toEqual(['artifact']);
    expect(eff!.includesArtifacts).toBe(true);
  });

  it('(2) parses "except it\'s a Human in addition to its other types" (tokens are lowercased)', () => {
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of any creature on the battlefield, except it's a Human in addition to its other types.",
    );
    expect(eff).not.toBeNull();
    // Tokenizer lowercases all tokens.
    expect(eff!.additionalTypes).toEqual(['human']);
  });

  // ── (3) addedKeywords rider ───────────────────────────────────────────────

  it('(3) parses "except it has flying"', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has flying.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.addedKeywords).toEqual(['flying']);
  });

  it('(3) parses "except it has indestructible"', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has indestructible.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.addedKeywords).toEqual(['indestructible']);
  });

  it('(3) declines "except it has <non-engine ability text>" (quoted text rider)', () => {
    // Mocking Doppelganger-style granted ability text — must not parse.
    const result = parseOracleText(
      "You may have this creature enter as a copy of any creature on the battlefield, except it has \"whenever this creature attacks, draw a card\".",
    );
    if (result.kind === 'Spell') {
      const hasEnterAsCopy = result.effects.some(e => e.kind === 'EnterAsCopy');
      expect(hasEnterAsCopy).toBe(false);
    }
  });

  it('(3) absorbs "except it has an unknown keyword" (Slice-7: unenforced keywords absorbed, not declined)', () => {
    // Slice-7 changed behaviour: unenforced / unrecognised keyword riders are now absorbed
    // silently so the base EnterAsCopy effect still resolves honestly.
    // Only quoted-ability riders (tokens starting with '"') are declined.
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has delirium.',
    );
    // Parse succeeds; the absorbed rider is NOT reflected in addedKeywords.
    expect(eff).not.toBeNull();
    expect(eff!.addedKeywords).toBeUndefined();
  });

  // ── (4) nameOverride rider ────────────────────────────────────────────────

  it('(4) Chameleon with literal-name subject still returns null (subject not a recognised form)', () => {
    const eff = firstEnterAsCopy(
      "You may have Chameleon enter as a copy of a creature you control, except his name is still Chameleon.",
    );
    // The subject "Chameleon" (a literal card name) is not a recognised subject form.
    // Recognised subjects are "this creature", "this artifact", …, or "~".
    // Slice-7 adds "his"/"her" pronoun support for the name rider, but the subject
    // must still be one of the accepted forms — so this text remains unparsed.
    expect(eff).toBeNull();
  });

  it('(4) parses "except its name is ~" canonical form (nameOverride)', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except its name is ~.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.nameOverride).toBe('~');
  });

  // ── Source variants ───────────────────────────────────────────────────────

  it('parses "any creature card in a graveyard" source variant', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature card in a graveyard, except its name is ~.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('graveyard');
    expect(eff!.nameOverride).toBe('~');
  });

  it('parses "a creature you control" source variant', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of a creature you control.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('youControl');
    expect(eff!.entryCounter).toBeUndefined();
  });

  it('parses "a creature you control, except it enters with a shield counter"', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of a creature you control, except it enters with a shield counter on it.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('youControl');
    expect(eff!.entryCounter).toEqual({ counterType: 'shield', count: 1 });
  });
});

// ===========================================================================
// Executor tests — rider application
// ===========================================================================

describe('executeEnterAsCopy — Slice-6 riders (executor)', () => {

  it('entryCounter: entering permanent gets a shield counter after copy', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      entryCounter: { counterType: 'shield', count: 1 },
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Should have copied the opponent's dragon definition.
    expect(card.definitionId).toBe('def-opp');
    // Should have a shield counter.
    expect(card.counters['shield']).toBe(1);
  });

  it('additionalTypes: entering permanent gets additionalTypes overlay after copy', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      additionalTypes: ['artifact'],
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    expect(card.definitionId).toBe('def-opp');
    expect(card.additionalTypes).toEqual(['artifact']);
  });

  it('addedKeywords: entering permanent gains granted keyword after copy', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      addedKeywords: ['indestructible'],
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    expect(card.definitionId).toBe('def-opp');
    expect(card.grantedKeywords).toContain('indestructible');
  });

  it('nameOverride: entering permanent stores original name after copy', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      nameOverride: '~',
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // definitionId should be the copied card's definition.
    expect(card.definitionId).toBe('def-opp');
    // nameOverride should be the entering card's original name.
    expect(card.nameOverride).toBe('Chameleon');
  });

  it('graveyard source variant: copies from graveyard creatures', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      sourceVariant: 'graveyard',
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Should have copied from the graveyard creature (only candidate).
    expect(card.definitionId).toBe('def-grave');
    expect(card.copiedFromDefinitionId).toBe('def-grave');
  });

  it('youControl source variant: copies only from caster\'s battlefield creatures', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      sourceVariant: 'youControl',
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // p1 controls own-creature (def-own) on the battlefield; opp-creature belongs to p2 and is excluded.
    expect(card.definitionId).toBe('def-own');
    expect(card.copiedFromDefinitionId).toBe('def-own');
  });

  it('no-op when graveyard source variant has no legal candidates', () => {
    const state = makeState();
    // Remove graveyard creature from state.
    const noGraveState: GameState = {
      ...state,
      cards: new Map(
        [...state.cards.entries()].filter(([id]) => id !== 'grave-creature'),
      ),
    };
    const effect: Effect = {
      kind: 'EnterAsCopy',
      sourceVariant: 'graveyard',
    };

    const newState = executeEffects(
      noGraveState, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // No graveyard creature — entering permanent stays as itself.
    expect(card.definitionId).toBe('def-entering');
  });

  it('all riders together: copy + counter + additionalTypes + keyword + nameOverride', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      entryCounter: { counterType: '+1/+1', count: 1 },
      additionalTypes: ['artifact'],
      addedKeywords: ['haste'],
      nameOverride: '~',
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    expect(card.definitionId).toBe('def-opp');
    expect(card.counters['+1/+1']).toBe(1);
    expect(card.additionalTypes).toEqual(['artifact']);
    expect(card.grantedKeywords).toContain('haste');
    expect(card.nameOverride).toBe('Chameleon');
  });
});

// ===========================================================================
// getEffectiveCardTypes integration — additionalTypes overlay
// ===========================================================================

describe('getEffectiveCardTypes — additionalTypes rider integration', () => {
  it('includes additionalTypes in effective card types', async () => {
    const { getEffectiveCardTypes } = await import('../effective-types');

    const state = makeState();
    // Simulate a copy that gained 'artifact' as an additional type.
    const copyCard: CardInstance = {
      ...state.cards.get('entering')!,
      definitionId: 'def-opp', // copied a dragon
      additionalTypes: ['artifact'],
    };
    const testState: GameState = {
      ...state,
      cards: new Map([...state.cards, ['entering', copyCard]]),
    };

    const types = getEffectiveCardTypes(testState, 'entering');
    expect(types).toContain('creature'); // from def-opp
    expect(types).toContain('artifact'); // from additionalTypes rider
  });
});
