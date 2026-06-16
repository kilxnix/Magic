/**
 * Slice 1 — Reveal-hand coercion widening
 *
 * Tests cover:
 *  1.  Binding Negotiation form: "You may choose a nonland card from it. If you
 *      do, they discard it." parses as RevealHandChooseCard(discard, nonland)
 *  2.  Binding Negotiation: no-op when hand contains only lands
 *  3.  Binding Negotiation executor: nonland card is discarded; land stays
 *  4.  "If you do, they exile it." disposition variant (exile form)
 *  5.  Two-sentence discardAll: "...reveals their hand. That player discards all
 *      nonland cards." parses as RevealHandChooseCard(discardAll, nonland)
 *  6.  discardAll executor: all nonland cards discarded; land stays
 *  7.  "all other nonland cards" form (Noxious Vapors) — "other" silently dropped
 *  8.  "all nonland cards with the same name as another card in their hand"
 *      (Hint of Insanity) — same-name qualifier dropped; discards all nonland
 *  9.  each-opponent form: "each opponent reveals their hand. You choose a nonland
 *      card from it. That player discards that card." — EachOpponent player ref
 * 10.  each-opponent executor: highest-CMC nonland card removed from each opponent
 * 11.  each-opponent discardAll form: all nonland from each opponent discarded
 * 12.  each-opponent executor leaves lands untouched
 * 13.  "target player" (non-opponent) two-sentence discardAll parses (no opponent constraint)
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect } from '../effects/ast';

// ── card definitions ──────────────────────────────────────────────────────────

const instantDef: CardDefinition = {
  id: 'instant', name: 'Doom Blade', type_line: 'Instant',
  oracle_text: '', mana_cost: '{1}{B}', cmc: 2, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['instant'],
};

const bigInstantDef: CardDefinition = {
  id: 'biginstant', name: 'Cryptic Command', type_line: 'Instant',
  oracle_text: '', mana_cost: '{1}{U}{U}{U}', cmc: 4, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['instant'],
};

const creatureDef: CardDefinition = {
  id: 'creature', name: 'Grizzly Bears', type_line: 'Creature — Bear',
  oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 2,
};

const sorceryDef: CardDefinition = {
  id: 'sorcery', name: 'Divination', type_line: 'Sorcery',
  oracle_text: '', mana_cost: '{2}{U}', cmc: 3, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['sorcery'],
};

const landDef: CardDefinition = {
  id: 'land', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};

// ── state builder ─────────────────────────────────────────────────────────────

/** Two-player state: p0 = caster, p1 = target opponent. */
function makeState(p1Hand: { id: string; defId: string }[] = []): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['instant', instantDef],
    ['biginstant', bigInstantDef],
    ['creature', creatureDef],
    ['sorcery', sorceryDef],
    ['land', landDef],
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
    cards, cardDefinitions: allDefs,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main',
    step: 'begin_combat', turnNumber: 1, hasPriorityPassed: [false, false],
    stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

/** Three-player state: p0 = caster, p1 + p2 = opponents. */
function makeThreePlayerState(
  p1Hand: { id: string; defId: string }[] = [],
  p2Hand: { id: string; defId: string }[] = [],
): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['instant', instantDef],
    ['biginstant', bigInstantDef],
    ['creature', creatureDef],
    ['sorcery', sorceryDef],
    ['land', landDef],
  ]);
  const cards = new Map<string, CardInstance>();
  for (const { id, defId } of p1Hand) {
    cards.set(id, {
      instanceId: id, definitionId: defId, ownerId: 'p1', zone: 'hand',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  }
  for (const { id, defId } of p2Hand) {
    cards.set(id, {
      instanceId: id, definitionId: defId, ownerId: 'p2', zone: 'hand',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  }
  return {
    players: [createPlayer('p0', 'Caster'), createPlayer('p1', 'Opp1'), createPlayer('p2', 'Opp2')],
    cards, cardDefinitions: allDefs,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main',
    step: 'begin_combat', turnNumber: 1, hasPriorityPassed: [false, false, false],
    stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function spellParsed(text: string) {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason ?? '')}`);
  return p;
}

function runSpell(text: string, state: GameState, targetPlayerId?: string): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}`);
  const playerSpec = p.targets.find(t => t.type === 'Player');
  if (playerSpec) {
    const tgt = targetPlayerId ?? 'p1';
    return executeEffects(state, p.effects, 'p0', [tgt], [{ id: playerSpec.id }], 0, {});
  }
  // No target spec → EachOpponent or similar (no chosen targets needed)
  return executeEffects(state, p.effects, 'p0', [], [], 0, {});
}

// ── oracle text constants ─────────────────────────────────────────────────────

const BINDING_NEGOTIATION =
  'Target opponent reveals their hand. You may choose a nonland card from it. If you do, they discard it.';

const BINDING_EXILE =
  'Target opponent reveals their hand. You may choose a nonland card from it. If you do, they exile it.';

const TWO_SENT_DISCARD_ALL =
  'Target opponent reveals their hand. That player discards all nonland cards.';

const TWO_SENT_DISCARD_ALL_OTHER =
  'Target player reveals their hand. That player discards all other nonland cards.';

const TWO_SENT_SAME_NAME =
  'Target player reveals their hand. That player discards all nonland cards with the same name as another card in their hand.';

const EACH_OPP_CHOOSE_DISCARD =
  'Each opponent reveals their hand. You choose a nonland card from it. That player discards that card.';

const EACH_OPP_DISCARD_ALL =
  'Each opponent reveals their hand. That player discards all nonland cards.';

// ── test 1-4: Binding Negotiation "If you do, they discard/exile it" ─────────

describe('Slice 1 — Binding Negotiation "if you do, they discard it" form', () => {
  it('1. parses as Spell with RevealHandChooseCard(discard, excludeTypes:[land])', () => {
    const p = spellParsed(BINDING_NEGOTIATION);
    expect(p.effects).toHaveLength(1);
    const [eff] = p.effects as [RevealHandChooseCardEffect];
    expect(eff.kind).toBe('RevealHandChooseCard');
    expect(eff.disposition).toBe('discard');
    expect(eff.filter).toMatchObject({ excludeTypes: ['land'] });
    expect(eff.discardAll).toBeUndefined();
  });

  it('2. emits one Player target with opponentControls constraint', () => {
    const p = spellParsed(BINDING_NEGOTIATION);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('3. executor: nonland card (instant) discarded; land remains in hand', () => {
    const state = makeState([
      { id: 'c-inst', defId: 'instant' },
      { id: 'c-land', defId: 'land' },
    ]);
    const after = runSpell(BINDING_NEGOTIATION, state, 'p1');
    expect(after.cards.get('c-inst')?.zone).toBe('graveyard');
    expect(after.cards.get('c-land')?.zone).toBe('hand');
  });

  it('4. "If you do, they exile it" variant parses as RevealHandChooseCard(exile)', () => {
    const p = spellParsed(BINDING_EXILE);
    const [eff] = p.effects as [RevealHandChooseCardEffect];
    expect(eff.kind).toBe('RevealHandChooseCard');
    expect(eff.disposition).toBe('exile');
    expect(eff.filter).toMatchObject({ excludeTypes: ['land'] });
  });
});

// ── test 5-8: Two-sentence discardAll forms ───────────────────────────────────

describe('Slice 1 — Two-sentence discardAll forms', () => {
  it('5. basic two-sentence discardAll: parses as RevealHandChooseCard(discardAll:true, nonland)', () => {
    const p = spellParsed(TWO_SENT_DISCARD_ALL);
    const [eff] = p.effects as [RevealHandChooseCardEffect];
    expect(eff.kind).toBe('RevealHandChooseCard');
    expect(eff.discardAll).toBe(true);
    expect(eff.disposition).toBe('discard');
    expect(eff.filter).toMatchObject({ excludeTypes: ['land'] });
  });

  it('6. discardAll executor: all nonland cards discarded; land stays', () => {
    const state = makeState([
      { id: 'c-inst', defId: 'instant' },
      { id: 'c-sor', defId: 'sorcery' },
      { id: 'c-land', defId: 'land' },
    ]);
    const after = runSpell(TWO_SENT_DISCARD_ALL, state, 'p1');
    expect(after.cards.get('c-inst')?.zone).toBe('graveyard');
    expect(after.cards.get('c-sor')?.zone).toBe('graveyard');
    expect(after.cards.get('c-land')?.zone).toBe('hand');
  });

  it('7. "all other nonland cards" form drops "other" and parses as discardAll nonland', () => {
    const p = spellParsed(TWO_SENT_DISCARD_ALL_OTHER);
    const [eff] = p.effects as [RevealHandChooseCardEffect];
    expect(eff.kind).toBe('RevealHandChooseCard');
    expect(eff.discardAll).toBe(true);
    expect(eff.disposition).toBe('discard');
    expect(eff.filter).toMatchObject({ excludeTypes: ['land'] });
  });

  it('8. same-name qualifier dropped: Hint of Insanity form discards all nonland', () => {
    const p = spellParsed(TWO_SENT_SAME_NAME);
    const [eff] = p.effects as [RevealHandChooseCardEffect];
    expect(eff.kind).toBe('RevealHandChooseCard');
    expect(eff.discardAll).toBe(true);
    expect(eff.filter).toMatchObject({ excludeTypes: ['land'] });
  });
});

// ── test 9-12: EachOpponent forms ─────────────────────────────────────────────

describe('Slice 1 — EachOpponent reveal-hand forms', () => {
  it('9. "each opponent reveals their hand..." parses with EachOpponent player ref + no targets', () => {
    const p = spellParsed(EACH_OPP_CHOOSE_DISCARD);
    const [eff] = p.effects as [RevealHandChooseCardEffect];
    expect(eff.kind).toBe('RevealHandChooseCard');
    expect(eff.player.kind).toBe('EachOpponent');
    expect(eff.filter).toMatchObject({ excludeTypes: ['land'] });
    expect(eff.disposition).toBe('discard');
    expect(p.targets).toHaveLength(0);
  });

  it('10. EachOpponent executor: highest-CMC nonland removed from each opponent\'s hand', () => {
    // p0 = caster, p1 has [instant(cmc2), land], p2 has [sorcery(cmc3), biginstant(cmc4), land]
    const state = makeThreePlayerState(
      [{ id: 'p1-inst', defId: 'instant' }, { id: 'p1-land', defId: 'land' }],
      [{ id: 'p2-sor', defId: 'sorcery' }, { id: 'p2-big', defId: 'biginstant' }, { id: 'p2-land', defId: 'land' }],
    );
    const after = runSpell(EACH_OPP_CHOOSE_DISCARD, state);
    // p1: instant(cmc2) discarded; land stays
    expect(after.cards.get('p1-inst')?.zone).toBe('graveyard');
    expect(after.cards.get('p1-land')?.zone).toBe('hand');
    // p2: biginstant(cmc4) discarded (highest); sorcery and land stay
    expect(after.cards.get('p2-big')?.zone).toBe('graveyard');
    expect(after.cards.get('p2-sor')?.zone).toBe('hand');
    expect(after.cards.get('p2-land')?.zone).toBe('hand');
  });

  it('11. EachOpponent discardAll form parses with discardAll:true', () => {
    const p = spellParsed(EACH_OPP_DISCARD_ALL);
    const [eff] = p.effects as [RevealHandChooseCardEffect];
    expect(eff.kind).toBe('RevealHandChooseCard');
    expect(eff.player.kind).toBe('EachOpponent');
    expect(eff.discardAll).toBe(true);
    expect(p.targets).toHaveLength(0);
  });

  it('12. EachOpponent discardAll executor: all nonland from each opponent, lands untouched', () => {
    const state = makeThreePlayerState(
      [{ id: 'p1-inst', defId: 'instant' }, { id: 'p1-land', defId: 'land' }],
      [{ id: 'p2-cre', defId: 'creature' }, { id: 'p2-land', defId: 'land' }],
    );
    const after = runSpell(EACH_OPP_DISCARD_ALL, state);
    expect(after.cards.get('p1-inst')?.zone).toBe('graveyard');
    expect(after.cards.get('p1-land')?.zone).toBe('hand');
    expect(after.cards.get('p2-cre')?.zone).toBe('graveyard');
    expect(after.cards.get('p2-land')?.zone).toBe('hand');
  });
});

// ── test 13: target player (non-opponent) two-sentence discardAll ──────────────

describe('Slice 1 — "target player" two-sentence discardAll', () => {
  it('13. "target player" opener: no opponentControls constraint on target', () => {
    const p = spellParsed(TWO_SENT_DISCARD_ALL_OTHER);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    // "target player" — no opponent constraint
    expect(p.targets[0].constraints?.opponentControls).toBeFalsy();
  });
});
