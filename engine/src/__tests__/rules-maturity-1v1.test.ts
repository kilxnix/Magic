import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { CardDefinition, CardInstance, GameState } from '../types';
import { createPlayer } from '../types';
import { checkStateBasedActions } from '../state-based';
import { registerContinuousEffect, resetContinuousTimestamp, getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import type { StaticAbilityEffect } from '../effects/ast';
import { populateParsedCache } from '../cards/card-parser-cache';
import { tryTapLandForMana } from '../actions-public';
import {
  clearReplacements,
  applyReplacements,
  createDamagePreventionEffect,
  createExileInsteadOfDieEffect,
  registerReplacement,
} from '../effects/replacement';

function makeDef(id: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return populateParsedCache({
    id,
    name: overrides.name ?? id,
    type_line: overrides.type_line ?? 'Creature - Test',
    oracle_text: overrides.oracle_text ?? '',
    mana_cost: overrides.mana_cost ?? '',
    cmc: overrides.cmc ?? 0,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
    keywords: overrides.keywords ?? [],
    card_types: overrides.card_types ?? ['creature'],
    power: overrides.power,
    toughness: overrides.toughness,
  });
}

function makeCard(instanceId: string, definitionId: string, ownerId = 'p1', overrides: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...overrides,
  };
}

function makeState(
  cards: [string, CardInstance][],
  definitions: [string, CardDefinition][],
): GameState {
  const p1 = createPlayer('p1', 'Pilot');
  const p2 = createPlayer('p2', 'Opponent');
  p1.hasPriority = true;

  return {
    players: [p1, p2],
    cards: new Map(cards),
    cardDefinitions: new Map(definitions),
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
    continuousEffects: [],
  };
}

function staticPT(power: number, toughness: number): StaticAbilityEffect {
  return {
    kind: 'StaticAbility',
    modifier: { kind: 'ModifyPT', power, toughness },
    filter: { types: ['creature'] },
    controller: 'you',
    excludeSelf: false,
  };
}

describe('Core engine rules maturity - 1v1 layer/timing/SBA regressions', () => {
  beforeEach(() => {
    resetContinuousTimestamp();
    clearReplacements();
  });

  afterEach(() => {
    clearReplacements();
  });

  it('uses layered continuous toughness when SBAs check lethal damage', () => {
    const bear = makeDef('bear', { name: 'Layer Bear', power: 1, toughness: 1 });
    const lord = makeDef('lord', { name: 'Toughness Lord', power: 2, toughness: 2 });
    let state = makeState(
      [
        ['bear-1', makeCard('bear-1', 'bear', 'p1', { damage: 1 })],
        ['lord-1', makeCard('lord-1', 'lord', 'p1')],
      ],
      [['bear', bear], ['lord', lord]],
    );
    state = registerContinuousEffect(state, 'lord-1', 'p1', staticPT(0, 1));

    let checked = checkStateBasedActions(state);
    expect(getEffectiveToughness(checked, 'bear-1')).toBe(2);
    expect(checked.cards.get('bear-1')?.zone).toBe('battlefield');

    const cards = new Map(checked.cards);
    cards.set('lord-1', { ...cards.get('lord-1')!, zone: 'graveyard' });
    checked = checkStateBasedActions({ ...checked, cards });
    expect(checked.cards.get('bear-1')?.zone).toBe('graveyard');
  });

  it('keeps equipment toughness in the SBA lethal-damage calculation', () => {
    const creature = makeDef('creature', { name: 'Equipped Recruit', power: 1, toughness: 1 });
    const shield = makeDef('shield', {
      name: 'Shield of Testing',
      type_line: 'Artifact - Equipment',
      oracle_text: 'Equipped creature gets +0/+2. Equip {2}.',
      card_types: ['artifact'],
    });
    const state = makeState(
      [
        ['creature-1', makeCard('creature-1', 'creature', 'p1', { damage: 2 })],
        ['shield-1', makeCard('shield-1', 'shield', 'p1', { attachedTo: 'creature-1' })],
      ],
      [['creature', creature], ['shield', shield]],
    );

    const checked = checkStateBasedActions(state);
    expect(getEffectiveToughness(checked, 'creature-1')).toBe(3);
    expect(checked.cards.get('creature-1')?.zone).toBe('battlefield');
  });

  it('applies counter cancellation before layered lethal checks', () => {
    const creature = makeDef('creature', { name: 'Counterstack Adept', power: 2, toughness: 2 });
    const state = makeState(
      [
        [
          'creature-1',
          makeCard('creature-1', 'creature', 'p1', {
            counters: { '+1/+1': 2, '-1/-1': 1 },
            damage: 2,
          }),
        ],
      ],
      [['creature', creature]],
    );

    const checked = checkStateBasedActions(state);
    expect(checked.cards.get('creature-1')?.counters).toEqual({ '+1/+1': 1 });
    expect(getEffectivePower(checked, 'creature-1')).toBe(3);
    expect(getEffectiveToughness(checked, 'creature-1')).toBe(3);
    expect(checked.cards.get('creature-1')?.zone).toBe('battlefield');
  });

  it('lets commander replacement beat generic dies-to-exile replacement', () => {
    const commander = makeDef('cmd', {
      name: 'Layer Commander',
      type_line: 'Legendary Creature - Test',
      power: 2,
      toughness: 2,
    });
    const p1 = createPlayer('p1', 'Pilot');
    const p2 = createPlayer('p2', 'Opponent');
    p1.commanderInstanceId = 'cmd-1';
    p1.commanderInstanceIds = ['cmd-1'];

    let state: GameState = {
      players: [p1, p2],
      cards: new Map([
        ['cmd-1', makeCard('cmd-1', 'cmd', 'p1', { isCommander: true, damage: 2 })],
      ]),
      cardDefinitions: new Map([['cmd', commander]]),
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
    registerReplacement(createExileInsteadOfDieEffect('void-1', 'p2'));

    state = checkStateBasedActions(state);
    expect(state.cards.get('cmd-1')?.zone).toBe('command');
  });

  it('applies prevention before life-loss SBAs so prevented lethal damage does not kill the player', () => {
    const state = makeState([], []);
    registerReplacement(createDamagePreventionEffect('shield-1', 'p1', 'p1', 'all'));

    const damage = { type: 'DamageDealt' as const, targetId: 'p1', amount: 100 };
    // Damage prevention lives in the replacement pipeline; this regression
    // asserts the mature ordering contract used by executor damage effects.
    const replaced = applyReplacements(state, damage);
    const damagedState = replaced.event
      ? { ...state, players: state.players.map(p => p.id === 'p1' ? { ...p, life: p.life - (replaced.event?.amount ?? 0) } : p) }
      : state;

    const checked = checkStateBasedActions(damagedState);
    expect(checked.players.find(p => p.id === 'p1')?.life).toBe(40);
    expect(checked.players.find(p => p.id === 'p1')?.hasLost).toBe(false);
  });
});

describe('Core engine rules maturity - silver-bordered / unusual card coverage', () => {
  beforeEach(() => {
    clearReplacements();
  });

  afterEach(() => {
    clearReplacements();
  });

  it('parses and executes Blacker Lotus-style tear/remove mana as a sacrifice mana ability', () => {
    const lotus = makeDef('blacker-lotus', {
      name: 'Blacker Lotus',
      type_line: 'Artifact',
      oracle_text: '{T}, Tear Blacker Lotus into pieces: Add four mana of any one color. Remove the pieces from the game.',
      mana_cost: '0',
      cmc: 0,
      card_types: ['artifact'],
    });
    const state = makeState(
      [['lotus-1', makeCard('lotus-1', 'blacker-lotus', 'p1')]],
      [['blacker-lotus', lotus]],
    );

    expect(lotus.manaProduction?.requiresSacrifice).toBe(true);
    expect(lotus.manaProduction?.amounts.G).toBe(4);

    const result = tryTapLandForMana(state, 'p1', 'lotus-1', 'G');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.cards.get('lotus-1')?.zone).toBe('exile');
    expect(result.state.players[0].manaPool.G).toBe(4);
  });

  it('keeps intentionally strange un-card text inert instead of crashing parsed-cache hydration', () => {
    const weird = makeDef('weird-un-card', {
      name: 'Very Strange Card',
      type_line: 'Artifact',
      oracle_text: 'Ask a person outside the game to compliment your board. If they rhyme, do a little victory lap.',
      mana_cost: '{3}',
      cmc: 3,
      card_types: ['artifact'],
      colors: [],
      color_identity: [],
    });

    expect(weird.manaProduction).toBeUndefined();
    expect(weird.searchAbility).toBeUndefined();
    expect(weird.equipCost).toBeUndefined();
  });
});
