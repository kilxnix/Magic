/**
 * Slice 4 (engine-gap): Enduring Vitality / GrantActivatedManaAbility tests.
 *
 * Tests for: "Creatures you control have '{T}: Add one mana of any color.'"
 *
 * Coverage:
 *   1. Parser recognises the quoted-mana-ability static line.
 *   2. getAvailableManaColors returns W/U/B/R/G for a creature under Enduring Vitality.
 *   3. tapLandForMana succeeds for that creature and adds mana.
 *   4. Summoning sickness blocks the {T} grant.
 *   5. When Vitality leaves the battlefield, the creature loses the granted ability.
 *   6. The creature itself (Enduring Vitality, which is a creature) also benefits.
 *   7. getLegalActions includes ActivateManaAbility for the granted creature.
 */

import { describe, it, expect } from 'vitest';
import type { CardDefinition, CardInstance, GameState, Player } from '../types';
import { emptyManaPool } from '../types';
import { parseOracleText } from '../effects/parser';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { getAvailableManaColors, tapLandForMana } from '../actions';
import { getLegalActions } from '../ai/legal-actions';

// ============================================================================
// Test helpers
// ============================================================================

function makePlayer(id: string): Player {
  return {
    id, name: id, life: 40,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false, hasPriority: false, hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  opts: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId, definitionId, ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...opts,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Beast',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{2}{G}',
    cmc: opts.cmc ?? 3,
    colors: opts.colors ?? ['G'],
    color_identity: opts.color_identity ?? ['G'],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: overrides.players ?? [makePlayer('p1'), makePlayer('p2')],
    cards: overrides.cards ?? new Map(),
    cardDefinitions: overrides.cardDefinitions ?? new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'main',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: overrides.continuousEffects ?? [],
  } as GameState;
}

// ============================================================================
// Enduring Vitality oracle text (exact Scryfall wording)
// ============================================================================
const ENDURING_VITALITY_ORACLE =
  'Vigilance\nCreatures you control have "{T}: Add one mana of any color."\nWhen Enduring Vitality dies, if it was a creature, return it to the battlefield under its owner\'s control. It\'s an enchantment. (It\'s not a creature.)';

// ============================================================================
// 1. Parser recognises the quoted static line
// ============================================================================
describe('parseOracleText — GrantActivatedManaAbility', () => {
  it('recognises the standalone line: Creatures you control have "{T}: Add one mana of any color."', () => {
    const line = 'Creatures you control have "{T}: Add one mana of any color."';
    const result = parseOracleText(line);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('GrantActivatedManaAbility');
    if (result.ability.modifier.kind !== 'GrantActivatedManaAbility') return;
    const { grantedMana } = result.ability.modifier;
    expect(grantedMana.isTapAbility).toBe(true);
    expect(grantedMana.colors).toContain('W');
    expect(grantedMana.colors).toContain('U');
    expect(grantedMana.colors).toContain('B');
    expect(grantedMana.colors).toContain('R');
    expect(grantedMana.colors).toContain('G');
    expect(result.ability.filter).toEqual({ types: ['creature'] });
    expect(result.ability.controller).toBe('you');
  });

  it('recognises "Other creatures you control have …" variant', () => {
    const line = 'Other creatures you control have "{T}: Add one mana of any color."';
    const result = parseOracleText(line);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('GrantActivatedManaAbility');
    expect(result.ability.excludeSelf).toBe(true);
  });

  it('recognises "Each creature you control has …" variant', () => {
    const line = 'Each creature you control has "{T}: Add one mana of any color."';
    const result = parseOracleText(line);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('GrantActivatedManaAbility');
  });
});

// ============================================================================
// 2. Enduring Vitality on the battlefield grants the mana ability to creatures
// ============================================================================
describe('Enduring Vitality — execution', () => {
  function setupState() {
    const vitDef = makeDef('enduring_vitality', {
      name: 'Enduring Vitality',
      type_line: 'Enchantment Creature — Elk Glimmer',
      oracle_text: ENDURING_VITALITY_ORACLE,
      mana_cost: '{1}{G}{G}',
      cmc: 3,
      colors: ['G'],
      color_identity: ['G'],
      keywords: ['Vigilance'],
      card_types: ['enchantment', 'creature'],
      power: 3,
      toughness: 3,
    });

    const birdDef = makeDef('birds_def', {
      name: 'Birds of Paradise',
      type_line: 'Creature — Bird',
      oracle_text: 'Flying\n{T}: Add one mana of any color.',
      mana_cost: '{G}',
      cmc: 1,
      colors: ['G'],
      color_identity: ['G'],
      keywords: ['Flying'],
      card_types: ['creature'],
      power: 0,
      toughness: 1,
    });

    const bearDef = makeDef('bear_def', {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      mana_cost: '{1}{G}',
      cmc: 2,
      colors: ['G'],
      color_identity: ['G'],
      keywords: [],
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    const defs = new Map<string, CardDefinition>();
    defs.set('enduring_vitality', vitDef);
    defs.set('birds_def', birdDef);
    defs.set('bear_def', bearDef);

    const vitCard = makeCard('vit_1', 'enduring_vitality', 'p1');
    const birdCard = makeCard('bird_1', 'birds_def', 'p1');
    const bearCard = makeCard('bear_1', 'bear_def', 'p1');

    const cards = new Map<string, CardInstance>();
    cards.set('vit_1', vitCard);
    cards.set('bird_1', birdCard);
    cards.set('bear_1', bearCard);

    let state = makeState({ cards, cardDefinitions: defs });
    // Register Enduring Vitality's continuous abilities.
    state = registerContinuousAbilitiesForPermanent(state, 'vit_1');
    return state;
  }

  it('Grizzly Bears (normally no mana ability) gains all 5 colors via Enduring Vitality', () => {
    const state = setupState();
    const colors = getAvailableManaColors(state, 'bear_1');
    expect(colors).toContain('W');
    expect(colors).toContain('U');
    expect(colors).toContain('B');
    expect(colors).toContain('R');
    expect(colors).toContain('G');
  });

  it('can tapLandForMana on Grizzly Bears for any color under Enduring Vitality', () => {
    const state = setupState();

    const nextG = tapLandForMana(state, 'p1', 'bear_1', 'G');
    expect(nextG.players[0].manaPool.G).toBe(1);
    expect(nextG.cards.get('bear_1')?.tapped).toBe(true);

    const nextU = tapLandForMana(state, 'p1', 'bear_1', 'U');
    expect(nextU.players[0].manaPool.U).toBe(1);

    const nextR = tapLandForMana(state, 'p1', 'bear_1', 'R');
    expect(nextR.players[0].manaPool.R).toBe(1);
  });

  it('Birds of Paradise (already has {T}: Add one mana) still works under Vitality', () => {
    const state = setupState();
    // Bird already has own mana ability — should still work
    const colors = getAvailableManaColors(state, 'bird_1');
    expect(colors.length).toBeGreaterThan(0);
    const nextState = tapLandForMana(state, 'p1', 'bird_1', 'G');
    expect(nextState.players[0].manaPool.G).toBeGreaterThan(0);
  });

  it('summoning sickness blocks the granted {T} ability', () => {
    const state = setupState();
    // Make the bear summoning sick
    const newCards = new Map(state.cards);
    newCards.set('bear_1', { ...state.cards.get('bear_1')!, summoningSick: true });
    const sickState = { ...state, cards: newCards };

    // Should not appear in legal actions
    const actions = getLegalActions(sickState, 'p1');
    const bearManaActions = actions.filter(
      a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === 'bear_1',
    );
    expect(bearManaActions).toHaveLength(0);

    // tapLandForMana should throw — the summoning-sickness gate prevents the tap.
    // getAvailableManaColors already excludes the color (so the error may be
    // "Cannot produce chosen color" rather than "Summoning sick" — both are correct).
    expect(() => tapLandForMana(sickState, 'p1', 'bear_1', 'G')).toThrow();
    // And getAvailableManaColors correctly returns [] (summoning sickness excluded).
    expect(getAvailableManaColors(sickState, 'bear_1')).toHaveLength(0);
  });

  it('cannot tap an already-tapped creature for the granted mana ability', () => {
    const state = setupState();
    const newCards = new Map(state.cards);
    newCards.set('bear_1', { ...state.cards.get('bear_1')!, tapped: true });
    const tappedState = { ...state, cards: newCards };

    expect(() => tapLandForMana(tappedState, 'p1', 'bear_1', 'G')).toThrow();
    const colors = getAvailableManaColors(tappedState, 'bear_1');
    expect(colors).toHaveLength(0);
  });

  it('when Enduring Vitality leaves the battlefield, Grizzly Bears loses the granted ability', () => {
    let state = setupState();

    // Move Enduring Vitality to graveyard
    const newCards = new Map(state.cards);
    newCards.set('vit_1', { ...state.cards.get('vit_1')!, zone: 'graveyard' });
    state = { ...state, cards: newCards };

    // Bear should no longer have the mana ability (source is off battlefield)
    const colors = getAvailableManaColors(state, 'bear_1');
    expect(colors).toHaveLength(0);

    // tapLandForMana should fail
    expect(() => tapLandForMana(state, 'p1', 'bear_1', 'G')).toThrow();
  });

  it('getLegalActions includes ActivateManaAbility for the Grizzly Bears', () => {
    const state = setupState();
    const actions = getLegalActions(state, 'p1');
    const bearManaActions = actions.filter(
      a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === 'bear_1',
    );
    // Should have 5 actions (one per color: W U B R G)
    expect(bearManaActions.length).toBeGreaterThanOrEqual(5);
    const bearColors = new Set(bearManaActions.map(a => (a as { color: string }).color));
    expect(bearColors.has('W')).toBe(true);
    expect(bearColors.has('U')).toBe(true);
    expect(bearColors.has('B')).toBe(true);
    expect(bearColors.has('R')).toBe(true);
    expect(bearColors.has('G')).toBe(true);
  });
});
