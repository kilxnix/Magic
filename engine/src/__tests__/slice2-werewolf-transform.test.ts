/**
 * Slice 2: Per-upkeep werewolf transform triggers
 *
 * Two Innistrad werewolf template wordings:
 *   (day->night) "At the beginning of each upkeep, if no spells were cast last turn,
 *                 transform this creature."
 *   (night->day) "At the beginning of each upkeep, if a player cast two or more
 *                 spells last turn, transform this creature."
 *
 * Tests: parse, condition evaluation, and end-to-end trigger execution.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import {
  registerBattlefieldAbilities,
  putTriggersOnStack,
  resolveTopOfStack,
  checkTriggersForEvent,
} from '../stack';
import { advanceToNextTurn } from '../turn-manager';
import type { CardDefinition, GameState, CardInstance } from '../types';

// ---------------------------------------------------------------------------
// Card fixtures — simple two-faced werewolf cards
// ---------------------------------------------------------------------------

/**
 * Gatstaf Shepherd (front face): day->night wording.
 * "At the beginning of each upkeep, if no spells were cast last turn, transform this creature."
 */
function makeGatstafShepherdDef(): CardDefinition {
  return {
    id: 'gatstaf-shepherd',
    name: 'Gatstaf Shepherd // Gatstaf Howler',
    type_line: 'Creature — Human',
    oracle_text: 'At the beginning of each upkeep, if no spells were cast last turn, transform this creature.',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    faces: [
      {
        name: 'Gatstaf Shepherd',
        type_line: 'Creature — Human',
        oracle_text: 'At the beginning of each upkeep, if no spells were cast last turn, transform this creature.',
        mana_cost: '{1}{G}',
        colors: ['G'],
        card_types: ['creature'],
        keywords: [],
        cmc: 2,
        subtypes: ['Human'],
        power: '2',
        toughness: '2',
      },
      {
        name: 'Gatstaf Howler',
        type_line: 'Creature — Werewolf',
        oracle_text: 'At the beginning of each upkeep, if a player cast two or more spells last turn, transform this creature.',
        mana_cost: '',
        colors: [],
        card_types: ['creature'],
        keywords: [],
        cmc: 0,
        subtypes: ['Werewolf'],
        power: '3',
        toughness: '3',
      },
    ],
  };
}

/**
 * Reckless Waif (front face): for additional coverage.
 * "At the beginning of each upkeep, if no spells were cast last turn, transform this creature."
 */
function makeRecklessWaifDef(): CardDefinition {
  return {
    id: 'reckless-waif',
    name: 'Reckless Waif // Merciless Predator',
    type_line: 'Creature — Human Rogue',
    oracle_text: 'At the beginning of each upkeep, if no spells were cast last turn, transform this creature.',
    mana_cost: '{R}',
    cmc: 1,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    card_types: ['creature'],
    faces: [
      {
        name: 'Reckless Waif',
        type_line: 'Creature — Human Rogue',
        oracle_text: 'At the beginning of each upkeep, if no spells were cast last turn, transform this creature.',
        mana_cost: '{R}',
        colors: ['R'],
        card_types: ['creature'],
        keywords: [],
        cmc: 1,
        subtypes: ['Human', 'Rogue'],
        power: '1',
        toughness: '1',
      },
      {
        name: 'Merciless Predator',
        type_line: 'Creature — Werewolf',
        oracle_text: 'At the beginning of each upkeep, if a player cast two or more spells last turn, transform this creature.',
        mana_cost: '',
        colors: [],
        card_types: ['creature'],
        keywords: [],
        cmc: 0,
        subtypes: ['Werewolf'],
        power: '3',
        toughness: '2',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGame(p1Cards: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-cmd' },
    { playerId: 'p2', name: 'Player 2', cards: [], commanderId: 'nonexistent-cmd-2' },
  ]);
}

function findCard(state: GameState, defId: string): CardInstance | undefined {
  for (const c of state.cards.values()) {
    if (c.definitionId === defId) return c;
  }
  return undefined;
}

function moveToBattlefield(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error('Card not found: ' + instanceId);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone: 'battlefield', summoningSick: false });
  return { ...state, cards: newCards };
}

function setSpellsCastLastTurn(state: GameState, count: number): GameState {
  return { ...state, spellsCastLastTurn: count };
}

// ---------------------------------------------------------------------------
// PARSING TESTS
// ---------------------------------------------------------------------------

describe('Werewolf transform — parse: day->night wording', () => {
  it('parses Gatstaf Shepherd day->night oracle text as Triggered/each upkeep + NoSpellsLastTurn condition', () => {
    const oracle = 'At the beginning of each upkeep, if no spells were cast last turn, transform this creature.';
    const parsed = parseOracleText(oracle);

    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    // Trigger: each upkeep
    expect(parsed.ability.trigger.kind).toBe('Upkeep');
    expect((parsed.ability.trigger as { kind: 'Upkeep'; whose: string }).whose).toBe('each');

    // Effect: Conditional wrapping TransformSelf
    expect(parsed.ability.effects).toHaveLength(1);
    const effect = parsed.ability.effects[0] as {
      kind: string;
      condition?: { kind: string };
      effect?: { kind: string };
    };
    expect(effect.kind).toBe('Conditional');
    expect(effect.condition?.kind).toBe('NoSpellsLastTurn');
    expect(effect.effect?.kind).toBe('TransformSelf');
  });

  it('parses Reckless Waif day->night oracle text identically', () => {
    const oracle = 'At the beginning of each upkeep, if no spells were cast last turn, transform this creature.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const effect = parsed.ability.effects[0] as { kind: string; condition?: { kind: string } };
    expect(effect.kind).toBe('Conditional');
    expect(effect.condition?.kind).toBe('NoSpellsLastTurn');
  });

  it('parses Hinterland Logger day->night oracle text', () => {
    const oracle = 'At the beginning of each upkeep, if no spells were cast last turn, transform this creature.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toMatchObject({ kind: 'Upkeep', whose: 'each' });
    const effect = parsed.ability.effects[0] as { kind: string; condition?: { kind: string }; effect?: { kind: string } };
    expect(effect.kind).toBe('Conditional');
    expect(effect.condition?.kind).toBe('NoSpellsLastTurn');
    expect(effect.effect?.kind).toBe('TransformSelf');
  });
});

describe('Werewolf transform — parse: night->day wording', () => {
  it('parses Merciless Predator night->day oracle text as Triggered/each upkeep + AnyPlayerTwoOrMoreSpellsLastTurn', () => {
    const oracle = 'At the beginning of each upkeep, if a player cast two or more spells last turn, transform this creature.';
    const parsed = parseOracleText(oracle);

    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    expect(parsed.ability.trigger.kind).toBe('Upkeep');
    expect((parsed.ability.trigger as { kind: 'Upkeep'; whose: string }).whose).toBe('each');

    const effect = parsed.ability.effects[0] as {
      kind: string;
      condition?: { kind: string };
      effect?: { kind: string };
    };
    expect(effect.kind).toBe('Conditional');
    expect(effect.condition?.kind).toBe('AnyPlayerTwoOrMoreSpellsLastTurn');
    expect(effect.effect?.kind).toBe('TransformSelf');
  });

  it('parses Grizzled Outcasts back face night->day oracle text', () => {
    const oracle = 'At the beginning of each upkeep, if a player cast two or more spells last turn, transform this creature.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const effect = parsed.ability.effects[0] as { kind: string; condition?: { kind: string } };
    expect(effect.kind).toBe('Conditional');
    expect(effect.condition?.kind).toBe('AnyPlayerTwoOrMoreSpellsLastTurn');
  });
});

// ---------------------------------------------------------------------------
// STATE FIELD TESTS
// ---------------------------------------------------------------------------

describe('Werewolf transform — spellsCastLastTurn state field', () => {
  it('advanceToNextTurn snapshots spellsCastThisTurn into spellsCastLastTurn', () => {
    let state = createGame([]);
    // Simulate that 3 spells were cast this turn.
    state = { ...state, spellsCastThisTurn: 3 };
    const next = advanceToNextTurn(state);
    expect(next.spellsCastLastTurn).toBe(3);
    expect(next.spellsCastThisTurn).toBe(0);
  });

  it('advanceToNextTurn with 0 spells this turn → spellsCastLastTurn is 0', () => {
    let state = createGame([]);
    state = { ...state, spellsCastThisTurn: 0 };
    const next = advanceToNextTurn(state);
    expect(next.spellsCastLastTurn).toBe(0);
  });

  it('spellsCastLastTurn defaults to 0/undefined when state is fresh', () => {
    const state = createGame([]);
    expect(state.spellsCastLastTurn ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS
// ---------------------------------------------------------------------------

describe('Werewolf transform — execution: day->night trigger', () => {
  /**
   * Helper: put Gatstaf Shepherd on battlefield, then fire upkeep
   * with the given spellsCastLastTurn count.
   */
  function setupAndFireUpkeep(spellsLastTurn: number): {
    state: GameState;
    wolfId: string;
  } {
    const wolfDef = makeGatstafShepherdDef();
    let state = createGame([wolfDef]);

    // Move to battlefield
    const wolfInst = findCard(state, wolfDef.id)!;
    state = moveToBattlefield(state, wolfInst.instanceId);

    // Register abilities
    state = registerBattlefieldAbilities(state, wolfInst.instanceId);

    // Set the last-turn spell count
    state = setSpellsCastLastTurn(state, spellsLastTurn);

    // Fire upkeep event
    state = { ...state, phase: 'beginning', step: 'upkeep', activePlayerIndex: 0, priorityPlayerIndex: 0 };
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p1' });

    return { state, wolfId: wolfDef.id };
  }

  it('DOES transform when no spells were cast last turn (spellsCastLastTurn === 0)', () => {
    const { state: afterEvent, wolfId } = setupAndFireUpkeep(0);
    expect(afterEvent.pendingTriggers.length).toBeGreaterThan(0);

    let state = afterEvent;
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const wolfInst = findCard(state, wolfId)!;
    const resolvedInst = state.cards.get(wolfInst.instanceId)!;
    // After transform, activeFaceName should be the back face.
    expect(resolvedInst.activeFaceName).toBe('Gatstaf Howler');
  });

  it('does NOT transform when spells were cast last turn (spellsCastLastTurn > 0)', () => {
    const { state: afterEvent, wolfId } = setupAndFireUpkeep(1);
    expect(afterEvent.pendingTriggers.length).toBeGreaterThan(0);

    let state = afterEvent;
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const wolfInst = findCard(state, wolfId)!;
    const resolvedInst = state.cards.get(wolfInst.instanceId)!;
    // No transform — activeFaceName should remain null/undefined (front face).
    expect(resolvedInst.activeFaceName ?? null).toBeNull();
  });
});

describe('Werewolf transform — execution: night->day trigger', () => {
  /**
   * Helper: use the back face oracle text (night->day) for the test.
   * We create a simple two-faced card where the front face has the night->day wording.
   */
  function makeNightToDay(): CardDefinition {
    return {
      id: 'night-to-day-wolf',
      name: 'Gatstaf Howler // Gatstaf Shepherd',
      type_line: 'Creature — Werewolf',
      oracle_text: 'At the beginning of each upkeep, if a player cast two or more spells last turn, transform this creature.',
      mana_cost: '',
      cmc: 0,
      colors: [],
      color_identity: ['G'],
      keywords: [],
      card_types: ['creature'],
      faces: [
        {
          name: 'Gatstaf Howler',
          type_line: 'Creature — Werewolf',
          oracle_text: 'At the beginning of each upkeep, if a player cast two or more spells last turn, transform this creature.',
          mana_cost: '',
          colors: [],
          card_types: ['creature'],
          keywords: [],
          cmc: 0,
          subtypes: ['Werewolf'],
          power: '3',
          toughness: '3',
        },
        {
          name: 'Gatstaf Shepherd',
          type_line: 'Creature — Human',
          oracle_text: 'At the beginning of each upkeep, if no spells were cast last turn, transform this creature.',
          mana_cost: '{1}{G}',
          colors: ['G'],
          card_types: ['creature'],
          keywords: [],
          cmc: 2,
          subtypes: ['Human'],
          power: '2',
          toughness: '2',
        },
      ],
    };
  }

  function setupAndFireUpkeep(spellsLastTurn: number): {
    state: GameState;
    wolfId: string;
  } {
    const wolfDef = makeNightToDay();
    let state = createGame([wolfDef]);

    const wolfInst = findCard(state, wolfDef.id)!;
    state = moveToBattlefield(state, wolfInst.instanceId);
    state = registerBattlefieldAbilities(state, wolfInst.instanceId);
    state = setSpellsCastLastTurn(state, spellsLastTurn);

    state = { ...state, phase: 'beginning', step: 'upkeep', activePlayerIndex: 0, priorityPlayerIndex: 0 };
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p1' });

    return { state, wolfId: wolfDef.id };
  }

  it('DOES transform when a player cast two or more spells last turn', () => {
    const { state: afterEvent, wolfId } = setupAndFireUpkeep(2);
    expect(afterEvent.pendingTriggers.length).toBeGreaterThan(0);

    let state = afterEvent;
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const wolfInst = findCard(state, wolfId)!;
    const resolvedInst = state.cards.get(wolfInst.instanceId)!;
    expect(resolvedInst.activeFaceName).toBe('Gatstaf Shepherd');
  });

  it('does NOT transform when fewer than two spells were cast last turn', () => {
    const { state: afterEvent, wolfId } = setupAndFireUpkeep(1);
    expect(afterEvent.pendingTriggers.length).toBeGreaterThan(0);

    let state = afterEvent;
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const wolfInst = findCard(state, wolfId)!;
    const resolvedInst = state.cards.get(wolfInst.instanceId)!;
    // No transform — activeFaceName remains null/undefined (already on front face).
    expect(resolvedInst.activeFaceName ?? null).toBeNull();
  });

  it('DOES transform when three or more spells were cast last turn', () => {
    const { state: afterEvent, wolfId } = setupAndFireUpkeep(3);
    let state = afterEvent;
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const wolfInst = findCard(state, wolfId)!;
    const resolvedInst = state.cards.get(wolfInst.instanceId)!;
    expect(resolvedInst.activeFaceName).toBe('Gatstaf Shepherd');
  });
});
