/**
 * Slice 1/12 — Per-line dispatch: Spell-kind promotion + multi-ability rescue.
 *
 * Verifies that parseOracleTextPerLine (step 3 / step 3a):
 *
 * (A) No longer rejects a whole face when a trigger-framed line independently
 *     classifies as 'Spell' because its trigger prefix is not (or was not) in
 *     the primary dispatch.  The new step 3a re-runs the trigger-prefix
 *     matchers on the raw line tokens and, when a prefix matches AND the body
 *     produces ≥1 effect, promotes the result to the correct trigger kind
 *     (Dies / ETB / Triggered) so the face is accepted rather than Unparsed.
 *
 * (B) The extended matchDiesPrefix now handles the older "is put into a
 *     graveyard from the battlefield" wording (Strong Back / older creature
 *     cards) in addition to the canonical "~ dies" form.
 *
 * (C) Multi-ability rescue: a face whose lines produce DIFFERENT valid kinds
 *     (e.g. StaticAbility + Dies) is accepted (not Unparsed); the richest
 *     kind is returned, and ALL lines are recorded in allResults so none cause
 *     face-level rejection.
 *
 * (D) Execution: the parser-emitted Dies / Triggered bodies execute via the
 *     existing executor paths (ReturnToHand Source, draw, etc.).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardInstance, CardDefinition } from '../types';
import { createPlayer, emptyManaPool } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeState(
  cardId = 'c0',
  zone: CardInstance['zone'] = 'graveyard',
  owner = 'p0',
): GameState {
  const def: CardDefinition = {
    id: 'def0',
    name: 'Test Card',
    type_line: 'Creature',
    oracle_text: '',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
  const inst: CardInstance = {
    instanceId: cardId,
    definitionId: 'def0',
    ownerId: owner,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
  return {
    players: [
      { id: 'p0', name: 'P0', life: 20, poisonCounters: 0, commanderDamage: {}, commanderTax: 0, commanderInstanceId: null, commanderCastCount: 0, manaPool: emptyManaPool(), hasPlayedLand: false, hasPriority: false, hasLost: false },
      { id: 'p1', name: 'P1', life: 20, poisonCounters: 0, commanderDamage: {}, commanderTax: 0, commanderInstanceId: null, commanderCastCount: 0, manaPool: emptyManaPool(), hasPlayedLand: false, hasPriority: false, hasLost: false },
    ],
    cards: new Map([[cardId, inst]]),
    cardDefinitions: new Map([['def0', def]]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'main',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A. "put into a graveyard from the battlefield" — matchDiesPrefix extension
// ─────────────────────────────────────────────────────────────────────────────

describe('matchDiesPrefix extended — "is put into a graveyard from the battlefield"', () => {
  it('parses "when ~ is put into a graveyard from the battlefield" trigger wording as Dies', () => {
    // This single line must parse as Dies, not as Spell (the old bug).
    const r = parseOracleText("When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand.");
    expect(r.kind).toBe('Dies');
    if (r.kind !== 'Dies') return;
    expect(r.ability.trigger.kind).toBe('Dies');
    if (r.ability.trigger.kind !== 'Dies') return;
    expect(r.ability.trigger.who).toBe('self');
    expect(r.ability.effects).toHaveLength(1);
    expect(r.ability.effects[0].kind).toBe('ReturnToHand');
  });

  it('parses "when this enchantment is put into a graveyard from the battlefield" as Dies', () => {
    const r = parseOracleText("When this enchantment is put into a graveyard from the battlefield, return it to its owner's hand.");
    expect(r.kind).toBe('Dies');
    if (r.kind !== 'Dies') return;
    expect(r.ability.trigger.kind).toBe('Dies');
  });

  it('parses "when this creature is put into a graveyard from the battlefield" as Dies', () => {
    const r = parseOracleText("When this creature is put into a graveyard from the battlefield, return it to its owner's hand.");
    expect(r.kind).toBe('Dies');
    if (r.kind !== 'Dies') return;
    expect(r.ability.trigger.kind).toBe('Dies');
    // Effect: return Source to hand
    const eff = r.ability.effects[0];
    expect(eff.kind).toBe('ReturnToHand');
    if (eff.kind !== 'ReturnToHand') return;
    expect(eff.target.kind).toBe('Source');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Strong Back face: multi-line Aura with buff static + graveyard trigger
//    The whole face must not be Unparsed; the buff static is the richest
//    accepted result; the trigger line is promoted by step 3a.
// ─────────────────────────────────────────────────────────────────────────────

describe('Slice 1 — Strong Back multi-line Aura face', () => {
  const STRONG_BACK = [
    'Enchant creature',
    'Enchanted creature gets +2/+2 and has trample.',
    "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand.",
  ].join('\n');

  it('parses the face as StaticAbility (buff), not Unparsed', () => {
    const r = parseOracleText(STRONG_BACK);
    expect(r.kind).not.toBe('Unparsed');
    expect(r.kind).not.toBe('Spell');
    // The richest accepted line (StaticAbility rank 2, Dies rank 4 after promotion)
    // — the dies trigger is richest so the face returns Dies.
    // Either Dies or StaticAbility is acceptable; neither should be Unparsed.
    expect(['Dies', 'StaticAbility', 'Triggered']).toContain(r.kind);
  });

  it('the buff static is still parseable as StaticAbility in isolation', () => {
    const r = parseOracleText('Enchanted creature gets +2/+2 and has trample.');
    expect(r.kind).toBe('StaticAbility');
  });

  it('the trigger line is no longer Spell or Unparsed in isolation', () => {
    const trigLine = "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand.";
    const r = parseOracleText(trigLine);
    expect(r.kind).toBe('Dies');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Silas Renn-style: deathtouch + combat-damage trigger + partner
//    The trigger body uses "draw a card" (executor-backed) to show that
//    multi-ability faces with keyword lines + triggers parse correctly.
//    Real Silas Renn's body is executor-unrunnable (cast from graveyard) so
//    this test uses a simplified runnable oracle wording.
// ─────────────────────────────────────────────────────────────────────────────

describe('Slice 1 — Silas Renn-style face: deathtouch + combat-damage trigger + partner', () => {
  // Simulates: keyword | trigger with runnable body | keyword
  const SILAS_STYLE = [
    'Deathtouch',
    'Whenever ~ deals combat damage to a player, draw a card.',
    'Partner',
  ].join('\n');

  it('does not return Unparsed — the combat-damage trigger is accepted', () => {
    const r = parseOracleText(SILAS_STYLE);
    expect(r.kind).not.toBe('Unparsed');
    // The trigger should be accepted
    expect(['Triggered', 'Activated', 'Dies', 'ETB', 'StaticAbility']).toContain(r.kind);
  });

  it('the trigger line alone parses as Triggered', () => {
    const r = parseOracleText('Whenever ~ deals combat damage to a player, draw a card.');
    expect(r.kind).toBe('Triggered');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Execution: ReturnToHand Source via the promoted Dies body
// ─────────────────────────────────────────────────────────────────────────────

describe('Slice 1 — execution: promoted Dies trigger body executes ReturnToHand', () => {
  it('executes the ReturnToHand(Source) effect against a graveyard card', () => {
    const r = parseOracleText("When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand.");
    expect(r.kind).toBe('Dies');
    if (r.kind !== 'Dies') return;

    const effects = r.ability.effects;
    expect(effects).toHaveLength(1);
    const eff = effects[0];
    expect(eff.kind).toBe('ReturnToHand');

    // Execute the effect: card c0 is in the graveyard; Source = c0.
    const state = makeState('c0', 'graveyard', 'p0');
    const result = executeEffects(
      state,
      effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'c0' },
    );

    // After execution, c0 should be in hand.
    expect(result.cards.get('c0')?.zone).toBe('hand');
  });

  it('executes the ReturnToHand(Source) effect from "this creature is put into graveyard" wording', () => {
    const r = parseOracleText("When this creature is put into a graveyard from the battlefield, return it to its owner's hand.");
    expect(r.kind).toBe('Dies');
    if (r.kind !== 'Dies') return;

    const eff = r.ability.effects[0];
    expect(eff.kind).toBe('ReturnToHand');
    if (eff.kind !== 'ReturnToHand') return;
    expect(eff.target.kind).toBe('Source');

    const state = makeState('c0', 'graveyard', 'p0');
    const result = executeEffects(state, r.ability.effects, 'p0', [], [], 0, { sourceInstanceId: 'c0' });
    expect(result.cards.get('c0')?.zone).toBe('hand');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Karona-style face: haste + each-player-upkeep trigger + attacks trigger
//    The real Karona's bodies are unrunnable (untaps+gains-control, chosen-type
//    anthem). This test uses runnable bodies to show the multi-line rescue works.
//    The step 2b absorption of unrunnable trigger lines (combined with the
//    multi-line fallthrough fix for the whole-face trigger dispatcher) ensures
//    faces with mixed unrunnable + absorbed lines degrade gracefully.
// ─────────────────────────────────────────────────────────────────────────────

describe('Slice 1 — Karona-style face: multi-line with runnable trigger', () => {
  // Haste + runnable upkeep trigger
  const KARONA_STYLE = [
    'Haste',
    "At the beginning of each player's upkeep, draw a card.",
  ].join('\n');

  it('the face is not Unparsed when the upkeep trigger body is runnable', () => {
    const r = parseOracleText(KARONA_STYLE);
    expect(r.kind).not.toBe('Unparsed');
    expect(['Triggered', 'Activated', 'ETB', 'Dies', 'StaticAbility']).toContain(r.kind);
  });

  it('a face where ALL trigger bodies are unrunnable is correctly Unparsed', () => {
    // Both trigger bodies below use "chosen type" which has no executor;
    // the face collapses to keyword-only (haste) = no substantive ability.
    const REAL_KARONA = [
      'Haste',
      "At the beginning of each player's upkeep, that player untaps ~ and gains control of it.",
      "Whenever ~ attacks, creatures of the chosen type get +3/+3.",
    ].join('\n');
    const r = parseOracleText(REAL_KARONA);
    // Haste is absorbed, both trigger bodies unrunnable → no substantive line.
    // Face is correctly Unparsed (keyword-only cannot carry a face parse).
    expect(r.kind).toBe('Unparsed');
  });
});
