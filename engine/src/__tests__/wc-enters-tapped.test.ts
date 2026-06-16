import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { buildBattlefieldEntryPlan, entersTheBattlefieldTapped } from '../permanent-entry';

function landDef(oracle: string, name = 'Test Tapland'): CardDefinition {
  return {
    id: 'tapland', name, type_line: 'Land',
    oracle_text: oracle, mana_cost: '', cmc: 0, colors: [], color_identity: [],
    keywords: [], card_types: ['land'],
  };
}

function makeCard(instanceId: string, definitionId: string, ownerId: string): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone: 'hand',
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

describe('enters-tapped: parser recognition', () => {
  it('parses "This land enters tapped." as a self StaticAbility', () => {
    const parsed = parseOracleText('This land enters tapped.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.selfOnly).toBe(true);
  });

  it('parses "This permanent enters tapped." and "~ enters the battlefield tapped."', () => {
    expect(parseOracleText('This permanent enters tapped.').kind).toBe('StaticAbility');
    expect(parseOracleText('Test Tapland enters the battlefield tapped.').kind).toBe('StaticAbility');
  });

  it('CLAIMS supported control-count "enters tapped unless you control ..." conditionals', () => {
    // buildBattlefieldEntryPlan honestly evaluates the control-count at entry.
    expect(
      parseOracleText('This land enters tapped unless you control two or more basic lands.').kind,
    ).toBe('StaticAbility');
    expect(
      parseOracleText('This land enters tapped unless you control a basic land.').kind,
    ).toBe('StaticAbility');
    expect(
      parseOracleText('This land enters tapped unless you control two or fewer other lands.').kind,
    ).toBe('StaticAbility');
  });

  it('DECLINES unsupported "enters tapped unless ..." conditionals (leaves them Unparsed)', () => {
    // Conditions the engine cannot honestly evaluate at entry stay Unparsed.
    expect(
      parseOracleText('This land enters tapped unless you control a Mountain or a Plains.').kind,
    ).toBe('Unparsed');
    expect(
      parseOracleText('This land enters tapped unless you have two or more opponents.').kind,
    ).toBe('Unparsed');
  });

  it('DECLINES "doesn\'t enter tapped" negations', () => {
    expect(parseOracleText("This land doesn't enter the battlefield tapped.").kind).toBe('Unparsed');
  });

  it('CLAIMS shock-land "you may pay N life. If you don\'t, it enters tapped." (now executed honestly)', () => {
    // Slice 6: shock lands are parsed and executed — deterministic auto-choice
    // (pay when life >= 4, else tapped) via buildBattlefieldEntryPlan + executeLoseLife.
    const result = parseOracleText(
      'As this land enters, you may pay 2 life. If you don\'t, it enters tapped.',
    );
    expect(result.kind).toBe('StaticAbility');
  });
});

describe('enters-tapped: honest entry enforcement', () => {
  it('taps the entering permanent on the battlefield (engine executes it)', () => {
    const def = landDef('This land enters tapped.');
    // The matcher and the executor read the SAME oracle text.
    expect(parseOracleText(def.oracle_text).kind).toBe('StaticAbility');
    expect(entersTheBattlefieldTapped(def.oracle_text)).toBe(true);

    const state = emptyState();
    const card = makeCard('land1', def.id, 'p0');
    const plan = buildBattlefieldEntryPlan(state, 'p0', card, def);

    expect(plan.tapped).toBe(true);
    expect(plan.card.zone).toBe('battlefield');
    expect(plan.card.tapped).toBe(true);
  });

  it('a plain land with no enters-tapped text enters UNtapped', () => {
    const def = landDef('{T}: Add {G}.', 'Forest-ish');
    const state = emptyState();
    const card = makeCard('land2', def.id, 'p0');
    const plan = buildBattlefieldEntryPlan(state, 'p0', card, def);
    expect(plan.tapped).toBe(false);
    expect(plan.card.tapped).toBe(false);
  });
});
