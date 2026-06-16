/**
 * Slice 5/12 — Self cost-reduction: target-quality and combat-state conditional forms
 *
 * Covers Forms 22-26 added to getIntrinsicCostReduction and
 * isSelfCostReductionSentence, plus the Form 17 extension to accept
 * spelled-out number thresholds (Octavia, Living Thesis):
 *
 *  17 (ext). "if you have eight or more instant and/or sorcery cards in your graveyard"
 *            Octavia, Living Thesis — spelled-out threshold now supported.
 *
 *  22. "if it targets a tapped creature" (Fate of the Sun-Cryst)
 *      Evaluated when targets are passed to getIntrinsicCostReduction.
 *
 *  23. "if it targets a legendary creature you control" (Animist's Might)
 *      Checked against type line supertype and controller.
 *
 *  24. "if it targets an attacking creature" (Run Behind)
 *      Checked against state.combat.attackers.
 *
 *  25. "if a creature is attacking you" (Swat Away)
 *      Evaluable from combat state alone (no target lookup).
 *
 *  26. Exile+graveyard union for-each (Sailors' Bane):
 *      "for each card you own in exile and in your graveyard that's an instant card,
 *       a sorcery card, or a card that has an Adventure"
 *
 * SKIPPED (lifeGainedThisTurn tracker does not exist in GameState):
 *   "if you gained life this turn" (Mortality Spear)
 *
 * Each section: parser recognition + getIntrinsicCostReduction enforcement.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { isSelfCostReductionSentence } from '../effects/matchers/static-abilities';
import { getIntrinsicCostReduction } from '../effects/continuous';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player, CombatState } from '../types';

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
  extra: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    ...extra,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name || id,
    type_line: opts.type_line || 'Creature',
    oracle_text: opts.oracle_text || '',
    mana_cost: opts.mana_cost || '{3}',
    cmc: opts.cmc ?? 3,
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
    combat: overrides.combat ?? null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: overrides.continuousEffects || [],
    ...overrides,
  };
}

// ============================================================================
// Form 17 extension: spelled-out threshold (Octavia, Living Thesis)
// ============================================================================

describe('Form 17 extension — spelled-out graveyard count threshold (Octavia)', () => {
  const OCTAVIA_ORACLE =
    'This spell costs {8} less to cast if you have eight or more instant and/or sorcery cards in your graveyard. Ward {8} Magecraft — Whenever you cast or copy an instant or sorcery spell, target creature has base power and toughness 8/8 until end of turn.';

  it('isSelfCostReductionSentence returns dynamic for "if you have eight or more instant and/or sorcery cards"', () => {
    const r = isSelfCostReductionSentence(
      'This spell costs {8} less to cast if you have eight or more instant and/or sorcery cards in your graveyard',
    );
    expect(r).toBe('dynamic');
  });

  it('parseOracleText recognizes the Octavia cost-reduction line as a dynamic StaticAbility', () => {
    const r = parseOracleText(
      'This spell costs {8} less to cast if you have eight or more instant and/or sorcery cards in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('getIntrinsicCostReduction returns 8 when exactly 8 instant/sorcery cards are in graveyard', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();
    defs.set('bolt', makeDef('bolt', { type_line: 'Instant', card_types: ['instant'] }));
    for (let i = 0; i < 8; i++) {
      cards.set(`bolt_gy${i}`, makeCard(`bolt_gy${i}`, 'bolt', 'p1', 'graveyard'));
    }
    const spellDef = makeDef('octavia', {
      oracle_text: OCTAVIA_ORACLE,
      mana_cost: '{6}{U}{U}', cmc: 8, card_types: ['creature'],
    });
    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(8);
  });

  it('getIntrinsicCostReduction returns 0 when only 7 instant/sorcery cards are in graveyard', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();
    defs.set('bolt', makeDef('bolt', { type_line: 'Instant', card_types: ['instant'] }));
    for (let i = 0; i < 7; i++) {
      cards.set(`bolt_gy${i}`, makeCard(`bolt_gy${i}`, 'bolt', 'p1', 'graveyard'));
    }
    const spellDef = makeDef('octavia', {
      oracle_text: OCTAVIA_ORACLE,
      card_types: ['creature'],
    });
    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });
});

// ============================================================================
// Form 22: "if it targets a tapped creature" (Fate of the Sun-Cryst)
// ============================================================================

describe('Form 22 — "if it targets a tapped creature" (Fate of the Sun-Cryst)', () => {
  const FATE_ORACLE =
    'This spell costs {2} less to cast if it targets a tapped creature. Destroy target nonland permanent.';

  it('isSelfCostReductionSentence returns dynamic', () => {
    const r = isSelfCostReductionSentence(
      'This spell costs {2} less to cast if it targets a tapped creature',
    );
    expect(r).toBe('dynamic');
  });

  it('getIntrinsicCostReduction returns 2 when a tapped target is given', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();
    defs.set('bear', makeDef('bear', { type_line: 'Creature — Bear', card_types: ['creature'] }));
    cards.set('bear1', makeCard('bear1', 'bear', 'p2', 'battlefield', { tapped: true }));

    const spellDef = makeDef('fate', {
      oracle_text: FATE_ORACLE,
      card_types: ['instant'], type_line: 'Instant',
    });
    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef, ['bear1'])).toBe(2);
  });

  it('getIntrinsicCostReduction returns 0 when the target is untapped', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();
    defs.set('bear', makeDef('bear', { type_line: 'Creature — Bear', card_types: ['creature'] }));
    cards.set('bear1', makeCard('bear1', 'bear', 'p2', 'battlefield', { tapped: false }));

    const spellDef = makeDef('fate', {
      oracle_text: FATE_ORACLE,
      card_types: ['instant'], type_line: 'Instant',
    });
    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef, ['bear1'])).toBe(0);
  });

  it('getIntrinsicCostReduction returns 0 when no targets are passed', () => {
    const spellDef = makeDef('fate', {
      oracle_text: FATE_ORACLE,
      card_types: ['instant'], type_line: 'Instant',
    });
    const state = makeState();
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });
});

// ============================================================================
// Form 23: "if it targets a legendary creature you control" (Animist's Might)
// ============================================================================

describe('Form 23 — "if it targets a legendary creature you control" (Animist\'s Might)', () => {
  const ANIMIST_ORACLE =
    "This spell costs {2} less to cast if it targets a legendary creature you control. Target creature you control deals damage equal to twice its power to target creature or planeswalker you don't control.";

  it('isSelfCostReductionSentence returns dynamic', () => {
    const r = isSelfCostReductionSentence(
      "This spell costs {2} less to cast if it targets a legendary creature you control",
    );
    expect(r).toBe('dynamic');
  });

  it('getIntrinsicCostReduction returns 2 when targeting your legendary creature', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();
    defs.set('legend', makeDef('legend', {
      type_line: 'Legendary Creature — Dragon',
      card_types: ['creature'],
    }));
    cards.set('leg1', makeCard('leg1', 'legend', 'p1', 'battlefield'));

    const spellDef = makeDef('animist', {
      oracle_text: ANIMIST_ORACLE,
      card_types: ['sorcery'], type_line: 'Sorcery',
    });
    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef, ['leg1'])).toBe(2);
  });

  it('getIntrinsicCostReduction returns 0 when targeting an opponent\'s legendary creature', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();
    defs.set('legend', makeDef('legend', {
      type_line: 'Legendary Creature — Dragon',
      card_types: ['creature'],
    }));
    cards.set('leg1', makeCard('leg1', 'legend', 'p2', 'battlefield')); // p2, not p1

    const spellDef = makeDef('animist', {
      oracle_text: ANIMIST_ORACLE,
      card_types: ['sorcery'], type_line: 'Sorcery',
    });
    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef, ['leg1'])).toBe(0);
  });

  it('getIntrinsicCostReduction returns 0 when targeting a non-legendary creature you control', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();
    defs.set('bear', makeDef('bear', {
      type_line: 'Creature — Bear', card_types: ['creature'],
    }));
    cards.set('bear1', makeCard('bear1', 'bear', 'p1', 'battlefield'));

    const spellDef = makeDef('animist', {
      oracle_text: ANIMIST_ORACLE,
      card_types: ['sorcery'], type_line: 'Sorcery',
    });
    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef, ['bear1'])).toBe(0);
  });
});

// ============================================================================
// Form 24: "if it targets an attacking creature" (Run Behind)
// ============================================================================

describe('Form 24 — "if it targets an attacking creature" (Run Behind)', () => {
  const RUN_BEHIND_ORACLE =
    "This spell costs {1} less to cast if it targets an attacking creature. Target creature's owner puts it on their choice of the top or bottom of their library.";

  const makeCombat = (attackerIds: string[], defenderId = 'p1'): CombatState => ({
    attackers: attackerIds.map(id => ({ cardInstanceId: id, defendingPlayerId: defenderId })),
    blockers: [],
    damageAssignment: new Map(),
  });

  it('isSelfCostReductionSentence returns dynamic', () => {
    const r = isSelfCostReductionSentence(
      'This spell costs {1} less to cast if it targets an attacking creature',
    );
    expect(r).toBe('dynamic');
  });

  it('getIntrinsicCostReduction returns 1 when targeting an attacker', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();
    defs.set('wolf', makeDef('wolf', { type_line: 'Creature — Wolf', card_types: ['creature'] }));
    cards.set('wolf1', makeCard('wolf1', 'wolf', 'p2', 'battlefield'));

    const spellDef = makeDef('run_behind', {
      oracle_text: RUN_BEHIND_ORACLE,
      card_types: ['instant'], type_line: 'Instant',
    });
    const state = makeState({
      cards, cardDefinitions: defs,
      combat: makeCombat(['wolf1'], 'p1'),
      phase: 'combat' as any, step: 'declare_blockers' as any,
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef, ['wolf1'])).toBe(1);
  });

  it('getIntrinsicCostReduction returns 0 when target is not attacking', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();
    defs.set('wolf', makeDef('wolf', { type_line: 'Creature — Wolf', card_types: ['creature'] }));
    cards.set('wolf1', makeCard('wolf1', 'wolf', 'p2', 'battlefield'));
    cards.set('wolf2', makeCard('wolf2', 'wolf', 'p2', 'battlefield'));

    const spellDef = makeDef('run_behind', {
      oracle_text: RUN_BEHIND_ORACLE,
      card_types: ['instant'], type_line: 'Instant',
    });
    const state = makeState({
      cards, cardDefinitions: defs,
      combat: makeCombat(['wolf1'], 'p1'), // wolf1 attacks, wolf2 does not
      phase: 'combat' as any, step: 'declare_blockers' as any,
    });
    // Target wolf2 (not attacking) — no reduction
    expect(getIntrinsicCostReduction(state, 'p1', spellDef, ['wolf2'])).toBe(0);
  });

  it('getIntrinsicCostReduction returns 0 when no combat is active', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();
    defs.set('wolf', makeDef('wolf', { type_line: 'Creature — Wolf', card_types: ['creature'] }));
    cards.set('wolf1', makeCard('wolf1', 'wolf', 'p2', 'battlefield'));

    const spellDef = makeDef('run_behind', {
      oracle_text: RUN_BEHIND_ORACLE,
      card_types: ['instant'], type_line: 'Instant',
    });
    const state = makeState({ cards, cardDefinitions: defs, combat: null });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef, ['wolf1'])).toBe(0);
  });
});

// ============================================================================
// Form 25: "if a creature is attacking you" (Swat Away)
// ============================================================================

describe('Form 25 — "if a creature is attacking you" (Swat Away)', () => {
  const SWAT_AWAY_ORACLE =
    "This spell costs {2} less to cast if a creature is attacking you. The owner of target spell or creature puts it on their choice of the top or bottom of their library.";

  it('isSelfCostReductionSentence returns dynamic', () => {
    const r = isSelfCostReductionSentence(
      'This spell costs {2} less to cast if a creature is attacking you',
    );
    expect(r).toBe('dynamic');
  });

  it('parseOracleText recognizes the Swat Away cost-reduction clause', () => {
    const r = parseOracleText(
      'This spell costs {2} less to cast if a creature is attacking you.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('getIntrinsicCostReduction returns 2 when a creature is attacking you', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();
    defs.set('bear', makeDef('bear', { type_line: 'Creature — Bear', card_types: ['creature'] }));
    cards.set('bear1', makeCard('bear1', 'bear', 'p2', 'battlefield'));

    const spellDef = makeDef('swat_away', {
      oracle_text: SWAT_AWAY_ORACLE,
      card_types: ['instant'], type_line: 'Instant',
    });
    // p2 is attacking p1
    const combat: CombatState = {
      attackers: [{ cardInstanceId: 'bear1', defendingPlayerId: 'p1' }],
      blockers: [],
      damageAssignment: new Map(),
    };
    const state = makeState({
      cards, cardDefinitions: defs,
      combat, phase: 'combat' as any, step: 'declare_blockers' as any,
    });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(2);
  });

  it('getIntrinsicCostReduction returns 0 when no creatures are attacking you', () => {
    const spellDef = makeDef('swat_away', {
      oracle_text: SWAT_AWAY_ORACLE,
      card_types: ['instant'], type_line: 'Instant',
    });
    const state = makeState({ combat: null });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });

  it('getIntrinsicCostReduction returns 0 when a creature is attacking but not you (attacking p2)', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();
    defs.set('bear', makeDef('bear', { type_line: 'Creature — Bear', card_types: ['creature'] }));
    cards.set('bear1', makeCard('bear1', 'bear', 'p1', 'battlefield'));

    const spellDef = makeDef('swat_away', {
      oracle_text: SWAT_AWAY_ORACLE,
      card_types: ['instant'], type_line: 'Instant',
    });
    // p1 is attacking p2, not p1 itself
    const combat: CombatState = {
      attackers: [{ cardInstanceId: 'bear1', defendingPlayerId: 'p2' }],
      blockers: [],
      damageAssignment: new Map(),
    };
    const state = makeState({
      cards, cardDefinitions: defs,
      combat, phase: 'combat' as any,
    });
    // p1 is caster; no one attacks p1
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });
});

// ============================================================================
// Form 26: exile+graveyard union for-each (Sailors' Bane)
// ============================================================================

describe("Form 26 — exile+graveyard union for-each (Sailors' Bane)", () => {
  const SAILORS_ORACLE =
    "This spell costs {1} less to cast for each card you own in exile and in your graveyard that's an instant card, a sorcery card, or a card that has an Adventure. Ward {4}";

  it('isSelfCostReductionSentence returns dynamic for the Sailors\' Bane pattern', () => {
    const r = isSelfCostReductionSentence(
      "This spell costs {1} less to cast for each card you own in exile and in your graveyard that's an instant card, a sorcery card, or a card that has an Adventure",
    );
    expect(r).toBe('dynamic');
  });

  it('parseOracleText recognizes the Sailors\' Bane cost-reduction clause as StaticAbility', () => {
    const r = parseOracleText(
      "This spell costs {1} less to cast for each card you own in exile and in your graveyard that's an instant card, a sorcery card, or a card that has an Adventure.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('getIntrinsicCostReduction counts instants and sorceries in graveyard and exile', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('bolt', makeDef('bolt', { type_line: 'Instant', card_types: ['instant'] }));
    defs.set('recall', makeDef('recall', { type_line: 'Sorcery', card_types: ['sorcery'] }));
    defs.set('bear', makeDef('bear', { type_line: 'Creature — Bear', card_types: ['creature'] }));

    // 2 instants in graveyard
    cards.set('bolt_gy1', makeCard('bolt_gy1', 'bolt', 'p1', 'graveyard'));
    cards.set('bolt_gy2', makeCard('bolt_gy2', 'bolt', 'p1', 'graveyard'));
    // 1 sorcery in exile
    cards.set('recall_ex1', makeCard('recall_ex1', 'recall', 'p1', 'exile'));
    // 1 creature in graveyard — should NOT count
    cards.set('bear_gy1', makeCard('bear_gy1', 'bear', 'p1', 'graveyard'));
    // 1 instant owned by opponent — should NOT count
    cards.set('bolt_p2_gy', makeCard('bolt_p2_gy', 'bolt', 'p2', 'graveyard'));

    const spellDef = makeDef('sailors_bane', {
      oracle_text: SAILORS_ORACLE,
      card_types: ['creature'], type_line: 'Creature',
      mana_cost: '{3}{U}', cmc: 4,
    });
    const state = makeState({ cards, cardDefinitions: defs });
    // 2 instants (gy) + 1 sorcery (exile) = 3
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(3);
  });

  it('getIntrinsicCostReduction counts Adventure cards in exile and graveyard', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('adv_card', makeDef('adv_card', {
      type_line: 'Creature — Human',
      card_types: ['creature'],
      keywords: ['Adventure'],
    }));

    // 2 adventure cards: 1 in exile, 1 in graveyard
    cards.set('adv1', makeCard('adv1', 'adv_card', 'p1', 'exile'));
    cards.set('adv2', makeCard('adv2', 'adv_card', 'p1', 'graveyard'));

    const spellDef = makeDef('sailors_bane', {
      oracle_text: SAILORS_ORACLE,
      card_types: ['creature'], type_line: 'Creature',
      mana_cost: '{3}{U}', cmc: 4,
    });
    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(2);
  });

  it('getIntrinsicCostReduction returns 0 when no qualifying cards in exile or graveyard', () => {
    const spellDef = makeDef('sailors_bane', {
      oracle_text: SAILORS_ORACLE,
      card_types: ['creature'], type_line: 'Creature',
    });
    const state = makeState({ cards: new Map(), cardDefinitions: new Map() });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });
});

// ============================================================================
// Honesty gate: "if you gained life this turn" is NOT supported
// ============================================================================

describe('Honesty gate — "if you gained life this turn" is still unsupported', () => {
  it('isSelfCostReductionSentence returns null (not dynamic) for life-gain conditional', () => {
    // lifeGainedThisTurn tracker does not exist in GameState
    const r = isSelfCostReductionSentence(
      'This spell costs {2} less to cast if you gained life this turn',
    );
    // Must NOT return 'dynamic' — we do not claim to evaluate this
    expect(r).not.toBe('dynamic');
  });

  it('getIntrinsicCostReduction returns 0 for Mortality Spear oracle text', () => {
    const spellDef = makeDef('mortality_spear', {
      oracle_text:
        'This spell costs {2} less to cast if you gained life this turn. Destroy target nonland permanent.',
      card_types: ['instant'], type_line: 'Instant',
    });
    const state = makeState();
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
  });
});
