import { describe, it, expect } from 'vitest';
import { canDeclareBlocker, declareAttackers, declareBlockers } from '../combat';
import { canBlock, hasActiveLandwalk } from '../keywords';
import { getCardsInZone, initGameState } from '../game-state';
import { parseOracleText } from '../effects/parser';
import type { CardDefinition } from '../types';

function attacker(keywords: string[], oracle = ''): CardDefinition {
  return {
    id: 'walker',
    name: 'Walker',
    type_line: 'Creature — Horror',
    oracle_text: oracle,
    mana_cost: '{2}{B}',
    cmc: 3,
    colors: ['B'],
    color_identity: ['B'],
    keywords,
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
}

function vanillaBlocker(id = 'blocker'): CardDefinition {
  return {
    id,
    name: 'Blocker',
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
}

function land(id: string, typeLine: string): CardDefinition {
  return {
    id,
    name: id,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['land'],
  };
}

/**
 * Build a state where p1 has the attacker and p2 has a vanilla blocker plus the
 * supplied lands. All non-land permanents start on the battlefield, non-sick.
 */
function setup(attackerDef: CardDefinition, p2Lands: CardDefinition[]) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: [attackerDef], commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [vanillaBlocker(), ...p2Lands], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);
  for (const [id, card] of state.cards) {
    state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
  }
  state = { ...state, phase: 'combat', step: 'declare_attackers' };

  const attackerInst = getCardsInZone(state, 'p1', 'battlefield')
    .find(c => state.cards.get(c.instanceId)!.definitionId !== 'cmd1')!;
  const blockerInst = getCardsInZone(state, 'p2', 'battlefield')
    .find(c => state.cards.get(c.instanceId)!.definitionId === 'blocker')!;
  return { state, attackerId: attackerInst.instanceId, blockerId: blockerInst.instanceId };
}

describe('landwalk enforcement (canBlock / declareBlockers)', () => {
  it('swampwalk: attacker is unblockable when defender controls a Swamp', () => {
    const { state, attackerId, blockerId } = setup(attacker(['Swampwalk']), [land('s', 'Land — Swamp')]);
    expect(hasActiveLandwalk(state, attackerId, 'p2')).toBe(true);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);

    const declared = declareAttackers(state, 'p1', [{ cardInstanceId: attackerId, defendingPlayerId: 'p2' }]);
    expect(canDeclareBlocker(declared, 'p2', blockerId, attackerId)).toBe(false);
    expect(() => declareBlockers(declared, 'p2', [{ cardInstanceId: blockerId, blockingAttackerId: attackerId }]))
      .toThrow();
  });

  it('swampwalk: attacker IS blockable when defender controls NO Swamp', () => {
    const { state, attackerId, blockerId } = setup(attacker(['Swampwalk']), [land('f', 'Land — Forest')]);
    expect(hasActiveLandwalk(state, attackerId, 'p2')).toBe(false);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);

    const declared = declareAttackers(state, 'p1', [{ cardInstanceId: attackerId, defendingPlayerId: 'p2' }]);
    expect(canDeclareBlocker(declared, 'p2', blockerId, attackerId)).toBe(true);
    const blocked = declareBlockers(declared, 'p2', [{ cardInstanceId: blockerId, blockingAttackerId: attackerId }]);
    expect(blocked.combat!.blockers).toHaveLength(1);
  });

  it('forestwalk matches a nonbasic land that has the Forest subtype (Bayou)', () => {
    const { state, attackerId, blockerId } = setup(attacker(['Forestwalk']), [land('bayou', 'Land — Swamp Forest')]);
    expect(hasActiveLandwalk(state, attackerId, 'p2')).toBe(true);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('generic landwalk is unblockable when defender controls ANY land', () => {
    const { state, attackerId, blockerId } = setup(attacker(['Landwalk']), [land('plains', 'Basic Land — Plains')]);
    expect(hasActiveLandwalk(state, attackerId, 'p2')).toBe(true);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('generic landwalk IS blockable when defender controls no land at all', () => {
    const { state, attackerId, blockerId } = setup(attacker(['Landwalk']), []);
    expect(hasActiveLandwalk(state, attackerId, 'p2')).toBe(false);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);
  });

  it('landwalk read from oracle text (no keywords array entry)', () => {
    const { state, attackerId, blockerId } = setup(attacker([], 'Mountainwalk'), [land('m', 'Basic Land — Mountain')]);
    expect(hasActiveLandwalk(state, attackerId, 'p2')).toBe(true);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('granted landwalk (grantedKeywords) is enforced', () => {
    const { state, attackerId, blockerId } = setup(attacker([]), [land('i', 'Basic Land — Island')]);
    const inst = state.cards.get(attackerId)!;
    state.cards.set(attackerId, { ...inst, grantedKeywords: ['Islandwalk'] });
    expect(hasActiveLandwalk(state, attackerId, 'p2')).toBe(true);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('does not affect a DIFFERENT defending player who lacks the land', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [attacker(['Swampwalk'])], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [vanillaBlocker('b2'), land('s', 'Land — Swamp')], commanderId: 'cmd2' },
      { playerId: 'p3', name: 'Carol', cards: [vanillaBlocker('b3')], commanderId: 'cmd3' },
    ];
    let state = initGameState(decks);
    for (const [id, card] of state.cards) {
      state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
    }
    state = { ...state, phase: 'combat', step: 'declare_attackers' };
    const attackerId = getCardsInZone(state, 'p1', 'battlefield')
      .find(c => state.cards.get(c.instanceId)!.definitionId === 'walker')!.instanceId;
    const b3 = getCardsInZone(state, 'p3', 'battlefield')
      .find(c => state.cards.get(c.instanceId)!.definitionId === 'b3')!.instanceId;
    // p2 has the Swamp -> unblockable by p2; p3 has no Swamp -> blockable by p3.
    expect(hasActiveLandwalk(state, attackerId, 'p2')).toBe(true);
    expect(hasActiveLandwalk(state, attackerId, 'p3')).toBe(false);
    expect(canBlock(state, b3, attackerId)).toBe(true);
  });
});

describe('landwalk parser recognition (face stops being Unparsed)', () => {
  it.each(['Swampwalk', 'Forestwalk', 'Islandwalk', 'Mountainwalk', 'Plainswalk', 'Landwalk'])(
    'recognizes %s as a StaticAbility',
    (text) => {
      const result = parseOracleText(text);
      expect(result.kind).toBe('StaticAbility');
    },
  );

  it('recognizes landwalk with reminder text', () => {
    const result = parseOracleText(
      "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)",
    );
    expect(result.kind).toBe('StaticAbility');
  });

  it('recognizes landwalk alongside other engine keywords', () => {
    expect(parseOracleText('Flying\nSwampwalk').kind).toBe('StaticAbility');
  });

  it('does NOT claim a face carrying a real ability beside landwalk', () => {
    // The ETB clause is a real function; the richer ETB parse wins (not Unparsed,
    // but importantly not a bare landwalk marker that would mask the ability).
    const result = parseOracleText('When Walker enters, draw a card.\nSwampwalk');
    expect(result.kind).toBe('ETB');
  });
});
