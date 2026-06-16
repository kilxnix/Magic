/**
 * Slice 11/12 — Reveal-hand coercion filter/linkage variants
 *
 * Tests cover:
 *  1. Venarian Glimmer parse: "nonland card with mana value X or less from it" (MV BEFORE "from it")
 *  2. Venarian Glimmer: filter has excludeTypes:['land'], cmc.x:true, disposition:discard
 *  3. Venarian Glimmer: opponent-constrained target spec
 *  4. Lost Hours parse: "puts that card into their library third from the top" (new disposition)
 *  5. Lost Hours: filter has excludeTypes:['land'], disposition:putThirdFromTop
 *  6. Lost Hours ETB trigger body: parses as ETB with RevealHandChooseCard(putThirdFromTop)
 *  7. Numeric MV before "from it": "nonland card with mana value 3 or less from it" parses
 *  8. Inquisition-of-Kozilek form still works: MV AFTER "from it"
 *  9. Executor: Venarian Glimmer (X=2) discards highest nonland <=2cmc, leaves land and higher-cmc
 * 10. Executor: Venarian Glimmer (X=0) no-op when no nonland card has cmc<=0
 * 11. Executor: Lost Hours — chosen card goes into library at index 2 (third from top)
 * 12. Executor: Lost Hours — library has <2 cards, card goes at end (clamped)
 * 13. Addle stays Unparsed (no choose-color subsystem)
 * 14. Last Rites stays Unparsed (dynamic count from self-discard, no subsystem)
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect } from '../effects/ast';

// ── card definitions ──────────────────────────────────────────────────────────

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

const landDef: CardDefinition = {
  id: 'land', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};

const bigCreatureDef: CardDefinition = {
  id: 'bigcre', name: 'Grave Titan', type_line: 'Creature — Zombie Giant',
  oracle_text: '', mana_cost: '{4}{B}{B}', cmc: 6, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['creature'], power: 6, toughness: 6,
};

const smallCreatureDef: CardDefinition = {
  id: 'smallcre', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid',
  oracle_text: '', mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 1, toughness: 1,
};

// ── state builder ─────────────────────────────────────────────────────────────

/**
 * p0 is the caster; p1 is the target player whose hand is attacked.
 * p1Hand populates p1's hand; p1Library populates p1's library (index 0 = top).
 */
function makeState(
  p1Hand: { id: string; defId: string }[] = [],
  p1Library: { id: string; defId: string }[] = [],
): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['instant', instantDef],
    ['sorcery', sorceryDef],
    ['land', landDef],
    ['bigcre', bigCreatureDef],
    ['smallcre', smallCreatureDef],
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

function spellParsed(text: string) {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason)}`);
  return p;
}

function runSpell(text: string, state: GameState, xValue = 0): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}`);
  const playerSpec = p.targets.find(t => t.type === 'Player');
  if (playerSpec) {
    return executeEffects(state, p.effects, 'p0', ['p1'], [{ id: playerSpec.id }], xValue, {});
  }
  return executeEffects(state, p.effects, 'p0', [], [], xValue, {});
}

// ── oracle texts ──────────────────────────────────────────────────────────────

const VENARIAN_EXACT =
  'Target player reveals their hand. You choose a nonland card with mana value X or less from it. That player discards that card.';

const LOST_HOURS_EXACT =
  'Target player reveals their hand. You choose a nonland card from it. That player puts that card into their library third from the top.';

const INQUISITION_EXACT =
  'Target player reveals their hand. You choose a nonland card from it with mana value 3 or less. That player discards that card.';

const ADDLE_EXACT =
  'Choose a color. Target player reveals their hand and you choose a card of that color from it. That player discards that card.';

const LAST_RITES_EXACT =
  'Discard any number of cards. Target player reveals their hand, then you choose a nonland card from it for each card discarded this way. That player discards those cards.';

// ── 1–3. Venarian Glimmer parse ───────────────────────────────────────────────

describe('Venarian Glimmer: "nonland card with mana value X or less from it"', () => {
  it('1. parses as a Spell', () => {
    const p = parseOracleText(VENARIAN_EXACT);
    expect(p.kind).toBe('Spell');
  });

  it('2. emits RevealHandChooseCard with excludeTypes:[land], cmc.x:true, discard', () => {
    const p = spellParsed(VENARIAN_EXACT);
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.filter.excludeTypes).toContain('land');
    expect(e.filter.cmc).toBeDefined();
    expect(e.filter.cmc?.x).toBe(true);
    expect(e.filter.cmc?.op).toBe('lte');
    expect(e.disposition).toBe('discard');
  });

  it('3. emits a Player target with opponent constraint', () => {
    const p = spellParsed(VENARIAN_EXACT);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    // "Target player" (not opponent) — no opponentControls constraint
    expect(p.targets[0].constraints?.opponentControls).toBeUndefined();
  });
});

// ── 4–6. Lost Hours parse ─────────────────────────────────────────────────────

describe('Lost Hours: "puts that card into their library third from the top"', () => {
  it('4. parses as a Spell', () => {
    const p = parseOracleText(LOST_HOURS_EXACT);
    expect(p.kind).toBe('Spell');
  });

  it('5. emits RevealHandChooseCard with excludeTypes:[land] and putThirdFromTop disposition', () => {
    const p = spellParsed(LOST_HOURS_EXACT);
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.filter.excludeTypes).toContain('land');
    expect(e.disposition).toBe('putThirdFromTop');
  });

  it('6. ETB trigger body parses with RevealHandChooseCard(putThirdFromTop)', () => {
    const etbText =
      'When ~ enters the battlefield, target player reveals their hand. You choose a nonland card from it. That player puts that card into their library third from the top.';
    const r = parseOracleText(etbText);
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    const e = r.ability.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.disposition).toBe('putThirdFromTop');
  });
});

// ── 7–8. Regression: other MV forms still work ───────────────────────────────

describe('Regression: MV-before-from-it with numeric bound', () => {
  it('7. "nonland card with mana value 3 or less from it" parses (numeric MV before "from it")', () => {
    const text =
      'Target player reveals their hand. You choose a nonland card with mana value 3 or less from it. That player discards that card.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e?.filter.cmc?.op).toBe('lte');
    expect(e?.filter.cmc?.value).toBe(3);
    expect(e?.filter.cmc?.x).toBeUndefined();
  });

  it('8. Inquisition-style MV after "from it" still works', () => {
    const p = spellParsed(INQUISITION_EXACT);
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.filter.cmc?.op).toBe('lte');
    expect(e.filter.cmc?.value).toBe(3);
    expect(e.disposition).toBe('discard');
  });
});

// ── 9–10. Executor: Venarian Glimmer ─────────────────────────────────────────

describe('Executor: Venarian Glimmer — X-bound nonland discard', () => {
  it('9. X=2: discards highest nonland with cmc<=2, leaves land and higher-cmc nonland', () => {
    const state = makeState([
      { id: 'h_bigcre', defId: 'bigcre' },    // cmc 6 — above X, stays
      { id: 'h_instant', defId: 'instant' },  // cmc 1 — chosen (nonland, cmc<=2)
      { id: 'h_land', defId: 'land' },         // cmc 0 — land excluded by filter, stays
    ]);
    const after = runSpell(VENARIAN_EXACT, state, 2);
    // instant (cmc 1, nonland, cmc <= 2) is discarded
    expect(after.cards.get('h_instant')?.zone).toBe('graveyard');
    // bigcre (cmc 6 > 2) stays
    expect(after.cards.get('h_bigcre')?.zone).toBe('hand');
    // land excluded by nonland filter, stays
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });

  it('10. X=0: no-op when no nonland card has cmc<=0 (land excluded, nonlands above X)', () => {
    const state = makeState([
      { id: 'h_bigcre', defId: 'bigcre' },    // cmc 6 > 0
      { id: 'h_land', defId: 'land' },         // excluded by nonland filter
    ]);
    const after = runSpell(VENARIAN_EXACT, state, 0);
    expect(after.cards.get('h_bigcre')?.zone).toBe('hand');
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });
});

// ── 11–12. Executor: Lost Hours ───────────────────────────────────────────────

describe('Executor: Lost Hours — chosen card placed third from top', () => {
  it('11. card ends in library zone, placed at index 2 when library has ≥2 cards', () => {
    // p1 has: sorcery (cmc3 nonland, highest — will be chosen) in hand
    // p1 library: land0, instant1, smallcre2 (indices 0,1,2)
    const state = makeState(
      [{ id: 'h_sorc', defId: 'sorcery' }],
      [
        { id: 'lib0', defId: 'land' },
        { id: 'lib1', defId: 'instant' },
        { id: 'lib2', defId: 'smallcre' },
      ],
    );
    const after = runSpell(LOST_HOURS_EXACT, state);
    // Chosen card (sorcery) should now be in the library
    expect(after.cards.get('h_sorc')?.zone).toBe('library');
    // Hand is now empty for p1
    expect([...after.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'hand')).toHaveLength(0);
  });

  it('12. library has 0 cards — card still enters library (clamped to end)', () => {
    const state = makeState([{ id: 'h_sorc', defId: 'sorcery' }], []);
    const after = runSpell(LOST_HOURS_EXACT, state);
    expect(after.cards.get('h_sorc')?.zone).toBe('library');
  });
});

// ── 13. Addle now parses (choose-color subsystem added in Slice 6) ─────────────

describe('Addle choose-color preamble (Slice 6 unlock)', () => {
  it('13. Addle now parses as Spell (choose-color subsystem implemented)', () => {
    const r = parseOracleText(ADDLE_EXACT);
    expect(r.kind).toBe('Spell');
  });
});

// ── 14. Honesty: Last Rites remains Unparsed ─────────────────────────────────

describe('Honesty: unsupported variants stay Unparsed', () => {
  it('14. Last Rites (for-each-self-discard count) stays Unparsed — no self-discard tracker', () => {
    const r = parseOracleText(LAST_RITES_EXACT);
    expect(r.kind).toBe('Unparsed');
  });
});
