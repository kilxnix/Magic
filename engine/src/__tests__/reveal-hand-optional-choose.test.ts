/**
 * Round 8 slice a — Reveal-hand coercion: optional choose + if-you-do/if-you-don't
 * variants, reveal-plus-top-of-library rider, and Search Warrant gain-life form.
 *
 * Tests cover:
 *  1. Mandatory form (regression) — already existed, verified here.
 *  2. Optional "you may choose" form (Reckoner Shakedown, no else-effects).
 *  3. Optional "you may choose" with "if you don't" else-effects (Reckoner Shakedown).
 *  4. Reveal-hand-and-top-of-library rider (Psychotic Episode).
 *  5. Search Warrant — gain life equal to number of cards in that player's hand.
 *  6. Executor: optional form with no matching cards → else-effects fire.
 *  7. Executor: optional form with matching cards → discard the chosen card.
 *  8. Executor: Search Warrant gain-life counts actual hand size.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect, GainLifeEffect, AddCountersEffect } from '../effects/ast';

// ── helpers ───────────────────────────────────────────────────────────────────

const nonlandDef: CardDefinition = {
  id: 'nonland', name: 'Lightning Bolt', type_line: 'Instant',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'],
  color_identity: ['R'], keywords: [], card_types: ['instant'],
};

const landDef: CardDefinition = {
  id: 'land', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};

const creatureDef: CardDefinition = {
  id: 'cre', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '',
  mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 2,
};

function inst(id: string, defId: string, ownerId: string, zone: CardInstance['zone']): [string, CardInstance] {
  return [id, {
    instanceId: id, definitionId: defId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  }];
}

interface StateOpts {
  p1HandCards?: { id: string; defId: string }[];
  p0HandCards?: { id: string; defId: string }[];
}

function makeState(opts: StateOpts = {}): GameState {
  const cards = new Map<string, CardInstance>();
  const defs = new Map<string, CardDefinition>([
    ['nonland', nonlandDef],
    ['land', landDef],
    ['cre', creatureDef],
  ]);

  for (const { id, defId } of opts.p1HandCards ?? []) {
    cards.set(id, { instanceId: id, definitionId: defId, ownerId: 'p1', zone: 'hand',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
  }
  for (const { id, defId } of opts.p0HandCards ?? []) {
    cards.set(id, { instanceId: id, definitionId: defId, ownerId: 'p0', zone: 'hand',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
  }

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
  // Map the first Player target spec (the revealed-hand target) to p1.
  // executeEffects takes a flat chosenTargetIds array + a parallel targetSpecs array.
  const firstPlayerSpec = p.targets.find(t => t.type === 'Player');
  if (firstPlayerSpec) {
    return executeEffects(state, p.effects, 'p0', ['p1'], [{ id: firstPlayerSpec.id }], 0, {});
  }
  return executeEffects(state, p.effects, 'p0', [], [], 0, {});
}

// ── parse tests ───────────────────────────────────────────────────────────────

describe('mandatory reveal-hand-choose (regression)', () => {
  it('Thoughtseize-style: parses RevealHandChooseCard with discard disposition', () => {
    const [eff] = spellEffects(
      'Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.',
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.filter).toEqual({ excludeTypes: ['land'] });
    expect(eff.disposition).toBe('discard');
    expect(eff.optional).toBeUndefined();
    expect(eff.elseEffects).toBeUndefined();
  });

  it('Castigate-style: exile disposition', () => {
    const [eff] = spellEffects(
      'Target opponent reveals their hand. You choose a nonland card from it and exile that card.',
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.disposition).toBe('exile');
  });
});

describe('optional "you may choose" form (Reckoner Shakedown family)', () => {
  it('parses optional flag when "you may choose" is used — no else branch', () => {
    const [eff] = spellEffects(
      'Target opponent reveals their hand. You may choose a nonland card from it. If you do, that player discards that card.',
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    const e = eff as RevealHandChooseCardEffect;
    expect(e.filter).toEqual({ excludeTypes: ['land'] });
    expect(e.disposition).toBe('discard');
    expect(e.optional).toBe(true);
    expect(e.elseEffects).toBeUndefined();
  });

  it('parses optional flag with "if you don\'t" counter-effects (Reckoner Shakedown)', () => {
    const effects = spellEffects(
      "Target opponent reveals their hand. You may choose a nonland card from it. If you do, that player discards that card. If you don't, put two +1/+1 counters on ~.",
    );
    // Main RevealHandChooseCard effect
    const main = effects[0];
    expect(main.kind).toBe('RevealHandChooseCard');
    if (main.kind !== 'RevealHandChooseCard') return;
    expect(main.optional).toBe(true);
    expect(main.elseEffects).toBeDefined();
    expect(main.elseEffects!.length).toBeGreaterThan(0);
    // The else-effect should be an AddCounters effect
    const elseEff = main.elseEffects![0];
    expect(elseEff.kind).toBe('AddCounters');
    if (elseEff.kind !== 'AddCounters') return;
    const ac = elseEff as AddCountersEffect;
    expect(ac.counterType).toBe('+1/+1');
    expect(ac.count).toBe(2);
  });

  it('player target spec is generated with opponentControls constraint', () => {
    const p = parseOracleText(
      'Target opponent reveals their hand. You may choose a nonland card from it. If you do, that player discards that card.',
    );
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });
});

describe('reveal-hand-and-top-of-library (Psychotic Episode family)', () => {
  it('parses the "and the top card of their library" rider form — discard', () => {
    const [eff] = spellEffects(
      'Target player reveals their hand and the top card of their library. You choose a nonland card from among them. That player discards that card.',
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.filter).toEqual({ excludeTypes: ['land'] });
    expect(eff.disposition).toBe('discard');
    expect(eff.optional).toBeUndefined();
  });

  it('accepts "from it" phrasing too', () => {
    const [eff] = spellEffects(
      'Target opponent reveals their hand and the top card of their library. You choose a nonland card from it. That player discards that card.',
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.disposition).toBe('discard');
  });
});

describe('Search Warrant: reveal hand + gain life equal to hand size', () => {
  it('parses to LookAtHand + GainLife (ForEach hand)', () => {
    const effects = spellEffects(
      "Target player reveals their hand. You gain life equal to the number of cards in that player's hand.",
    );
    expect(effects).toHaveLength(2);
    expect(effects[0].kind).toBe('LookAtHand');
    expect(effects[1].kind).toBe('GainLife');
    if (effects[1].kind !== 'GainLife') return;
    const gl = effects[1] as GainLifeEffect;
    expect(gl.player).toEqual({ kind: 'Controller' });
    const amt = gl.amount;
    expect(typeof amt).toBe('object');
    if (typeof amt !== 'object' || (amt as { kind: string }).kind !== 'ForEach') return;
    const fe = amt as { kind: string; zone: string; controller: string };
    expect(fe.zone).toBe('hand');
    expect(fe.controller).toBe('opponent');
  });

  it('generates one Player target spec', () => {
    const p = parseOracleText(
      "Target player reveals their hand. You gain life equal to the number of cards in that player's hand.",
    );
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
  });
});

// ── executor tests ────────────────────────────────────────────────────────────

describe('executor: optional form — no matching cards → else-effects fire', () => {
  it("if opponent has only lands, else-effects (put counters on ~) fire", () => {
    // Opponent p1 has only a land in hand → no nonland cards → else fires
    const state = makeState({
      p1HandCards: [{ id: 'p1land', defId: 'land' }],
    });
    // We'll use a creature as the source (p0 battlefield, but executor just applies counters).
    // Add a permanent for p0 to receive counters.
    const newCards = new Map(state.cards);
    newCards.set('p0cre', {
      instanceId: 'p0cre', definitionId: 'cre', ownerId: 'p0', zone: 'battlefield',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
    const stateWithCre = { ...state, cards: newCards };

    // Parse the "if you don't, put two +1/+1 counters on target creature you control" form.
    // We use a simplified else-branch that can target something we have.
    // Reckoner Shakedown actual text: "If you don't, put two +1/+1 counters on ~."
    // Since ~ references the source which we don't have as a target, use a simpler
    // testable form: "If you don't, you gain 3 life."
    const text = "Target opponent reveals their hand. You may choose a nonland card from it. If you do, that player discards that card. If you don't, you gain 3 life.";
    const p1Before = stateWithCre.players.find(pl => pl.id === 'p1')!;
    const p0Before = stateWithCre.players.find(pl => pl.id === 'p0')!;

    const after = runSpell(text, stateWithCre);

    // p1's land should still be in hand (no discard)
    const p1land = after.cards.get('p1land');
    expect(p1land?.zone).toBe('hand');

    // p0 should have gained 3 life (else-effects fired)
    const p0After = after.players.find(pl => pl.id === 'p0')!;
    expect(p0After.life).toBe(p0Before.life + 3);
  });
});

describe('executor: optional form — matching card exists → card is discarded', () => {
  it('when opponent has a nonland card, it is discarded (highest CMC chosen)', () => {
    const state = makeState({
      p1HandCards: [
        { id: 'p1card1', defId: 'nonland' },   // instant, cmc 1
        { id: 'p1land1', defId: 'land' },        // land
      ],
    });
    const text = 'Target opponent reveals their hand. You may choose a nonland card from it. If you do, that player discards that card.';
    const after = runSpell(text, state);

    // The nonland card should be discarded
    const p1card1 = after.cards.get('p1card1');
    expect(p1card1?.zone).toBe('graveyard');
    // The land stays in hand
    const p1land1 = after.cards.get('p1land1');
    expect(p1land1?.zone).toBe('hand');
  });
});

describe('executor: Search Warrant gain-life counts hand size', () => {
  it('controller gains life equal to target player hand size', () => {
    // p1 has 4 cards in hand
    const state = makeState({
      p1HandCards: [
        { id: 'c1', defId: 'nonland' },
        { id: 'c2', defId: 'nonland' },
        { id: 'c3', defId: 'land' },
        { id: 'c4', defId: 'cre' },
      ],
    });
    const text = "Target player reveals their hand. You gain life equal to the number of cards in that player's hand.";
    const p0Before = state.players.find(p => p.id === 'p0')!;
    const after = runSpell(text, state);
    const p0After = after.players.find(p => p.id === 'p0')!;
    // p0 gains 4 life (4 cards in p1's hand)
    expect(p0After.life).toBe(p0Before.life + 4);
    // p1's hand is untouched
    const p1HandAfter = [...after.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'hand');
    expect(p1HandAfter).toHaveLength(4);
  });

  it('controller gains 0 life when target player has empty hand', () => {
    const state = makeState({ p1HandCards: [] });
    const text = "Target player reveals their hand. You gain life equal to the number of cards in that player's hand.";
    const p0Before = state.players.find(p => p.id === 'p0')!;
    const after = runSpell(text, state);
    const p0After = after.players.find(p => p.id === 'p0')!;
    expect(p0After.life).toBe(p0Before.life);
  });
});
