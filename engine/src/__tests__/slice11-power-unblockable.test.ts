import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { validateTargetChoices } from '../effects/targets';
import { canBlock } from '../keywords';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

/**
 * Slice 11: 'Target creature with power N or less can't be blocked this turn'
 *
 * The matchTargetCombatRestriction parser now calls
 * applyPowerToughnessTargetConstraint after reading the base noun phrase, so
 * optional "with power N or less/greater" qualifiers are captured into the
 * TargetSpec's power constraint. validateTargetChoices (targets.ts) enforces
 * the constraint at activation time; the executor's GrantKeyword { keyword:
 * 'Unblockable' } path is unchanged.
 *
 * Example cards covered:
 *   Goblin Tunneler     — {T}: Target creature with power 2 or less can't be blocked this turn.
 *   Subterranean Scout  — {1},{T}: Target creature with power 2 or less can't be blocked this turn.
 *   Writ of Passage     — (similar wording, aura / activated variant)
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '',
    cmc: opts.cmc ?? 0,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: overrides.players ?? [makePlayer('p1'), makePlayer('p2')],
    cards: overrides.cards ?? new Map(),
    cardDefinitions: overrides.cardDefinitions ?? new Map(),
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
    continuousEffects: overrides.continuousEffects ?? [],
  };
}

// ---------------------------------------------------------------------------
// PARSE recognition tests
// ---------------------------------------------------------------------------

describe('Slice 11 — power-qualified unblockable: parser recognition', () => {
  it('Goblin Tunneler activated ability: parses power ≤ 2 constraint', () => {
    // Goblin Tunneler: {T}: Target creature with power 2 or less can't be blocked this turn.
    const r = parseOracleText(
      "{T}: Target creature with power 2 or less can't be blocked this turn.",
    );
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    expect(r.abilities).toHaveLength(1);

    const ability = r.abilities[0];
    expect(ability.effects).toHaveLength(1);
    expect(ability.effects[0].kind).toBe('GrantKeyword');
    expect(
      (ability.effects[0] as Extract<typeof ability.effects[0], { kind: 'GrantKeyword' }>).keyword,
    ).toBe('Unblockable');

    expect(ability.targets).toHaveLength(1);
    expect(ability.targets[0].type).toBe('Creature');
    expect(ability.targets[0].constraints?.power).toEqual({ op: 'lte', value: 2 });
  });

  it('Subterranean Scout: parses multi-cost variant {1},{T} with power ≤ 2', () => {
    // Subterranean Scout: {1}, {T}: Target creature with power 2 or less can't be blocked this turn.
    const r = parseOracleText(
      "{1}, {T}: Target creature with power 2 or less can't be blocked this turn.",
    );
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];
    expect(ability.effects[0].kind).toBe('GrantKeyword');
    expect(ability.targets[0].constraints?.power).toEqual({ op: 'lte', value: 2 });
  });

  it('symmetry: parses "with power N or greater" into gte constraint', () => {
    // e.g. an ability that only allows large creatures to be unblockable
    const r = parseOracleText(
      "{T}: Target creature with power 4 or greater can't be blocked this turn.",
    );
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];
    expect(ability.effects[0].kind).toBe('GrantKeyword');
    expect(ability.targets[0].constraints?.power).toEqual({ op: 'gte', value: 4 });
  });

  it('existing base form still works (no power qualifier)', () => {
    // Existing matchTargetCombatRestriction should be unaffected.
    const r = parseOracleText("{T}: Target creature can't be blocked this turn.");
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];
    expect(ability.effects[0].kind).toBe('GrantKeyword');
    // No power constraint on base form
    expect(ability.targets[0].constraints?.power).toBeUndefined();
  });

  it('spell form parses correctly: "Target creature with power 2 or less can\'t be blocked this turn."', () => {
    const r = parseOracleText(
      "Target creature with power 2 or less can't be blocked this turn.",
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('GrantKeyword');
    expect(r.targets[0].constraints?.power).toEqual({ op: 'lte', value: 2 });
  });
});

// ---------------------------------------------------------------------------
// TARGET LEGALITY tests (validateTargetChoices enforces the power constraint)
// ---------------------------------------------------------------------------

describe('Slice 11 — power-qualified unblockable: target legality', () => {
  function fixture(attackerPower: number, blockerPower: number) {
    const cards = new Map<string, CardInstance>();
    cards.set('att', makeCard('att', 'att_def', 'p1'));
    cards.set('blk', makeCard('blk', 'blk_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('att_def', makeDef('att_def', { power: attackerPower, toughness: 2 }));
    defs.set('blk_def', makeDef('blk_def', { power: blockerPower, toughness: 2 }));
    return makeState({ cards, cardDefinitions: defs });
  }

  it('a creature with power 2 IS a legal target for Goblin Tunneler ability', () => {
    const parsed = parseOracleText(
      "{T}: Target creature with power 2 or less can't be blocked this turn.",
    );
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    const ability = parsed.abilities[0];
    const state = fixture(2, 3);
    expect(() => validateTargetChoices(state, 'p1', ability.targets, ['att'])).not.toThrow();
  });

  it('a creature with power 3 is NOT a legal target for Goblin Tunneler ability (power > 2)', () => {
    const parsed = parseOracleText(
      "{T}: Target creature with power 2 or less can't be blocked this turn.",
    );
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    const ability = parsed.abilities[0];
    // att_def has power 3 in this fixture
    const state = fixture(3, 2);
    expect(() => validateTargetChoices(state, 'p1', ability.targets, ['att'])).toThrow(
      /power.*does not satisfy lte 2/,
    );
  });
});

// ---------------------------------------------------------------------------
// EXECUTION tests (GrantKeyword Unblockable is applied by executor; canBlock
// then returns false for the targeted creature)
// ---------------------------------------------------------------------------

describe('Slice 11 — power-qualified unblockable: execution', () => {
  function combatFixture(attackerPower: number) {
    const cards = new Map<string, CardInstance>();
    cards.set('att', makeCard('att', 'att_def', 'p1'));
    cards.set('blk', makeCard('blk', 'blk_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('att_def', makeDef('att_def', { power: attackerPower, toughness: 2 }));
    defs.set('blk_def', makeDef('blk_def', { power: 2, toughness: 2 }));
    return makeState({
      cards, cardDefinitions: defs,
      combat: {
        attackers: [{ cardInstanceId: 'att', defendingPlayerId: 'p2' }],
        blockers: [],
        damageAssignment: new Map(),
      },
    });
  }

  it('executing Goblin Tunneler on a power-2 attacker grants Unblockable, blocking becomes illegal', () => {
    const parsed = parseOracleText(
      "{T}: Target creature with power 2 or less can't be blocked this turn.",
    );
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    const ability = parsed.abilities[0];

    let state = combatFixture(2);
    // Before execution the blocker can attempt to block
    expect(canBlock(state, 'blk', 'att')).toBe(true);

    // Activate the ability targeting 'att'
    state = executeEffects(state, ability.effects, 'p1', ['att'], ability.targets);

    // After execution 'att' has the Unblockable keyword → canBlock returns false
    const attCard = state.cards.get('att')!;
    expect(attCard.grantedKeywords).toContain('Unblockable');
    expect(canBlock(state, 'blk', 'att')).toBe(false);
  });

  it('executing on a power-1 creature (well within ≤ 2) also works', () => {
    const parsed = parseOracleText(
      "{T}: Target creature with power 2 or less can't be blocked this turn.",
    );
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    const ability = parsed.abilities[0];

    let state = combatFixture(1);
    expect(canBlock(state, 'blk', 'att')).toBe(true);
    state = executeEffects(state, ability.effects, 'p1', ['att'], ability.targets);
    expect(state.cards.get('att')!.grantedKeywords).toContain('Unblockable');
    expect(canBlock(state, 'blk', 'att')).toBe(false);
  });
});
