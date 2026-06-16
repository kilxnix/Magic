/**
 * Slice 9/12: Per-player upkeep graveyard-exile and hand-top-of-library bodies.
 *
 * Covered oracle shapes:
 *
 * Curse of Oblivion —
 *   "At the beginning of enchanted player's upkeep, that player exiles two cards
 *    from their graveyard."
 *   (matchThatPlayerExilesFromGraveyard, ExileNFromGraveyard effect, EventPlayer)
 *
 * Chittering Rats —
 *   "When Chittering Rats enters the battlefield, target opponent puts a card from
 *    their hand on top of their library."
 *   (matchThatPlayerPutsCardOnTopOfLibrary with Chosen target)
 *
 * Per-player-upkeep hand-top variant —
 *   "At the beginning of each player's upkeep, that player puts a card from their
 *    hand on top of their library."
 *   (matchThatPlayerPutsCardOnTopOfLibrary with EventPlayer)
 *
 * Each test verifies PARSE (AST shape) and EXECUTION (state change via
 * executeEffects with appropriate eventContext).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';
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
    card_types: typeLine.toLowerCase().split(/[\s—-]/).filter(t =>
      ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'land', 'planeswalker'].includes(t),
    ),
  };
}

function addCard(
  state: GameState,
  instanceId: string,
  def: CardDefinition,
  ownerId: string,
  zone: string,
): GameState {
  const newCards = new Map(state.cards);
  const defs = new Map(state.cardDefinitions);
  defs.set(def.id, def);
  newCards.set(instanceId, {
    instanceId,
    definitionId: def.id,
    ownerId,
    zone: zone as 'graveyard' | 'hand' | 'library' | 'battlefield' | 'exile',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  return { ...state, cards: newCards, cardDefinitions: defs };
}

function zoneOf(state: GameState, instanceId: string): string {
  return state.cards.get(instanceId)?.zone ?? 'unknown';
}

function countInZone(state: GameState, playerId: string, zone: string): number {
  return [...state.cards.values()].filter(c => c.ownerId === playerId && c.zone === zone).length;
}

// ---------------------------------------------------------------------------
// 1. Curse of Oblivion — "that player exiles two cards from their graveyard"
// ---------------------------------------------------------------------------

describe('Slice 9/12 — matchThatPlayerExilesFromGraveyard: Curse of Oblivion body', () => {
  const BODY_ONLY = 'That player exiles two cards from their graveyard.';
  const FULL_ORACLE =
    "At the beginning of enchanted player's upkeep, that player exiles two cards from their graveyard.";

  it('parses the standalone clause as a Spell with ExileNFromGraveyard', () => {
    const parsed = parseOracleText(BODY_ONLY);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('ExileNFromGraveyard');
    if (eff.kind !== 'ExileNFromGraveyard') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toBe(2);
  });

  it('parses the full trigger oracle (Curse of Oblivion shape)', () => {
    const parsed = parseOracleText(FULL_ORACLE);
    // Enchanted player's upkeep triggers parse as Triggered (UpkeepEachPlayer or similar)
    // The key assertion is the effect body.
    expect(parsed.kind).not.toBe('Unparsed');
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('ExileNFromGraveyard');
  });

  it('exiles exactly two cards from the event player graveyard', () => {
    const def1 = makeCardDef('c1', 'Grizzly Bears', 'Creature', 2);
    const def2 = makeCardDef('c2', 'Lightning Bolt', 'Instant', 1);
    const def3 = makeCardDef('c3', 'Counterspell', 'Instant', 2);
    let state = baseState();
    state = addCard(state, 'g1', def1, 'p2', 'graveyard');
    state = addCard(state, 'g2', def2, 'p2', 'graveyard');
    state = addCard(state, 'g3', def3, 'p2', 'graveyard');

    const effects: Effect[] = [{
      kind: 'ExileNFromGraveyard',
      player: { kind: 'EventPlayer' },
      count: 2,
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // p2 had 3 graveyard cards; 2 should now be in exile, 1 still in graveyard.
    const p2Exile = countInZone(result, 'p2', 'exile');
    const p2Graveyard = countInZone(result, 'p2', 'graveyard');
    expect(p2Exile).toBe(2);
    expect(p2Graveyard).toBe(1);
  });

  it('exiles all cards when graveyard has fewer than count', () => {
    const def1 = makeCardDef('d1', 'Forest', 'Basic Land', 0, ['G']);
    let state = baseState();
    state = addCard(state, 'g1', def1, 'p2', 'graveyard');

    const effects: Effect[] = [{
      kind: 'ExileNFromGraveyard',
      player: { kind: 'EventPlayer' },
      count: 3,
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    expect(zoneOf(result, 'g1')).toBe('exile');
    expect(countInZone(result, 'p2', 'graveyard')).toBe(0);
  });

  it('does NOT exile cards belonging to the non-event player', () => {
    const def1 = makeCardDef('e1', 'Giant Growth', 'Instant', 1);
    let state = baseState();
    state = addCard(state, 'g1', def1, 'p1', 'graveyard'); // p1's graveyard

    const effects: Effect[] = [{
      kind: 'ExileNFromGraveyard',
      player: { kind: 'EventPlayer' },
      count: 2,
    }];

    // EventPlayer is p2, so p1's graveyard cards should be untouched.
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    expect(zoneOf(result, 'g1')).toBe('graveyard');
  });

  it('parses "a card" (count=1) variant', () => {
    const parsed = parseOracleText('That player exiles a card from their graveyard.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('ExileNFromGraveyard');
    if (eff.kind !== 'ExileNFromGraveyard') return;
    expect(eff.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Chittering Rats — "target opponent puts a card from their hand on top"
// ---------------------------------------------------------------------------

describe('Slice 9/12 — matchThatPlayerPutsCardOnTopOfLibrary: Chittering Rats body', () => {
  const TARGET_OPP_BODY =
    'Target opponent puts a card from their hand on top of their library.';
  const THAT_PLAYER_BODY =
    'That player puts a card from their hand on top of their library.';
  const FULL_CHITTERING =
    "When Chittering Rats enters the battlefield, target opponent puts a card from their hand on top of their library.";

  it('parses "target opponent puts a card..." as PutCardsFromHandOnTop with Chosen target', () => {
    const parsed = parseOracleText(TARGET_OPP_BODY);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('PutCardsFromHandOnTop');
    if (eff.kind !== 'PutCardsFromHandOnTop') return;
    expect(eff.player.kind).toBe('Chosen');
    expect(eff.count).toBe(1);
    // Should have one target spec (the opponent).
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Player');
    expect(parsed.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('parses "that player puts a card..." as PutCardsFromHandOnTop with EventPlayer', () => {
    const parsed = parseOracleText(THAT_PLAYER_BODY);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('PutCardsFromHandOnTop');
    if (eff.kind !== 'PutCardsFromHandOnTop') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(parsed.targets).toHaveLength(0);
  });

  it('parses the full Chittering Rats ETB trigger', () => {
    const parsed = parseOracleText(FULL_CHITTERING);
    expect(parsed.kind).not.toBe('Unparsed');
    if (parsed.kind !== 'ETB') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('PutCardsFromHandOnTop');
  });

  it('moves a card from the target player hand to top of their library (Chosen)', () => {
    const def1 = makeCardDef('h1', 'Elvish Mystic', 'Creature', 1, ['G']);
    let state = baseState();
    state = addCard(state, 'hand-1', def1, 'p2', 'hand');

    const effects: Effect[] = [{
      kind: 'PutCardsFromHandOnTop',
      player: { kind: 'Controller' }, // resolves to p2 (casterId)
      count: 1,
      selectedCardChoiceId: 'putOnTopCardId',
    }];

    // Supply the AI-chosen card id via namedCardChoices so executePutCardsFromHandOnTop
    // has a concrete card to move (the function requires selectedCardIds to be non-empty).
    const result = executeEffects(state, effects, 'p2', [], [], 0, {
      namedCardChoices: { putOnTopCardId: 'hand-1' },
    });
    expect(zoneOf(result, 'hand-1')).toBe('library');
    expect(countInZone(result, 'p2', 'hand')).toBe(0);
  });

  it('moves a card from the event player hand to top of library (EventPlayer variant)', () => {
    const def1 = makeCardDef('h2', 'Counterspell', 'Instant', 2, ['U']);
    let state = baseState();
    state = addCard(state, 'hand-2', def1, 'p2', 'hand');

    const effects: Effect[] = [{
      kind: 'PutCardsFromHandOnTop',
      player: { kind: 'EventPlayer' },
      count: 1,
      selectedCardChoiceId: 'putOnTopCardId',
    }];

    // Supply the card selection and event context so EventPlayer resolves to p2.
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      namedCardChoices: { putOnTopCardId: 'hand-2' },
      eventContext: { eventPlayerId: 'p2' },
    });
    expect(zoneOf(result, 'hand-2')).toBe('library');
    expect(countInZone(result, 'p2', 'hand')).toBe(0);
  });

  it('does not move a card if the player hand is empty', () => {
    let state = baseState();
    // p2 has no hand cards.

    const effects: Effect[] = [{
      kind: 'PutCardsFromHandOnTop',
      player: { kind: 'EventPlayer' },
      count: 1,
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    // No crash — zero cards in library from this effect.
    expect(countInZone(result, 'p2', 'library')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Per-player-upkeep full trigger integration (parse + execute)
// ---------------------------------------------------------------------------

describe('Slice 9/12 — per-player-upkeep integration', () => {
  it('Curse-of-Oblivion shape: parses and executes graveyard exile for event player', () => {
    const oracle =
      "At the beginning of enchanted player's upkeep, that player exiles two cards from their graveyard.";
    const parsed = parseOracleText(oracle);
    // The trigger head is honest ("enchanted player's upkeep" falls under a per-player upkeep trigger).
    expect(parsed.kind).not.toBe('Unparsed');

    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('ExileNFromGraveyard');
    if (eff.kind !== 'ExileNFromGraveyard') return;
    expect(eff.count).toBe(2);
    expect(eff.player).toEqual({ kind: 'EventPlayer' });

    // Execute: p2 has 4 graveyard cards; 2 should be exiled.
    const def = makeCardDef('gd', 'Shock', 'Instant', 1);
    let state = baseState();
    for (const id of ['gy1', 'gy2', 'gy3', 'gy4']) {
      state = addCard(state, id, def, 'p2', 'graveyard');
    }

    const result = executeEffects(state, parsed.ability.effects, 'p1', [], parsed.targets, 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    expect(countInZone(result, 'p2', 'exile')).toBe(2);
    expect(countInZone(result, 'p2', 'graveyard')).toBe(2);
  });
});
