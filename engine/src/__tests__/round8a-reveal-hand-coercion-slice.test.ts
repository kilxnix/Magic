/**
 * Round 8 cut (a) — Reveal-hand coercion: new disposition/choose-clause variants
 *
 * Tests cover:
 *  1.  Binding Negotiation parse: "You may choose a nonland card from it.
 *      That player discards that card." → Spell(RevealHandChooseCard, discard, nonland)
 *  2.  Binding Negotiation executor: nonland card is discarded; land stays
 *  3.  Specter's Shriek parse: "You may choose a nonland card from it.
 *      That player exiles that card." → Spell(RevealHandChooseCard, exile, nonland)
 *  4.  Specter's Shriek executor: nonland card is exiled; land stays
 *  5.  Dreams of Steel and Oil parse: "Choose an artifact or creature card from it.
 *      Exile that card." — bare "choose" (no "you") → exile, artifact+creature filter
 *  6.  Dreams of Steel and Oil executor: artifact card exiled; land ignored
 *  7.  ETB trigger wrapping Specter's Shriek body parses as ETB(RevealHandChooseCard, exile)
 *  8.  "that player exiles it" pronoun variant ("it" not "that card") parses correctly
 *  9.  Dreams of Steel and Oil: only artifact/creature cards are eligible (land excluded)
 * 10.  No-op when hand has no matching card (Dreams of Steel and Oil, hand has only lands)
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect } from '../effects/ast';

// ── card definitions ──────────────────────────────────────────────────────────

const artifactDef: CardDefinition = {
  id: 'artifact', name: 'Sol Ring', type_line: 'Artifact',
  oracle_text: '', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact'],
};

const creatureDef: CardDefinition = {
  id: 'creature', name: 'Grizzly Bears', type_line: 'Creature — Bear',
  oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 2,
};

const instantDef: CardDefinition = {
  id: 'instant', name: 'Doom Blade', type_line: 'Instant',
  oracle_text: '', mana_cost: '{1}{B}', cmc: 2, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['instant'],
};

const landDef: CardDefinition = {
  id: 'land', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};

// ── state builder ─────────────────────────────────────────────────────────────

/** p0 = caster; p1 = target whose hand we raid. */
function makeState(p1Hand: { id: string; defId: string }[] = []): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['artifact', artifactDef],
    ['creature', creatureDef],
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
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason ?? '')}`);
  return p;
}

function runSpell(text: string, state: GameState): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}`);
  const playerSpec = p.targets.find(t => t.type === 'Player');
  if (playerSpec) {
    return executeEffects(state, p.effects, 'p0', ['p1'], [{ id: playerSpec.id }], 0, {});
  }
  return executeEffects(state, p.effects, 'p0', [], [], 0, {});
}

// ── oracle texts ──────────────────────────────────────────────────────────────

const BINDING_NEGOTIATION =
  "Target opponent reveals their hand. You may choose a nonland card from it. That player discards that card.";

const SPECTERS_SHRIEK =
  "Target opponent reveals their hand. You may choose a nonland card from it. That player exiles that card.";

const DREAMS_OF_STEEL_AND_OIL =
  "Target opponent reveals their hand. Choose an artifact or creature card from it. Exile that card.";

// ── 1. Binding Negotiation parse ──────────────────────────────────────────────

describe('Binding Negotiation parse', () => {
  it('1. parses as Spell', () => {
    expect(parseOracleText(BINDING_NEGOTIATION).kind).toBe('Spell');
  });

  it('1. emits RevealHandChooseCard with disposition=discard and nonland filter', () => {
    const p = spellParsed(BINDING_NEGOTIATION);
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.disposition).toBe('discard');
    expect(e.filter.excludeTypes).toContain('land');
    expect(e.player.kind).toBe('Chosen');
  });

  it('1. emits opponent-constrained Player target', () => {
    const p = spellParsed(BINDING_NEGOTIATION);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });
});

// ── 2. Binding Negotiation executor ──────────────────────────────────────────

describe('Binding Negotiation executor', () => {
  it('2. discards nonland card (highest CMC), leaves land in hand', () => {
    const state = makeState([
      { id: 'h_instant', defId: 'instant' },  // cmc 2 nonland — chosen
      { id: 'h_land', defId: 'land' },         // cmc 0 land — excluded
    ]);
    const after = runSpell(BINDING_NEGOTIATION, state);
    expect(after.cards.get('h_instant')?.zone).toBe('graveyard');
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });
});

// ── 3. Specter's Shriek parse ─────────────────────────────────────────────────

describe("Specter's Shriek parse", () => {
  it("3. parses as Spell", () => {
    expect(parseOracleText(SPECTERS_SHRIEK).kind).toBe('Spell');
  });

  it("3. emits RevealHandChooseCard with disposition=exile and nonland filter", () => {
    const p = spellParsed(SPECTERS_SHRIEK);
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.disposition).toBe('exile');
    expect(e.filter.excludeTypes).toContain('land');
  });

  it("3. emits opponent-constrained Player target", () => {
    const p = spellParsed(SPECTERS_SHRIEK);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });
});

// ── 4. Specter's Shriek executor ──────────────────────────────────────────────

describe("Specter's Shriek executor", () => {
  it('4. exiles nonland card (highest CMC), leaves land in hand', () => {
    const state = makeState([
      { id: 'h_creature', defId: 'creature' },  // cmc 2 creature — chosen
      { id: 'h_land', defId: 'land' },           // cmc 0 land — excluded
    ]);
    const after = runSpell(SPECTERS_SHRIEK, state);
    expect(after.cards.get('h_creature')?.zone).toBe('exile');
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });

  it('4. no-op when only lands in hand', () => {
    const state = makeState([
      { id: 'h_land', defId: 'land' },
    ]);
    const after = runSpell(SPECTERS_SHRIEK, state);
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });
});

// ── 5. Dreams of Steel and Oil parse ─────────────────────────────────────────

describe('Dreams of Steel and Oil parse', () => {
  it('5. parses as Spell', () => {
    expect(parseOracleText(DREAMS_OF_STEEL_AND_OIL).kind).toBe('Spell');
  });

  it('5. emits RevealHandChooseCard with disposition=exile and artifact+creature filter', () => {
    const p = spellParsed(DREAMS_OF_STEEL_AND_OIL);
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.disposition).toBe('exile');
    expect(e.filter.types).toContain('artifact');
    expect(e.filter.types).toContain('creature');
  });

  it('5. emits opponent-constrained Player target', () => {
    const p = spellParsed(DREAMS_OF_STEEL_AND_OIL);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });
});

// ── 6. Dreams of Steel and Oil executor ──────────────────────────────────────

describe('Dreams of Steel and Oil executor', () => {
  it('6. exiles artifact card, leaves land in hand', () => {
    const state = makeState([
      { id: 'h_artifact', defId: 'artifact' },  // artifact — chosen
      { id: 'h_land', defId: 'land' },           // land — not matching filter
    ]);
    const after = runSpell(DREAMS_OF_STEEL_AND_OIL, state);
    expect(after.cards.get('h_artifact')?.zone).toBe('exile');
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });

  it('6. exiles creature card when multiple options — picks highest CMC', () => {
    const state = makeState([
      { id: 'h_artifact', defId: 'artifact' },  // cmc 1
      { id: 'h_creature', defId: 'creature' },  // cmc 2 — chosen (highest CMC)
      { id: 'h_land', defId: 'land' },           // excluded
    ]);
    const after = runSpell(DREAMS_OF_STEEL_AND_OIL, state);
    expect(after.cards.get('h_creature')?.zone).toBe('exile');
    expect(after.cards.get('h_artifact')?.zone).toBe('hand');
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });
});

// ── 7. ETB trigger with Specter's Shriek body ────────────────────────────────

describe("ETB trigger wrapping Specter's Shriek body", () => {
  it('7. parses as ETB with RevealHandChooseCard(exile)', () => {
    const etbText =
      "When ~ enters the battlefield, target opponent reveals their hand. You may choose a nonland card from it. That player exiles that card.";
    const r = parseOracleText(etbText);
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    const e = r.ability.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.disposition).toBe('exile');
    expect(e.filter.excludeTypes).toContain('land');
  });
});

// ── 8. "that player exiles it" pronoun variant ────────────────────────────────

describe('"that player exiles it" pronoun variant', () => {
  it('8. parses with "it" pronoun (compact form)', () => {
    const text =
      "Target opponent reveals their hand. You may choose a nonland card from it. That player exiles it.";
    const r = parseOracleText(text);
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const e = r.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.disposition).toBe('exile');
  });
});

// ── 9. Dreams of Steel and Oil: only artifact/creature eligible ───────────────

describe('Dreams of Steel and Oil: only artifact/creature cards eligible', () => {
  it('9. instant (non-artifact, non-creature) is not matched by filter', () => {
    const state = makeState([
      { id: 'h_instant', defId: 'instant' },  // instant — should NOT be chosen
      { id: 'h_land', defId: 'land' },         // land — excluded
    ]);
    // With no matching artifact/creature, the spell is a no-op
    const after = runSpell(DREAMS_OF_STEEL_AND_OIL, state);
    expect(after.cards.get('h_instant')?.zone).toBe('hand');
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });
});

// ── 10. No-op when hand has no matching card ──────────────────────────────────

describe('No-op when no eligible cards', () => {
  it('10. Dreams of Steel and Oil: no-op when hand is empty', () => {
    const state = makeState([]);
    const after = runSpell(DREAMS_OF_STEEL_AND_OIL, state);
    // Should not throw; state unchanged
    expect([...after.cards.values()].filter(c => c.ownerId === 'p1').length).toBe(0);
  });
});
