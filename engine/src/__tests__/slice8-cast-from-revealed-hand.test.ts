/**
 * Slice 8/11 — 'Cast from a revealed hand' coercion
 *
 * Tests for matchCastFromRevealedHand and the CastFromRevealedHand executor.
 *
 * Oracle forms tested:
 *   1. Mindclaw Shaman exact wording — period-separated
 *   2. Run-on form ("reveals their hand and you may cast…")
 *   3. "target player" variant (not opponent) — still parses
 *   4. Parse: effect kind is CastFromRevealedHand
 *   5. Parse: filter is { types: ['instant', 'sorcery'] }
 *   6. Parse: emits opponent-constrained Player target spec
 *   7. Parse: selectedCardChoiceId defaults to 'castFromHandCardId'
 *   8. Executor: puts matching instant on the stack under controller's casterId
 *   9. Executor: chooses highest-mana-value matching card (sorcery over instant)
 *  10. Executor: no matching card → no-op (empty hand)
 *  11. Executor: no matching card → no-op (only creatures / lands in hand)
 *  12. Executor: card moves from opponent's hand zone to stack zone
 *  13. Executor: spellsCastThisTurn increments by 1
 *  14. Executor: hasPriorityPassed resets after cast
 *  15. Executor: explicit namedCardChoice honored over AI fallback
 *  16. ETB trigger body parse (Mindclaw Shaman full oracle text)
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { CastFromRevealedHandEffect } from '../effects/ast';

// ── card definitions ───────────────────────────────────────────────────────────

const instantDef: CardDefinition = {
  id: 'lightning-bolt', name: 'Lightning Bolt', type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.', mana_cost: '{R}', cmc: 1,
  colors: ['R'], color_identity: ['R'], keywords: [], card_types: ['instant'],
};

const sorceryDef: CardDefinition = {
  id: 'divination', name: 'Divination', type_line: 'Sorcery',
  oracle_text: 'Draw two cards.', mana_cost: '{2}{U}', cmc: 3,
  colors: ['U'], color_identity: ['U'], keywords: [], card_types: ['sorcery'],
};

const highCmcSorceryDef: CardDefinition = {
  id: 'time-warp', name: 'Time Warp', type_line: 'Sorcery',
  oracle_text: 'Target player takes an extra turn after this one.', mana_cost: '{3}{U}{U}', cmc: 5,
  colors: ['U'], color_identity: ['U'], keywords: [], card_types: ['sorcery'],
};

const creatureDef: CardDefinition = {
  id: 'llanowar-elves', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid',
  oracle_text: '{T}: Add {G}.', mana_cost: '{G}', cmc: 1,
  colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
  power: 1, toughness: 1,
};

const landDef: CardDefinition = {
  id: 'island', name: 'Island', type_line: 'Basic Land — Island',
  oracle_text: '', mana_cost: '', cmc: 0,
  colors: [], color_identity: [], keywords: [], card_types: ['land'],
};

// ── state builder ──────────────────────────────────────────────────────────────

function makeState(opponentHand: { id: string; defId: string }[] = []): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['lightning-bolt', instantDef],
    ['divination', sorceryDef],
    ['time-warp', highCmcSorceryDef],
    ['llanowar-elves', creatureDef],
    ['island', landDef],
  ]);

  const cards = new Map<string, CardInstance>();
  for (const { id, defId } of opponentHand) {
    cards.set(id, {
      instanceId: id, definitionId: defId, ownerId: 'p1', zone: 'hand',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  }

  return {
    players: [createPlayer('p0', 'Controller'), createPlayer('p1', 'Opponent')],
    cards, cardDefinitions: allDefs,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main',
    step: 'begin_combat', turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
    spellsCastThisTurn: 0,
  };
}

// ── helper functions ───────────────────────────────────────────────────────────

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

function runSpell(text: string, state: GameState, options?: { namedCardChoices?: Record<string, string> }): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason)}`);
  const playerSpec = p.targets.find(t => t.type === 'Player');
  if (playerSpec) {
    return executeEffects(state, p.effects, 'p0', ['p1'], [{ id: playerSpec.id }], 0, options ?? {});
  }
  return executeEffects(state, p.effects, 'p0', [], [], 0, options ?? {});
}

// ── oracle wordings ────────────────────────────────────────────────────────────

/** Mindclaw Shaman ETB effect: period-separated form */
const MINDCLAW_SHAMAN =
  'Target opponent reveals their hand. You may cast an instant or sorcery spell from among those cards without paying its mana cost.';

/** Run-on form: "and you may cast..." */
const RUN_ON_FORM =
  'Target opponent reveals their hand and you may cast an instant or sorcery spell from among those cards without paying its mana cost.';

/** "target player" variant */
const TARGET_PLAYER_FORM =
  'Target player reveals their hand. You may cast an instant or sorcery spell from among those cards without paying its mana cost.';

/** Mindclaw Shaman full oracle text (ETB trigger) */
const MINDCLAW_FULL =
  "When ~ enters, target opponent reveals their hand. You may cast an instant or sorcery spell from among those cards without paying its mana cost.";

// ── parse tests ────────────────────────────────────────────────────────────────

describe('CastFromRevealedHand: parse — Mindclaw Shaman period-separated', () => {
  it('4. parses as CastFromRevealedHand effect', () => {
    const [eff] = spellEffects(MINDCLAW_SHAMAN);
    expect(eff.kind).toBe('CastFromRevealedHand');
  });

  it('5. filter is { types: ["instant", "sorcery"] }', () => {
    const [eff] = spellEffects(MINDCLAW_SHAMAN);
    if (eff.kind !== 'CastFromRevealedHand') return;
    const e = eff as CastFromRevealedHandEffect;
    expect(e.filter).toMatchObject({ types: expect.arrayContaining(['instant', 'sorcery']) });
    // Should not include other types
    expect((e.filter as { types: string[] }).types).toHaveLength(2);
  });

  it('6. emits opponent-constrained Player target spec', () => {
    const p = spellParsed(MINDCLAW_SHAMAN);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('7. selectedCardChoiceId defaults to "castFromHandCardId"', () => {
    const [eff] = spellEffects(MINDCLAW_SHAMAN);
    if (eff.kind !== 'CastFromRevealedHand') return;
    const e = eff as CastFromRevealedHandEffect;
    expect(e.selectedCardChoiceId).toBe('castFromHandCardId');
  });
});

describe('CastFromRevealedHand: parse — run-on form', () => {
  it('2. run-on form parses as CastFromRevealedHand', () => {
    const [eff] = spellEffects(RUN_ON_FORM);
    expect(eff.kind).toBe('CastFromRevealedHand');
  });

  it('run-on form: filter still { types: ["instant", "sorcery"] }', () => {
    const [eff] = spellEffects(RUN_ON_FORM);
    if (eff.kind !== 'CastFromRevealedHand') return;
    const e = eff as CastFromRevealedHandEffect;
    expect(e.filter).toMatchObject({ types: expect.arrayContaining(['instant', 'sorcery']) });
  });
});

describe('CastFromRevealedHand: parse — target player variant', () => {
  it('3. "target player" form also parses as CastFromRevealedHand', () => {
    const [eff] = spellEffects(TARGET_PLAYER_FORM);
    expect(eff.kind).toBe('CastFromRevealedHand');
  });

  it('target player form: target spec has no opponentControls constraint', () => {
    const p = spellParsed(TARGET_PLAYER_FORM);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    // "target player" is unconstrained (not opponent-only)
    expect(p.targets[0].constraints?.opponentControls).toBeUndefined();
  });
});

describe('CastFromRevealedHand: parse — ETB trigger body (Mindclaw Shaman full oracle)', () => {
  it('16. Mindclaw Shaman full text parses as ETB with CastFromRevealedHand body', () => {
    // Replace ~ with the card name for parsing
    const text = MINDCLAW_FULL.replace('~', 'Mindclaw Shaman');
    const p = parseOracleText(text);
    // Should parse as ETB (the "when ~ enters" prefix)
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    // The body should include CastFromRevealedHand
    const castEffect = p.ability.effects.find((e: { kind: string }) => e.kind === 'CastFromRevealedHand');
    expect(castEffect).toBeDefined();
    if (!castEffect) return;
    expect((castEffect as CastFromRevealedHandEffect).filter).toMatchObject(
      { types: expect.arrayContaining(['instant', 'sorcery']) }
    );
  });
});

// ── executor tests ─────────────────────────────────────────────────────────────

describe('CastFromRevealedHand: executor — basic cast', () => {
  it('8. puts matching instant on the stack under controller\'s casterId', () => {
    const state = makeState([{ id: 'inst-1', defId: 'lightning-bolt' }]);
    const next = runSpell(MINDCLAW_SHAMAN, state);

    expect(next.stack).toHaveLength(1);
    const item = next.stack[0];
    expect(item.kind).toBe('Spell');
    if (item.kind !== 'Spell') return;
    expect(item.cardInstanceId).toBe('inst-1');
    expect(item.casterId).toBe('p0'); // controller's id, not opponent's
  });

  it('12. card moves from opponent\'s hand zone to stack zone', () => {
    const state = makeState([{ id: 'inst-1', defId: 'lightning-bolt' }]);
    const next = runSpell(MINDCLAW_SHAMAN, state);

    const card = next.cards.get('inst-1')!;
    expect(card.zone).toBe('stack');
    // ownerId stays with original owner (opponent)
    expect(card.ownerId).toBe('p1');
  });

  it('13. spellsCastThisTurn increments by 1', () => {
    const state = makeState([{ id: 'inst-1', defId: 'lightning-bolt' }]);
    const next = runSpell(MINDCLAW_SHAMAN, state);

    expect(next.spellsCastThisTurn).toBe(1);
  });

  it('14. hasPriorityPassed resets after cast', () => {
    const state: GameState = {
      ...makeState([{ id: 'inst-1', defId: 'lightning-bolt' }]),
      hasPriorityPassed: [true, true],
    };
    const next = runSpell(MINDCLAW_SHAMAN, state);

    expect(next.hasPriorityPassed).toEqual([false, false]);
  });
});

describe('CastFromRevealedHand: executor — highest CMC selection', () => {
  it('9. chooses highest-mana-value card (sorcery cmc=3 over instant cmc=1)', () => {
    const state = makeState([
      { id: 'inst-1', defId: 'lightning-bolt' },
      { id: 'sorc-1', defId: 'divination' },
    ]);
    const next = runSpell(MINDCLAW_SHAMAN, state);

    expect(next.stack).toHaveLength(1);
    const item = next.stack[0];
    if (item.kind !== 'Spell') return;
    // Divination has cmc 3; Lightning Bolt has cmc 1 — should choose Divination
    expect(item.cardInstanceId).toBe('sorc-1');
  });

  it('chooses highest CMC among multiple sorceries (cmc=5 over cmc=3)', () => {
    const state = makeState([
      { id: 'sorc-1', defId: 'divination' },
      { id: 'sorc-2', defId: 'time-warp' },
    ]);
    const next = runSpell(MINDCLAW_SHAMAN, state);

    expect(next.stack).toHaveLength(1);
    const item = next.stack[0];
    if (item.kind !== 'Spell') return;
    expect(item.cardInstanceId).toBe('sorc-2'); // Time Warp cmc=5
  });
});

describe('CastFromRevealedHand: executor — no-op cases', () => {
  it('10. no-op when opponent\'s hand is empty', () => {
    const state = makeState([]);
    const next = runSpell(MINDCLAW_SHAMAN, state);

    expect(next.stack).toHaveLength(0);
    expect(next.spellsCastThisTurn).toBe(0);
  });

  it('11. no-op when opponent only has creatures and lands (no instants/sorceries)', () => {
    const state = makeState([
      { id: 'cre-1', defId: 'llanowar-elves' },
      { id: 'land-1', defId: 'island' },
    ]);
    const next = runSpell(MINDCLAW_SHAMAN, state);

    expect(next.stack).toHaveLength(0);
    expect(next.spellsCastThisTurn).toBe(0);
    // Cards stay in hand
    expect(next.cards.get('cre-1')?.zone).toBe('hand');
    expect(next.cards.get('land-1')?.zone).toBe('hand');
  });
});

describe('CastFromRevealedHand: executor — explicit card choice', () => {
  it('15. explicit namedCardChoice honored over AI fallback', () => {
    const state = makeState([
      { id: 'inst-1', defId: 'lightning-bolt' },  // cmc 1
      { id: 'sorc-1', defId: 'divination' },       // cmc 3 — AI would pick this
    ]);
    // Explicitly choose the lower-CMC card
    const next = runSpell(MINDCLAW_SHAMAN, state, {
      namedCardChoices: { castFromHandCardId: 'inst-1' },
    });

    expect(next.stack).toHaveLength(1);
    const item = next.stack[0];
    if (item.kind !== 'Spell') return;
    expect(item.cardInstanceId).toBe('inst-1'); // explicit choice wins
  });
});
