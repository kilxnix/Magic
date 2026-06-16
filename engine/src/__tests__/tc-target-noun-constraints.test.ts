import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { validateTargetChoices } from '../effects/targets';
import { hasKeyword } from '../keywords';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

/**
 * Family: target-constraint extensions (slice 2/8).
 *
 * Removal/tap/pump/bounce/damage clauses used to fail only because the target
 * noun phrase carried a constraint the TargetSpec system lacked:
 *
 *   "non<type>" / "non-<Subtype>" / "nonlegendary" / "nontoken"  → exclusions
 *   "with power/toughness N or greater/less"                     → P/T bounds
 *   "attacking" / "blocking" / "attacking or blocking"           → combatStatus
 *   "tapped" / "untapped"                                        → tappedStatus
 *   "target permanent" bounce                                    → TargetType 'Permanent'
 *
 * HONEST: the parser only adds constraints to TargetSpecs; the effects route to
 * the existing Destroy / Tap / GrantKeyword / ReturnToHand / DealDamage
 * executor cases, and every constraint is enforced by validateTargetChoices
 * (targets.ts) at cast/activation time.
 */

// ============================================================================
// Test helpers (mirrors kw-line-absorption.test.ts)
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
    cmc: opts.cmc || 0,
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
  };
}

// ============================================================================
// RECOGNITION: the constrained noun phrases parse into TargetSpec.constraints
// on the existing effect kinds.
// ============================================================================

describe('target-constraint extensions — parser recognition', () => {
  it('Immolating Glare: "Destroy target attacking creature."', () => {
    const r = parseOracleText('Destroy target attacking creature.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects).toHaveLength(1);
    expect(r.effects[0].kind).toBe('Destroy');
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].type).toBe('Creature');
    expect(r.targets[0].constraints?.combatStatus).toBe('attacking');
  });

  it('Coeurl wording: "Tap target nonenchantment creature."', () => {
    const r = parseOracleText('Tap target nonenchantment creature.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('Tap');
    expect(r.targets[0].type).toBe('Creature');
    expect(r.targets[0].constraints?.excludeTypes).toEqual(['enchantment']);
  });

  it('Spearbreaker Behemoth: "{1}: Target creature with power 5 or greater gains indestructible until end of turn."', () => {
    const r = parseOracleText('{1}: Target creature with power 5 or greater gains indestructible until end of turn.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    expect(r.abilities).toHaveLength(1);
    const ability = r.abilities[0];
    expect(ability.effects[0].kind).toBe('GrantKeyword');
    expect(ability.targets).toHaveLength(1);
    expect(ability.targets[0].type).toBe('Creature');
    expect(ability.targets[0].constraints?.power).toEqual({ op: 'gte', value: 5 });
  });

  it('Regress: "Return target permanent to its owner\'s hand."', () => {
    const r = parseOracleText("Return target permanent to its owner's hand.");
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('ReturnToHand');
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].type).toBe('Permanent');
  });

  it('Freewind Equenaut: "{T}: This creature deals 2 damage to target attacking or blocking creature."', () => {
    const r = parseOracleText('{T}: This creature deals 2 damage to target attacking or blocking creature.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];
    expect(ability.effects[0].kind).toBe('DealDamage');
    expect(ability.targets[0].type).toBe('Creature');
    expect(ability.targets[0].constraints?.combatStatus).toBe('attackingOrBlocking');
  });

  it('Victim of Night: chained subtype exclusions "non-Vampire, non-Werewolf, non-Zombie creature"', () => {
    const r = parseOracleText('Destroy target non-Vampire, non-Werewolf, non-Zombie creature.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('Destroy');
    expect(r.targets[0].constraints?.excludeSubtypes).toEqual(['vampire', 'werewolf', 'zombie']);
  });

  it('"Destroy target nonlegendary creature." / "Destroy target nontoken creature."', () => {
    const legendary = parseOracleText('Destroy target nonlegendary creature.');
    expect(legendary.kind).toBe('Spell');
    if (legendary.kind !== 'Spell') return;
    expect(legendary.targets[0].constraints?.excludeSupertypes).toEqual(['legendary']);

    const token = parseOracleText('Destroy target nontoken creature.');
    expect(token.kind).toBe('Spell');
    if (token.kind !== 'Spell') return;
    expect(token.targets[0].constraints?.nontoken).toBe(true);
  });

  it('"Destroy target tapped creature." — tappedStatus constraint', () => {
    const r = parseOracleText('Destroy target tapped creature.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('Destroy');
    expect(r.targets[0].constraints?.tappedStatus).toBe('tapped');
  });
});

// ============================================================================
// EXECUTION + LEGALITY: the parsed effects run through the existing executor
// cases, and validateTargetChoices enforces every new constraint.
// ============================================================================

describe('target-constraint extensions — execution and target legality', () => {
  function combatFixture() {
    const cards = new Map<string, CardInstance>();
    cards.set('attacker_1', makeCard('attacker_1', 'bear_def', 'p2'));
    cards.set('blocker_1', makeCard('blocker_1', 'bear_def', 'p1'));
    cards.set('idle_1', makeCard('idle_1', 'bear_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('bear_def', makeDef('bear_def', { name: 'Bear', type_line: 'Creature — Bear' }));
    return makeState({
      cards,
      cardDefinitions: defs,
      combat: {
        attackers: [{ cardInstanceId: 'attacker_1', defendingPlayerId: 'p1' }],
        blockers: [{ cardInstanceId: 'blocker_1', blockingAttackerId: 'attacker_1' }],
        damageAssignment: new Map(),
      },
    });
  }

  it('Immolating Glare: destroys the attacker; a non-attacking creature is an illegal target', () => {
    const parsed = parseOracleText('Destroy target attacking creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const state = combatFixture();

    // The attacking creature is a legal choice...
    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['attacker_1'])).not.toThrow();
    // ...an untouched bystander is not, and neither is the blocker.
    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['idle_1'])).toThrow(/attacking/);
    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['blocker_1'])).toThrow(/attacking/);

    const result = executeEffects(state, parsed.effects, 'p1', ['attacker_1'], parsed.targets);
    expect(result.cards.get('attacker_1')?.zone).toBe('graveyard');
  });

  it('Freewind Equenaut: deals 2 to a blocking creature; idle creatures are illegal', () => {
    const parsed = parseOracleText('{T}: This creature deals 2 damage to target attacking or blocking creature.');
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    const ability = parsed.abilities[0];

    let state = combatFixture();
    state.cards.set('equenaut_1', makeCard('equenaut_1', 'equenaut_def', 'p1'));
    state.cardDefinitions.set('equenaut_def', makeDef('equenaut_def', {
      name: 'Freewind Equenaut', type_line: 'Creature — Human Archer', power: 2, toughness: 3,
    }));

    // Both combatants are legal; the idle creature is not.
    expect(() => validateTargetChoices(state, 'p1', ability.targets, ['attacker_1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p1', ability.targets, ['blocker_1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p1', ability.targets, ['idle_1'])).toThrow(/attacking or blocking/);

    const result = executeEffects(
      state, ability.effects, 'p1', ['blocker_1'], ability.targets,
      0, { sourceInstanceId: 'equenaut_1' },
    );
    expect(result.cards.get('blocker_1')?.damage).toBe(2);
  });

  it('Coeurl wording: taps a plain creature; an enchantment creature is illegal', () => {
    const parsed = parseOracleText('Tap target nonenchantment creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    cards.set('bear_1', makeCard('bear_1', 'bear_def', 'p2'));
    cards.set('courser_1', makeCard('courser_1', 'courser_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('bear_def', makeDef('bear_def', { name: 'Bear', type_line: 'Creature — Bear' }));
    defs.set('courser_def', makeDef('courser_def', {
      name: 'Heliod\'s Pilgrim Idol',
      type_line: 'Enchantment Creature — Idol',
      card_types: ['enchantment', 'creature'],
    }));
    const state = makeState({ cards, cardDefinitions: defs });

    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['bear_1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['courser_1'])).toThrow(/excluded type enchantment/);

    const result = executeEffects(state, parsed.effects, 'p1', ['bear_1'], parsed.targets);
    expect(result.cards.get('bear_1')?.tapped).toBe(true);
  });

  it('Spearbreaker Behemoth: grants indestructible to a 5-power creature; a 2-power creature is illegal', () => {
    const parsed = parseOracleText('{1}: Target creature with power 5 or greater gains indestructible until end of turn.');
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    const ability = parsed.abilities[0];

    const cards = new Map<string, CardInstance>();
    cards.set('big_1', makeCard('big_1', 'big_def', 'p1'));
    cards.set('small_1', makeCard('small_1', 'small_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('big_def', makeDef('big_def', { name: 'Big Beast', type_line: 'Creature — Beast', power: 5, toughness: 5 }));
    defs.set('small_def', makeDef('small_def', { name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 }));
    const state = makeState({ cards, cardDefinitions: defs });

    expect(() => validateTargetChoices(state, 'p1', ability.targets, ['big_1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p1', ability.targets, ['small_1'])).toThrow(/power 2/);

    const result = executeEffects(state, ability.effects, 'p1', ['big_1'], ability.targets);
    expect(hasKeyword(result, 'big_1', 'indestructible')).toBe(true);
  });

  it('Regress: returns any permanent (a land) to its owner\'s hand', () => {
    const parsed = parseOracleText("Return target permanent to its owner's hand.");
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    cards.set('island_1', makeCard('island_1', 'island_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('island_def', makeDef('island_def', {
      name: 'Island', type_line: 'Basic Land — Island', card_types: ['land'],
      power: undefined, toughness: undefined,
    }));
    const state = makeState({ cards, cardDefinitions: defs });

    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['island_1'])).not.toThrow();

    const result = executeEffects(state, parsed.effects, 'p1', ['island_1'], parsed.targets);
    expect(result.cards.get('island_1')?.zone).toBe('hand');
  });

  it('Victim of Night: excluded subtypes and supertypes are enforced', () => {
    const parsed = parseOracleText('Destroy target non-Vampire, non-Werewolf, non-Zombie creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    cards.set('bear_1', makeCard('bear_1', 'bear_def', 'p2'));
    cards.set('vamp_1', makeCard('vamp_1', 'vamp_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('bear_def', makeDef('bear_def', { name: 'Bear', type_line: 'Creature — Bear' }));
    defs.set('vamp_def', makeDef('vamp_def', { name: 'Vampire Nighthawk', type_line: 'Creature — Vampire Shaman' }));
    const state = makeState({ cards, cardDefinitions: defs });

    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['bear_1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['vamp_1'])).toThrow(/excluded subtype vampire/);

    const result = executeEffects(state, parsed.effects, 'p1', ['bear_1'], parsed.targets);
    expect(result.cards.get('bear_1')?.zone).toBe('graveyard');
  });

  it('tapped-creature constraint: only a tapped creature is a legal choice', () => {
    const parsed = parseOracleText('Destroy target tapped creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    const tappedBear = makeCard('tapped_1', 'bear_def', 'p2');
    tappedBear.tapped = true;
    cards.set('tapped_1', tappedBear);
    cards.set('untapped_1', makeCard('untapped_1', 'bear_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('bear_def', makeDef('bear_def', { name: 'Bear', type_line: 'Creature — Bear' }));
    const state = makeState({ cards, cardDefinitions: defs });

    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['tapped_1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['untapped_1'])).toThrow(/must be tapped/);
  });

  it('nontoken constraint: token creatures are illegal targets', () => {
    const parsed = parseOracleText('Destroy target nontoken creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    cards.set('bear_1', makeCard('bear_1', 'bear_def', 'p2'));
    const tokenBear = makeCard('token_1', 'bear_def', 'p2');
    (tokenBear as CardInstance & { isToken?: boolean }).isToken = true;
    cards.set('token_1', tokenBear);
    const defs = new Map<string, CardDefinition>();
    defs.set('bear_def', makeDef('bear_def', { name: 'Bear', type_line: 'Creature — Bear' }));
    const state = makeState({ cards, cardDefinitions: defs });

    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['bear_1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['token_1'])).toThrow(/nontoken/);
  });
});
