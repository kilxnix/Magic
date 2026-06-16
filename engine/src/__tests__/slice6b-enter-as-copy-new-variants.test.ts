// Slice 6 (round 2): Enter-as-copy new source variants
//
// Tests that matchEnterAsCopy (zones.ts) and executeEnterAsCopy (executor.ts) correctly
// handle the 16-face Clone family from parser coverage slice 6/11:
//
//   (A) "a creature or planeswalker you control" — Spark Double family
//         sourceVariant: 'creatureOrPlaneswalkerYouControl'
//   (B) "a permanent you control" — Moritte of the Frost
//         sourceVariant: 'permanentYouControl'
//   (C) "an extra <type> counter on it" rider — Spark Double
//         Maps to entryCounter (same structure, 'extra' absorbed)
//   (D) Moritte compound "except it's legendary, it's a Snow permanent, ..."
//         addedLegendary set; Snow/counter compound absorbed silently (honesty)
//   (E) Declined: Gigantoplasm-style "except it has {X}:..." (activated ability text)
//   (F) Declined: Mocking Doppelganger "except it has \"Whenever ...\"" (quoted ability)
//   (G) Regression: existing source variants still parse correctly

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

  // The entering permanent (clone that uses EnterAsCopy).
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
    name: 'Spark Double',
    type_line: 'Creature — Illusion',
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

  // Battlefield creature (own, for youControl-family tests).
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
    name: 'Grizzly Bears',
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: 2,
    toughness: 2,
    card_types: ['creature'],
  });

  // Planeswalker controlled by p1 (for creatureOrPlaneswalkerYouControl tests).
  cards.set('own-walker', {
    instanceId: 'own-walker',
    definitionId: 'def-own-walker',
    ownerId: 'p1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: { loyalty: 4 },
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-own-walker', {
    id: 'def-own-walker',
    name: 'Jace, the Mind Sculptor',
    type_line: 'Legendary Planeswalker — Jace',
    oracle_text: '',
    mana_cost: '{2}{U}{U}',
    cmc: 4,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    power: 0,
    toughness: 0,
    card_types: ['planeswalker'],
  });

  // Opponent's creature (to confirm it's excluded from youControl variants).
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
    keywords: ['flying', 'vigilance'],
    power: 4,
    toughness: 4,
    card_types: ['creature'],
  });

  // An artifact controlled by p1 (for permanentYouControl tests — non-creature).
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
// (A) "a creature or planeswalker you control" — Spark Double family
// ===========================================================================

describe('matchEnterAsCopy — creatureOrPlaneswalkerYouControl (parser)', () => {

  it('(A1) parses Spark Double oracle wording: "a creature or planeswalker you control"', () => {
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of a creature or planeswalker you control, except it enters with an additional +1/+1 counter on it if it's a creature or an additional loyalty counter on it if it's a planeswalker.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.sourceVariant).toBe('creatureOrPlaneswalkerYouControl');
    // The dual-conditional counter form — we capture the first branch (+1/+1) and absorb the rest.
    expect(eff!.entryCounter).toEqual({ counterType: '+1/+1', count: 1 });
  });

  it('(A2) parses simplified "a creature or planeswalker you control" without rider', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of a creature or planeswalker you control.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('creatureOrPlaneswalkerYouControl');
    expect(eff!.entryCounter).toBeUndefined();
  });

  it('(A3) parses "a creature or planeswalker you control, except it enters with an extra +1/+1 counter" (extra modifier)', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of a creature or planeswalker you control, except it enters with an extra +1/+1 counter on it.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('creatureOrPlaneswalkerYouControl');
    expect(eff!.entryCounter).toEqual({ counterType: '+1/+1', count: 1 });
  });
});

// ===========================================================================
// (B) "a permanent you control" — Moritte of the Frost
// ===========================================================================

describe('matchEnterAsCopy — permanentYouControl (parser)', () => {

  it('(B1) parses Moritte of the Frost oracle wording: "a permanent you control"', () => {
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of a permanent you control, except it's legendary, it's a Snow permanent, and it enters with two additional counters of a kind it already has on it or two +1/+1 counters on it if it has no counters on it.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.sourceVariant).toBe('permanentYouControl');
    // addedLegendary should be set; Snow and counters are absorbed silently.
    expect(eff!.addedLegendary).toBe(true);
  });

  it('(B2) parses "a permanent you control, except it\'s legendary" (standalone legendary rider)', () => {
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of a permanent you control, except it's legendary.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('permanentYouControl');
    expect(eff!.addedLegendary).toBe(true);
  });

  it('(B3) parses "a permanent you control" without any rider', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of a permanent you control.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('permanentYouControl');
    expect(eff!.addedLegendary).toBeUndefined();
  });
});

// ===========================================================================
// (C) "except it has {X}:..." — Gigantoplasm style: declined
// ===========================================================================

describe('matchEnterAsCopy — Gigantoplasm declined (honesty bar)', () => {

  it('(C1) declines Gigantoplasm "except it has {X}: This creature has base power and toughness X/X" (activated ability rider)', () => {
    // The rider starts with a mana symbol token — the engine cannot grant arbitrary activated
    // ability text, so the whole parse should be declined.
    const result = parseOracleText(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has {X}: This creature has base power and toughness X/X until end of turn.',
    );
    if (result.kind === 'Spell') {
      const hasEnterAsCopy = result.effects.some(e => e.kind === 'EnterAsCopy');
      expect(hasEnterAsCopy).toBe(false);
    } else {
      // Allowed to be Unparsed — honesty bar satisfied
      expect(result.kind).toBe('Unparsed');
    }
  });
});

// ===========================================================================
// (D) Mocking Doppelganger declined (quoted ability rider)
// ===========================================================================

describe('matchEnterAsCopy — Mocking Doppelganger declined (honesty bar)', () => {

  it('(D1) declines Mocking Doppelganger "except it has \\"Whenever this creature attacks...\\""', () => {
    const result = parseOracleText(
      'You may have this creature enter as a copy of a creature an opponent controls, except it has "Whenever this creature attacks, for each player, create a token that\'s a copy of this creature under that player\'s control."',
    );
    if (result.kind === 'Spell') {
      const hasEnterAsCopy = result.effects.some(e => e.kind === 'EnterAsCopy');
      expect(hasEnterAsCopy).toBe(false);
    } else {
      expect(result.kind).toBe('Unparsed');
    }
  });
});

// ===========================================================================
// (E) Executor tests — new source variants
// ===========================================================================

describe('executeEnterAsCopy — creatureOrPlaneswalkerYouControl (executor)', () => {

  it('(E1) copies a creature the caster controls (not opponent\'s creature)', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      sourceVariant: 'creatureOrPlaneswalkerYouControl',
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Should copy from p1's permanents only (own-creature or own-walker, not opp-creature).
    expect(['def-own-creature', 'def-own-walker']).toContain(card.definitionId);
    expect(card.ownerId).toBe('p1');
  });

  it('(E2) does not copy opponent\'s creature for creatureOrPlaneswalkerYouControl', () => {
    // Remove p1's own permanents — only opp-creature remains on battlefield.
    const state = makeState();
    const restricted: GameState = {
      ...state,
      cards: new Map(
        [...state.cards.entries()].filter(([id]) => id !== 'own-creature' && id !== 'own-walker' && id !== 'own-artifact'),
      ),
    };
    const effect: Effect = {
      kind: 'EnterAsCopy',
      sourceVariant: 'creatureOrPlaneswalkerYouControl',
    };

    const newState = executeEffects(
      restricted, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // No legal p1 creature/planeswalker — entering permanent stays as itself.
    expect(card.definitionId).toBe('def-entering');
  });

  it('(E3) creatureOrPlaneswalkerYouControl with +1/+1 entry counter rider', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      sourceVariant: 'creatureOrPlaneswalkerYouControl',
      entryCounter: { counterType: '+1/+1', count: 1 },
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Should have copied a p1 permanent and gotten a +1/+1 counter.
    expect(['def-own-creature', 'def-own-walker']).toContain(card.definitionId);
    expect(card.counters['+1/+1']).toBe(1);
  });
});

describe('executeEnterAsCopy — permanentYouControl (executor)', () => {

  it('(F1) permanentYouControl copies any p1 permanent including non-creatures', () => {
    // Remove the entering permanent's competitors so only own-artifact is left.
    const state = makeState();
    const artifactOnly: GameState = {
      ...state,
      cards: new Map(
        [...state.cards.entries()].filter(([id]) => id === 'entering' || id === 'own-artifact'),
      ),
    };
    const effect: Effect = {
      kind: 'EnterAsCopy',
      sourceVariant: 'permanentYouControl',
    };

    const newState = executeEffects(
      artifactOnly, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Only own-artifact is available — should copy it.
    expect(card.definitionId).toBe('def-own-artifact');
  });

  it('(F2) permanentYouControl excludes opponent permanents', () => {
    // Remove p1 permanents, leave only opp-creature.
    const state = makeState();
    const noP1: GameState = {
      ...state,
      cards: new Map(
        [...state.cards.entries()].filter(
          ([id]) => id === 'entering' || id === 'opp-creature',
        ),
      ),
    };
    const effect: Effect = {
      kind: 'EnterAsCopy',
      sourceVariant: 'permanentYouControl',
    };

    const newState = executeEffects(
      noP1, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // No p1 permanents to copy → no-op.
    expect(card.definitionId).toBe('def-entering');
  });

  it('(F3) permanentYouControl with addedLegendary makes copy legendary', () => {
    const state = makeState();
    // Keep only own-creature as candidate.
    const creatureOnly: GameState = {
      ...state,
      cards: new Map(
        [...state.cards.entries()].filter(([id]) => id === 'entering' || id === 'own-creature'),
      ),
    };
    const effect: Effect = {
      kind: 'EnterAsCopy',
      sourceVariant: 'permanentYouControl',
      addedLegendary: true,
    };

    const newState = executeEffects(
      creatureOnly, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    expect(card.definitionId).toBe('def-own-creature');
    // addedLegendary is applied via additionalTypes ['legendary'] overlay.
    expect(card.additionalTypes).toContain('legendary');
  });
});

// ===========================================================================
// (G) Regression: existing source variants still work
// ===========================================================================

describe('matchEnterAsCopy — regression: existing variants still parse (parser)', () => {

  it('(G1) "any creature on the battlefield" (default) still parses', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBeUndefined(); // battlefield is the default, omitted
  });

  it('(G2) "a creature you control" still parses', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of a creature you control.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('youControl');
  });

  it('(G3) "a creature an opponent controls" still parses', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of a creature an opponent controls.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('opponentControls');
  });

  it('(G4) "an artifact or creature you control" still parses', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of an artifact or creature you control.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('artifactOrCreatureYouControl');
  });

  it('(G5) "except it\'s a[n] <type> in addition to its other types" rider still parses', () => {
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of any creature on the battlefield, except it's an artifact in addition to its other types.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.additionalTypes).toEqual(['artifact']);
  });

  it('(G6) "except it enters with a shield counter on it" rider still parses', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except it enters with a shield counter on it.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.entryCounter).toEqual({ counterType: 'shield', count: 1 });
  });

  it('(G7) "except its name is ~" rider still parses', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except its name is ~.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.nameOverride).toBe('~');
  });
});
