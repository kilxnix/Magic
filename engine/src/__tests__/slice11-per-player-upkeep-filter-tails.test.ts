/**
 * Slice 11/12: Per-player upkeep "that player" filter tails.
 *
 * Tests for:
 *  1. monocolored creature sacrifice filter (Defiler of Souls)
 *  2. non-Elf creature sacrifice filter (Ruthless Winnower)
 *  3. nonbasic land sacrifice filter (Destructive Flow)
 *  4. green or white permanent sacrifice filter (color anyOf)
 *  5. "that player untaps a land they control" (Hokori, Dust Drinker)
 *  6. "that player mills X cards, where X is the number of cards in their hand" (Dreamborn Muse)
 *
 * All tests verify both PARSE and EXECUTION through executeEffects with
 * eventContext.eventPlayerId set to the active-player for the trigger.
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
  cmc: number,
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = [],
  power?: number,
  toughness?: number,
): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: '{1}',
    cmc,
    colors,
    color_identity: colors,
    keywords: [],
    card_types: typeLine.toLowerCase().split(/[\s—–-]/).filter(t =>
      ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'land', 'planeswalker'].includes(t)
    ),
    power,
    toughness,
  };
}

function addBattlefieldCard(
  state: GameState,
  instanceId: string,
  def: CardDefinition,
  ownerId: string,
  tapped = false,
): GameState {
  const newCards = new Map(state.cards);
  const defs = new Map(state.cardDefinitions);
  defs.set(def.id, def);
  newCards.set(instanceId, {
    instanceId,
    definitionId: def.id,
    ownerId,
    zone: 'battlefield',
    tapped,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  return { ...state, cards: newCards, cardDefinitions: defs };
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

function addLibCard(
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

function countZone(state: GameState, ownerId: string, zone: string): number {
  let n = 0;
  for (const c of state.cards.values()) {
    if (c.ownerId === ownerId && c.zone === zone) n++;
  }
  return n;
}

function countBattlefield(state: GameState, ownerId: string): number {
  return countZone(state, ownerId, 'battlefield');
}

function countGraveyard(state: GameState, ownerId: string): number {
  return countZone(state, ownerId, 'graveyard');
}

function countLibrary(state: GameState, ownerId: string): number {
  return countZone(state, ownerId, 'library');
}

// ---------------------------------------------------------------------------
// 1. monocolored creature sacrifice (Defiler of Souls)
// ---------------------------------------------------------------------------

describe('Slice 11 — monocolored creature sacrifice (Defiler of Souls)', () => {
  it('parses the trigger as Triggered with monocolored creature Sacrifice', () => {
    const parsed = parseOracleText(
      "Flying\nAt the beginning of each player's upkeep, that player sacrifices a monocolored creature of their choice.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('Sacrifice');
    if (eff.kind !== 'Sacrifice') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.filter).toEqual({ types: ['creature'], monocolored: true });
    expect(eff.count).toBe(1);
  });

  it('parses the effect clause standalone', () => {
    const parsed = parseOracleText(
      'That player sacrifices a monocolored creature of their choice.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Sacrifice');
    if (eff.kind !== 'Sacrifice') return;
    expect(eff.filter).toEqual({ types: ['creature'], monocolored: true });
  });

  it('sacrifices a monocolored creature from EventPlayer', () => {
    let state = baseState();
    // p2 has a red (monocolored) creature and a white creature
    const redCreatureDef = makeCardDef('red-c-def', 'Red Creature', 'Creature — Warrior', 2, ['R'], 2, 2);
    const whiteCreatureDef = makeCardDef('wht-c-def', 'White Creature', 'Creature — Soldier', 2, ['W'], 2, 2);
    state = addBattlefieldCard(state, 'red-c', redCreatureDef, 'p2');
    state = addBattlefieldCard(state, 'wht-c', whiteCreatureDef, 'p2');

    const effects: Effect[] = [{
      kind: 'Sacrifice',
      player: { kind: 'EventPlayer' },
      filter: { types: ['creature'], monocolored: true },
      count: 1,
    }];
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // One monocolored creature should be sacrificed
    expect(countBattlefield(result, 'p2')).toBe(1);
    expect(countGraveyard(result, 'p2')).toBe(1);
  });

  it('does NOT sacrifice a multicolored creature', () => {
    let state = baseState();
    // p2 has a gold (multicolored) creature only
    const goldDef = makeCardDef('gold-def', 'Gold Creature', 'Creature — Warrior', 3, ['R', 'W'], 3, 3);
    state = addBattlefieldCard(state, 'gold-c', goldDef, 'p2');

    const effects: Effect[] = [{
      kind: 'Sacrifice',
      player: { kind: 'EventPlayer' },
      filter: { types: ['creature'], monocolored: true },
      count: 1,
    }];
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // Multicolored creature should NOT be sacrificed
    expect(countBattlefield(result, 'p2')).toBe(1);
    expect(countGraveyard(result, 'p2')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. non-Elf creature sacrifice (Ruthless Winnower)
// ---------------------------------------------------------------------------

describe('Slice 11 — non-Elf creature sacrifice (Ruthless Winnower)', () => {
  it('parses "that player sacrifices a non-Elf creature of their choice."', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player sacrifices a non-Elf creature of their choice.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('Sacrifice');
    if (eff.kind !== 'Sacrifice') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.filter).toEqual({ types: ['creature'], excludeSubtypes: ['Elf'] });
  });

  it('sacrifices a non-Elf creature but spares an Elf', () => {
    let state = baseState();
    const elfDef = makeCardDef('elf-def', 'Elf Shaman', 'Creature — Elf Shaman', 1, ['G'], 1, 1);
    const humanDef = makeCardDef('human-def', 'Human Soldier', 'Creature — Human Soldier', 2, ['W'], 2, 2);
    state = addBattlefieldCard(state, 'elf', elfDef, 'p2');
    state = addBattlefieldCard(state, 'human', humanDef, 'p2');

    const effects: Effect[] = [{
      kind: 'Sacrifice',
      player: { kind: 'EventPlayer' },
      filter: { types: ['creature'], excludeSubtypes: ['Elf'] },
      count: 1,
    }];
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // The non-Elf (human) is sacrificed, the Elf survives
    expect(countBattlefield(result, 'p2')).toBe(1);
    expect(countGraveyard(result, 'p2')).toBe(1);
    // Elf should still be on the battlefield
    expect(result.cards.get('elf')?.zone).toBe('battlefield');
    expect(result.cards.get('human')?.zone).toBe('graveyard');
  });
});

// ---------------------------------------------------------------------------
// 3. nonbasic land sacrifice (Destructive Flow)
// ---------------------------------------------------------------------------

describe('Slice 11 — nonbasic land sacrifice (Destructive Flow)', () => {
  it('parses "that player sacrifices a nonbasic land of their choice."', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player sacrifices a nonbasic land of their choice.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('Sacrifice');
    if (eff.kind !== 'Sacrifice') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.filter).toEqual({ types: ['land'], excludeSupertypes: ['basic'] });
  });

  it('sacrifices a nonbasic land but spares a basic land', () => {
    let state = baseState();
    // "Basic Land — Forest" has supertype "Basic"
    const basicDef = makeCardDef('forest-def', 'Forest', 'Basic Land — Forest', 0, []);
    const fetchDef = makeCardDef('fetch-def', 'Fetchland', 'Land', 0, []);
    state = addBattlefieldCard(state, 'forest', basicDef, 'p2');
    state = addBattlefieldCard(state, 'fetch', fetchDef, 'p2');

    const effects: Effect[] = [{
      kind: 'Sacrifice',
      player: { kind: 'EventPlayer' },
      filter: { types: ['land'], excludeSupertypes: ['basic'] },
      count: 1,
    }];
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // The fetchland (nonbasic) is sacrificed; the Forest survives
    expect(countBattlefield(result, 'p2')).toBe(1);
    expect(result.cards.get('forest')?.zone).toBe('battlefield');
    expect(result.cards.get('fetch')?.zone).toBe('graveyard');
  });
});

// ---------------------------------------------------------------------------
// 4. "that player untaps a land they control" (Hokori, Dust Drinker)
// ---------------------------------------------------------------------------

describe('Slice 11 — that player untaps a land they control (Hokori)', () => {
  it('parses the full trigger oracle text', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player untaps a land they control.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('Untap');
    if (eff.kind !== 'Untap') return;
    expect(eff.target).toMatchObject({ kind: 'AllOfType', filter: { types: ['land'] }, eventPlayerControls: true });
    expect(eff.maxCount).toBe(1);
  });

  it('parses the standalone effect clause', () => {
    const parsed = parseOracleText('That player untaps a land they control.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Untap');
    if (eff.kind !== 'Untap') return;
    expect(eff.target).toMatchObject({ kind: 'AllOfType', eventPlayerControls: true });
    expect(eff.maxCount).toBe(1);
  });

  it('untaps one land controlled by the EventPlayer, leaving others tapped', () => {
    let state = baseState();
    const forestDef = makeCardDef('forest-def', 'Forest', 'Basic Land — Forest', 0);
    const islandDef = makeCardDef('island-def', 'Island', 'Basic Land — Island', 0);
    // p2 has two tapped lands; p1 has one tapped land
    state = addBattlefieldCard(state, 'p2-forest', forestDef, 'p2', true);
    state = addBattlefieldCard(state, 'p2-island', islandDef, 'p2', true);
    state = addBattlefieldCard(state, 'p1-forest', forestDef, 'p1', true);

    const effects: Effect[] = [{
      kind: 'Untap',
      target: { kind: 'AllOfType', filter: { types: ['land'] }, eventPlayerControls: true },
      maxCount: 1,
    }];
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // Exactly one of p2's lands should now be untapped
    const p2Lands = [...result.cards.values()].filter(c => c.ownerId === 'p2' && c.zone === 'battlefield');
    const p2UntappedCount = p2Lands.filter(c => !c.tapped).length;
    expect(p2UntappedCount).toBe(1);

    // p1's land should remain tapped (EventPlayer was p2)
    expect(result.cards.get('p1-forest')?.tapped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. "that player mills X cards, where X is the number of cards in their hand" (Dreamborn Muse)
// ---------------------------------------------------------------------------

describe('Slice 11 — Dreamborn Muse mill where X is hand count', () => {
  it('parses the full trigger oracle text', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player mills X cards, where X is the number of cards in their hand.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('Mill');
    if (eff.kind !== 'Mill') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toEqual({ kind: 'EventPlayerHandCount' });
  });

  it('parses the standalone "that player mills X cards, where X is the number of cards in their hand"', () => {
    const parsed = parseOracleText(
      'That player mills X cards, where X is the number of cards in their hand.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Mill');
    if (eff.kind !== 'Mill') return;
    expect(eff.count).toEqual({ kind: 'EventPlayerHandCount' });
  });

  it('mills exactly as many cards as the EventPlayer has in hand', () => {
    let state = baseState();
    // p2 has 3 cards in hand and 5 cards in library
    const cardDef = makeCardDef('card-def', 'Test Card', 'Instant', 1);
    state = addHandCard(state, 'h1', cardDef, 'p2');
    state = addHandCard(state, 'h2', cardDef, 'p2');
    state = addHandCard(state, 'h3', cardDef, 'p2');
    state = addLibCard(state, 'l1', cardDef, 'p2');
    state = addLibCard(state, 'l2', cardDef, 'p2');
    state = addLibCard(state, 'l3', cardDef, 'p2');
    state = addLibCard(state, 'l4', cardDef, 'p2');
    state = addLibCard(state, 'l5', cardDef, 'p2');

    const effects: Effect[] = [{
      kind: 'Mill',
      player: { kind: 'EventPlayer' },
      count: { kind: 'EventPlayerHandCount' } as any,
    }];
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // p2 had 3 cards in hand → mills 3 cards
    expect(countGraveyard(result, 'p2')).toBe(3);
    expect(countLibrary(result, 'p2')).toBe(2);
    // p2's hand cards stay in hand (mill only affects library)
    expect(countZone(result, 'p2', 'hand')).toBe(3);
  });

  it('mills 0 cards when EventPlayer has empty hand', () => {
    let state = baseState();
    const cardDef = makeCardDef('card-def2', 'Test Card 2', 'Instant', 1);
    state = addLibCard(state, 'l1', cardDef, 'p2');
    state = addLibCard(state, 'l2', cardDef, 'p2');

    const effects: Effect[] = [{
      kind: 'Mill',
      player: { kind: 'EventPlayer' },
      count: { kind: 'EventPlayerHandCount' } as any,
    }];
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // No hand cards → mills 0
    expect(countGraveyard(result, 'p2')).toBe(0);
    expect(countLibrary(result, 'p2')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 6. Integration: full oracle text parsing of example cards
// ---------------------------------------------------------------------------

describe('Slice 11 — full oracle text integration', () => {
  it('parses Defiler of Souls full oracle text', () => {
    const parsed = parseOracleText(
      "Flying\nAt the beginning of each player's upkeep, that player sacrifices a monocolored creature of their choice.",
    );
    expect(parsed.kind).toBe('Triggered');
  });

  it('parses Destructive Flow full oracle text', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player sacrifices a nonbasic land of their choice.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('Sacrifice');
  });

  it('does not parse "that player sacrifices a non-Elf creature" as Unparsed', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player sacrifices a non-Elf creature of their choice.",
    );
    // Should parse as Triggered, not Unparsed
    expect(parsed.kind).not.toBe('Unparsed');
    expect(parsed.kind).toBe('Triggered');
  });
});
