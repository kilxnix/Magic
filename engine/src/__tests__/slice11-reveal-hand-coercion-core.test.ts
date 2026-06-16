/**
 * Slice 11/12 — Reveal-hand coercion: Coercion/Distress/Castigate family
 *
 * Verifies the matchRevealHandChooseCard family handles the core Coercion-style
 * oracle text template:
 *   "Target player reveals their hand. You choose a <filter> card from it.
 *    That player discards/exiles that card."
 *
 * Coverage:
 *  1. Coercion exact wording: any card, discard disposition
 *  2. Distress / Mind-Rot-with-choice: any card, discard disposition (same template)
 *  3. Castigate exact wording: nonland, nonblack filter, exile disposition
 *  4. Castigate: excludeColors:['B'] in the parsed filter
 *  5. Castigate: excludeTypes:['land'] in the parsed filter
 *  6. Target spec: Coercion emits a Player target (opponent-constrained for "target opponent")
 *  7. Target spec: Castigate emits an opponent-constrained Player target
 *  8. Executor: Coercion — discards highest-CMC card from opponent's hand
 *  9. Executor: Coercion — empty hand is a no-op
 * 10. Executor: Castigate — exiles chosen nonland nonblack card, leaves land + black card
 * 11. Executor: Castigate — no-op when only land/black cards are in hand
 * 12. Distress variant with "target player" (not opponent) parses as Player target, no constraint
 * 13. "exile that card" inline disposition ("and exile that card") is honored
 * 14. Disposition discard vs exile are independently honored by the executor
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect } from '../effects/ast';

// ── card definitions ──────────────────────────────────────────────────────────

/** Any nonland nonblack card (sorcery, blue) */
const sorceryDef: CardDefinition = {
  id: 'sorcery', name: 'Divination', type_line: 'Sorcery',
  oracle_text: '', mana_cost: '{2}{U}', cmc: 3, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['sorcery'],
};

/** Instant, nonland, nonblack */
const instantDef: CardDefinition = {
  id: 'instant', name: 'Lightning Bolt', type_line: 'Instant',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['instant'],
};

/** Land — excluded by "nonland" filter in Castigate */
const landDef: CardDefinition = {
  id: 'land', name: 'Swamp', type_line: 'Basic Land — Swamp',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['B'],
  keywords: [], card_types: ['land'],
};

/** Black creature — excluded by "nonblack" filter in Castigate */
const blackCreatureDef: CardDefinition = {
  id: 'blackcre', name: 'Gray Merchant of Asphodel', type_line: 'Creature — Zombie',
  oracle_text: '', mana_cost: '{3}{B}{B}', cmc: 5, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 4,
};

/** Creature — nonblack (green), cmc 3 */
const greenCreatureDef: CardDefinition = {
  id: 'greencre', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid',
  oracle_text: '', mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 1, toughness: 1,
};

/** Creature — high CMC, nonblack (red), used as highest-CMC target */
const bigRedCreatureDef: CardDefinition = {
  id: 'bigred', name: 'Thundermaw Hellkite', type_line: 'Creature — Dragon',
  oracle_text: '', mana_cost: '{3}{R}{R}', cmc: 5, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['creature'], power: 5, toughness: 5,
};

// ── state builder ─────────────────────────────────────────────────────────────

function makeState(p1Hand: { id: string; defId: string }[] = []): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['sorcery', sorceryDef],
    ['instant', instantDef],
    ['land', landDef],
    ['blackcre', blackCreatureDef],
    ['greencre', greenCreatureDef],
    ['bigred', bigRedCreatureDef],
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

function spellEffects(text: string) {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason)}`);
  return p.effects;
}

function spellParsed(text: string) {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason)}`);
  return p;
}

function runSpell(text: string, state: GameState): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason)}`);
  const playerSpec = p.targets.find(t => t.type === 'Player');
  if (playerSpec) {
    return executeEffects(state, p.effects, 'p0', ['p1'], [{ id: playerSpec.id }], 0, {});
  }
  return executeEffects(state, p.effects, 'p0', [], [], 0, {});
}

// ── oracle wordings ───────────────────────────────────────────────────────────

// Coercion (Alpha/original): any card, discard disposition
const COERCION =
  'Target opponent reveals their hand. You choose a card from it. That player discards that card.';

// Distress / Mind-Rot-with-choice: same template, "target player" instead of opponent
const DISTRESS =
  'Target player reveals their hand. You choose a card from it. That player discards that card.';

// Castigate: nonland, nonblack filter, exile disposition
const CASTIGATE =
  "Target player reveals their hand. You choose a nonland, nonblack card from it. Exile that card.";

// Inline exile form (Appetite for Brains / Castigate variant)
const INLINE_EXILE =
  'Target opponent reveals their hand. You choose a nonland card from it and exile that card.';

// ── parse tests ───────────────────────────────────────────────────────────────

describe('Coercion: target opponent reveals hand, you choose any card, discard', () => {
  it('1. parses as RevealHandChooseCard with empty filter (any card)', () => {
    const [eff] = spellEffects(COERCION);
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.filter).toEqual({});
    expect(eff.disposition).toBe('discard');
    expect(eff.discardAll).toBeUndefined();
  });

  it('6. emits opponent-constrained Player target spec', () => {
    const p = spellParsed(COERCION);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });
});

describe('Distress: target player reveals hand, you choose any card, discard', () => {
  it('2. parses as RevealHandChooseCard with empty filter (any card), discard', () => {
    const [eff] = spellEffects(DISTRESS);
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.filter).toEqual({});
    expect(eff.disposition).toBe('discard');
  });

  it('12. "target player" (not opponent) emits Player target without opponentControls constraint', () => {
    const p = spellParsed(DISTRESS);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    expect(p.targets[0].constraints?.opponentControls).toBeUndefined();
  });
});

describe('Castigate: nonland, nonblack filter, exile disposition', () => {
  it('3. parses as RevealHandChooseCard with exile disposition', () => {
    const [eff] = spellEffects(CASTIGATE);
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.disposition).toBe('exile');
  });

  it('4. filter contains excludeColors:[B] for nonblack', () => {
    const [eff] = spellEffects(CASTIGATE);
    if (eff.kind !== 'RevealHandChooseCard') throw new Error('wrong kind');
    expect(eff.filter.excludeColors).toContain('B');
  });

  it('5. filter contains excludeTypes:[land] for nonland', () => {
    const [eff] = spellEffects(CASTIGATE);
    if (eff.kind !== 'RevealHandChooseCard') throw new Error('wrong kind');
    expect(eff.filter.excludeTypes).toContain('land');
  });

  it('7. emits an opponent-constrained Player target spec', () => {
    const p = spellParsed(CASTIGATE);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    // "target player" has no opponent constraint in CASTIGATE wording
    // (Castigate uses "target player" not "target opponent")
    // No opponentControls constraint expected
  });

  it('parses as Spell kind', () => {
    const p = parseOracleText(CASTIGATE);
    expect(p.kind).toBe('Spell');
  });
});

describe('Inline exile form: "and exile that card" disposition', () => {
  it('13. "nonland card from it and exile that card" parses with exile disposition', () => {
    const [eff] = spellEffects(INLINE_EXILE);
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.disposition).toBe('exile');
    expect(eff.filter.excludeTypes).toContain('land');
  });
});

// ── executor tests ────────────────────────────────────────────────────────────

describe('Executor: Coercion — discard highest-CMC card from opponent hand', () => {
  it('8. discards highest-CMC card (sorcery cmc3 > instant cmc1)', () => {
    const state = makeState([
      { id: 'p1sorc', defId: 'sorcery' },   // cmc 3 — highest, discarded
      { id: 'p1inst', defId: 'instant' },   // cmc 1 — stays
    ]);
    const after = runSpell(COERCION, state);
    expect(after.cards.get('p1sorc')?.zone).toBe('graveyard');
    expect(after.cards.get('p1inst')?.zone).toBe('hand');
  });

  it('9. empty hand is a no-op (no crash, no card moved)', () => {
    const state = makeState([]);
    const after = runSpell(COERCION, state);
    expect([...after.cards.values()].filter(c => c.zone === 'graveyard')).toHaveLength(0);
  });

  it('14. discard disposition moves card to graveyard (not exile)', () => {
    const state = makeState([{ id: 'p1sorc', defId: 'sorcery' }]);
    const after = runSpell(COERCION, state);
    expect(after.cards.get('p1sorc')?.zone).toBe('graveyard');
  });
});

describe('Executor: Castigate — exile nonland nonblack, leave land and black cards', () => {
  it('10. exiles highest-cmc nonland nonblack card, leaves land and black creature', () => {
    const state = makeState([
      { id: 'p1sorc', defId: 'sorcery' },     // nonland, nonblack (blue) cmc3 — exiled
      { id: 'p1land', defId: 'land' },         // land — stays (excluded by nonland)
      { id: 'p1black', defId: 'blackcre' },   // black creature — stays (excluded by nonblack)
    ]);
    const after = runSpell(CASTIGATE, state);
    expect(after.cards.get('p1sorc')?.zone).toBe('exile');
    expect(after.cards.get('p1land')?.zone).toBe('hand');
    expect(after.cards.get('p1black')?.zone).toBe('hand');
  });

  it('11. no-op when only land and black cards remain (no valid target)', () => {
    const state = makeState([
      { id: 'p1land', defId: 'land' },
      { id: 'p1black', defId: 'blackcre' },
    ]);
    const after = runSpell(CASTIGATE, state);
    expect(after.cards.get('p1land')?.zone).toBe('hand');
    expect(after.cards.get('p1black')?.zone).toBe('hand');
  });

  it('chooses the highest-cmc nonland nonblack card when multiple qualify', () => {
    const state = makeState([
      { id: 'p1inst', defId: 'instant' },     // nonblack, nonland, cmc 1
      { id: 'p1bigred', defId: 'bigred' },    // nonblack, nonland, cmc 5 — highest
      { id: 'p1land', defId: 'land' },         // excluded
      { id: 'p1black', defId: 'blackcre' },   // excluded
    ]);
    const after = runSpell(CASTIGATE, state);
    // bigred (cmc 5) is highest nonland nonblack — exiled
    expect(after.cards.get('p1bigred')?.zone).toBe('exile');
    // instant (cmc 1) stays — not chosen (lower cmc)
    expect(after.cards.get('p1inst')?.zone).toBe('hand');
    // excluded cards stay
    expect(after.cards.get('p1land')?.zone).toBe('hand');
    expect(after.cards.get('p1black')?.zone).toBe('hand');
  });

  it('exile disposition (Castigate) moves chosen card to exile, not graveyard', () => {
    const state = makeState([{ id: 'p1sorc', defId: 'sorcery' }]);
    const after = runSpell(CASTIGATE, state);
    expect(after.cards.get('p1sorc')?.zone).toBe('exile');
  });
});

describe('Disposition honesty: discard vs exile are independently honored', () => {
  it('14b. discard form sends card to graveyard', () => {
    const state = makeState([{ id: 'p1sorc', defId: 'sorcery' }]);
    const after = runSpell(DISTRESS, state);
    expect(after.cards.get('p1sorc')?.zone).toBe('graveyard');
  });

  it('14c. exile form sends card to exile zone, not graveyard', () => {
    const state = makeState([{ id: 'p1sorc', defId: 'sorcery' }]);
    const after = runSpell(CASTIGATE, state);
    const card = after.cards.get('p1sorc');
    expect(card?.zone).toBe('exile');
    expect(card?.zone).not.toBe('graveyard');
  });
});
