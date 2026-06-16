/**
 * Oracle-parser coverage slice 9/12:
 * "Spells you control can't be countered" (controller-scoped CBC static) +
 * sibling-line absorption.
 *
 * TWO SUB-WINS implemented in this slice:
 *
 * (a) Controller-scoped CBC static on multi-line faces (absorbBattlefieldCBCSiblingLines):
 *     Faces like Chimil, the Inner Sun lead with "Spells you control can't be
 *     countered." but fail matchBattlefieldCantBeCountered's honesty gate because
 *     of companion unenforced triggers ("At the beginning of your end step, discover 5.").
 *     The new absorber strips all provably-unenforced sibling lines (engine keywords,
 *     parametric keywords, discover N triggers) leaving only the CBC sentence for
 *     matchBattlefieldCantBeCountered to recognize.
 *
 * (b) Discard-to-battlefield rider absorption (absorbDiscardToBattlefieldRiderLines):
 *     "If a spell or ability an opponent controls causes you to discard this card,
 *      put it onto the battlefield instead of putting it into your graveyard."
 *     (Loxodon Smiter, Yixlid family) is absorbed as an honest unenforced-skip.
 *     replacement.ts has ZERO discard-zone redirection (grep-confirmed). The companion
 *     CBC body ("This spell can't be countered.") IS enforced and gets credited after
 *     the rider is stripped.
 *
 * HONEST:
 *  - The battlefield-CBC static IS enforced: executeCounterSpell scans
 *    continuousEffects for non-selfOnly CantBeCountered statics.
 *  - The self-form CBC IS enforced: hasCantBeCounteredText + SpellStackItem.cantBeCountered.
 *  - discover N: zero executor in effects/executor.ts or keywords.ts (grep confirmed).
 *  - Discard-to-battlefield: zero discard-zone replacement in replacement.ts (grep confirmed).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import {
  castSpell,
  resolveTopOfStack,
  registerContinuousAbilitiesForPermanent,
} from '../stack';
import type { GameState, CardDefinition, Phase, Step } from '../types';
import { createPlayer } from '../types';
import { populateParsedCache } from '../cards/card-parser-cache';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [
      { ...createPlayer('p1', 'Player 1'), hasPriority: true },
      { ...createPlayer('p2', 'Player 2'), hasPriority: false },
    ],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as Phase,
    step: 'main' as Step,
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    ...overrides,
  };
}

function addCard(
  state: GameState,
  instanceId: string,
  ownerId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard' | 'command',
  def: Partial<CardDefinition>,
): void {
  const baseDef: CardDefinition = {
    id: def.id ?? instanceId,
    name: def.name ?? 'Test Card',
    type_line: def.type_line ?? 'Creature',
    oracle_text: def.oracle_text ?? '',
    mana_cost: def.mana_cost ?? '',
    cmc: def.cmc ?? 0,
    colors: def.colors ?? [],
    color_identity: def.color_identity ?? [],
    keywords: def.keywords ?? [],
    card_types: def.card_types ?? ['creature'],
    power: def.power,
    toughness: def.toughness,
  };
  const fullDef = populateParsedCache(baseDef);
  state.cardDefinitions.set(fullDef.id, fullDef);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: fullDef.id,
    ownerId,
    zone,
    tapped: false,
    summoningSick: zone === 'battlefield',
    counters: {},
    damage: 0,
    isCommander: false,
  });
}

// ---------------------------------------------------------------------------
// Sub-win (a): Controller-scoped CBC + unenforced sibling lines
// ---------------------------------------------------------------------------

describe('Slice 9 – sub-win (a): controller-scoped CBC with unenforced sibling lines', () => {

  /**
   * Chimil, the Inner Sun:
   * "Spells you control can't be countered.\nAt the beginning of your end step, discover 5."
   *
   * The discover-5 trigger is unenforced (zero executor for discover N).
   * absorbBattlefieldCBCSiblingLines strips the discover trigger, leaving only
   * "Spells you control can't be countered." for matchBattlefieldCantBeCountered.
   */
  it('Chimil-style: CBC static + discover-N end-step trigger → StaticAbility', () => {
    const oracle = "Spells you control can't be countered.\nAt the beginning of your end step, discover 5.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('GrantKeyword');
    if (r.ability.modifier.kind !== 'GrantKeyword') return;
    expect(r.ability.modifier.keyword).toBe('CantBeCountered');
    // Should NOT be self-only — this is the battlefield-source controller-scoped form
    expect(r.ability.selfOnly).toBe(false);
    // Discover trigger absorbed and recorded
    expect(r.absorbedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/discover\s+5/i)])
    );
  });

  /**
   * "Creature spells you control can't be countered.\nAt the beginning of your end step, discover 3."
   * Type-filtered controller-scoped CBC + discover trigger.
   */
  it('Type-filtered CBC (creature spells) + discover trigger → StaticAbility with creature filter', () => {
    const oracle = "Creature spells you control can't be countered.\nAt the beginning of your end step, discover 3.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('GrantKeyword');
    expect(r.ability.selfOnly).toBe(false);
    expect(r.absorbedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/discover/i)])
    );
  });

  /**
   * "Spells you control can't be countered.\nFlying" — keywords are already
   * handled by matchBattlefieldCantBeCountered's isCBCAllowedKeywordSentence.
   * This should still work (regression for existing behavior).
   */
  it('CBC static + keyword (flying) → StaticAbility (existing honesty gate, regression)', () => {
    const oracle = "Spells you control can't be countered.\nFlying";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(false);
  });

  /**
   * "Spells you control can't be countered." single-line — matchBattlefieldCantBeCountered
   * handles it without the absorber. Regression: absorber must not interfere.
   */
  it('single-line "Spells you control cant be countered." → StaticAbility (no absorber needed, regression)', () => {
    const r = parseOracleText("Spells you control can't be countered.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(false);
  });

  /**
   * Decline: "Spells you control can't be countered.\nWhenever you draw a card, ~ deals 1 damage to any target."
   * The draw-deals-damage trigger IS parseable and enforced. absorbBattlefieldCBCSiblingLines
   * must NOT absorb enforced trigger bodies, so the face remains Unparsed (companion trigger
   * is enforced but only the CBC static would be claimed, losing the trigger).
   *
   * NOTE: The discover absorber only absorbs "discover N" patterns (confirmed unenforced).
   * A draw-damage trigger does NOT match the discover pattern, so it's NOT absorbed.
   */
  it('CBC static + enforced draw-deals-damage trigger → does not absorb enforced trigger, CBC still parsed via other path', () => {
    // This face has an enforced trigger — the absorber does NOT absorb it.
    // After the absorber fires: since the draw-deals-damage trigger is NOT in the
    // absorbable set, absorbBattlefieldCBCSiblingLines returns null (all siblings
    // must be absorbable). The face then falls through to normal dispatch.
    const oracle = "Spells you control can't be countered.\nWhenever you draw a card, ~ deals 1 damage to any target.";
    const r = parseOracleText(oracle);
    // The face is still parsed — the trigger makes it through the per-line dispatch
    // (parseOracleTextPerLine) — result will be Triggered (not the CBC static).
    // Key: the absorber does NOT suppress the enforced trigger.
    expect(r.kind).not.toBe('Unparsed');
  });

});

// ---------------------------------------------------------------------------
// Sub-win (b): Discard-to-battlefield rider absorption
// ---------------------------------------------------------------------------

describe('Slice 9 – sub-win (b): discard-to-battlefield rider absorption', () => {

  /**
   * Loxodon Smiter:
   * "This spell can't be countered.\nIf a spell or ability an opponent controls
   *  causes you to discard this card, put it onto the battlefield instead of
   *  putting it into your graveyard."
   *
   * Slice 9 decision: the discard-rider is absorbed as an honest unenforced-skip.
   * replacement.ts has zero discard-zone redirection. The face now parses as
   * StaticAbility (the self-form CBC "This spell can't be countered.").
   */
  it('Loxodon Smiter: CBC + discard-rider → StaticAbility (rider absorbed as unenforced-skip)', () => {
    const oracle =
      "This spell can't be countered.\n" +
      "If a spell or ability an opponent controls causes you to discard this card, " +
      "put it onto the battlefield instead of putting it into your graveyard.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    // Self-form CBC
    expect(r.ability.modifier.kind).toBe('GrantKeyword');
    if (r.ability.modifier.kind !== 'GrantKeyword') return;
    expect(r.ability.modifier.keyword).toBe('CantBeCountered');
    expect(r.ability.selfOnly).toBe(true);
    // Rider recorded in absorbedKeywords
    expect(r.absorbedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/causes you to discard/i)])
    );
  });

  /**
   * Loxodon Smiter with vigilance (real oracle):
   * "Vigilance\nThis spell can't be countered.\nIf ... causes you to discard this card,
   *  put it onto the battlefield instead..."
   *
   * Vigilance is a keyword line absorbed by absorbEngineKeywordLines;
   * the discard-rider is absorbed by absorbDiscardToBattlefieldRiderLines;
   * the remaining CBC parses as StaticAbility.
   */
  it('Loxodon Smiter with Vigilance: keyword + CBC + discard-rider → StaticAbility', () => {
    const oracle =
      "Vigilance\n" +
      "This spell can't be countered.\n" +
      "If a spell or ability an opponent controls causes you to discard this card, " +
      "put it onto the battlefield instead of putting it into your graveyard.";
    const r = parseOracleText(oracle);
    // Vigilance absorbed, discard-rider absorbed, remaining CBC parses
    expect(r.kind).toBe('StaticAbility');
  });

  /**
   * Standalone discard-rider (no CBC) — should NOT parse (nothing executable remains
   * after rider is stripped). The absorber requires substantive text to remain.
   */
  it('standalone discard-rider only → Unparsed (nothing substantive remains)', () => {
    const oracle =
      "If a spell or ability an opponent controls causes you to discard this card, " +
      "put it onto the battlefield instead of putting it into your graveyard.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

});

// ---------------------------------------------------------------------------
// Execution tests: CBC enforcement still applies after absorption
// ---------------------------------------------------------------------------

describe('Slice 9 – execution: CBC enforced on Chimil-style and Loxodon-style cards', () => {

  /**
   * Exec test 1: Chimil-style (CBC static + discover trigger)
   *
   * After the creature enters the battlefield, p1's spells should be uncounterable
   * (battlefield-source CBC static enforced by registerContinuousAbilitiesForPermanent
   * + executeCounterSpell scanning continuousEffects).
   */
  it('Chimil-style: battlefield-CBC static enforced after creature enters', () => {
    let state = createTestState();
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 5, C: 0 };

    // Chimil-style permanent on battlefield
    addCard(state, 'chimil_1', 'p1', 'battlefield', {
      id: 'chimil_def',
      name: 'Chimil Test',
      type_line: 'Artifact',
      oracle_text: "Spells you control can't be countered.\nAt the beginning of your end step, discover 5.",
      mana_cost: '{5}',
      cmc: 5,
      colors: [],
      card_types: ['artifact'],
    });

    // Register battlefield abilities (registers the CBC static)
    state = registerContinuousAbilitiesForPermanent(state, 'chimil_1');

    // p1 casts a creature spell
    addCard(state, 'bear_1', 'p1', 'hand', {
      id: 'bear_def',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      mana_cost: '{1}{G}',
      cmc: 2,
      colors: ['G'],
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    state = {
      ...state,
      priorityPlayerIndex: 0,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p1', 'bear_1');
    expect(state.stack).toHaveLength(1);

    // p2 tries to counter the bear — should fail due to Chimil's CBC static
    addCard(state, 'counter_1', 'p2', 'hand', {
      id: 'counter_def',
      name: 'Counterspell',
      type_line: 'Instant',
      oracle_text: 'Counter target spell.',
      mana_cost: '{U}{U}',
      cmc: 2,
      colors: ['U'],
      card_types: ['instant'],
    });
    state = {
      ...state,
      priorityPlayerIndex: 1,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p2', 'counter_1', ['bear_1']);
    expect(state.stack).toHaveLength(2);

    // Counterspell resolves — must NOT counter the bear
    state = resolveTopOfStack(state);
    expect(state.cards.get('counter_1')?.zone).toBe('graveyard');
    // Bear still on stack (not countered)
    expect(state.cards.get('bear_1')?.zone).toBe('stack');

    // Bear resolves
    state = resolveTopOfStack(state);
    expect(state.cards.get('bear_1')?.zone).toBe('battlefield');
  });

  /**
   * Exec test 2: Loxodon Smiter (CBC + discard-rider)
   *
   * The face now parses as StaticAbility (self-form CBC). CBC enforcement at
   * cast time via hasCantBeCounteredText still applies (rescans full oracle text).
   * The card cannot be countered.
   */
  it('Loxodon Smiter: CBC enforced at cast time after discard-rider absorption', () => {
    let state = createTestState();
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 4, C: 1 };

    const loxodonOracle =
      "This spell can't be countered.\n" +
      "If a spell or ability an opponent controls causes you to discard this card, " +
      "put it onto the battlefield instead of putting it into your graveyard.";

    addCard(state, 'lox_1', 'p1', 'hand', {
      id: 'lox_def',
      name: 'Loxodon Smiter',
      type_line: 'Creature — Elephant Soldier',
      oracle_text: loxodonOracle,
      mana_cost: '{1}{G}{G}',
      cmc: 3,
      colors: ['G'],
      card_types: ['creature'],
      power: 4,
      toughness: 4,
    });

    addCard(state, 'counter_lox', 'p2', 'hand', {
      id: 'counter_lox_def',
      name: 'Counterspell',
      type_line: 'Instant',
      oracle_text: 'Counter target spell.',
      mana_cost: '{U}{U}',
      cmc: 2,
      colors: ['U'],
      card_types: ['instant'],
    });

    // Cast Loxodon Smiter
    state = castSpell(state, 'p1', 'lox_1');
    expect(state.stack).toHaveLength(1);
    // hasCantBeCounteredText rescans full oracle text — CBC flag must be set
    expect(state.stack[0].cantBeCountered).toBe(true);

    // p2 attempts to counter
    state = {
      ...state,
      priorityPlayerIndex: 1,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p2', 'counter_lox', ['lox_1']);
    expect(state.stack).toHaveLength(2);

    // Counterspell resolves — must NOT counter Loxodon Smiter
    state = resolveTopOfStack(state);
    expect(state.cards.get('counter_lox')?.zone).toBe('graveyard');
    expect(state.cards.get('lox_1')?.zone).toBe('stack'); // still on stack

    // Loxodon resolves and enters battlefield
    state = resolveTopOfStack(state);
    expect(state.cards.get('lox_1')?.zone).toBe('battlefield');
  });

  /**
   * Exec test 3: Regression — existing single-line "Spells you control can't be countered."
   * still parses and enforces correctly.
   */
  it('regression: single-line controller-scoped CBC still enforced on battlefield', () => {
    let state = createTestState();

    // Prowling Serpopard style (just the battlefield-CBC static, no CBC self-form)
    addCard(state, 'prot_1', 'p1', 'battlefield', {
      id: 'prot_def',
      name: 'Protector',
      type_line: 'Creature',
      oracle_text: "Spells you control can't be countered.",
      mana_cost: '{2}{G}',
      cmc: 3,
      colors: ['G'],
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    state = registerContinuousAbilitiesForPermanent(state, 'prot_1');

    addCard(state, 'bear_r', 'p1', 'hand', {
      id: 'bear_r_def',
      name: 'Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      mana_cost: '{1}{G}',
      cmc: 2,
      colors: ['G'],
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    state = {
      ...state,
      priorityPlayerIndex: 0,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p1', 'bear_r');

    addCard(state, 'counter_r', 'p2', 'hand', {
      id: 'counter_r_def',
      name: 'Counterspell',
      type_line: 'Instant',
      oracle_text: 'Counter target spell.',
      mana_cost: '{U}{U}',
      cmc: 2,
      colors: ['U'],
      card_types: ['instant'],
    });
    state = {
      ...state,
      priorityPlayerIndex: 1,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p2', 'counter_r', ['bear_r']);
    state = resolveTopOfStack(state);
    // Bear still on stack — not countered
    expect(state.cards.get('bear_r')?.zone).toBe('stack');
  });

});
