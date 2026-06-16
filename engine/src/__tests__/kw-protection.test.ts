import { describe, it, expect } from 'vitest';
import { canDeclareBlocker, declareAttackers, declareBlockers } from '../combat';
import {
  canBlock,
  isProtectedFromSource,
  canBeTargetedByOpponentSource,
} from '../keywords';
import { getCardsInZone, initGameState } from '../game-state';
import { parseOracleText } from '../effects/parser';
import type { CardDefinition } from '../types';

function creature(
  id: string,
  colors: CardDefinition['colors'],
  oracle: string,
  cardTypes: CardDefinition['card_types'] = ['creature'],
): CardDefinition {
  return {
    id,
    name: id,
    type_line: cardTypes.includes('artifact') ? 'Artifact Creature — Golem' : 'Creature — Test',
    oracle_text: oracle,
    mana_cost: '{1}',
    cmc: 1,
    colors,
    color_identity: colors,
    keywords: [],
    card_types: cardTypes,
    power: 2,
    toughness: 2,
  };
}

/**
 * p1 controls `attackerDef`; p2 controls `blockerDef`. Everything starts on the
 * battlefield, non-sick, in the declare-attackers step.
 */
function setup(attackerDef: CardDefinition, blockerDef: CardDefinition) {
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

describe('protection enforcement (canBlock / declareBlockers / targeting)', () => {
  it('protection from red: a red creature can NOT block it', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', ['W'], 'Protection from red'),
      creature('red-blocker', ['R'], ''),
    );
    // canBlock(blocker, attacker): the protected attacker can't be blocked by the
    // red blocker (combat.ts line 422: isProtectedFromSource(attacker, blocker)).
    expect(isProtectedFromSource(state, attackerId, blockerId)).toBe(true);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);

    const declared = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerId, defendingPlayerId: 'p2' },
    ]);
    expect(canDeclareBlocker(declared, 'p2', blockerId, attackerId)).toBe(false);
    expect(() =>
      declareBlockers(declared, 'p2', [
        { cardInstanceId: blockerId, blockingAttackerId: attackerId },
      ]),
    ).toThrow();
  });

  it('protection from red: a GREEN creature CAN still block it (no false positive)', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', ['W'], 'Protection from red'),
      creature('green-blocker', ['G'], ''),
    );
    expect(isProtectedFromSource(state, attackerId, blockerId)).toBe(false);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);

    const declared = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerId, defendingPlayerId: 'p2' },
    ]);
    const blocked = declareBlockers(declared, 'p2', [
      { cardInstanceId: blockerId, blockingAttackerId: attackerId },
    ]);
    expect(blocked.combat!.blockers).toHaveLength(1);
  });

  it('protection from artifacts: an artifact creature can NOT block it', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', ['G'], 'Protection from artifacts'),
      creature('art-blocker', [], '', ['artifact', 'creature']),
    );
    expect(isProtectedFromSource(state, attackerId, blockerId)).toBe(true);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('protection from red: can NOT be targeted by an opponent\'s red source', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', ['W'], 'Protection from red'),
      creature('red-source', ['R'], ''),
    );
    // The red permanent (p2) tries to target the protected permanent (p1).
    expect(canBeTargetedByOpponentSource(state, attackerId, blockerId)).toBe(false);
  });

  it('protection from white and from black: blocked by white OR black, not green', () => {
    // White blocker -> can't block.
    {
      const { state, attackerId, blockerId } = setup(
        creature('att', ['G'], 'Protection from white and from black'),
        creature('white-blocker', ['W'], ''),
      );
      expect(canBlock(state, blockerId, attackerId)).toBe(false);
    }
    // Black blocker -> can't block.
    {
      const { state, attackerId, blockerId } = setup(
        creature('att', ['G'], 'Protection from white and from black'),
        creature('black-blocker', ['B'], ''),
      );
      expect(canBlock(state, blockerId, attackerId)).toBe(false);
    }
    // Green blocker -> CAN block.
    {
      const { state, attackerId, blockerId } = setup(
        creature('att', ['R'], 'Protection from white and from black'),
        creature('green-blocker', ['G'], ''),
      );
      expect(canBlock(state, blockerId, attackerId)).toBe(true);
    }
  });
});

describe('protection parser recognition (face stops being Unparsed)', () => {
  it.each([
    'Protection from white',
    'Protection from blue',
    'Protection from black',
    'Protection from red',
    'Protection from green',
    'Protection from creatures',
    'Protection from artifacts',
    'Protection from enchantments',
    'Protection from planeswalkers',
    'Protection from instants',
    'Protection from sorceries',
    'Protection from monocolored',
    'Protection from multicolored',
    'Protection from colorless',
    'Protection from white and from black',
  ])('recognizes %s as a StaticAbility', (text) => {
    expect(parseOracleText(text).kind).toBe('StaticAbility');
  });

  it('recognizes protection with reminder text', () => {
    const result = parseOracleText(
      "Protection from red (This creature can't be blocked, targeted, dealt damage, " +
        'enchanted, or equipped by anything red.)',
    );
    expect(result.kind).toBe('StaticAbility');
  });

  it('recognizes protection alongside another engine keyword', () => {
    expect(parseOracleText('Flying\nProtection from red').kind).toBe('StaticAbility');
  });

  // HONESTY: qualities the engine does NOT enforce must stay Unparsed — we never
  // credit coverage we can't back.
  it.each([
    'Protection from everything',
    'Protection from Dragons',
    'Protection from each color',
    'Protection from the color of your choice',
  ])('does NOT claim unenforced quality: %s', (text) => {
    expect(parseOracleText(text).kind).toBe('Unparsed');
  });

  it('does NOT mask a real ability printed beside protection', () => {
    // The richer triggered/ETB parse wins; importantly the bare protection marker
    // does not swallow the real ability.
    expect(
      parseOracleText('Protection from red\nWhenever this creature attacks, draw a card.').kind,
    ).toBe('Triggered');
    expect(
      parseOracleText('When this creature enters, draw a card.\nProtection from red').kind,
    ).toBe('ETB');
  });
});
