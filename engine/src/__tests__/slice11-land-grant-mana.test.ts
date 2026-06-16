/**
 * Slice 11 cut-b: land-grant-mana-ability tests.
 *
 * Two sub-fixes in this slice:
 *
 * (A) matchGrantLandManaAbility — new static matcher recognising:
 *       "Lands you control have '{T}: Add one mana of any color.'"
 *       "All lands have '{T}: Add one mana of any color' and lose all other abilities."
 *     (Hypertoxic Miasma family and similar)
 *
 * (B) matchTappedForManaRider variant D5 — "an additional two mana in any combination
 *     of colors" (Market Festival oracle wording).
 *
 * Execution route: both patches reuse the existing GrantActivatedManaAbility /
 * TappedForManaRider paths in actions.ts — no new executor code needed.
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
// Part A — Parser: matchGrantLandManaAbility
// ============================================================================

describe('matchGrantLandManaAbility — parse recognition', () => {
  it('recognises "Lands you control have \"{T}: Add one mana of any color.\""', () => {
    const result = parseOracleText('Lands you control have "{T}: Add one mana of any color."');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('GrantActivatedManaAbility');
    if (result.ability.modifier.kind !== 'GrantActivatedManaAbility') return;
    expect(result.ability.filter).toEqual({ types: ['land'] });
    expect(result.ability.controller).toBe('you');
    const { grantedMana } = result.ability.modifier;
    expect(grantedMana.isTapAbility).toBe(true);
    expect(grantedMana.colors).toContain('W');
    expect(grantedMana.colors).toContain('U');
    expect(grantedMana.colors).toContain('B');
    expect(grantedMana.colors).toContain('R');
    expect(grantedMana.colors).toContain('G');
  });

  it('recognises "All lands have \"{T}: Add one mana of any color.\"" (controller: any)', () => {
    const result = parseOracleText('All lands have "{T}: Add one mana of any color."');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('GrantActivatedManaAbility');
    if (result.ability.modifier.kind !== 'GrantActivatedManaAbility') return;
    expect(result.ability.filter).toEqual({ types: ['land'] });
    // "All lands" scope → controller: 'any' (fires for controller's own lands)
    expect(result.ability.controller).toBe('any');
  });

  it('recognises "All lands have ... and lose all other abilities" (Hypertoxic Miasma)', () => {
    const oracle = 'All lands have "{T}: Add one mana of any color" and lose all other abilities.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('GrantActivatedManaAbility');
    if (result.ability.modifier.kind !== 'GrantActivatedManaAbility') return;
    expect(result.ability.filter).toEqual({ types: ['land'] });
    expect(result.ability.controller).toBe('any');
    const { grantedMana } = result.ability.modifier;
    expect(grantedMana.colors).toContain('W');
    expect(grantedMana.colors).toContain('G');
  });

  it('does NOT match "Enchanted land has {T}: Add one mana of any color." (aura-attachedOnly form)', () => {
    // This form is handled by the TappedForManaRider / attachedOnly path; we must not intercept it.
    const result = parseOracleText('Enchanted land has "{T}: Add one mana of any color."');
    // Must NOT be the GrantLandMana kind (may be Unparsed or another matcher)
    if (result.kind === 'StaticAbility') {
      expect(result.ability.modifier.kind).not.toBe('GrantActivatedManaAbility' as string);
    }
  });
});

// ============================================================================
// Part B — Parser: matchTappedForManaRider variant D5 (Market Festival)
// ============================================================================

describe('matchTappedForManaRider — Market Festival variant D5', () => {
  it('recognises "Whenever enchanted land is tapped for mana, its controller adds an additional two mana in any combination of colors."', () => {
    const oracle =
      'Whenever enchanted land is tapped for mana, its controller adds an additional two mana in any combination of colors.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('TappedForManaRider');
    if (result.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(result.ability.modifier.scope).toBe('attachedLand');
    expect(result.ability.modifier.twoAnyColor).toBe(true);
  });

  it('recognises Market Festival with "Enchant land" preamble (newline form)', () => {
    const oracle =
      'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional two mana in any combination of colors.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('TappedForManaRider');
    if (result.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(result.ability.modifier.twoAnyColor).toBe(true);
  });

  it('existing "an additional one mana of any color" variant (D4) still works', () => {
    // Regression: D5 must not break D4
    const oracle =
      'Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('TappedForManaRider');
    if (result.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(result.ability.modifier.anyColor).toBe(1);
  });

  it('existing "two mana in any combination of colors" (variant C) still works', () => {
    // Variant C: not prefixed by "an additional"
    const oracle =
      'Whenever enchanted land is tapped for mana, its controller adds two mana in any combination of colors.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('TappedForManaRider');
    if (result.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(result.ability.modifier.twoAnyColor).toBe(true);
  });
});

// ============================================================================
// Part C — Execution: Lands you control have any-color via GrantActivatedManaAbility
// ============================================================================

describe('matchGrantLandManaAbility — execution: lands gain any-color production', () => {
  /**
   * Set up a game state where:
   *   - p1 owns a Forest (basic land, produces only {G})
   *   - p1 controls an enchantment that has the oracle
   *     "Lands you control have '{T}: Add one mana of any color.'"
   *     and its continuous effect has been registered
   *
   * After registration, the Forest should additionally be able to produce
   * any of W/U/B/R/G via tapLandForMana.
   */
  function setupLandGrantState() {
    const forestDef = makeDef('forest', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
      mana_cost: '',
      cmc: 0,
      colors: [],
      color_identity: ['G'],
      keywords: [],
      card_types: ['land'],
      power: undefined as unknown as number,
      toughness: undefined as unknown as number,
    });

    const enchantmentDef = makeDef('land_grant_enchant', {
      name: 'Land Grant Enchantment',
      type_line: 'Enchantment',
      oracle_text: 'Lands you control have "{T}: Add one mana of any color."',
      mana_cost: '{2}{G}',
      cmc: 3,
      colors: ['G'],
      color_identity: ['G'],
      keywords: [],
      card_types: ['enchantment'],
      power: undefined as unknown as number,
      toughness: undefined as unknown as number,
    });

    const forest = makeCard('forest-1', 'forest', 'p1');
    const enchant = makeCard('enchant-1', 'land_grant_enchant', 'p1');

    const cards = new Map<string, CardInstance>([
      ['forest-1', forest],
      ['enchant-1', enchant],
    ]);
    const defs = new Map<string, CardDefinition>([
      ['forest', forestDef],
      ['land_grant_enchant', enchantmentDef],
    ]);

    let state = makeState({ cards, cardDefinitions: defs });

    // Register the continuous ability from the enchantment
    state = registerContinuousAbilitiesForPermanent(state, 'enchant-1');

    return { state, forestId: 'forest-1', enchantId: 'enchant-1' };
  }

  it('Forest gains any-color mana colors from "Lands you control have {T}: Add any color"', () => {
    const { state, forestId } = setupLandGrantState();

    const colors = getAvailableManaColors(state, forestId);
    // The forest natively produces G, plus any-color grant from the enchantment
    expect(colors).toContain('W');
    expect(colors).toContain('U');
    expect(colors).toContain('B');
    expect(colors).toContain('R');
    expect(colors).toContain('G');
  });

  it('tapLandForMana produces Blue from Forest under land-grant-any-color effect', () => {
    const { state, forestId } = setupLandGrantState();

    // Should be able to tap the Forest for Blue (via granted any-color ability)
    const next = tapLandForMana(state, 'p1', forestId, 'U');
    expect(next.players[0].manaPool.U).toBe(1);
    expect(next.cards.get(forestId)!.tapped).toBe(true);
  });

  it('getLegalActions includes ActivateManaAbility for W on Forest under land-grant effect', () => {
    const { state, forestId } = setupLandGrantState();

    const actions = getLegalActions(state, 'p1');
    const wAction = actions.find(
      a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === forestId && a.color === 'W',
    );
    expect(wAction).toBeDefined();
  });
});
