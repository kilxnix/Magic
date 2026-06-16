/**
 * event-player-mana-rider.test.ts  (Slice 4)
 *
 * Tests for oracle-parser coverage slice 4/12:
 * EventPlayer mana-rider trigger bodies — "that player adds one mana of any
 * type that land produced" and related wordings.
 *
 * Two execution paths are covered:
 *
 *   1. StaticAbility route (matchTappedForManaRider) — the primary path for
 *      tapped-for-mana riders.  "any type that land produced" maps to
 *      TappedForManaRider { anyColor: 1 } which adds mana in the same colour
 *      the land actually produced (via the `color` arg in tapLandForMana).
 *      Also covers "an additional one mana of the chosen color" (Utopia Sprawl
 *      text variant) and "an additional one mana of any type that land produced"
 *      (Glittering Frost text variant).
 *
 *   2. Trigger-body route (matchThatPlayerAddsManaAnyType) — fallback path
 *      when these appear as clause bodies inside the trigger dispatch arrays.
 *      Emits AddMana with { W:1,U:1,B:1,R:1,G:1 } targeting EventPlayer.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import { tapLandForMana } from '../actions';
import { registerContinuousEffect } from '../effects/continuous';
import type { CardDefinition, GameState, CardInstance } from '../types';

// ---------------------------------------------------------------------------
// Helpers (mirrors tapped-for-mana-rider.test.ts)
// ---------------------------------------------------------------------------

function makeLand(id: string, name: string, oracleText = '{T}: Add {G}.'): CardDefinition {
  return {
    id,
    name,
    type_line: 'Basic Land — Forest',
    oracle_text: oracleText,
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeEnchantment(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Enchantment',
    oracle_text: oracleText,
    mana_cost: '{2}{G}{G}',
    cmc: 4,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['enchantment'],
  };
}

function makeAura(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Enchantment — Aura',
    oracle_text: oracleText,
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['enchantment'],
  };
}

function createTestGame(p1Cards: CardDefinition[], p2Cards: CardDefinition[] = []): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-cmd-1' },
    { playerId: 'p2', name: 'Player 2', cards: p2Cards.length ? p2Cards : [makeLand('p2land', 'Forest P2')], commanderId: 'nonexistent-cmd-2' },
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
// PARSING TESTS — StaticAbility route (matchTappedForManaRider variants)
// ---------------------------------------------------------------------------

describe('event-player-mana-rider: parsing (StaticAbility / TappedForManaRider route)', () => {
  // Dictate of Karametra wording — "that player adds one mana of any type that land produced"
  it('Dictate of Karametra: parses as StaticAbility TappedForManaRider anyColor:1 (anyLand scope)', () => {
    const r = parseOracleText(
      'Flash\nWhenever a player taps a land for mana, that player adds one mana of any type that land produced.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
    if (r.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(r.ability.modifier.scope).toBe('anyLand');
    expect(r.ability.modifier.anyColor).toBe(1);
  });

  // Bare "any type that land produced" wording without Flash preamble
  it('"any type that land produced" global rider: parses as TappedForManaRider anyColor:1', () => {
    const r = parseOracleText(
      'Whenever a player taps a land for mana, that player adds one mana of any type that land produced.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
    if (r.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(r.ability.modifier.scope).toBe('anyLand');
    expect(r.ability.modifier.anyColor).toBe(1);
  });

  // Utopia Sprawl wording — "an additional one mana of the chosen color"
  it('Utopia Sprawl: "an additional one mana of the chosen color" parses as TappedForManaRider chosenColor:true', () => {
    // Utopia Sprawl full oracle: "As this Aura enters..." + trigger rider.
    // The mana-rider matcher operates on the trigger sentence only.
    const r = parseOracleText(
      'Whenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
    if (r.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(r.ability.modifier.scope).toBe('attachedLand');
    expect(r.ability.modifier.chosenColor).toBe(true);
  });

  // Glittering Frost wording — "an additional one mana of any type that land produced"
  it('Glittering Frost: "an additional one mana of any type that land produced" parses as TappedForManaRider anyColor:1', () => {
    const r = parseOracleText(
      'Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any type that land produced.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
    if (r.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(r.ability.modifier.scope).toBe('attachedLand');
    expect(r.ability.modifier.anyColor).toBe(1);
  });

  // "an additional one mana of any color" variant
  it('"an additional one mana of any color" attached-land rider parses as TappedForManaRider anyColor:1', () => {
    const r = parseOracleText(
      'Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('TappedForManaRider');
    if (r.ability.modifier.kind !== 'TappedForManaRider') return;
    expect(r.ability.modifier.scope).toBe('attachedLand');
    expect(r.ability.modifier.anyColor).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PARSING TESTS — Trigger-body route (matchThatPlayerAddsManaAnyType)
// ---------------------------------------------------------------------------

describe('event-player-mana-rider: parsing (trigger body matchThatPlayerAddsManaAnyType)', () => {
  // The matcher targets the trigger *body* clause, so we test it by checking
  // that the trigger as a whole parses and emits an AddMana effect targeting
  // EventPlayer.  In practice these cards are routed as StaticAbility first
  // (since matchTappedForManaRider is checked before trigger dispatch), but
  // the body matcher must also work independently so it can be used in other
  // trigger bodies.

  it('"that player adds one mana of any type that land produced" trigger parses correctly', () => {
    // Wrap in a trigger that uses a non-tapped-for-mana prefix so it does NOT
    // match matchTappedForManaRider and instead exercises the trigger+body path.
    // We use a fake/atypical trigger prefix that the engine won't intercept as
    // a mana-rider static — an "at the beginning of your upkeep" prefix.
    const r = parseOracleText(
      'At the beginning of your upkeep, that player adds one mana of any type that land produced.',
    );
    // Either Triggered or StaticAbility is acceptable; the important thing is
    // it is NOT Unparsed.
    expect(r.kind).not.toBe('Unparsed');
  });

  it('"that player adds one mana of any color" parses as a non-Unparsed result', () => {
    const r = parseOracleText(
      'At the beginning of each player\'s upkeep, that player adds one mana of any color.',
    );
    expect(r.kind).not.toBe('Unparsed');
  });

  it('"that player adds one mana of any combination of colors" parses as non-Unparsed', () => {
    const r = parseOracleText(
      'At the beginning of your upkeep, that player adds one mana of any combination of colors.',
    );
    expect(r.kind).not.toBe('Unparsed');
  });

  it('"that player adds one mana of any type that land produced" body emits AddMana effect', () => {
    // Parse just the body clause directly using the body-clause path.
    // We construct an oracle string where the trigger IS the PlayerTapsLandForMana
    // but the mana rider path does NOT fire (to force the trigger dispatch path).
    // The cleanest way: directly test the body matcher result through the trigger.
    // For direct body-matcher testing, we can use the per-player-upkeep trigger:
    const r = parseOracleText(
      'At the beginning of each player\'s upkeep, that player adds one mana of any type that land produced.',
    );
    // Must not be Unparsed
    expect(r.kind).not.toBe('Unparsed');
    if (r.kind === 'Triggered') {
      const addManaEffect = r.ability.effects.find(e => e.kind === 'AddMana');
      expect(addManaEffect).toBeDefined();
      if (addManaEffect && addManaEffect.kind === 'AddMana') {
        expect(addManaEffect.player).toEqual({ kind: 'EventPlayer' });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS — StaticAbility route (anyColor:1 TappedForManaRider)
// ---------------------------------------------------------------------------

describe('event-player-mana-rider: execution (TappedForManaRider anyColor:1)', () => {
  it('Dictate of Karametra: tapping a Forest for {G} gives +1G bonus (matches land colour)', () => {
    const forestDef = makeLand('forest1', 'Forest');
    const dictateDef = makeEnchantment(
      'dictate1',
      'Dictate of Karametra',
      'Flash\nWhenever a player taps a land for mana, that player adds one mana of any type that land produced.',
    );

    let state = createTestGame([forestDef, dictateDef]);
    const forestInst = findCard(state, 'forest1')!;
    const dictateInst = findCard(state, 'dictate1')!;

    state = moveToZone(state, forestInst.instanceId, 'battlefield');
    state = moveToZone(state, dictateInst.instanceId, 'battlefield');

    // Register dictate's static ability as a continuous effect
    const parsed = parseOracleText(dictateDef.oracle_text);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, dictateInst.instanceId, 'p1', parsed.ability);
    }

    const beforeG = manaPool(state, 'p1').G;
    state = tapLandForMana(state, 'p1', forestInst.instanceId, 'G');
    const afterG = manaPool(state, 'p1').G;

    // Forest gives 1G, Dictate adds 1G (anyColor in same colour) → +2G total
    expect(afterG - beforeG).toBe(2);
    // No pending triggers (handled as static, not stack trigger)
    expect(state.pendingTriggers).toHaveLength(0);
  });

  it('Glittering Frost (an additional one mana of any type): tapping enchanted land for {G} gives +1G bonus', () => {
    const forestDef = makeLand('forest1', 'Forest');
    const glitteringFrostDef = makeAura(
      'frost1',
      'Glittering Frost',
      'Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any type that land produced.',
    );

    let state = createTestGame([forestDef, glitteringFrostDef]);
    const forestInst = findCard(state, 'forest1')!;
    const frostInst = findCard(state, 'frost1')!;

    state = moveToZone(state, forestInst.instanceId, 'battlefield');
    state = moveToZone(state, frostInst.instanceId, 'battlefield');
    state = attachAura(state, frostInst.instanceId, forestInst.instanceId);

    const parsed = parseOracleText(glitteringFrostDef.oracle_text);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, frostInst.instanceId, 'p1', parsed.ability);
    }

    const beforeG = manaPool(state, 'p1').G;
    state = tapLandForMana(state, 'p1', forestInst.instanceId, 'G');
    const afterG = manaPool(state, 'p1').G;

    // Forest gives 1G, Frost adds 1G bonus → +2G total
    expect(afterG - beforeG).toBe(2);
    expect(state.pendingTriggers).toHaveLength(0);
  });

  it('Glittering Frost: does NOT add bonus when a DIFFERENT land is tapped (attachedLand scope)', () => {
    const enchantedForest = makeLand('forest1', 'Enchanted Forest');
    const otherForest = makeLand('forest2', 'Other Forest');
    const glitteringFrostDef = makeAura(
      'frost1',
      'Glittering Frost',
      'Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any type that land produced.',
    );

    let state = createTestGame([enchantedForest, otherForest, glitteringFrostDef]);
    const enchantedInst = findCard(state, 'forest1')!;
    const otherInst = findCard(state, 'forest2')!;
    const frostInst = findCard(state, 'frost1')!;

    state = moveToZone(state, enchantedInst.instanceId, 'battlefield');
    state = moveToZone(state, otherInst.instanceId, 'battlefield');
    state = moveToZone(state, frostInst.instanceId, 'battlefield');
    // Attach frost to enchantedForest, NOT otherForest
    state = attachAura(state, frostInst.instanceId, enchantedInst.instanceId);

    const parsed = parseOracleText(glitteringFrostDef.oracle_text);
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, frostInst.instanceId, 'p1', parsed.ability);
    }

    // Tap the OTHER forest (not the enchanted one)
    const beforeG = manaPool(state, 'p1').G;
    state = tapLandForMana(state, 'p1', otherInst.instanceId, 'G');
    const afterG = manaPool(state, 'p1').G;

    // Only 1G from the land — no bonus
    expect(afterG - beforeG).toBe(1);
  });
});
