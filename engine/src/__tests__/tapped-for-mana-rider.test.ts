/**
 * tapped-for-mana-rider.test.ts  (Slice 7)
 *
 * Covers parsing and execution for the two tapped-for-mana rider families:
 *
 *   1. Enchanted-land rider ("Whenever enchanted land is tapped for mana, its
 *      controller adds <mana>") — Market Festival, Overgrowth, Dawn's Reflection,
 *      Trace of Abundance.
 *
 *   2. Global rider ("Whenever a player taps a land for mana, that player adds
 *      <mana>") — Zhur-Taa Ancient family.
 *
 * Both are parsed as StaticAbilityEffect with modifier.kind === 'TappedForManaRider'
 * and enforced inside tapLandForMana (actions.ts) without using the trigger stack.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import { tapLandForMana } from '../actions';
import { registerBattlefieldAbilities, registerContinuousAbilitiesForPermanent } from '../stack';
import { registerContinuousEffect } from '../effects/continuous';
import type { CardDefinition, GameState, CardInstance } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLand(id: string, name: string, typeLine = 'Basic Land — Forest'): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeAura(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Enchantment — Aura',
    oracle_text: oracleText,
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['enchantment'],
  };
}

function makeCreature(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature — Beast',
    oracle_text: oracleText,
    mana_cost: '{3}{R}{G}',
    cmc: 5,
    colors: ['R', 'G'],
    color_identity: ['R', 'G'],
    keywords: [],
    card_types: ['creature'],
    power: 4,
    toughness: 5,
  };
}

function createTestGame(p1Cards: CardDefinition[], p2Cards: CardDefinition[] = []): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-cmd-1' },
    { playerId: 'p2', name: 'Player 2', cards: p2Cards.length ? p2Cards : [makeLand('p2land', 'Forest')], commanderId: 'nonexistent-cmd-2' },
  ]);
}

function findCard(state: GameState, defId: string): CardInstance | undefined {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  return undefined;
}

function moveToZone(state: GameState, instanceId: string, zone: 'battlefield' | 'hand'): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone, tapped: false, summoningSick: false });
  return { ...state, cards: newCards };
}

/** Attach an aura instance to a land instance. */
function attachAura(state: GameState, auraId: string, landId: string): GameState {
  const aura = state.cards.get(auraId);
  if (!aura) throw new Error(`Aura not found: ${auraId}`);
  const newCards = new Map(state.cards);
  newCards.set(auraId, { ...aura, attachedTo: landId });
  return { ...state, cards: newCards };
}

function manaPool(state: GameState, playerId: string) {
  return state.players.find(p => p.id === playerId)!.manaPool;
}

// ---------------------------------------------------------------------------
// PARSING TESTS
// ---------------------------------------------------------------------------

describe('tapped-for-mana-rider parsing', () => {
  it('parses Overgrowth: enchanted land tapped for mana → {G}{G} fixed rider', () => {
    const r = parseOracleText(
      'Whenever enchanted land is tapped for mana, its controller adds {G}{G} to their mana pool in addition to the mana the land produces.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
    if (r.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(r.ability.modifier.scope).toBe('attachedLand');
    expect(r.ability.modifier.mana).toEqual({ G: 2 });
  });

  it('parses Market Festival: enchanted land tapped for mana → {G}{G} rider (same text variant)', () => {
    const r = parseOracleText(
      'Whenever enchanted land is tapped for mana, its controller adds {G}{G} to their mana pool in addition to the mana the land produces.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
  });

  it('parses Dawn\'s Reflection: two mana in any combination of colors', () => {
    const r = parseOracleText(
      "Whenever enchanted land is tapped for mana, its controller adds two mana in any combination of colors to their mana pool in addition to the mana the land produces.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
    if (r.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(r.ability.modifier.scope).toBe('attachedLand');
    expect(r.ability.modifier.twoAnyColor).toBe(true);
  });

  it('parses Trace of Abundance: one mana of any color', () => {
    const r = parseOracleText(
      'Whenever enchanted land is tapped for mana, its controller adds one mana of any color to their mana pool in addition to the mana the land produces.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
    if (r.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(r.ability.modifier.scope).toBe('attachedLand');
    expect(r.ability.modifier.anyColor).toBe(1);
  });

  it('parses Zhur-Taa Ancient: global rider adds {R}{G} fixed mana', () => {
    const r = parseOracleText(
      'Whenever a player taps a land for mana, that player adds an additional {R}{G} to their mana pool in addition to the mana the land produces.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
    if (r.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(r.ability.modifier.scope).toBe('anyLand');
    expect(r.ability.modifier.mana).toEqual({ R: 1, G: 1 });
  });

  it('parses global rider without "additional" keyword (simple form)', () => {
    // Shorter wording: "that player adds {R}{G}"
    const r = parseOracleText(
      'Whenever a player taps a land for mana, that player adds {R}{G}.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
    if (r.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(r.ability.modifier.scope).toBe('anyLand');
    expect(r.ability.modifier.mana).toEqual({ R: 1, G: 1 });
  });

  it('does NOT parse unrelated "whenever" trigger text as a mana rider', () => {
    const r = parseOracleText(
      'Whenever a creature enters the battlefield, draw a card.',
    );
    expect(r.kind).not.toBe('StaticAbility');
  });

  it('does NOT parse Manabarbs punisher as a mana rider', () => {
    const r = parseOracleText(
      'Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.',
    );
    // Must be Triggered (punisher), not StaticAbility mana-rider
    expect(r.kind).toBe('Triggered');
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS — enchanted-land rider (Overgrowth family)
// ---------------------------------------------------------------------------

describe('tapped-for-mana-rider execution: enchanted-land scope', () => {
  it('Overgrowth: tapping the enchanted Forest adds {G} + {G}{G} bonus (3G total)', () => {
    const forestDef = makeLand('forest1', 'Forest');
    const overgrowthDef = makeAura(
      'overgrowth1',
      'Overgrowth',
      'Whenever enchanted land is tapped for mana, its controller adds {G}{G} to their mana pool in addition to the mana the land produces.',
    );

    let state = createTestGame([forestDef, overgrowthDef]);
    const forestInst = findCard(state, 'forest1')!;
    const overgrowthInst = findCard(state, 'overgrowth1')!;

    // Put forest and overgrowth onto the battlefield
    state = moveToZone(state, forestInst.instanceId, 'battlefield');
    state = moveToZone(state, overgrowthInst.instanceId, 'battlefield');

    // Attach overgrowth to forest
    state = attachAura(state, overgrowthInst.instanceId, forestInst.instanceId);

    // Register the overgrowth as a continuous effect (simulates entering the battlefield)
    const parsed = parseOracleText(overgrowthDef.oracle_text);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, overgrowthInst.instanceId, 'p1', parsed.ability);
    }

    const before = manaPool(state, 'p1').G;
    state = tapLandForMana(state, 'p1', forestInst.instanceId, 'G');
    const after = manaPool(state, 'p1').G;

    // Forest gives 1G, Overgrowth adds 2G → total +3G
    expect(after - before).toBe(3);
    // No pending triggers (not a stack trigger)
    expect(state.pendingTriggers).toHaveLength(0);
  });

  it('Overgrowth: does NOT trigger when a DIFFERENT land is tapped', () => {
    const forestDef = makeLand('forest1', 'Forest');
    const forest2Def = makeLand('forest2', 'Forest2');
    const overgrowthDef = makeAura(
      'overgrowth1',
      'Overgrowth',
      'Whenever enchanted land is tapped for mana, its controller adds {G}{G} to their mana pool in addition to the mana the land produces.',
    );

    let state = createTestGame([forestDef, forest2Def, overgrowthDef]);
    const forestInst = findCard(state, 'forest1')!;
    const forest2Inst = findCard(state, 'forest2')!;
    const overgrowthInst = findCard(state, 'overgrowth1')!;

    state = moveToZone(state, forestInst.instanceId, 'battlefield');
    state = moveToZone(state, forest2Inst.instanceId, 'battlefield');
    state = moveToZone(state, overgrowthInst.instanceId, 'battlefield');
    // Overgrowth is attached to forest1
    state = attachAura(state, overgrowthInst.instanceId, forestInst.instanceId);

    const parsed = parseOracleText(overgrowthDef.oracle_text);
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, overgrowthInst.instanceId, 'p1', parsed.ability);
    }

    // Tap forest2 (NOT the enchanted forest)
    const before = manaPool(state, 'p1').G;
    state = tapLandForMana(state, 'p1', forest2Inst.instanceId, 'G');
    const after = manaPool(state, 'p1').G;

    // Only 1G from the land itself — no bonus
    expect(after - before).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS — global rider (Zhur-Taa Ancient family)
// ---------------------------------------------------------------------------

describe('tapped-for-mana-rider execution: global scope', () => {
  it('Zhur-Taa Ancient: tapping ANY land adds {R}{G} bonus to the tapping player', () => {
    const forestDef = makeLand('forest1', 'Forest');
    const zhurTaaDef = makeCreature(
      'zhurtaa1',
      'Zhur-Taa Ancient',
      'Whenever a player taps a land for mana, that player adds an additional {R}{G} to their mana pool in addition to the mana the land produces.',
    );

    let state = createTestGame([forestDef, zhurTaaDef]);
    const forestInst = findCard(state, 'forest1')!;
    const zhurTaaInst = findCard(state, 'zhurtaa1')!;

    state = moveToZone(state, forestInst.instanceId, 'battlefield');
    state = moveToZone(state, zhurTaaInst.instanceId, 'battlefield');

    const parsed = parseOracleText(zhurTaaDef.oracle_text);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, zhurTaaInst.instanceId, 'p1', parsed.ability);
    }

    const beforeG = manaPool(state, 'p1').G;
    const beforeR = manaPool(state, 'p1').R;
    state = tapLandForMana(state, 'p1', forestInst.instanceId, 'G');
    const afterG = manaPool(state, 'p1').G;
    const afterR = manaPool(state, 'p1').R;

    // Forest gives 1G, Zhur-Taa adds {R}{G} → total +2G +1R
    expect(afterG - beforeG).toBe(2);
    expect(afterR - beforeR).toBe(1);
    // No pending triggers
    expect(state.pendingTriggers).toHaveLength(0);
  });

  it('Zhur-Taa Ancient: bonus also fires when opponent taps a land', () => {
    // The global rider fires for ANY player tapping a land; 'that player' gets the bonus.
    // Here p2 taps a land while p1 controls Zhur-Taa → p2 gets the bonus.
    const p1Forest = makeLand('p1forest', 'Forest P1');
    const zhurTaaDef = makeCreature(
      'zhurtaa1',
      'Zhur-Taa Ancient',
      'Whenever a player taps a land for mana, that player adds an additional {R}{G} to their mana pool in addition to the mana the land produces.',
    );
    const p2Forest = makeLand('p2forest', 'Forest P2');

    let state = createTestGame([p1Forest, zhurTaaDef], [p2Forest]);
    const zhurTaaInst = findCard(state, 'zhurtaa1')!;
    const p2ForestInst = findCard(state, 'p2forest')!;

    state = moveToZone(state, zhurTaaInst.instanceId, 'battlefield');
    state = moveToZone(state, p2ForestInst.instanceId, 'battlefield');

    const parsed = parseOracleText(zhurTaaDef.oracle_text);
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, zhurTaaInst.instanceId, 'p1', parsed.ability);
    }

    // p2 taps their forest
    const beforeG = manaPool(state, 'p2').G;
    const beforeR = manaPool(state, 'p2').R;
    state = tapLandForMana(state, 'p2', p2ForestInst.instanceId, 'G');
    const afterG = manaPool(state, 'p2').G;
    const afterR = manaPool(state, 'p2').R;

    // p2 gets 1G from land + 1R + 1G from Zhur-Taa bonus
    expect(afterG - beforeG).toBe(2);
    expect(afterR - beforeR).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// INTEGRATION: registerBattlefieldAbilities path
// ---------------------------------------------------------------------------

describe('tapped-for-mana-rider: registerContinuousAbilitiesForPermanent integration', () => {
  it('Overgrowth registers as a TappedForManaRider continuous effect when it enters the battlefield', () => {
    const forestDef = makeLand('forest1', 'Forest');
    const overgrowthDef = makeAura(
      'overgrowth1',
      'Overgrowth',
      'Whenever enchanted land is tapped for mana, its controller adds {G}{G} to their mana pool in addition to the mana the land produces.',
    );

    let state = createTestGame([forestDef, overgrowthDef]);
    const forestInst = findCard(state, 'forest1')!;
    const overgrowthInst = findCard(state, 'overgrowth1')!;

    state = moveToZone(state, forestInst.instanceId, 'battlefield');
    state = moveToZone(state, overgrowthInst.instanceId, 'battlefield');
    state = attachAura(state, overgrowthInst.instanceId, forestInst.instanceId);

    // registerContinuousAbilitiesForPermanent is what's called on battlefield entry
    // for all static abilities
    state = registerContinuousAbilitiesForPermanent(state, overgrowthInst.instanceId);

    const riderEffects = (state.continuousEffects ?? []).filter(
      ce => ce.ability.modifier.kind === 'TappedForManaRider',
    );
    expect(riderEffects.length).toBeGreaterThanOrEqual(1);
    expect(riderEffects[0].ability.modifier.kind).toBe('TappedForManaRider');
    if (riderEffects[0].ability.modifier.kind === 'TappedForManaRider') {
      expect(riderEffects[0].ability.modifier.scope).toBe('attachedLand');
      expect(riderEffects[0].ability.modifier.mana).toEqual({ G: 2 });
    }
  });

  it('Overgrowth via registerContinuousAbilitiesForPermanent: tapping gives +2G bonus', () => {
    const forestDef = makeLand('forest1', 'Forest');
    const overgrowthDef = makeAura(
      'overgrowth1',
      'Overgrowth',
      'Whenever enchanted land is tapped for mana, its controller adds {G}{G} to their mana pool in addition to the mana the land produces.',
    );

    let state = createTestGame([forestDef, overgrowthDef]);
    const forestInst = findCard(state, 'forest1')!;
    const overgrowthInst = findCard(state, 'overgrowth1')!;

    state = moveToZone(state, forestInst.instanceId, 'battlefield');
    state = moveToZone(state, overgrowthInst.instanceId, 'battlefield');
    state = attachAura(state, overgrowthInst.instanceId, forestInst.instanceId);
    state = registerContinuousAbilitiesForPermanent(state, overgrowthInst.instanceId);

    const before = manaPool(state, 'p1').G;
    state = tapLandForMana(state, 'p1', forestInst.instanceId, 'G');
    const after = manaPool(state, 'p1').G;

    // 1G from the Forest + 2G from Overgrowth = 3G total
    expect(after - before).toBe(3);
  });
});
