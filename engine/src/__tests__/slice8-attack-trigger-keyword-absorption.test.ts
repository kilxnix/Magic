/**
 * Slice 8: attack-trigger one-blocker absorption
 *
 * Tests for three new parser capabilities added in this slice:
 *
 * 1. Keyword-line absorption before a single attack trigger (multi-keyword + attack body)
 *    e.g. "Menace\nWhenever ~ attacks, draw a card." — trimLeadingKeywordOrEnchantPreamble
 *    strips leading known keywords and the trigger prefix parses normally.
 *
 * 2. "target attacking creature without flying gains flying until end of turn"
 *    — the "without <keyword>" constraint in GrantKeyword bodies (lacksKeywords field)
 *
 * 3. "it deals N damage to each of up to two targets" — DealDamageEachTarget
 *    where every chosen target takes N damage independently
 *
 * Parse tests verify correct ParsedOracle shapes.
 * Execution tests drive the trigger through declareAttackers + resolveTopOfStack.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  registerBattlefieldAbilities,
} from '../stack';
import { declareAttackers } from '../combat';
import type { CardDefinition, GameState, CardInstance } from '../types';
import type { TargetSpec } from '../effects/targets';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCreature(
  id: string,
  name: string,
  oracleText: string,
  opts: { power?: number; toughness?: number; keywords?: string[] } = {},
): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature - Test',
    oracle_text: oracleText,
    mana_cost: '{2}{R}',
    cmc: 3,
    colors: ['R'],
    color_identity: ['R'],
    keywords: opts.keywords ?? [],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
    card_types: ['creature'],
  };
}

function makeLand(id: string): CardDefinition {
  return {
    id,
    name: 'Island',
    type_line: 'Basic Land - Island',
    oracle_text: '{T}: Add {U}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['U'],
    keywords: [],
    card_types: ['land'],
  };
}

function createGame(p1Cards: CardDefinition[], p2Cards: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-cmd-1' },
    { playerId: 'p2', name: 'Player 2', cards: p2Cards, commanderId: 'nonexistent-cmd-2' },
  ]);
}

function moveToBattlefield(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  return {
    ...state,
    cards: new Map(state.cards).set(instanceId, {
      ...card,
      zone: 'battlefield',
      summoningSick: false,
    }),
  };
}

function findCard(state: GameState, defId: string): CardInstance {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  throw new Error(`Card not found for def: ${defId}`);
}

function setupCombat(state: GameState): GameState {
  return {
    ...state,
    activePlayerIndex: 0,
    phase: 'combat' as any,
    step: 'declare_attackers' as any,
  };
}

function playerLife(state: GameState, playerId: string): number {
  return state.players.find(p => p.id === playerId)!.life;
}

// ---------------------------------------------------------------------------
// PARSE: keyword-line absorption + attack trigger body
// ---------------------------------------------------------------------------

describe('slice8 parse — keyword absorption + attack trigger', () => {
  it('parses "Menace\\nWhenever ~ attacks, draw a card" as Triggered', () => {
    // trimLeadingKeywordOrEnchantPreamble strips "menace", prefix matches "whenever"
    const r = parseOracleText('Menace\nWhenever ~ attacks, draw a card.');
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('Attacks');
    expect(r.ability.effects[0].kind).toBe('Draw');
  });

  it('parses "Vigilance\\nTrample\\nWhenever ~ attacks, draw a card" as Triggered', () => {
    const r = parseOracleText('Vigilance\nTrample\nWhenever ~ attacks, draw a card.');
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('Attacks');
    expect(r.ability.effects[0].kind).toBe('Draw');
  });

  it('parses "Flying\\nWhenever ~ attacks, target attacking creature without flying gains flying" as Triggered', () => {
    // trimLeadingKeywordOrEnchantPreamble strips "flying", the trigger prefix parses normally
    const r = parseOracleText(
      'Flying\nWhenever ~ attacks, target attacking creature without flying gains flying until end of turn.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('Attacks');
    expect(r.ability.effects[0].kind).toBe('GrantKeyword');
  });
});

// ---------------------------------------------------------------------------
// PARSE: "target attacking creature without flying gains flying"
// ---------------------------------------------------------------------------

describe('slice8 parse — without-keyword GrantKeyword', () => {
  it('parses "Whenever ~ attacks, target attacking creature without flying gains flying"', () => {
    const r = parseOracleText(
      'Whenever ~ attacks, target attacking creature without flying gains flying until end of turn.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    const trigger = r.ability.trigger;
    expect(trigger.kind).toBe('Attacks');

    const effect = r.ability.effects[0];
    expect(effect.kind).toBe('GrantKeyword');
    if (effect.kind !== 'GrantKeyword') return;
    expect(effect.keyword).toBe('Flying');
    expect(effect.untilEndOfTurn).toBe(true);

    // Target spec: combatStatus = attacking AND lacksKeywords includes 'flying'
    const spec = r.targets[0] as TargetSpec;
    expect(spec.type).toBe('Creature');
    expect(spec.constraints?.combatStatus).toBe('attacking');
    expect(spec.constraints?.lacksKeywords).toContain('flying');
  });

  it('parses "Whenever this creature attacks, target creature without trample gains trample"', () => {
    const r = parseOracleText(
      'Whenever this creature attacks, target creature without trample gains trample until end of turn.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    const effect = r.ability.effects[0];
    expect(effect.kind).toBe('GrantKeyword');
    if (effect.kind !== 'GrantKeyword') return;
    expect(effect.keyword).toBe('Trample');
    const spec = r.targets[0] as TargetSpec;
    // No attacking constraint — pure "without trample" body
    expect(spec.constraints?.lacksKeywords).toContain('trample');
  });
});

// ---------------------------------------------------------------------------
// PARSE: "it deals N damage to each of up to two targets"
// ---------------------------------------------------------------------------

describe('slice8 parse — DealDamageEachTarget', () => {
  it('parses "Whenever ~ attacks, it deals 1 damage to each of up to two targets"', () => {
    const r = parseOracleText(
      'Whenever ~ attacks, it deals 1 damage to each of up to two targets.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('Attacks');

    const effect = r.ability.effects[0];
    expect(effect.kind).toBe('DealDamageEachTarget');
    if (effect.kind !== 'DealDamageEachTarget') return;
    expect(effect.amount).toBe(1);

    // Multi-target spec: count=2, minCount=0, type=Any
    const spec = r.targets[0] as TargetSpec;
    expect(spec.count).toBe(2);
    expect(spec.minCount).toBe(0);
    expect(spec.type).toBe('Any');
  });

  it('parses "it deals 2 damage to each of up to two target creatures"', () => {
    const r = parseOracleText(
      'Whenever ~ attacks, it deals 2 damage to each of up to two target creatures.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    const effect = r.ability.effects[0];
    expect(effect.kind).toBe('DealDamageEachTarget');
    if (effect.kind !== 'DealDamageEachTarget') return;
    expect(effect.amount).toBe(2);
    expect(r.targets[0].type).toBe('Creature');
  });

  it('parses "~ deals 3 damage to each of up to three targets"', () => {
    const r = parseOracleText(
      'Whenever ~ attacks, ~ deals 3 damage to each of up to three targets.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    const effect = r.ability.effects[0];
    expect(effect.kind).toBe('DealDamageEachTarget');
    if (effect.kind !== 'DealDamageEachTarget') return;
    expect(effect.amount).toBe(3);
    const spec = r.targets[0] as TargetSpec;
    expect(spec.count).toBe(3);
    expect(spec.minCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EXECUTION: DealDamageEachTarget fires on attack and damages each target
// ---------------------------------------------------------------------------

describe('slice8 execution — DealDamageEachTarget attack trigger', () => {
  it('deals 1 damage to each of two chosen targets', () => {
    // A 2/2 creature with the attack trigger
    const pingerAtk = makeCreature(
      'pinger-atk',
      'Pinger Attacker',
      'Whenever ~ attacks, it deals 1 damage to each of up to two targets.',
    );
    const land1 = makeLand('l1');
    const land2 = makeLand('l2');
    // p2 has two creatures so we can target both
    const target1 = makeCreature('t1', 'Target One', '', { power: 3, toughness: 3 });
    const target2 = makeCreature('t2', 'Target Two', '', { power: 3, toughness: 3 });
    const p2Land = makeLand('l3');

    let state = createGame(
      [pingerAtk, land1, land2],
      [target1, target2, p2Land],
    );

    const attackerInst = findCard(state, 'pinger-atk');
    const t1Inst = findCard(state, 't1');
    const t2Inst = findCard(state, 't2');

    state = moveToBattlefield(state, attackerInst.instanceId);
    state = moveToBattlefield(state, t1Inst.instanceId);
    state = moveToBattlefield(state, t2Inst.instanceId);
    state = registerBattlefieldAbilities(state, attackerInst.instanceId);
    state = setupCombat(state);

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerInst.instanceId, defendingPlayerId: 'p2' },
    ]);

    expect(state.pendingTriggers).toHaveLength(1);
    const trigger = state.pendingTriggers[0];
    const spec = (trigger.requiredTargets as TargetSpec[])[0];
    expect(spec.count).toBe(2);
    expect(spec.minCount).toBe(0);

    // Provide both p2 creatures as targets
    state = putTriggersOnStack(state, {
      [trigger.id]: [t1Inst.instanceId, t2Inst.instanceId],
    });
    state = resolveTopOfStack(state);

    // Each creature should have taken 1 damage
    expect(state.cards.get(t1Inst.instanceId)!.damage ?? 0).toBe(1);
    expect(state.cards.get(t2Inst.instanceId)!.damage ?? 0).toBe(1);
  });

  it('deals damage to one target when only one is chosen (minCount=0 allows partial)', () => {
    const pingerAtk = makeCreature(
      'pinger-atk2',
      'Pinger Attacker 2',
      'Whenever ~ attacks, it deals 1 damage to each of up to two targets.',
    );
    const land1 = makeLand('la');
    const p2Land = makeLand('lb');

    let state = createGame([pingerAtk, land1], [p2Land]);
    const attackerInst = findCard(state, 'pinger-atk2');
    state = moveToBattlefield(state, attackerInst.instanceId);
    state = registerBattlefieldAbilities(state, attackerInst.instanceId);
    state = setupCombat(state);

    const lifeBefore = playerLife(state, 'p2');

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerInst.instanceId, defendingPlayerId: 'p2' },
    ]);

    const trigger = state.pendingTriggers[0];
    // Target only the p2 player with 1 of the 2 available slots
    state = putTriggersOnStack(state, {
      [trigger.id]: ['p2'],
    });
    state = resolveTopOfStack(state);

    // p2 took 1 damage
    expect(playerLife(state, 'p2')).toBe(lifeBefore - 1);
  });
});

// ---------------------------------------------------------------------------
// EXECUTION: "without flying" GrantKeyword fires correctly
// ---------------------------------------------------------------------------

describe('slice8 execution — GrantKeyword without-keyword constraint', () => {
  it('grants flying to attacking creature without flying on attack trigger', () => {
    // The grantor has the trigger; it grants flying to the target (non-flying co-attacker)
    const grantor = makeCreature(
      'sky-scout',
      'Sky Scout',
      'Whenever ~ attacks, target attacking creature without flying gains flying until end of turn.',
    );
    // A non-flying creature that will co-attack
    const nonFlier = makeCreature('ground-troop', 'Ground Troop', '');
    const land1 = makeLand('m1');
    const land2 = makeLand('m2');
    const p2Land = makeLand('m3');

    let state = createGame([grantor, nonFlier, land1, land2], [p2Land]);

    const grantorInst = findCard(state, 'sky-scout');
    const nonFlierInst = findCard(state, 'ground-troop');

    state = moveToBattlefield(state, grantorInst.instanceId);
    state = moveToBattlefield(state, nonFlierInst.instanceId);
    state = registerBattlefieldAbilities(state, grantorInst.instanceId);
    state = registerBattlefieldAbilities(state, nonFlierInst.instanceId);
    state = setupCombat(state);

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: grantorInst.instanceId, defendingPlayerId: 'p2' },
      { cardInstanceId: nonFlierInst.instanceId, defendingPlayerId: 'p2' },
    ]);

    // The trigger should be pending
    expect(state.pendingTriggers).toHaveLength(1);
    const trigger = state.pendingTriggers[0];

    // The trigger's spec should have combatStatus=attacking and lacksKeywords=['flying']
    const spec = (trigger.requiredTargets as TargetSpec[])[0];
    expect(spec.constraints?.combatStatus).toBe('attacking');
    expect(spec.constraints?.lacksKeywords).toContain('flying');

    // Target the non-flier (it's attacking and has no flying)
    state = putTriggersOnStack(state, {
      [trigger.id]: [nonFlierInst.instanceId],
    });
    state = resolveTopOfStack(state);

    // The non-flier should now have flying in its grantedKeywords
    const nonFlierCard = state.cards.get(nonFlierInst.instanceId)!;
    expect(nonFlierCard.grantedKeywords).toContain('Flying');
  });
});
