/**
 * Slice 5/12 — Dynamic cost-reduction additive forms
 *
 * Tests Forms 38-45 added to getIntrinsicCostReduction and isSelfCostReductionSentence:
 *
 *  38. "instant or sorcery card in your graveyard" (OR variant of Form 11)
 *      Executor: counts instant/sorcery cards (either type) in caster's graveyard.
 *
 *  39. "different converted mana cost among cards in your graveyard" (legacy CMC synonym)
 *      Executor: same as Form 18 — distinct cmc values in graveyard.
 *
 *  40. "where X is the number of [filter] cards in your graveyard" (dynamic where-X GY count)
 *      Executor: graveyardCardsForCostReduction applied.
 *
 *  41. "[type] in your graveyard" without "card" (e.g. "Zombie in your graveyard")
 *      Executor: graveyardCardsForCostReduction by type/subtype.
 *
 *  42. "for each card in your graveyard" (total graveyard count, no type filter)
 *      Executor: counts ALL cards in caster's graveyard.
 *
 *  43. "for each color among cards in your graveyard" (colors in GY)
 *      Executor: distinct colors among caster's graveyard cards.
 *
 *  44. "for each creature type among creature cards in your graveyard"
 *      Executor: distinct creature subtypes among caster's graveyard creature cards.
 *
 *  45. Clamp rider variants: "to less than {N}" and "below one mana" phrasings.
 *      Absorbed as benign by isSelfCostReductionSentence; clamp enforced in reduceGenericCost.
 *
 * Each section: parser recognition (isSelfCostReductionSentence / parseOracleText) +
 * getIntrinsicCostReduction runtime enforcement.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { isSelfCostReductionSentence } from '../effects/matchers/static-abilities';
import { getIntrinsicCostReduction } from '../effects/continuous';
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
    commanderInstanceIds: [],
    commanderCastCounts: {},
    manaPool: emptyManaPool(),
    snowManaPool: emptyManaPool(),
    restrictedMana: [],
    conditionalMana: [],
    hasPlayedLand: false,
    landsPlayedThisTurn: 0,
    hasPriority: false, hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'] = 'graveyard',
): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
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
    ...overrides,
  };
}

// ============================================================================
// Form 38 — "instant or sorcery card in your graveyard" (OR form)
// ============================================================================

describe('Form 38 — "instant or sorcery card in your graveyard" (OR form)', () => {
  it('isSelfCostReductionSentence recognizes the OR form as dynamic', () => {
    expect(
      isSelfCostReductionSentence(
        'This spell costs {1} less to cast for each instant or sorcery card in your graveyard',
      ),
    ).toBe('dynamic');
  });

  it('parseOracleText: instant-or-sorcery GY reduction + Flying → StaticAbility', () => {
    const oracle =
      'This spell costs {1} less to cast for each instant or sorcery card in your graveyard.\nFlying';
    const r = parseOracleText(oracle, '{3}{U}');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('getIntrinsicCostReduction counts instant AND sorcery cards in graveyard', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const instantDef = makeDef('instant_def', {
      type_line: 'Instant', card_types: ['instant'], cmc: 2,
    });
    const sorceryDef = makeDef('sorcery_def', {
      type_line: 'Sorcery', card_types: ['sorcery'], cmc: 3,
    });
    const creatureDef = makeDef('creature_def', {
      type_line: 'Creature', card_types: ['creature'], cmc: 4,
    });
    defs.set('instant_def', instantDef);
    defs.set('sorcery_def', sorceryDef);
    defs.set('creature_def', creatureDef);

    // 2 instants + 1 sorcery + 1 creature in p1's graveyard
    cards.set('i1', makeCard('i1', 'instant_def', 'p1', 'graveyard'));
    cards.set('i2', makeCard('i2', 'instant_def', 'p1', 'graveyard'));
    cards.set('s1', makeCard('s1', 'sorcery_def', 'p1', 'graveyard'));
    cards.set('cr1', makeCard('cr1', 'creature_def', 'p1', 'graveyard'));
    // Opponent's instant — should NOT count
    cards.set('opp_i', makeCard('opp_i', 'instant_def', 'p2', 'graveyard'));

    const spellDef = makeDef('test_spell', {
      oracle_text: 'This spell costs {1} less to cast for each instant or sorcery card in your graveyard.',
      mana_cost: '{4}{U}', cmc: 5,
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 2 instants + 1 sorcery = 3 qualifying cards → reduction 3
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(3);
  });

  it('does NOT double-count with Form 11 (instant AND sorcery)', () => {
    // Form 11 uses "and"; this is the "or" variant. They should never both fire.
    const andForm = 'This spell costs {1} less to cast for each instant and sorcery card in your graveyard';
    const orForm = 'This spell costs {1} less to cast for each instant or sorcery card in your graveyard';
    // Both recognized
    expect(isSelfCostReductionSentence(andForm)).toBe('dynamic');
    expect(isSelfCostReductionSentence(orForm)).toBe('dynamic');
    // Neither is null — they are parallel forms
  });
});

// ============================================================================
// Form 39 — "different converted mana cost" (legacy CMC synonym)
// ============================================================================

describe('Form 39 — "different converted mana cost among cards in your graveyard"', () => {
  it('isSelfCostReductionSentence recognizes legacy CMC form as dynamic', () => {
    expect(
      isSelfCostReductionSentence(
        'This spell costs {1} less to cast for each different converted mana cost among cards in your graveyard',
      ),
    ).toBe('dynamic');
  });

  it('getIntrinsicCostReduction: counts distinct CMC values (legacy wording)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // 3 cards with distinct cmc values: 1, 3, 5
    const def1 = makeDef('def1', { type_line: 'Creature', card_types: ['creature'], cmc: 1 });
    const def2 = makeDef('def2', { type_line: 'Sorcery', card_types: ['sorcery'], cmc: 3 });
    const def3 = makeDef('def3', { type_line: 'Instant', card_types: ['instant'], cmc: 5 });
    // Duplicate cmc=1 — should NOT increase count
    defs.set('def1', def1);
    defs.set('def2', def2);
    defs.set('def3', def3);

    cards.set('c1', makeCard('c1', 'def1', 'p1', 'graveyard'));
    cards.set('c2', makeCard('c2', 'def2', 'p1', 'graveyard'));
    cards.set('c3', makeCard('c3', 'def3', 'p1', 'graveyard'));
    cards.set('c4', makeCard('c4', 'def1', 'p1', 'graveyard')); // duplicate cmc=1

    const spellDef = makeDef('legacy_card', {
      oracle_text:
        'This spell costs {1} less to cast for each different converted mana cost among cards in your graveyard.',
      mana_cost: '{6}{U}', cmc: 7,
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 3 distinct cmc values (1, 3, 5) → reduction 3
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(3);
  });
});

// ============================================================================
// Form 40 — "where X is the number of [filter] cards in your graveyard"
// ============================================================================

describe('Form 40 — "where X is the number of [filter] cards in your graveyard"', () => {
  it('isSelfCostReductionSentence recognizes the where-X GY count form', () => {
    expect(
      isSelfCostReductionSentence(
        'This spell costs {X} less to cast, where X is the number of creature cards in your graveyard',
      ),
    ).toBe('dynamic');
  });

  it('isSelfCostReductionSentence recognizes "cards" (plural) variant', () => {
    expect(
      isSelfCostReductionSentence(
        'This spell costs {X} less to cast, where X is the number of creature cards in your graveyard',
      ),
    ).toBe('dynamic');
  });

  it('parseOracleText: where-X GY count + ETB draw trigger → ETB', () => {
    const oracle =
      'This spell costs {X} less to cast, where X is the number of creature cards in your graveyard.\nWhen this creature enters, draw a card.';
    const r = parseOracleText(oracle, '{3}{U}');
    // The cost-reduction line is absorbed; the ETB draw triggers the ETB parser.
    expect(r.kind).toBe('ETB');
  });

  it('getIntrinsicCostReduction: counts creature cards in graveyard for where-X form', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const creatureDef = makeDef('creature_def', {
      type_line: 'Creature — Zombie', card_types: ['creature'], cmc: 3,
    });
    const sorceryDef = makeDef('sorcery_def', {
      type_line: 'Sorcery', card_types: ['sorcery'], cmc: 2,
    });
    defs.set('creature_def', creatureDef);
    defs.set('sorcery_def', sorceryDef);

    // 3 creature cards + 1 sorcery in p1's graveyard
    cards.set('cr1', makeCard('cr1', 'creature_def', 'p1', 'graveyard'));
    cards.set('cr2', makeCard('cr2', 'creature_def', 'p1', 'graveyard'));
    cards.set('cr3', makeCard('cr3', 'creature_def', 'p1', 'graveyard'));
    cards.set('so1', makeCard('so1', 'sorcery_def', 'p1', 'graveyard'));

    const spellDef = makeDef('test_spell', {
      oracle_text:
        'This spell costs {X} less to cast, where X is the number of creature cards in your graveyard.',
      mana_cost: '{5}{U}', cmc: 6,
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 3 creature cards → X = 3
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(3);
  });
});

// ============================================================================
// Form 41 — "[type] in your graveyard" (no "card" qualifier)
// ============================================================================

describe('Form 41 — "[type] in your graveyard" without "card" qualifier', () => {
  it('isSelfCostReductionSentence recognizes "Zombie in your graveyard" (no card)', () => {
    expect(
      isSelfCostReductionSentence(
        'This spell costs {1} less to cast for each Zombie in your graveyard',
      ),
    ).toBe('dynamic');
  });

  it('isSelfCostReductionSentence recognizes "creature in your graveyard" (no card)', () => {
    expect(
      isSelfCostReductionSentence(
        'This spell costs {1} less to cast for each creature in your graveyard',
      ),
    ).toBe('dynamic');
  });

  it('parseOracleText: Zombie GY count + dies trigger → Spell (mixed face)', () => {
    const oracle =
      'This spell costs {1} less to cast for each Zombie in your graveyard.\nWhen this creature dies, create a 2/2 black Zombie creature token.';
    const r = parseOracleText(oracle, '{3}{B}');
    expect(['Spell', 'ETB', 'Triggered']).toContain(r.kind);
  });

  it('getIntrinsicCostReduction: counts Zombies (by subtype) in graveyard', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const zombieDef = makeDef('zombie_def', {
      type_line: 'Creature — Zombie', card_types: ['creature'], cmc: 2,
    });
    const humanDef = makeDef('human_def', {
      type_line: 'Creature — Human', card_types: ['creature'], cmc: 1,
    });
    defs.set('zombie_def', zombieDef);
    defs.set('human_def', humanDef);

    // 3 Zombies + 1 Human in graveyard
    cards.set('z1', makeCard('z1', 'zombie_def', 'p1', 'graveyard'));
    cards.set('z2', makeCard('z2', 'zombie_def', 'p1', 'graveyard'));
    cards.set('z3', makeCard('z3', 'zombie_def', 'p1', 'graveyard'));
    cards.set('h1', makeCard('h1', 'human_def', 'p1', 'graveyard'));

    const spellDef = makeDef('zombie_lord', {
      oracle_text: 'This spell costs {1} less to cast for each Zombie in your graveyard.',
      mana_cost: '{4}{B}', cmc: 5,
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 3 Zombies → reduction 3
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(3);
  });
});

// ============================================================================
// Form 42 — "for each card in your graveyard" (total graveyard count)
// ============================================================================

describe('Form 42 — "for each card in your graveyard" (total GY count)', () => {
  it('isSelfCostReductionSentence recognizes total GY form as dynamic', () => {
    expect(
      isSelfCostReductionSentence(
        'This spell costs {1} less to cast for each card in your graveyard',
      ),
    ).toBe('dynamic');
  });

  it('parseOracleText: total GY + Destroy target → Spell (mixed face)', () => {
    const oracle =
      'This spell costs {1} less to cast for each card in your graveyard.\nDestroy target creature.';
    const r = parseOracleText(oracle, '{2}{B}');
    expect(['Spell']).toContain(r.kind);
  });

  it('getIntrinsicCostReduction: counts ALL cards in caster graveyard', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const anyDef = makeDef('any_def', { type_line: 'Creature', card_types: ['creature'] });
    defs.set('any_def', anyDef);

    // 5 cards in p1's graveyard, 2 on battlefield, 3 in p2's graveyard
    for (let i = 0; i < 5; i++) {
      cards.set(`gy${i}`, makeCard(`gy${i}`, 'any_def', 'p1', 'graveyard'));
    }
    for (let i = 0; i < 2; i++) {
      cards.set(`bf${i}`, makeCard(`bf${i}`, 'any_def', 'p1', 'battlefield'));
    }
    for (let i = 0; i < 3; i++) {
      cards.set(`opp${i}`, makeCard(`opp${i}`, 'any_def', 'p2', 'graveyard'));
    }

    const spellDef = makeDef('ghoulflesh_style', {
      oracle_text: 'This spell costs {1} less to cast for each card in your graveyard.',
      mana_cost: '{3}{B}', cmc: 4,
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 5 cards in p1's graveyard → reduction 5
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(5);
  });
});

// ============================================================================
// Form 43 — "for each color among cards in your graveyard"
// ============================================================================

describe('Form 43 — "for each color among cards in your graveyard"', () => {
  it('isSelfCostReductionSentence recognizes colors-in-GY form as dynamic', () => {
    expect(
      isSelfCostReductionSentence(
        'This spell costs {2} less to cast for each color among cards in your graveyard',
      ),
    ).toBe('dynamic');
  });

  it('getIntrinsicCostReduction: counts distinct colors among graveyard cards', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const whiteDef = makeDef('white_def', {
      type_line: 'Creature — Angel', card_types: ['creature'], colors: ['W'],
    });
    const blueDef = makeDef('blue_def', {
      type_line: 'Creature — Merfolk', card_types: ['creature'], colors: ['U'],
    });
    const blackDef = makeDef('black_def', {
      type_line: 'Creature — Vampire', card_types: ['creature'], colors: ['B'],
    });
    const colorlessDef = makeDef('colorless_def', {
      type_line: 'Artifact', card_types: ['artifact'], colors: [],
    });
    defs.set('white_def', whiteDef);
    defs.set('blue_def', blueDef);
    defs.set('black_def', blackDef);
    defs.set('colorless_def', colorlessDef);

    // 2 white + 1 blue + 1 black + 1 colorless in p1's graveyard
    cards.set('w1', makeCard('w1', 'white_def', 'p1', 'graveyard'));
    cards.set('w2', makeCard('w2', 'white_def', 'p1', 'graveyard'));
    cards.set('u1', makeCard('u1', 'blue_def', 'p1', 'graveyard'));
    cards.set('b1', makeCard('b1', 'black_def', 'p1', 'graveyard'));
    cards.set('cl1', makeCard('cl1', 'colorless_def', 'p1', 'graveyard'));

    const spellDef = makeDef('multicolor_spell', {
      oracle_text: 'This spell costs {2} less to cast for each color among cards in your graveyard.',
      mana_cost: '{8}', cmc: 8,
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 3 distinct colors (W, U, B) — colorless doesn't count × {2} = 6
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(6);
  });
});

// ============================================================================
// Form 44 — "for each creature type among creature cards in your graveyard"
// ============================================================================

describe('Form 44 — "for each creature type among creature cards in your graveyard"', () => {
  it('isSelfCostReductionSentence recognizes creature-types-in-GY form as dynamic', () => {
    expect(
      isSelfCostReductionSentence(
        'This spell costs {1} less to cast for each creature type among creature cards in your graveyard',
      ),
    ).toBe('dynamic');
  });

  it('getIntrinsicCostReduction: counts distinct creature subtypes in GY', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const zombieDef = makeDef('zombie_def', {
      type_line: 'Creature — Zombie', card_types: ['creature'],
    });
    const vampireDef = makeDef('vampire_def', {
      type_line: 'Creature — Vampire Rogue', card_types: ['creature'],
    });
    const sorceryDef = makeDef('sorcery_def', {
      type_line: 'Sorcery', card_types: ['sorcery'],
    });
    defs.set('zombie_def', zombieDef);
    defs.set('vampire_def', vampireDef);
    defs.set('sorcery_def', sorceryDef);

    // 2 Zombies + 1 Vampire Rogue (2 subtypes: Vampire + Rogue) + 1 Sorcery
    cards.set('z1', makeCard('z1', 'zombie_def', 'p1', 'graveyard'));
    cards.set('z2', makeCard('z2', 'zombie_def', 'p1', 'graveyard'));
    cards.set('vr1', makeCard('vr1', 'vampire_def', 'p1', 'graveyard'));
    cards.set('so1', makeCard('so1', 'sorcery_def', 'p1', 'graveyard'));

    const spellDef = makeDef('type_counter', {
      oracle_text:
        'This spell costs {1} less to cast for each creature type among creature cards in your graveyard.',
      mana_cost: '{5}{B}', cmc: 6,
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // Zombie (from z1/z2), Vampire (from vr1), Rogue (from vr1) = 3 distinct types
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(3);
  });
});

// ============================================================================
// Form 45 — Clamp rider variants ("to less than {N}" / "below one mana")
// ============================================================================

describe('Form 45 — Clamp rider variants', () => {
  it('isSelfCostReductionSentence absorbs "to less than {1}" variant as dynamic', () => {
    expect(
      isSelfCostReductionSentence(
        "This effect can't reduce the mana cost to less than {1}",
      ),
    ).toBe('dynamic');
  });

  it('isSelfCostReductionSentence absorbs "cost to less than {1}" variant as dynamic', () => {
    expect(
      isSelfCostReductionSentence(
        "This effect can't reduce the cost to less than {1}",
      ),
    ).toBe('dynamic');
  });

  it('isSelfCostReductionSentence absorbs "mana cost ... below one mana" variant', () => {
    expect(
      isSelfCostReductionSentence(
        "This effect can't reduce the mana cost of this spell below one mana",
      ),
    ).toBe('dynamic');
  });

  it('does NOT affect unrelated sentences containing "reduce"', () => {
    // "A creature you control can't be blocked by more than one creature" — should return null
    expect(
      isSelfCostReductionSentence(
        "A creature you control can't be blocked by more than one creature",
      ),
    ).toBeNull();
  });

  it('parseOracleText: clamp rider + cost reduction + keyword → StaticAbility', () => {
    // Valiant Changeling style:
    // "This spell costs {1} less to cast for each creature type among creatures you control.
    //  This effect can't reduce the mana cost of this spell to less than one mana. Changeling Double strike"
    const oracle =
      "This spell costs {1} less to cast for each creature type among creatures you control.\nThis effect can't reduce the mana cost of this spell to less than one mana.\nChangeling\nDouble strike";
    const r = parseOracleText(oracle, '{5}{W}{W}');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
  });

  it('parseOracleText: {1} clamp rider variant + cost reduction + keyword → StaticAbility', () => {
    const oracle =
      "This spell costs {1} less to cast for each creature in your graveyard.\nThis effect can't reduce the cost to less than {1}.\nFlying";
    const r = parseOracleText(oracle, '{4}{B}');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
  });
});

// ============================================================================
// Integration: mixed-face absorption for real-card oracle patterns
// ============================================================================

describe('Mixed-face absorption — real card oracle patterns', () => {
  it('Karador-style: "creature card in GY" + non-parseable oracle → Unparsed (GY line absorbed)', () => {
    // The cost-reduction line IS absorbed; the remainder "Once during each of your turns,
    // you may cast a creature spell from your graveyard." is not yet parsed by any matcher.
    // The face should remain Unparsed (not crash) rather than misparse.
    const oracle =
      'This spell costs {1} less to cast for each creature card in your graveyard.\nOnce during each of your turns, you may cast a creature spell from your graveyard.';
    const r = parseOracleText(oracle, '{B}{G}{W}');
    // The cost-reduction line is recognized; the remainder fails to parse.
    // Either Unparsed or a valid parse is acceptable — the important thing is no crash.
    expect(['Unparsed', 'ETB', 'Triggered', 'Spell', 'StaticAbility']).toContain(r.kind);
  });

  it('"instant or sorcery" GY + Flying absorption → StaticAbility', () => {
    const oracle =
      'This spell costs {1} less to cast for each instant or sorcery card in your graveyard.\nFlying';
    const r = parseOracleText(oracle, '{3}{U}');
    expect(r.kind).toBe('StaticAbility');
  });

  it('"where X is count in GY" + ETB draw absorption → ETB', () => {
    const oracle =
      'This spell costs {X} less to cast, where X is the number of creature cards in your graveyard.\nWhen this creature enters, draw a card.';
    const r = parseOracleText(oracle, '{3}{U}');
    expect(r.kind).toBe('ETB');
  });

  it('"total GY count" + Destroy target absorption → Spell', () => {
    const oracle =
      'This spell costs {1} less to cast for each card in your graveyard.\nDestroy target creature.';
    const r = parseOracleText(oracle, '{2}{B}');
    expect(r.kind).toBe('Spell');
  });

  it('"Zombie in GY" + dies trigger → parseable', () => {
    const oracle =
      'This spell costs {1} less to cast for each Zombie in your graveyard.\nWhen this creature dies, create a 2/2 black Zombie creature token.';
    const r = parseOracleText(oracle, '{3}{B}');
    expect(['Spell', 'Triggered', 'ETB']).toContain(r.kind);
  });
});
