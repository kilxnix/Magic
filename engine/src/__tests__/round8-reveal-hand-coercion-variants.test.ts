/**
 * Round 8 — Reveal-hand coercion: subject/conjunction/filter/destination variants
 *
 * Tests cover:
 *  1. Painful Memories parse: "Put that card on top of that player's library." (disposition=putOnTop)
 *  2. "their library" variant of putOnTop destination
 *  3. Venarian Glimmer conjunction: "look at ... hand and choose a nonland card with mana value X..."
 *  4. Abandon Hope parse: "You choose X cards from it. That opponent discards those cards."
 *  5. Executor: Painful Memories — chosen card moves to top of owner's library
 *  6. Executor: Painful Memories — no-op when hand is empty
 *  7. Executor: Venarian Glimmer conjunction form — nonland filter + X mana bound
 *  8. Executor: Abandon Hope — discards X=2 cards from revealed hand
 *  9. Executor: Abandon Hope — no-op when X=0
 * 10. ETB trigger body with putOnTop disposition
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect, LookAtHandEffect, DiscardEffect } from '../effects/ast';

// ── card definitions ──────────────────────────────────────────────────────────

const sorceryDef: CardDefinition = {
  id: 'sorcery', name: 'Divination', type_line: 'Sorcery',
  oracle_text: '', mana_cost: '{2}{U}', cmc: 3, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['sorcery'],
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
 * p0 is the caster; p1 is the target player whose hand we attack.
 * p1Hand populates the hand of the second player (index 1).
 */
function makeState(p1Hand: { id: string; defId: string }[] = []): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['sorcery', sorceryDef],
    ['instant', instantDef],
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

/** Execute the full parsed spell against state, targeting p1 as the chosen player. */
function runSpell(text: string, state: GameState, xValue = 0): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason)}`);
  const playerSpec = p.targets.find(t => t.type === 'Player');
  if (playerSpec) {
    return executeEffects(state, p.effects, 'p0', ['p1'], [{ id: playerSpec.id }], xValue, {});
  }
  return executeEffects(state, p.effects, 'p0', [], [], xValue, {});
}

// ── 1. Painful Memories parse ─────────────────────────────────────────────────

describe('Painful Memories: reveals hand, choose a card, put on top of library', () => {
  const painfulMemoriesText =
    "Target player reveals their hand. You choose a card from it. Put that card on top of that player's library.";

  it('parses as a Spell', () => {
    const p = spellParsed(painfulMemoriesText);
    expect(p.effects.length).toBeGreaterThanOrEqual(1);
  });

  it('emits RevealHandChooseCard with disposition=putOnTop', () => {
    const p = spellParsed(painfulMemoriesText);
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.disposition).toBe('putOnTop');
    expect(e.filter).toEqual({});
  });

  it('emits a Player target spec', () => {
    const p = spellParsed(painfulMemoriesText);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
  });
});

// ── 2. "their library" variant of putOnTop ────────────────────────────────────

describe('putOnTop: "on top of their library" variant', () => {
  it('parses and emits putOnTop disposition', () => {
    const text =
      "Target player reveals their hand. You choose a card from it. Put that card on top of their library.";
    const p = spellParsed(text);
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.disposition).toBe('putOnTop');
  });
});

// ── 3. Venarian Glimmer conjunction form ──────────────────────────────────────

describe("Venarian Glimmer: \"look at ... hand and choose a nonland card with mana value X...\"", () => {
  const venarimConj =
    "Look at target opponent's hand and choose a nonland card with mana value X or less from it. That player discards that card.";

  it('parses as a Spell with at least 2 effects', () => {
    const p = spellParsed(venarimConj);
    expect(p.effects.length).toBeGreaterThanOrEqual(2);
  });

  it('first effect is LookAtHand', () => {
    const p = spellParsed(venarimConj);
    expect(p.effects[0].kind).toBe('LookAtHand');
  });

  it('contains RevealHandChooseCard with nonland filter + X cmc bound + discard', () => {
    const p = spellParsed(venarimConj);
    const choose = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(choose).toBeDefined();
    if (!choose) return;
    expect(choose.disposition).toBe('discard');
    expect(choose.filter.excludeTypes).toContain('land');
    expect(choose.filter.cmc).toBeDefined();
    expect(choose.filter.cmc?.x).toBe(true);
  });

  it('target spec is opponent-constrained', () => {
    const p = spellParsed(venarimConj);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });
});

// ── 4. Abandon Hope parse ─────────────────────────────────────────────────────

describe('Abandon Hope: "You choose X cards from it. That opponent discards those cards."', () => {
  const abandonHopeEffectText =
    "Target opponent reveals their hand. You choose X cards from it. That opponent discards those cards.";

  it('parses as a Spell', () => {
    const p = spellParsed(abandonHopeEffectText);
    expect(p.effects.length).toBeGreaterThanOrEqual(1);
  });

  it('emits LookAtHand + Discard pair', () => {
    const p = spellParsed(abandonHopeEffectText);
    const look = p.effects.find(x => x.kind === 'LookAtHand') as LookAtHandEffect | undefined;
    const discard = p.effects.find(x => x.kind === 'Discard') as DiscardEffect | undefined;
    expect(look).toBeDefined();
    expect(discard).toBeDefined();
  });

  it('Discard effect has count={kind:X}', () => {
    const p = spellParsed(abandonHopeEffectText);
    const discard = p.effects.find(x => x.kind === 'Discard') as DiscardEffect | undefined;
    expect(discard).toBeDefined();
    if (!discard) return;
    expect(discard.count).toEqual({ kind: 'X' });
  });

  it('emits opponent-constrained Player target', () => {
    const p = spellParsed(abandonHopeEffectText);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('full Abandon Hope oracle parses (additional cost prefix is skipped)', () => {
    const fullText =
      "As an additional cost to cast this spell, discard X cards.\nTarget opponent reveals their hand. You choose X cards from it. That opponent discards those cards.";
    const r = parseOracleText(fullText);
    // The "as an additional cost" part is unknown but the effect clause should parse
    expect(r.kind).toBe('Spell');
    const discard = (r as Extract<typeof r, {kind:'Spell'}>).effects.find(x => x.kind === 'Discard');
    expect(discard).toBeDefined();
  });
});

// ── 5. Executor: Painful Memories — card goes to top of library ───────────────

describe('Executor: Painful Memories — chosen card moved to top of library', () => {
  const painfulText =
    "Target player reveals their hand. You choose a card from it. Put that card on top of that player's library.";

  it('moves the highest-CMC card to p1 library', () => {
    const state = makeState([
      { id: 'h_sorcery', defId: 'sorcery' },  // cmc 3
      { id: 'h_instant', defId: 'instant' },  // cmc 2
      { id: 'h_land', defId: 'land' },         // cmc 0
    ]);

    const after = runSpell(painfulText, state);

    // Sorcery (highest CMC = 3) should now be in p1's library
    expect(after.cards.get('h_sorcery')?.zone).toBe('library');
    // Instant and land remain in hand
    expect(after.cards.get('h_instant')?.zone).toBe('hand');
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });

  it('no-op when hand is empty', () => {
    const state = makeState([]);
    const after = runSpell(painfulText, state);
    // No cards at all — nothing should error or mutate
    expect([...after.cards.values()].filter(c => c.ownerId === 'p1').length).toBe(0);
  });
});

// ── 6. Executor: Venarian Glimmer conjunction form ────────────────────────────

describe('Executor: Venarian Glimmer conjunction form — nonland with X-mana filter', () => {
  const venarimConj =
    "Look at target opponent's hand and choose a nonland card with mana value X or less from it. That player discards that card.";

  it('with X=2: discards highest nonland card with cmc<=2, leaves land and higher CMC', () => {
    const state = makeState([
      { id: 'h_bigcre', defId: 'bigcre' },    // cmc 6 creature — above X
      { id: 'h_instant', defId: 'instant' },  // cmc 2 instant — chosen (nonland, cmc<=2)
      { id: 'h_land', defId: 'land' },         // cmc 0 land — excluded by filter
    ]);

    const after = runSpell(venarimConj, state, 2);

    // instant (cmc 2, nonland, cmc <= 2) should be discarded
    expect(after.cards.get('h_instant')?.zone).toBe('graveyard');
    // bigcre (cmc 6 > 2) stays in hand
    expect(after.cards.get('h_bigcre')?.zone).toBe('hand');
    // land excluded by nonland filter
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });

  it('no-op when no matching nonland card within X mana value', () => {
    const state = makeState([
      { id: 'h_bigcre', defId: 'bigcre' },    // cmc 6 — above X=1
      { id: 'h_land', defId: 'land' },         // excluded by nonland filter
    ]);

    const after = runSpell(venarimConj, state, 1);

    expect(after.cards.get('h_bigcre')?.zone).toBe('hand');
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });
});

// ── 7. Executor: Abandon Hope — discard X cards ───────────────────────────────

describe('Executor: Abandon Hope — discard X cards from hand', () => {
  const effectText =
    "Target opponent reveals their hand. You choose X cards from it. That opponent discards those cards.";

  it('with X=2: discards 2 highest-CMC cards from opponent hand', () => {
    const state = makeState([
      { id: 'h_bigcre', defId: 'bigcre' },     // cmc 6 — discarded first
      { id: 'h_sorcery', defId: 'sorcery' },   // cmc 3 — discarded second
      { id: 'h_instant', defId: 'instant' },   // cmc 2 — stays
      { id: 'h_land', defId: 'land' },          // cmc 0 — stays
    ]);

    const after = runSpell(effectText, state, 2);

    // 2 highest CMC cards go to graveyard
    expect(after.cards.get('h_bigcre')?.zone).toBe('graveyard');
    expect(after.cards.get('h_sorcery')?.zone).toBe('graveyard');
    // Lower CMC cards stay
    expect(after.cards.get('h_instant')?.zone).toBe('hand');
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });

  it('with X=0: discards nothing', () => {
    const state = makeState([
      { id: 'h_sorcery', defId: 'sorcery' },
    ]);

    const after = runSpell(effectText, state, 0);

    expect(after.cards.get('h_sorcery')?.zone).toBe('hand');
  });
});

// ── 8. ETB trigger body with putOnTop ─────────────────────────────────────────

describe('ETB trigger body: Painful Memories disposition', () => {
  it('parses as ETB with RevealHandChooseCard(putOnTop)', () => {
    const etbText =
      "When ~ enters the battlefield, target player reveals their hand. You choose a card from it. Put that card on top of that player's library.";
    const r = parseOracleText(etbText);
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    const choose = r.ability.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(choose).toBeDefined();
    if (!choose) return;
    expect(choose.disposition).toBe('putOnTop');
  });
});
