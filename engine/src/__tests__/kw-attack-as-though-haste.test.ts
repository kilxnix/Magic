import { describe, it, expect } from 'vitest';
import { canDeclareAttacker, declareAttackers } from '../combat';
import { canAttackThisTurn, instanceHasKeyword } from '../keywords';
import { getCardsInZone, initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { parseOracleText } from '../effects/parser';
import type { CardDefinition } from '../types';

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
 * p1 controls every supplied definition, all on the battlefield and SUMMONING
 * SICK (entered this turn). We are in p1's declare-attackers step. Continuous
 * static abilities are registered for each permanent exactly as the real ETB
 * pipeline does (registerContinuousAbilitiesForPermanent).
 */
function setup(defs: CardDefinition[]) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: defs, commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [creature('dummy')], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);
  for (const [id, card] of state.cards) {
    if (card.ownerId === 'p1') {
      state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: true });
    }
  }
  state = { ...state, phase: 'combat', step: 'declare_attackers' };

  // Register statics the way ETB does.
  for (const c of getCardsInZone(state, 'p1', 'battlefield')) {
    state = registerContinuousAbilitiesForPermanent(state, c.instanceId);
  }

  const idFor = (defId: string) =>
    getCardsInZone(state, 'p1', 'battlefield')
      .find(c => state.cards.get(c.instanceId)!.definitionId === defId)!.instanceId;

  return { state, idFor };
}

describe('"can attack as though it had haste" — parser recognition', () => {
  it('recognizes the self form as a StaticAbility granting Haste', () => {
    const r = parseOracleText('~ can attack as though it had haste.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'Haste' });
    expect(r.ability.selfOnly).toBe(true);
  });

  it('recognizes the team form ("Creatures you control ... they had haste")', () => {
    const r = parseOracleText('Creatures you control can attack as though they had haste.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'Haste' });
    expect(r.ability.filter).toEqual({ types: ['creature'] });
    expect(r.ability.controller).toBe('you');
  });

  it('recognizes the "Other creatures you control" exclude-self form', () => {
    const r = parseOracleText('Other creatures you control can attack as though they had haste.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.excludeSelf).toBe(true);
  });

  it('a plain summoning-sick creature without the text is still NOT recognized as this static', () => {
    expect(parseOracleText('').kind).toBe('Unparsed');
  });
});

describe('"can attack as though it had haste" — engine ENFORCES the attack bypass', () => {
  it('a summoning-sick creature with the self static CAN attack this turn', () => {
    const { state, idFor } = setup([
      creature('selfhaste', { oracle: '~ can attack as though it had haste.' }),
    ]);
    const id = idFor('selfhaste');

    // The engine actually grants Haste and lets it attack despite summoning sickness.
    expect(state.cards.get(id)!.summoningSick).toBe(true);
    expect(instanceHasKeyword(state, id, 'Haste')).toBe(true);
    expect(canAttackThisTurn(state, id)).toBe(true);
    expect(canDeclareAttacker(state, 'p1', id)).toBe(true);

    const after = declareAttackers(state, 'p1', [
      { cardInstanceId: id, defendingPlayerId: 'p2' },
    ]);
    expect(after.combat!.attackers.map(a => a.cardInstanceId)).toContain(id);
  });

  it('a summoning-sick creature WITHOUT the static can NOT attack (control)', () => {
    const { state, idFor } = setup([creature('vanilla')]);
    const id = idFor('vanilla');
    expect(instanceHasKeyword(state, id, 'Haste')).toBe(false);
    expect(canAttackThisTurn(state, id)).toBe(false);
    expect(canDeclareAttacker(state, 'p1', id)).toBe(false);
  });

  it('the team form grants the bypass to OTHER summoning-sick creatures you control', () => {
    const { state, idFor } = setup([
      creature('lord', { oracle: 'Creatures you control can attack as though they had haste.' }),
      creature('soldier'),
    ]);
    const soldierId = idFor('soldier');
    // The soldier has no haste text of its own, yet the team static enables it.
    expect(state.cards.get(soldierId)!.summoningSick).toBe(true);
    expect(instanceHasKeyword(state, soldierId, 'Haste')).toBe(true);
    expect(canAttackThisTurn(state, soldierId)).toBe(true);
    expect(canDeclareAttacker(state, 'p1', soldierId)).toBe(true);
  });
});
