import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import {
  buildBattlefieldEntryPlan,
  entersTheBattlefieldTapped,
  parseConditionalEntersTapped,
} from '../permanent-entry';

function landDef(id: string, name: string, oracle: string, typeLine = 'Land'): CardDefinition {
  return {
    id, name, type_line: typeLine,
    oracle_text: oracle, mana_cost: '', cmc: 0, colors: [], color_identity: [],
    keywords: [], card_types: ['land'],
  };
}

function makeCard(instanceId: string, definitionId: string, ownerId: string, zone: CardInstance['zone'] = 'hand'): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function emptyState(): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'main1',
    step: 'main',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    playersWhoAttackedThisTurn: [],
  };
}

/** Put a battlefield permanent (with its def) into the state under ownerId. */
function putOnBattlefield(state: GameState, def: CardDefinition, instanceId: string, ownerId: string): void {
  state.cardDefinitions.set(def.id, def);
  state.cards.set(instanceId, makeCard(instanceId, def.id, ownerId, 'battlefield'));
}

const FOREST = (id: string) => landDef(id, 'Forest', '{T}: Add {G}.', 'Basic Land — Forest');
const ISLAND = (id: string) => landDef(id, 'Island', '{T}: Add {U}.', 'Basic Land — Island');
const NONBASIC = (id: string) => landDef(id, 'Glacial Fortress', '{T}: Add {W} or {U}.', 'Land');

describe('conditional-enters-tapped: parser recognition', () => {
  it('parses supported control-count "unless" forms', () => {
    expect(parseConditionalEntersTapped('Enters tapped unless you control two or more basic lands.'))
      .toEqual({ kind: 'basicLandsAtLeast', count: 2 });
    expect(parseConditionalEntersTapped('Enters tapped unless you control a basic land.'))
      .toEqual({ kind: 'basicLandsAtLeast', count: 1 });
    expect(parseConditionalEntersTapped('Enters tapped unless you control two or fewer other lands.'))
      .toEqual({ kind: 'otherLandsAtMost', count: 2 });
  });

  it('does NOT claim unsupported forms', () => {
    expect(parseConditionalEntersTapped('Enters tapped unless you control a Mountain.')).toBeUndefined();
    expect(parseConditionalEntersTapped('Enters tapped unless you have two or more opponents.')).toBeUndefined();
    expect(parseConditionalEntersTapped('This land enters tapped.')).toBeUndefined();
  });

  it('entersTheBattlefieldTapped no longer reports a flat true for supported conditionals', () => {
    expect(entersTheBattlefieldTapped('Enters tapped unless you control two or more basic lands.')).toBe(false);
  });

  it('claims the standalone face as a StaticAbility (no longer Unparsed)', () => {
    const parsed = parseOracleText(
      'This land enters tapped unless you control two or more basic lands.',
    );
    expect(parsed.kind).toBe('StaticAbility');
    expect(parsed.kind).not.toBe('Unparsed');
  });
});

describe('conditional-enters-tapped: honest execution — basic lands >= N', () => {
  const TAPLAND = landDef(
    'wolfwillow',
    'Wolfwillow Tapland',
    'This land enters the battlefield tapped unless you control two or more basic lands.\n{T}: Add {G}.',
  );

  it('enters TAPPED when controller has fewer than two basic lands', () => {
    const state = emptyState();
    putOnBattlefield(state, FOREST('f1'), 'f1', 'p0'); // only one basic
    state.cardDefinitions.set(TAPLAND.id, TAPLAND);
    const card = makeCard('tl', TAPLAND.id, 'p0');

    const plan = buildBattlefieldEntryPlan(state, 'p0', card, TAPLAND);
    expect(plan.tapped).toBe(true);
    expect(plan.card.tapped).toBe(true);
    expect(plan.card.zone).toBe('battlefield');
  });

  it('enters UNTAPPED when controller has two or more basic lands', () => {
    const state = emptyState();
    putOnBattlefield(state, FOREST('f1'), 'f1', 'p0');
    putOnBattlefield(state, ISLAND('i1'), 'i1', 'p0'); // two basics
    state.cardDefinitions.set(TAPLAND.id, TAPLAND);
    const card = makeCard('tl', TAPLAND.id, 'p0');

    const plan = buildBattlefieldEntryPlan(state, 'p0', card, TAPLAND);
    expect(plan.tapped).toBe(false);
    expect(plan.card.tapped).toBe(false);
  });

  it('does NOT count basic lands controlled by an OPPONENT', () => {
    const state = emptyState();
    putOnBattlefield(state, FOREST('f1'), 'f1', 'p1'); // opponent's basics
    putOnBattlefield(state, ISLAND('i1'), 'i1', 'p1');
    state.cardDefinitions.set(TAPLAND.id, TAPLAND);
    const card = makeCard('tl', TAPLAND.id, 'p0');

    const plan = buildBattlefieldEntryPlan(state, 'p0', card, TAPLAND);
    expect(plan.tapped).toBe(true); // you control zero basics → tapped
  });

  it('does NOT count nonbasic lands toward the basic-land condition', () => {
    const state = emptyState();
    putOnBattlefield(state, NONBASIC('n1'), 'n1', 'p0');
    putOnBattlefield(state, NONBASIC('n2'), 'n2', 'p0'); // two nonbasics, zero basics
    state.cardDefinitions.set(TAPLAND.id, TAPLAND);
    const card = makeCard('tl', TAPLAND.id, 'p0');

    const plan = buildBattlefieldEntryPlan(state, 'p0', card, TAPLAND);
    expect(plan.tapped).toBe(true);
  });
});

describe('conditional-enters-tapped: honest execution — "a basic land" (>= 1)', () => {
  const TAPLAND = landDef(
    'onebasic',
    'One-Basic Tapland',
    'This land enters tapped unless you control a basic land.\n{T}: Add {W}.',
  );

  it('untapped with one basic, tapped with none', () => {
    const withBasic = emptyState();
    putOnBattlefield(withBasic, FOREST('f1'), 'f1', 'p0');
    withBasic.cardDefinitions.set(TAPLAND.id, TAPLAND);
    expect(
      buildBattlefieldEntryPlan(withBasic, 'p0', makeCard('tl', TAPLAND.id, 'p0'), TAPLAND).tapped,
    ).toBe(false);

    const noBasic = emptyState();
    noBasic.cardDefinitions.set(TAPLAND.id, TAPLAND);
    expect(
      buildBattlefieldEntryPlan(noBasic, 'p0', makeCard('tl', TAPLAND.id, 'p0'), TAPLAND).tapped,
    ).toBe(true);
  });
});

describe('conditional-enters-tapped: honest execution — N or fewer OTHER lands (slow lands)', () => {
  const SLOW = landDef(
    'deserted',
    'Deserted Beach',
    'Deserted Beach enters the battlefield tapped unless you control two or fewer other lands.\n{T}: Add {W} or {U}.',
  );

  it('enters UNTAPPED when you control two or fewer OTHER lands', () => {
    const state = emptyState();
    putOnBattlefield(state, FOREST('f1'), 'f1', 'p0');
    putOnBattlefield(state, ISLAND('i1'), 'i1', 'p0'); // exactly two other lands
    state.cardDefinitions.set(SLOW.id, SLOW);
    const card = makeCard('tl', SLOW.id, 'p0');

    const plan = buildBattlefieldEntryPlan(state, 'p0', card, SLOW);
    expect(plan.tapped).toBe(false);
  });

  it('enters TAPPED when you control three or more OTHER lands', () => {
    const state = emptyState();
    putOnBattlefield(state, FOREST('f1'), 'f1', 'p0');
    putOnBattlefield(state, ISLAND('i1'), 'i1', 'p0');
    putOnBattlefield(state, NONBASIC('n1'), 'n1', 'p0'); // three other lands
    state.cardDefinitions.set(SLOW.id, SLOW);
    const card = makeCard('tl', SLOW.id, 'p0');

    const plan = buildBattlefieldEntryPlan(state, 'p0', card, SLOW);
    expect(plan.tapped).toBe(true);
  });

  it('excludes the entering land itself from the OTHER-lands count', () => {
    // Put the entering land's own instance on the battlefield too — it must not
    // be counted as an "other" land. With two genuine other lands it stays untapped.
    const state = emptyState();
    putOnBattlefield(state, FOREST('f1'), 'f1', 'p0');
    putOnBattlefield(state, ISLAND('i1'), 'i1', 'p0');
    state.cardDefinitions.set(SLOW.id, SLOW);
    // self instance already on battlefield (simulating self-not-counted path)
    state.cards.set('selfland', makeCard('selfland', SLOW.id, 'p0', 'battlefield'));
    const card = makeCard('selfland', SLOW.id, 'p0');

    const plan = buildBattlefieldEntryPlan(state, 'p0', card, SLOW);
    expect(plan.tapped).toBe(false); // 2 other lands (self excluded)
  });
});
