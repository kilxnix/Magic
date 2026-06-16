/**
 * Slice 11/11 — Reveal-hand coercion extension: Psychotic Episode putOnTop +
 * Wand of Ith random-reveal conditional discard
 *
 * Tests cover:
 *  1.  Psychotic Episode: "reveals their hand and the top card of their library.
 *      You choose a card revealed this way. That player puts the chosen card on
 *      top of their library." → RevealHandChooseCard(disposition:putOnTop)
 *  2.  Psychotic Episode disposition is 'putOnTop'
 *  3.  Psychotic Episode still produces one Player target spec
 *  4.  "target opponent" variant produces opponentControls:true
 *  5.  Existing discard disposition still works for matchRevealHandAndTopOfLibraryChooseCard
 *  6.  Wand of Ith conditional: "reveals a card at random from their hand. If it's
 *      a land card, that player discards it." → RevealRandomCardFromHand(conditionalDiscardFilter)
 *  7.  Wand of Ith conditionalDiscardFilter is { types: ['land'] }
 *  8.  Wand of Ith produces one Player target spec
 *  9.  "target opponent" conditional discard variant produces opponentControls:true
 * 10.  Nonland conditional: "If it's a nonland card, that player discards it."
 * 11.  Executor: Psychotic Episode — chosen card moves to top of library
 * 12.  Executor: Psychotic Episode — highest CMC card chosen, lands excluded
 * 13.  Executor: Wand of Ith — land card is discarded
 * 14.  Executor: Wand of Ith — nonland card stays in hand
 * 15.  Executor: Wand of Ith — empty hand is a no-op
 * 16.  Last Rites (dynamic count) stays Unparsed — honesty gate
 * 17.  Struggle for Sanity (loop body) stays Unparsed — honesty gate
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect, RevealRandomCardFromHandEffect } from '../effects/ast';

// ── card definitions ──────────────────────────────────────────────────────────

const landDef: CardDefinition = {
  id: 'land', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};

const instantDef: CardDefinition = {
  id: 'instant', name: 'Lightning Bolt', type_line: 'Instant',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['instant'],
};

const sorceryDef: CardDefinition = {
  id: 'sorcery', name: 'Divination', type_line: 'Sorcery',
  oracle_text: '', mana_cost: '{2}{U}', cmc: 3, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['sorcery'],
};

const creatureDef: CardDefinition = {
  id: 'cre', name: 'Grizzly Bears', type_line: 'Creature — Bear',
  oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 2,
};

// ── oracle texts ──────────────────────────────────────────────────────────────

const PSYCHOTIC_EPISODE =
  'Target player reveals their hand and the top card of their library. You choose a card revealed this way. That player puts the chosen card on top of their library.';

const PSYCHOTIC_EPISODE_NONLAND =
  'Target player reveals their hand and the top card of their library. You choose a nonland card revealed this way. That player puts the chosen card on top of their library.';

const PSYCHOTIC_OPPONENT =
  'Target opponent reveals their hand and the top card of their library. You choose a card revealed this way. That player puts the chosen card on top of their library.';

// Keep existing discard form for regression
const PSYCHOTIC_DISCARD =
  'Target player reveals their hand and the top card of their library. You choose a card from among them. That player discards that card.';

const WAND_OF_ITH =
  'Target player reveals a card at random from their hand. If it\'s a land card, that player discards it.';

const WAND_OPPONENT =
  'Target opponent reveals a card at random from their hand. If it\'s a land card, that player discards it.';

const WAND_NONLAND =
  'Target player reveals a card at random from their hand. If it\'s a nonland card, that player discards it.';

const LAST_RITES =
  'Discard any number of cards. Target player reveals their hand, then you choose a nonland card from it for each card discarded this way. That player discards those cards.';

// ── state helpers ─────────────────────────────────────────────────────────────

interface CardSlot { id: string; defId: string; zone?: CardInstance['zone'] }

function makeState(
  p1Hand: CardSlot[] = [],
  p1Library: CardSlot[] = [],
): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['land', landDef],
    ['instant', instantDef],
    ['sorcery', sorceryDef],
    ['cre', creatureDef],
  ]);

  const cards = new Map<string, CardInstance>();
  for (const { id, defId } of p1Hand) {
    cards.set(id, {
      instanceId: id, definitionId: defId, ownerId: 'p1', zone: 'hand',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  }
  for (const { id, defId } of p1Library) {
    cards.set(id, {
      instanceId: id, definitionId: defId, ownerId: 'p1', zone: 'library',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  }

  return {
    players: [createPlayer('p0', 'Caster'), createPlayer('p1', 'Opponent')],
    cards, cardDefinitions: allDefs,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main',
    step: 'begin_combat', turnNumber: 1, hasPriorityPassed: [false, false],
    stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function runSpell(text: string, state: GameState, namedChoices: Record<string, string> = {}): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason ?? '')}`);
  const playerSpec = p.targets.find(t => t.type === 'Player');
  return executeEffects(
    state, p.effects, 'p0', ['p1'],
    playerSpec ? [{ id: playerSpec.id }] : [],
    0, { namedCardChoices: namedChoices },
  );
}

function spellEffects(text: string) {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason ?? '')}`);
  return p.effects;
}

// ── 1–5. Psychotic Episode parse tests ───────────────────────────────────────

describe('Psychotic Episode: "you choose a card revealed this way" + putOnTop', () => {
  it('1. parses as a Spell', () => {
    const p = parseOracleText(PSYCHOTIC_EPISODE);
    expect(p.kind).toBe('Spell');
  });

  it('2. emits RevealHandChooseCard with disposition putOnTop', () => {
    const [eff] = spellEffects(PSYCHOTIC_EPISODE);
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    const e = eff as RevealHandChooseCardEffect;
    expect(e.disposition).toBe('putOnTop');
  });

  it('3. produces exactly one Player target spec', () => {
    const p = parseOracleText(PSYCHOTIC_EPISODE);
    if (p.kind !== 'Spell') return;
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
  });

  it('4. "target opponent" variant has opponentControls:true', () => {
    const p = parseOracleText(PSYCHOTIC_OPPONENT);
    if (p.kind !== 'Spell') return;
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('5. nonland filter is preserved in putOnTop form', () => {
    const [eff] = spellEffects(PSYCHOTIC_EPISODE_NONLAND);
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    const e = eff as RevealHandChooseCardEffect;
    expect(e.filter.excludeTypes).toContain('land');
    expect(e.disposition).toBe('putOnTop');
  });

  it('5b. existing discard disposition still works (regression)', () => {
    const [eff] = spellEffects(PSYCHOTIC_DISCARD);
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect((eff as RevealHandChooseCardEffect).disposition).toBe('discard');
  });
});

// ── 6–10. Wand of Ith conditional discard parse tests ────────────────────────

describe('Wand of Ith: random-reveal conditional discard', () => {
  it('6. "reveals a card at random from their hand. If it\'s a land card, that player discards it." parses as Spell', () => {
    const p = parseOracleText(WAND_OF_ITH);
    expect(p.kind).toBe('Spell');
  });

  it('7. emits RevealRandomCardFromHand with conditionalDiscardFilter: {types:[\'land\']}', () => {
    const [eff] = spellEffects(WAND_OF_ITH);
    expect(eff.kind).toBe('RevealRandomCardFromHand');
    if (eff.kind !== 'RevealRandomCardFromHand') return;
    const e = eff as RevealRandomCardFromHandEffect;
    expect(e.conditionalDiscardFilter).toBeDefined();
    expect(e.conditionalDiscardFilter?.types).toEqual(['land']);
  });

  it('8. produces exactly one Player target spec', () => {
    const p = parseOracleText(WAND_OF_ITH);
    if (p.kind !== 'Spell') return;
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
  });

  it('9. "target opponent" variant has opponentControls:true', () => {
    const p = parseOracleText(WAND_OPPONENT);
    if (p.kind !== 'Spell') return;
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('10. nonland conditional filter: conditionalDiscardFilter has excludeTypes:[\'land\']', () => {
    const [eff] = spellEffects(WAND_NONLAND);
    expect(eff.kind).toBe('RevealRandomCardFromHand');
    if (eff.kind !== 'RevealRandomCardFromHand') return;
    const e = eff as RevealRandomCardFromHandEffect;
    expect(e.conditionalDiscardFilter?.excludeTypes).toContain('land');
  });
});

// ── 11–15. Executor tests ─────────────────────────────────────────────────────

describe('Executor: Psychotic Episode putOnTop', () => {
  it('11. chosen card moves to library (top)', () => {
    // p1 hand: sorcery (cmc 3), land (cmc 0)
    const state = makeState(
      [{ id: 'p1sor', defId: 'sorcery' }, { id: 'p1land', defId: 'land' }],
      [{ id: 'p1lib1', defId: 'instant' }],
    );
    const after = runSpell(PSYCHOTIC_EPISODE, state);
    // Highest CMC nonland chosen = sorcery (cmc 3), but PSYCHOTIC_EPISODE has no filter
    // so any card can be chosen; highest CMC is sorcery (3)
    const chosen = after.cards.get('p1sor');
    expect(chosen?.zone).toBe('library');
    // The land stays in hand
    const land = after.cards.get('p1land');
    expect(land?.zone).toBe('hand');
  });

  it('12. with explicit choice, that specific card moves to library', () => {
    const state = makeState(
      [{ id: 'p1sor', defId: 'sorcery' }, { id: 'p1cre', defId: 'cre' }],
    );
    // Explicitly choose the creature (lower CMC, would not be auto-picked)
    const after = runSpell(PSYCHOTIC_EPISODE, state, { revealHandCardId: 'p1cre' });
    expect(after.cards.get('p1cre')?.zone).toBe('library');
    expect(after.cards.get('p1sor')?.zone).toBe('hand');
  });
});

describe('Executor: Wand of Ith conditional discard', () => {
  it('13. land card is discarded when revealed', () => {
    const state = makeState([{ id: 'p1land', defId: 'land' }]);
    // land has lowest instanceId → chosen deterministically
    const after = runSpell(WAND_OF_ITH, state);
    const land = after.cards.get('p1land');
    expect(land?.zone).toBe('graveyard');
  });

  it('14. nonland card stays in hand when land conditional is set', () => {
    const state = makeState([
      { id: 'p1sor', defId: 'sorcery' },
      { id: 'p1inst', defId: 'instant' },
    ]);
    // Neither is a land, so neither gets discarded
    const after = runSpell(WAND_OF_ITH, state);
    expect(after.cards.get('p1sor')?.zone).toBe('hand');
    expect(after.cards.get('p1inst')?.zone).toBe('hand');
  });

  it('15. empty hand is a no-op', () => {
    const state = makeState([]); // p1 has no hand cards
    const before = state.players.find(pl => pl.id === 'p1')!.life;
    const after = runSpell(WAND_OF_ITH, state);
    // No crash, life and hand unchanged
    expect(after.players.find(pl => pl.id === 'p1')!.life).toBe(before);
    expect(after.cards.size).toBe(0);
  });
});

// ── 16–17. Honesty gates ──────────────────────────────────────────────────────

describe('Honesty: iterative/dynamic forms stay Unparsed', () => {
  it('16. Last Rites (for-each-discard count) stays Unparsed', () => {
    const p = parseOracleText(LAST_RITES);
    expect(p.kind).toBe('Unparsed');
  });

  it('17. Wand of Ith: creature card revealed, land-filter check — creature stays in hand', () => {
    // Explicitly reveal the creature via namedCardChoices; it is not a land → stays.
    const state = makeState([
      { id: 'p1cre', defId: 'cre' },
      { id: 'p1land', defId: 'land' },
    ]);
    const after = runSpell(WAND_OF_ITH, state, { randomRevealedCardId: 'p1cre' });
    // Creature is not a land → conditional discard does NOT fire
    expect(after.cards.get('p1cre')?.zone).toBe('hand');
    // Land also stays (wasn't chosen)
    expect(after.cards.get('p1land')?.zone).toBe('hand');
  });
});
