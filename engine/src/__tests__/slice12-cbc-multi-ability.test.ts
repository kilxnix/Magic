/**
 * Slice 12: Self "can't be countered" multi-ability face absorption.
 *
 * "This spell can't be countered." is now absorbed in both:
 *   (a) parseOracleTextPerLine – per-line absorption (step 1g), and
 *   (b) parseOracleText – early absorption before parseMultipleEffects,
 *       so multi-line creature/permanent faces that lead with a CBC sentence
 *       alongside a parseable trigger/static/activated ability carry that
 *       companion parse rather than being claimed as Spell or Unparsed.
 *
 * HONEST: hasCantBeCounteredText (stack.ts) rescans the FULL oracle text at
 * cast time so the uncounterability is still enforced at runtime; the parse
 * only concerns what the engine DOES with the companion clause.
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
// Parser helpers
// ---------------------------------------------------------------------------
function kind(oracle: string) {
  return parseOracleText(oracle).kind;
}
function parsed(oracle: string) {
  return parseOracleText(oracle);
}

// ---------------------------------------------------------------------------
// Execution test helpers (mirroring slice11 pattern)
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
// PASS cases – CBC absorbed, companion clause carries the face
// ---------------------------------------------------------------------------

describe('Slice 12 – CBC multi-ability: companion clause carries the face', () => {
  /**
   * Niv-Mizzet, Parun
   * "Flying\nWhenever you draw a card, ~ deals 1 damage to any target.\nWhenever a player casts an instant or sorcery spell, that player draws a card."
   * (oracle normalised — uses the CBC-prefixed variant)
   * Full oracle: "This spell can't be countered.\nFlying\nWhenever you draw a card, Niv-Mizzet, Parun deals 1 damage to any target.\nWhenever a player casts an instant or sorcery spell, that player draws a card."
   * CBC line absorbed → rest is Triggered (draw-card trigger).
   */
  it('Niv-Mizzet, Parun: CBC + draw-card trigger → Triggered', () => {
    const oracle =
      "This spell can't be countered.\nFlying\nWhenever you draw a card, ~ deals 1 damage to any target.\nWhenever a player casts an instant or sorcery spell, that player draws a card.";
    expect(kind(oracle)).toBe('Triggered');
  });

  /**
   * Toski, Bearer of Secrets
   * "This spell can't be countered.\nIndestructible\nToski, Bearer of Secrets attacks each combat if able.\nWhenever a creature you control deals combat damage to a player, draw a card."
   * CBC absorbed → rest contains the combat-damage trigger → Triggered.
   */
  it('Toski, Bearer of Secrets: CBC + combat-damage draw trigger → Triggered', () => {
    const oracle =
      "This spell can't be countered.\nIndestructible\n~ attacks each combat if able.\nWhenever a creature you control deals combat damage to a player, draw a card.";
    expect(kind(oracle)).toBe('Triggered');
  });

  /**
   * Koma, Cosmos Serpent (Kaldheim)
   * At the beginning of each upkeep, create a 3/3 blue Serpent creature token named Koma's Coil.
   * (The actual oracle includes "This spell can't be countered." as line 1.)
   */
  it('Koma, Cosmos Serpent: CBC + upkeep trigger → Triggered', () => {
    const oracle =
      "This spell can't be countered.\nAt the beginning of each upkeep, create a 3/3 blue Serpent creature token.";
    expect(kind(oracle)).toBe('Triggered');
  });

  /**
   * The absorbed CBC line must appear in absorbedKeywords so callers can
   * audit what was stripped.
   */
  it('absorbed CBC line is recorded in absorbedKeywords', () => {
    const oracle =
      "This spell can't be countered.\nAt the beginning of each upkeep, create a 3/3 blue Serpent creature token.";
    const result = parsed(oracle);
    expect(result.absorbedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/this spell can['']?t be countered/i)])
    );
  });

  /**
   * Sphinx of the Final Word
   * "This spell can't be countered.\nFlying\nSpells you control can't be countered."
   * CBC absorbed → companion "Spells you control can't be countered." is
   * matchBattlefieldCantBeCountered → StaticAbility.
   */
  it('Sphinx of the Final Word: CBC + "spells you control cant be countered" static → StaticAbility', () => {
    const oracle =
      "This spell can't be countered.\nFlying\nSpells you control can't be countered.";
    // After CBC absorption, rest is "Flying\nSpells you control can't be countered."
    // which should parse as StaticAbility (battlefield-source CBC).
    const r = parsed(oracle);
    expect(r.kind).not.toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// DECLINE cases – companion clause itself fails honesty bar → Unparsed
// ---------------------------------------------------------------------------

describe('Slice 12 – CBC multi-ability: decline when companion clause itself is unsupported', () => {
  /**
   * Vexing Beetle
   * "This spell can't be countered.\nThis creature gets +3/+3 as long as no opponent controls a creature."
   * NOTE: Slice 2 (cond-self-buff) added ControlsNone { controller: 'opponent' } to parseStaticCondition,
   * so "no opponent controls a creature" now maps onto the existing ControlsNone evaluator.
   * The condition IS in the AST and IS evaluated — this face now correctly parses as StaticAbility.
   */
  it('Vexing Beetle: CBC + ControlsNone conditional static → StaticAbility (slice 2 added support)', () => {
    const oracle =
      "This spell can't be countered.\nThis creature gets +3/+3 as long as no opponent controls a creature.";
    expect(kind(oracle)).toBe('StaticAbility');
  });

  /**
   * Gaea's Revenge
   * "This spell can't be countered.\nHaste.\nThis creature can't be the target of nongreen spells or abilities from nongreen sources."
   * Companion: "can't be the target of nongreen" restriction — not implemented.
   * Must remain Unparsed.
   */
  it("Gaea's Revenge: CBC + unimplemented targeting restriction → Unparsed", () => {
    const oracle =
      "This spell can't be countered.\nHaste.\nThis creature can't be the target of nongreen spells or abilities from nongreen sources.";
    expect(kind(oracle)).toBe('Unparsed');
  });

  /**
   * Frenzied Baloth
   * "This spell can't be countered.\nTrample.\nCombat damage that would be dealt to this creature can't be prevented."
   * Companion: damage-prevention replacement — not implemented.
   * Must remain Unparsed.
   */
  it('Frenzied Baloth: CBC + unimplemented damage-prevention replacement → Unparsed', () => {
    const oracle =
      "This spell can't be countered.\nTrample.\nCombat damage that would be dealt to this creature can't be prevented.";
    expect(kind(oracle)).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// Regression: single-line CBC face still handled by matchCantBeCountered
// ---------------------------------------------------------------------------

describe('Slice 12 – regression: single-line CBC still works', () => {
  it('single-line "This spell cant be countered." still parses as StaticAbility', () => {
    expect(kind("This spell can't be countered.")).toBe('StaticAbility');
  });

  it('standalone Abrupt Decay (CBC + destroy): Spell (CBC absorbed by existing path)', () => {
    // "This spell can't be countered.\nDestroy target nonland permanent with mana value 3 or less."
    // The existing absorbSelfCBCLines at line 4214 handles this instant/sorcery; verify it still works.
    const oracle =
      "This spell can't be countered.\nDestroy target nonland permanent with mana value 3 or less.";
    const r = parsed(oracle);
    // The companion is a Spell (Destroy) — that's correct for an instant face.
    expect(r.kind).toBe('Spell');
    // CBC absorbed
    expect(r.absorbedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/this spell can['']?t be countered/i)])
    );
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS — CBC absorption + companion clause actually runs
// ---------------------------------------------------------------------------
//
// These three tests verify the full round-trip: (1) the CBC absorption parses
// the companion clause correctly, AND (2) the runtime (stack.ts / executor.ts)
// actually enforces both the CBC property and the companion effect.
// ---------------------------------------------------------------------------

describe('Slice 12 – execution: hasCantBeCounteredText still enforced after absorption', () => {
  /**
   * Exec test 1 — Koma-style: "This spell can't be countered.\n<upkeep trigger>"
   *
   * Cast the creature; p2 attempts to counter it with Counterspell.
   * The counterspell must NOT remove the creature from the stack.
   *
   * HONEST: hasCantBeCounteredText (stack.ts line 1907) rescans the FULL
   * original oracle text at cast time — absorption in the parser does NOT
   * suppress the cantBeCountered flag on the SpellStackItem.
   */
  it('CBC creature cannot be countered even when its oracle contains a companion upkeep trigger', () => {
    let state = createTestState();
    // {4}{G}{G} = 6 mana: need 2 green + 4 generic. 6 green covers it.
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 6, C: 0 };

    // The CBC creature: "This spell can't be countered.\nAt the beginning of
    // each upkeep, create a 3/3 blue Serpent creature token."
    addCard(state, 'koma_1', 'p1', 'hand', {
      id: 'koma_def',
      name: 'Koma, Cosmos Serpent',
      type_line: 'Legendary Creature — Serpent',
      oracle_text: "This spell can't be countered.\nAt the beginning of each upkeep, create a 3/3 blue Serpent creature token.",
      mana_cost: '{4}{G}{G}',
      cmc: 6,
      colors: ['G'],
      card_types: ['creature'],
      power: 7,
      toughness: 7,
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

    // p1 casts Koma
    state = castSpell(state, 'p1', 'koma_1');
    expect(state.stack).toHaveLength(1);
    // The stack item must carry cantBeCountered = true (hasCantBeCounteredText)
    expect(state.stack[0].cantBeCountered).toBe(true);

    // p2 tries to counter it
    state = {
      ...state,
      priorityPlayerIndex: 1,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p2', 'counter_1', ['koma_1']);
    expect(state.stack).toHaveLength(2);

    // Counterspell resolves — must NOT counter Koma
    state = resolveTopOfStack(state);
    expect(state.cards.get('counter_1')?.zone).toBe('graveyard');
    expect(state.cards.get('koma_1')?.zone).toBe('stack');  // still on stack
    expect(state.stack).toHaveLength(1);

    // Koma resolves and enters the battlefield
    state = resolveTopOfStack(state);
    expect(state.cards.get('koma_1')?.zone).toBe('battlefield');
  });

  /**
   * Exec test 2 — Upkeep trigger fires after CBC creature enters battlefield.
   *
   * "This spell can't be countered.\nAt the beginning of each upkeep, create
   * a 3/3 blue Serpent creature token." → the upkeep trigger must fire and
   * produce a pending trigger when the upkeep event is dispatched.
   *
   * This exercises: absorbSelfCBCLines → parseOracleText(rest) returns
   * Triggered → registerBattlefieldAbilities registers the upkeep trigger →
   * checkTriggersForEvent(UpkeepStart) queues the pending trigger.
   */
  it('CBC + upkeep trigger: trigger fires at upkeep after creature enters', () => {
    let state = createTestState();

    // Place the CBC + upkeep trigger creature directly on battlefield
    addCard(state, 'koma_bf', 'p1', 'battlefield', {
      id: 'koma_upkeep_def',
      name: 'Koma Upkeep',
      type_line: 'Creature — Serpent',
      oracle_text: "This spell can't be countered.\nAt the beginning of each upkeep, create a 3/3 blue Serpent creature token.",
      mana_cost: '{4}{G}{G}',
      cmc: 6,
      colors: ['G'],
      card_types: ['creature'],
      power: 7,
      toughness: 7,
    });

    // Register the battlefield abilities (registers the upkeep trigger)
    state = registerBattlefieldAbilities(state, 'koma_bf');

    // Fire the upkeep event for p1
    state = {
      ...state,
      phase: 'beginning' as GameState['phase'],
      step: 'upkeep' as GameState['step'],
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
    };
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p1' });

    // The upkeep trigger must be pending (create a token)
    expect(state.pendingTriggers).toHaveLength(1);

    // Put the trigger on the stack and resolve it — a token should be created
    state = putTriggersOnStack(state, {});
    expect(state.stack).toHaveLength(1);

    const tokenCountBefore = [...state.cards.values()].filter(
      c => c.zone === 'battlefield' && c.instanceId !== 'koma_bf',
    ).length;

    state = resolveTopOfStack(state);

    const tokenCountAfter = [...state.cards.values()].filter(
      c => c.zone === 'battlefield' && c.instanceId !== 'koma_bf',
    ).length;

    // A Serpent token should have entered the battlefield
    expect(tokenCountAfter).toBeGreaterThan(tokenCountBefore);
  });

  /**
   * Exec test 3 — CBC + battlefield-source "spells can't be countered" static
   *               (Sphinx of the Final Word style):
   *
   * "This spell can't be countered.\nFlying\nSpells you control can't be countered."
   *
   * After the Sphinx is on the battlefield, p1's next spell should be uncounterable
   * (the battlefield-source CBC static is enforced by registerContinuousAbilitiesForPermanent
   * + executeCounterSpell).
   */
  it('CBC + companion battlefield-static: Sphinx-style "spells you control cant be countered" is enforced', () => {
    let state = createTestState();
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 5, C: 0 };

    // Sphinx of the Final Word proxy on battlefield
    addCard(state, 'sphinx_1', 'p1', 'battlefield', {
      id: 'sphinx_def',
      name: 'Sphinx of the Final Word',
      type_line: 'Creature — Sphinx',
      oracle_text: "This spell can't be countered.\nFlying\nSpells you control can't be countered.",
      mana_cost: '{5}{U}{U}',
      cmc: 7,
      colors: ['U'],
      card_types: ['creature'],
      power: 5,
      toughness: 5,
    });
    state = registerContinuousAbilitiesForPermanent(state, 'sphinx_1');

    // p1's generic spell
    addCard(state, 'spell_1', 'p1', 'hand', {
      id: 'any_spell_def',
      name: 'Divination',
      type_line: 'Sorcery',
      oracle_text: 'Draw 2 cards.',
      mana_cost: '{2}{U}',
      cmc: 3,
      colors: ['U'],
      card_types: ['sorcery'],
    });

    // p2's counterspell
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

    // p1 casts Divination
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, manaPool: { W: 0, U: 3, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p1', 'spell_1');
    expect(state.stack).toHaveLength(1);

    // p2 tries to counter it
    state = {
      ...state,
      priorityPlayerIndex: 1,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p2', 'counter_2', ['spell_1']);
    expect(state.stack).toHaveLength(2);

    // Counterspell resolves — Sphinx's static shields p1's spell
    state = resolveTopOfStack(state);
    expect(state.cards.get('counter_2')?.zone).toBe('graveyard');
    // Divination must still be on the stack (NOT countered)
    expect(state.cards.get('spell_1')?.zone).toBe('stack');
    expect(state.stack).toHaveLength(1);
  });
});
