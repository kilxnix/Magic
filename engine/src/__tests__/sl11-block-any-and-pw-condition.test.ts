/**
 * Slice 11 — two honest oracle-parser additions:
 *
 * A) "can block any number of creatures" (Fog Elemental / Glare Rider family)
 *    Executor: combat.ts maxAttackersCreatureCanBlock returns 99.
 *
 * B) "as long as you control a <PlaneswalkerSubtype> planeswalker, …"
 *    (Guardian of the Great Conduit / Bond of Revival riders family)
 *    Executor: evaluateCondition → ControlsType → matchesCardFilter with
 *    filter { types: ['planeswalker'], subtypes: [name] }.
 *
 * Section C (historically "declined patterns") — now updated for Slice 10:
 *   - "This creature must be blocked if able." → Slice 10 widened LURE_STATIC_SELF_RE;
 *     now parses as StaticAbility(MustBeBlockedIfAble) with enforcement in combat.ts.
 *   - "All creatures able to block ~ do so." (Lure proper) → StaticAbility (slice 7).
 *   - "You have hexproof" → StaticAbility(PlayerHexproof) (slice 5).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { getCardsInZone, initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { declareAttackers, declareBlockers } from '../combat';
import type { CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function creature(id: string, oracle: string, extra: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: id,
    type_line: extra.type_line ?? 'Creature — Test',
    oracle_text: oracle,
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
    ...extra,
  };
}

function planeswalker(id: string, subtypeName: string): CardDefinition {
  return {
    id,
    name: id,
    type_line: `Legendary Planeswalker — ${subtypeName}`,
    oracle_text: '',
    mana_cost: '{3}{G}',
    cmc: 4,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['planeswalker'],
    power: undefined as any,
    toughness: undefined as any,
  };
}

/**
 * Set up a two-player combat state.
 * p1 controls `attackerDef`, p2 controls `blockerDef`.
 */
function setupCombat(attackerDef: CardDefinition, blockerDef: CardDefinition) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: [attackerDef], commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [blockerDef], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);
  for (const [id, card] of state.cards) {
    state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
  }
  state = { ...state, phase: 'combat', step: 'declare_attackers' };

  const attackerId = getCardsInZone(state, 'p1', 'battlefield')
    .find(c => state.cards.get(c.instanceId)!.definitionId === attackerDef.id)!.instanceId;
  const blockerId = getCardsInZone(state, 'p2', 'battlefield')
    .find(c => state.cards.get(c.instanceId)!.definitionId === blockerDef.id)!.instanceId;
  return { state, attackerId, blockerId };
}

/**
 * Set up p1's permanents on the battlefield with continuous abilities registered.
 */
function setupStatic(p1Defs: CardDefinition[], p2Defs: CardDefinition[] = [creature('dummy', '')]) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];
  let state = initGameState(decks);
  for (const [id, card] of state.cards) {
    state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
  }
  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }
  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;
  return { state, idFor };
}

// ===========================================================================
// A) "can block any number of creatures"
// ===========================================================================

describe('Slice 11 A: "can block any number of creatures" — parser recognition', () => {
  it('Fog Elemental: plain "can block any number of creatures" form parses as StaticAbility', () => {
    const r = parseOracleText('This creature can block any number of creatures.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'CanBlockAnyNumber' });
    expect(r.ability.selfOnly).toBe(true);
  });

  it('Sauron\'s Fell Beast: "can block any number of creatures each combat" variant parses', () => {
    const r = parseOracleText(
      'Flying\nThis creature can block any number of creatures each combat.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'CanBlockAnyNumber' });
  });

  it('Glare Rider compound: keyword line absorbed, "can block any number" still parses', () => {
    const r = parseOracleText(
      'Vigilance\nThis creature can block any number of creatures.',
    );
    expect(r.kind).toBe('StaticAbility');
  });
});

describe('Slice 11 A: "can block any number of creatures" — combat enforcement', () => {
  it('blocker with "can block any number" may block two attackers simultaneously', () => {
    // Two separate attackers; one "any number" blocker — should be able to block both.
    // We test that blocking two attackers doesn't throw.
    const attDef1 = creature('atk1', '');
    const attDef2 = creature('atk2', '');
    const blockDef = creature(
      'glare-rider',
      'Vigilance\nThis creature can block any number of creatures.',
    );

    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [attDef1, attDef2], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [blockDef], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    for (const [id, card] of state.cards) {
      state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
    }
    state = { ...state, phase: 'combat', step: 'declare_attackers' };

    const atk1Id = getCardsInZone(state, 'p1', 'battlefield')
      .find(c => state.cards.get(c.instanceId)!.definitionId === attDef1.id)!.instanceId;
    const atk2Id = getCardsInZone(state, 'p1', 'battlefield')
      .find(c => state.cards.get(c.instanceId)!.definitionId === attDef2.id)!.instanceId;
    const blocker = getCardsInZone(state, 'p2', 'battlefield')
      .find(c => state.cards.get(c.instanceId)!.definitionId === blockDef.id)!.instanceId;

    const afterAttack = declareAttackers(state, 'p1', [
      { cardInstanceId: atk1Id, defendingPlayerId: 'p2' },
      { cardInstanceId: atk2Id, defendingPlayerId: 'p2' },
    ]);

    // Blocking BOTH attackers must not throw — the blocker can block any number.
    expect(() =>
      declareBlockers(afterAttack, 'p2', [
        { cardInstanceId: blocker, blockingAttackerId: atk1Id },
        { cardInstanceId: blocker, blockingAttackerId: atk2Id },
      ]),
    ).not.toThrow();

    const afterBlock = declareBlockers(afterAttack, 'p2', [
      { cardInstanceId: blocker, blockingAttackerId: atk1Id },
      { cardInstanceId: blocker, blockingAttackerId: atk2Id },
    ]);
    expect(afterBlock.combat!.blockers).toHaveLength(2);
  });

  it('blocker WITHOUT "can block any number" cannot block two attackers simultaneously', () => {
    // Confirm the vanilla creature still throws when blocking two attackers.
    const attDef1 = creature('atk1b', '');
    const attDef2 = creature('atk2b', '');
    const blockDef = creature('vanilla-blocker', '');

    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [attDef1, attDef2], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [blockDef], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    for (const [id, card] of state.cards) {
      state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
    }
    state = { ...state, phase: 'combat', step: 'declare_attackers' };

    const atk1Id = getCardsInZone(state, 'p1', 'battlefield')
      .find(c => state.cards.get(c.instanceId)!.definitionId === attDef1.id)!.instanceId;
    const atk2Id = getCardsInZone(state, 'p1', 'battlefield')
      .find(c => state.cards.get(c.instanceId)!.definitionId === attDef2.id)!.instanceId;
    const blocker = getCardsInZone(state, 'p2', 'battlefield')
      .find(c => state.cards.get(c.instanceId)!.definitionId === blockDef.id)!.instanceId;

    const afterAttack = declareAttackers(state, 'p1', [
      { cardInstanceId: atk1Id, defendingPlayerId: 'p2' },
      { cardInstanceId: atk2Id, defendingPlayerId: 'p2' },
    ]);

    expect(() =>
      declareBlockers(afterAttack, 'p2', [
        { cardInstanceId: blocker, blockingAttackerId: atk1Id },
        { cardInstanceId: blocker, blockingAttackerId: atk2Id },
      ]),
    ).toThrow();
  });
});

// ===========================================================================
// B) "as long as you control a <PlaneswalkerSubtype> planeswalker, …"
// ===========================================================================

describe('Slice 11 B: planeswalker-subtype conditional buff — parser recognition', () => {
  it('Guardian of the Great Conduit: "as long as you control a Nissa planeswalker, +2/+0 and vigilance"', () => {
    const r = parseOracleText(
      'As long as you control a Nissa planeswalker, this creature gets +2/+0 and has vigilance.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 0 });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toEqual(expect.objectContaining({
      kind: 'ControlsType',
      controller: 'you',
      filter: expect.objectContaining({ types: ['planeswalker'], subtypes: ['nissa'] }),
    }));
  });

  it('Chandra-linked buff: "As long as you control a Chandra planeswalker, this creature has haste."', () => {
    const r = parseOracleText(
      'As long as you control a Chandra planeswalker, this creature has haste.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual(expect.objectContaining({
      kind: 'ControlsType',
      filter: expect.objectContaining({ types: ['planeswalker'], subtypes: ['chandra'] }),
    }));
  });

  it('Jace-linked buff: suffix form "gets +1/+1 as long as you control a Jace planeswalker"', () => {
    const r = parseOracleText(
      'This creature gets +1/+1 as long as you control a Jace planeswalker.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.condition).toEqual(expect.objectContaining({
      kind: 'ControlsType',
      filter: expect.objectContaining({ types: ['planeswalker'], subtypes: ['jace'] }),
    }));
  });
});

describe('Slice 11 B: planeswalker-subtype conditional buff — executor enforcement', () => {
  it('Guardian of the Great Conduit: +2/+0 buff is live when a Nissa is on the battlefield', () => {
    const guardianDef = creature('guardian', 'As long as you control a Nissa planeswalker, this creature gets +2/+0 and has vigilance.');
    const nissaDef = planeswalker('nissa', 'Nissa');

    const { state, idFor } = setupStatic([guardianDef, nissaDef]);
    const guardianId = idFor('guardian');

    // With a Nissa on the battlefield, +2/+0 applies.
    expect(getEffectivePower(state, guardianId)).toBe(4);    // 2 base + 2
    expect(getEffectiveToughness(state, guardianId)).toBe(2); // 2 base + 0
  });

  it('Guardian of the Great Conduit: buff is absent when no Nissa is present', () => {
    const guardianDef = creature('guardian2', 'As long as you control a Nissa planeswalker, this creature gets +2/+0 and has vigilance.');

    const { state, idFor } = setupStatic([guardianDef]);
    const guardianId = idFor('guardian2');

    // Without any Nissa, no buff.
    expect(getEffectivePower(state, guardianId)).toBe(2);
    expect(getEffectiveToughness(state, guardianId)).toBe(2);
  });
});

// ===========================================================================
// C) Honesty: declined patterns produce Unparsed
// ===========================================================================

describe('Slice 11 C: patterns without an executor remain Unparsed', () => {
  it('"This creature must be blocked if able." — Slice 10 added LURE_STATIC_SELF_RE coverage → StaticAbility', () => {
    // Slice 10 widened LURE_STATIC_SELF_RE to match the bare self-static wording
    // (Riveteers Decoy family). combat.ts declareBlockers enforces the forced-block
    // via luredCreatureIds just like the "All creatures able to block ~ do so." form.
    const r = parseOracleText('This creature must be blocked if able.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'MustBeBlockedIfAble' });
  });

  it('"All creatures able to block ~ do so." (Elvish Bard / Lure proper) → StaticAbility (slice 7 added enforcement)', () => {
    // Slice 7 added combat.ts enforcement for lure static abilities; this now
    // parses as StaticAbility (recognition marker 'MustBeBlockedIfAble') backed
    // by real forced-block enforcement in declareBlockers.
    const r = parseOracleText('All creatures able to block this creature do so.');
    expect(r.kind).toBe('StaticAbility');
  });

  it('"You have hexproof." (Crystal Barricade / Leyline of Sanctity) — now parsed via Slice 5 player-hexproof', () => {
    // Slice 5 added matchPlayerHexproof; this face is now a StaticAbility(PlayerHexproof).
    const r = parseOracleText('You have hexproof.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('PlayerHexproof');
  });

  it('"Prevent all noncombat damage to other creatures" — no prevention engine → Unparsed', () => {
    const r = parseOracleText('Prevent all noncombat damage that would be dealt to other creatures you control.');
    expect(r.kind).toBe('Unparsed');
  });
});
