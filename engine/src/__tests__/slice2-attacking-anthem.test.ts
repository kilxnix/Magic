/**
 * Slice 2: Attacking/blocking-status mass statics
 *   "Attacking creatures get -1/-0"           (Weakstone)
 *   "Attacking creatures you control get +1/+0"  (Orcish Oriflamme)
 *   "Attacking creatures you control have lifelink" (Windbrisk Raptor)
 *   "Attacking creatures you control get +2/+0"  (Nobilis of War)
 *
 * PARSER: matchAttackingAnthem recognises the clause.
 * EXECUTOR: getContinuousPTModification / getGrantedKeywords honour
 *   filter.attacking via combat state.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getCardsInZone, initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { getContinuousPTModification, getGrantedKeywords } from '../effects/continuous';
import { declareAttackers, declareBlockers } from '../combat';
import type { CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function creature(
  id: string,
  opts: { oracle?: string; power?: number; toughness?: number } = {},
): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Test',
    oracle_text: opts.oracle ?? '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

/**
 * Build a two-player combat state in the declare-attackers step.
 * p1 controls all supplied defs; p2 controls a dummy blocker.
 */
function setup(p1Defs: CardDefinition[], p2Defs: CardDefinition[] = []) {
  const blocker = creature('blocker_dummy', { power: 1, toughness: 1 });
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [blocker, ...p2Defs], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);
  // Put everything on the battlefield, not summoning sick (so they can attack).
  for (const [, card] of state.cards) {
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });
  }
  state = { ...state, phase: 'combat', step: 'declare_attackers' };

  // Register statics for all battlefield permanents.
  for (const [, card] of state.cards) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }

  const idFor = (defId: string, ownerId = 'p1') =>
    [...state.cards.values()]
      .find(c => c.definitionId === defId && c.ownerId === ownerId)!.instanceId;

  return { state, idFor };
}

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('matchAttackingAnthem — parser recognition', () => {
  it('Orcish Oriflamme: "Attacking creatures you control get +1/+0."', () => {
    const r = parseOracleText('Attacking creatures you control get +1/+0.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 0 });
    expect(r.ability.filter).toEqual({ types: ['creature'], attacking: true });
    expect(r.ability.controller).toBe('you');
    expect(r.ability.excludeSelf).toBe(false);
  });

  it('Weakstone: "Attacking creatures get -1/-0."', () => {
    const r = parseOracleText('Attacking creatures get -1/-0.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: -1, toughness: 0 });
    expect(r.ability.filter).toEqual({ types: ['creature'], attacking: true });
    expect(r.ability.controller).toBe('any');
  });

  it('Windbrisk Raptor: "Attacking creatures you control have lifelink."', () => {
    const r = parseOracleText('Attacking creatures you control have lifelink.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'lifelink' });
    expect(r.ability.filter).toEqual({ types: ['creature'], attacking: true });
    expect(r.ability.controller).toBe('you');
  });

  it('Nobilis of War: "Attacking creatures you control get +2/+0."', () => {
    const r = parseOracleText('Attacking creatures you control get +2/+0.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 0 });
    expect(r.ability.filter).toEqual({ types: ['creature'], attacking: true });
    expect(r.ability.controller).toBe('you');
  });

  it('Blocking form: "Blocking creatures you control get +0/+1."', () => {
    const r = parseOracleText('Blocking creatures you control get +0/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 0, toughness: 1 });
    expect(r.ability.filter).toEqual({ types: ['creature'], blocking: true });
    expect(r.ability.controller).toBe('you');
  });

  it('"until end of turn" suffix → NOT a static (spell effect)', () => {
    const r = parseOracleText('Attacking creatures you control get +1/+0 until end of turn.');
    // Should be a Spell, not a StaticAbility
    expect(r.kind).not.toBe('StaticAbility');
  });
});

// ---------------------------------------------------------------------------
// Execution tests: getContinuousPTModification honours filter.attacking
// ---------------------------------------------------------------------------

describe('matchAttackingAnthem — engine execution (P/T modification)', () => {
  it('Orcish Oriflamme: attacker gets +1/+0, non-attacker does NOT', () => {
    const { state: s0, idFor } = setup([
      creature('oriflamme', { oracle: 'Attacking creatures you control get +1/+0.' }),
      creature('soldier', { power: 2, toughness: 2 }),
    ]);

    const oriflammeId = idFor('oriflamme');
    const soldierId = idFor('soldier');

    // Before combat: no buff for anyone
    expect(getContinuousPTModification(s0, soldierId)).toEqual({ power: 0, toughness: 0 });

    // Declare soldier as attacker
    const s1 = declareAttackers(s0, 'p1', [
      { cardInstanceId: soldierId, defendingPlayerId: 'p2' },
    ]);

    // Soldier is now an attacker — should get +1/+0
    expect(getContinuousPTModification(s1, soldierId)).toEqual({ power: 1, toughness: 0 });

    // Oriflamme itself is NOT attacking — should get no buff from the static
    // (it could get buffed if it were attacking too, but here we only check non-attacker)
    expect(getContinuousPTModification(s1, oriflammeId)).toEqual({ power: 0, toughness: 0 });
  });

  it('Weakstone (controller:any): debuffs BOTH players\' attackers by -1/-0', () => {
    const { state: s0, idFor } = setup(
      [
        creature('weakstone', { oracle: 'Attacking creatures get -1/-0.' }),
        creature('soldier_p1', { power: 2, toughness: 2 }),
      ],
      [creature('soldier_p2', { power: 2, toughness: 2 })],
    );

    const p1SoldierId = idFor('soldier_p1', 'p1');
    const p2SoldierId = idFor('soldier_p2', 'p2');

    // Declare p1's soldier as attacker
    const s1 = declareAttackers(s0, 'p1', [
      { cardInstanceId: p1SoldierId, defendingPlayerId: 'p2' },
    ]);
    // p1's attacker gets -1/-0
    expect(getContinuousPTModification(s1, p1SoldierId)).toEqual({ power: -1, toughness: 0 });
    // p2's soldier is not attacking yet → no debuff
    expect(getContinuousPTModification(s1, p2SoldierId)).toEqual({ power: 0, toughness: 0 });
  });

  it('Windbrisk Raptor: attacker gains lifelink, non-attacker does NOT', () => {
    const { state: s0, idFor } = setup([
      creature('raptor', { oracle: 'Attacking creatures you control have lifelink.' }),
      creature('warrior', { power: 2, toughness: 2 }),
    ]);

    const warriorId = idFor('warrior');

    // Before attacking: no lifelink
    const kwBefore = getGrantedKeywords(s0, warriorId);
    expect(kwBefore).not.toContain('lifelink');

    // Declare warrior as attacker
    const s1 = declareAttackers(s0, 'p1', [
      { cardInstanceId: warriorId, defendingPlayerId: 'p2' },
    ]);

    // After declaring as attacker: lifelink granted by static
    const kwAfter = getGrantedKeywords(s1, warriorId);
    expect(kwAfter).toContain('lifelink');
  });
});

// ---------------------------------------------------------------------------
// Execution test: blocking filter
// ---------------------------------------------------------------------------

describe('matchAttackingAnthem — engine execution (blocking filter)', () => {
  it('Blocking anthem: blocker gets +0/+1, non-blocker does NOT', () => {
    const p2Attacker = creature('p2attacker', { power: 2, toughness: 2 });

    const { state: s0, idFor } = setup(
      [
        creature('anthem', { oracle: 'Blocking creatures you control get +0/+1.' }),
        creature('defender', { power: 1, toughness: 3 }),
      ],
      [p2Attacker],
    );

    const p1BlockerId = idFor('defender', 'p1');
    const p1AnthemId = idFor('anthem', 'p1');
    const p2AttackerId = idFor('p2attacker', 'p2');

    // Switch active player to p2 so p2 can declare attackers.
    let s1 = { ...s0, activePlayerIndex: 1, step: 'declare_attackers' as const };

    // p2 attacks p1
    s1 = declareAttackers(s1, 'p2', [
      { cardInstanceId: p2AttackerId, defendingPlayerId: 'p1' },
    ]);

    // Advance step to declare_blockers
    s1 = { ...s1, step: 'declare_blockers' as const };

    // p1's defender blocks p2's attacker
    const s2 = declareBlockers(s1, 'p1', [
      { cardInstanceId: p1BlockerId, blockingAttackerId: p2AttackerId },
    ]);

    // p1's defender is now blocking → should get +0/+1
    expect(getContinuousPTModification(s2, p1BlockerId)).toEqual({ power: 0, toughness: 1 });

    // p1's anthem is NOT blocking → no bonus
    expect(getContinuousPTModification(s2, p1AnthemId)).toEqual({ power: 0, toughness: 0 });
  });
});
