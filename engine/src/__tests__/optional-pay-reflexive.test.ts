/**
 * Tests for Slice 4: OptionalPay reflexive trigger tails.
 *
 * Pattern: '<trigger>, you may pay {COST}. If you do, <effect>.'
 *
 * These tests prove that:
 *  1. The parser correctly wraps parseable inner effects in OptionalPay when
 *     a trigger body starts with 'you may pay {COST}. If you do, ...'.
 *  2. The executor honestly runs the inner effects after payment.
 *  3. The new 'each non<color> creature' and 'each <color> creature' mass-damage
 *     patterns in matchDealDamage produce AllOfType + excludeColors/colors and
 *     the DealDamage executor's AllOfType branch applies damage only to matching
 *     battlefield creatures.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import type { Effect, OptionalPayEffect } from '../effects/ast';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Test-state helpers
// ---------------------------------------------------------------------------

type ColorCode = 'W' | 'U' | 'B' | 'R' | 'G';

interface CreatureSpec {
  id: string;
  colors: ColorCode[];
  power?: number;
  toughness?: number;
}

function makeStateWithCreatures(creatures: CreatureSpec[]): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  for (const c of creatures) {
    const defId = `def_${c.id}`;
    const def: CardDefinition = {
      id: defId,
      name: `Creature_${c.id}`,
      type_line: 'Creature — Beast',
      oracle_text: '',
      mana_cost: '{2}',
      cmc: 2,
      colors: c.colors,
      color_identity: c.colors,
      keywords: [],
      card_types: ['creature'],
      power: c.power ?? 2,
      toughness: c.toughness ?? 2,
    };
    const inst: CardInstance = {
      instanceId: c.id,
      definitionId: defId,
      ownerId: 'p0',
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    };
    cards.set(c.id, inst);
    cardDefinitions.set(defId, def);
  }

  // Add an untapped land so the executor can pay mana costs
  const landDef: CardDefinition = {
    id: 'land_def', name: 'Plains', type_line: 'Basic Land — Plains',
    oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['W'],
    keywords: [], card_types: ['land'], power: undefined, toughness: undefined,
  };
  const land1: CardInstance = {
    instanceId: 'land1', definitionId: 'land_def', ownerId: 'p0', zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
  const land2: CardInstance = {
    instanceId: 'land2', definitionId: 'land_def', ownerId: 'p0', zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
  const land3: CardInstance = {
    instanceId: 'land3', definitionId: 'land_def', ownerId: 'p0', zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
  cards.set('land1', land1);
  cards.set('land2', land2);
  cards.set('land3', land3);
  cardDefinitions.set('land_def', landDef);

  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards,
    cardDefinitions,
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

// ---------------------------------------------------------------------------
// Section 1: Parser tests — OptionalPay trigger-tail composition
// ---------------------------------------------------------------------------

describe('OptionalPay reflexive trigger tail: parser', () => {
  // Case 1: Oros, the Avenger
  // "Whenever ~ deals combat damage to a player, you may pay {2}{W}. If you do,
  //  ~ deals 3 damage to each nonwhite creature."
  it('Oros, the Avenger — parses as Triggered + OptionalPay wrapper', () => {
    const r = parseOracleText(
      'Whenever ~ deals combat damage to a player, you may pay {2}{W}. If you do, ~ deals 3 damage to each nonwhite creature.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    const ability = r.ability;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(ability.effects).toHaveLength(1);
    const outer = ability.effects[0] as OptionalPayEffect;
    expect(outer.kind).toBe('OptionalPay');
    // Colored cost kept as canonical mana string
    expect(outer.manaCost).toBe('{2}{W}');
    // Inner effect is DealDamage with AllOfType + excludeColors
    expect(outer.effects).toHaveLength(1);
    const inner = outer.effects[0] as Extract<Effect, { kind: 'DealDamage' }>;
    expect(inner.kind).toBe('DealDamage');
    expect(inner.amount).toBe(3);
    expect(inner.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], excludeColors: ['W'] },
    });
    // No external targets (mass effect needs no choices)
    expect(r.targets).toHaveLength(0);
  });

  // Case 2: Flameblast Dragon
  // "Whenever ~ attacks, you may pay {X}{R}. If you do, ~ deals X damage to any target."
  it('Flameblast Dragon — parses as Triggered + OptionalPay + DealDamage X to any target', () => {
    const r = parseOracleText(
      'Flying\nWhenever ~ attacks, you may pay {X}{R}. If you do, ~ deals X damage to any target.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    const ability = r.ability;
    expect(ability.trigger.kind).toBe('Attacks');
    expect(ability.effects).toHaveLength(1);
    const outer = ability.effects[0] as OptionalPayEffect;
    expect(outer.kind).toBe('OptionalPay');
    // Inner effect targets "any target"
    const inner = outer.effects[0] as Extract<Effect, { kind: 'DealDamage' }>;
    expect(inner.kind).toBe('DealDamage');
    expect(inner.amount).toEqual({ kind: 'X' });
    expect(inner.target.kind).toBe('Chosen');
    // One external target spec of type Any
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].type).toBe('Any');
  });

  // Case 3: Emberwilde Djinn-style
  // "Whenever ~ deals combat damage to a player, you may pay {1}. If you do, you gain 1 life."
  it('Generic mana OptionalPay — pay {1} to gain 1 life on combat damage trigger', () => {
    const r = parseOracleText(
      'Whenever ~ deals combat damage to a player, you may pay {1}. If you do, you gain 1 life.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    const outer = r.ability.effects[0] as OptionalPayEffect;
    expect(outer.kind).toBe('OptionalPay');
    expect(outer.manaCost).toBe(1);
    const inner = outer.effects[0] as Extract<Effect, { kind: 'GainLife' }>;
    expect(inner.kind).toBe('GainLife');
    expect(inner.amount).toBe(1);
  });

  // Case 4: "each nonblue creature" — explicit color variant
  it('deals N damage to each nonblue creature standalone clause', () => {
    const r = parseOracleText('~ deals 2 damage to each nonblue creature.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const e = r.effects[0] as Extract<Effect, { kind: 'DealDamage' }>;
    expect(e.kind).toBe('DealDamage');
    expect(e.amount).toBe(2);
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], excludeColors: ['U'] },
    });
  });

  // Case 5: "each white creature" — color INCLUDE variant
  it('deals N damage to each white creature standalone clause', () => {
    const r = parseOracleText('~ deals 2 damage to each white creature.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const e = r.effects[0] as Extract<Effect, { kind: 'DealDamage' }>;
    expect(e.kind).toBe('DealDamage');
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], colors: ['W'] },
    });
  });

  // Honesty gate: Dromar inner clause ("choose a color. return all creatures of
  // that color") must stay Unparsed — the engine can't resolve a runtime color
  // choice for ReturnToHand without additional subsystem support.
  it('Dromar inner clause honestly stays Unparsed', () => {
    const r = parseOracleText(
      'Whenever ~ deals combat damage to a player, you may pay {2}{U}. If you do, choose a color. Return all creatures of that color to their owners hands.',
    );
    expect(r.kind).toBe('Unparsed');
  });

  // Najal-style reflexive copy: "you may pay {2}. if you do, copy that spell."
  // This parses as OptionalPay → CopySpell, which is honest because CopySpell
  // is a fully supported effect in the executor.
  it('Najal-style OptionalPay copy-that-spell parses successfully', () => {
    const r = parseOracleText(
      'Whenever ~ attacks, you may pay {2}. If you do, copy that spell.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    const outer = r.ability.effects[0] as OptionalPayEffect;
    expect(outer.kind).toBe('OptionalPay');
    expect(outer.manaCost).toBe(2);
    expect(outer.effects[0].kind).toBe('CopySpell');
  });
});

// ---------------------------------------------------------------------------
// Section 2: Executor tests — AllOfType + excludeColors in DealDamage
// ---------------------------------------------------------------------------

describe('OptionalPay reflexive trigger tail: executor', () => {
  // Oros damage: 3 to each nonwhite — white creatures must survive,
  // non-white creatures take 3 damage.
  it('DealDamage AllOfType excludeColors W: damages non-white only', () => {
    const state = makeStateWithCreatures([
      { id: 'white_cre', colors: ['W'], power: 2, toughness: 3 },
      { id: 'red_cre', colors: ['R'], power: 2, toughness: 2 },
      { id: 'green_cre', colors: ['G'], power: 2, toughness: 5 },
      { id: 'colorless_cre', colors: [], power: 2, toughness: 2 },
    ]);

    const effects: Effect[] = [
      {
        kind: 'DealDamage',
        source: { kind: 'ThisSpell' },
        target: { kind: 'AllOfType', filter: { types: ['creature'], excludeColors: ['W'] } },
        amount: 3,
      },
    ];

    const after = executeEffects(state, effects, 'p0', [], []);

    // White creature was excluded — should have 0 damage
    expect(after.cards.get('white_cre')!.damage).toBe(0);
    // Non-white creatures each take 3 damage
    expect(after.cards.get('red_cre')!.damage).toBe(3);
    expect(after.cards.get('green_cre')!.damage).toBe(3);
    expect(after.cards.get('colorless_cre')!.damage).toBe(3);
  });

  // "each white creature" — only white creatures take damage
  it('DealDamage AllOfType colors W: damages white creatures only', () => {
    const state = makeStateWithCreatures([
      { id: 'white_cre', colors: ['W'], power: 2, toughness: 5 },
      { id: 'blue_cre', colors: ['U'], power: 2, toughness: 5 },
      { id: 'wg_cre', colors: ['W', 'G'], power: 2, toughness: 5 },
    ]);

    const effects: Effect[] = [
      {
        kind: 'DealDamage',
        source: { kind: 'ThisSpell' },
        target: { kind: 'AllOfType', filter: { types: ['creature'], colors: ['W'] } },
        amount: 2,
      },
    ];

    const after = executeEffects(state, effects, 'p0', [], []);

    expect(after.cards.get('white_cre')!.damage).toBe(2);
    expect(after.cards.get('blue_cre')!.damage).toBe(0);
    // White-green is white — gets damaged
    expect(after.cards.get('wg_cre')!.damage).toBe(2);
  });

  // Full OptionalPay execution: Oros-style trigger body executed against a state
  // with one white and one red creature. After paying {2}{W}, red creature takes
  // 3 damage; white creature is untouched.
  it('OptionalPay Oros trigger body: executor pays and applies AllOfType damage', () => {
    const state = makeStateWithCreatures([
      { id: 'white_cre', colors: ['W'], power: 2, toughness: 5 },
      { id: 'red_cre', colors: ['R'], power: 2, toughness: 5 },
    ]);

    const innerEffect: Effect = {
      kind: 'DealDamage',
      source: { kind: 'ThisSpell' },
      target: { kind: 'AllOfType', filter: { types: ['creature'], excludeColors: ['W'] } },
      amount: 3,
    };
    const optPay: Effect = {
      kind: 'OptionalPay',
      manaCost: '{2}{W}',
      effects: [innerEffect],
    };

    const after = executeEffects(state, [optPay], 'p0', [], []);

    // Red creature took 3 damage
    expect(after.cards.get('red_cre')!.damage).toBe(3);
    // White creature untouched
    expect(after.cards.get('white_cre')!.damage).toBe(0);
    // Three lands were tapped to pay {2}{W}
    const tappedLands = ['land1', 'land2', 'land3'].filter(id => after.cards.get(id)!.tapped);
    expect(tappedLands).toHaveLength(3);
  });
});
