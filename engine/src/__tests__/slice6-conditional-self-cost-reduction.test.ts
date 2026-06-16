/**
 * Slice 6/12 — Conditional self-cost-reduction: condition forms
 *
 * Covers Forms 20-21 added to getIntrinsicCostReduction and
 * isSelfCostReductionSentence:
 *
 *  20. "if a creature died this turn" (Purple Worm, Bone Picker)
 *      Backed by state.creaturesDiedThisTurn (incremented by state-based.ts,
 *      reset to 0 by turn-manager.ts nextTurn).
 *
 *  21. "if your opponents control N or more creatures" (Lashwhip Predator)
 *      Counts opponents' battlefield creatures collectively.
 *
 * Form 16 (CMC conditional) already handles "if you control a permanent with
 * mana value 4 or greater" (Terrific Team-Up) and is tested in slice5.
 *
 * Each section: parser recognition + getIntrinsicCostReduction enforcement.
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

function makeCard(instanceId: string, definitionId: string, ownerId: string, zone = 'battlefield' as const): CardInstance {
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
// Form 20: "if a creature died this turn" — Bone Picker / Purple Worm
// ============================================================================

describe('Form 20 — "if a creature died this turn" (Bone Picker / Purple Worm)', () => {
  // ── Parser recognition ──────────────────────────────────────────────────────

  it('isSelfCostReductionSentence returns dynamic for "if a creature died this turn"', () => {
    const result = isSelfCostReductionSentence(
      'This spell costs {3} less to cast if a creature died this turn',
    );
    expect(result).toBe('dynamic');
  });

  it('Bone Picker full oracle: parseOracleText recognizes as StaticAbility', () => {
    // Real Bone Picker oracle text (simplified): cost-reduction + flying + deathtouch
    const r = parseOracleText(
      'This spell costs {3} less to cast if a creature died this turn.\nFlying, deathtouch',
    );
    expect(r.kind).toBe('StaticAbility');
  });

  it('Purple Worm-style cost-reduction-only line: parseOracleText recognizes as StaticAbility', () => {
    // A card whose only non-keyword text is the died-this-turn reduction
    const r = parseOracleText(
      'This spell costs {3} less to cast if a creature died this turn.\nTrailblazer',
    );
    // Trailblazer is not a recognized keyword so this will be Unparsed;
    // but the pure cost-line alone parses:
    const r2 = parseOracleText(
      'This spell costs {3} less to cast if a creature died this turn.',
    );
    expect(r2.kind).toBe('StaticAbility');
  });

  it('reduction with {1} amount also recognized as dynamic', () => {
    const result = isSelfCostReductionSentence(
      'This spell costs {1} less to cast if a creature died this turn',
    );
    expect(result).toBe('dynamic');
  });

  // ── Runtime enforcement ─────────────────────────────────────────────────────

  it('getIntrinsicCostReduction returns full reduction when creaturesDiedThisTurn > 0', () => {
    const state = makeState({ creaturesDiedThisTurn: 1 });
    const spellDef = makeDef('bone_picker', {
      oracle_text: 'This spell costs {3} less to cast if a creature died this turn.\nFlying, deathtouch',
      card_types: ['creature'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(3);
  });

  it('getIntrinsicCostReduction returns 0 when creaturesDiedThisTurn is 0', () => {
    const state = makeState({ creaturesDiedThisTurn: 0 });
    const spellDef = makeDef('bone_picker', {
      oracle_text: 'This spell costs {3} less to cast if a creature died this turn.\nFlying, deathtouch',
      card_types: ['creature'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });

  it('getIntrinsicCostReduction returns 0 when creaturesDiedThisTurn is undefined (not set)', () => {
    // Fresh state has no creaturesDiedThisTurn field yet
    const state = makeState();
    const spellDef = makeDef('bone_picker', {
      oracle_text: 'This spell costs {3} less to cast if a creature died this turn.\nFlying, deathtouch',
      card_types: ['creature'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });

  it('getIntrinsicCostReduction applies reduction for multiple deaths (> 0 still means full reduction)', () => {
    const state = makeState({ creaturesDiedThisTurn: 5 });
    const spellDef = makeDef('purple_worm', {
      oracle_text: 'This spell costs {3} less to cast if a creature died this turn.',
      card_types: ['creature'],
    });
    // Reduction is a flat {3} — number of deaths beyond 1 does not increase it
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(3);
  });
});

// ============================================================================
// Form 21: "if your opponents control N or more creatures" — Lashwhip Predator
// ============================================================================

describe('Form 21 — "if your opponents control N or more creatures" (Lashwhip Predator)', () => {
  // ── Parser recognition ──────────────────────────────────────────────────────

  it('isSelfCostReductionSentence returns dynamic for opponent-controls-at-least form', () => {
    const result = isSelfCostReductionSentence(
      'This spell costs {2} less to cast if your opponents control three or more creatures',
    );
    expect(result).toBe('dynamic');
  });

  it('parseOracleText recognizes Lashwhip Predator-style standalone as StaticAbility', () => {
    const r = parseOracleText(
      'This spell costs {2} less to cast if your opponents control three or more creatures.',
    );
    expect(r.kind).toBe('StaticAbility');
  });

  it('isSelfCostReductionSentence dynamic for singular "opponent" spelling', () => {
    const result = isSelfCostReductionSentence(
      'This spell costs {2} less to cast if your opponent controls three or more creatures',
    );
    expect(result).toBe('dynamic');
  });

  it('isSelfCostReductionSentence dynamic for numeric threshold form', () => {
    const result = isSelfCostReductionSentence(
      'This spell costs {1} less to cast if your opponents control 4 or more creatures',
    );
    expect(result).toBe('dynamic');
  });

  // ── Runtime enforcement ─────────────────────────────────────────────────────

  it('getIntrinsicCostReduction returns reduction when opponents collectively meet threshold', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // Opponent (p2) controls 3 creatures
    for (let i = 1; i <= 3; i++) {
      const defId = `opp_creature_${i}`;
      defs.set(defId, makeDef(defId, { type_line: 'Creature', card_types: ['creature'] }));
      cards.set(`opp_c${i}`, makeCard(`opp_c${i}`, defId, 'p2'));
    }

    const state = makeState({ cards, cardDefinitions: defs });
    const spellDef = makeDef('lashwhip_predator', {
      oracle_text: 'This spell costs {2} less to cast if your opponents control three or more creatures.',
      card_types: ['creature'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(2);
  });

  it('getIntrinsicCostReduction returns 0 when opponents are below threshold', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // Opponent (p2) controls only 2 creatures — below the threshold of 3
    for (let i = 1; i <= 2; i++) {
      const defId = `opp_creature_${i}`;
      defs.set(defId, makeDef(defId, { type_line: 'Creature', card_types: ['creature'] }));
      cards.set(`opp_c${i}`, makeCard(`opp_c${i}`, defId, 'p2'));
    }

    const state = makeState({ cards, cardDefinitions: defs });
    const spellDef = makeDef('lashwhip_predator', {
      oracle_text: 'This spell costs {2} less to cast if your opponents control three or more creatures.',
      card_types: ['creature'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });

  it('getIntrinsicCostReduction does not count caster own creatures toward threshold', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // Caster (p1) controls 5 creatures, opponent (p2) controls 0
    for (let i = 1; i <= 5; i++) {
      const defId = `my_creature_${i}`;
      defs.set(defId, makeDef(defId, { type_line: 'Creature', card_types: ['creature'] }));
      cards.set(`my_c${i}`, makeCard(`my_c${i}`, defId, 'p1'));
    }

    const state = makeState({ cards, cardDefinitions: defs });
    const spellDef = makeDef('lashwhip_predator', {
      oracle_text: 'This spell costs {2} less to cast if your opponents control three or more creatures.',
      card_types: ['creature'],
    });
    // Caster's own creatures don't count — threshold unmet
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });

  it('getIntrinsicCostReduction counts across multiple opponents (multiplayer)', () => {
    const players = [makePlayer('p1'), makePlayer('p2'), makePlayer('p3')];
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // p2 has 2 creatures, p3 has 1 creature — total 3 meets threshold
    for (let i = 1; i <= 2; i++) {
      const defId = `p2_c${i}`;
      defs.set(defId, makeDef(defId, { type_line: 'Creature', card_types: ['creature'] }));
      cards.set(defId, makeCard(defId, defId, 'p2'));
    }
    const p3DefId = 'p3_c1';
    defs.set(p3DefId, makeDef(p3DefId, { type_line: 'Creature', card_types: ['creature'] }));
    cards.set(p3DefId, makeCard(p3DefId, p3DefId, 'p3'));

    const state = makeState({ players, cards, cardDefinitions: defs });
    const spellDef = makeDef('lashwhip_predator', {
      oracle_text: 'This spell costs {2} less to cast if your opponents control three or more creatures.',
      card_types: ['creature'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(2);
  });
});

// ============================================================================
// Form 16 (pre-existing): Terrific Team-Up CMC conditional
// ============================================================================

describe('Form 16 — "if you control a permanent with mana value N or greater" (Terrific Team-Up)', () => {
  it('isSelfCostReductionSentence returns dynamic for CMC conditional form', () => {
    const result = isSelfCostReductionSentence(
      'This spell costs {2} less to cast if you control a permanent with mana value 4 or greater',
    );
    expect(result).toBe('dynamic');
  });

  it('getIntrinsicCostReduction applies reduction when permanent meets CMC threshold', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // A 5-CMC permanent
    defs.set('big', makeDef('big', { type_line: 'Creature', card_types: ['creature'], cmc: 5 }));
    cards.set('big_inst', makeCard('big_inst', 'big', 'p1'));

    const state = makeState({ cards, cardDefinitions: defs });
    const spellDef = makeDef('terrific', {
      oracle_text: 'This spell costs {2} less to cast if you control a permanent with mana value 4 or greater.',
      card_types: ['instant'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(2);
  });

  it('getIntrinsicCostReduction returns 0 when no permanent meets CMC threshold', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // Only a 2-CMC permanent
    defs.set('small', makeDef('small', { type_line: 'Creature', card_types: ['creature'], cmc: 2 }));
    cards.set('small_inst', makeCard('small_inst', 'small', 'p1'));

    const state = makeState({ cards, cardDefinitions: defs });
    const spellDef = makeDef('terrific', {
      oracle_text: 'This spell costs {2} less to cast if you control a permanent with mana value 4 or greater.',
      card_types: ['instant'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });
});
