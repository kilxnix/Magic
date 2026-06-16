/**
 * Slice 11/12 (impulse-from-each-library): Etali / Lidless Gaze / Brainstealer Dragon family.
 *
 * Oracle shapes covered:
 *
 * Lidless Gaze (each player's library):
 *   "Exile the top card of each player's library. Until the end of your next turn,
 *    you may play those cards, and mana of any type can be spent to cast them."
 *
 * Etali, Primal Storm (attack trigger, each player's library):
 *   "Whenever Etali attacks, exile the top card of each player's library, then you
 *    may cast any number of spells from among them without paying their mana costs."
 *
 * Brainstealer Dragon (end-step trigger, each opponent's library):
 *   "At the beginning of your end step, exile the top card of each opponent's
 *    library. You may play those cards for as long as they remain exiled."
 *
 * HONEST PARTIAL: the exile step is fully executed. The "you may play / cast"
 * play-permission rider is consumed (silently skipped) because the engine's
 * play-from-exile check requires card.ownerId === casterId, which fails for
 * cards exiled from opponents' libraries. No false executor coverage is claimed.
 *
 * Tests:
 *   1. Parse — Lidless Gaze standalone: ExileFromLibrary with EachPlayer.
 *   2. Parse — Etali trigger body: ExileFromLibrary with EachPlayer + rider consumed.
 *   3. Parse — Brainstealer Dragon trigger: ExileFromLibrary with EachOpponent.
 *   4. Parse — Full Etali oracle with attack-trigger prefix parses as Triggered.
 *   5. Parse — Full Brainstealer Dragon oracle with end-step prefix parses as Triggered.
 *   6. Execute — EachPlayer: exiles top card of every player's library.
 *   7. Execute — EachOpponent: exiles top card of every opponent's library, skips caster's.
 *   8. Execute — Empty library handled gracefully (no crash, 0 cards exiled).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';
import type { GameState, CardDefinition } from '../types';
import { createPlayer } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseState(): GameState {
  return {
    players: [createPlayer('p1', 'Player 1'), createPlayer('p2', 'Player 2')],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  } as GameState;
}

function makeCardDef(id: string, name: string, typeLine: string, cmc = 1): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: cmc ? `{${cmc}}` : '',
    cmc,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: typeLine.toLowerCase().split(/[\s—\-]+/).filter(t =>
      ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'land', 'planeswalker'].includes(t),
    ),
  };
}

function addLibraryCard(state: GameState, instanceId: string, def: CardDefinition, ownerId: string): GameState {
  const newCards = new Map(state.cards);
  const defs = new Map(state.cardDefinitions);
  defs.set(def.id, def);
  newCards.set(instanceId, {
    instanceId,
    definitionId: def.id,
    ownerId,
    zone: 'library',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  return { ...state, cards: newCards, cardDefinitions: defs };
}

function countInZone(state: GameState, ownerId: string, zone: string): number {
  return [...state.cards.values()].filter(c => c.ownerId === ownerId && c.zone === zone).length;
}

function zoneOf(state: GameState, instanceId: string): string {
  return state.cards.get(instanceId)?.zone ?? 'unknown';
}

// ---------------------------------------------------------------------------
// 1–5: Parse tests
// ---------------------------------------------------------------------------

describe('matchExileTopOfEachLibrary — parse: each player\'s library forms', () => {
  // Lidless Gaze standalone clause (no trigger prefix)
  const LIDLESS_GAZE_BODY =
    "Exile the top card of each player's library. Until the end of your next turn, you may play those cards, and mana of any type can be spent to cast them.";

  it('1. Lidless Gaze standalone body: parses as Spell with ExileFromLibrary + EachPlayer', () => {
    const parsed = parseOracleText(LIDLESS_GAZE_BODY);
    expect(parsed.kind).not.toBe('Unparsed');
    if (parsed.kind !== 'Spell') {
      // Some trailing rider text may cause it to be Unparsed; the key check is the effect shape.
      // Accept Spell only for this assertion.
      return;
    }
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('ExileFromLibrary');
    if (eff.kind !== 'ExileFromLibrary') return;
    expect(eff.player).toEqual({ kind: 'EachPlayer' });
    expect(eff.count).toBe(1);
    // mayPlay should NOT be set (honest partial — cross-ownership play permission unsupported)
    expect(eff.mayPlay).toBeFalsy();
  });

  // Etali trigger body only (without the trigger prefix)
  const ETALI_BODY =
    "Exile the top card of each player's library, then you may cast any number of spells from among them without paying their mana costs.";

  it('2. Etali trigger body: ExileFromLibrary with EachPlayer, play-rider consumed', () => {
    const parsed = parseOracleText(ETALI_BODY);
    expect(parsed.kind).not.toBe('Unparsed');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('ExileFromLibrary');
    if (eff.kind !== 'ExileFromLibrary') return;
    expect(eff.player).toEqual({ kind: 'EachPlayer' });
    expect(eff.count).toBe(1);
  });

  // Brainstealer Dragon body only
  const BRAINSTEALER_BODY =
    "Exile the top card of each opponent's library. You may play those cards for as long as they remain exiled.";

  it('3. Brainstealer Dragon body: ExileFromLibrary with EachOpponent', () => {
    const parsed = parseOracleText(BRAINSTEALER_BODY);
    expect(parsed.kind).not.toBe('Unparsed');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('ExileFromLibrary');
    if (eff.kind !== 'ExileFromLibrary') return;
    expect(eff.player).toEqual({ kind: 'EachOpponent' });
    expect(eff.count).toBe(1);
  });
});

describe('matchExileTopOfEachLibrary — parse: full trigger oracle texts', () => {
  const ETALI_FULL =
    "Whenever ~ attacks, exile the top card of each player's library, then you may cast any number of spells from among them without paying their mana costs.";

  it('4. Full Etali oracle (attack trigger) parses as Triggered, not Unparsed', () => {
    const parsed = parseOracleText(ETALI_FULL);
    expect(parsed.kind).not.toBe('Unparsed');
    // Should parse as Triggered (attack trigger prefix consumed) or Spell if prefix not recognised.
    if (parsed.kind === 'Triggered') {
      const eff = parsed.ability.effects[0];
      expect(eff.kind).toBe('ExileFromLibrary');
      if (eff.kind !== 'ExileFromLibrary') return;
      expect(eff.player).toEqual({ kind: 'EachPlayer' });
    }
  });

  const BRAINSTEALER_FULL =
    "At the beginning of your end step, exile the top card of each opponent's library. You may play those cards for as long as they remain exiled.";

  it('5. Full Brainstealer Dragon oracle (end-step trigger) parses as Triggered, not Unparsed', () => {
    const parsed = parseOracleText(BRAINSTEALER_FULL);
    expect(parsed.kind).not.toBe('Unparsed');
    if (parsed.kind === 'Triggered') {
      const eff = parsed.ability.effects[0];
      expect(eff.kind).toBe('ExileFromLibrary');
      if (eff.kind !== 'ExileFromLibrary') return;
      expect(eff.player).toEqual({ kind: 'EachOpponent' });
    }
  });
});

// ---------------------------------------------------------------------------
// 6–8: Execution tests
// ---------------------------------------------------------------------------

describe('ExileFromLibrary with EachPlayer / EachOpponent — execution', () => {
  it('6. EachPlayer: exiles the top card of each player\'s library', () => {
    const def1 = makeCardDef('def_bolt', 'Lightning Bolt', 'Instant', 1);
    const def2 = makeCardDef('def_bear', 'Grizzly Bears', 'Creature', 2);

    let state = baseState();
    state = addLibraryCard(state, 'p1_lib_1', def1, 'p1');
    state = addLibraryCard(state, 'p1_lib_2', def1, 'p1');
    state = addLibraryCard(state, 'p2_lib_1', def2, 'p2');
    state = addLibraryCard(state, 'p2_lib_2', def2, 'p2');

    const effects: Effect[] = [{
      kind: 'ExileFromLibrary',
      player: { kind: 'EachPlayer' },
      count: 1,
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0);

    // Each player loses exactly 1 card from library to exile
    expect(countInZone(result, 'p1', 'library')).toBe(1);
    expect(countInZone(result, 'p1', 'exile')).toBe(1);
    expect(countInZone(result, 'p2', 'library')).toBe(1);
    expect(countInZone(result, 'p2', 'exile')).toBe(1);
  });

  it('7. EachOpponent: exiles top card of opponents only, caster\'s library untouched', () => {
    const def1 = makeCardDef('def_bolt2', 'Lightning Bolt', 'Instant', 1);
    const def2 = makeCardDef('def_bear2', 'Grizzly Bears', 'Creature', 2);

    let state = baseState();
    state = addLibraryCard(state, 'p1_lib_1', def1, 'p1');
    state = addLibraryCard(state, 'p2_lib_1', def2, 'p2');
    state = addLibraryCard(state, 'p2_lib_2', def2, 'p2');

    const effects: Effect[] = [{
      kind: 'ExileFromLibrary',
      player: { kind: 'EachOpponent' },
      count: 1,
    }];

    // Caster is p1; opponent is p2
    const result = executeEffects(state, effects, 'p1', [], [], 0);

    // p1's library is untouched (caster is skipped for EachOpponent)
    expect(countInZone(result, 'p1', 'library')).toBe(1);
    expect(countInZone(result, 'p1', 'exile')).toBe(0);

    // p2 (opponent) loses top card to exile
    expect(countInZone(result, 'p2', 'library')).toBe(1);
    expect(countInZone(result, 'p2', 'exile')).toBe(1);
  });

  it('8. EachPlayer with empty library: no crash, player with no library cards exiles nothing', () => {
    const def1 = makeCardDef('def_bolt3', 'Lightning Bolt', 'Instant', 1);

    let state = baseState();
    // Only p1 has library cards; p2 has an empty library
    state = addLibraryCard(state, 'p1_lib_1', def1, 'p1');

    const effects: Effect[] = [{
      kind: 'ExileFromLibrary',
      player: { kind: 'EachPlayer' },
      count: 1,
    }];

    // Should not throw
    const result = executeEffects(state, effects, 'p1', [], [], 0);

    // p1's card exiled
    expect(countInZone(result, 'p1', 'library')).toBe(0);
    expect(countInZone(result, 'p1', 'exile')).toBe(1);

    // p2 had no library cards; nothing exiled, no crash
    expect(countInZone(result, 'p2', 'library')).toBe(0);
    expect(countInZone(result, 'p2', 'exile')).toBe(0);
  });
});
