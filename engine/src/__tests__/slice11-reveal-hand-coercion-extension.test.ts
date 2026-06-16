/**
 * Slice 11/12 — Reveal-hand coercion: semicolon/pronoun/compact-ETB variants
 *
 * Extends the matchRevealHandChooseCard family with new phrasings:
 *  - Compact ETB form with semicolon separator and "discards it" (pronoun)
 *  - "That player discards it" pronoun form in standard spell text
 *  - ", then that player discards it" connector form
 *  - Filter variants (noncreature, creature) in the compact semicolon form
 *
 * Tests cover:
 *  1. Parse: ETB compact "reveals hand and you choose a card; that player discards it"
 *  2. Parse: ETB compact "reveals hand and you choose a noncreature card; that player discards it"
 *  3. Parse: ETB compact ", then that player discards it" connector
 *  4. Parse: Spell "that player discards it" pronoun (instead of "that card")
 *  5. Parse: ETB compact semicolon after "from it" ("from it; that player discards it")
 *  6. Parse: filter is {} (any card) for the basic compact form
 *  7. Parse: filter is { excludeTypes:['creature'] } for noncreature compact form
 *  8. Executor: compact ETB form discards highest-CMC card from opponent's hand
 *  9. Executor: noncreature filter discards noncreature, leaves creature
 * 10. Executor: "discards it" pronoun spell form discards correct card
 * 11. Executor: empty hand is a no-op
 * 12. Cast-without-paying variant stays Unparsed (Mindclaw Shaman — excluded per spec)
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect } from '../effects/ast';

// ── card definitions ──────────────────────────────────────────────────────────

const creatureDef: CardDefinition = {
  id: 'creature', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid',
  oracle_text: '', mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 1, toughness: 1,
};

const bigCreatureDef: CardDefinition = {
  id: 'bigcre', name: 'Grave Titan', type_line: 'Creature — Zombie Giant',
  oracle_text: '', mana_cost: '{4}{B}{B}', cmc: 6, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['creature'], power: 6, toughness: 6,
};

const sorceryDef: CardDefinition = {
  id: 'sorcery', name: 'Divination', type_line: 'Sorcery',
  oracle_text: '', mana_cost: '{2}{U}', cmc: 3, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['sorcery'],
};

const instantDef: CardDefinition = {
  id: 'instant', name: 'Lightning Bolt', type_line: 'Instant',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['instant'],
};

const landDef: CardDefinition = {
  id: 'land', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};

// ── state builder ─────────────────────────────────────────────────────────────

/**
 * p0 is the caster; p1 is the target player whose hand is attacked.
 */
function makeState(p1Hand: { id: string; defId: string }[] = []): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['creature', creatureDef],
    ['bigcre', bigCreatureDef],
    ['sorcery', sorceryDef],
    ['instant', instantDef],
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

function spellParsed(text: string) {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason)}`);
  return p;
}

function etbParsed(text: string) {
  const p = parseOracleText(text);
  if (p.kind !== 'ETB') throw new Error(`Expected ETB, got ${p.kind}: ${JSON.stringify((p as any).reason)}`);
  return p;
}

function runSpell(text: string, state: GameState, xValue = 0): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason)}`);
  const playerSpec = p.targets.find(t => t.type === 'Player');
  if (playerSpec) {
    return executeEffects(state, p.effects, 'p0', ['p1'], [{ id: playerSpec.id }], xValue, {});
  }
  return executeEffects(state, p.effects, 'p0', [], [], xValue, {});
}

function runETBBody(text: string, state: GameState): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'ETB') throw new Error(`Expected ETB, got ${p.kind}: ${JSON.stringify((p as any).reason)}`);
  const playerSpec = p.targets.find(t => t.type === 'Player');
  if (playerSpec) {
    return executeEffects(state, p.ability.effects, 'p0', ['p1'], [{ id: playerSpec.id }], 0, {});
  }
  return executeEffects(state, p.ability.effects, 'p0', [], [], 0, {});
}

// ── parse tests ───────────────────────────────────────────────────────────────

// Semicolon-separated compact ETB form (the primary new addition in this slice)
const COMPACT_ETB_ANY =
  'When ~ enters, target opponent reveals their hand and you choose a card; that player discards it.';

// Same with noncreature filter
const COMPACT_ETB_NONCREATURE =
  'When ~ enters, target opponent reveals their hand and you choose a noncreature card; that player discards it.';

// ", then" connector form
const COMMA_THEN_ETB =
  'When ~ enters, target opponent reveals their hand and you choose a card, then that player discards it.';

// Standard spell text with pronoun "it" instead of "that card"
const SPELL_DISCARDS_IT =
  'Target player reveals their hand. You choose a card from it. That player discards it.';

// Standard period-separated form with noncreature filter using "from it; that player discards it"
const FROM_IT_SEMICOLON =
  'When ~ enters, target opponent reveals their hand. You choose a noncreature card from it; that player discards it.';

describe('Slice 11: reveal-hand coercion — semicolon/pronoun/compact-ETB variants', () => {

  // ── parse tests ─────────────────────────────────────────────────────────────

  it('1. parses compact ETB "reveals hand and you choose a card; that player discards it"', () => {
    const p = etbParsed(COMPACT_ETB_ANY);
    const effect = p.ability.effects[0] as RevealHandChooseCardEffect;
    expect(effect.kind).toBe('RevealHandChooseCard');
    expect(effect.disposition).toBe('discard');
    expect(effect.filter).toEqual({});  // any card
  });

  it('2. parses compact ETB "reveals hand and you choose a noncreature card; that player discards it"', () => {
    const p = etbParsed(COMPACT_ETB_NONCREATURE);
    const effect = p.ability.effects[0] as RevealHandChooseCardEffect;
    expect(effect.kind).toBe('RevealHandChooseCard');
    expect(effect.disposition).toBe('discard');
    expect(effect.filter).toMatchObject({ excludeTypes: ['creature'] });
  });

  it('3. parses compact ETB ", then that player discards it" connector', () => {
    const p = etbParsed(COMMA_THEN_ETB);
    const effect = p.ability.effects[0] as RevealHandChooseCardEffect;
    expect(effect.kind).toBe('RevealHandChooseCard');
    expect(effect.disposition).toBe('discard');
    expect(effect.filter).toEqual({});
  });

  it('4. parses spell "that player discards it" pronoun form', () => {
    const p = spellParsed(SPELL_DISCARDS_IT);
    const effect = p.effects[0] as RevealHandChooseCardEffect;
    expect(effect.kind).toBe('RevealHandChooseCard');
    expect(effect.disposition).toBe('discard');
    expect(effect.filter).toEqual({});
  });

  it('5. parses "from it; that player discards it" semicolon-after-from-it form', () => {
    const p = etbParsed(FROM_IT_SEMICOLON);
    const effect = p.ability.effects[0] as RevealHandChooseCardEffect;
    expect(effect.kind).toBe('RevealHandChooseCard');
    expect(effect.disposition).toBe('discard');
    expect(effect.filter).toMatchObject({ excludeTypes: ['creature'] });
  });

  it('6. compact ETB form has filter {} (any card) for unfiltered form', () => {
    const p = etbParsed(COMPACT_ETB_ANY);
    const effect = p.ability.effects[0] as RevealHandChooseCardEffect;
    expect(effect.filter).toEqual({});
  });

  it('7. compact ETB noncreature form has filter with excludeTypes:["creature"]', () => {
    const p = etbParsed(COMPACT_ETB_NONCREATURE);
    const effect = p.ability.effects[0] as RevealHandChooseCardEffect;
    expect(effect.filter).toMatchObject({ excludeTypes: ['creature'] });
    expect((effect.filter as any).types).toBeUndefined();
  });

  // ── executor tests ───────────────────────────────────────────────────────────

  it('8. executor: compact ETB any-card form discards highest-CMC card', () => {
    // p1 has a sorcery (cmc 3) and a land (cmc 0)
    const state = makeState([
      { id: 'c1', defId: 'sorcery' },
      { id: 'c2', defId: 'land' },
    ]);
    const after = runETBBody(COMPACT_ETB_ANY, state);
    // Sorcery (cmc 3) is highest — should be discarded
    expect(after.cards.get('c1')?.zone).toBe('graveyard');
    // Land (cmc 0) should remain in hand
    expect(after.cards.get('c2')?.zone).toBe('hand');
  });

  it('9. executor: noncreature filter discards noncreature, leaves creature in hand', () => {
    // p1 has a sorcery (noncreature) and a creature — noncreature should be discarded
    const state = makeState([
      { id: 'c1', defId: 'sorcery' },
      { id: 'c2', defId: 'creature' },
    ]);
    const after = runETBBody(COMPACT_ETB_NONCREATURE, state);
    // Sorcery is noncreature — should be discarded
    expect(after.cards.get('c1')?.zone).toBe('graveyard');
    // Creature should remain in hand (filter excludes creatures)
    expect(after.cards.get('c2')?.zone).toBe('hand');
  });

  it('10. executor: "discards it" spell form (pronoun) discards highest-CMC card', () => {
    // p1 has an instant (cmc 1) and a sorcery (cmc 3)
    const state = makeState([
      { id: 'c1', defId: 'instant' },
      { id: 'c2', defId: 'sorcery' },
    ]);
    const after = runSpell(SPELL_DISCARDS_IT, state);
    // Sorcery (cmc 3) is highest — discarded
    expect(after.cards.get('c2')?.zone).toBe('graveyard');
    // Instant (cmc 1) stays in hand
    expect(after.cards.get('c1')?.zone).toBe('hand');
  });

  it('11. executor: empty hand is a no-op (no matching cards)', () => {
    const state = makeState([]);
    const after = runETBBody(COMPACT_ETB_ANY, state);
    // No cards to discard — state unchanged
    expect(after.cards.size).toBe(0);
  });

  it('12. cast-without-paying variant stays Unparsed (Mindclaw Shaman — excluded per spec)', () => {
    // "Target opponent reveals their hand. You may cast a spell from among those cards
    //  without paying its mana cost." — unsupported (no cast-without-paying subsystem)
    const mindclaw =
      'Target opponent reveals their hand. You may cast a spell from among those cards without paying its mana cost.';
    const p = parseOracleText(mindclaw);
    expect(p.kind).toBe('Unparsed');
  });

});
