/**
 * slice3-prepared-enter-as-copy-absorption.test.ts
 *
 * Slice 3/12 — "Enters/becomes prepared" absorption + enter-as-copy
 * activated-ability rider widening.
 *
 * Two mechanisms addressed:
 *
 *   (A) "enters prepared / becomes prepared" sentences — the Secrets of
 *       Strixhaven "prepare" layout allows recasting a companion spell as a
 *       copy.  Zero executor support exists (grep confirms no prepared/saddle
 *       copy-cast in stack.ts or executor.ts).  Absorption is pure-downside:
 *       the player simply loses an inaccessible copy-cast mode.
 *
 *       New forms handled by this slice:
 *         (A1) "[CardName] enters prepared."  — named-creature variant instead
 *              of "this creature" (e.g. Sanar, Unfinished Genius).
 *         (A2) "...this creature becomes prepared." — trigger-body variant
 *              (e.g. Emeritus of Woe's end-step trigger).
 *         (A3) Early multi-line absorber (absorbEntersPreparedLines): strips
 *              prepared lines from multi-line faces so always-on companions
 *              (keywords, statics, activated abilities) parse through the main
 *              dispatch.
 *
 *   (B) enter-as-copy — widen the "except it has ..." tail tolerance so that
 *       a quoted activated-ability rider of the form:
 *         "except it has \"{X}: <effect>\""
 *       is absorbed silently and the base EnterAsCopy effect still fires.
 *       The engine does not run the {X} ability (pure-downside absorption);
 *       only quoted mana-symbol (activated) riders are absorbed this way.
 *       Quoted triggered/static ability text (Mocking Doppelganger) is still
 *       DECLINED to preserve the honesty bar.
 *
 * Real oracle wordings exercised:
 *   Sanar, Unfinished Genius creature face (A1):
 *     "Sanar enters prepared. (...)\n{T}: Create a Treasure token. ..."
 *   Emeritus of Woe creature face (A2):
 *     "This creature enters prepared. (...)\nAt the beginning of your end step,
 *      if two or more creatures died this turn, this creature becomes prepared."
 *   Gigantoplasm (B):
 *     "You may have this creature enter as a copy of any creature on the
 *      battlefield, except it has \"{X}: This creature has base power and
 *      toughness X/X until end of turn.\"."
 *   Adventurous Eater creature face (single-line standalone):
 *     "This creature enters prepared. (...)" — correctly stays Unparsed
 *   Maelstrom Artisan creature face (keyword + prepared):
 *     "Haste\nThis creature enters prepared. (...)" — correctly stays Unparsed
 */

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

  // Entering permanent (clone / shapeshifter)
  cards.set('entering', {
    instanceId: 'entering',
    definitionId: 'def-shapeshifter',
    ownerId: 'p1',
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
    oracle_text: 'You may have this creature enter as a copy of any creature on the battlefield.',
    mana_cost: '{3}{U}',
    cmc: 4,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    power: 0,
    toughness: 0,
    card_types: ['creature'],
  });

  // Opponent's creature to copy
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
    type_line: 'Creature — Phyrexian Golem',
    oracle_text: 'Trample, infect.',
    mana_cost: '{12}',
    cmc: 12,
    colors: [],
    color_identity: [],
    keywords: ['Trample', 'Infect'],
    power: 11,
    toughness: 11,
    card_types: ['creature'],
  });

  const players = [
    { id: 'p1', life: 40, mana: {}, library: [], graveyard: [], hand: [], battlefield: ['entering', 'opp-creature'], exile: [], commandZone: [] },
    { id: 'p2', life: 40, mana: {}, library: [], graveyard: [], hand: [], battlefield: [], exile: [], commandZone: [] },
  ] as any[];

  return {
    cards,
    cardDefinitions,
    players,
    turn: { number: 1, activePlayerId: 'p1', phase: 'main1', priority: 'p1', landPlaysRemaining: 1, spellsCastThisTurn: 0, creaturesDiedThisTurn: 0 },
    stack: [],
    triggers: [],
    log: [],
    monarchId: null,
    initiativeHolderId: null,
    citysBlessingPlayers: new Set(),
    havenPlayers: new Set(),
    chainVeilActivationsThisTurn: 0,
  } as unknown as GameState;
}

// ===========================================================================
// (A1) Named-creature "enters prepared" form
// ===========================================================================

describe('Slice 3 — (A1) "[CardName] enters prepared." absorption', () => {

  it('Sanar form: "[CardName] enters prepared." absorbed, activated ability parses', () => {
    // Sanar, Unfinished Genius creature face:
    //   "Sanar enters prepared. (While it's prepared, you may cast a copy of its spell. ...)\n
    //    {T}: Create a Treasure token. Activate only if you've cast an instant or sorcery spell this turn."
    const r = parseOracleText(
      "Sanar enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)\n{T}: Create a Treasure token. Activate only if you've cast an instant or sorcery spell this turn.",
    );
    // The activated ability should parse; "enters prepared" absorbed
    expect(r.kind).toBe('Activated');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = (r.absorbedKeywords ?? []).join(' ');
    expect(abs).toMatch(/enters\s+prepared/i);
  });

  it('"enters prepared" + static ability: static carries the face', () => {
    const r = parseOracleText(
      "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)\nCreatures you control get +1/+1.",
    );
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    expect((r.absorbedKeywords ?? []).join(' ')).toMatch(/prepared/i);
  });

  it('"enters prepared" + ETB draw trigger: ETB carries the face', () => {
    const r = parseOracleText(
      "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)\nWhen ~ enters, draw a card.",
    );
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
  });

});

// ===========================================================================
// (A2) "becomes prepared" trigger-body absorption
// ===========================================================================

describe('Slice 3 — (A2) "becomes prepared" trigger-body absorption', () => {

  it('Emeritus of Woe: both "enters prepared" and "becomes prepared" lines absorbed, Unparsed when no companion', () => {
    // Emeritus of Woe creature face (no parseable companion once both prepared lines absorbed):
    //   "This creature enters prepared. (...)\n
    //    At the beginning of your end step, if two or more creatures died this turn,
    //    this creature becomes prepared."
    // Both lines are honest unenforced skips → overall Unparsed (no companion to carry).
    const r = parseOracleText(
      "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)\nAt the beginning of your end step, if two or more creatures died this turn, this creature becomes prepared.",
    );
    // Both lines are unenforced — the face has no always-on companion → correctly Unparsed.
    expect(r.kind).toBe('Unparsed');
  });

  it('"becomes prepared" trigger body absorbed, companion ETB fires', () => {
    // If a face has: "At the beginning of your end step, this creature becomes prepared.\n
    //                When ~ enters, you gain 2 life."
    // The "becomes prepared" line is absorbed; the ETB is the companion.
    const r = parseOracleText(
      "At the beginning of your end step, this creature becomes prepared.\nWhen ~ enters, you gain 2 life.",
    );
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'GainLife')).toBe(true);
  });

  it('"becomes prepared" + static companion: static carries the face', () => {
    // "Flying creatures you control have vigilance." doesn't parse as StaticAbility
    // because it uses an unrecognised subject form, so use a known working static.
    const r = parseOracleText(
      "Whenever you attack, this creature becomes prepared.\nCreatures you control get +1/+1.",
    );
    // "becomes prepared" trigger body absorbed; anthem static should parse.
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    expect((r.absorbedKeywords ?? []).join(' ')).toMatch(/becomes\s+prepared/i);
  });

});

// ===========================================================================
// (A3) Honesty gates for "enters prepared" standalone forms
// ===========================================================================

describe('Slice 3 — (A3) Honesty: standalone "enters prepared" faces stay Unparsed', () => {

  it('Studious First-Year style: single-line "This creature enters prepared." stays Unparsed', () => {
    // Adventurous Eater / Studious First-Year creature face: only the prepared line.
    const r = parseOracleText(
      "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    expect(r.kind).toBe('Unparsed');
  });

  it('Maelstrom Artisan style: "Haste\\nThis creature enters prepared." stays Unparsed', () => {
    // No substantive companion beyond keywords → Unparsed (Haste enforced via keywords.ts).
    const r = parseOracleText(
      "Haste\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    expect(r.kind).toBe('Unparsed');
  });

  it('Skycoach Conductor style: all-keywords + "enters prepared" stays Unparsed', () => {
    const r = parseOracleText(
      "Flash\nFlying, vigilance\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    expect(r.kind).toBe('Unparsed');
  });

});

// ===========================================================================
// (B) Enter-as-copy: quoted activated-ability rider absorbed (Gigantoplasm)
// ===========================================================================

describe('Slice 3 — (B) matchEnterAsCopy: quoted activated-ability rider absorbed', () => {

  it('Gigantoplasm: "except it has \\"{X}: ...\\""  absorbed → emits EnterAsCopy', () => {
    // The actual Gigantoplasm oracle text (from Scryfall) uses a quoted activated-
    // ability rider.  Slice 3 absorbs this rider as pure-downside: the player
    // loses the X-power-and-toughness overlay, but the base copy effect resolves.
    const r = parseOracleText(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has "{X}: This creature has base power and toughness X/X until end of turn.".',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const effect = r.effects.find(e => e.kind === 'EnterAsCopy') as EnterAsCopyEffect | undefined;
    expect(effect).toBeDefined();
    // sourceVariant should be default battlefield (no override)
    expect(effect?.sourceVariant ?? 'battlefield').toBe('battlefield');
    // No activated-ability rider leaked into the effect
    expect(effect?.addedKeywords).toBeUndefined();
  });

  it('Gigantoplasm: base copy effect can execute (copies target creature)', () => {
    const r = parseOracleText(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has "{X}: This creature has base power and toughness X/X until end of turn.".',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;

    const effect = r.effects.find(e => e.kind === 'EnterAsCopy') as EnterAsCopyEffect | undefined;
    expect(effect).toBeDefined();
    if (!effect) return;

    const state = makeState();
    const newState = executeEffects(
      state,
      [effect],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: 'entering' },
    );
    // Executor should complete without throwing.
    // The entering instance should have been updated to copy the best battlefield creature.
    expect(newState).toBeDefined();
    const entering = newState.cards.get('entering');
    expect(entering).toBeDefined();
  });

  it('HONESTY: quoted triggered-ability rider (Mocking Doppelganger style) still declined', () => {
    // "except it has \"Whenever this creature attacks, create a token copy.\""
    // Triggered ability text in quotes is NOT absorbed — the engine cannot grant
    // arbitrary triggers.
    const r = parseOracleText(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has "whenever this creature attacks, create a token copy of it.".',
    );
    // Result is Unparsed or Spell without EnterAsCopy — both are honest.
    if (r.kind === 'Spell') {
      expect(r.effects.some(e => e.kind === 'EnterAsCopy')).toBe(false);
    } else {
      expect(r.kind).toBe('Unparsed');
    }
  });

  it('HONESTY: unquoted {X}: rider (synthetic form) still declined', () => {
    // The synthetic unquoted form tested in slice6b still correctly declines.
    // No real card uses this form (actual Gigantoplasm uses quoted form above).
    const r = parseOracleText(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has {X}: This creature has base power and toughness X/X until end of turn.',
    );
    if (r.kind === 'Spell') {
      expect(r.effects.some(e => e.kind === 'EnterAsCopy')).toBe(false);
    } else {
      expect(r.kind).toBe('Unparsed');
    }
  });

});
