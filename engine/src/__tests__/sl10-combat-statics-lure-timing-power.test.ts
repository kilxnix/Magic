/**
 * Slice 10 — three honest combat-static additions:
 *
 * A) "This creature must be blocked if able." — bare self-lure static
 *    (Riveteers Decoy family). Widened LURE_STATIC_SELF_RE so combat.ts already
 *    enforces the forced-block via luredCreatureIds. Parser: StaticAbility with
 *    GrantKeyword 'MustBeBlockedIfAble'.
 *
 * B) "Cast this spell only during the declare blockers step." — cast-timing gate
 *    (Mirror Match family). Parser: StaticAbility with CastOnlyDuringDeclareBlockers.
 *    Enforcement: canCastSpell (stack.ts) returns false when state.step ≠ 'declare_blockers'.
 *
 * C) "Creatures with power less than this creature's power can't block it." —
 *    power-comparison block restriction (Wandering Wolf family).
 *    Parser: StaticAbility with PowerLessThanThisCantBlock. Enforcement: canBlock
 *    (keywords.ts) returns false when blockerPower < attackerPower.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { canBlock } from '../keywords';
import { canCastSpell } from '../stack';
import { initGameState, getCardsInZone } from '../game-state';
import { declareAttackers, declareBlockers } from '../combat';
import type { CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(
  id: string,
  opts: Partial<CardDefinition> & { zone?: string } = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Instant',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{1}{U}',
    cmc: opts.cmc ?? 2,
    colors: opts.colors ?? ['U'],
    color_identity: opts.color_identity ?? ['U'],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['instant'],
    power: opts.power,
    toughness: opts.toughness,
  };
}

function creature(
  id: string,
  power: number,
  toughness: number,
  oracle: string = '',
): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Test',
    oracle_text: oracle,
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
  };
}

/**
 * Build a two-player combat state.
 * p1 controls attackerDef (not summoning sick), p2 controls blockerDef.
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

  const attackerId = getCardsInZone(state, 'p1', 'battlefield').find(
    c => state.cards.get(c.instanceId)!.definitionId === attackerDef.id,
  )!.instanceId;
  const blockerId = getCardsInZone(state, 'p2', 'battlefield').find(
    c => state.cards.get(c.instanceId)!.definitionId === blockerDef.id,
  )!.instanceId;
  return { state, attackerId, blockerId };
}

/**
 * Build a state with spellDef in p1's hand at the given step/phase.
 * p1 has plenty of mana.
 */
function setupSpell(
  spellDef: CardDefinition,
  step: string,
  phase: string = 'combat',
  activePlayerIndex: number = 0,
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: [spellDef], commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [creature('dummy', 1, 1)], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);

  // Move the spell to p1's hand
  const spellInstance = getCardsInZone(state, 'p1', 'library').find(
    c => state.cards.get(c.instanceId)!.definitionId === spellDef.id,
  )!;
  state.cards.set(spellInstance.instanceId, { ...spellInstance, zone: 'hand' });

  state = {
    ...state,
    phase: phase as any,
    step: step as any,
    activePlayerIndex,
    priorityPlayerIndex: 0,
    players: state.players.map(p =>
      p.id === 'p1'
        ? { ...p, manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 } }
        : p,
    ),
  };
  return { state, spellId: spellInstance.instanceId };
}

// ===========================================================================
// A) Bare self-lure: "This creature must be blocked if able."
// ===========================================================================

describe('Slice 10 A: "This creature must be blocked if able." — parser recognition', () => {
  it('Riveteers Decoy: bare self-static parses as StaticAbility (MustBeBlockedIfAble)', () => {
    const r = parseOracleText('This creature must be blocked if able. Blitz {3}{G}');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'MustBeBlockedIfAble' });
    expect(r.ability.selfOnly).toBe(true);
  });

  it('Bare lure without trailing keyword also parses', () => {
    const r = parseOracleText('This creature must be blocked if able.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'MustBeBlockedIfAble' });
  });

  it('Still recognises the existing "All creatures able to block ~ do so." form', () => {
    const r = parseOracleText('All creatures able to block ~ do so.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'MustBeBlockedIfAble' });
  });

  it('Still recognises "All creatures able to block this creature do so." form', () => {
    const r = parseOracleText('All creatures able to block this creature do so.');
    expect(r.kind).toBe('StaticAbility');
  });
});

describe('Slice 10 A: bare self-lure — combat enforcement via luredCreatureIds', () => {
  it('bare-lure attacker forces all eligible blockers to block it', () => {
    const riveteers = creature('riveteers', 2, 1, 'This creature must be blocked if able.');
    const blockerDef = creature('blocker', 1, 1, '');
    const { state, attackerId, blockerId } = setupCombat(riveteers, blockerDef);

    const afterAttack = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerId, defendingPlayerId: 'p2' },
    ]);

    // The forced-block rule: p2's blocker must block riveteers (lure rule enforced by combat.ts).
    // declareBlockers should NOT throw when the blocker correctly blocks the lured attacker.
    expect(() =>
      declareBlockers(afterAttack, 'p2', [
        { cardInstanceId: blockerId, blockingAttackerId: attackerId },
      ]),
    ).not.toThrow();

    // Attempting to declare NO blockers when an eligible blocker exists should fail
    // (combat.ts lure enforcement: luredCreatureIds forces block).
    expect(() => declareBlockers(afterAttack, 'p2', [])).toThrow();
  });

  it('old "All creatures able to block ~ do so." form still enforces forced-block', () => {
    const lureCreature = creature('elvish-bard', 1, 1, 'All creatures able to block ~ do so.');
    const blockerDef = creature('blocker', 1, 1, '');
    const { state, attackerId, blockerId } = setupCombat(lureCreature, blockerDef);

    const afterAttack = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerId, defendingPlayerId: 'p2' },
    ]);
    expect(() => declareBlockers(afterAttack, 'p2', [])).toThrow();
    expect(() =>
      declareBlockers(afterAttack, 'p2', [
        { cardInstanceId: blockerId, blockingAttackerId: attackerId },
      ]),
    ).not.toThrow();
  });
});

// ===========================================================================
// B) "Cast this spell only during the declare blockers step."
// ===========================================================================

describe('Slice 10 B: "Cast this spell only during the declare blockers step." — parser', () => {
  it('Mirror Match leading restriction sentence parses as StaticAbility', () => {
    const r = parseOracleText('Cast this spell only during the declare blockers step.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'CastOnlyDuringDeclareBlockers' });
    expect(r.ability.selfOnly).toBe(true);
  });

  it('case-insensitive matching works', () => {
    const r = parseOracleText('Cast This Spell Only During The Declare Blockers Step.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('CastOnlyDuringDeclareBlockers');
  });
});

describe('Slice 10 B: cast-timing — canCastSpell enforcement', () => {
  const mirrorMatchDef = makeCard('mirror-match', {
    type_line: 'Instant',
    card_types: ['instant'],
    oracle_text: 'Cast this spell only during the declare blockers step.',
    mana_cost: '{3}{U}',
    cmc: 4,
    colors: ['U'],
    color_identity: ['U'],
  });

  it('can cast during declare_blockers step', () => {
    const { state, spellId } = setupSpell(mirrorMatchDef, 'declare_blockers', 'combat', 0);
    expect(canCastSpell(state, 'p1', spellId)).toBe(true);
  });

  it('CANNOT cast during declare_attackers step', () => {
    const { state, spellId } = setupSpell(mirrorMatchDef, 'declare_attackers', 'combat', 0);
    expect(canCastSpell(state, 'p1', spellId)).toBe(false);
  });

  it('CANNOT cast during precombat_main phase (upkeep step)', () => {
    const { state, spellId } = setupSpell(mirrorMatchDef, 'upkeep', 'beginning', 0);
    expect(canCastSpell(state, 'p1', spellId)).toBe(false);
  });

  it('CANNOT cast during postcombat_main phase', () => {
    const { state, spellId } = setupSpell(mirrorMatchDef, 'main', 'postcombat_main', 0);
    expect(canCastSpell(state, 'p1', spellId)).toBe(false);
  });

  it('a plain instant (no restriction) CAN be cast during declare_attackers step', () => {
    const plainInstant = makeCard('plain-instant', {
      oracle_text: 'Draw a card.',
      mana_cost: '{1}{U}',
      cmc: 2,
    });
    const { state, spellId } = setupSpell(plainInstant, 'declare_attackers', 'combat', 0);
    expect(canCastSpell(state, 'p1', spellId)).toBe(true);
  });
});

// ===========================================================================
// C) "Creatures with power less than this creature's power can't block it."
// ===========================================================================

describe('Slice 10 C: power-comparison block restriction — parser recognition', () => {
  it("Wandering Wolf wording parses as StaticAbility (PowerLessThanThisCantBlock)", () => {
    const r = parseOracleText(
      "Creatures with power less than this creature's power can't block it.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'PowerLessThanThisCantBlock' });
    expect(r.ability.selfOnly).toBe(true);
  });

  it('"cannot block it" variant also parses', () => {
    const r = parseOracleText(
      "Creatures with power less than this creature's power cannot block it.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('PowerLessThanThisCantBlock');
  });

  it('"can\'t block this creature" variant also parses', () => {
    const r = parseOracleText(
      "Creatures with power less than this creature's power can't block this creature.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('PowerLessThanThisCantBlock');
  });
});

describe('Slice 10 C: power-comparison — canBlock enforcement', () => {
  const wolfDef = creature('wandering-wolf', 3, 2, "Creatures with power less than this creature's power can't block it.");

  it('blocker with power < attacker power CANNOT block (power 2 vs attacker 3)', () => {
    const blockerDef = creature('small-blocker', 2, 2);
    const { state, attackerId, blockerId } = setupCombat(wolfDef, blockerDef);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('blocker with power = attacker power CAN block (power 3 vs attacker 3)', () => {
    const blockerDef = creature('equal-blocker', 3, 3);
    const { state, attackerId, blockerId } = setupCombat(wolfDef, blockerDef);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);
  });

  it('blocker with power > attacker power CAN block (power 4 vs attacker 3)', () => {
    const blockerDef = creature('big-blocker', 4, 4);
    const { state, attackerId, blockerId } = setupCombat(wolfDef, blockerDef);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);
  });

  it('declareBlockers throws when small-power blocker tries to block wolf', () => {
    const blockerDef = creature('small-blocker2', 1, 5);
    const { state, attackerId, blockerId } = setupCombat(wolfDef, blockerDef);
    const afterAttack = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerId, defendingPlayerId: 'p2' },
    ]);
    expect(() =>
      declareBlockers(afterAttack, 'p2', [
        { cardInstanceId: blockerId, blockingAttackerId: attackerId },
      ]),
    ).toThrow();
  });

  it('vanilla attacker (no restriction): small-power blocker CAN block', () => {
    const vanillaAttacker = creature('vanilla-attacker', 3, 3);
    const smallBlocker = creature('small-blocker3', 1, 1);
    const { state, attackerId, blockerId } = setupCombat(vanillaAttacker, smallBlocker);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);
  });

  it('power 0 blocker cannot block a power-1 wolf (edge: 0 < 1)', () => {
    const tinyWolf = creature('tiny-wolf', 1, 1, "Creatures with power less than this creature's power can't block it.");
    const blockerDef = creature('zero-power-blocker', 0, 5);
    const { state, attackerId, blockerId } = setupCombat(tinyWolf, blockerDef);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });
});
