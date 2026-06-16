/**
 * slice3-as-enters-choice.test.ts
 *
 * Slice 3 as-enters-choice: matchers and execution for
 * "As ~ enters[ the battlefield], choose <X>." declarations.
 *
 * Covers:
 *   1. Parser: multi-line absorption of "As ~ enters, choose a creature type/color"
 *      when the choose line is NOT the first line (e.g. after "Enchant <X>").
 *   2. Parser: extended strip + re-parse for "choose an opponent/player",
 *      "choose a [nonland] card name" — the declaration is stripped so companion
 *      lines (triggers, statics) parse independently.
 *   3. TappedForManaRider with chosenColor — "Whenever enchanted <subtype> is
 *      tapped for mana, its controller adds one mana of the chosen color."
 *      (Utopia Sprawl family).
 *   4. Execution: tapping the enchanted land produces one mana of the stored
 *      choices.chosenColor.
 *   5. Choices interface: chosenOpponent and chosenCardName fields are stored
 *      and copied correctly.
 *
 * Real oracle wordings referenced:
 *   Utopia Sprawl — "Enchant Forest\nAs ~ enters the battlefield, choose a color.\n
 *                     Whenever enchanted Forest is tapped for mana, its controller
 *                     adds one mana of the chosen color."
 *   Radiant Destiny — "As ~ enters the battlefield, choose a creature type.\n
 *                       Creatures you control of the chosen type get +1/+1."
 *   (opponent form)  — "As ~ enters the battlefield, choose an opponent.\n
 *                        At the beginning of your upkeep, you gain 1 life."
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { tapLandForMana } from '../actions';
import { registerContinuousEffect } from '../effects/continuous';
import { initGameState } from '../game-state';
import type { CardDefinition, CardInstance, GameState } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLand(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name || id,
    type_line: opts.type_line || 'Basic Land — Forest',
    oracle_text: opts.oracle_text || '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeAura(id: string, oracleText: string): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Enchantment — Aura',
    oracle_text: oracleText,
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['enchantment'],
  };
}

function createTestGame(defs: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: defs, commanderId: 'nonexistent-cmd-1' },
    { playerId: 'p2', name: 'Player 2', cards: [makeLand('p2land')], commanderId: 'nonexistent-cmd-2' },
  ]);
}

function findCard(state: GameState, defId: string): CardInstance | undefined {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  return undefined;
}

function moveToZone(state: GameState, instanceId: string, zone: 'battlefield' | 'hand'): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone, tapped: false, summoningSick: false });
  return { ...state, cards: newCards };
}

function attachAura(state: GameState, auraId: string, landId: string): GameState {
  const aura = state.cards.get(auraId);
  if (!aura) throw new Error(`Aura not found: ${auraId}`);
  const newCards = new Map(state.cards);
  newCards.set(auraId, { ...aura, attachedTo: landId });
  return { ...state, cards: newCards };
}

function setChosenColor(
  state: GameState,
  instanceId: string,
  color: 'W' | 'U' | 'B' | 'R' | 'G',
): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, choices: { ...card.choices, chosenColor: color } });
  return { ...state, cards: newCards };
}

function manaPool(state: GameState, playerId: string) {
  return state.players.find(p => p.id === playerId)!.manaPool;
}

// ---------------------------------------------------------------------------
// 1. Parser: multi-line choose a creature type absorption
// ---------------------------------------------------------------------------

describe('Slice 3: as-enters-choice — creature-type absorption in per-line dispatch', () => {
  it('Radiant Destiny: choose creature type + lord buff parses as StaticAbility', () => {
    // Real oracle: starts with "As ~ enters, choose a creature type."
    // followed by "Creatures you control of the chosen type get +1/+1."
    // and ability-word-prefixed "Citadel Siege — Creatures ... have vigilance."
    const oracle =
      'As ~ enters the battlefield, choose a creature type.\n'
      + 'Creatures you control of the chosen type get +1/+1.\n'
      + 'Citadel Siege — Creatures you control of the chosen type have vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
  });

  it('choose creature type line is absorbed when preceded by Enchant preamble', () => {
    // An aura whose first line is "Enchant creature" followed by the choose line
    // and a standard lord-buff companion — all three lines must be handled so
    // the card does not remain Unparsed solely because of the choose line.
    const oracle =
      'Enchant creature\n'
      + 'As ~ enters the battlefield, choose a creature type.\n'
      + 'Other creatures you control of the chosen type get +1/+1.';
    const r = parseOracleText(oracle);
    // "Other creatures you control of the chosen type get +1/+1" parses as a
    // StaticAbility via the chosenCreatureTypeFromSource filter, so the whole
    // face should resolve to StaticAbility.
    expect(r.kind).toBe('StaticAbility');
  });
});

// ---------------------------------------------------------------------------
// 2. Parser: multi-line choose a color absorption
// ---------------------------------------------------------------------------

describe('Slice 3: as-enters-choice — color absorption', () => {
  it('Utopia Sprawl: Enchant Forest + choose color + tapped-for-mana rider parses as StaticAbility', () => {
    // Real oracle wording (~ substituted for card name):
    //   Enchant Forest
    //   As ~ enters the battlefield, choose a color.
    //   Whenever enchanted Forest is tapped for mana, its controller adds one mana of the chosen color.
    const oracle =
      'Enchant Forest\n'
      + 'As ~ enters the battlefield, choose a color.\n'
      + 'Whenever enchanted Forest is tapped for mana, its controller adds one mana of the chosen color.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
    if (r.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(r.ability.modifier.scope).toBe('attachedLand');
    expect(r.ability.modifier.chosenColor).toBe(true);
  });

  it('Utopia Sprawl without the Enchant Forest preamble also parses', () => {
    // When the text arrives without the enchant preamble line (e.g. after it has
    // been stripped elsewhere), the two-line form should still parse.
    const oracle =
      'As ~ enters the battlefield, choose a color.\n'
      + 'Whenever enchanted Forest is tapped for mana, its controller adds one mana of the chosen color.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
  });

  it('standalone tapped-for-mana line with chosen color parses as StaticAbility', () => {
    const r = parseOracleText(
      'Whenever enchanted Forest is tapped for mana, its controller adds one mana of the chosen color.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
    if (r.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(r.ability.modifier.chosenColor).toBe(true);
    expect(r.ability.modifier.scope).toBe('attachedLand');
  });
});

// ---------------------------------------------------------------------------
// 3. Parser: extended strip for choose an opponent / player / card name
// ---------------------------------------------------------------------------

describe('Slice 3: as-enters-choice — opponent / player / card-name strip', () => {
  it('choose an opponent + parseable trigger: parses as Triggered', () => {
    // When the choose declaration is stripped, the remaining line is a
    // well-formed upkeep trigger that the engine executes.
    const oracle =
      'As ~ enters the battlefield, choose an opponent.\n'
      + 'At the beginning of your upkeep, you gain 1 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
  });

  it('choose a player + parseable trigger: parses as Triggered', () => {
    const oracle =
      'As ~ enters the battlefield, choose a player.\n'
      + 'At the beginning of your upkeep, ~ deals 1 damage to you.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
  });

  it('choose a nonland card name — Nevermore: remains Unparsed (restriction not executable)', () => {
    // The companion line "Spells with the chosen name can't be cast." has no
    // engine consumer, so the card correctly stays Unparsed after the strip.
    const oracle =
      "As ~ enters the battlefield, choose a nonland card name.\n"
      + "Spells with the chosen name can't be cast.";
    const r = parseOracleText(oracle);
    // Honest: the engine cannot enforce "can't be cast" for a named card.
    expect(r.kind).toBe('Unparsed');
  });

  it('choose opponent + unexecutable CDA — Nyxathid: remains Unparsed', () => {
    // "~'s power and toughness are each equal to 7 minus the number of cards in
    // the chosen player's hand." is a CDA the engine cannot compute, so the
    // card should remain Unparsed after stripping the choose line.
    const oracle =
      "As ~ enters the battlefield, choose an opponent.\n"
      + "~'s power and toughness are each equal to 7 minus the number of cards in the chosen player's hand.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// 4. Execution: TappedForManaRider chosenColor produces the right mana
// ---------------------------------------------------------------------------

const UTOPIA_SPRAWL_ORACLE =
  'Enchant Forest\n'
  + 'As ~ enters the battlefield, choose a color.\n'
  + 'Whenever enchanted Forest is tapped for mana, its controller adds one mana of the chosen color.';

describe('Slice 3: TappedForManaRider chosenColor — execution', () => {
  function buildState(chosenColor: 'W' | 'U' | 'B' | 'R' | 'G'): {
    state: GameState;
    landId: string;
    auraId: string;
  } {
    const forestDef = makeLand('forest_def', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
    });
    const sprawlDef = makeAura('sprawl_def', UTOPIA_SPRAWL_ORACLE);

    let state = createTestGame([forestDef, sprawlDef]);

    const forestCard = findCard(state, 'forest_def')!;
    const sprawlCard = findCard(state, 'sprawl_def')!;

    // Move both to battlefield
    state = moveToZone(state, forestCard.instanceId, 'battlefield');
    state = moveToZone(state, sprawlCard.instanceId, 'battlefield');

    // Attach aura to land and set chosen color
    state = attachAura(state, sprawlCard.instanceId, forestCard.instanceId);
    state = setChosenColor(state, sprawlCard.instanceId, chosenColor);

    // Parse the aura and register its TappedForManaRider as a continuous effect
    const parsed = parseOracleText(sprawlDef.oracle_text);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, sprawlCard.instanceId, 'p1', parsed.ability);
    }

    return { state, landId: forestCard.instanceId, auraId: sprawlCard.instanceId };
  }

  it('produces {G} base + {U} chosen when chosenColor is U', () => {
    const { state, landId } = buildState('U');
    const afterTap = tapLandForMana(state, 'p1', landId, 'G');
    const pool = manaPool(afterTap, 'p1');
    // Forest produces {G}; the rider adds {U} (the chosen color).
    expect(pool.G).toBeGreaterThanOrEqual(1);
    expect(pool.U).toBeGreaterThanOrEqual(1);
  });

  it('produces {G} base + {R} chosen when chosenColor is R', () => {
    const { state, landId } = buildState('R');
    const afterTap = tapLandForMana(state, 'p1', landId, 'G');
    const pool = manaPool(afterTap, 'p1');
    expect(pool.G).toBeGreaterThanOrEqual(1);
    expect(pool.R).toBeGreaterThanOrEqual(1);
  });

  it('produces {G} base + {W} chosen when chosenColor is W', () => {
    const { state, landId } = buildState('W');
    const afterTap = tapLandForMana(state, 'p1', landId, 'G');
    const pool = manaPool(afterTap, 'p1');
    expect(pool.G).toBeGreaterThanOrEqual(1);
    expect(pool.W).toBeGreaterThanOrEqual(1);
  });

  it('produces only base mana when aura has no chosenColor set', () => {
    const { state, landId, auraId } = buildState('G');
    // Unset the chosen color to simulate the aura not yet having made a choice
    const auraCard = state.cards.get(auraId)!;
    const noChoiceCards = new Map(state.cards);
    noChoiceCards.set(auraId, { ...auraCard, choices: {} });
    const noChoiceState = { ...state, cards: noChoiceCards };

    const afterTap = tapLandForMana(noChoiceState, 'p1', landId, 'G');
    const pool = manaPool(afterTap, 'p1');
    // Forest still produces {G}; no bonus from chosenColor.
    expect(pool.G).toBeGreaterThanOrEqual(1);
    // No extra colors should appear.
    expect(pool.W ?? 0).toBe(0);
    expect(pool.U ?? 0).toBe(0);
    expect(pool.B ?? 0).toBe(0);
    expect(pool.R ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. choices interface: chosenOpponent and chosenCardName fields
// ---------------------------------------------------------------------------

describe('Slice 3: choices interface additions', () => {
  it('chosenOpponent is stored on CardInstance', () => {
    const state = createTestGame([makeLand('land')]);
    const landCard = findCard(state, 'land')!;
    const newCards = new Map(state.cards);
    newCards.set(landCard.instanceId, {
      ...landCard,
      choices: { chosenOpponent: 'p2' },
    });
    const updated = { ...state, cards: newCards };
    const card = updated.cards.get(landCard.instanceId)!;
    expect(card.choices?.chosenOpponent).toBe('p2');
  });

  it('chosenCardName is stored on CardInstance', () => {
    const state = createTestGame([makeLand('land')]);
    const landCard = findCard(state, 'land')!;
    const newCards = new Map(state.cards);
    newCards.set(landCard.instanceId, {
      ...landCard,
      choices: { chosenCardName: 'lightning bolt' },
    });
    const updated = { ...state, cards: newCards };
    const card = updated.cards.get(landCard.instanceId)!;
    expect(card.choices?.chosenCardName).toBe('lightning bolt');
  });
});
