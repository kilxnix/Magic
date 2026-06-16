/**
 * Slice 5/12 — Additional self cost-reduction forms (new countable predicates)
 *
 * Tests for Forms 8-17 added to getIntrinsicCostReduction and
 * isSelfCostReductionSentence:
 *   8.  Greatest power among creatures you control
 *   9.  Party count (Cleric/Rogue/Warrior/Wizard)
 *  10.  Domain (basic land types among lands you control)
 *  11.  Multi-type graveyard (instant and sorcery)
 *  12.  Card types among graveyard
 *  13.  Colors among permanents you control
 *  14.  Creature types among creatures you control
 *  15.  Counter-gated (+1/+1 counter on creature you control)
 *  16.  Evaluable conditional — CMC threshold
 *  17.  Evaluable conditional — graveyard count threshold
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getIntrinsicCostReduction } from '../effects/continuous';
import { castSpell } from '../stack';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

// ============================================================================
// Test helpers
// ============================================================================

function makePlayer(id: string, life = 40): Player {
  return {
    id, name: id, life,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false, hasPriority: false, hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'] = 'battlefield',
  counters: Record<string, number> = {},
): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters, damage: 0, isCommander: false,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name || id,
    type_line: opts.type_line || 'Creature',
    oracle_text: opts.oracle_text || '',
    mana_cost: opts.mana_cost || '',
    cmc: opts.cmc ?? 0,
    colors: opts.colors || [],
    color_identity: opts.color_identity || [],
    keywords: opts.keywords || [],
    card_types: opts.card_types || ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: overrides.players || [makePlayer('p1'), makePlayer('p2')],
    cards: overrides.cards || new Map(),
    cardDefinitions: overrides.cardDefinitions || new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as any,
    step: 'main' as any,
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: overrides.continuousEffects || [],
  };
}

function totalMana(p: Player): number {
  const m = p.manaPool;
  return m.W + m.U + m.B + m.R + m.G + m.C;
}

// ============================================================================
// Form 8: greatest power among creatures you control
// ============================================================================

describe('Form 8 — greatest power', () => {
  it('recognizes "where X is the greatest power among creatures you control"', () => {
    const r = parseOracleText(
      'This spell costs {X} less to cast, where X is the greatest power among creatures you control.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
    expect(r.ability.selfOnly).toBe(true);
  });

  it('computes greatest power correctly (Shatterskull Minotaur-style)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // 3/3, 5/3, 1/1 creatures
    defs.set('c3', makeDef('c3', { type_line: 'Creature', card_types: ['creature'], power: 3, toughness: 3 }));
    defs.set('c5', makeDef('c5', { type_line: 'Creature', card_types: ['creature'], power: 5, toughness: 3 }));
    defs.set('c1', makeDef('c1', { type_line: 'Creature', card_types: ['creature'], power: 1, toughness: 1 }));
    // Opponent's 7/7 — should NOT count
    defs.set('opp7', makeDef('opp7', { type_line: 'Creature', card_types: ['creature'], power: 7, toughness: 7 }));

    cards.set('a', makeCard('a', 'c3', 'p1'));
    cards.set('b', makeCard('b', 'c5', 'p1'));
    cards.set('c', makeCard('c', 'c1', 'p1'));
    cards.set('opp', makeCard('opp', 'opp7', 'p2'));

    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {X} less to cast, where X is the greatest power among creatures you control.',
      card_types: ['sorcery'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // Greatest power among p1's creatures is 5
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(5);
  });

  it('returns 0 when no creatures controlled', () => {
    const state = makeState({ cards: new Map(), cardDefinitions: new Map() });
    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {X} less to cast, where X is the greatest power among creatures you control.',
      card_types: ['sorcery'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });
});

// ============================================================================
// Form 9: party count
// ============================================================================

describe('Form 9 — party count', () => {
  it('recognizes "for each creature in your party" (Shatterskull Minotaur)', () => {
    // Real card example: "This spell costs {1} less to cast for each creature in your party.\nHaste"
    const r = parseOracleText(
      'This spell costs {1} less to cast for each creature in your party.\nHaste',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('counts distinct party classes (Cleric, Rogue, Warrior, Wizard)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // One of each party class
    defs.set('cleric', makeDef('cleric', { type_line: 'Creature — Cleric', card_types: ['creature'] }));
    defs.set('rogue', makeDef('rogue', { type_line: 'Creature — Rogue', card_types: ['creature'] }));
    defs.set('warrior', makeDef('warrior', { type_line: 'Creature — Warrior', card_types: ['creature'] }));
    defs.set('wizard', makeDef('wizard', { type_line: 'Creature — Wizard', card_types: ['creature'] }));
    // Opponent's Cleric — should NOT count
    defs.set('opp_cleric', makeDef('opp_cleric', { type_line: 'Creature — Cleric', card_types: ['creature'] }));

    cards.set('c1', makeCard('c1', 'cleric', 'p1'));
    cards.set('c2', makeCard('c2', 'rogue', 'p1'));
    cards.set('c3', makeCard('c3', 'warrior', 'p1'));
    cards.set('c4', makeCard('c4', 'wizard', 'p1'));
    cards.set('opp_c', makeCard('opp_c', 'opp_cleric', 'p2'));

    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {1} less to cast for each creature in your party.',
      card_types: ['sorcery'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 4 party members = 4 reduction
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(4);
  });

  it('counts at most one of each party class (two Clerics = 1 party slot)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('cleric', makeDef('cleric', { type_line: 'Creature — Cleric', card_types: ['creature'] }));
    // Two clerics — only 1 counts for party
    cards.set('c1', makeCard('c1', 'cleric', 'p1'));
    cards.set('c2', makeCard('c2', 'cleric', 'p1'));

    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {1} less to cast for each creature in your party.',
      card_types: ['sorcery'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // Only 1 distinct party class filled
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(1);
  });
});

// ============================================================================
// Form 10: domain (basic land types)
// ============================================================================

describe('Form 10 — domain', () => {
  it('recognizes "for each basic land type among lands you control" (Stratadon)', () => {
    // "Domain — This spell costs {1} less to cast for each basic land type among lands you control. Trample"
    // The "Domain —" keyword indicator is stripped by tokenization
    const r = parseOracleText(
      'This spell costs {1} less to cast for each basic land type among lands you control.\nTrample',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('counts distinct basic land types (max 5)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // 5 basic land types
    const lands = [
      ['plains', 'Land — Plains'],
      ['island', 'Land — Island'],
      ['swamp', 'Land — Swamp'],
      ['mountain', 'Land — Mountain'],
      ['forest', 'Land — Forest'],
    ] as const;

    for (const [id, typeLine] of lands) {
      defs.set(id, makeDef(id, { type_line: typeLine, card_types: ['land'] }));
      cards.set(`bf_${id}`, makeCard(`bf_${id}`, id, 'p1'));
    }

    // Opponent's Forest — should NOT count
    defs.set('opp_forest', makeDef('opp_forest', { type_line: 'Land — Forest', card_types: ['land'] }));
    cards.set('opp_bf', makeCard('opp_bf', 'opp_forest', 'p2'));

    const spellDef = makeDef('stratadon', {
      oracle_text: 'This spell costs {1} less to cast for each basic land type among lands you control.',
      card_types: ['creature'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // All 5 basic land types represented
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(5);
  });

  it('counts only distinct land types (two Forests = 1)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('forest', makeDef('forest', { type_line: 'Land — Forest', card_types: ['land'] }));
    defs.set('mountain', makeDef('mountain', { type_line: 'Land — Mountain', card_types: ['land'] }));
    // Two Forests
    cards.set('f1', makeCard('f1', 'forest', 'p1'));
    cards.set('f2', makeCard('f2', 'forest', 'p1'));
    cards.set('m', makeCard('m', 'mountain', 'p1'));

    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {1} less to cast for each basic land type among lands you control.',
      card_types: ['sorcery'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 2 distinct types: Forest, Mountain
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(2);
  });
});

// ============================================================================
// Form 11: multi-type graveyard (instant and sorcery)
// ============================================================================

describe('Form 11 — multi-type graveyard (instant and sorcery)', () => {
  it('recognizes "for each instant and sorcery card in your graveyard" (Cryptic Serpent)', () => {
    // Real card: "This spell costs {1} less to cast for each instant and sorcery card in your graveyard."
    const r = parseOracleText(
      'This spell costs {1} less to cast for each instant and sorcery card in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
    expect(r.ability.selfOnly).toBe(true);
  });

  it('counts both instants and sorceries in graveyard', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('bolt', makeDef('bolt', { type_line: 'Instant', card_types: ['instant'] }));
    defs.set('recall', makeDef('recall', { type_line: 'Sorcery', card_types: ['sorcery'] }));
    defs.set('bear', makeDef('bear', { type_line: 'Creature', card_types: ['creature'] }));

    // 2 instants + 3 sorceries in p1's graveyard
    cards.set('bolt_gy1', makeCard('bolt_gy1', 'bolt', 'p1', 'graveyard'));
    cards.set('bolt_gy2', makeCard('bolt_gy2', 'bolt', 'p1', 'graveyard'));
    cards.set('recall_gy1', makeCard('recall_gy1', 'recall', 'p1', 'graveyard'));
    cards.set('recall_gy2', makeCard('recall_gy2', 'recall', 'p1', 'graveyard'));
    cards.set('recall_gy3', makeCard('recall_gy3', 'recall', 'p1', 'graveyard'));
    // Creature in graveyard — should NOT count
    cards.set('bear_gy', makeCard('bear_gy', 'bear', 'p1', 'graveyard'));
    // Opponent's instant — should NOT count
    cards.set('opp_bolt', makeCard('opp_bolt', 'bolt', 'p2', 'graveyard'));

    const spellDef = makeDef('serpent', {
      oracle_text: 'This spell costs {1} less to cast for each instant and sorcery card in your graveyard.',
      card_types: ['creature'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 2 instants + 3 sorceries = 5
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(5);
  });
});

// ============================================================================
// Form 12: card types among graveyard (delirium-like)
// ============================================================================

describe('Form 12 — distinct card types among graveyard', () => {
  it('recognizes "for each card type among cards in your graveyard"', () => {
    const r = parseOracleText(
      'This spell costs {1} less to cast for each card type among cards in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('counts distinct card types in graveyard', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('creature_def', makeDef('creature_def', { type_line: 'Creature', card_types: ['creature'] }));
    defs.set('instant_def', makeDef('instant_def', { type_line: 'Instant', card_types: ['instant'] }));
    defs.set('artifact_def', makeDef('artifact_def', { type_line: 'Artifact', card_types: ['artifact'] }));
    defs.set('enchant_def', makeDef('enchant_def', { type_line: 'Enchantment', card_types: ['enchantment'] }));

    cards.set('cr', makeCard('cr', 'creature_def', 'p1', 'graveyard'));
    cards.set('in', makeCard('in', 'instant_def', 'p1', 'graveyard'));
    cards.set('ar', makeCard('ar', 'artifact_def', 'p1', 'graveyard'));
    cards.set('en', makeCard('en', 'enchant_def', 'p1', 'graveyard'));
    // Duplicate creature — still only 1 type
    cards.set('cr2', makeCard('cr2', 'creature_def', 'p1', 'graveyard'));

    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {1} less to cast for each card type among cards in your graveyard.',
      card_types: ['sorcery'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 4 distinct card types: creature, instant, artifact, enchantment
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(4);
  });
});

// ============================================================================
// Form 13: colors among permanents you control
// ============================================================================

describe('Form 13 — colors among permanents', () => {
  it('recognizes "for each color among permanents you control"', () => {
    const r = parseOracleText(
      'This spell costs {1} less to cast for each color among permanents you control.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('counts distinct colors among your permanents', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // Red, green, blue permanents
    defs.set('red', makeDef('red', { type_line: 'Creature', card_types: ['creature'], colors: ['R'] }));
    defs.set('green', makeDef('green', { type_line: 'Creature', card_types: ['creature'], colors: ['G'] }));
    defs.set('blue', makeDef('blue', { type_line: 'Creature', card_types: ['creature'], colors: ['U'] }));
    // Multicolored (R+G) — contributes R and G
    defs.set('rg', makeDef('rg', { type_line: 'Creature', card_types: ['creature'], colors: ['R', 'G'] }));
    // Colorless artifact — contributes nothing
    defs.set('colorless', makeDef('colorless', { type_line: 'Artifact', card_types: ['artifact'], colors: [] }));
    // Opponent's white creature — should NOT count
    defs.set('opp_white', makeDef('opp_white', { type_line: 'Creature', card_types: ['creature'], colors: ['W'] }));

    cards.set('r_card', makeCard('r_card', 'red', 'p1'));
    cards.set('g_card', makeCard('g_card', 'green', 'p1'));
    cards.set('u_card', makeCard('u_card', 'blue', 'p1'));
    cards.set('rg_card', makeCard('rg_card', 'rg', 'p1'));
    cards.set('cl_card', makeCard('cl_card', 'colorless', 'p1'));
    cards.set('opp_card', makeCard('opp_card', 'opp_white', 'p2'));

    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {1} less to cast for each color among permanents you control.',
      card_types: ['sorcery'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // R, G, U — 3 distinct colors (W excluded, opponent)
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(3);
  });
});

// ============================================================================
// Form 14: creature types among creatures you control
// ============================================================================

describe('Form 14 — creature types among creatures you control', () => {
  it('recognizes "for each creature type among creatures you control"', () => {
    const r = parseOracleText(
      'This spell costs {1} less to cast for each creature type among creatures you control.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('counts distinct creature subtypes', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('elf_warrior', makeDef('elf_warrior', { type_line: 'Creature — Elf Warrior', card_types: ['creature'] }));
    defs.set('elf_druid', makeDef('elf_druid', { type_line: 'Creature — Elf Druid', card_types: ['creature'] }));
    defs.set('dragon', makeDef('dragon', { type_line: 'Creature — Dragon', card_types: ['creature'] }));
    // Opponent's Goblin — should NOT count
    defs.set('opp_goblin', makeDef('opp_goblin', { type_line: 'Creature — Goblin', card_types: ['creature'] }));

    cards.set('ew', makeCard('ew', 'elf_warrior', 'p1'));
    cards.set('ed', makeCard('ed', 'elf_druid', 'p1'));
    cards.set('dr', makeCard('dr', 'dragon', 'p1'));
    cards.set('opp', makeCard('opp', 'opp_goblin', 'p2'));

    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {1} less to cast for each creature type among creatures you control.',
      card_types: ['sorcery'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 3 types: elf, warrior, druid (Elf Warrior contributes both), + Dragon = 4
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(4);
  });
});

// ============================================================================
// Form 15: +1/+1 counter-gated
// ============================================================================

describe('Form 15 — counter-gated +1/+1', () => {
  it('recognizes "for each creature you control with a +1/+1 counter on it"', () => {
    const r = parseOracleText(
      'This spell costs {1} less to cast for each creature you control with a +1/+1 counter on it.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
    expect(r.ability.selfOnly).toBe(true);
  });

  it('counts only creatures with +1/+1 counters (Hamza-style)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('bear', makeDef('bear', { type_line: 'Creature — Bear', card_types: ['creature'] }));

    // 3 creatures with +1/+1 counters
    cards.set('c1', { ...makeCard('c1', 'bear', 'p1'), counters: { '+1/+1': 2 } });
    cards.set('c2', { ...makeCard('c2', 'bear', 'p1'), counters: { '+1/+1': 1 } });
    cards.set('c3', { ...makeCard('c3', 'bear', 'p1'), counters: { '+1/+1': 3 } });
    // 1 creature WITHOUT counters — should NOT count
    cards.set('c4', makeCard('c4', 'bear', 'p1'));
    // Opponent's creature WITH counters — should NOT count
    cards.set('opp', { ...makeCard('opp', 'bear', 'p2'), counters: { '+1/+1': 5 } });

    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {1} less to cast for each creature you control with a +1/+1 counter on it.',
      card_types: ['sorcery'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 3 creatures with +1/+1 counters
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(3);
  });

  it('does NOT count creatures with 0 +1/+1 counters', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('bear', makeDef('bear', { type_line: 'Creature — Bear', card_types: ['creature'] }));
    // Creature with 0 counters explicitly set
    cards.set('c1', { ...makeCard('c1', 'bear', 'p1'), counters: { '+1/+1': 0 } });

    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {1} less to cast for each creature you control with a +1/+1 counter on it.',
      card_types: ['sorcery'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });

  it('still declines non-+1/+1 counter forms (e.g. charge counters) as unsupported', () => {
    // "with a charge counter on it" — engine cannot determine charge counters in the
    // same tracked way for arbitrary counter types at spell cast
    const r = parseOracleText(
      'This spell costs {1} less to cast for each creature you control with a charge counters on it.',
    );
    // Should NOT parse as StaticAbility (unsupported form)
    if (r.kind === 'StaticAbility') {
      expect(r.ability.modifier.kind).not.toBe('ReduceCost');
    } else {
      expect(r.kind).not.toBe('StaticAbility');
    }
  });
});

// ============================================================================
// Form 16: evaluable conditional — CMC threshold
// ============================================================================

describe('Form 16 — evaluable CMC conditional', () => {
  it('recognizes "costs {N} less if you control a permanent with mana value N or greater"', () => {
    const r = parseOracleText(
      'This spell costs {2} less to cast if you control a permanent with mana value 4 or greater.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('applies reduction when condition is met', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // A 5-CMC permanent
    defs.set('big', makeDef('big', { type_line: 'Creature', card_types: ['creature'], cmc: 5 }));
    cards.set('bf', makeCard('bf', 'big', 'p1'));

    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {2} less to cast if you control a permanent with mana value 4 or greater.',
      card_types: ['instant'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(2);
  });

  it('applies 0 reduction when condition is not met', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // Only a 2-CMC permanent — doesn't meet the threshold
    defs.set('small', makeDef('small', { type_line: 'Creature', card_types: ['creature'], cmc: 2 }));
    cards.set('bf', makeCard('bf', 'small', 'p1'));

    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {2} less to cast if you control a permanent with mana value 4 or greater.',
      card_types: ['instant'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });
});

// ============================================================================
// Form 17: evaluable conditional — graveyard count threshold (Octavia)
// ============================================================================

describe('Form 17 — evaluable graveyard count conditional', () => {
  it('recognizes "costs {N} less if you have N or more instant and sorcery cards in your graveyard" (Octavia)', () => {
    // Real card: "Octavia, Living Thesis: This spell costs {8} less to cast if you have
    //             eight or more instant and/or sorcery cards in your graveyard."
    const r = parseOracleText(
      'This spell costs {8} less to cast if you have 8 or more instant and sorcery cards in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('applies reduction when threshold is met', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('bolt', makeDef('bolt', { type_line: 'Instant', card_types: ['instant'] }));
    defs.set('recall', makeDef('recall', { type_line: 'Sorcery', card_types: ['sorcery'] }));

    // Put 8 instant/sorcery cards in graveyard
    for (let i = 0; i < 5; i++) {
      cards.set(`bolt_gy${i}`, makeCard(`bolt_gy${i}`, 'bolt', 'p1', 'graveyard'));
    }
    for (let i = 0; i < 3; i++) {
      cards.set(`recall_gy${i}`, makeCard(`recall_gy${i}`, 'recall', 'p1', 'graveyard'));
    }

    const spellDef = makeDef('octavia', {
      oracle_text: 'This spell costs {8} less to cast if you have 8 or more instant and sorcery cards in your graveyard.',
      mana_cost: '{6}{U}{U}',
      cmc: 8,
      card_types: ['creature'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // Exactly 8 spells meet threshold → reduction = 8
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(8);
  });

  it('applies 0 reduction when threshold is not met', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('bolt', makeDef('bolt', { type_line: 'Instant', card_types: ['instant'] }));
    // Only 7 instants (threshold is 8)
    for (let i = 0; i < 7; i++) {
      cards.set(`bolt_gy${i}`, makeCard(`bolt_gy${i}`, 'bolt', 'p1', 'graveyard'));
    }

    const spellDef = makeDef('octavia', {
      oracle_text: 'This spell costs {8} less to cast if you have 8 or more instant and sorcery cards in your graveyard.',
      card_types: ['creature'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });
});

// ============================================================================
// EXECUTION — castSpell pays reduced cost for new forms
// ============================================================================

describe('execution — new forms reduce actual cast cost', () => {
  it('party: 2 party members → cost reduced by 2 at cast', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // Spell that costs {4} with party reduction
    defs.set('party_spell', makeDef('party_spell', {
      name: 'Rally the Party',
      type_line: 'Sorcery',
      oracle_text: 'This spell costs {1} less to cast for each creature in your party.',
      mana_cost: '{4}',
      cmc: 4,
      card_types: ['sorcery'],
      power: undefined,
      toughness: undefined,
    }));
    cards.set('spell_hand', makeCard('spell_hand', 'party_spell', 'p1', 'hand'));

    // 2 party classes: Cleric + Warrior
    defs.set('cleric', makeDef('cleric', { type_line: 'Creature — Cleric', card_types: ['creature'] }));
    defs.set('warrior', makeDef('warrior', { type_line: 'Creature — Warrior', card_types: ['creature'] }));
    cards.set('cleric_bf', makeCard('cleric_bf', 'cleric', 'p1'));
    cards.set('warrior_bf', makeCard('warrior_bf', 'warrior', 'p1'));

    // Cost = 4 - 2 = 2; fund with exactly 2 generic mana
    const players = [makePlayer('p1'), makePlayer('p2')];
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), C: 2 } };

    const state = makeState({ players, cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', defs.get('party_spell')!)).toBe(2);

    const after = castSpell(state, 'p1', 'spell_hand');
    const p1After = after.players.find(p => p.id === 'p1')!;
    expect(totalMana(p1After)).toBe(0);
    expect(after.cards.get('spell_hand')!.zone).toBe('stack');
  });

  it('domain: 3 basic land types → cost reduced by 3 at cast', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('domain_spell', makeDef('domain_spell', {
      name: 'Invading Manticore',
      type_line: 'Sorcery',
      oracle_text: 'This spell costs {1} less to cast for each basic land type among lands you control.',
      mana_cost: '{5}',
      cmc: 5,
      card_types: ['sorcery'],
      power: undefined,
      toughness: undefined,
    }));
    cards.set('ds_hand', makeCard('ds_hand', 'domain_spell', 'p1', 'hand'));

    // 3 basic land types
    defs.set('plains', makeDef('plains', { type_line: 'Land — Plains', card_types: ['land'] }));
    defs.set('island', makeDef('island', { type_line: 'Land — Island', card_types: ['land'] }));
    defs.set('swamp', makeDef('swamp', { type_line: 'Land — Swamp', card_types: ['land'] }));
    cards.set('pl', makeCard('pl', 'plains', 'p1'));
    cards.set('is', makeCard('is', 'island', 'p1'));
    cards.set('sw', makeCard('sw', 'swamp', 'p1'));

    // Cost = 5 - 3 = 2; fund with 2 generic mana
    const players = [makePlayer('p1'), makePlayer('p2')];
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), C: 2 } };

    const state = makeState({ players, cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', defs.get('domain_spell')!)).toBe(3);

    const after = castSpell(state, 'p1', 'ds_hand');
    const p1After = after.players.find(p => p.id === 'p1')!;
    expect(totalMana(p1After)).toBe(0);
    expect(after.cards.get('ds_hand')!.zone).toBe('stack');
  });

  it('instant+sorcery graveyard: 4 cards → cost reduced by 4 at cast (Cryptic Serpent)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('serpent_def', makeDef('serpent_def', {
      name: 'Cryptic Serpent',
      type_line: 'Creature — Serpent',
      oracle_text: 'This spell costs {1} less to cast for each instant and sorcery card in your graveyard.',
      mana_cost: '{5}{U}{U}',
      cmc: 7,
      card_types: ['creature'],
      power: 6,
      toughness: 5,
    }));
    cards.set('serpent_hand', makeCard('serpent_hand', 'serpent_def', 'p1', 'hand'));

    defs.set('bolt', makeDef('bolt', { type_line: 'Instant', card_types: ['instant'] }));
    defs.set('rite', makeDef('rite', { type_line: 'Sorcery', card_types: ['sorcery'] }));
    // 4 instants/sorceries in graveyard → reduction 4
    for (let i = 0; i < 2; i++) {
      cards.set(`bolt_gy${i}`, makeCard(`bolt_gy${i}`, 'bolt', 'p1', 'graveyard'));
      cards.set(`rite_gy${i}`, makeCard(`rite_gy${i}`, 'rite', 'p1', 'graveyard'));
    }

    // Cost = {5}{U}{U} − 4 = {1}{U}{U}; fund with 1 generic + 2 blue
    const players = [makePlayer('p1'), makePlayer('p2')];
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), U: 2, C: 1 } };

    const state = makeState({ players, cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', defs.get('serpent_def')!)).toBe(4);

    const after = castSpell(state, 'p1', 'serpent_hand');
    const p1After = after.players.find(p => p.id === 'p1')!;
    expect(totalMana(p1After)).toBe(0);
    expect(after.cards.get('serpent_hand')!.zone).toBe('stack');
  });
});

// ============================================================================
// HONESTY GATES — forms we still decline
// ============================================================================

describe('honesty gates — forms still declined', () => {
  it('does NOT apply flat regex to "costs less if it targets a tapped creature"', () => {
    const def = makeDef('d', {
      oracle_text: 'This spell costs {2} less to cast if it targets a tapped creature.',
      card_types: ['instant'],
    });
    const state = makeState({ cards: new Map(), cardDefinitions: new Map() });
    expect(getIntrinsicCostReduction(state, 'p1', def)).toBe(0);
  });

  it('does NOT claim forms with non-+1/+1 counter qualification', () => {
    // "with a charge counters on it" — unsupported counter type
    const r = parseOracleText(
      'This spell costs {1} less to cast for each permanent you control with a charge counters on it.',
    );
    if (r.kind === 'StaticAbility') {
      expect(r.ability.modifier.kind).not.toBe('ReduceCost');
    } else {
      expect(r.kind).not.toBe('StaticAbility');
    }
  });
});
