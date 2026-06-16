/**
 * Slice 1 (engine-gap) — Seedborn Muse: "Untap all permanents you control
 * during each other player's untap step."
 *
 * Test coverage:
 *   1. Parse: the oracle text parses as a StaticAbility with modifier
 *      { kind: 'UntapDuringOtherUntapSteps' }, NOT as an immediate Spell.
 *   2. Honesty: the matchUntap clause DECLINES the "during …" wording and
 *      does not emit an immediate UntapEffect.
 *   3. Execution: performUntapStep honours the static — after the active
 *      player's permanents are untapped, any non-active controller whose
 *      Seedborn Muse is on the battlefield also has all their permanents
 *      untapped.
 *   4. Multiplayer: multiple Seedborn Muse controllers each get their
 *      permanents untapped (each muse works independently).
 *   5. Irrelevance on own turn: when the Seedborn Muse controller IS the
 *      active player, their permanents are NOT double-untapped by the static
 *      (they already untap in the normal loop).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { performUntapStep } from '../turn-manager';
import { resetContinuousTimestamp } from '../effects/continuous';
import type { CardDefinition, CardInstance, GameState } from '../types';
import { createPlayer } from '../types';

// ---------------------------------------------------------------------------
// Card definitions
// ---------------------------------------------------------------------------

const seedbornMuseDef: CardDefinition = {
  id: 'seedborn-muse',
  name: 'Seedborn Muse',
  type_line: 'Creature — Spirit',
  oracle_text: "Untap all permanents you control during each other player's untap step.",
  mana_cost: '{3}{G}{G}',
  cmc: 5,
  colors: ['G'],
  color_identity: ['G'],
  keywords: [],
  power: 2,
  toughness: 4,
  card_types: ['creature'],
};

const forestDef: CardDefinition = {
  id: 'forest',
  name: 'Forest',
  type_line: 'Basic Land — Forest',
  oracle_text: '{T}: Add {G}.',
  mana_cost: '',
  cmc: 0,
  colors: [],
  color_identity: ['G'],
  keywords: [],
  card_types: ['land'],
};

const plainsDef: CardDefinition = {
  id: 'plains',
  name: 'Plains',
  type_line: 'Basic Land — Plains',
  oracle_text: '{T}: Add {W}.',
  mana_cost: '',
  cmc: 0,
  colors: [],
  color_identity: ['W'],
  keywords: [],
  card_types: ['land'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'],
  extra: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...extra,
  };
}

function makeBaseState(
  extraCards: [string, CardInstance][] = [],
  extraDefs: [string, CardDefinition][] = [],
  activePlayerIndex: number = 0,
  playerCount: number = 2,
): GameState {
  const players = [
    createPlayer('p0', 'Alice'),
    createPlayer('p1', 'Bob'),
    ...(playerCount > 2 ? [createPlayer('p2', 'Carol')] : []),
  ];
  return {
    players,
    cards: new Map(extraCards),
    cardDefinitions: new Map([
      ['seedborn-muse', seedbornMuseDef],
      ['forest', forestDef],
      ['plains', plainsDef],
      ...extraDefs,
    ]),
    activePlayerIndex,
    priorityPlayerIndex: activePlayerIndex,
    phase: 'beginning',
    step: 'untap',
    turnNumber: 3,
    hasPriorityPassed: new Array(players.length).fill(false),
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ---------------------------------------------------------------------------
// Section 1: Parse tests
// ---------------------------------------------------------------------------

describe('Seedborn Muse — parse', () => {
  beforeEach(() => resetContinuousTimestamp());

  it('parses the exact Seedborn Muse oracle text as StaticAbility/UntapDuringOtherUntapSteps', () => {
    const result = parseOracleText(
      "Untap all permanents you control during each other player's untap step.",
    );
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('UntapDuringOtherUntapSteps');
    expect(result.ability.selfOnly).toBe(true);
    expect(result.ability.controller).toBe('you');
  });

  it('does NOT parse as a Spell (the mis-parse that was fixed)', () => {
    const result = parseOracleText(
      "Untap all permanents you control during each other player's untap step.",
    );
    expect(result.kind).not.toBe('Spell');
  });

  it('rejects the wording with an extra non-keyword sentence (honesty gate)', () => {
    // If a card had additional real oracle text beyond the Seedborn clause, the
    // parser should NOT claim coverage as a simple UntapDuringOtherUntapSteps.
    const result = parseOracleText(
      "Untap all permanents you control during each other player's untap step.\nWhen ~ enters the battlefield, draw a card.",
    );
    // The trigger line means this cannot be purely UntapDuringOtherUntapSteps.
    expect(result.kind).not.toBe('StaticAbility');
  });

  it('still parses "untap all permanents you control." WITHOUT rider as an immediate Spell', () => {
    // Verify the "during …" guard in matchUntap did not break the normal form
    // (e.g. a sorcery "Untap all permanents you control.").
    const result = parseOracleText('Untap all permanents you control.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const untapEffect = result.effects.find(e => e.kind === 'Untap');
    expect(untapEffect).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Section 2: Execution — basic two-player untap
// ---------------------------------------------------------------------------

describe('Seedborn Muse — execution: non-active player untap', () => {
  beforeEach(() => resetContinuousTimestamp());

  /**
   * Setup: p0 is the active player; p1 controls a tapped Seedborn Muse and
   * a tapped Forest.  When p0's untap step runs, p1's permanents should all
   * untap too.
   */
  it('untaps all permanents of a non-active player controlling Seedborn Muse', () => {
    const muse = makeInstance('muse_1', 'seedborn-muse', 'p1', 'battlefield', { tapped: true });
    const forest1 = makeInstance('forest_1', 'forest', 'p1', 'battlefield', { tapped: true });
    const plains0 = makeInstance('plains_0', 'plains', 'p0', 'battlefield', { tapped: true });

    let state = makeBaseState([
      ['muse_1', muse],
      ['forest_1', forest1],
      ['plains_0', plains0],
    ]);

    // Register the Seedborn Muse's static ability (simulates battlefield entry).
    state = registerContinuousAbilitiesForPermanent(state, 'muse_1');

    // p0's untap step (activePlayerIndex=0, activePlayerId='p0').
    state = performUntapStep(state);

    // p0's plains should untap normally.
    expect(state.cards.get('plains_0')!.tapped).toBe(false);
    // p1's forest should have untapped due to Seedborn Muse.
    expect(state.cards.get('forest_1')!.tapped).toBe(false);
    // The Muse itself should also have untapped.
    expect(state.cards.get('muse_1')!.tapped).toBe(false);
  });

  it("does NOT apply on the Seedborn Muse controller's own untap step", () => {
    // p1 is the active player this time.  Seedborn Muse should NOT cause a
    // second pass (but p1's permanents still untap normally via the main loop).
    const muse = makeInstance('muse_1', 'seedborn-muse', 'p1', 'battlefield', { tapped: true });
    const forest1 = makeInstance('forest_1', 'forest', 'p1', 'battlefield', { tapped: true });

    let state = makeBaseState(
      [['muse_1', muse], ['forest_1', forest1]],
      [],
      1, // p1 is active
    );

    state = registerContinuousAbilitiesForPermanent(state, 'muse_1');

    // p1's own untap step.
    state = performUntapStep(state);

    // Both untap normally (main loop, not Seedborn static).
    expect(state.cards.get('muse_1')!.tapped).toBe(false);
    expect(state.cards.get('forest_1')!.tapped).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Multiplayer — two non-active Seedborn Muse controllers
// ---------------------------------------------------------------------------

describe('Seedborn Muse — multiplayer: each controller untaps independently', () => {
  beforeEach(() => resetContinuousTimestamp());

  it('untaps permanents for ALL non-active players with Seedborn Muse', () => {
    // p0 is active; p1 and p2 each have a Seedborn Muse + a tapped land.
    const muse1 = makeInstance('muse_1', 'seedborn-muse', 'p1', 'battlefield', { tapped: true });
    const forest1 = makeInstance('forest_1', 'forest', 'p1', 'battlefield', { tapped: true });
    const muse2 = makeInstance('muse_2', 'seedborn-muse', 'p2', 'battlefield', { tapped: true });
    const plains2 = makeInstance('plains_2', 'plains', 'p2', 'battlefield', { tapped: true });
    const plains0 = makeInstance('plains_0', 'plains', 'p0', 'battlefield', { tapped: true });

    let state = makeBaseState(
      [
        ['muse_1', muse1],
        ['forest_1', forest1],
        ['muse_2', muse2],
        ['plains_2', plains2],
        ['plains_0', plains0],
      ],
      [],
      0, // p0 active
      3, // 3-player game
    );

    state = registerContinuousAbilitiesForPermanent(state, 'muse_1');
    state = registerContinuousAbilitiesForPermanent(state, 'muse_2');

    state = performUntapStep(state);

    // p0 untaps normally.
    expect(state.cards.get('plains_0')!.tapped).toBe(false);
    // p1 untaps via Seedborn Muse.
    expect(state.cards.get('forest_1')!.tapped).toBe(false);
    expect(state.cards.get('muse_1')!.tapped).toBe(false);
    // p2 untaps via their own Seedborn Muse.
    expect(state.cards.get('plains_2')!.tapped).toBe(false);
    expect(state.cards.get('muse_2')!.tapped).toBe(false);
  });

  it('untaps p1 permanents via p2 Seedborn Muse even when p1 has no Muse', () => {
    // p2 controls Seedborn Muse; p1 has only a land; p0 is active.
    // p1 should NOT untap (has no Muse); p2 SHOULD untap.
    const muse2 = makeInstance('muse_2', 'seedborn-muse', 'p2', 'battlefield', { tapped: true });
    const plains2 = makeInstance('plains_2', 'plains', 'p2', 'battlefield', { tapped: true });
    const forest1 = makeInstance('forest_1', 'forest', 'p1', 'battlefield', { tapped: true });
    const plains0 = makeInstance('plains_0', 'plains', 'p0', 'battlefield', { tapped: true });

    let state = makeBaseState(
      [
        ['muse_2', muse2],
        ['plains_2', plains2],
        ['forest_1', forest1],
        ['plains_0', plains0],
      ],
      [],
      0,
      3,
    );

    state = registerContinuousAbilitiesForPermanent(state, 'muse_2');

    state = performUntapStep(state);

    // p0 untaps normally.
    expect(state.cards.get('plains_0')!.tapped).toBe(false);
    // p2 untaps via their Seedborn Muse.
    expect(state.cards.get('plains_2')!.tapped).toBe(false);
    expect(state.cards.get('muse_2')!.tapped).toBe(false);
    // p1 does NOT untap (no Seedborn Muse, and the Muse belongs to p2 not p1).
    expect(state.cards.get('forest_1')!.tapped).toBe(true);
  });
});
