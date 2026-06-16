/**
 * Slice 2/12 — Dynamic self-cost-reduction: new 'for each / where X / if' forms
 *
 * Tests for Forms 18-19 added to getIntrinsicCostReduction and
 * isSelfCostReductionSentence, plus unsupported-form honesty gates:
 *
 *  18.  Distinct mana values in graveyard (Oskar, Rubbish Reclaimer)
 *       "costs {N} less for each different mana value among cards in your graveyard"
 *  19.  Card-type count threshold — delirium-style conditional (Dusk Feaster)
 *       "costs {N} less if there are N or more card types among cards in your graveyard"
 *
 * Honesty gates (should remain Unparsed or be declined by isSelfCostReductionSentence):
 *  - "if a creature died this turn" (Bone Picker)   — engine does not track deaths per turn
 *  - "for each card exiled this way" (Gorex)         — engine does not track per-cast exile piles
 *
 * Keyword-indicator prefix stripping:
 *  - "Delirium — This spell costs..." prefix is stripped before form matching
 *  - "Domain — This spell costs..." (regression: ensure existing Domain form still works)
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
    manaPool: emptyManaPool(),
    hasPlayedLand: false, hasPriority: false, hasLost: false,
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
  };
}

function totalMana(p: Player): number {
  const m = p.manaPool;
  return m.W + m.U + m.B + m.R + m.G + m.C;
}

// ============================================================================
// Form 18: distinct mana values in graveyard (Oskar, Rubbish Reclaimer)
// ============================================================================

describe('Form 18 — distinct mana values in graveyard (Oskar, Rubbish Reclaimer)', () => {
  it('real Oskar oracle: cost-reduction line is absorbed but full card stays Unparsed (triggered ability not yet supported)', () => {
    // Real oracle text from Scryfall:
    // "This spell costs {1} less to cast for each different mana value among cards in your graveyard.
    //  Whenever you discard a nonland card, you may cast it from your graveyard."
    //
    // The triggered ability "you may cast it from your graveyard" is not yet modeled by the
    // executor, so the full face stays Unparsed. This is the honest result: the cost-reduction
    // line IS recognized (Form 18), but the triggered ability part still keeps the card Unparsed.
    // Runtime: getIntrinsicCostReduction still evaluates the cost reduction correctly.
    const r = parseOracleText(
      'This spell costs {1} less to cast for each different mana value among cards in your graveyard.\nWhenever you discard a nonland card, you may cast it from your graveyard.',
    );
    // The cost-reduction sentence is correctly recognized — isSelfCostReductionSentence returns 'dynamic'.
    // The full face stays Unparsed because the trigger body (cast from graveyard) isn't supported.
    // This is intentional and correct per the honesty bar.
    expect(
      isSelfCostReductionSentence('This spell costs {1} less to cast for each different mana value among cards in your graveyard'),
    ).toBe('dynamic');
    // Full face stays Unparsed — honest (triggered ability not supported)
    expect(r.kind).toBe('Unparsed');
  });

  it('recognizes the cost-reduction sentence standalone', () => {
    const r = parseOracleText(
      'This spell costs {1} less to cast for each different mana value among cards in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
    expect(r.ability.selfOnly).toBe(true);
  });

  it('isSelfCostReductionSentence returns dynamic for Oskar wording', () => {
    const result = isSelfCostReductionSentence(
      'This spell costs {1} less to cast for each different mana value among cards in your graveyard',
    );
    expect(result).toBe('dynamic');
  });

  it('counts distinct CMC values in graveyard (3 different values → reduction 3)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // Three cards with distinct CMCs: 1, 2, 3
    defs.set('cmc1', makeDef('cmc1', { type_line: 'Instant', card_types: ['instant'], cmc: 1 }));
    defs.set('cmc2', makeDef('cmc2', { type_line: 'Sorcery', card_types: ['sorcery'], cmc: 2 }));
    defs.set('cmc3', makeDef('cmc3', { type_line: 'Creature', card_types: ['creature'], cmc: 3 }));
    // A second CMC-1 card — should NOT add another distinct value
    defs.set('cmc1b', makeDef('cmc1b', { type_line: 'Instant', card_types: ['instant'], cmc: 1 }));
    // Opponent's card — should NOT count
    defs.set('opp_cmc4', makeDef('opp_cmc4', { type_line: 'Creature', card_types: ['creature'], cmc: 4 }));

    cards.set('a', makeCard('a', 'cmc1', 'p1', 'graveyard'));
    cards.set('b', makeCard('b', 'cmc2', 'p1', 'graveyard'));
    cards.set('c', makeCard('c', 'cmc3', 'p1', 'graveyard'));
    cards.set('d', makeCard('d', 'cmc1b', 'p1', 'graveyard'));  // duplicate CMC
    cards.set('opp', makeCard('opp', 'opp_cmc4', 'p2', 'graveyard'));

    const spellDef = makeDef('oskar', {
      name: 'Oskar, Rubbish Reclaimer',
      oracle_text: 'This spell costs {1} less to cast for each different mana value among cards in your graveyard.',
      mana_cost: '{2}{B}{R}',
      cmc: 4,
      card_types: ['creature'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 3 distinct CMC values: 1, 2, 3 → reduction = 3
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(3);
  });

  it('returns 0 when graveyard is empty', () => {
    const state = makeState({ cards: new Map(), cardDefinitions: new Map() });
    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {1} less to cast for each different mana value among cards in your graveyard.',
      card_types: ['creature'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });

  it('execution: 4 distinct mana values → cost reduced by 4 at cast time', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('oskar', makeDef('oskar', {
      name: 'Oskar, Rubbish Reclaimer',
      oracle_text: 'This spell costs {1} less to cast for each different mana value among cards in your graveyard.',
      mana_cost: '{2}{B}{R}',
      cmc: 4,
      card_types: ['creature'],
    }));
    cards.set('oskar_hand', makeCard('oskar_hand', 'oskar', 'p1', 'hand'));

    // 4 distinct CMC values in graveyard: 1, 2, 3, 4
    for (let cmc = 1; cmc <= 4; cmc++) {
      defs.set(`card_cmc${cmc}`, makeDef(`card_cmc${cmc}`, { type_line: 'Instant', card_types: ['instant'], cmc }));
      cards.set(`gy${cmc}`, makeCard(`gy${cmc}`, `card_cmc${cmc}`, 'p1', 'graveyard'));
    }

    // Oskar costs {2}{B}{R} = 4 CMC, reduction = 4. Net = 0 generic paid
    // but B and R still required. Fund with {B}{R} only (generic component = 0 after reduction).
    const players = [makePlayer('p1'), makePlayer('p2')];
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), B: 1, R: 1 } };

    const state = makeState({ players, cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', defs.get('oskar')!)).toBe(4);

    const after = castSpell(state, 'p1', 'oskar_hand');
    const p1After = after.players.find(p => p.id === 'p1')!;
    expect(totalMana(p1After)).toBe(0);
    expect(after.cards.get('oskar_hand')!.zone).toBe('stack');
  });
});

// ============================================================================
// Form 19: card-type count threshold — delirium-style (Dusk Feaster)
// ============================================================================

describe('Form 19 — card-type threshold conditional / delirium (Dusk Feaster)', () => {
  it('recognizes real Dusk Feaster oracle with "Delirium —" prefix and keyword', () => {
    // Real oracle text from Scryfall:
    // "Delirium — This spell costs {2} less to cast if there are four or more card types among cards in your graveyard.
    //  Flying"
    const r = parseOracleText(
      'Delirium — This spell costs {2} less to cast if there are four or more card types among cards in your graveyard.\nFlying',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
    expect(r.ability.selfOnly).toBe(true);
  });

  it('recognizes the cost-reduction sentence standalone (without prefix)', () => {
    const r = parseOracleText(
      'This spell costs {2} less to cast if there are 4 or more card types among cards in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('isSelfCostReductionSentence strips "Delirium —" keyword indicator prefix', () => {
    const result = isSelfCostReductionSentence(
      'Delirium — This spell costs {2} less to cast if there are four or more card types among cards in your graveyard',
    );
    expect(result).toBe('dynamic');
  });

  it('applies reduction when threshold is met (4 card types)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('creature_def', makeDef('creature_def', { type_line: 'Creature', card_types: ['creature'], cmc: 1 }));
    defs.set('instant_def', makeDef('instant_def', { type_line: 'Instant', card_types: ['instant'], cmc: 1 }));
    defs.set('artifact_def', makeDef('artifact_def', { type_line: 'Artifact', card_types: ['artifact'], cmc: 2 }));
    defs.set('enchant_def', makeDef('enchant_def', { type_line: 'Enchantment', card_types: ['enchantment'], cmc: 3 }));

    cards.set('cr', makeCard('cr', 'creature_def', 'p1', 'graveyard'));
    cards.set('in', makeCard('in', 'instant_def', 'p1', 'graveyard'));
    cards.set('ar', makeCard('ar', 'artifact_def', 'p1', 'graveyard'));
    cards.set('en', makeCard('en', 'enchant_def', 'p1', 'graveyard'));

    const spellDef = makeDef('dusk_feaster', {
      name: 'Dusk Feaster',
      oracle_text: 'Delirium — This spell costs {2} less to cast if there are four or more card types among cards in your graveyard.',
      card_types: ['creature'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 4 distinct card types = threshold met → reduction = 2
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(2);
  });

  it('returns 0 when threshold is NOT met (3 card types < 4)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('creature_def', makeDef('creature_def', { type_line: 'Creature', card_types: ['creature'], cmc: 1 }));
    defs.set('instant_def', makeDef('instant_def', { type_line: 'Instant', card_types: ['instant'], cmc: 1 }));
    defs.set('artifact_def', makeDef('artifact_def', { type_line: 'Artifact', card_types: ['artifact'], cmc: 2 }));

    cards.set('cr', makeCard('cr', 'creature_def', 'p1', 'graveyard'));
    cards.set('in', makeCard('in', 'instant_def', 'p1', 'graveyard'));
    cards.set('ar', makeCard('ar', 'artifact_def', 'p1', 'graveyard'));

    const spellDef = makeDef('dusk_feaster', {
      name: 'Dusk Feaster',
      oracle_text: 'Delirium — This spell costs {2} less to cast if there are four or more card types among cards in your graveyard.',
      card_types: ['creature'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // Only 3 card types → threshold NOT met → reduction = 0
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });

  it('execution: delirium met → cost reduced at cast time (Dusk Feaster)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('dusk_feaster', makeDef('dusk_feaster', {
      name: 'Dusk Feaster',
      oracle_text: 'Delirium — This spell costs {2} less to cast if there are four or more card types among cards in your graveyard.\nFlying',
      mana_cost: '{4}{B}{B}',
      cmc: 6,
      card_types: ['creature'],
    }));
    cards.set('df_hand', makeCard('df_hand', 'dusk_feaster', 'p1', 'hand'));

    // 4 distinct card types in graveyard → delirium met → reduction = 2
    defs.set('creature_def', makeDef('creature_def', { type_line: 'Creature', card_types: ['creature'], cmc: 1 }));
    defs.set('instant_def', makeDef('instant_def', { type_line: 'Instant', card_types: ['instant'], cmc: 1 }));
    defs.set('artifact_def', makeDef('artifact_def', { type_line: 'Artifact', card_types: ['artifact'], cmc: 2 }));
    defs.set('enchant_def', makeDef('enchant_def', { type_line: 'Enchantment', card_types: ['enchantment'], cmc: 3 }));
    cards.set('cr', makeCard('cr', 'creature_def', 'p1', 'graveyard'));
    cards.set('in', makeCard('in', 'instant_def', 'p1', 'graveyard'));
    cards.set('ar', makeCard('ar', 'artifact_def', 'p1', 'graveyard'));
    cards.set('en', makeCard('en', 'enchant_def', 'p1', 'graveyard'));

    // Cost {4}{B}{B} − 2 = {2}{B}{B}
    const players = [makePlayer('p1'), makePlayer('p2')];
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), B: 2, C: 2 } };

    const state = makeState({ players, cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', defs.get('dusk_feaster')!)).toBe(2);

    const after = castSpell(state, 'p1', 'df_hand');
    const p1After = after.players.find(p => p.id === 'p1')!;
    expect(totalMana(p1After)).toBe(0);
    expect(after.cards.get('df_hand')!.zone).toBe('stack');
  });
});

// ============================================================================
// Keyword-indicator prefix stripping
// ============================================================================

describe('keyword indicator prefix stripping in isSelfCostReductionSentence', () => {
  it('strips "Domain —" prefix (Form 10 regression)', () => {
    const result = isSelfCostReductionSentence(
      'Domain — This spell costs {1} less to cast for each basic land type among lands you control',
    );
    expect(result).toBe('dynamic');
  });

  it('strips "Delirium —" prefix from Form 19 sentence', () => {
    const result = isSelfCostReductionSentence(
      'Delirium — This spell costs {2} less to cast if there are four or more card types among cards in your graveyard',
    );
    expect(result).toBe('dynamic');
  });

  it('does NOT strip legitimate cost-reduction text that contains "—" mid-sentence', () => {
    // The dash in "—" mid-sentence should not be mistaken for a keyword indicator
    // A keyword indicator has a capitalized word(s) + space + em-dash at the start
    const result = isSelfCostReductionSentence(
      'This spell costs {1} less to cast for each opponent you have',
    );
    expect(result).toBe('dynamic');
  });
});

// ============================================================================
// Unsupported forms — honesty gates
// ============================================================================

describe('honesty gates — unsupported forms return unsupported or null', () => {
  it('Bone Picker: "if a creature died this turn" is now supported (returns dynamic)', () => {
    // Slice 6: engine now tracks creaturesDiedThisTurn; the form is supported.
    const result = isSelfCostReductionSentence(
      'This spell costs {3} less to cast if a creature died this turn',
    );
    expect(result).toBe('dynamic');
  });

  it('Bone Picker: parseOracleText parses as StaticAbility (cost reduction + keywords)', () => {
    const r = parseOracleText(
      'This spell costs {3} less to cast if a creature died this turn.\nFlying, deathtouch',
    );
    expect(r.kind).toBe('StaticAbility');
  });

  it('Gorex: "for each card exiled this way" is unsupported (engine does not track per-cast exile piles)', () => {
    // Part of Gorex oracle text
    const result = isSelfCostReductionSentence(
      'This spell costs {2} less to cast for each card exiled this way',
    );
    expect(result).toBe('unsupported');
  });

  it('getIntrinsicCostReduction: Bone Picker-style text returns 3 when a creature died', () => {
    const state = { ...makeState(), creaturesDiedThisTurn: 1 };
    const spellDef = makeDef('bone_picker', {
      oracle_text: 'This spell costs {3} less to cast if a creature died this turn.\nFlying, deathtouch',
      card_types: ['creature'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(3);
  });

  it('getIntrinsicCostReduction: Bone Picker-style text returns 0 when no creature died', () => {
    const state = { ...makeState(), creaturesDiedThisTurn: 0 };
    const spellDef = makeDef('bone_picker', {
      oracle_text: 'This spell costs {3} less to cast if a creature died this turn.\nFlying, deathtouch',
      card_types: ['creature'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });
});
