/**
 * Slice 11 — Reveal-hand coercion completions
 *
 * Tests cover:
 *  1. Lay Bare the Heart — compound "nonlegendary, nonland" filter (excludeSupertypes + excludeTypes)
 *  2. Perish the Thought — shuffle disposition ("That player shuffles that card into their library")
 *  3. Rag Man — activated ability body "reveals their hand and discards a creature card at random"
 *  4. Thought Distortion — "Exile all noncreature, nonland cards from target opponent's hand"
 *  5. Executor: Lay Bare the Heart discards highest-cmc nonlegendary nonland card, leaves legendary
 *  6. Executor: Perish the Thought shuffles chosen card to library (zone = 'library')
 *  7. Executor: Rag Man body discards 1 card randomly
 *  8. Executor: Thought Distortion exiles all noncreature+nonland cards from hand
 *  9. "that player's hand" form (trigger body) uses EventPlayer ref, no target spec
 * 10. Lay Bare the Heart exact wording produces Spell with one Player target
 * 11. Perish the Thought exact wording produces Spell with one Player target
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect } from '../effects/ast';

// ── card definitions ───────────────────────────────────────────────────────────

const instantDef: CardDefinition = {
  id: 'instant', name: 'Lightning Bolt', type_line: 'Instant',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'],
  color_identity: ['R'], keywords: [], card_types: ['instant'],
};

const landDef: CardDefinition = {
  id: 'land', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};

const legendaryCreatureDef: CardDefinition = {
  id: 'legcre', name: 'Emrakul, the Promised End', type_line: 'Legendary Creature — Eldrazi',
  oracle_text: '', mana_cost: '{13}', cmc: 13, colors: [], color_identity: [],
  keywords: [], card_types: ['creature'], power: 13, toughness: 13,
};

const nonlegendaryCreatureDef: CardDefinition = {
  id: 'nlcre', name: 'Grave Titan', type_line: 'Creature — Zombie Giant',
  oracle_text: '', mana_cost: '{4}{B}{B}', cmc: 6, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['creature'], power: 6, toughness: 6,
};

const sorceryDef: CardDefinition = {
  id: 'sorcery', name: 'Divination', type_line: 'Sorcery',
  oracle_text: '', mana_cost: '{2}{U}', cmc: 3, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['sorcery'],
};

const creatureDef: CardDefinition = {
  id: 'creature', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid',
  oracle_text: '', mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 1, toughness: 1,
};

const artifactDef: CardDefinition = {
  id: 'artifact', name: 'Sol Ring', type_line: 'Artifact',
  oracle_text: '', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact'],
};

const legendarySorceryDef: CardDefinition = {
  id: 'legsorcery', name: 'Urza\'s Ruinous Blast', type_line: 'Legendary Sorcery',
  oracle_text: '', mana_cost: '{4}{W}', cmc: 5, colors: ['W'], color_identity: ['W'],
  keywords: [], card_types: ['sorcery'],
};

// ── helpers ────────────────────────────────────────────────────────────────────

function makeState(p1Hand: { id: string; defId: string }[] = []): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['instant', instantDef],
    ['land', landDef],
    ['legcre', legendaryCreatureDef],
    ['nlcre', nonlegendaryCreatureDef],
    ['sorcery', sorceryDef],
    ['creature', creatureDef],
    ['artifact', artifactDef],
    ['legsorcery', legendarySorceryDef],
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

function runSpell(text: string, state: GameState): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}`);
  const playerSpec = p.targets.find(t => t.type === 'Player');
  if (playerSpec) {
    return executeEffects(state, p.effects, 'p0', ['p1'], [{ id: playerSpec.id }], 0, {});
  }
  return executeEffects(state, p.effects, 'p0', [], [], 0, {});
}

// ── parse tests ────────────────────────────────────────────────────────────────

describe('Slice 11 — Lay Bare the Heart: nonlegendary, nonland filter', () => {
  const ORACLE = 'Target opponent reveals their hand. You choose a nonlegendary, nonland card from it. That player discards that card.';

  it('parses as RevealHandChooseCard with excludeSupertypes + excludeTypes', () => {
    const [eff] = spellEffects(ORACLE);
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.filter.excludeSupertypes).toContain('legendary');
    expect(eff.filter.excludeTypes).toContain('land');
    expect(eff.disposition).toBe('discard');
    expect(eff.discardAll).toBeUndefined();
  });

  it('produces Spell with one opponent-constrained Player target', () => {
    const p = parseOracleText(ORACLE);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });
});

describe('Slice 11 — Perish the Thought: shuffle disposition', () => {
  const ORACLE = 'Target player reveals their hand. You choose a card from it. That player shuffles that card into their library.';

  it('parses as RevealHandChooseCard with disposition:shuffle', () => {
    const [eff] = spellEffects(ORACLE);
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.filter).toEqual({});
    expect(eff.disposition).toBe('shuffle');
  });

  it('produces Spell with one Player target', () => {
    const p = parseOracleText(ORACLE);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
  });
});

describe('Slice 11 — Rag Man: reveal-hand + discard-at-random with type filter', () => {
  const ORACLE_BODY = 'Target opponent reveals their hand and discards a creature card at random.';

  it('parses as LookAtHand + Discard(random:true)', () => {
    const effs = spellEffects(ORACLE_BODY);
    expect(effs).toHaveLength(2);
    expect(effs[0].kind).toBe('LookAtHand');
    expect(effs[1].kind).toBe('Discard');
    if (effs[1].kind !== 'Discard') return;
    expect(effs[1].random).toBe(true);
    expect(effs[1].count).toBe(1);
  });

  it('shares a single Player target between both effects', () => {
    const p = parseOracleText(ORACLE_BODY);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('also parses filterless "reveals their hand and discards a card at random"', () => {
    const effs = spellEffects('Target player reveals their hand and discards a card at random.');
    expect(effs).toHaveLength(2);
    expect(effs[1].kind).toBe('Discard');
    if (effs[1].kind !== 'Discard') return;
    expect(effs[1].random).toBe(true);
  });
});

describe('Slice 11 — Thought Distortion: exile all from target hand', () => {
  const ORACLE = 'Exile all noncreature, nonland cards from target opponent\'s hand.';
  const ORACLE_THAT_PLAYER = "Exile all noncreature, nonland cards from that player's hand.";

  it('parses as RevealHandChooseCard(discardAll:true, exile)', () => {
    const [eff] = spellEffects(ORACLE);
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.discardAll).toBe(true);
    expect(eff.disposition).toBe('exile');
    expect(eff.filter.excludeTypes).toContain('creature');
    expect(eff.filter.excludeTypes).toContain('land');
  });

  it('produces Spell with one opponent-constrained Player target', () => {
    const p = parseOracleText(ORACLE);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('"that player\'s hand" form uses EventPlayer ref, no target spec', () => {
    const p = parseOracleText(ORACLE_THAT_PLAYER);
    // "that player" has no explicit target so parsed as Spell with 0 targets
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets).toHaveLength(0);
    const [eff] = p.effects;
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.player.kind).toBe('EventPlayer');
    expect(eff.discardAll).toBe(true);
    expect(eff.disposition).toBe('exile');
  });
});

// ── executor tests ─────────────────────────────────────────────────────────────

describe('Executor: Lay Bare the Heart — discards highest nonlegendary nonland', () => {
  it('discards highest-cmc nonlegendary nonland, leaves legendary and land', () => {
    // p1 has: legendary creature (cmc13), nonlegendary creature (cmc6), sorcery (cmc3), land (cmc0)
    const state = makeState([
      { id: 'p1leg', defId: 'legcre' },     // legendary — stays
      { id: 'p1nlcre', defId: 'nlcre' },    // nonlegendary cmc6 — highest matching, discarded
      { id: 'p1sorc', defId: 'sorcery' },   // nonlegendary sorcery cmc3 — stays (not highest)
      { id: 'p1land', defId: 'land' },      // land — stays
    ]);
    const text = 'Target opponent reveals their hand. You choose a nonlegendary, nonland card from it. That player discards that card.';
    const after = runSpell(text, state);

    // nonlegendary creature (cmc6) should be discarded
    expect(after.cards.get('p1nlcre')?.zone).toBe('graveyard');
    // legendary creature stays (excluded by nonlegendary filter)
    expect(after.cards.get('p1leg')?.zone).toBe('hand');
    // land stays (excluded by nonland filter)
    expect(after.cards.get('p1land')?.zone).toBe('hand');
    // sorcery stays (cmc3 < cmc6 so not chosen)
    expect(after.cards.get('p1sorc')?.zone).toBe('hand');
  });

  it('does not discard legendary sorcery (excluded by nonlegendary)', () => {
    const state = makeState([
      { id: 'p1legsrc', defId: 'legsorcery' }, // legendary sorcery — stays
      { id: 'p1land', defId: 'land' },          // land — stays
    ]);
    const text = 'Target opponent reveals their hand. You choose a nonlegendary, nonland card from it. That player discards that card.';
    const after = runSpell(text, state);
    // Nothing to discard — legendary sorcery and land both excluded
    expect(after.cards.get('p1legsrc')?.zone).toBe('hand');
    expect(after.cards.get('p1land')?.zone).toBe('hand');
  });
});

describe('Executor: Perish the Thought — shuffles chosen card to library', () => {
  it('chosen card ends in library zone', () => {
    const state = makeState([
      { id: 'p1sorc', defId: 'sorcery' },
      { id: 'p1cre', defId: 'creature' },
    ]);
    const text = 'Target player reveals their hand. You choose a card from it. That player shuffles that card into their library.';
    const after = runSpell(text, state);

    // The highest-cmc card (sorcery cmc3 > creature cmc1) is chosen and shuffled to library
    const sorc = after.cards.get('p1sorc');
    const cre = after.cards.get('p1cre');
    // One card should be in library
    expect(sorc?.zone === 'library' || cre?.zone === 'library').toBe(true);
    // The other stays in hand
    expect(sorc?.zone === 'hand' || cre?.zone === 'hand').toBe(true);
  });

  it('deterministic: highest cmc card is shuffled (sorcery > creature)', () => {
    const state = makeState([
      { id: 'p1sorc', defId: 'sorcery' },    // cmc3 — higher
      { id: 'p1cre', defId: 'creature' },    // cmc1 — lower
    ]);
    const text = 'Target player reveals their hand. You choose a card from it. That player shuffles that card into their library.';
    const after = runSpell(text, state);
    // sorcery (cmc3) should be chosen (highest mana value)
    expect(after.cards.get('p1sorc')?.zone).toBe('library');
    expect(after.cards.get('p1cre')?.zone).toBe('hand');
  });
});

describe('Executor: Rag Man — random discard from revealed hand', () => {
  it('discards exactly one card from the target hand', () => {
    const state = makeState([
      { id: 'p1a', defId: 'creature' },
      { id: 'p1b', defId: 'instant' },
      { id: 'p1c', defId: 'sorcery' },
    ]);
    const text = 'Target opponent reveals their hand and discards a creature card at random.';
    const after = runSpell(text, state);

    const zones = ['p1a', 'p1b', 'p1c'].map(id => after.cards.get(id)?.zone);
    const graveyard = zones.filter(z => z === 'graveyard');
    const hand = zones.filter(z => z === 'hand');
    expect(graveyard).toHaveLength(1);
    expect(hand).toHaveLength(2);
  });
});

describe('Executor: Thought Distortion — exile all noncreature nonland', () => {
  it('exiles all noncreature+nonland, leaves creature and land', () => {
    const state = makeState([
      { id: 'p1sorc', defId: 'sorcery' },    // noncreature nonland — exiled
      { id: 'p1art', defId: 'artifact' },    // noncreature nonland — exiled
      { id: 'p1cre', defId: 'creature' },    // creature — stays
      { id: 'p1land', defId: 'land' },       // land — stays
    ]);
    const text = "Exile all noncreature, nonland cards from target opponent's hand.";
    const after = runSpell(text, state);

    expect(after.cards.get('p1sorc')?.zone).toBe('exile');
    expect(after.cards.get('p1art')?.zone).toBe('exile');
    expect(after.cards.get('p1cre')?.zone).toBe('hand');
    expect(after.cards.get('p1land')?.zone).toBe('hand');
  });

  it('with empty hand, does nothing', () => {
    const state = makeState([]);
    const text = "Exile all noncreature, nonland cards from target opponent's hand.";
    // Should not throw
    const after = runSpell(text, state);
    expect(after.cards.size).toBe(0);
  });
});
