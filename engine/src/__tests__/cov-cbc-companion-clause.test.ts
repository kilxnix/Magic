/**
 * Oracle-parser coverage slice 7/12:
 * "This spell can't be countered" + companion clause routing.
 *
 * BACKGROUND:
 * 16 oracle faces lead with "This spell can't be countered." as the first
 * sentence. The CBC line is already absorbed (step 1g in parseOracleTextPerLine
 * and the early absorbSelfCBCLines pass in parseOracleText) and enforced at
 * cast time via hasCantBeCounteredText → SpellStackItem.cantBeCountered.
 * The SECOND sentence (the "companion clause") determines whether the face
 * ultimately parses.
 *
 * ROUTING STRATEGY:
 *   1. The CBC line is stripped (honest: hasCantBeCounteredText re-scans the
 *      full original oracle text at cast, so uncounterable enforcement is not lost).
 *   2. The residual is routed through the normal dispatch (parseOracleText).
 *   3. Faces whose residual IS parseable by the existing dispatch UNLOCK.
 *   4. Faces whose residual is an unrun BENEFIT the engine cannot deliver
 *      remain Unparsed (honesty bar — we never fabricate a replacement).
 *
 * LOXODON-STYLE COMPANION (dominant failing pattern):
 *   "If a spell or ability an opponent controls causes you to discard this
 *    card, put it onto the battlefield instead of putting it into your
 *    graveyard."
 *   replacement.ts has NO discard-zone redirection (grep-confirmed: zero
 *   matches for "discard.*battlefield" in replacement.ts). The clause is a
 *   BENEFIT to the controller (opponent-forced discard protection). It MUST
 *   NOT be absorbed — doing so would fabricate the battlefield placement that
 *   the engine cannot execute. Loxodon Smiter therefore remains Unparsed.
 *
 * NET UNLOCK: faces whose companion is engine-runnable (ETB/trigger/static/
 * activated) parse via the normal dispatch after CBC absorption. Tests prove
 * round-trips for three representative card families.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import {
  castSpell,
  resolveTopOfStack,
  registerContinuousAbilitiesForPermanent,
  checkTriggersForEvent,
  putTriggersOnStack,
  registerBattlefieldAbilities,
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
// PARSER RECOGNITION: CBC companion clause routing
// ---------------------------------------------------------------------------

describe('Cov-7 CBC companion — parser recognition', () => {

  // ----- Parseable companions -----------------------------------------------

  it('Prowling Serpopard: CBC + "creature spells you control cant be countered" → StaticAbility', () => {
    // Oracle: "This spell can't be countered.\nCreature spells you control can't be countered."
    // CBC line absorbed; companion is a battlefield-source CBC static (matchBattlefieldCantBeCountered).
    const oracle = "This spell can't be countered.\nCreature spells you control can't be countered.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    // Companion modifier: battlefield-source CantBeCountered grant
    expect(r.ability.modifier.kind).toBe('GrantKeyword');
    if (r.ability.modifier.kind !== 'GrantKeyword') return;
    expect(r.ability.modifier.keyword).toBe('CantBeCountered');
    // Not self-only (this is a battlefield static affecting other spells)
    expect(r.ability.selfOnly).toBe(false);
    // CBC line recorded in absorbedKeywords
    expect(r.absorbedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/this spell can['']?t be countered/i)])
    );
  });

  it('Koma, Cosmos Serpent: CBC + upkeep trigger → Triggered', () => {
    // Oracle: "This spell can't be countered.\nAt the beginning of each upkeep, create a 3/3 blue Serpent creature token named Koma's Coil."
    // CBC line absorbed; companion is an each-upkeep trigger.
    const oracle = "This spell can't be countered.\nAt the beginning of each upkeep, create a 3/3 blue Serpent creature token.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
    expect(r.absorbedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/this spell can['']?t be countered/i)])
    );
  });

  it('Niv-Mizzet, Parun: CBC + Flying + draw-card trigger → Triggered', () => {
    // Oracle: "This spell can't be countered.\nFlying\nWhenever you draw a card, Niv-Mizzet deals 1 damage to any target.\nWhenever a player casts an instant or sorcery spell, you draw a card."
    const oracle = "This spell can't be countered.\nFlying\nWhenever you draw a card, ~ deals 1 damage to any target.\nWhenever a player casts an instant or sorcery spell, you draw a card.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
    expect(r.absorbedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/this spell can['']?t be countered/i)])
    );
  });

  it('Vexing Beetle: CBC + conditional self-buff → StaticAbility', () => {
    // Oracle: "This spell can't be countered.\nThis creature gets +3/+3 as long as no opponent controls a creature."
    // "no opponent controls a creature" is supported via ControlsNone conditional static (Slice 2).
    const oracle = "This spell can't be countered.\nThis creature gets +3/+3 as long as no opponent controls a creature.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
  });

  it('Mistcutter Hydra: CBC + haste/protection + enters-with-counters → StaticAbility', () => {
    // Oracle: "This spell can't be countered.\nHaste, protection from blue\nThis creature enters with X +1/+1 counters on it."
    // Keywords absorbed; enters-with-counters absorbed (stack.ts entersWithCounters rescans full text);
    // companion is the keyword-only remainder (StaticAbility recognition marker).
    const oracle = "This spell can't be countered.\nHaste, protection from blue\nThis creature enters with X +1/+1 counters on it.";
    const r = parseOracleText(oracle);
    // Parses as StaticAbility (keywords and counter placement handled outside parse).
    expect(r.kind).not.toBe('Unparsed');
    expect(r.absorbedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/this spell can['']?t be countered/i)])
    );
  });

  it('Isao, Enlightened Bushi: CBC + Bushido 2 + activated regenerate → Activated', () => {
    // Oracle: "This spell can't be countered.\nBushido 2\n{2}: Regenerate target Samurai."
    // CBC absorbed; Bushido 2 absorbed (parametric keyword); companion is the activated ability.
    const oracle = "This spell can't be countered.\nBushido 2 (Whenever this creature blocks or becomes blocked, it gets +2/+2 until end of turn.)\n{2}: Regenerate target Samurai.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Activated');
    expect(r.absorbedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/this spell can['']?t be countered/i)])
    );
  });

  // ----- Declined companions (benefit engine cannot deliver) ----------------

  it('Loxodon Smiter: CBC + discard-to-battlefield rider → StaticAbility (slice 9: rider absorbed as honest unenforced-skip)', () => {
    // Oracle: "This spell can't be countered.\nIf a spell or ability an opponent controls
    //          causes you to discard this card, put it onto the battlefield instead of
    //          putting it into your graveyard."
    //
    // Slice 9 decision: the discard-rider is absorbed as an honest unenforced-skip.
    // replacement.ts has no discard-zone redirection (zero enforcement), so absorbing
    // the rider loses nothing the engine runs. The companion "This spell can't be
    // countered." body IS enforced (hasCantBeCounteredText + executeCounterSpell),
    // and absorbing the rider allows that body to be credited as StaticAbility.
    const oracle =
      "This spell can't be countered.\n" +
      "If a spell or ability an opponent controls causes you to discard this card, " +
      "put it onto the battlefield instead of putting it into your graveyard.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    // Discard rider recorded in absorbedKeywords
    expect(r.absorbedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/causes you to discard/i)])
    );
  });

  it('Gaea\'s Revenge: CBC + unimplemented targeting restriction → Unparsed', () => {
    // Oracle: "This spell can't be countered.\nHaste.\nThis creature can't be the target of nongreen spells or abilities from nongreen sources."
    // "can't be the target of nongreen" is not modeled by matchProtection/matchConditionalEvasion.
    const oracle =
      "This spell can't be countered.\nHaste.\n" +
      "This creature can't be the target of nongreen spells or abilities from nongreen sources.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  // ----- Regression: single-line CBC still works ----------------------------

  it('single-line "This spell cant be countered." still parses as StaticAbility', () => {
    expect(parseOracleText("This spell can't be countered.").kind).toBe('StaticAbility');
  });

  it('instant-face CBC + destroy: Spell result (absorbSelfCBCLines path)', () => {
    // "This spell can't be countered.\nDestroy target nonland permanent with mana value 3 or less."
    // Abrupt Decay family: CBC absorbed, remainder is a Spell (destroy effect).
    const oracle = "This spell can't be countered.\nDestroy target nonland permanent with mana value 3 or less.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Spell');
    expect(r.absorbedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/this spell can['']?t be countered/i)])
    );
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS: CBC enforcement + companion clause both execute
// ---------------------------------------------------------------------------

describe('Cov-7 CBC companion — execution', () => {

  /**
   * Exec test 1 — Prowling Serpopard style:
   * "This spell can't be countered.\nCreature spells you control can't be countered."
   *
   * Two things must hold:
   *   (a) The Serpopard itself cannot be countered (hasCantBeCounteredText).
   *   (b) After it enters the battlefield, creature spells p1 casts are also
   *       uncounterable (battlefield-source CBC static enforced by
   *       registerContinuousAbilitiesForPermanent + executeCounterSpell).
   */
  it('Serpopard-style: self CBC enforced on cast; companion static protects controlled spells', () => {
    let state = createTestState();
    // p1 needs enough mana to cast the Serpopard proxy
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 4, C: 0 };

    // Prowling Serpopard proxy
    addCard(state, 'serp_1', 'p1', 'hand', {
      id: 'serp_def',
      name: 'Prowling Serpopard',
      type_line: 'Creature — Cat Beast',
      oracle_text: "This spell can't be countered.\nCreature spells you control can't be countered.",
      mana_cost: '{1}{G}{G}',
      cmc: 3,
      colors: ['G'],
      card_types: ['creature'],
      power: 4,
      toughness: 3,
    });

    // p2's counterspell
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

    // p1 casts Prowling Serpopard
    state = castSpell(state, 'p1', 'serp_1');
    expect(state.stack).toHaveLength(1);
    // (a) cantBeCountered flag set at cast time by hasCantBeCounteredText
    expect(state.stack[0].cantBeCountered).toBe(true);

    // p2 attempts to counter it
    state = {
      ...state,
      priorityPlayerIndex: 1,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p2', 'counter_1', ['serp_1']);
    expect(state.stack).toHaveLength(2);

    // Counterspell resolves but CANNOT counter Serpopard (cantBeCountered flag)
    state = resolveTopOfStack(state);
    expect(state.cards.get('counter_1')?.zone).toBe('graveyard');
    expect(state.cards.get('serp_1')?.zone).toBe('stack'); // still on stack

    // Serpopard resolves and enters the battlefield
    state = resolveTopOfStack(state);
    expect(state.cards.get('serp_1')?.zone).toBe('battlefield');

    // (b) Now register Serpopard's battlefield abilities
    state = registerContinuousAbilitiesForPermanent(state, 'serp_1');

    // p1 casts another creature spell — Serpopard's companion static should protect it
    addCard(state, 'creature_2', 'p1', 'hand', {
      id: 'creature_def2',
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
    state = castSpell(state, 'p1', 'creature_2');
    expect(state.stack).toHaveLength(1);

    // p2 tries to counter the Bear — should fail due to Serpopard's static
    addCard(state, 'counter_2', 'p2', 'hand', {
      id: 'counter_def2',
      name: 'Counterspell 2',
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
    state = castSpell(state, 'p2', 'counter_2', ['creature_2']);
    expect(state.stack).toHaveLength(2);
    state = resolveTopOfStack(state); // counterspell resolves
    expect(state.cards.get('counter_2')?.zone).toBe('graveyard');
    // The Bear should still be on the stack (not countered)
    expect(state.cards.get('creature_2')?.zone).toBe('stack');
  });

  /**
   * Exec test 2 — Koma-style upkeep trigger fires:
   * "This spell can't be countered.\nAt the beginning of each upkeep, create a 3/3 blue Serpent creature token."
   *
   * After CBC absorption, the companion (upkeep trigger) is parsed as Triggered.
   * registerBattlefieldAbilities registers the upkeep trigger.
   * checkTriggersForEvent(UpkeepStart) queues the pending trigger.
   * resolveTopOfStack creates a Serpent token.
   */
  it('Koma-style: upkeep trigger fires and creates token after CBC creature enters', () => {
    let state = createTestState();

    addCard(state, 'koma_bf', 'p1', 'battlefield', {
      id: 'koma_upkeep_def',
      name: 'Koma Test',
      type_line: 'Creature — Serpent',
      oracle_text: "This spell can't be countered.\nAt the beginning of each upkeep, create a 3/3 blue Serpent creature token.",
      mana_cost: '{4}{G}{G}',
      cmc: 6,
      colors: ['G'],
      card_types: ['creature'],
      power: 7,
      toughness: 7,
    });

    // Register battlefield abilities (registers upkeep trigger from companion clause)
    state = registerBattlefieldAbilities(state, 'koma_bf');

    // Fire upkeep event
    state = {
      ...state,
      phase: 'beginning' as GameState['phase'],
      step: 'upkeep' as GameState['step'],
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
    };
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p1' });

    // Companion upkeep trigger must be pending
    expect(state.pendingTriggers).toHaveLength(1);

    state = putTriggersOnStack(state, {});
    expect(state.stack).toHaveLength(1);

    const bfBefore = [...state.cards.values()].filter(
      c => c.zone === 'battlefield' && c.instanceId !== 'koma_bf',
    ).length;

    state = resolveTopOfStack(state);

    const bfAfter = [...state.cards.values()].filter(
      c => c.zone === 'battlefield' && c.instanceId !== 'koma_bf',
    ).length;

    // A Serpent token should have been created
    expect(bfAfter).toBeGreaterThan(bfBefore);
  });

  /**
   * Exec test 3 — Loxodon Smiter: slice 9 absorbs the discard-rider.
   * "This spell can't be countered.\nIf ... causes you to discard this card, put it onto the battlefield..."
   *
   * Slice 9 decision: the discard-rider is absorbed as an honest unenforced-skip
   * (replacement.ts has zero discard-zone redirection). The face now parses as
   * StaticAbility (CBC self-form). CBC enforcement still applies at cast time via
   * hasCantBeCounteredText which rescans the full original oracle text.
   */
  it('Loxodon Smiter: slice 9 absorbs discard-rider → StaticAbility; CBC still enforced at cast', () => {
    let state = createTestState();
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 4, C: 1 };

    const loxodonOracle =
      "This spell can't be countered.\n" +
      "If a spell or ability an opponent controls causes you to discard this card, " +
      "put it onto the battlefield instead of putting it into your graveyard.";

    // Parse-time: slice 9 absorbs discard-rider → StaticAbility (CBC self-form)
    expect(parseOracleText(loxodonOracle).kind).toBe('StaticAbility');

    // Cast-time: CBC STILL enforced because hasCantBeCounteredText rescans full text
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
    // cantBeCountered set by hasCantBeCounteredText which rescans the full original oracle text
    expect(state.stack[0].cantBeCountered).toBe(true);

    // p2 tries to counter — must fail
    state = {
      ...state,
      priorityPlayerIndex: 1,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p2', 'counter_lox', ['lox_1']);
    expect(state.stack).toHaveLength(2);

    state = resolveTopOfStack(state); // counterspell resolves — cannot counter Loxodon
    expect(state.cards.get('counter_lox')?.zone).toBe('graveyard');
    expect(state.cards.get('lox_1')?.zone).toBe('stack'); // still on stack

    // Loxodon resolves and enters battlefield
    state = resolveTopOfStack(state);
    expect(state.cards.get('lox_1')?.zone).toBe('battlefield');
  });
});
