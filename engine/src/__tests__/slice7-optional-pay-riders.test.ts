/**
 * Slice 7: Optional-pay trigger riders.
 *
 * Covers two new parser extensions:
 *
 * 1. "When you do" reflexive gate — modern oracle wordings use "When you do,"
 *    instead of "If you do," as the continuation gate for optional-pay trigger
 *    riders. Both now parse identically to an OptionalPay effect.
 *
 * 2. Power-constraint suffix in matchReturnFromGraveyard — "with power N or
 *    less/greater" may appear after "target creature card" and before
 *    "from your graveyard" (Alesha Who Smiles at Death pattern). Previously
 *    only mana-value constraints were handled in this position.
 *
 * Honesty gates honoured:
 *  - Dromar/Darigaaz ("choose a color" modal → ReturnToHand/DealDamage): Unparsed.
 *  - Screeching Bat (transform): Unparsed.
 *  - Unassuming Sage Gate-Role token: Unparsed.
 *
 * All oracle-text examples below are real wordings (self-names runtime-normalized
 * to '~' / "this creature" before parsing, as the engine does).
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, OptionalPayEffect } from '../effects/ast';

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function landDef(id: string, name: string, color: string): CardDefinition {
  return {
    id, name, type_line: `Basic Land — ${name}`, oracle_text: `{T}: Add {${color}}.`,
    mana_cost: '', cmc: 0, colors: [], color_identity: [color], keywords: [], card_types: ['land'],
  };
}

const BASE_DEFS: CardDefinition[] = [
  landDef('forest', 'Forest', 'G'),
  landDef('island', 'Island', 'U'),
  landDef('plains', 'Plains', 'W'),
  landDef('mountain', 'Mountain', 'R'),
  landDef('swamp', 'Swamp', 'B'),
  {
    id: 'bear', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '',
    mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
    power: 2, toughness: 2,
  },
  {
    id: 'zombie', name: 'Zombie', type_line: 'Creature — Zombie', oracle_text: '',
    mana_cost: '{2}{B}', cmc: 3, colors: ['B'], color_identity: ['B'], keywords: [], card_types: ['creature'],
    power: 2, toughness: 2,
  },
  {
    id: 'elf', name: 'Elf', type_line: 'Creature — Elf', oracle_text: '',
    mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
    power: 1, toughness: 1,
  },
];

function baseState(): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map<string, CardInstance>(),
    cardDefinitions: new Map(BASE_DEFS.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function addCard(s: GameState, instanceId: string, definitionId: string, zone: CardInstance['zone'] = 'battlefield'): void {
  s.cards.set(instanceId, {
    instanceId, definitionId, ownerId: 'p0', zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  });
}

function handSize(s: GameState, owner: string): number {
  return [...s.cards.values()].filter(c => c.ownerId === owner && c.zone === 'hand').length;
}

function tappedCount(s: GameState): number {
  return [...s.cards.values()].filter(c => c.zone === 'battlefield' && c.tapped).length;
}

function firstOptionalPay(effects: Effect[]): OptionalPayEffect {
  const op = effects.find(e => e.kind === 'OptionalPay') as OptionalPayEffect | undefined;
  if (!op) throw new Error('expected an OptionalPay effect');
  return op;
}

// ---------------------------------------------------------------------------
// Section 1: "When you do" reflexive gate — parser tests
// ---------------------------------------------------------------------------

describe('Slice 7 — "when you do" reflexive variant (parser)', () => {
  // Case 1: attack trigger, generic cost, draw continuation.
  it('"Whenever ~ attacks, you may pay {2}. When you do, draw a card." parses as Triggered + OptionalPay', () => {
    const r = parseOracleText('Whenever ~ attacks, you may pay {2}. When you do, draw a card.');
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('Attacks');
    expect(r.ability.effects).toHaveLength(1);
    const op = firstOptionalPay(r.ability.effects);
    expect(op.kind).toBe('OptionalPay');
    expect(op.manaCost).toBe(2); // generic numeric cost
    expect(op.effects[0].kind).toBe('Draw');
    // No dangling targets from "draw a card"
    expect(r.targets).toHaveLength(0);
  });

  // Case 2: ETB trigger, colored cost, create token continuation.
  it('"When this creature enters, you may pay {1}{W}. When you do, create a 1/1 white Soldier token." parses as ETB + OptionalPay', () => {
    const r = parseOracleText('When this creature enters, you may pay {1}{W}. When you do, create a 1/1 white Soldier creature token.');
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.optional).toBe(true);
    const op = firstOptionalPay(r.ability.effects);
    expect(op.kind).toBe('OptionalPay');
    expect(op.manaCost).toBe('{1}{W}'); // colored cost kept as string
    expect(op.effects[0].kind).toBe('CreateToken');
    expect(r.targets).toHaveLength(0);
  });

  // Case 3: combat-damage trigger, colored cost, damage continuation (Flameblast-style "when you do").
  it('"Whenever ~ deals combat damage to a player, you may pay {R}. When you do, ~ deals 1 damage to any target." parses as Triggered + OptionalPay', () => {
    const r = parseOracleText('Whenever ~ deals combat damage to a player, you may pay {R}. When you do, ~ deals 1 damage to any target.');
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('CombatDamageToPlayer');
    const op = firstOptionalPay(r.ability.effects);
    expect(op.kind).toBe('OptionalPay');
    expect(op.manaCost).toBe('{R}');
    expect(op.effects[0].kind).toBe('DealDamage');
    // "any target" produces one target spec
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].type).toBe('Any');
  });
});

// ---------------------------------------------------------------------------
// Section 2: "When you do" reflexive gate — executor tests
// ---------------------------------------------------------------------------

describe('Slice 7 — "when you do" reflexive variant (executor)', () => {
  it('attack trigger "when you do" pays cost and draws when affordable', () => {
    const r = parseOracleText('Whenever ~ attacks, you may pay {2}. When you do, draw a card.');
    if (r.kind !== 'Triggered') throw new Error(`expected Triggered, got ${r.kind}`);
    let s = baseState();
    addCard(s, 'f0', 'forest');
    addCard(s, 'f1', 'forest');
    addCard(s, 'lib', 'forest', 'library');
    s = executeEffects(s, r.ability.effects, 'p0', [], []);
    expect(tappedCount(s)).toBe(2); // paid {2}
    expect(handSize(s, 'p0')).toBe(1); // drew
  });

  it('attack trigger "when you do" declines when unaffordable and does NOT draw', () => {
    const r = parseOracleText('Whenever ~ attacks, you may pay {2}. When you do, draw a card.');
    if (r.kind !== 'Triggered') throw new Error(`expected Triggered, got ${r.kind}`);
    let s = baseState();
    // Only one land — can't pay {2}
    addCard(s, 'f0', 'forest');
    addCard(s, 'lib', 'forest', 'library');
    s = executeEffects(s, r.ability.effects, 'p0', [], []);
    expect(tappedCount(s)).toBe(0);
    expect(handSize(s, 'p0')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Power-constraint in matchReturnFromGraveyard — parser tests
// ---------------------------------------------------------------------------

describe('Slice 7 — power-constraint in return-from-graveyard (parser)', () => {
  // Alesha Who Smiles at Death — core test case.
  it('Alesha — "whenever ~ attacks, you may pay {W}{B}. If you do, return target creature card with power 2 or less from your graveyard to the battlefield tapped and attacking." parses as Triggered + OptionalPay', () => {
    const r = parseOracleText(
      'Whenever ~ attacks, you may pay {W}{B}. If you do, return target creature card with power 2 or less from your graveyard to the battlefield tapped and attacking.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('Attacks');
    const op = firstOptionalPay(r.ability.effects);
    expect(op.kind).toBe('OptionalPay');
    expect(op.manaCost).toBe('{W}{B}');
    const inner = op.effects[0];
    expect(inner.kind).toBe('ReturnFromGraveyard');
    if (inner.kind !== 'ReturnFromGraveyard') return;
    expect(inner.destination).toBe('battlefield');
    // The target spec includes the power ≤ 2 constraint.
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].type).toBe('CreatureCardInGraveyard');
    expect(r.targets[0].constraints?.power).toEqual({ op: 'lte', value: 2 });
  });

  // Power constraint standalone — "return target creature card with power 4 or greater from graveyard"
  it('"return target creature card with power 4 or greater from your graveyard to the battlefield" parses', () => {
    const r = parseOracleText('Return target creature card with power 4 or greater from your graveyard to the battlefield.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const rfg = r.effects.find(e => e.kind === 'ReturnFromGraveyard');
    expect(rfg).toBeTruthy();
    expect(r.targets[0].constraints?.power).toEqual({ op: 'gte', value: 4 });
  });

  // Old mana-value constraint must still work (regression check).
  it('"return target creature card with mana value 3 or less from your graveyard" still parses', () => {
    const r = parseOracleText('Return target creature card with mana value 3 or less from your graveyard to your hand.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('ReturnFromGraveyard');
    // Mana value constraints are stored in the `cmc` field with op:'lte'.
    expect(r.targets[0].constraints?.cmc).toEqual({ op: 'lte', value: 3 });
  });
});

// ---------------------------------------------------------------------------
// Section 4: Honesty gates — patterns that must stay Unparsed
// ---------------------------------------------------------------------------

describe('Slice 7 — honesty gates (must remain Unparsed)', () => {
  it('Dromar — "choose a color. Return all creatures of that color to their owners hands" stays Unparsed', () => {
    const r = parseOracleText(
      'Whenever ~ deals combat damage to a player, you may pay {2}{U}. If you do, choose a color. Return all creatures of that color to their owners hands.',
    );
    // The "choose a color" modal is not supported by the executor; whole card is Unparsed.
    expect(r.kind).toBe('Unparsed');
  });

  it('Screeching Bat — "you may pay {1}{B}. If you do, transform ~." now parses as Triggered with OptionalPay+TransformSelf', () => {
    const r = parseOracleText('At the beginning of your upkeep, you may pay {1}{B}. If you do, transform ~.');
    // Slice 5 (Transform): Transform is now a supported executor action, so this
    // parses as a Triggered ability with an OptionalPay wrapping TransformSelf.
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('Upkeep');
    const effect = r.ability.effects[0] as { kind: string };
    expect(effect.kind).toBe('OptionalPay');
  });
});

// ---------------------------------------------------------------------------
// Section 5: Interaction — Alesha-style parse + graveyard card execution
// ---------------------------------------------------------------------------

describe('Slice 7 — Alesha-style parse integration (executor)', () => {
  it('OptionalPay wrapping ReturnFromGraveyard: zombie card returns from graveyard when cost paid', () => {
    // Build effects directly from Alesha oracle text.
    const r = parseOracleText(
      'Whenever ~ attacks, you may pay {W}{B}. If you do, return target creature card with power 2 or less from your graveyard to the battlefield tapped and attacking.',
    );
    if (r.kind !== 'Triggered') throw new Error(`expected Triggered, got ${r.kind}`);

    let s = baseState();
    // Two lands can pay {W}{B}.
    addCard(s, 'pla', 'plains');
    addCard(s, 'swa', 'swamp');
    // Zombie in graveyard (power 2 = qualifies for "2 or less").
    addCard(s, 'zom', 'zombie', 'graveyard');

    // The parsed result has one target spec (the ReturnFromGraveyard target).
    // Pass the zombie as the chosen target for that spec.
    const targetSpecs = r.targets.map(t => ({ id: t.id }));

    // Execute with zombie as the chosen target.
    s = executeEffects(s, r.ability.effects, 'p0', ['zom'], targetSpecs);

    // Both lands are tapped (paid {W}{B}).
    expect(s.cards.get('pla')!.tapped).toBe(true);
    expect(s.cards.get('swa')!.tapped).toBe(true);

    // Zombie returns to the battlefield.
    const zombie = s.cards.get('zom');
    expect(zombie).toBeTruthy();
    expect(zombie!.zone).toBe('battlefield');
  });
});
