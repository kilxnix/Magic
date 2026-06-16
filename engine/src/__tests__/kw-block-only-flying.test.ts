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
    power?: number;
    toughness?: number;
  } = {},
): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Test',
    oracle_text: opts.oracle ?? '',
    mana_cost: '{1}',
    cmc: 1,
    colors: opts.colors ?? [],
    color_identity: opts.colors ?? [],
    keywords: opts.keywords ?? [],
    card_types: ['creature'],
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
function expectCannotBlock(state: any, attackerId: string, blockerId: string) {
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
function expectCanBlock(state: any, attackerId: string, blockerId: string) {
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

// Welkin Tern's exact modern oracle text.
const WELKIN_TERN_ORACLE = 'Flying\nThis creature can block only creatures with flying.';

describe('"can block only creatures with flying" enforcement (canBlock / declareBlockers)', () => {
  it('a Welkin Tern can NOT block a ground (non-flying) attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('ground-att', {}),
      creature('tern', { oracle: WELKIN_TERN_ORACLE, keywords: ['Flying'] }),
    );
    expectCannotBlock(state, attackerId, blockerId);
  });

  it('a Welkin Tern CAN block a FLYING attacker', () => {
    const { state, attackerId, blockerId } = setup(
      creature('fly-att', { keywords: ['Flying'] }),
      creature('tern', { oracle: WELKIN_TERN_ORACLE, keywords: ['Flying'] }),
    );
    expectCanBlock(state, attackerId, blockerId);
  });

  it('the older name-subject oracle wording is enforced too', () => {
    // Pre-reword printings use the card name as the sentence subject.
    const { state, attackerId, blockerId } = setup(
      creature('ground-att', {}),
      creature('Welkin Tern', {
        oracle: 'Flying\nWelkin Tern can block only creatures with flying.',
        keywords: ['Flying'],
      }),
    );
    expectCannotBlock(state, attackerId, blockerId);
  });

  it('a creature WITHOUT the restriction still blocks a ground attacker normally', () => {
    const { state, attackerId, blockerId } = setup(
      creature('ground-att', {}),
      creature('vanilla', {}),
    );
    expectCanBlock(state, attackerId, blockerId);
  });
});

describe('"can block only creatures with flying" parser recognition (face stops being Unparsed)', () => {
  it('recognizes the full Welkin Tern face as a StaticAbility', () => {
    const result = parseOracleText(WELKIN_TERN_ORACLE);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind === 'StaticAbility') {
      expect(result.ability.modifier).toMatchObject({
        kind: 'GrantKeyword',
        keyword: 'BlockOnlyFlying',
      });
      expect(result.ability.selfOnly).toBe(true);
    }
  });

  it('recognizes the bare sentence (Cloud Elemental line) as a StaticAbility', () => {
    expect(parseOracleText('This creature can block only creatures with flying.').kind)
      .toBe('StaticAbility');
  });

  it('recognizes the name-normalized "~" subject form', () => {
    expect(parseOracleText('~ can block only creatures with flying.').kind)
      .toBe('StaticAbility');
  });

  it('recognizes the sentence with reminder text alongside other engine keywords', () => {
    const result = parseOracleText(
      'Flying (This creature can\'t be blocked except by creatures with flying or reach.)\n'
      + 'This creature can block only creatures with flying.',
    );
    expect(result.kind).toBe('StaticAbility');
  });

  it('declines UNENFORCED "can block only" variants', () => {
    expect(parseOracleText('This creature can block only Walls.').kind).toBe('Unparsed');
    expect(parseOracleText('Creatures you control can block only creatures with flying.').kind)
      .toBe('Unparsed');
  });

  it('does NOT mask a real ability printed beside the restriction', () => {
    // The bare BlockOnlyFlying marker must never swallow a real unrun clause.
    const result = parseOracleText(
      'This creature can block only creatures with flying.\nWhenever this creature attacks, draw a card.',
    );
    if (result.kind === 'StaticAbility') {
      expect(result.ability.modifier).not.toMatchObject({ keyword: 'BlockOnlyFlying' });
    }
  });
});

describe('"can\'t block" self static keeps executing end-to-end (regression guard)', () => {
  it('parses "This creature can\'t block." into the enforced CannotBlock static', () => {
    const result = parseOracleText("This creature can't block.");
    expect(result.kind).toBe('StaticAbility');
    if (result.kind === 'StaticAbility') {
      expect(result.ability.modifier).toMatchObject({
        kind: 'GrantKeyword',
        keyword: 'CannotBlock',
      });
    }
  });

  it('a creature with the CannotBlock keyword can NOT block anything', () => {
    const { state, attackerId, blockerId } = setup(
      creature('ground-att', {}),
      creature('coward', { keywords: ['CannotBlock'] }),
    );
    expectCannotBlock(state, attackerId, blockerId);
  });
});
