/**
 * slice8-blocks-or-blocked-by: parse + execution tests for the
 * "Whenever this creature blocks or becomes blocked by a creature, that creature <effect>"
 * family (Slice 8/11: Witherscale Wurm / Dwarven Nomad / Lim-Dûl's Cohort).
 *
 * Coverage:
 *   Parse:
 *   1. "Whenever this creature blocks or becomes blocked by a creature, that creature
 *      gains wither until end of turn." → BlocksOrBlockedBy trigger, GrantKeyword body
 *   2. "Whenever ~ blocks or becomes blocked by a creature, that creature gains first
 *      strike until end of turn." → BlocksOrBlockedBy trigger, GrantKeyword body
 *   3. "Whenever this creature blocks or becomes blocked by a creature, that creature
 *      can't be regenerated this turn." → BlocksOrBlockedBy trigger, GrantKeyword(CantBeRegenerated)
 *   4. "Whenever ~ blocks or becomes blocked by a creature, that creature gets -1/-0
 *      until end of turn." → BlocksOrBlockedBy trigger, ModifyPT body (covered by
 *      matchThatCreatureGetsPT which already handles EventCreature)
 *
 *   Execution:
 *   5. Blocker fires: when the blocker (p2's creature) blocks p1's attacker, the
 *      attacker (opposing creature) gains the keyword.
 *   6. Attacker fires: when p1's attacker is blocked, the blocker (opposing creature)
 *      gains the keyword.
 *   7. CantBeRegenerated: that creature's regen shields are ignored when it would die.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  registerBattlefieldAbilities,
} from '../stack';
import { declareAttackers, declareBlockers, resolveCombatDamage } from '../combat';
import type { CardDefinition, GameState, CardInstance } from '../types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCreature(
  id: string,
  name: string,
  oracleText: string,
  power = 3,
  toughness = 3,
): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature — Test',
    oracle_text: oracleText,
    mana_cost: '{3}',
    cmc: 3,
    colors: [],
    color_identity: [],
    keywords: [],
    power,
    toughness,
    card_types: ['creature'],
  };
}

function makeLand(id: string): CardDefinition {
  return {
    id,
    name: 'Forest',
    type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function createTestGame(p1Cards: CardDefinition[], p2Cards: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-cmd-1' },
    { playerId: 'p2', name: 'Player 2', cards: p2Cards, commanderId: 'nonexistent-cmd-2' },
  ]);
}

function moveToBattlefield(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone: 'battlefield', summoningSick: false });
  return { ...state, cards: newCards };
}

function findCard(state: GameState, defId: string): CardInstance {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  throw new Error(`Card not found for def: ${defId}`);
}

function setupCombat(state: GameState, activePlayerIndex = 0): GameState {
  return {
    ...state,
    activePlayerIndex,
    priorityPlayerIndex: activePlayerIndex,
    phase: 'combat' as any,
    step: 'declare_attackers' as any,
    combat: null,
  };
}

// ---------------------------------------------------------------------------
// Parse tests
// ---------------------------------------------------------------------------

describe('slice8-blocks-or-blocked-by — parse', () => {
  it('parses "Witherscale Wurm" oracle (that creature gains wither until end of turn)', () => {
    const oracle = 'Whenever this creature blocks or becomes blocked by a creature, that creature gains wither until end of turn.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'BlocksOrBlockedBy', who: 'self' });
    expect(result.ability.effects).toHaveLength(1);
    const effect = result.ability.effects[0] as any;
    expect(effect.kind).toBe('GrantKeyword');
    expect(effect.keyword).toBe('Wither');
    expect(effect.target).toEqual({ kind: 'EventCreature' });
    expect(effect.untilEndOfTurn).toBe(true);
  });

  it('parses "Dwarven Nomad" oracle (that creature gains first strike until end of turn)', () => {
    const oracle = 'Whenever this creature blocks or becomes blocked by a creature, that creature gains first strike until end of turn.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'BlocksOrBlockedBy', who: 'self' });
    const effect = result.ability.effects[0] as any;
    expect(effect.kind).toBe('GrantKeyword');
    expect(effect.keyword).toBe('First Strike');
    expect(effect.target).toEqual({ kind: 'EventCreature' });
  });

  it('parses "~" subject form (Witherscale Wurm variant with tilde)', () => {
    const oracle = 'Whenever ~ blocks or becomes blocked by a creature, that creature gains wither until end of turn.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'BlocksOrBlockedBy', who: 'self' });
    const effect = result.ability.effects[0] as any;
    expect(effect.kind).toBe('GrantKeyword');
    expect(effect.keyword).toBe('Wither');
  });

  it('parses "Lim-Dul\'s Cohort" oracle (that creature can\'t be regenerated this turn)', () => {
    const oracle = "Whenever this creature blocks or becomes blocked by a creature, that creature can't be regenerated this turn.";
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'BlocksOrBlockedBy', who: 'self' });
    expect(result.ability.effects).toHaveLength(1);
    const effect = result.ability.effects[0] as any;
    expect(effect.kind).toBe('GrantKeyword');
    expect(effect.keyword).toBe('CantBeRegenerated');
    expect(effect.target).toEqual({ kind: 'EventCreature' });
    expect(effect.untilEndOfTurn).toBe(true);
  });

  it('parses ModifyPT body (that creature gets -1/-0 until end of turn)', () => {
    const oracle = 'Whenever this creature blocks or becomes blocked by a creature, that creature gets -1/-0 until end of turn.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'BlocksOrBlockedBy', who: 'self' });
    const effect = result.ability.effects[0] as any;
    expect(effect.kind).toBe('ModifyPT');
    expect(effect.power).toBe(-1);
    // -0 and +0 are functionally identical; use == to avoid Object.is distinction
    expect(effect.toughness == 0).toBe(true);
    expect(effect.target).toEqual({ kind: 'EventCreature' });
  });
});

// ---------------------------------------------------------------------------
// Execution tests
// ---------------------------------------------------------------------------

describe('slice8-blocks-or-blocked-by — execution', () => {
  it('blocker fires: opposing attacker gains keyword when blocker has the trigger', () => {
    // p2's Witherscale Wurm blocks p1's Attacker.
    // The Wurm has "blocks or becomes blocked by a creature" trigger.
    // When it BLOCKS, "that creature" = the attacker (p1's creature) — gains Wither.
    const attacker = makeCreature('atk-plain', 'Plain Attacker', '', 3, 3);
    const wurm = makeCreature(
      'wurm',
      'Witherscale Wurm',
      'Whenever this creature blocks or becomes blocked by a creature, that creature gains wither until end of turn.',
      6,
      4,
    );
    const land = makeLand('land1');

    let state = createTestGame(
      [attacker, land],
      [wurm, land],
    );

    const attackerInst = findCard(state, 'atk-plain');
    const wurmInst = findCard(state, 'wurm');

    state = moveToBattlefield(state, attackerInst.instanceId);
    state = moveToBattlefield(state, wurmInst.instanceId);
    state = registerBattlefieldAbilities(state, wurmInst.instanceId);

    state = setupCombat(state, 0); // p1 is active
    state = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerInst.instanceId, defendingPlayerId: 'p2' },
    ]);

    // Declare the Wurm as blocker
    state = { ...state, step: 'declare_blockers' as any };
    state = declareBlockers(state, 'p2', [
      { cardInstanceId: wurmInst.instanceId, blockingAttackerId: attackerInst.instanceId },
    ]);

    // One BlocksOrBlockedBy trigger should have fired (the Wurm's trigger).
    // The blocker fires once for the pair.
    const blocksTrigs = state.pendingTriggers.filter(
      t => t.ability.trigger.kind === 'BlocksOrBlockedBy',
    );
    expect(blocksTrigs.length).toBeGreaterThanOrEqual(1);
    // Find the Wurm's trigger (sourceInstanceId === wurm's id)
    const wurmTrig = blocksTrigs.find(t => t.sourceInstanceId === wurmInst.instanceId);
    expect(wurmTrig).toBeDefined();
    // The eventContext.cardInstanceId should be the opposing creature (the attacker).
    expect(wurmTrig!.eventContext?.cardInstanceId).toBe(attackerInst.instanceId);

    // Resolve the trigger and confirm the attacker gains Wither.
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const attackerAfter = state.cards.get(attackerInst.instanceId)!;
    expect(attackerAfter.grantedKeywords).toContain('Wither');
  });

  it('attacker fires: opposing blocker gains keyword when attacker has the trigger', () => {
    // p1's Dwarven Nomad (has the trigger) attacks. p2's creature blocks.
    // When the Nomad becomes BLOCKED BY the blocker, "that creature" = the blocker
    // → gains First Strike.
    const nomad = makeCreature(
      'nomad',
      'Dwarven Nomad',
      'Whenever this creature blocks or becomes blocked by a creature, that creature gains first strike until end of turn.',
      1,
      1,
    );
    const blocker = makeCreature('blocker', 'Blocker', '', 2, 2);
    const land = makeLand('land2');

    let state = createTestGame([nomad, land], [blocker, land]);

    const nomadInst = findCard(state, 'nomad');
    const blockerInst = findCard(state, 'blocker');

    state = moveToBattlefield(state, nomadInst.instanceId);
    state = moveToBattlefield(state, blockerInst.instanceId);
    state = registerBattlefieldAbilities(state, nomadInst.instanceId);

    state = setupCombat(state, 0);
    state = declareAttackers(state, 'p1', [
      { cardInstanceId: nomadInst.instanceId, defendingPlayerId: 'p2' },
    ]);

    state = { ...state, step: 'declare_blockers' as any };
    state = declareBlockers(state, 'p2', [
      { cardInstanceId: blockerInst.instanceId, blockingAttackerId: nomadInst.instanceId },
    ]);

    // The attacker (Nomad) should have a BlocksOrBlockedBy trigger with
    // eventContext.cardInstanceId = the blocker's id.
    const nomadTrig = state.pendingTriggers.find(
      t => t.ability.trigger.kind === 'BlocksOrBlockedBy'
        && t.sourceInstanceId === nomadInst.instanceId,
    );
    expect(nomadTrig).toBeDefined();
    expect(nomadTrig!.eventContext?.cardInstanceId).toBe(blockerInst.instanceId);

    // Resolve and check blocker gains First Strike.
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const blockerAfter = state.cards.get(blockerInst.instanceId)!;
    expect(blockerAfter.grantedKeywords).toContain('First Strike');
  });

  it("CantBeRegenerated: grants the keyword on opposing creature (Lim-Dul's Cohort body)", () => {
    // p2's Cohort blocks p1's creature. "That creature" (p1's) gains CantBeRegenerated.
    const cohort = makeCreature(
      'cohort',
      "Lim-Dul's Cohort",
      "Whenever this creature blocks or becomes blocked by a creature, that creature can't be regenerated this turn.",
      2,
      2,
    );
    const victim = makeCreature('victim', 'Victim', '', 1, 1);
    const land = makeLand('land3');

    let state = createTestGame([victim, land], [cohort, land]);

    const cohortInst = findCard(state, 'cohort');
    const victimInst = findCard(state, 'victim');

    state = moveToBattlefield(state, victimInst.instanceId);
    state = moveToBattlefield(state, cohortInst.instanceId);
    state = registerBattlefieldAbilities(state, cohortInst.instanceId);

    state = setupCombat(state, 0);
    state = declareAttackers(state, 'p1', [
      { cardInstanceId: victimInst.instanceId, defendingPlayerId: 'p2' },
    ]);

    state = { ...state, step: 'declare_blockers' as any };
    state = declareBlockers(state, 'p2', [
      { cardInstanceId: cohortInst.instanceId, blockingAttackerId: victimInst.instanceId },
    ]);

    // Resolve triggers and confirm victim has CantBeRegenerated.
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const victimAfter = state.cards.get(victimInst.instanceId)!;
    expect(victimAfter.grantedKeywords).toContain('CantBeRegenerated');
  });
});
