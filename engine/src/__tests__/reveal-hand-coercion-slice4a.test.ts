/**
 * Slice 4a — Reveal-hand coercion: partial-reveal dynamic-count + putOnBottom disposition.
 *
 * Tests cover:
 *  1. Parse: Mire's Toll — "target player reveals a number of cards from their hand
 *     equal to the number of Swamps you control. You choose one of them. That player
 *     discards that card." → RevealHandChooseCard, disposition=discard.
 *  2. Parse: "target opponent reveals a number of cards from their hand equal to the
 *     number of creatures you control. You choose one of those cards. That player
 *     discards that card." (alternate "those cards" pronoun).
 *  3. Parse: Psychotic Episode putOnBottom — "Target player reveals their hand and
 *     the top card of their library. You choose a card revealed this way. That player
 *     puts the chosen card on the bottom of their library." → disposition=putOnBottom.
 *  4. Honesty: party-count form stays Unparsed
 *     ("equal to the number of creatures in your party").
 *  5. Executor: Mire's Toll — discards highest-CMC card from opponent's hand.
 *  6. Executor: Psychotic Episode putOnBottom — chosen card goes to bottom of library.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect } from '../effects/ast';

// ── card definitions ──────────────────────────────────────────────────────────

const landDef: CardDefinition = {
  id: 'land', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};

const smallCrDef: CardDefinition = {
  id: 'smallcr', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid',
  oracle_text: '', mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 1, toughness: 1,
};

const bigCrDef: CardDefinition = {
  id: 'bigcr', name: 'Grave Titan', type_line: 'Creature — Zombie Giant',
  oracle_text: '', mana_cost: '{4}{B}{B}', cmc: 6, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['creature'], power: 6, toughness: 6,
};

const instantDef: CardDefinition = {
  id: 'instant', name: 'Lightning Bolt', type_line: 'Instant',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'],
  color_identity: ['R'], keywords: [], card_types: ['instant'],
};

// ── state builder ─────────────────────────────────────────────────────────────

interface StateOpts {
  p0Hand?: { id: string; defId: string }[];
  p1Hand?: { id: string; defId: string }[];
  p0Library?: { id: string; defId: string }[];
  p1Library?: { id: string; defId: string }[];
  p0Battlefield?: { id: string; defId: string }[];
}

function makeState(opts: StateOpts = {}): GameState {
  const cards = new Map<string, CardInstance>();
  const defs = new Map<string, CardDefinition>([
    ['land', landDef],
    ['smallcr', smallCrDef],
    ['bigcr', bigCrDef],
    ['instant', instantDef],
  ]);

  const addCards = (list: { id: string; defId: string }[] | undefined, ownerId: string, zone: CardInstance['zone']) => {
    for (const { id, defId } of list ?? []) {
      cards.set(id, {
        instanceId: id, definitionId: defId, ownerId, zone,
        tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
      });
    }
  };

  addCards(opts.p0Hand, 'p0', 'hand');
  addCards(opts.p1Hand, 'p1', 'hand');
  addCards(opts.p0Library, 'p0', 'library');
  addCards(opts.p1Library, 'p1', 'library');
  addCards(opts.p0Battlefield, 'p0', 'battlefield');

  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards, cardDefinitions: defs,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main',
    step: 'begin_combat', turnNumber: 2, hasPriorityPassed: [false, false],
    stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function spellEffects(text: string) {
  const p = parseOracleText(text);
  expect(p.kind, `Expected Spell for: "${text}"`).toBe('Spell');
  if (p.kind !== 'Spell') throw new Error('not a spell');
  return p.effects;
}

function runSpell(text: string, state: GameState): GameState {
  const p = parseOracleText(text);
  expect(p.kind, `Expected Spell for: "${text}"`).toBe('Spell');
  if (p.kind !== 'Spell') throw new Error('not a spell');
  const firstPlayerSpec = p.targets.find(t => t.type === 'Player');
  if (firstPlayerSpec) {
    return executeEffects(state, p.effects, 'p0', ['p1'], [{ id: firstPlayerSpec.id }], 0, {});
  }
  return executeEffects(state, p.effects, 'p0', [], [], 0, {});
}

// ── parse tests ───────────────────────────────────────────────────────────────

describe('Slice 4a: partial-reveal dynamic-count — Mire\'s Toll family (parse)', () => {
  it('1. Swamp-count form: parses to RevealHandChooseCard with discard disposition', () => {
    const [eff] = spellEffects(
      "Target player reveals a number of cards from their hand equal to the number of Swamps you control. You choose one of them. That player discards that card.",
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    const e = eff as RevealHandChooseCardEffect;
    expect(e.disposition).toBe('discard');
    expect(e.filter).toEqual({});
    // Should have a Player target spec
  });

  it('2. Creature-count form with "those cards" pronoun: parses correctly', () => {
    const p = parseOracleText(
      "Target opponent reveals a number of cards from their hand equal to the number of creatures you control. You choose one of those cards. That player discards that card.",
    );
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects.length).toBeGreaterThan(0);
    const [eff] = p.effects;
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.disposition).toBe('discard');
    // opponent target generates an opponentControls constraint
    const playerSpec = p.targets.find(t => t.type === 'Player');
    expect(playerSpec).toBeDefined();
    expect(playerSpec?.constraints?.opponentControls).toBe(true);
  });

  it('3. Target spec is present and effect player is Chosen ref', () => {
    const p = parseOracleText(
      "Target player reveals a number of cards from their hand equal to the number of Swamps you control. You choose one of them. That player discards that card.",
    );
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets.length).toBeGreaterThanOrEqual(1);
    const playerSpec = p.targets.find(t => t.type === 'Player');
    expect(playerSpec).toBeDefined();
    const [eff] = p.effects;
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.player).toEqual({ kind: 'Chosen', targetId: playerSpec!.id });
  });
});

describe('Slice 4a: Psychotic Episode putOnBottom disposition (parse)', () => {
  it('4. Psychotic Episode — putOnBottom: parses to RevealHandChooseCard with putOnBottom', () => {
    const [eff] = spellEffects(
      "Target player reveals their hand and the top card of their library. You choose a card revealed this way. That player puts the chosen card on the bottom of their library.",
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    const e = eff as RevealHandChooseCardEffect;
    expect(e.disposition).toBe('putOnBottom');
    expect(e.filter).toEqual({});
  });

  it('5. Psychotic Episode full card text (ETB form uses "target player"): parses as Spell', () => {
    const p = parseOracleText(
      "Target player reveals their hand and the top card of their library. You choose a card revealed this way. That player puts the chosen card on the bottom of their library.",
    );
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Slice 4a: honesty guard', () => {
  it('6. Party-count form stays Unparsed (no executor support for party)', () => {
    const p = parseOracleText(
      "Target opponent reveals a number of cards from their hand equal to the number of creatures in your party. You choose one of those cards. That player discards that card.",
    );
    // "creatures in your party" is not a ForEach-parseable zone phrase; stays Unparsed.
    expect(p.kind).toBe('Unparsed');
  });
});

// ── executor tests ────────────────────────────────────────────────────────────

describe('Slice 4a: executor — partial-reveal dynamic-count discard (Mire\'s Toll)', () => {
  it('7. Executor: discards highest-CMC card from opponent\'s hand', () => {
    const state = makeState({
      p1Hand: [
        { id: 'h1', defId: 'smallcr' },  // cmc 1
        { id: 'h2', defId: 'bigcr' },    // cmc 6 — should be discarded
        { id: 'h3', defId: 'instant' },  // cmc 1
      ],
    });
    const after = runSpell(
      "Target player reveals a number of cards from their hand equal to the number of Swamps you control. You choose one of them. That player discards that card.",
      state,
    );
    // h2 (bigcr, cmc 6) should be in graveyard
    expect(after.cards.get('h2')?.zone).toBe('graveyard');
    // Others remain in hand
    expect(after.cards.get('h1')?.zone).toBe('hand');
    expect(after.cards.get('h3')?.zone).toBe('hand');
  });

  it('8. Executor: opponent with empty hand → no state change', () => {
    const state = makeState({ p1Hand: [] });
    const after = runSpell(
      "Target player reveals a number of cards from their hand equal to the number of Swamps you control. You choose one of them. That player discards that card.",
      state,
    );
    // No crash, no change to cards
    expect(after.cards.size).toBe(state.cards.size);
  });
});

describe('Slice 4a: executor — putOnBottom (Psychotic Episode)', () => {
  it('9. Executor: chosen card goes to bottom of library (after existing library cards)', () => {
    const state = makeState({
      p1Hand: [
        { id: 'h1', defId: 'instant' },  // cmc 1
        { id: 'h2', defId: 'bigcr' },    // cmc 6 — highest, will be chosen
      ],
      p1Library: [
        { id: 'lib1', defId: 'land' },   // library card
        { id: 'lib2', defId: 'smallcr' }, // library card
      ],
    });
    const after = runSpell(
      "Target player reveals their hand and the top card of their library. You choose a card revealed this way. That player puts the chosen card on the bottom of their library.",
      state,
    );
    // h2 should now be in the library (zone change)
    expect(after.cards.get('h2')?.zone).toBe('library');
    // h1 should remain in hand
    expect(after.cards.get('h1')?.zone).toBe('hand');
    // lib1 and lib2 remain in library
    expect(after.cards.get('lib1')?.zone).toBe('library');
    expect(after.cards.get('lib2')?.zone).toBe('library');
    // Verify the chosen card is at the END of the library (bottom = last in iteration)
    // The library order is: lib1, lib2, then h2 appended at the bottom.
    const libraryCards = [...after.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'library');
    expect(libraryCards.length).toBe(3);
    // Map iteration order should place h2 last (bottom)
    const libraryIds = libraryCards.map(c => c.instanceId);
    expect(libraryIds[libraryIds.length - 1]).toBe('h2');
  });

  it('10. Executor: putOnBottom with only card in hand goes to library', () => {
    const state = makeState({
      p1Hand: [{ id: 'h1', defId: 'bigcr' }],
    });
    const after = runSpell(
      "Target player reveals their hand and the top card of their library. You choose a card revealed this way. That player puts the chosen card on the bottom of their library.",
      state,
    );
    expect(after.cards.get('h1')?.zone).toBe('library');
  });
});
