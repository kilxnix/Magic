/**
 * Slice 8/12: Per-player upkeep "that player" effect clauses.
 *
 * Covered oracle shapes:
 *   Braids, Conjurer Adept —
 *     "At the beginning of each player's upkeep, that player may put an artifact,
 *      creature, or land card from their hand onto the battlefield."
 *   Anvil of Bogardan variant —
 *     "At the beginning of each player's upkeep, that player draws a card."
 *     (exercises matchThatPlayerDraw with EventPlayer)
 *   Generic upkeep-punisher —
 *     "At the beginning of each player's upkeep, that player loses 1 life."
 *     (exercises matchThatPlayerLosesLife with EventPlayer)
 *
 * Each test verifies PARSE (AST shape) and EXECUTION (state change via
 * executeEffects with eventContext.eventPlayerId set to the active player).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, CardFilter } from '../effects/ast';
import type { GameState, CardDefinition } from '../types';
import { createPlayer } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseState(): GameState {
  return {
    players: [createPlayer('p1', 'Player 1'), createPlayer('p2', 'Player 2')],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'beginning',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  } as GameState;
}

function makeCardDef(
  id: string,
  name: string,
  typeLine: string,
  cmc = 0,
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = [],
  power?: number,
  toughness?: number,
): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: cmc ? `{${cmc}}` : '',
    cmc,
    colors,
    color_identity: colors,
    keywords: [],
    card_types: typeLine.toLowerCase().split(/[\s—–-]/).filter(t =>
      ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'land', 'planeswalker'].includes(t),
    ),
    power,
    toughness,
  };
}

function addHandCard(
  state: GameState,
  instanceId: string,
  def: CardDefinition,
  ownerId: string,
): GameState {
  const newCards = new Map(state.cards);
  const defs = new Map(state.cardDefinitions);
  defs.set(def.id, def);
  newCards.set(instanceId, {
    instanceId,
    definitionId: def.id,
    ownerId,
    zone: 'hand',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  return { ...state, cards: newCards, cardDefinitions: defs };
}

function addLibraryCard(
  state: GameState,
  instanceId: string,
  def: CardDefinition,
  ownerId: string,
): GameState {
  const newCards = new Map(state.cards);
  const defs = new Map(state.cardDefinitions);
  defs.set(def.id, def);
  newCards.set(instanceId, {
    instanceId,
    definitionId: def.id,
    ownerId,
    zone: 'library',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  return { ...state, cards: newCards, cardDefinitions: defs };
}

function setPlayerLife(state: GameState, playerId: string, life: number): GameState {
  return {
    ...state,
    players: state.players.map(p => p.id === playerId ? { ...p, life } : p),
  };
}

function lifeOf(state: GameState, playerId: string): number {
  return state.players.find(p => p.id === playerId)!.life;
}

function zoneOf(state: GameState, instanceId: string): string {
  return state.cards.get(instanceId)?.zone ?? 'unknown';
}

function handCount(state: GameState, playerId: string): number {
  return [...state.cards.values()].filter(c => c.ownerId === playerId && c.zone === 'hand').length;
}

// ---------------------------------------------------------------------------
// 1. Braids, Conjurer Adept — "that player may put an artifact, creature, or
//    land card from their hand onto the battlefield"
// ---------------------------------------------------------------------------

describe('Slice 8/12 — Braids, Conjurer Adept: put permanent from hand onto battlefield', () => {
  const BRAIDS_ORACLE =
    "At the beginning of each player's upkeep, that player may put an artifact, creature, or land card from their hand onto the battlefield.";

  it('parses the full trigger oracle text', () => {
    const parsed = parseOracleText(BRAIDS_ORACLE);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('PutLandFromHandOntoBattlefield');
    if (eff.kind !== 'PutLandFromHandOntoBattlefield') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    // Should allow artifact, creature, and land
    expect(eff.filter).toBeDefined();
    const filter = eff.filter as CardFilter;
    expect(filter.types).toEqual(expect.arrayContaining(['artifact', 'creature', 'land']));
  });

  it('parses the standalone clause as a Spell', () => {
    const parsed = parseOracleText(
      'That player may put an artifact, creature, or land card from their hand onto the battlefield.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('PutLandFromHandOntoBattlefield');
    if (eff.kind !== 'PutLandFromHandOntoBattlefield') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect((eff.filter as CardFilter).types).toEqual(expect.arrayContaining(['artifact', 'creature', 'land']));
  });

  it('puts an artifact from the event player\'s hand onto the battlefield', () => {
    const artifactDef = makeCardDef('artifact-def', 'Sol Ring', 'Artifact', 1);
    let state = baseState();
    state = addHandCard(state, 'artifact-1', artifactDef, 'p2');

    const effects: Effect[] = [{
      kind: 'PutLandFromHandOntoBattlefield',
      player: { kind: 'EventPlayer' },
      tapped: false,
      selectedCardChoiceId: 'putPermanentCardId',
      filter: { types: ['artifact', 'creature', 'land'] },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    // artifact should have moved from p2's hand to the battlefield
    expect(zoneOf(result, 'artifact-1')).toBe('battlefield');
  });

  it('puts a creature from the event player\'s hand onto the battlefield', () => {
    const creatureDef = makeCardDef('creature-def', 'Grizzly Bears', 'Creature — Bear', 2, [], 2, 2);
    let state = baseState();
    state = addHandCard(state, 'bear-1', creatureDef, 'p2');

    const effects: Effect[] = [{
      kind: 'PutLandFromHandOntoBattlefield',
      player: { kind: 'EventPlayer' },
      tapped: false,
      selectedCardChoiceId: 'putPermanentCardId',
      filter: { types: ['artifact', 'creature', 'land'] },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    expect(zoneOf(result, 'bear-1')).toBe('battlefield');
  });

  it('puts a land from the event player\'s hand onto the battlefield', () => {
    const landDef = makeCardDef('land-def', 'Forest', 'Basic Land — Forest', 0, ['G']);
    let state = baseState();
    state = addHandCard(state, 'forest-1', landDef, 'p2');

    const effects: Effect[] = [{
      kind: 'PutLandFromHandOntoBattlefield',
      player: { kind: 'EventPlayer' },
      tapped: false,
      filter: { types: ['artifact', 'creature', 'land'] },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    expect(zoneOf(result, 'forest-1')).toBe('battlefield');
  });

  it('does NOT move a card from the non-event player\'s hand', () => {
    const artifactDef = makeCardDef('artifact-def2', 'Mox Pearl', 'Artifact', 0);
    let state = baseState();
    // p1 has the artifact but p2 is the EventPlayer
    state = addHandCard(state, 'mox-1', artifactDef, 'p1');

    const effects: Effect[] = [{
      kind: 'PutLandFromHandOntoBattlefield',
      player: { kind: 'EventPlayer' },
      tapped: false,
      filter: { types: ['artifact', 'creature', 'land'] },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    // p2 has no matching cards; p1's artifact stays in hand
    expect(zoneOf(result, 'mox-1')).toBe('hand');
  });

  it('declines a sorcery card (not in artifact/creature/land filter)', () => {
    const sorceryDef = makeCardDef('sorcery-def', 'Overrun', 'Sorcery', 5);
    let state = baseState();
    state = addHandCard(state, 'sorcery-1', sorceryDef, 'p2');

    const effects: Effect[] = [{
      kind: 'PutLandFromHandOntoBattlefield',
      player: { kind: 'EventPlayer' },
      tapped: false,
      filter: { types: ['artifact', 'creature', 'land'] },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    // sorcery doesn't match the filter — stays in hand
    expect(zoneOf(result, 'sorcery-1')).toBe('hand');
  });
});

// ---------------------------------------------------------------------------
// 2. "that player draws a card" — EventPlayer (Anvil of Bogardan / Niv-Mizzet)
// ---------------------------------------------------------------------------

describe('Slice 8/12 — "that player draws a card" with EventPlayer', () => {
  it('parses the clause with EventPlayer as draw recipient', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player draws a card.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('Draw');
    if (eff.kind !== 'Draw') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toBe(1);
  });

  it('draws a card for the event player when trigger fires', () => {
    const cardDef = makeCardDef('card-def', 'Generic Card', 'Instant', 2);
    let state = baseState();
    state = addLibraryCard(state, 'lib-1', cardDef, 'p2');

    const effects: Effect[] = [{
      kind: 'Draw',
      player: { kind: 'EventPlayer' },
      count: 1,
    }];

    const before = handCount(state, 'p2');
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    // p2 should have drawn the top card
    expect(handCount(result, 'p2')).toBe(before + 1);
  });

  it('is backward-compatible: also works when casterId == eventPlayerId (SpellCast context)', () => {
    // For SpellCast events, casterId and eventPlayerId are both the spell's caster.
    // This verifies no regression for "opponent casts a spell → that player draws a card" triggers.
    const cardDef = makeCardDef('card-def2', 'Lightning Bolt', 'Instant', 1);
    let state = baseState();
    state = addLibraryCard(state, 'lib-2', cardDef, 'p2');

    const effects: Effect[] = [{
      kind: 'Draw',
      player: { kind: 'EventPlayer' },
      count: 1,
    }];

    const before = handCount(state, 'p2');
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { casterId: 'p2', eventPlayerId: 'p2' },
    });
    expect(handCount(result, 'p2')).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// 3. "that player loses N life" — matchThatPlayerLosesLife / EventPlayer
// ---------------------------------------------------------------------------

describe('Slice 8/12 — "that player loses N life" with EventPlayer', () => {
  it('parses standalone clause as Spell with LoseLife EventPlayer', () => {
    const parsed = parseOracleText('That player loses 2 life.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('LoseLife');
    if (eff.kind !== 'LoseLife') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.amount).toBe(2);
  });

  it('parses as trigger body in per-player-upkeep context', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player loses 1 life.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('LoseLife');
    if (eff.kind !== 'LoseLife') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.amount).toBe(1);
  });

  it('deals life loss to the event player', () => {
    let state = baseState();
    state = setPlayerLife(state, 'p2', 20);

    const effects: Effect[] = [{
      kind: 'LoseLife',
      player: { kind: 'EventPlayer' },
      amount: 3,
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    // p2 should lose 3 life (20 - 3 = 17)
    expect(lifeOf(result, 'p2')).toBe(17);
    // p1 is unaffected
    expect(lifeOf(result, 'p1')).toBe(40);
  });

  it('is a no-op when there is no event context', () => {
    let state = baseState();
    state = setPlayerLife(state, 'p1', 20);
    state = setPlayerLife(state, 'p2', 20);

    const effects: Effect[] = [{
      kind: 'LoseLife',
      player: { kind: 'EventPlayer' },
      amount: 3,
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0);
    // No eventContext → EventPlayer resolves to '' → no life loss
    expect(lifeOf(result, 'p1')).toBe(20);
    expect(lifeOf(result, 'p2')).toBe(20);
  });
});
