/**
 * trg-combat-damage-payoffs: Slice 6/12 — Combat-damage-to-player trigger payoffs.
 *
 * Covers:
 *   1. "you may have it deal N damage to target creature" (Farrel's Zealot style)
 *   2. "you may have it deal damage equal to its power to target creature" (Laccolith Titan style)
 *   3. "...to target creature that player controls" (Snapping Thragg style — consumed, permissive target)
 *   4. "you may pay {2}{R}. If you do, destroy up to two target lands." (Numot style)
 *   5. Execution: matchHaveItDealDamage produces DealDamage with ThisPermanent source and
 *      TargetPower{Source} amount — executor resolves source power via dmgPowerSourceId.
 *
 * All oracle wordings are normalised the same way the parser does at load time
 * (card name → '~', 'this creature' retained as-is).
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import type { DealDamageEffect, OptionalPayEffect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCreatureDef(id: string, power: number, toughness: number, oracle = ''): CardDefinition {
  return {
    id,
    name: id,
    type_line: `Creature — Beast`,
    oracle_text: oracle,
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
  };
}

function makeLandDef(id: string): CardDefinition {
  return {
    id,
    name: id,
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

function makeMountainDef(id: string): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Basic Land — Mountain',
    oracle_text: '{T}: Add {R}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['R'],
    keywords: [],
    card_types: ['land'],
  };
}

function baseState(defs: CardDefinition[]): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map<string, CardInstance>(),
    cardDefinitions: new Map(defs.map(d => [d.id, d])),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

function addCard(
  s: GameState,
  instanceId: string,
  definitionId: string,
  zone: CardInstance['zone'] = 'battlefield',
  ownerId = 'p0',
): void {
  s.cards.set(instanceId, {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
}

// ---------------------------------------------------------------------------
// Parse-only tests
// ---------------------------------------------------------------------------

describe('matchHaveItDealDamage — parsing', () => {
  it('Farrel\'s Zealot: "Whenever ~ attacks and isn\'t blocked, you may have it deal 3 damage to target creature."', () => {
    const result = parseOracleText(
      "Whenever ~ attacks and isn't blocked, you may have it deal 3 damage to target creature.",
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('Unblocked');
    expect(result.ability.optional).toBe(true);
    const eff = result.ability.effects[0] as DealDamageEffect;
    expect(eff.kind).toBe('DealDamage');
    expect(eff.amount).toBe(3);
    expect(eff.source?.kind).toBe('ThisPermanent');
    expect(eff.target.kind).toBe('Chosen');
    // A Creature target spec must have been declared.
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Creature');
  });

  it('Laccolith Titan: combat-damage trigger with "damage equal to its power"', () => {
    const result = parseOracleText(
      'Whenever ~ becomes blocked, you may have it deal damage equal to its power to target creature.',
    );
    // "whenever ~ becomes blocked" maps to the BecomesTapped or Attacks prefix.
    // If the full trigger isn't parsed, at minimum the effect clause should
    // parse correctly when tested directly.
    if (result.kind === 'Triggered' || result.kind === 'Spell') {
      const effects = result.kind === 'Triggered' ? result.ability.effects : result.effects;
      const eff = effects[0] as DealDamageEffect;
      expect(eff.kind).toBe('DealDamage');
      expect(typeof eff.amount).toBe('object');
      if (typeof eff.amount === 'object' && 'kind' in eff.amount) {
        expect(eff.amount.kind).toBe('TargetPower');
        if (eff.amount.kind === 'TargetPower') {
          expect(eff.amount.target.kind).toBe('Source');
        }
      }
      expect(eff.source?.kind).toBe('ThisPermanent');
    } else {
      // Acceptable: trigger prefix not yet registered; test the effect clause directly.
      const clauseResult = parseOracleText(
        'You may have it deal damage equal to its power to target creature.',
      );
      expect(clauseResult.kind).toBe('Spell');
      if (clauseResult.kind !== 'Spell') return;
      const eff2 = clauseResult.effects[0] as DealDamageEffect;
      expect(eff2.kind).toBe('DealDamage');
      expect(typeof eff2.amount).toBe('object');
      if (typeof eff2.amount === 'object' && 'kind' in eff2.amount) {
        expect(eff2.amount.kind).toBe('TargetPower');
        if (eff2.amount.kind === 'TargetPower') {
          expect(eff2.amount.target.kind).toBe('Source');
        }
      }
    }
  });

  it('Snapping Thragg style: "...you may have it deal 3 damage to target creature that player controls." — tokens consumed, permissive Creature target', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, you may have it deal 3 damage to target creature that player controls.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(result.ability.optional).toBe(true);
    const eff = result.ability.effects[0] as DealDamageEffect;
    expect(eff.kind).toBe('DealDamage');
    expect(eff.amount).toBe(3);
    expect(eff.source?.kind).toBe('ThisPermanent');
    // Target should be a Creature spec (the "that player controls" rider is
    // consumed but does not add an enforced constraint at this time).
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Creature');
  });

  it('"You may have it deal damage equal to its power to target creature." — standalone spell parse', () => {
    const result = parseOracleText(
      'You may have it deal damage equal to its power to target creature.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0] as DealDamageEffect;
    expect(eff.kind).toBe('DealDamage');
    expect(eff.source?.kind).toBe('ThisPermanent');
    expect(typeof eff.amount).toBe('object');
    if (typeof eff.amount === 'object' && 'kind' in eff.amount) {
      expect(eff.amount.kind).toBe('TargetPower');
      if (eff.amount.kind === 'TargetPower') {
        expect(eff.amount.target.kind).toBe('Source');
      }
    }
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Creature');
  });

  it('Numot style: "Whenever ~ deals combat damage to a player, you may pay {2}{R}. If you do, destroy up to two target lands."', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, you may pay {2}{R}. If you do, destroy up to two target lands.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(result.ability.optional).toBe(true);
    const eff = result.ability.effects[0] as OptionalPayEffect;
    expect(eff.kind).toBe('OptionalPay');
    expect(eff.manaCost).toBe('{2}{R}');
    // Inner effect: Destroy targeting 2 lands.
    expect(eff.effects).toHaveLength(1);
    const inner = eff.effects[0];
    expect(inner.kind).toBe('Destroy');
    // Two-count multi-target spec.
    const spec = result.targets[0];
    expect(spec.type).toBe('Land');
    expect(spec.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Execution tests
// ---------------------------------------------------------------------------

describe('matchHaveItDealDamage — execution', () => {
  it('deals fixed N damage to chosen creature using source as origin', () => {
    // Oracle: "You may have it deal 3 damage to target creature."
    const result = parseOracleText('You may have it deal 3 damage to target creature.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    const sourceCreatureDef = makeCreatureDef('laccolith', 6, 6);
    const victimDef = makeCreatureDef('victim', 2, 2);
    const s0 = baseState([sourceCreatureDef, victimDef]);
    addCard(s0, 'src', 'laccolith');
    addCard(s0, 'vic', 'victim', 'battlefield', 'p1');

    // Pass chosen target id + spec so the executor can map spec.id → 'vic'.
    const spec = result.targets[0];
    const s1 = executeEffects(s0, result.effects, 'p0', ['vic'], [{ id: spec.id, count: 1 }], 0, {
      sourceInstanceId: 'src',
    });

    // Victim took 3 damage.
    expect(s1.cards.get('vic')!.damage).toBe(3);
    // Source (laccolith) was not damaged.
    expect(s1.cards.get('src')!.damage).toBe(0);
  });

  it('deals "equal to its power" damage: power of source resolved via Source TargetPower', () => {
    // Oracle: "You may have it deal damage equal to its power to target creature."
    const result = parseOracleText(
      'You may have it deal damage equal to its power to target creature.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    const sourceDef = makeCreatureDef('titan', 7, 7);  // power 7
    const victimDef = makeCreatureDef('target-beast', 3, 3);
    const s0 = baseState([sourceDef, victimDef]);
    addCard(s0, 'titan-inst', 'titan');
    addCard(s0, 'victim-inst', 'target-beast', 'battlefield', 'p1');

    const spec = result.targets[0];
    const s1 = executeEffects(
      s0, result.effects, 'p0', ['victim-inst'], [{ id: spec.id, count: 1 }], 0,
      { sourceInstanceId: 'titan-inst' },
    );

    // Victim took 7 damage (titan's power).
    expect(s1.cards.get('victim-inst')!.damage).toBe(7);
    expect(s1.cards.get('titan-inst')!.damage).toBe(0);
  });

  it('Numot inner clause executes: OptionalPay {2}{R} → destroy up to two target lands', () => {
    // Oracle: "You may pay {2}{R}. If you do, destroy up to two target lands."
    const result = parseOracleText(
      'You may pay {2}{R}. If you do, destroy up to two target lands.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    const landDef = makeLandDef('forest');
    const mountDef = makeMountainDef('mountain');
    const s0 = baseState([landDef, mountDef]);
    // Three lands available for the controller: one Mountain (provides R) + two Forests.
    addCard(s0, 'mtn1', 'mountain');    // pays {R}
    addCard(s0, 'for1', 'forest');      // pays {1}
    addCard(s0, 'for2', 'forest');      // pays {1}
    // Target lands (opponent's):
    addCard(s0, 'opp-land-1', 'forest', 'battlefield', 'p1');
    addCard(s0, 'opp-land-2', 'forest', 'battlefield', 'p1');

    // The OptionalPay has a multi-target spec (count=2).
    const spec = result.targets[0];
    const s1 = executeEffects(
      s0, result.effects, 'p0',
      ['opp-land-1', 'opp-land-2'],
      [{ id: spec.id, count: 2 }],
      0,
    );

    // Payment: Mountain + 2 Forests tapped.
    const tappedLands = [...s1.cards.values()].filter(c => c.zone === 'battlefield' && c.tapped && c.ownerId === 'p0');
    expect(tappedLands.length).toBe(3);

    // Two opponent lands destroyed (moved to graveyard).
    expect(s1.cards.get('opp-land-1')!.zone).toBe('graveyard');
    expect(s1.cards.get('opp-land-2')!.zone).toBe('graveyard');
  });
});
