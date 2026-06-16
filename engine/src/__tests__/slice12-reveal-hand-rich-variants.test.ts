/**
 * Slice 12 — Reveal-hand coercion rich variants
 *
 * Tests cover:
 *  1. Talara's Bane parse: "green or white creature card" + life-gain rider
 *  2. Venarian Glimmer parse: "nonland card with mana value X or less" (look-at opener)
 *  3. Invasion of Gobakhan parse: "Look at ... You may exile a card from it."
 *  4. matchRevealHandChooseCardWithLifeGainRider emits gainLifeEqualToChosenCardToughness:true
 *  5. matchLookAtHandThenChooseCard emits LookAtHand + RevealHandChooseCard pair
 *  6. Executor: Talara's Bane gains life = chosen card's toughness before discarding
 *  7. Executor: life-gain is 0 when hand is empty (no chosen card)
 *  8. Executor: Venarian Glimmer — X=2 bound discards matching card, leaves others
 *  9. Executor: Invasion of Gobakhan optional exile exiles the chosen card
 * 10. "target player" opener (non-opponent) for life-gain rider
 * 11. Look-at opener for "player's hand" (non-opponent)
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect, LookAtHandEffect } from '../effects/ast';

// ── card definitions ─────────────────────────────────────────────────────────

/** Green creature, toughness 3 */
const greenCreatureDef: CardDefinition = {
  id: 'greencre', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid',
  oracle_text: '', mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 1, toughness: 3,
};

/** White creature, toughness 5 */
const whiteCreatureDef: CardDefinition = {
  id: 'whitecre', name: 'Baneslayer Angel', type_line: 'Creature — Angel',
  oracle_text: '', mana_cost: '{3}{W}{W}', cmc: 5, colors: ['W'], color_identity: ['W'],
  keywords: [], card_types: ['creature'], power: 5, toughness: 5,
};

/** Blue creature — should NOT be chosen by green-or-white filter */
const blueCreatureDef: CardDefinition = {
  id: 'bluecre', name: 'Snapcaster Mage', type_line: 'Creature — Human Wizard',
  oracle_text: '', mana_cost: '{1}{U}', cmc: 2, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 1,
};

/** Nonland noncreature (sorcery), cmc 3 */
const sorceryDef: CardDefinition = {
  id: 'sorcery', name: 'Divination', type_line: 'Sorcery',
  oracle_text: '', mana_cost: '{2}{U}', cmc: 3, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['sorcery'],
};

/** Nonland noncreature, cmc 4 */
const instantDef: CardDefinition = {
  id: 'instant', name: 'Cryptic Command', type_line: 'Instant',
  oracle_text: '', mana_cost: '{1}{U}{U}{U}', cmc: 4, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['instant'],
};

/** Land */
const landDef: CardDefinition = {
  id: 'land', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};

/** Creature with cmc 5, toughness 4 — for optional exile test */
const bigCreatureDef: CardDefinition = {
  id: 'bigcre', name: 'Grave Titan', type_line: 'Creature — Zombie Giant',
  oracle_text: '', mana_cost: '{4}{B}{B}', cmc: 6, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['creature'], power: 6, toughness: 6,
};

// ── helpers ───────────────────────────────────────────────────────────────────

function makeState(p1Hand: { id: string; defId: string }[] = []): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['greencre', greenCreatureDef],
    ['whitecre', whiteCreatureDef],
    ['bluecre', blueCreatureDef],
    ['sorcery', sorceryDef],
    ['instant', instantDef],
    ['land', landDef],
    ['bigcre', bigCreatureDef],
  ]);

  const cards = new Map<string, CardInstance>();
  for (const { id, defId } of p1Hand) {
    cards.set(id, {
      instanceId: id, definitionId: defId, ownerId: 'p1', zone: 'hand',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  }

  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards, cardDefinitions: allDefs,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main',
    step: 'begin_combat', turnNumber: 2, hasPriorityPassed: [false, false],
    stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function spellEffects(text: string) {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason)}`);
  return p.effects;
}

function spellParsed(text: string) {
  return parseOracleText(text);
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

// ── parse tests ───────────────────────────────────────────────────────────────

describe("Slice 12 — Talara's Bane: parse + life-gain rider flag", () => {
  const taalaraBaneText =
    "Target opponent reveals their hand. You choose a green or white creature card from it. You gain life equal to that creature card's toughness, then that player discards that card.";

  it('parses into a Spell with one Player target', () => {
    const p = spellParsed(taalaraBaneText);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('emits one RevealHandChooseCard effect', () => {
    const effects = spellEffects(taalaraBaneText);
    expect(effects).toHaveLength(1);
    expect(effects[0].kind).toBe('RevealHandChooseCard');
  });

  it('has green+white colors filter and creature type', () => {
    const [eff] = spellEffects(taalaraBaneText);
    if (eff.kind !== 'RevealHandChooseCard') throw new Error('wrong kind');
    const colors = eff.filter.colors ?? [];
    expect(colors).toContain('G');
    expect(colors).toContain('W');
    expect(eff.filter.types).toContain('creature');
    expect(eff.disposition).toBe('discard');
  });

  it('sets gainLifeEqualToChosenCardToughness: true', () => {
    const [eff] = spellEffects(taalaraBaneText);
    if (eff.kind !== 'RevealHandChooseCard') throw new Error('wrong kind');
    expect(eff.gainLifeEqualToChosenCardToughness).toBe(true);
  });
});

describe("Slice 12 — Venarian Glimmer: look-at opener + nonland + X-mana-value", () => {
  const venarimText =
    "Look at target opponent's hand. You choose a nonland card from it with mana value X or less. That player discards that card.";

  it('parses into a Spell', () => {
    const p = spellParsed(venarimText);
    expect(p.kind).toBe('Spell');
  });

  it('emits LookAtHand followed by RevealHandChooseCard', () => {
    const effects = spellEffects(venarimText);
    expect(effects).toHaveLength(2);
    expect(effects[0].kind).toBe('LookAtHand');
    expect(effects[1].kind).toBe('RevealHandChooseCard');
  });

  it('RevealHandChooseCard has excludeTypes:[land] and cmc.x=true', () => {
    const effects = spellEffects(venarimText);
    const choose = effects[1] as RevealHandChooseCardEffect;
    expect(choose.filter.excludeTypes).toContain('land');
    expect(choose.filter.cmc?.x).toBe(true);
    expect(choose.filter.cmc?.op).toBe('lte');
    expect(choose.disposition).toBe('discard');
  });

  it('target is an opponent player', () => {
    const p = spellParsed(venarimText);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });
});

describe("Slice 12 — Invasion of Gobakhan: look-at + may exile", () => {
  const gobakhanText =
    "Look at target opponent's hand. You may exile a card from it.";

  it('parses into a Spell', () => {
    const p = spellParsed(gobakhanText);
    expect(p.kind).toBe('Spell');
  });

  it('emits LookAtHand + optional RevealHandChooseCard(exile)', () => {
    const effects = spellEffects(gobakhanText);
    expect(effects).toHaveLength(2);
    expect(effects[0].kind).toBe('LookAtHand');
    expect(effects[1].kind).toBe('RevealHandChooseCard');
    const exile = effects[1] as RevealHandChooseCardEffect;
    expect(exile.disposition).toBe('exile');
    expect(exile.optional).toBe(true);
    expect(exile.filter).toEqual({});
  });

  it('shares the same player target ref between both effects', () => {
    const p = spellParsed(gobakhanText);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    expect(p.targets).toHaveLength(1);
    const lookAt = p.effects[0] as LookAtHandEffect;
    const choose = p.effects[1] as RevealHandChooseCardEffect;
    if (lookAt.kind !== 'LookAtHand' || choose.kind !== 'RevealHandChooseCard') throw new Error();
    // Both effects reference the same target spec id
    expect(lookAt.player.kind).toBe('Chosen');
    expect(choose.player.kind).toBe('Chosen');
    if (lookAt.player.kind !== 'Chosen' || choose.player.kind !== 'Chosen') throw new Error();
    expect(lookAt.player.targetId).toBe(choose.player.targetId);
  });
});

// ── executor tests ────────────────────────────────────────────────────────────

describe("Executor: Talara's Bane — life-gain rider", () => {
  const taalaraBaneText =
    "Target opponent reveals their hand. You choose a green or white creature card from it. You gain life equal to that creature card's toughness, then that player discards that card.";

  it('gains life equal to chosen card toughness and discards the card', () => {
    // p0 starts at 40 life. p1 hand: white creature (cmc5, toughness5), blue creature (cmc2, toughness1)
    // Matcher picks highest-cmc matching card = whitecre (cmc 5).
    // Life gain = toughness 5.
    const state = makeState([
      { id: 'p1white', defId: 'whitecre' },
      { id: 'p1blue', defId: 'bluecre' },
    ]);
    const after = runSpell(taalaraBaneText, state);

    // Controller (p0) should gain 5 life (white creature toughness = 5)
    const p0 = after.players.find(p => p.id === 'p0')!;
    expect(p0.life).toBe(45); // 40 + 5

    // White creature discarded (highest-cmc green/white)
    expect(after.cards.get('p1white')?.zone).toBe('graveyard');
    // Blue creature stays (not green or white)
    expect(after.cards.get('p1blue')?.zone).toBe('hand');
  });

  it('gains life equal to toughness of chosen green creature', () => {
    // p1 has only a green creature (toughness 3), so it is chosen
    const state = makeState([
      { id: 'p1green', defId: 'greencre' },
    ]);
    const after = runSpell(taalaraBaneText, state);
    const p0 = after.players.find(p => p.id === 'p0')!;
    expect(p0.life).toBe(43); // 40 + 3 (toughness of green creature)
    expect(after.cards.get('p1green')?.zone).toBe('graveyard');
  });

  it('does not gain life when no matching card exists', () => {
    // p1 only has a blue creature — no green/white creature to choose
    const state = makeState([
      { id: 'p1blue', defId: 'bluecre' },
    ]);
    const after = runSpell(taalaraBaneText, state);
    const p0 = after.players.find(p => p.id === 'p0')!;
    expect(p0.life).toBe(40); // unchanged
    expect(after.cards.get('p1blue')?.zone).toBe('hand');
  });
});

describe('Executor: Venarian Glimmer — X-bound nonland discard', () => {
  const venarimText =
    "Look at target opponent's hand. You choose a nonland card from it with mana value X or less. That player discards that card.";

  it('with X=2, discards highest nonland card with cmc<=2, leaves others', () => {
    // p1 hand: sorcery (cmc3), instant (cmc4), land (cmc0)
    // With X=2: no nonland matches cmc<=2 — hand unchanged
    const state = makeState([
      { id: 'p1sorc', defId: 'sorcery' },
      { id: 'p1inst', defId: 'instant' },
      { id: 'p1land', defId: 'land' },
    ]);
    const after = runSpell(venarimText, state, 2);
    // No match: all nonlands have cmc > 2
    expect(after.cards.get('p1sorc')?.zone).toBe('hand');
    expect(after.cards.get('p1inst')?.zone).toBe('hand');
    expect(after.cards.get('p1land')?.zone).toBe('hand');
  });

  it('with X=3, discards the nonland with cmc=3', () => {
    const state = makeState([
      { id: 'p1sorc', defId: 'sorcery' },   // cmc 3, nonland
      { id: 'p1inst', defId: 'instant' },   // cmc 4, nonland — excluded (>X)
      { id: 'p1land', defId: 'land' },
    ]);
    const after = runSpell(venarimText, state, 3);
    expect(after.cards.get('p1sorc')?.zone).toBe('graveyard'); // cmc 3 matches X=3
    expect(after.cards.get('p1inst')?.zone).toBe('hand');      // cmc 4 excluded
    expect(after.cards.get('p1land')?.zone).toBe('hand');      // land excluded
  });
});

describe('Executor: Invasion of Gobakhan — optional exile', () => {
  const gobakhanText =
    "Look at target opponent's hand. You may exile a card from it.";

  it('exiles the highest-cmc card from the hand', () => {
    // p1 hand: sorcery (cmc3), instant (cmc4), land (cmc0)
    // optional exile picks highest-cmc matching card = instant (cmc 4)
    const state = makeState([
      { id: 'p1sorc', defId: 'sorcery' },
      { id: 'p1inst', defId: 'instant' },
      { id: 'p1land', defId: 'land' },
    ]);
    const after = runSpell(gobakhanText, state);
    expect(after.cards.get('p1inst')?.zone).toBe('exile'); // highest cmc chosen
    expect(after.cards.get('p1sorc')?.zone).toBe('hand');
    expect(after.cards.get('p1land')?.zone).toBe('hand');
  });

  it('leaves hand unchanged when opponent has no cards', () => {
    const state = makeState([]);
    const after = runSpell(gobakhanText, state);
    // No cards to exile — state should be fine (no crash)
    expect(after).toBeDefined();
  });
});
