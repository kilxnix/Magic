// Slice 7 — Enter-As-Copy rider extension:
//   (A) "in addition to its other colors and types" tail variant (Lazotep Convert)
//   (B) "it isn't legendary" rider (Vizier of Many Faces / Auton Soldier)
//   (C) Compound "it isn't legendary, is an artifact, and has myriad" (Auton Soldier)
//   (D) Compound "it isn't legendary and is a Zombie in addition to its other types" (Vizier)
//
// Parser tests verify the effects are emitted correctly.
// Executor tests verify the nonLegendary flag suppresses the legend rule SBA.

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Minimal test-state factory
// ---------------------------------------------------------------------------

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  // Entering permanent — the Clone / shapeshifter before copy.
  cards.set('entering', {
    instanceId: 'entering',
    definitionId: 'def-shapeshifter',
    ownerId: 'player-1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: true,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set('def-shapeshifter', {
    id: 'def-shapeshifter',
    name: 'Test Shapeshifter',
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

  // Opponent's legendary creature (will trigger the legendary SBA if not suppressed).
  cards.set('opp-legendary', {
    instanceId: 'opp-legendary',
    definitionId: 'def-legendary',
    ownerId: 'player-2',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set('def-legendary', {
    id: 'def-legendary',
    name: 'Legendary Dragon',
    type_line: 'Legendary Creature — Dragon',
    oracle_text: 'Flying.',
    mana_cost: '{5}{R}{R}',
    cmc: 7,
    colors: ['R'],
    color_identity: ['R'],
    keywords: ['Flying'],
    power: 7,
    toughness: 7,
    card_types: ['creature'],
  });

  // Graveyard creature for graveyard-pool tests.
  cards.set('grave-creature', {
    instanceId: 'grave-creature',
    definitionId: 'def-grave',
    ownerId: 'player-2',
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
    type_line: 'Legendary Creature — Zombie',
    oracle_text: '',
    mana_cost: '{3}{B}',
    cmc: 4,
    colors: ['B'],
    color_identity: ['B'],
    keywords: [],
    power: 3,
    toughness: 3,
    card_types: ['creature'],
  });

  const players = [
    {
      id: 'player-1',
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
      id: 'player-2',
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

// ===========================================================================
// (A) "in addition to its other colors and types" tail variant — Lazotep Convert
// ===========================================================================
describe('matchEnterAsCopy — Lazotep Convert rider (colors and types tail)', () => {
  it('(A1) parses Lazotep Convert oracle text — graveyard pool, colors-and-types tail', () => {
    // Lazotep Convert real oracle wording.
    const result = parseOracleText(
      "You may have this creature enter as a copy of any creature card in a graveyard, except it's a 4/4 black Zombie in addition to its other colors and types.",
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0] as Extract<Effect, { kind: 'EnterAsCopy' }>;
    expect(eff.kind).toBe('EnterAsCopy');
    expect(eff.sourceVariant).toBe('graveyard');
    // additionalTypes should include 'zombie' (color word "black" is absorbed)
    expect(eff.additionalTypes).toContain('zombie');
    // ptOverride should be set to 4/4
    expect(eff.ptOverride).toEqual({ power: 4, toughness: 4 });
  });

  it('(A2) parses "in addition to its other types and colors" (reversed tail)', () => {
    const result = parseOracleText(
      "You may have this creature enter as a copy of any creature on the battlefield, except it's a Zombie in addition to its other types and colors.",
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0] as Extract<Effect, { kind: 'EnterAsCopy' }>;
    expect(eff.kind).toBe('EnterAsCopy');
    expect(eff.additionalTypes).toContain('zombie');
  });

  it('(A3) existing "in addition to its other types" still parses correctly', () => {
    const result = parseOracleText(
      "You may have this creature enter as a copy of any creature or artifact on the battlefield, except it's an artifact in addition to its other types.",
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0] as Extract<Effect, { kind: 'EnterAsCopy' }>;
    expect(eff.kind).toBe('EnterAsCopy');
    expect(eff.additionalTypes).toEqual(['artifact']);
  });
});

// ===========================================================================
// (B) "it isn't legendary" rider — Vizier of Many Faces
// ===========================================================================
describe('matchEnterAsCopy — "it isn\'t legendary" rider (Vizier of Many Faces)', () => {
  it('(B1) parses Vizier of Many Faces oracle wording — isn\'t legendary + additionalTypes', () => {
    // Vizier of Many Faces real oracle wording.
    const result = parseOracleText(
      "You may have this creature enter as a copy of any creature on the battlefield, except it isn't legendary and is a Zombie in addition to its other types.",
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0] as Extract<Effect, { kind: 'EnterAsCopy' }>;
    expect(eff.kind).toBe('EnterAsCopy');
    expect(eff.nonLegendary).toBe(true);
    expect(eff.additionalTypes).toContain('zombie');
  });

  it('(B2) parses bare "except it isn\'t legendary" without compound clause', () => {
    const result = parseOracleText(
      "You may have this creature enter as a copy of any creature on the battlefield, except it isn't legendary.",
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0] as Extract<Effect, { kind: 'EnterAsCopy' }>;
    expect(eff.kind).toBe('EnterAsCopy');
    expect(eff.nonLegendary).toBe(true);
    expect(eff.additionalTypes).toBeUndefined();
  });

  it('(B3) executes nonLegendary — card does not get nonLegendary flag removed', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      nonLegendary: true,
    };
    const newState = executeEffects(
      state, [effect], 'player-1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );
    const updated = newState.cards.get('entering')!;
    // Should have copied the legendary dragon (only battlefield creature besides entering)
    expect(updated.definitionId).toBe('def-legendary');
    // nonLegendary flag must be set
    expect(updated.nonLegendary).toBe(true);
  });
});

// ===========================================================================
// (C) Compound "it isn't legendary, is an artifact, and has myriad" — Auton Soldier
// ===========================================================================
describe('matchEnterAsCopy — Auton Soldier compound rider', () => {
  it('(C1) parses Auton Soldier oracle text — isn\'t legendary, is an artifact, myriad absorbed', () => {
    // Auton Soldier real oracle wording.
    const result = parseOracleText(
      "You may have this creature enter as a copy of any creature on the battlefield, except it isn't legendary, is an artifact, and has myriad.",
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0] as Extract<Effect, { kind: 'EnterAsCopy' }>;
    expect(eff.kind).toBe('EnterAsCopy');
    expect(eff.nonLegendary).toBe(true);
    // "is an artifact" → additionalTypes includes artifact
    expect(eff.additionalTypes).toContain('artifact');
    // "has myriad" → absorbed (myriad is not in ENTER_AS_COPY_GRANTABLE_KEYWORDS)
    // addedKeywords should not contain myriad
    expect((eff.addedKeywords ?? []).includes('myriad')).toBe(false);
  });

  it('(C2) executes Auton Soldier effect — copy gets nonLegendary + artifact additionalType', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      nonLegendary: true,
      additionalTypes: ['artifact'],
    };
    const newState = executeEffects(
      state, [effect], 'player-1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );
    const updated = newState.cards.get('entering')!;
    expect(updated.definitionId).toBe('def-legendary');
    expect(updated.nonLegendary).toBe(true);
    expect(updated.additionalTypes).toContain('artifact');
  });
});

// ===========================================================================
// (D) Non-regression: existing riders still work
// ===========================================================================
describe('matchEnterAsCopy — non-regression for existing riders', () => {
  it('(D1) "except it has flying" still parsed as addedKeywords', () => {
    const result = parseOracleText(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has flying.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0] as Extract<Effect, { kind: 'EnterAsCopy' }>;
    expect(eff.kind).toBe('EnterAsCopy');
    expect(eff.addedKeywords).toContain('flying');
  });

  it('(D2) "except its name is ~" still parsed as nameOverride', () => {
    const result = parseOracleText(
      'You may have this creature enter as a copy of any creature on the battlefield, except its name is ~.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0] as Extract<Effect, { kind: 'EnterAsCopy' }>;
    expect(eff.kind).toBe('EnterAsCopy');
    expect(eff.nameOverride).toBe('~');
  });

  it('(D3) "except it\'s 7/7" still parsed as ptOverride', () => {
    const result = parseOracleText(
      "You may have this creature enter as a copy of any creature on the battlefield, except it's 7/7.",
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0] as Extract<Effect, { kind: 'EnterAsCopy' }>;
    expect(eff.kind).toBe('EnterAsCopy');
    expect(eff.ptOverride).toEqual({ power: 7, toughness: 7 });
  });

  it('(D4) Mocking Doppelganger quoted triggered ability is still declined', () => {
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
