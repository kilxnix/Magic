/**
 * Slice 6 — Reveal-hand coercion leftovers: chosen-color filter, each-opponent
 * reveal-discard, and ETB plain-exile subset.
 *
 * Tests cover:
 *  1.  Addle parse: "Choose a color. Target player reveals hand and you choose a
 *       card of that color from it. That player discards that card."
 *       → Spell with RevealHandChooseCard(chosenColorFromCastTime, discard)
 *  2.  Addle: emits chosenColorFromCastTime:true filter + discard disposition
 *  3.  Addle: emits a Player target (no opponent constraint since "target player")
 *  4.  Addle executor: namedCardChoices['chosenColor']='B' discards black card,
 *       leaves non-black card in hand
 *  5.  Addle executor: no chosenColor key → falls back to unfiltered (highest CMC)
 *  6.  Hint of Insanity parse: "Choose a color. Target player reveals hand and
 *       discards all cards of that color." → Spell with discardAll:true
 *  7.  Hint of Insanity executor: discards all black cards, leaves non-black
 *  8.  Struggle for Sanity fragment: "each opponent reveals their hand and
 *       discards a nonland card." → Discard(EachOpponent, count=1)
 *  9.  Brain Maggot ETB parse: "target opponent reveals their hand . you choose a
 *       nonland card from it . exile that card until ~ leaves the battlefield ."
 *       → ETB trigger with RevealHandChooseCard(exile, nonland filter)
 * 10.  Brain Maggot executor: chosen nonland card is exiled (plain-exile subset)
 * 11.  Kitesail Freebooter ETB parse: "noncreature, nonland card" filter
 * 12.  Kitesail Freebooter executor: chosen noncreature nonland card is exiled
 * 13.  Addle "target opponent" variant also parses (opponent constraint)
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect, DiscardEffect } from '../effects/ast';

// ── oracle text constants ──────────────────────────────────────────────────────

const ADDLE_EXACT =
  'Choose a color. Target player reveals their hand and you choose a card of that color from it. That player discards that card.';

const ADDLE_OPPONENT_EXACT =
  'Choose a color. Target opponent reveals their hand and you choose a card of that color from it. That player discards that card.';

const HINT_OF_INSANITY_EXACT =
  'Choose a color. Target player reveals their hand and discards all cards of that color.';

const EACH_OPPONENT_REVEALS_DISCARD_NONLAND =
  'each opponent reveals their hand and discards a nonland card.';

const BRAIN_MAGGOT_ETB_EXACT =
  'When ~ enters the battlefield, target opponent reveals their hand. You choose a nonland card from it. Exile that card until ~ leaves the battlefield.';

const KITESAIL_ETB_EXACT =
  'When ~ enters the battlefield, target opponent reveals their hand. You choose a noncreature, nonland card from it. Exile that card until ~ leaves the battlefield.';

// ── card definitions ──────────────────────────────────────────────────────────

const blackInstantDef: CardDefinition = {
  id: 'blackinst', name: 'Doom Blade', type_line: 'Instant',
  oracle_text: '', mana_cost: '{1}{B}', cmc: 2, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['instant'],
};

const blueCreatureDef: CardDefinition = {
  id: 'bluecre', name: 'Snapcaster Mage', type_line: 'Creature — Human Wizard',
  oracle_text: '', mana_cost: '{1}{U}', cmc: 2, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 1,
};

const blackCreatureDef: CardDefinition = {
  id: 'blackcre', name: 'Ravenous Rats', type_line: 'Creature — Rat',
  oracle_text: '', mana_cost: '{1}{B}', cmc: 2, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['creature'], power: 1, toughness: 1,
};

const redSorceryDef: CardDefinition = {
  id: 'redsorcery', name: 'Lightning Bolt', type_line: 'Sorcery',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['sorcery'],
};

const landDef: CardDefinition = {
  id: 'land', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};

const bigBlackCreatureDef: CardDefinition = {
  id: 'bigblack', name: 'Grave Titan', type_line: 'Creature — Zombie Giant',
  oracle_text: '', mana_cost: '{4}{B}{B}', cmc: 6, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['creature'], power: 6, toughness: 6,
};

// ── state builder ─────────────────────────────────────────────────────────────

/**
 * p0 is the caster; p1 is the target player whose hand we attack.
 */
function makeState(p1Hand: { id: string; defId: string }[] = []): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['blackinst', blackInstantDef],
    ['bluecre', blueCreatureDef],
    ['blackcre', blackCreatureDef],
    ['redsorcery', redSorceryDef],
    ['land', landDef],
    ['bigblack', bigBlackCreatureDef],
  ]);

  const cards = new Map<string, CardInstance>();
  for (const { id, defId } of p1Hand) {
    cards.set(id, {
      instanceId: id, definitionId: defId, ownerId: 'p1', zone: 'hand',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  }

  return {
    players: [createPlayer('p0', 'Caster'), createPlayer('p1', 'Opponent')],
    cards,
    stack: [],
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    turn: 1,
    phase: 'main1',
    step: null,
    hasPriorityPassed: [false, false],
    pendingTriggers: [],
    spellsCastThisTurn: 0,
    landPlaysThisTurn: 0,
    maxLandPlaysThisTurn: 1,
    cardDefinitions: allDefs,
    exileZone: new Map(),
    commandZone: new Map(),
    combat: null,
    continuousEffects: [],
    replacementEffects: [],
    activeAbilities: [],
    suspendedCards: [],
  };
}

function runSpell(
  oracleText: string,
  state: GameState,
  namedCardChoices: Record<string, string> = {},
): GameState {
  const parsed = parseOracleText(oracleText);
  if (parsed.kind !== 'Spell') throw new Error(`Expected Spell, got ${parsed.kind}`);
  const playerSpec = parsed.targets.find(t => t.type === 'Player');
  if (playerSpec) {
    return executeEffects(state, parsed.effects, 'p0', ['p1'], [{ id: playerSpec.id }], 0,
      { namedCardChoices: { ...namedCardChoices } });
  }
  return executeEffects(state, parsed.effects, 'p0', [], [], 0,
    { namedCardChoices: { ...namedCardChoices } });
}

function spellParsed(oracleText: string) {
  const p = parseOracleText(oracleText);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}`);
  return p;
}

// ── 1-3. Addle parse ──────────────────────────────────────────────────────────

describe('Addle parse (Slice 6: chosen-color preamble)', () => {
  it('1. Addle parses as Spell', () => {
    const p = parseOracleText(ADDLE_EXACT);
    expect(p.kind).toBe('Spell');
  });

  it('2. emits RevealHandChooseCard with chosenColorFromCastTime filter + discard', () => {
    const p = spellParsed(ADDLE_EXACT);
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.filter.chosenColorFromCastTime).toBe(true);
    expect(e.disposition).toBe('discard');
  });

  it('3. emits a Player target (no opponentControls since "target player")', () => {
    const p = spellParsed(ADDLE_EXACT);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    expect(p.targets[0].constraints?.opponentControls).toBeUndefined();
  });
});

// ── 4-5. Addle executor ───────────────────────────────────────────────────────

describe('Addle executor (Slice 6: chosenColorFromCastTime filter)', () => {
  it('4. chosenColor=B discards a black card, leaves non-black card in hand', () => {
    // p1 has a black instant and a blue creature in hand
    const state = makeState([
      { id: 'h_bi', defId: 'blackinst' },
      { id: 'h_bc', defId: 'bluecre' },
    ]);
    const after = runSpell(ADDLE_EXACT, state, { chosenColor: 'B' });
    // Black instant should be discarded (moved to graveyard)
    expect(after.cards.get('h_bi')?.zone).toBe('graveyard');
    // Blue creature should still be in hand
    expect(after.cards.get('h_bc')?.zone).toBe('hand');
  });

  it('5. no chosenColor key → unfiltered pick, discards highest CMC card', () => {
    // p1 has a red sorcery (cmc 1) and a black creature (cmc 2) in hand
    const state = makeState([
      { id: 'h_rs', defId: 'redsorcery' },
      { id: 'h_bc', defId: 'blackcre' },
    ]);
    // No chosenColor → any card (fall-through), picks highest CMC = blackcre (cmc 2)
    const after = runSpell(ADDLE_EXACT, state, {});
    expect(after.cards.get('h_bc')?.zone).toBe('graveyard');
    expect(after.cards.get('h_rs')?.zone).toBe('hand');
  });
});

// ── 6-7. Hint of Insanity ─────────────────────────────────────────────────────

describe('Hint of Insanity (Slice 6: choose-color discard-all)', () => {
  it('6. Hint of Insanity parses as Spell with discardAll:true + chosenColorFromCastTime', () => {
    const p = parseOracleText(HINT_OF_INSANITY_EXACT);
    expect(p.kind).toBe('Spell');
    const pp = spellParsed(HINT_OF_INSANITY_EXACT);
    const e = pp.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.filter.chosenColorFromCastTime).toBe(true);
    expect(e.discardAll).toBe(true);
    expect(e.disposition).toBe('discard');
  });

  it('7. executor discards all black cards, leaves non-black cards', () => {
    const state = makeState([
      { id: 'h_bi', defId: 'blackinst' },
      { id: 'h_bc', defId: 'bluecre' },
      { id: 'h_bbc', defId: 'bigblack' },
    ]);
    const after = runSpell(HINT_OF_INSANITY_EXACT, state, { chosenColor: 'B' });
    // Both black cards should be discarded
    expect(after.cards.get('h_bi')?.zone).toBe('graveyard');
    expect(after.cards.get('h_bbc')?.zone).toBe('graveyard');
    // Blue creature should remain in hand
    expect(after.cards.get('h_bc')?.zone).toBe('hand');
  });
});

// ── 8. Each-opponent reveals and discards ─────────────────────────────────────

describe('Each-opponent reveals hand and discards (Slice 6: Struggle for Sanity fragment)', () => {
  it('8. "each opponent reveals their hand and discards a nonland card" parses as Discard(EachOpponent)', () => {
    const p = parseOracleText(EACH_OPPONENT_REVEALS_DISCARD_NONLAND);
    expect(p.kind).toBe('Spell');
    const pp = spellParsed(EACH_OPPONENT_REVEALS_DISCARD_NONLAND);
    const e = pp.effects.find(x => x.kind === 'Discard') as DiscardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.player.kind).toBe('EachOpponent');
    expect(e.count).toBe(1);
  });
});

// ── 9-10. Brain Maggot ETB ────────────────────────────────────────────────────

describe('Brain Maggot ETB (Slice 6: ETB plain-exile subset)', () => {
  it('9. Brain Maggot ETB trigger body parses with exile disposition', () => {
    const p = parseOracleText(BRAIN_MAGGOT_ETB_EXACT);
    // Should parse as ETB trigger containing RevealHandChooseCard
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    const e = p.ability.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.disposition).toBe('exile');
    expect(e.filter.excludeTypes).toContain('land');
  });

  it('10. Brain Maggot executor: chosen nonland card is exiled (plain-exile subset)', () => {
    const state = makeState([
      { id: 'h_bi', defId: 'blackinst' }, // nonland
      { id: 'h_land', defId: 'land' },     // land — should NOT be chosen
    ]);
    const p = parseOracleText(BRAIN_MAGGOT_ETB_EXACT);
    if (p.kind !== 'ETB') throw new Error(`Expected ETB, got ${p.kind}`);
    const effects = p.ability.effects;
    const targets = p.targets; // targets are at the top level, not ability.targets
    const chosenIds = targets.length > 0 ? ['p1'] : [];
    const after = executeEffects(state, effects, 'p0', chosenIds, targets.map(t => ({ id: t.id })));
    // Nonland (blackinst) should be exiled
    expect(after.cards.get('h_bi')?.zone).toBe('exile');
    // Land should remain in hand
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });
});

// ── 11-12. Kitesail Freebooter ETB ───────────────────────────────────────────

describe('Kitesail Freebooter ETB (Slice 6: noncreature, nonland filter)', () => {
  it('11. Kitesail Freebooter ETB trigger body parses with noncreature+nonland filter', () => {
    const p = parseOracleText(KITESAIL_ETB_EXACT);
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    const e = p.ability.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.disposition).toBe('exile');
    expect(e.filter.excludeTypes).toContain('creature');
    expect(e.filter.excludeTypes).toContain('land');
  });

  it('12. Kitesail executor: chosen noncreature nonland card is exiled', () => {
    const state = makeState([
      { id: 'h_bi', defId: 'blackinst' },  // instant — matches noncreature nonland
      { id: 'h_bc', defId: 'blackcre' },   // creature — should NOT be chosen
      { id: 'h_land', defId: 'land' },     // land — should NOT be chosen
    ]);
    const p = parseOracleText(KITESAIL_ETB_EXACT);
    if (p.kind !== 'ETB') throw new Error(`Expected ETB, got ${p.kind}`);
    const effects = p.ability.effects;
    const targets = p.targets; // targets are at the top level, not ability.targets
    const chosenIds = targets.length > 0 ? ['p1'] : [];
    const after = executeEffects(state, effects, 'p0', chosenIds, targets.map(t => ({ id: t.id })));
    // Instant (noncreature nonland) should be exiled
    expect(after.cards.get('h_bi')?.zone).toBe('exile');
    // Creature and land should remain in hand
    expect(after.cards.get('h_bc')?.zone).toBe('hand');
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });
});

// ── 13. Addle opponent variant ───────────────────────────────────────────────

describe('Addle opponent variant (Slice 6: target opponent)', () => {
  it('13. "target opponent" Addle variant parses with opponentControls constraint', () => {
    const p = parseOracleText(ADDLE_OPPONENT_EXACT);
    expect(p.kind).toBe('Spell');
    const pp = spellParsed(ADDLE_OPPONENT_EXACT);
    expect(pp.targets).toHaveLength(1);
    expect(pp.targets[0].constraints?.opponentControls).toBe(true);
    const e = pp.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e?.filter.chosenColorFromCastTime).toBe(true);
  });
});
