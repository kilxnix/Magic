import { describe, it, expect } from 'vitest';
import { canDeclareBlocker, declareAttackers, declareBlockers } from '../combat';
import { canBlock } from '../keywords';
import { getCardsInZone, initGameState } from '../game-state';
import { parseOracleText } from '../effects/parser';
import type { CardDefinition } from '../types';

function creature(
  id: string,
  opts: {
    colors?: CardDefinition['colors'];
    oracle?: string;
    keywords?: string[];
    cardTypes?: CardDefinition['card_types'];
    power?: number;
    toughness?: number;
  } = {},
): CardDefinition {
  const cardTypes = opts.cardTypes ?? ['creature'];
  return {
    id,
    name: id,
    type_line: cardTypes.includes('artifact') ? 'Artifact Creature — Golem' : 'Creature — Test',
    oracle_text: opts.oracle ?? '',
    mana_cost: '{1}',
    cmc: 1,
    colors: opts.colors ?? [],
    color_identity: opts.colors ?? [],
    keywords: opts.keywords ?? [],
    card_types: cardTypes,
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
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

/** Assert the engine forbids the block both at canBlock and at declareBlockers. */
function expectUnblockable(state: any, attackerId: string, blockerId: string) {
  expect(canBlock(state, blockerId, attackerId)).toBe(false);
  const declared = declareAttackers(state, 'p1', [
    { cardInstanceId: attackerId, defendingPlayerId: 'p2' },
  ]);
  expect(canDeclareBlocker(declared, 'p2', blockerId, attackerId)).toBe(false);
  expect(() =>
    declareBlockers(declared, 'p2', [{ cardInstanceId: blockerId, blockingAttackerId: attackerId }]),
  ).toThrow();
}

/** Assert the engine permits the block. */
function expectBlockable(state: any, attackerId: string, blockerId: string) {
  expect(canBlock(state, blockerId, attackerId)).toBe(true);
  const declared = declareAttackers(state, 'p1', [
    { cardInstanceId: attackerId, defendingPlayerId: 'p2' },
  ]);
  expect(canDeclareBlocker(declared, 'p2', blockerId, attackerId)).toBe(true);
  const blocked = declareBlockers(declared, 'p2', [
    { cardInstanceId: blockerId, blockingAttackerId: attackerId },
  ]);
  expect(blocked.combat!.blockers).toHaveLength(1);
}

describe('fear enforcement (canBlock / declareBlockers)', () => {
  it('a non-black, non-artifact creature can NOT block a Fear attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { keywords: ['Fear'], colors: ['G'] }),
      creature('green', { colors: ['G'] }),
    );
    expectUnblockable(state, attackerId, blockerId);
  });

  it('a BLACK creature CAN block a Fear attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { keywords: ['Fear'], colors: ['G'] }),
      creature('black', { colors: ['B'] }),
    );
    expectBlockable(state, attackerId, blockerId);
  });

  it('an ARTIFACT creature CAN block a Fear attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { keywords: ['Fear'], colors: ['G'] }),
      creature('art', { cardTypes: ['artifact', 'creature'] }),
    );
    expectBlockable(state, attackerId, blockerId);
  });

  it('Fear read from oracle text (no keyword array entry) is enforced', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { oracle: 'Fear', colors: ['G'] }),
      creature('green', { colors: ['G'] }),
    );
    expectUnblockable(state, attackerId, blockerId);
  });
});

describe('intimidate enforcement (canBlock)', () => {
  it('a creature sharing NO color can NOT block an Intimidate attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { keywords: ['Intimidate'], colors: ['R'] }),
      creature('green', { colors: ['G'] }),
    );
    expectUnblockable(state, attackerId, blockerId);
  });

  it('a creature SHARING a color CAN block an Intimidate attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { keywords: ['Intimidate'], colors: ['R'] }),
      creature('red', { colors: ['R'] }),
    );
    expectBlockable(state, attackerId, blockerId);
  });

  it('an ARTIFACT creature CAN block an Intimidate attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { keywords: ['Intimidate'], colors: ['R'] }),
      creature('art', { cardTypes: ['artifact', 'creature'] }),
    );
    expectBlockable(state, attackerId, blockerId);
  });
});

describe('shadow enforcement (canBlock)', () => {
  it('a non-shadow creature can NOT block a Shadow attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { keywords: ['Shadow'] }),
      creature('normal', {}),
    );
    expectUnblockable(state, attackerId, blockerId);
  });

  it('a shadow creature CAN block a Shadow attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { keywords: ['Shadow'] }),
      creature('shade', { keywords: ['Shadow'] }),
    );
    expectBlockable(state, attackerId, blockerId);
  });

  it('a SHADOW blocker can NOT block a non-shadow attacker (symmetric)', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', {}),
      creature('shade', { keywords: ['Shadow'] }),
    );
    expectUnblockable(state, attackerId, blockerId);
  });
});

describe('horsemanship enforcement (canBlock)', () => {
  it('a creature without horsemanship can NOT block a Horsemanship attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { keywords: ['Horsemanship'] }),
      creature('foot', {}),
    );
    expectUnblockable(state, attackerId, blockerId);
  });

  it('a creature WITH horsemanship CAN block a Horsemanship attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { keywords: ['Horsemanship'] }),
      creature('horse', { keywords: ['Horsemanship'] }),
    );
    expectBlockable(state, attackerId, blockerId);
  });
});

describe('skulk enforcement (canBlock)', () => {
  it('a greater-power creature can NOT block a Skulk attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { keywords: ['Skulk'], power: 1, toughness: 1 }),
      creature('big', { power: 3, toughness: 3 }),
    );
    expectUnblockable(state, attackerId, blockerId);
  });

  it('an equal-power creature CAN block a Skulk attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { keywords: ['Skulk'], power: 2, toughness: 2 }),
      creature('equal', { power: 2, toughness: 2 }),
    );
    expectBlockable(state, attackerId, blockerId);
  });

  it('a smaller-power creature CAN block a Skulk attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { keywords: ['Skulk'], power: 3, toughness: 3 }),
      creature('small', { power: 1, toughness: 1 }),
    );
    expectBlockable(state, attackerId, blockerId);
  });
});

describe('"can\'t be blocked" (Unblockable) static enforcement', () => {
  it('an Unblockable attacker can NOT be blocked by anything', () => {
    const { state, attackerId, blockerId } = setup(
      creature('att', { oracle: "This creature can't be blocked." }),
      creature('normal', {}),
    );
    expectUnblockable(state, attackerId, blockerId);
  });
});

describe('other-evasion parser recognition (face stops being Unparsed)', () => {
  it.each(['Fear', 'Intimidate', 'Shadow', 'Horsemanship', 'Skulk'])(
    'recognizes %s as a StaticAbility',
    (text) => {
      expect(parseOracleText(text).kind).toBe('StaticAbility');
    },
  );

  it('recognizes "This creature can\'t be blocked." as a StaticAbility', () => {
    expect(parseOracleText("This creature can't be blocked.").kind).toBe('StaticAbility');
  });

  it('recognizes an evasion keyword with reminder text', () => {
    const result = parseOracleText(
      'Fear (This creature can\'t be blocked except by artifact creatures and/or black creatures.)',
    );
    expect(result.kind).toBe('StaticAbility');
  });

  it('recognizes evasion alongside another engine keyword', () => {
    expect(parseOracleText('Flying\nFear').kind).toBe('StaticAbility');
    expect(parseOracleText('Shadow\nFirst strike').kind).toBe('StaticAbility');
  });

  it('does NOT mask a real ability printed beside an evasion keyword', () => {
    // The richer parse wins; importantly the bare evasion StaticAbility marker
    // must not swallow the real triggered/ETB ability. (We assert it is NOT a
    // bare evasion marker — the precise richer kind isn't load-bearing.)
    const attacks = parseOracleText('Fear\nWhenever this creature attacks, draw a card.');
    expect(attacks.kind).not.toBe('Unparsed');
    expect(attacks.kind).not.toBe('StaticAbility');
    expect(parseOracleText('When this creature enters, draw a card.\nShadow').kind).toBe('ETB');
  });
});
