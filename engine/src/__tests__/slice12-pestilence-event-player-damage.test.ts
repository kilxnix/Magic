/**
 * Slice 12 — Pestilence-style per-player-upkeep enchantment damage
 * scaled by the event player's board.
 *
 * Covered cards / oracle shapes:
 *   Ancient Runes  — "… deals damage to that player equal to the number of artifacts they control"
 *   Primal Order   — "… equal to the number of nonbasic lands they control"
 *   Cold Snap      — "… equal to the number of snow lands they control"
 *   Power Surge (X variant) — declined (untapped-at-beginning-of-turn snapshot).
 *
 * Each test verifies BOTH parse (matcher emits correct AST) AND execute
 * (executeEffects with eventContext.eventPlayerId deals the right amount of damage).
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
  supertypes: string[] = [],
  subtypes: string[] = [],
): CardDefinition {
  const cardTypes = typeLine.toLowerCase().split(/[\s—–-]/).filter(t =>
    ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'land', 'planeswalker'].includes(t)
  );
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
    card_types: cardTypes,
    subtypes,
    supertypes,
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

function lifeOf(state: GameState, playerId: string): number {
  return state.players.find(p => p.id === playerId)?.life ?? 20;
}

// ---------------------------------------------------------------------------
// 1. Ancient Runes — artifacts they control
// ---------------------------------------------------------------------------

describe('Slice 12 — Ancient Runes (artifacts they control)', () => {
  it('parses the trigger oracle text', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, this enchantment deals damage to that player equal to the number of artifacts they control.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    expect(eff.amount).toMatchObject({
      kind: 'ForEach',
      zone: 'battlefield',
      controller: 'eventPlayer',
      filter: { types: ['artifact'] },
    });
  });

  it('parses the standalone effect clause', () => {
    const parsed = parseOracleText(
      'This enchantment deals damage to that player equal to the number of artifacts they control.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    expect(eff.amount).toMatchObject({
      kind: 'ForEach',
      controller: 'eventPlayer',
      filter: { types: ['artifact'] },
    });
  });

  it('deals damage to the EventPlayer equal to their artifact count', () => {
    let state = baseState();
    const artifactDef = makeCardDef('art-def', 'Artifact', 'Artifact', 2);
    // p2 controls 3 artifacts
    state = addBattlefieldCard(state, 'a1', artifactDef, 'p2');
    state = addBattlefieldCard(state, 'a2', artifactDef, 'p2');
    state = addBattlefieldCard(state, 'a3', artifactDef, 'p2');
    // p1 controls 1 artifact (caster — should NOT take damage)
    state = addBattlefieldCard(state, 'a4', artifactDef, 'p1');

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: { kind: 'ForEach', zone: 'battlefield', controller: 'eventPlayer', filter: { types: ['artifact'] } },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // p2 had 3 artifacts → takes 3 damage (starts at 40)
    expect(lifeOf(result, 'p2')).toBe(37);
    // p1 is unaffected
    expect(lifeOf(result, 'p1')).toBe(40);
  });

  it('deals 0 damage when EventPlayer controls no artifacts', () => {
    let state = baseState();
    const landDef = makeCardDef('land-def', 'Forest', 'Basic Land — Forest', 0, [], ['basic']);
    // p2 controls no artifacts (only a land)
    state = addBattlefieldCard(state, 'land1', landDef, 'p2');

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: { kind: 'ForEach', zone: 'battlefield', controller: 'eventPlayer', filter: { types: ['artifact'] } },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    expect(lifeOf(result, 'p2')).toBe(40); // no damage (0 artifacts)
  });
});

// ---------------------------------------------------------------------------
// 2. Primal Order — nonbasic lands they control
// ---------------------------------------------------------------------------

describe('Slice 12 — Primal Order (nonbasic lands they control)', () => {
  it('parses the trigger oracle text', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, this enchantment deals damage to that player equal to the number of nonbasic lands they control.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    expect(eff.amount).toMatchObject({
      kind: 'ForEach',
      zone: 'battlefield',
      controller: 'eventPlayer',
      filter: { types: ['land'], excludeSupertypes: ['basic'] },
    });
  });

  it('deals damage equal to nonbasic land count, sparing basic lands', () => {
    let state = baseState();
    const basicLandDef = makeCardDef('forest-def', 'Forest', 'Basic Land — Forest', 0, [], ['basic']);
    const nonbasicDef = makeCardDef('dual-def', 'Dual Land', 'Land', 0, []);
    // p2 has 2 basics + 3 nonbasics
    state = addBattlefieldCard(state, 'b1', basicLandDef, 'p2');
    state = addBattlefieldCard(state, 'b2', basicLandDef, 'p2');
    state = addBattlefieldCard(state, 'nb1', nonbasicDef, 'p2');
    state = addBattlefieldCard(state, 'nb2', nonbasicDef, 'p2');
    state = addBattlefieldCard(state, 'nb3', nonbasicDef, 'p2');

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: { kind: 'ForEach', zone: 'battlefield', controller: 'eventPlayer', filter: { types: ['land'], excludeSupertypes: ['basic'] } },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // 3 nonbasics → 3 damage (starts at 40)
    expect(lifeOf(result, 'p2')).toBe(37);
  });
});

// ---------------------------------------------------------------------------
// 3. Cold Snap — snow lands they control
// ---------------------------------------------------------------------------

describe('Slice 12 — Cold Snap (snow lands they control)', () => {
  it('parses the trigger oracle text', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, this enchantment deals damage to that player equal to the number of snow lands they control.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    expect(eff.amount).toMatchObject({
      kind: 'ForEach',
      zone: 'battlefield',
      controller: 'eventPlayer',
      filter: { types: ['land'], supertypes: ['snow'] },
    });
  });

  it('deals damage equal to snow land count', () => {
    let state = baseState();
    const snowLandDef = makeCardDef('snow-forest-def', 'Snow-Covered Forest', 'Snow Basic Land — Forest', 0, [], ['snow', 'basic']);
    const normalLandDef = makeCardDef('forest-def', 'Forest', 'Basic Land — Forest', 0, [], ['basic']);
    // p2 controls 2 snow lands and 1 normal land
    state = addBattlefieldCard(state, 'sl1', snowLandDef, 'p2');
    state = addBattlefieldCard(state, 'sl2', snowLandDef, 'p2');
    state = addBattlefieldCard(state, 'nl1', normalLandDef, 'p2');

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: { kind: 'ForEach', zone: 'battlefield', controller: 'eventPlayer', filter: { types: ['land'], supertypes: ['snow'] } },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // 2 snow lands → 2 damage (starts at 40)
    expect(lifeOf(result, 'p2')).toBe(38);
  });
});

// ---------------------------------------------------------------------------
// 4. Power Surge — declined (untapped lands at beginning of turn)
// ---------------------------------------------------------------------------

describe('Slice 12 — Power Surge (honest decline)', () => {
  it('does NOT parse "deals X damage to that player, where X is the number of untapped lands they controlled at the beginning of this turn"', () => {
    // The engine cannot track the beginning-of-turn untapped-land snapshot, so
    // this card must stay Unparsed rather than silently miscounting.
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, this enchantment deals X damage to that player, where X is the number of untapped lands they controlled at the beginning of this turn.",
    );
    // Must NOT successfully parse as a Triggered ability (Unparsed is the honest result)
    expect(parsed.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// 5. Full oracle text parsing — "~" subject form
// ---------------------------------------------------------------------------

describe('Slice 12 — tilde-subject form', () => {
  it('parses "~ deals damage to that player equal to the number of creatures they control"', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, ~ deals damage to that player equal to the number of creatures they control.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    expect(eff.amount).toMatchObject({
      kind: 'ForEach',
      controller: 'eventPlayer',
      filter: { types: ['creature'] },
    });
  });

  it('executes creature-count damage correctly with ~ form', () => {
    let state = baseState();
    const creatureDef = makeCardDef('creature-def', 'Test Creature', 'Creature — Test', 2, ['R'], [], ['Test']);
    // p2 controls 4 creatures
    state = addBattlefieldCard(state, 'c1', creatureDef, 'p2');
    state = addBattlefieldCard(state, 'c2', creatureDef, 'p2');
    state = addBattlefieldCard(state, 'c3', creatureDef, 'p2');
    state = addBattlefieldCard(state, 'c4', creatureDef, 'p2');

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: { kind: 'ForEach', zone: 'battlefield', controller: 'eventPlayer', filter: { types: ['creature'] } },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // 4 creatures → 4 damage → p2 at 36 (starts at 40)
    expect(lifeOf(result, 'p2')).toBe(36);
    // p1 untouched
    expect(lifeOf(result, 'p1')).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// 6. Symmetry: EventPlayer switches correctly for each player's upkeep
// ---------------------------------------------------------------------------

describe('Slice 12 — event player symmetry', () => {
  it('damages p1 when eventPlayerId is p1 (their upkeep)', () => {
    let state = baseState();
    const artifactDef = makeCardDef('art-def2', 'Sword', 'Artifact', 3);
    // p1 controls 2 artifacts; p2 controls 1
    state = addBattlefieldCard(state, 'p1a1', artifactDef, 'p1');
    state = addBattlefieldCard(state, 'p1a2', artifactDef, 'p1');
    state = addBattlefieldCard(state, 'p2a1', artifactDef, 'p2');

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: { kind: 'ForEach', zone: 'battlefield', controller: 'eventPlayer', filter: { types: ['artifact'] } },
    }];

    // p1's upkeep — eventPlayerId = 'p1'
    const result = executeEffects(state, effects, 'p2', [], [], 0, {
      eventContext: { eventPlayerId: 'p1' },
    });

    // p1 had 2 artifacts → takes 2 damage (starts at 40)
    expect(lifeOf(result, 'p1')).toBe(38);
    expect(lifeOf(result, 'p2')).toBe(40);
  });
});
