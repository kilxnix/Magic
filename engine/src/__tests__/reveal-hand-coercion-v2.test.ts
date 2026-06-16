/**
 * Slice 3 — Reveal-hand coercion v2
 *
 * Tests cover:
 *  1. CMC bound lte: Inquisition of Kozilek ("mana value 3 or less")
 *  2. CMC bound gte: Appetite for Brains ("mana value 4 or greater")
 *  3. Multi-type filter: "creature, enchantment, or planeswalker card"
 *  4. Color + type filter: Talara's Bane ("a green or white creature card")
 *  5. Artifact-or-creature dual type: "an artifact or creature card"
 *  6. Run-on "and you choose" form (Tidehollow Sculler first line)
 *  7. DiscardAll: Amnesia ("reveals their hand and discards all nonland cards")
 *  8. DiscardAll "discards all cards" (no filter — whole hand)
 *  9. Executor: CMC-lte filter discards highest-matching card, leaves others
 * 10. Executor: CMC-gte filter discards highest-matching card
 * 11. Executor: DiscardAll discards every matching card, leaves non-matching
 * 12. Executor: DiscardAll with no-filter discards entire hand
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect } from '../effects/ast';

// ── helpers ───────────────────────────────────────────────────────────────────

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

const smallCreatureDef: CardDefinition = {
  id: 'smallcre', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid',
  oracle_text: '', mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 1, toughness: 1,
};

const bigCreatureDef: CardDefinition = {
  id: 'bigcre', name: 'Grave Titan', type_line: 'Creature — Zombie Giant',
  oracle_text: '', mana_cost: '{4}{B}{B}', cmc: 6, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['creature'], power: 6, toughness: 6,
};

const midCreatureDef: CardDefinition = {
  id: 'midcre', name: 'Baneslayer Angel', type_line: 'Creature — Angel',
  oracle_text: '', mana_cost: '{3}{W}{W}', cmc: 5, colors: ['W'], color_identity: ['W'],
  keywords: [], card_types: ['creature'], power: 5, toughness: 5,
};

const sorceryDef: CardDefinition = {
  id: 'sorcery', name: 'Divination', type_line: 'Sorcery',
  oracle_text: '', mana_cost: '{2}{U}', cmc: 3, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['sorcery'],
};

const enchantmentDef: CardDefinition = {
  id: 'ench', name: 'Kismet', type_line: 'Enchantment',
  oracle_text: '', mana_cost: '{3}{W}', cmc: 4, colors: ['W'], color_identity: ['W'],
  keywords: [], card_types: ['enchantment'],
};

const planeswalkerDef: CardDefinition = {
  id: 'pw', name: 'Jace, the Mind Sculptor', type_line: 'Legendary Planeswalker — Jace',
  oracle_text: '', mana_cost: '{2}{U}{U}', cmc: 4, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['planeswalker'],
};

const artifactDef: CardDefinition = {
  id: 'artifact', name: 'Sol Ring', type_line: 'Artifact',
  oracle_text: '', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact'],
};

const greenCreatureDef: CardDefinition = {
  id: 'greencre', name: 'Leatherback Baloth', type_line: 'Creature — Beast',
  oracle_text: '', mana_cost: '{G}{G}{G}', cmc: 3, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 4, toughness: 5,
};

const whiteCreatureDef: CardDefinition = {
  id: 'whitecre', name: 'Serra Angel', type_line: 'Creature — Angel',
  oracle_text: '', mana_cost: '{3}{W}{W}', cmc: 5, colors: ['W'], color_identity: ['W'],
  keywords: [], card_types: ['creature'], power: 4, toughness: 4,
};

const blueCreatureDef: CardDefinition = {
  id: 'bluecre', name: 'Snapcaster Mage', type_line: 'Creature — Human Wizard',
  oracle_text: '', mana_cost: '{1}{U}', cmc: 2, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 1,
};

function makeState(p1Hand: { id: string; defId: string }[] = []): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['instant', instantDef],
    ['land', landDef],
    ['smallcre', smallCreatureDef],
    ['bigcre', bigCreatureDef],
    ['midcre', midCreatureDef],
    ['sorcery', sorceryDef],
    ['ench', enchantmentDef],
    ['pw', planeswalkerDef],
    ['artifact', artifactDef],
    ['greencre', greenCreatureDef],
    ['whitecre', whiteCreatureDef],
    ['bluecre', blueCreatureDef],
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

// ── parse tests ───────────────────────────────────────────────────────────────

describe('Slice 3 — CMC lte: Inquisition of Kozilek style', () => {
  it('parses "mana value 3 or less" into cmc lte filter', () => {
    const [eff] = spellEffects(
      'Target player reveals their hand. You choose a nonland card from it with mana value 3 or less. That player discards that card.',
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.filter).toMatchObject({ excludeTypes: ['land'], cmc: { op: 'lte', value: 3 } });
    expect(eff.disposition).toBe('discard');
    expect(eff.discardAll).toBeUndefined();
  });

  it('Inquisition-exact wording parses as Spell with one Player target', () => {
    const p = parseOracleText(
      'Target player reveals their hand. You choose a nonland card from it with mana value 3 or less. That player discards that card.',
    );
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
  });
});

describe('Slice 3 — CMC gte: Appetite for Brains style', () => {
  it('parses "mana value 4 or greater and exile that card"', () => {
    const [eff] = spellEffects(
      'Target opponent reveals their hand. You choose a card from it with mana value 4 or greater and exile that card.',
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.filter).toMatchObject({ cmc: { op: 'gte', value: 4 } });
    expect(eff.disposition).toBe('exile');
    expect((eff as RevealHandChooseCardEffect).filter.excludeTypes).toBeUndefined();
  });

  it('target spec has opponentControls constraint', () => {
    const p = parseOracleText(
      'Target opponent reveals their hand. You choose a card from it with mana value 4 or greater and exile that card.',
    );
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });
});

describe('Slice 3 — multi-type filter', () => {
  it('parses "creature, enchantment, or planeswalker card" into types array', () => {
    const [eff] = spellEffects(
      'Target opponent reveals their hand. You choose a creature, enchantment, or planeswalker card from it. That player discards that card.',
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    const types = eff.filter.types ?? [];
    expect(types).toContain('creature');
    expect(types).toContain('enchantment');
    expect(types).toContain('planeswalker');
    expect(eff.disposition).toBe('discard');
  });

  it('parses "artifact or creature card" into two-type filter', () => {
    const [eff] = spellEffects(
      'Target opponent reveals their hand. You choose an artifact or creature card from it and exile that card.',
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    const types = eff.filter.types ?? [];
    expect(types).toContain('artifact');
    expect(types).toContain('creature');
    expect(eff.disposition).toBe('exile');
  });
});

describe('Slice 3 — color+type filter (Talara\'s Bane)', () => {
  it('parses "a green or white creature card" into colors+types filter', () => {
    const [eff] = spellEffects(
      "Target opponent reveals their hand. You choose a green or white creature card from it. That player discards that card.",
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    const colors = eff.filter.colors ?? [];
    expect(colors).toContain('G');
    expect(colors).toContain('W');
    expect(eff.filter.types).toContain('creature');
    expect(eff.disposition).toBe('discard');
  });
});

describe('Slice 3 — run-on "and you choose" form (Tidehollow Sculler first line)', () => {
  it('parses "reveals their hand and you choose a nonland card from it. Exile that card."', () => {
    const [eff] = spellEffects(
      'Target opponent reveals their hand and you choose a nonland card from it. Exile that card.',
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.filter).toEqual({ excludeTypes: ['land'] });
    expect(eff.disposition).toBe('exile');
  });
});

describe('Slice 3 — discardAll: Amnesia ("reveals their hand and discards all nonland cards")', () => {
  it('parses Amnesia-style into RevealHandChooseCard with discardAll:true', () => {
    const [eff] = spellEffects(
      'Target player reveals their hand and discards all nonland cards.',
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.discardAll).toBe(true);
    expect(eff.disposition).toBe('discard');
    expect(eff.filter).toEqual({ excludeTypes: ['land'] });
  });

  it('"discards all cards" (no filter) produces empty filter with discardAll', () => {
    const [eff] = spellEffects(
      'Target player reveals their hand and discards all cards.',
    );
    expect(eff.kind).toBe('RevealHandChooseCard');
    if (eff.kind !== 'RevealHandChooseCard') return;
    expect(eff.discardAll).toBe(true);
    expect(eff.filter).toEqual({});
  });

  it('"target opponent" version sets opponentControls constraint', () => {
    const p = parseOracleText(
      'Target opponent reveals their hand and discards all nonland cards.',
    );
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });
});

// ── executor tests ────────────────────────────────────────────────────────────

describe('Executor: CMC-lte filter — Inquisition of Kozilek', () => {
  it('discards the highest-CMC card that is ≤3, ignores land and cards >3', () => {
    // p1 has: instant (cmc1), sorcery (cmc3), bigcre (cmc6), land (cmc0)
    const state = makeState([
      { id: 'p1inst', defId: 'instant' },
      { id: 'p1sorc', defId: 'sorcery' },  // cmc 3, nonland
      { id: 'p1big', defId: 'bigcre' },    // cmc 6, would be excluded
      { id: 'p1land', defId: 'land' },
    ]);
    const text = 'Target player reveals their hand. You choose a nonland card from it with mana value 3 or less. That player discards that card.';
    const after = runSpell(text, state);

    // sorcery (cmc 3) should be discarded (highest cmc that is ≤3 among nonlands)
    expect(after.cards.get('p1sorc')?.zone).toBe('graveyard');
    // big creature (cmc 6) stays in hand (excluded by cmc filter)
    expect(after.cards.get('p1big')?.zone).toBe('hand');
    // land stays in hand (excluded by nonland filter)
    expect(after.cards.get('p1land')?.zone).toBe('hand');
  });

  it('when no cards match the cmc-lte filter, hand is unchanged', () => {
    // p1 only has cards with cmc >= 4
    const state = makeState([
      { id: 'p1big', defId: 'bigcre' },   // cmc 6
    ]);
    const text = 'Target player reveals their hand. You choose a nonland card from it with mana value 3 or less. That player discards that card.';
    const after = runSpell(text, state);
    expect(after.cards.get('p1big')?.zone).toBe('hand');
  });
});

describe('Executor: CMC-gte filter — Appetite for Brains', () => {
  it('exiles the highest-cmc card that is ≥4, ignores small cards', () => {
    // p1 has: instant (cmc1), midcre (cmc5), bigcre (cmc6)
    const state = makeState([
      { id: 'p1inst', defId: 'instant' },  // cmc 1, excluded
      { id: 'p1mid', defId: 'midcre' },    // cmc 5
      { id: 'p1big', defId: 'bigcre' },    // cmc 6 — highest among ≥4
    ]);
    const text = 'Target opponent reveals their hand. You choose a card from it with mana value 4 or greater and exile that card.';
    const after = runSpell(text, state);

    // big creature (cmc 6) should be exiled (highest CMC ≥4)
    expect(after.cards.get('p1big')?.zone).toBe('exile');
    // mid creature stays (executor picks highest first, bigcre was picked)
    expect(after.cards.get('p1mid')?.zone).toBe('hand');
    // instant (cmc 1) stays — below gte threshold
    expect(after.cards.get('p1inst')?.zone).toBe('hand');
  });
});

describe('Executor: discardAll — Amnesia', () => {
  it('discards every nonland card, leaves lands in hand', () => {
    const state = makeState([
      { id: 'p1inst', defId: 'instant' },
      { id: 'p1sorc', defId: 'sorcery' },
      { id: 'p1cre', defId: 'smallcre' },
      { id: 'p1land1', defId: 'land' },
      { id: 'p1land2', defId: 'land' },
    ]);
    const text = 'Target player reveals their hand and discards all nonland cards.';
    const after = runSpell(text, state);

    // All nonland cards should be in graveyard
    expect(after.cards.get('p1inst')?.zone).toBe('graveyard');
    expect(after.cards.get('p1sorc')?.zone).toBe('graveyard');
    expect(after.cards.get('p1cre')?.zone).toBe('graveyard');
    // Lands stay in hand
    expect(after.cards.get('p1land1')?.zone).toBe('hand');
    expect(after.cards.get('p1land2')?.zone).toBe('hand');
  });

  it('discardAll with empty filter discards the entire hand', () => {
    const state = makeState([
      { id: 'p1a', defId: 'instant' },
      { id: 'p1b', defId: 'land' },
      { id: 'p1c', defId: 'smallcre' },
    ]);
    const text = 'Target player reveals their hand and discards all cards.';
    const after = runSpell(text, state);

    expect(after.cards.get('p1a')?.zone).toBe('graveyard');
    expect(after.cards.get('p1b')?.zone).toBe('graveyard');
    expect(after.cards.get('p1c')?.zone).toBe('graveyard');
  });

  it('discardAll with no matching cards leaves hand unchanged', () => {
    // p1 only has lands — discardAll nonlands does nothing
    const state = makeState([
      { id: 'p1l1', defId: 'land' },
      { id: 'p1l2', defId: 'land' },
    ]);
    const text = 'Target player reveals their hand and discards all nonland cards.';
    const after = runSpell(text, state);
    expect(after.cards.get('p1l1')?.zone).toBe('hand');
    expect(after.cards.get('p1l2')?.zone).toBe('hand');
  });
});

describe('Executor: color+type filter (Talara\'s Bane)', () => {
  it('discards the highest-cmc green-or-white creature, leaves blue creature', () => {
    // p1 has: green creature (cmc 3), white creature (cmc 5), blue creature (cmc 2)
    const state = makeState([
      { id: 'p1green', defId: 'greencre' },  // green, cmc 3
      { id: 'p1white', defId: 'whitecre' },  // white, cmc 5 — highest
      { id: 'p1blue', defId: 'bluecre' },    // blue, not green or white
    ]);
    const text = "Target opponent reveals their hand. You choose a green or white creature card from it. That player discards that card.";
    const after = runSpell(text, state);

    // white creature (cmc 5, white) should be discarded as highest matching
    expect(after.cards.get('p1white')?.zone).toBe('graveyard');
    // blue creature is not green or white — stays in hand
    expect(after.cards.get('p1blue')?.zone).toBe('hand');
    // green creature stays (white was higher cmc)
    expect(after.cards.get('p1green')?.zone).toBe('hand');
  });
});
