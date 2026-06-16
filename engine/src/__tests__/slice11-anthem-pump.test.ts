/**
 * Slice 11 test — Self conditional anthem + multi-keyword mass pump.
 *
 * (a) matchSelfDuringYourTurnAnthem: "During your turn, this creature gets +N/+N."
 *     (Skophos Reaver, Sporeback Wolf)
 *
 * (b) matchModifyPT extended for multi-keyword mass pump:
 *     "Until end of turn, creatures you control get +5/+5 and gain first strike,
 *      trample, and lifelink." (Titanic Ultimatum)
 *
 *     "Until end of turn, creatures you control get +1/+1 and gain trample and
 *      infect." (Triumph of the Hordes — infect skipped, +1/+1 + trample still apply)
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { instanceHasKeyword } from '../keywords';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { executeEffects } from '../effects/executor';
import type { CardDefinition, GameState } from '../types';
import { createPlayer } from '../types';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function creatureDef(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Test',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{2}',
    cmc: opts.cmc ?? 2,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

/**
 * Build a minimal game-state with p1 creatures on the battlefield, register
 * continuous statics, and return the state plus an instance-id resolver.
 */
function setup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[] = [creatureDef('dummy')],
  opts: { activePlayerIndex?: number } = {},
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];
  let state = initGameState(decks);
  // Put all cards onto the battlefield and remove summoning sickness
  for (const [id, card] of state.cards) {
    state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
  }
  // Optionally override the active player
  if (opts.activePlayerIndex !== undefined) {
    state = { ...state, activePlayerIndex: opts.activePlayerIndex };
  }
  // Register continuous statics
  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }
  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;
  return { state, idFor };
}

/**
 * Minimal two-player state for executing spell effects (Titanic Ultimatum style).
 */
function makeSpellState(): GameState {
  const creatureDefA: CardDefinition = {
    id: 'crA', name: 'Warrior', type_line: 'Creature — Warrior', oracle_text: '',
    mana_cost: '{2}', cmc: 2, colors: [], color_identity: [], keywords: [], card_types: ['creature'],
    power: 2, toughness: 2,
  };
  const creatureDefB: CardDefinition = {
    id: 'crB', name: 'Elf', type_line: 'Creature — Elf', oracle_text: '',
    mana_cost: '{1}', cmc: 1, colors: [], color_identity: [], keywords: [], card_types: ['creature'],
    power: 1, toughness: 1,
  };
  const cards = new Map([
    ['inst-crA', {
      instanceId: 'inst-crA', definitionId: 'crA', ownerId: 'p1', zone: 'battlefield' as const,
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    }],
    ['inst-crB', {
      instanceId: 'inst-crB', definitionId: 'crB', ownerId: 'p1', zone: 'battlefield' as const,
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    }],
  ]);
  const cardDefinitions = new Map([['crA', creatureDefA], ['crB', creatureDefB]]);
  return {
    players: [createPlayer('p1', 'P1'), createPlayer('p2', 'P2')],
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ---------------------------------------------------------------------------
// (a) matchSelfDuringYourTurnAnthem — parse tests
// ---------------------------------------------------------------------------

describe('Slice 11 — Self conditional anthem: parse', () => {
  it('Skophos Reaver: "During your turn, this creature gets +2/+0." parses as StaticAbility', () => {
    const r = parseOracleText('During your turn, this creature gets +2/+0.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 0 });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toEqual({ kind: 'IsActivePlayer' });
  });

  it('Sporeback Wolf: "During your turn, this creature gets +0/+2." parses as StaticAbility', () => {
    const r = parseOracleText('During your turn, this creature gets +0/+2.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 0, toughness: 2 });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toEqual({ kind: 'IsActivePlayer' });
  });

  it('"During your turn, this creature gets +2/+2." parses as StaticAbility', () => {
    const r = parseOracleText('During your turn, this creature gets +2/+2.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 2 });
    expect(r.ability.condition).toEqual({ kind: 'IsActivePlayer' });
  });

  it('"During your turn, ~ gets +2/+0." (tilde form) parses as StaticAbility', () => {
    const r = parseOracleText('During your turn, ~ gets +2/+0.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 0 });
    expect(r.ability.condition).toEqual({ kind: 'IsActivePlayer' });
  });
});

// ---------------------------------------------------------------------------
// (a) matchSelfDuringYourTurnAnthem — execution tests
// ---------------------------------------------------------------------------

describe('Slice 11 — Self conditional anthem: execution', () => {
  it('Skophos Reaver: +2/+0 applies only while its controller is the active player', () => {
    const reaver = creatureDef('reaver', {
      name: 'Skophos Reaver',
      oracle_text: 'During your turn, this creature gets +2/+0.',
      power: 1,
      toughness: 2,
    });

    // p1 (index 0) is active → +2/+0 applies
    const { state: stateP1Active, idFor: idForP1 } = setup([reaver], [], { activePlayerIndex: 0 });
    const idP1Active = idForP1('reaver');
    expect(getEffectivePower(stateP1Active, idP1Active)).toBe(3);   // 1 + 2
    expect(getEffectiveToughness(stateP1Active, idP1Active)).toBe(2); // 2 + 0

    // p2 (index 1) is active → condition false, base stats
    const stateP2Active = { ...stateP1Active, activePlayerIndex: 1 };
    expect(getEffectivePower(stateP2Active, idP1Active)).toBe(1);
    expect(getEffectiveToughness(stateP2Active, idP1Active)).toBe(2);
  });

  it('Sporeback Wolf style: +0/+2 applies only during controller\'s turn', () => {
    const wolf = creatureDef('wolf', {
      name: 'Sporeback Wolf',
      oracle_text: 'During your turn, this creature gets +0/+2.',
      power: 2,
      toughness: 1,
    });

    const { state, idFor } = setup([wolf], [], { activePlayerIndex: 0 });
    const id = idFor('wolf');

    // Own turn: +0/+2
    expect(getEffectivePower(state, id)).toBe(2);
    expect(getEffectiveToughness(state, id)).toBe(3); // 1 + 2

    // Opponent's turn: base stats
    const oppTurn = { ...state, activePlayerIndex: 1 };
    expect(getEffectivePower(oppTurn, id)).toBe(2);
    expect(getEffectiveToughness(oppTurn, id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (b) Mass pump with multi-keyword list — parse tests
// ---------------------------------------------------------------------------

describe('Slice 11 — Multi-keyword mass pump: parse', () => {
  it('Titanic Ultimatum: leading-duration mass pump with 3 keywords parses as Spell', () => {
    const text =
      'Until end of turn, creatures you control get +5/+5 and gain first strike, trample, and lifelink.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    // Should emit one ModifyPT + three GrantKeyword effects
    const effects = r.effects;
    const modPT = effects.find(e => e.kind === 'ModifyPT');
    expect(modPT).toBeDefined();
    if (modPT?.kind !== 'ModifyPT') return;
    expect(modPT.power).toBe(5);
    expect(modPT.toughness).toBe(5);
    expect(modPT.untilEndOfTurn).toBe(true);
    expect(modPT.target).toEqual({ kind: 'AllCreaturesYouControl' });

    const grantEffects = effects.filter(e => e.kind === 'GrantKeyword');
    const keywords = grantEffects.map(e => (e as { keyword: string }).keyword);
    expect(keywords).toContain('First Strike');
    expect(keywords).toContain('Trample');
    expect(keywords).toContain('Lifelink');
  });

  it('Trailing-duration mass pump with multiple keywords: "creatures you control get +5/+5 and gain first strike, trample, and lifelink until end of turn"', () => {
    const text =
      'Creatures you control get +5/+5 and gain first strike, trample, and lifelink until end of turn.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const effects = r.effects;
    const modPT = effects.find(e => e.kind === 'ModifyPT');
    expect(modPT).toBeDefined();
    if (modPT?.kind !== 'ModifyPT') return;
    expect(modPT.power).toBe(5);
    expect(modPT.toughness).toBe(5);

    const grantEffects = effects.filter(e => e.kind === 'GrantKeyword');
    expect(grantEffects.length).toBe(3);
    const keywords = grantEffects.map(e => (e as { keyword: string }).keyword);
    expect(keywords).toContain('First Strike');
    expect(keywords).toContain('Trample');
    expect(keywords).toContain('Lifelink');
  });

  it('Triumph of the Hordes: trailing-duration with infect (skipped) but trample is granted', () => {
    // "Until end of turn, creatures you control get +1/+1 and gain trample and infect."
    // infect is not in GRANTABLE_KEYWORDS so it is skipped; +1/+1 and trample still apply.
    const text =
      'Until end of turn, creatures you control get +1/+1 and gain trample and infect.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const effects = r.effects;
    const modPT = effects.find(e => e.kind === 'ModifyPT');
    expect(modPT).toBeDefined();
    if (modPT?.kind !== 'ModifyPT') return;
    expect(modPT.power).toBe(1);
    expect(modPT.toughness).toBe(1);

    const grantEffects = effects.filter(e => e.kind === 'GrantKeyword');
    const keywords = grantEffects.map(e => (e as { keyword: string }).keyword);
    expect(keywords).toContain('Trample');
    // infect is NOT granted (not executor-backed) — honest skip
    expect(keywords).not.toContain('infect');
    expect(keywords).not.toContain('Infect');
  });
});

// ---------------------------------------------------------------------------
// (b) Mass pump with multi-keyword list — execution tests
// ---------------------------------------------------------------------------

describe('Slice 11 — Multi-keyword mass pump: execution', () => {
  it('Titanic Ultimatum: all p1 creatures gain +5/+5 and first strike / trample / lifelink until EOT', () => {
    const text =
      'Until end of turn, creatures you control get +5/+5 and gain first strike, trample, and lifelink.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;

    const state0 = makeSpellState();
    const state1 = executeEffects(
      state0,
      r.effects,
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: 'inst-crA' },
    );

    // Both p1 creatures should have +5/+5
    expect(getEffectivePower(state1, 'inst-crA')).toBe(7);   // 2 + 5
    expect(getEffectiveToughness(state1, 'inst-crA')).toBe(7); // 2 + 5
    expect(getEffectivePower(state1, 'inst-crB')).toBe(6);   // 1 + 5
    expect(getEffectiveToughness(state1, 'inst-crB')).toBe(6); // 1 + 5

    // Both should have the keywords granted until end of turn
    expect(instanceHasKeyword(state1, 'inst-crA', 'First Strike')).toBe(true);
    expect(instanceHasKeyword(state1, 'inst-crA', 'Trample')).toBe(true);
    expect(instanceHasKeyword(state1, 'inst-crA', 'Lifelink')).toBe(true);
    expect(instanceHasKeyword(state1, 'inst-crB', 'First Strike')).toBe(true);
    expect(instanceHasKeyword(state1, 'inst-crB', 'Trample')).toBe(true);
    expect(instanceHasKeyword(state1, 'inst-crB', 'Lifelink')).toBe(true);
  });

  it('Mass pump with two keywords: "creatures you control get +2/+2 and gain trample and lifelink until end of turn"', () => {
    const text = 'Creatures you control get +2/+2 and gain trample and lifelink until end of turn.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;

    const state0 = makeSpellState();
    const state1 = executeEffects(state0, r.effects, 'p1', [], [], 0, { sourceInstanceId: 'inst-crA' });

    expect(getEffectivePower(state1, 'inst-crA')).toBe(4);
    expect(getEffectiveToughness(state1, 'inst-crA')).toBe(4);
    expect(instanceHasKeyword(state1, 'inst-crA', 'Trample')).toBe(true);
    expect(instanceHasKeyword(state1, 'inst-crA', 'Lifelink')).toBe(true);
    expect(instanceHasKeyword(state1, 'inst-crB', 'Trample')).toBe(true);
    expect(instanceHasKeyword(state1, 'inst-crB', 'Lifelink')).toBe(true);
  });
});
