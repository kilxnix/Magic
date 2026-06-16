/**
 * Slice 5/12 long-tail — Self cost-reduction: affinity + remaining unrecognized forms
 *
 * Tests Forms 27-32 added to getIntrinsicCostReduction and isSelfCostReductionSentence:
 *
 *  27. "Affinity for artifacts" / "Affinity for <type>" keyword line
 *      (Myr Enforcer, Somber Hoverguard, Broodstar)
 *      = {1} less per <type> you control on the battlefield.
 *
 *  28. Graveyard multi-filter for-each
 *      "for each artifact and/or creature card in your graveyard" (Chitin Gravestalker)
 *      "for each noncreature, nonland card in your graveyard" (Serpent of the Pass style)
 *
 *  29. "if you control a <subtype> or a <subtype>" (Wolfkin Outcast // Wedding Crasher)
 *
 *  30. "if you've cast another spell this turn" (Gigastorm Titan)
 *      Backed by state.spellsCastThisTurn (incremented by stack.ts castSpell).
 *
 *  31. "for each <type> card you own in exile and in your graveyard" (Huskburster Swarm style)
 *      Generalized exile+graveyard for-each (no "that's" filter needed).
 *
 *  32. "This effect can't reduce the ... cost to less than one mana" rider (Valiant Changeling)
 *      Absorbed as benign by isSelfCostReductionSentence; clamp enforced in reduceGenericCost.
 *
 * Each section: parser recognition (isSelfCostReductionSentence / parseOracleText) +
 * getIntrinsicCostReduction runtime enforcement.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { isSelfCostReductionSentence } from '../effects/matchers/static-abilities';
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
  zone: CardInstance['zone'] = 'battlefield',
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

function totalMana(p: Player): number {
  const m = p.manaPool;
  return m.W + m.U + m.B + m.R + m.G + m.C;
}

// ============================================================================
// Form 27: Affinity for artifacts keyword line
// (Myr Enforcer / Somber Hoverguard / Broodstar)
// ============================================================================

describe('Form 27 — "Affinity for artifacts" keyword line', () => {
  // ── Parser recognition ────────────────────────────────────────────────────

  it('isSelfCostReductionSentence recognizes bare "Affinity for artifacts" as dynamic', () => {
    expect(isSelfCostReductionSentence('Affinity for artifacts')).toBe('dynamic');
  });

  it('isSelfCostReductionSentence recognizes "Affinity for creatures" as dynamic', () => {
    expect(isSelfCostReductionSentence('Affinity for creatures')).toBe('dynamic');
  });

  it('parseOracleText: Myr Enforcer bare keyword line → StaticAbility', () => {
    // Card databases that strip reminder text store just "Affinity for artifacts"
    const r = parseOracleText('Affinity for artifacts');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('parseOracleText: Somber Hoverguard (Affinity + Flying) → StaticAbility', () => {
    // "Affinity for artifacts\nFlying"
    const r = parseOracleText('Affinity for artifacts\nFlying');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
  });

  it('parseOracleText: Myr Enforcer with full reminder text (Form 2 already handles) → StaticAbility', () => {
    // Scryfall oracle includes reminder text; Form 2 in getIntrinsicCostReduction picks it up.
    const r = parseOracleText(
      'Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)',
    );
    expect(r.kind).toBe('StaticAbility');
  });

  // ── Runtime enforcement ───────────────────────────────────────────────────

  it('getIntrinsicCostReduction counts artifacts on battlefield for bare "Affinity for artifacts"', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const artifactDef = makeDef('artifact_def', {
      type_line: 'Artifact',
      card_types: ['artifact'],
    });
    defs.set('artifact_def', artifactDef);

    // 4 artifacts on battlefield owned by caster
    for (let i = 0; i < 4; i++) {
      cards.set(`art_${i}`, makeCard(`art_${i}`, 'artifact_def', 'p1'));
    }
    // 1 artifact owned by opponent — should NOT count
    cards.set('opp_art', makeCard('opp_art', 'artifact_def', 'p2'));

    const spellDef = makeDef('myr_enforcer', {
      name: 'Myr Enforcer',
      type_line: 'Artifact Creature — Myr',
      oracle_text: 'Affinity for artifacts',
      mana_cost: '{7}',
      cmc: 7,
      card_types: ['artifact', 'creature'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 4 artifacts owned by caster → reduction = 4
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(4);
  });

  it('does NOT double-count when reminder text is also present (Form 2 handles it)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const artifactDef = makeDef('artifact_def', { type_line: 'Artifact', card_types: ['artifact'] });
    defs.set('artifact_def', artifactDef);
    cards.set('art_1', makeCard('art_1', 'artifact_def', 'p1'));
    cards.set('art_2', makeCard('art_2', 'artifact_def', 'p1'));

    // Oracle text WITH reminder (Scryfall canonical form):
    // Form 2 handles it via the "this spell costs {1} less to cast for each artifact you control" match.
    // Form 27 should NOT also fire (guard: skip if explicit "this spell costs ... for each" exists).
    const spellDef = makeDef('myr_enforcer_with_reminder', {
      oracle_text: 'Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)',
      card_types: ['artifact', 'creature'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 2 artifacts → reduction = 2 (not 4 from double-count)
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(2);
  });

  it('execution: Myr Enforcer {7} with 5 artifacts costs only 2 after reduction', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    cards.set('spell_1', makeCard('spell_1', 'enforcer_def', 'p1', 'hand'));
    defs.set('enforcer_def', makeDef('enforcer_def', {
      name: 'Myr Enforcer',
      type_line: 'Artifact Creature — Myr',
      oracle_text: 'Affinity for artifacts',
      mana_cost: '{7}',
      cmc: 7,
      card_types: ['artifact', 'creature'],
    }));

    const artifactDef = makeDef('artifact_def', { type_line: 'Artifact', card_types: ['artifact'] });
    defs.set('artifact_def', artifactDef);
    for (let i = 0; i < 5; i++) {
      cards.set(`art_${i}`, makeCard(`art_${i}`, 'artifact_def', 'p1'));
    }

    const players = [makePlayer('p1'), makePlayer('p2')];
    // 7 - 5 = 2 generic needed
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), C: 2 } };

    const state = makeState({ players, cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', defs.get('enforcer_def')!)).toBe(5);

    const after = castSpell(state, 'p1', 'spell_1');
    const p1After = after.players.find(p => p.id === 'p1')!;
    expect(totalMana(p1After)).toBe(0);
    expect(after.cards.get('spell_1')!.zone).toBe('stack');
  });
});

// ============================================================================
// Form 28: Graveyard multi-filter for-each
// (Chitin Gravestalker / Serpent of the Pass style)
// ============================================================================

describe('Form 28 — graveyard multi-filter for-each', () => {
  // ── Parser recognition ────────────────────────────────────────────────────

  it('isSelfCostReductionSentence: "artifact and/or creature card in your graveyard" → dynamic', () => {
    expect(isSelfCostReductionSentence(
      'This spell costs {1} less to cast for each artifact and/or creature card in your graveyard',
    )).toBe('dynamic');
  });

  it('parseOracleText: Chitin Gravestalker oracle → StaticAbility', () => {
    const r = parseOracleText(
      'This spell costs {1} less to cast for each artifact and/or creature card in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  // ── Runtime enforcement ───────────────────────────────────────────────────

  it('counts artifact AND creature cards in graveyard (distinct instances)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // 2 artifact cards in p1 graveyard
    const artDef = makeDef('art_def', { type_line: 'Artifact', card_types: ['artifact'] });
    defs.set('art_def', artDef);
    cards.set('art_gy_1', makeCard('art_gy_1', 'art_def', 'p1', 'graveyard'));
    cards.set('art_gy_2', makeCard('art_gy_2', 'art_def', 'p1', 'graveyard'));

    // 3 creature cards in p1 graveyard
    const creatureDef = makeDef('creature_def', { type_line: 'Creature', card_types: ['creature'] });
    defs.set('creature_def', creatureDef);
    for (let i = 0; i < 3; i++) {
      cards.set(`cre_gy_${i}`, makeCard(`cre_gy_${i}`, 'creature_def', 'p1', 'graveyard'));
    }

    // 1 artifact creature in p1 graveyard — counts once (it's artifact OR creature)
    const artCreatureDef = makeDef('art_cre_def', {
      type_line: 'Artifact Creature — Golem',
      card_types: ['artifact', 'creature'],
    });
    defs.set('art_cre_def', artCreatureDef);
    cards.set('art_cre_gy', makeCard('art_cre_gy', 'art_cre_def', 'p1', 'graveyard'));

    // 1 opponent's artifact — should NOT count
    cards.set('opp_art_gy', makeCard('opp_art_gy', 'art_def', 'p2', 'graveyard'));

    const spellDef = makeDef('chitin', {
      oracle_text: 'This spell costs {1} less to cast for each artifact and/or creature card in your graveyard.',
      card_types: ['creature'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 2 artifacts + 3 creatures + 1 artifact creature = 6 (artifact creature counted once)
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(6);
  });

  it('execution: {5} spell with 3 matching graveyard cards costs 2', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    cards.set('spell_1', makeCard('spell_1', 'chitin_def', 'p1', 'hand'));
    defs.set('chitin_def', makeDef('chitin_def', {
      name: 'Chitin Gravestalker',
      type_line: 'Creature',
      oracle_text: 'This spell costs {1} less to cast for each artifact and/or creature card in your graveyard.',
      mana_cost: '{5}',
      cmc: 5,
      card_types: ['creature'],
    }));

    const artifactDef = makeDef('artifact_def', { type_line: 'Artifact', card_types: ['artifact'] });
    defs.set('artifact_def', artifactDef);
    // 3 artifacts in graveyard → reduction 3
    for (let i = 0; i < 3; i++) {
      cards.set(`gy_${i}`, makeCard(`gy_${i}`, 'artifact_def', 'p1', 'graveyard'));
    }

    const players = [makePlayer('p1'), makePlayer('p2')];
    // 5 - 3 = 2 generic needed
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), C: 2 } };

    const state = makeState({ players, cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', defs.get('chitin_def')!)).toBe(3);

    const after = castSpell(state, 'p1', 'spell_1');
    expect(after.cards.get('spell_1')!.zone).toBe('stack');
    expect(totalMana(after.players.find(p => p.id === 'p1')!)).toBe(0);
  });
});

// ============================================================================
// Form 29: "if you control a <subtype> or a <subtype>" (Wolfkin Outcast)
// ============================================================================

describe('Form 29 — "if you control a <subtype> or a <subtype>"', () => {
  // ── Parser recognition ────────────────────────────────────────────────────

  it('isSelfCostReductionSentence: "if you control a Human or a Wolf" → dynamic', () => {
    expect(isSelfCostReductionSentence(
      'This spell costs {2} less to cast if you control a Human or a Wolf',
    )).toBe('dynamic');
  });

  it('parseOracleText: Wolfkin Outcast oracle → StaticAbility', () => {
    const r = parseOracleText(
      'This spell costs {2} less to cast if you control a Human or a Wolf.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
  });

  // ── Runtime enforcement ───────────────────────────────────────────────────

  it('applies reduction when caster controls a Human', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const humanDef = makeDef('human_def', {
      type_line: 'Creature — Human',
      card_types: ['creature'],
    });
    defs.set('human_def', humanDef);
    cards.set('human_1', makeCard('human_1', 'human_def', 'p1'));

    const spellDef = makeDef('wolfkin', {
      oracle_text: 'This spell costs {2} less to cast if you control a Human or a Wolf.',
      card_types: ['creature'],
    });
    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(2);
  });

  it('applies reduction when caster controls a Wolf', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const wolfDef = makeDef('wolf_def', {
      type_line: 'Creature — Wolf',
      card_types: ['creature'],
    });
    defs.set('wolf_def', wolfDef);
    cards.set('wolf_1', makeCard('wolf_1', 'wolf_def', 'p1'));

    const spellDef = makeDef('wolfkin', {
      oracle_text: 'This spell costs {2} less to cast if you control a Human or a Wolf.',
      card_types: ['creature'],
    });
    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(2);
  });

  it('returns 0 when caster controls neither subtype', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const goblinDef = makeDef('goblin_def', {
      type_line: 'Creature — Goblin',
      card_types: ['creature'],
    });
    defs.set('goblin_def', goblinDef);
    cards.set('goblin_1', makeCard('goblin_1', 'goblin_def', 'p1'));

    const spellDef = makeDef('wolfkin', {
      oracle_text: 'This spell costs {2} less to cast if you control a Human or a Wolf.',
      card_types: ['creature'],
    });
    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });

  it('does NOT count opponent-controlled subtypes', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const humanDef = makeDef('human_def', {
      type_line: 'Creature — Human',
      card_types: ['creature'],
    });
    defs.set('human_def', humanDef);
    // Only opponent controls a Human
    cards.set('opp_human', makeCard('opp_human', 'human_def', 'p2'));

    const spellDef = makeDef('wolfkin', {
      oracle_text: 'This spell costs {2} less to cast if you control a Human or a Wolf.',
      card_types: ['creature'],
    });
    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });
});

// ============================================================================
// Form 30: "if you've cast another spell this turn" (Gigastorm Titan)
// ============================================================================

describe('Form 30 — "if you\'ve cast another spell this turn"', () => {
  // ── Parser recognition ────────────────────────────────────────────────────

  it('isSelfCostReductionSentence: "if you\'ve cast another spell this turn" → dynamic', () => {
    expect(isSelfCostReductionSentence(
      "This spell costs {2} less to cast if you've cast another spell this turn",
    )).toBe('dynamic');
  });

  it('parseOracleText: Gigastorm Titan oracle → StaticAbility', () => {
    const r = parseOracleText(
      "This spell costs {2} less to cast if you've cast another spell this turn.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
  });

  // ── Runtime enforcement ───────────────────────────────────────────────────

  it('applies reduction when spellsCastThisTurn >= 1 (another spell already cast)', () => {
    const spellDef = makeDef('gigastorm', {
      oracle_text: "This spell costs {2} less to cast if you've cast another spell this turn.",
      card_types: ['creature'],
    });
    // 1 spell was cast before this one → "another" condition met
    const state = makeState({ spellsCastThisTurn: 1 });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(2);
  });

  it('applies reduction when spellsCastThisTurn is 2 (two prior spells)', () => {
    const spellDef = makeDef('gigastorm', {
      oracle_text: "This spell costs {2} less to cast if you've cast another spell this turn.",
      card_types: ['creature'],
    });
    const state = makeState({ spellsCastThisTurn: 2 });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(2);
  });

  it('returns 0 when spellsCastThisTurn is 0 (no prior spells this turn)', () => {
    const spellDef = makeDef('gigastorm', {
      oracle_text: "This spell costs {2} less to cast if you've cast another spell this turn.",
      card_types: ['creature'],
    });
    const state = makeState({ spellsCastThisTurn: 0 });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });

  it('returns 0 when spellsCastThisTurn is undefined', () => {
    const spellDef = makeDef('gigastorm', {
      oracle_text: "This spell costs {2} less to cast if you've cast another spell this turn.",
      card_types: ['creature'],
    });
    const state = makeState();
    // spellsCastThisTurn defaults to undefined → treated as 0
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });

  it('execution: {4} Gigastorm Titan costs {2} when a prior spell was cast', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    cards.set('spell_1', makeCard('spell_1', 'gigastorm_def', 'p1', 'hand'));
    defs.set('gigastorm_def', makeDef('gigastorm_def', {
      name: 'Gigastorm Titan',
      type_line: 'Creature',
      oracle_text: "This spell costs {2} less to cast if you've cast another spell this turn.",
      mana_cost: '{4}',
      cmc: 4,
      card_types: ['creature'],
    }));

    const players = [makePlayer('p1'), makePlayer('p2')];
    // Need exactly 2 mana (4 - 2 reduction)
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), C: 2 } };

    // Already cast 1 spell this turn → "another" condition met
    const state = makeState({
      players,
      cards,
      cardDefinitions: defs,
      spellsCastThisTurn: 1,
    });

    expect(getIntrinsicCostReduction(state, 'p1', defs.get('gigastorm_def')!)).toBe(2);
    const after = castSpell(state, 'p1', 'spell_1');
    expect(after.cards.get('spell_1')!.zone).toBe('stack');
    expect(totalMana(after.players.find(p => p.id === 'p1')!)).toBe(0);
  });
});

// ============================================================================
// Form 31: Generalized exile+graveyard for-each (Huskburster Swarm style)
// ============================================================================

describe('Form 31 — generalized exile+graveyard for-each', () => {
  // ── Parser recognition ────────────────────────────────────────────────────

  it('isSelfCostReductionSentence: "for each creature card you own in exile and in your graveyard" → dynamic', () => {
    expect(isSelfCostReductionSentence(
      'This spell costs {1} less to cast for each creature card you own in exile and in your graveyard',
    )).toBe('dynamic');
  });

  it('parseOracleText: exile+graveyard for-each oracle → StaticAbility', () => {
    const r = parseOracleText(
      'This spell costs {1} less to cast for each creature card you own in exile and in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
  });

  // ── Runtime enforcement ───────────────────────────────────────────────────

  it('counts cards in both exile and graveyard', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const creatureDef = makeDef('creature_def', { type_line: 'Creature', card_types: ['creature'] });
    defs.set('creature_def', creatureDef);

    // 2 creature cards in exile
    cards.set('exiled_1', makeCard('exiled_1', 'creature_def', 'p1', 'exile'));
    cards.set('exiled_2', makeCard('exiled_2', 'creature_def', 'p1', 'exile'));
    // 3 creature cards in graveyard
    for (let i = 0; i < 3; i++) {
      cards.set(`dead_${i}`, makeCard(`dead_${i}`, 'creature_def', 'p1', 'graveyard'));
    }
    // 1 on battlefield — should NOT count
    cards.set('alive', makeCard('alive', 'creature_def', 'p1', 'battlefield'));
    // 1 opponent's creature in exile — should NOT count
    cards.set('opp_exiled', makeCard('opp_exiled', 'creature_def', 'p2', 'exile'));

    const spellDef = makeDef('huskburster', {
      oracle_text: 'This spell costs {1} less to cast for each creature card you own in exile and in your graveyard.',
      card_types: ['creature'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 2 exile + 3 graveyard = 5
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(5);
  });
});

// ============================================================================
// Form 32: "Can't reduce to less than one mana" rider (Valiant Changeling)
// ============================================================================

describe('Form 32 — "can\'t reduce ... to less than one mana" clamp rider', () => {
  // ── Parser recognition ────────────────────────────────────────────────────

  it('isSelfCostReductionSentence: rider sentence → dynamic (absorbed, not blocking)', () => {
    expect(isSelfCostReductionSentence(
      "This effect can't reduce the total cost to less than one mana",
    )).toBe('dynamic');
  });

  it("isSelfCostReductionSentence: variant phrasing with 'mana cost' → dynamic", () => {
    expect(isSelfCostReductionSentence(
      "This effect can't reduce the mana cost of this spell to less than one mana",
    )).toBe('dynamic');
  });

  it('parseOracleText: Valiant Changeling-style oracle (reduction + rider) → StaticAbility', () => {
    // "This spell costs {1} less for each creature type among creatures you control.
    //  This effect can't reduce the total cost to less than one mana."
    const r = parseOracleText(
      "This spell costs {1} less to cast for each creature type among creatures you control.\nThis effect can't reduce the total cost to less than one mana.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
  });

  // ── Runtime clamp enforcement ─────────────────────────────────────────────

  it('clamps generic cost to minimum {1} when no colored pips and reduction would reach 0', () => {
    // A {6} pure-generic spell with "costs {1} less for each creature type" and the rider.
    // If caster controls 10+ creature types, the clamp keeps at least {1} generic.
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    cards.set('spell_1', makeCard('spell_1', 'changeling_def', 'p1', 'hand'));
    defs.set('changeling_def', makeDef('changeling_def', {
      name: 'Valiant Changeling',
      type_line: 'Creature — Shapeshifter',
      oracle_text:
        "This spell costs {1} less to cast for each creature type among creatures you control.\nThis effect can't reduce the total cost to less than one mana.",
      mana_cost: '{6}',
      cmc: 6,
      card_types: ['creature'],
    }));

    // Add 10 creatures each with a distinct creature type to force max reduction attempt
    const types = ['Human', 'Elf', 'Goblin', 'Merfolk', 'Zombie', 'Angel', 'Dragon', 'Wizard', 'Warrior', 'Knight'];
    for (const t of types) {
      const tid = `cre_${t.toLowerCase()}`;
      defs.set(tid, makeDef(tid, {
        type_line: `Creature — ${t}`,
        card_types: ['creature'],
      }));
      cards.set(tid, makeCard(tid, tid, 'p1'));
    }

    const players = [makePlayer('p1'), makePlayer('p2')];
    // Even with 10 creature types (→ 10 reduction on a {6} spell), the clamp
    // ensures at least {1} is owed. Provide exactly {1} in pool.
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), C: 1 } };

    const state = makeState({ players, cards, cardDefinitions: defs });

    const after = castSpell(state, 'p1', 'spell_1');
    expect(after.cards.get('spell_1')!.zone).toBe('stack');
    // All 1 mana consumed
    expect(totalMana(after.players.find(p => p.id === 'p1')!)).toBe(0);
  });

  it('does NOT clamp when colored pips remain (they satisfy the one-mana minimum)', () => {
    // A {4}{W} spell with 5 creature types → reduction 5 would make generic = 0,
    // but {W} (1 colored pip) satisfies "at least one mana". Clamp does NOT apply.
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    cards.set('spell_1', makeCard('spell_1', 'colored_def', 'p1', 'hand'));
    defs.set('colored_def', makeDef('colored_def', {
      name: 'Colored Changeling',
      type_line: 'Creature — Shapeshifter',
      oracle_text:
        "This spell costs {1} less to cast for each creature type among creatures you control.\nThis effect can't reduce the total cost to less than one mana.",
      mana_cost: '{4}{W}',
      cmc: 5,
      card_types: ['creature'],
      colors: ['W'],
    }));

    // 5 creatures with distinct types → 5 reduction on {4} generic
    const types = ['Human', 'Elf', 'Goblin', 'Merfolk', 'Zombie'];
    for (const t of types) {
      const tid = `cre_${t.toLowerCase()}`;
      defs.set(tid, makeDef(tid, {
        type_line: `Creature — ${t}`,
        card_types: ['creature'],
      }));
      cards.set(tid, makeCard(tid, tid, 'p1'));
    }

    const players = [makePlayer('p1'), makePlayer('p2')];
    // {4} generic reduced by 5 → 0 generic. {W} (1 pip) satisfies the minimum.
    // Provide exactly {W} with no generic.
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), W: 1 } };

    const state = makeState({ players, cards, cardDefinitions: defs });
    const after = castSpell(state, 'p1', 'spell_1');
    expect(after.cards.get('spell_1')!.zone).toBe('stack');
    expect(totalMana(after.players.find(p => p.id === 'p1')!)).toBe(0);
  });
});
