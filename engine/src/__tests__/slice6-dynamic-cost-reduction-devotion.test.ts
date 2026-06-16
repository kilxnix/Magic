/**
 * Oracle-parser coverage — Slice 6/12 (round-8 cut):
 * Dynamic self-cost-reduction via devotion "where X" form.
 *
 * Form 36: "This spell costs {X} less to cast, where X is your devotion to <color(s)>"
 *   Daybreak Chimera:  "This spell costs {X} less to cast, where X is your devotion to white."
 *   Callaphe, Beloved of the Sea: "This spell costs {X} less to cast, where X is your devotion to blue."
 *   Graveyard Trespasser: "… your devotion to black."
 *
 * Form 37 (unsupported gate): "where X is the total amount of noncombat damage dealt to
 *   your opponents this turn" (Chandra's Incinerator) — engine cannot track noncombat
 *   damage per turn; declined as 'unsupported' so the face remains Unparsed honestly.
 *
 * Tests cover:
 *   - isSelfCostReductionSentence recognition (parse)
 *   - getIntrinsicCostReduction enforcement at cast time (executor)
 *   - Multi-color devotion forms (e.g. "devotion to white and blue")
 *   - Chandra's Incinerator stays Unparsed (honesty gate)
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

function makeState(
  cards: Map<string, CardInstance>,
  defs: Map<string, CardDefinition>,
  overrides: Partial<GameState> = {},
): GameState {
  return {
    players: overrides.players || [makePlayer('p1'), makePlayer('p2')],
    cards,
    cardDefinitions: defs,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as GameState['phase'],
    step: 'main' as GameState['step'],
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: [],
    ...overrides,
  };
}

// ============================================================================
// Form 36 — Parser recognition
// ============================================================================

describe('Form 36 — "where X is your devotion to <color>" — isSelfCostReductionSentence', () => {
  it('returns dynamic for single-color devotion (white)', () => {
    const result = isSelfCostReductionSentence(
      'This spell costs {X} less to cast, where X is your devotion to white',
    );
    expect(result).toBe('dynamic');
  });

  it('returns dynamic for single-color devotion (blue)', () => {
    const result = isSelfCostReductionSentence(
      'This spell costs {X} less to cast, where X is your devotion to blue',
    );
    expect(result).toBe('dynamic');
  });

  it('returns dynamic for single-color devotion (black)', () => {
    const result = isSelfCostReductionSentence(
      'This spell costs {X} less to cast, where X is your devotion to black',
    );
    expect(result).toBe('dynamic');
  });

  it('returns dynamic for single-color devotion (red)', () => {
    const result = isSelfCostReductionSentence(
      'This spell costs {X} less to cast, where X is your devotion to red',
    );
    expect(result).toBe('dynamic');
  });

  it('returns dynamic for single-color devotion (green)', () => {
    const result = isSelfCostReductionSentence(
      'This spell costs {X} less to cast, where X is your devotion to green',
    );
    expect(result).toBe('dynamic');
  });

  it('returns dynamic for multi-color devotion (white and blue)', () => {
    const result = isSelfCostReductionSentence(
      'This spell costs {X} less to cast, where X is your devotion to white and blue',
    );
    expect(result).toBe('dynamic');
  });

  it('returns dynamic without comma before "where" (Daybreak Chimera real wording)', () => {
    // Some printings omit the comma: "costs {X} less to cast where X is your devotion to white"
    const result = isSelfCostReductionSentence(
      'This spell costs {X} less to cast where X is your devotion to white',
    );
    expect(result).toBe('dynamic');
  });

  it('returns null for non-cost-reduction sentence', () => {
    expect(isSelfCostReductionSentence('Flying')).toBeNull();
    expect(isSelfCostReductionSentence('When this creature enters, draw a card')).toBeNull();
  });
});

// ============================================================================
// Form 36 — parseOracleText recognition
// ============================================================================

describe('Form 36 — parseOracleText recognition', () => {
  it('Daybreak Chimera oracle: "costs {X} less … devotion to white. Flying." parses as StaticAbility', () => {
    // Real Daybreak Chimera oracle (simplified):
    const r = parseOracleText(
      'This spell costs {X} less to cast, where X is your devotion to white.\nFlying',
    );
    expect(r.kind).toBe('StaticAbility');
  });

  it('Callaphe oracle: "costs {X} less … devotion to blue. Flying." parses as StaticAbility', () => {
    const r = parseOracleText(
      'This spell costs {X} less to cast, where X is your devotion to blue.\nFlying',
    );
    expect(r.kind).toBe('StaticAbility');
  });

  it('Standalone devotion cost reduction with no other text parses as StaticAbility', () => {
    const r = parseOracleText(
      'This spell costs {X} less to cast, where X is your devotion to green.',
    );
    expect(r.kind).toBe('StaticAbility');
  });
});

// ============================================================================
// Form 36 — getIntrinsicCostReduction enforcement
// ============================================================================

describe('Form 36 — getIntrinsicCostReduction — single-color white devotion (Daybreak Chimera)', () => {
  const daybreakChimeraDef = makeDef('daybreak_chimera', {
    oracle_text: 'This spell costs {X} less to cast, where X is your devotion to white.\nFlying',
    card_types: ['creature'],
    colors: ['W'],
    mana_cost: '{2}{W}{W}',
  });

  it('returns 0 when no white permanents are on the battlefield', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>([['daybreak_chimera', daybreakChimeraDef]]);
    const state = makeState(cards, defs);
    expect(getIntrinsicCostReduction(state, 'p1', daybreakChimeraDef)).toBe(0);
  });

  it('counts white mana symbols among permanents controlled by caster', () => {
    // One white permanent with {W} in its mana cost = 1 devotion
    const cards = new Map<string, CardInstance>([
      ['w1', makeCard('w1', 'plains_def', 'p1', 'battlefield')],
    ]);
    const defs = new Map<string, CardDefinition>([
      ['daybreak_chimera', daybreakChimeraDef],
      ['plains_def', makeDef('plains_def', { mana_cost: '{W}', card_types: ['land'] })],
    ]);
    const state = makeState(cards, defs);
    expect(getIntrinsicCostReduction(state, 'p1', daybreakChimeraDef)).toBe(1);
  });

  it('counts multiple white mana symbols across multiple permanents', () => {
    // Two permanents each with one {W} symbol = devotion 2
    const cards = new Map<string, CardInstance>([
      ['w1', makeCard('w1', 'white1', 'p1', 'battlefield')],
      ['w2', makeCard('w2', 'white2', 'p1', 'battlefield')],
    ]);
    const defs = new Map<string, CardDefinition>([
      ['daybreak_chimera', daybreakChimeraDef],
      ['white1', makeDef('white1', { mana_cost: '{1}{W}', card_types: ['creature'] })],
      ['white2', makeDef('white2', { mana_cost: '{W}{W}', card_types: ['creature'] })],
    ]);
    const state = makeState(cards, defs);
    // white1 contributes 1, white2 contributes 2 → total 3
    expect(getIntrinsicCostReduction(state, 'p1', daybreakChimeraDef)).toBe(3);
  });

  it('does NOT count permanents controlled by the opponent', () => {
    const cards = new Map<string, CardInstance>([
      ['opp_w', makeCard('opp_w', 'opp_white', 'p2', 'battlefield')],
    ]);
    const defs = new Map<string, CardDefinition>([
      ['daybreak_chimera', daybreakChimeraDef],
      ['opp_white', makeDef('opp_white', { mana_cost: '{W}{W}{W}', card_types: ['creature'] })],
    ]);
    const state = makeState(cards, defs);
    // Opponent has 3 white symbols but they don't count toward caster's devotion
    expect(getIntrinsicCostReduction(state, 'p1', daybreakChimeraDef)).toBe(0);
  });

  it('does NOT count non-white symbols toward white devotion', () => {
    const cards = new Map<string, CardInstance>([
      ['blue1', makeCard('blue1', 'blue_def', 'p1', 'battlefield')],
    ]);
    const defs = new Map<string, CardDefinition>([
      ['daybreak_chimera', daybreakChimeraDef],
      ['blue_def', makeDef('blue_def', { mana_cost: '{1}{U}{U}', card_types: ['creature'] })],
    ]);
    const state = makeState(cards, defs);
    expect(getIntrinsicCostReduction(state, 'p1', daybreakChimeraDef)).toBe(0);
  });
});

describe('Form 36 — getIntrinsicCostReduction — blue devotion (Callaphe)', () => {
  const callapheDef = makeDef('callaphe', {
    oracle_text: 'This spell costs {X} less to cast, where X is your devotion to blue.\nFlying',
    card_types: ['creature'],
    colors: ['U'],
    mana_cost: '{2}{U}',
  });

  it('counts blue mana symbols correctly', () => {
    const cards = new Map<string, CardInstance>([
      ['u1', makeCard('u1', 'blue1', 'p1', 'battlefield')],
      ['u2', makeCard('u2', 'blue2', 'p1', 'battlefield')],
    ]);
    const defs = new Map<string, CardDefinition>([
      ['callaphe', callapheDef],
      ['blue1', makeDef('blue1', { mana_cost: '{U}{U}', card_types: ['creature'] })],
      ['blue2', makeDef('blue2', { mana_cost: '{1}{U}', card_types: ['enchantment'] })],
    ]);
    const state = makeState(cards, defs);
    // blue1 contributes 2, blue2 contributes 1 → total 3
    expect(getIntrinsicCostReduction(state, 'p1', callapheDef)).toBe(3);
  });
});

describe('Form 36 — getIntrinsicCostReduction — multi-color devotion', () => {
  it('counts both color symbols for white and blue devotion form', () => {
    const dualDevotionDef = makeDef('dual_devotion', {
      oracle_text: 'This spell costs {X} less to cast, where X is your devotion to white and blue.',
      card_types: ['creature'],
    });

    const cards = new Map<string, CardInstance>([
      ['perm1', makeCard('perm1', 'wu_def', 'p1', 'battlefield')],
    ]);
    const defs = new Map<string, CardDefinition>([
      ['dual_devotion', dualDevotionDef],
      // {W}{U} has 2 colored mana symbols for white+blue devotion
      ['wu_def', makeDef('wu_def', { mana_cost: '{W}{U}', card_types: ['creature'] })],
    ]);
    const state = makeState(cards, defs);
    expect(getIntrinsicCostReduction(state, 'p1', dualDevotionDef)).toBe(2);
  });
});

// ============================================================================
// Form 37 — Honesty gate: noncombat damage form (Chandra's Incinerator)
// ============================================================================

describe("Form 37 — Chandra's Incinerator noncombat damage form is declined as unsupported", () => {
  it('isSelfCostReductionSentence returns unsupported for noncombat damage wording', () => {
    const result = isSelfCostReductionSentence(
      "This spell costs {X} less to cast, where X is the total amount of noncombat damage dealt to your opponents this turn",
    );
    expect(result).toBe('unsupported');
  });

  it("parseOracleText returns Unparsed for Chandra's Incinerator (honesty gate)", () => {
    // Chandra's Incinerator: "This spell costs {X} less to cast, where X is the total amount of
    // noncombat damage dealt to your opponents this turn. Trample …"
    const r = parseOracleText(
      "This spell costs {X} less to cast, where X is the total amount of noncombat damage dealt to your opponents this turn.\nTrample\nWhenever a source you control deals noncombat damage to your opponents, Chandra's Incinerator deals that much damage to any target.",
    );
    expect(r.kind).toBe('Unparsed');
  });

  it('Even a standalone noncombat damage cost-reduction stays Unparsed', () => {
    const r = parseOracleText(
      "This spell costs {X} less to cast, where X is the total amount of noncombat damage dealt to your opponents this turn.",
    );
    // The face has only an unsupported cost reduction — matchSelfCostReduction declines it.
    expect(r.kind).toBe('Unparsed');
  });
});
