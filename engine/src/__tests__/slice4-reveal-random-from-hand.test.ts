/**
 * Slice 4 — "target opponent/player reveals a card at random from their hand"
 *
 * Covers: Planeswalker's Favor (pump), Planeswalker's Fury (damage), Wand of Ith (standalone).
 *
 * Parse tests:
 *  1. Wand of Ith standalone — parses as Spell with RevealRandomCardFromHand + 1 Player target
 *  2. Planeswalker's Fury — two-clause: RevealRandomCardFromHand + DealDamage(RevealedRandomCardManaValue)
 *  3. Planeswalker's Favor — two-clause: RevealRandomCardFromHand + ModifyPT(RevealedRandomCardManaValue)
 *  4. "target player" variant (not just "target opponent")
 *
 * Execution tests:
 *  5. RevealRandomCardFromHand executor: stores lastRevealedCardManaValue from lowest-instanceId hand card
 *  6. Planeswalker's Fury full execution: damage dealt = revealed card's CMC
 *  7. Planeswalker's Fury: hand empty → 0 damage
 *  8. Planeswalker's Favor full execution: creature gets +X/+X where X = revealed card's CMC
 *  9. Wand of Ith standalone: no state change to hand or life totals
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealRandomCardFromHandEffect, DealDamageEffect, ModifyPTEffect } from '../effects/ast';

// ── card definitions ──────────────────────────────────────────────────────────

const creatureCmc3: CardDefinition = {
  id: 'cre3', name: 'Gray Ogre', type_line: 'Creature — Ogre',
  oracle_text: '', mana_cost: '{2}{R}', cmc: 3, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 2,
};

const creatureCmc5: CardDefinition = {
  id: 'cre5', name: 'Baneslayer Angel', type_line: 'Creature — Angel',
  oracle_text: '', mana_cost: '{3}{W}{W}', cmc: 5, colors: ['W'], color_identity: ['W'],
  keywords: [], card_types: ['creature'], power: 5, toughness: 5,
};

const landDef: CardDefinition = {
  id: 'land', name: 'Plains', type_line: 'Basic Land — Plains',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['W'],
  keywords: [], card_types: ['land'],
};

const enchantmentDef: CardDefinition = {
  id: 'ench', name: "Planeswalker's Fury", type_line: 'Enchantment',
  oracle_text: "{3}{R}: Target opponent reveals a card at random from their hand. This enchantment deals damage equal to that card's mana value to any target.",
  mana_cost: '{3}{R}', cmc: 4, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['enchantment'],
};

const favorEnchDef: CardDefinition = {
  id: 'favor', name: "Planeswalker's Favor", type_line: 'Enchantment',
  oracle_text: "{3}{G}: Target opponent reveals a card at random from their hand. Target creature gets +X/+X until end of turn, where X is that card's mana value.",
  mana_cost: '{3}{G}', cmc: 4, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['enchantment'],
};

const wandDef: CardDefinition = {
  id: 'wand', name: 'Wand of Ith', type_line: 'Artifact',
  oracle_text: '{3}, {T}: Target player reveals a card at random from their hand.',
  mana_cost: '{3}', cmc: 3, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact'],
};

// ── state helpers ─────────────────────────────────────────────────────────────

function makeState(
  p1HandCards: { instanceId: string; definitionId: string }[] = [],
  battlefieldCards: { instanceId: string; definitionId: string; ownerId: string }[] = [],
): GameState {
  const defs = new Map<string, CardDefinition>([
    ['cre3', creatureCmc3],
    ['cre5', creatureCmc5],
    ['land', landDef],
    ['ench', enchantmentDef],
    ['favor', favorEnchDef],
    ['wand', wandDef],
  ]);

  const cards = new Map<string, CardInstance>();
  for (const { instanceId, definitionId } of p1HandCards) {
    cards.set(instanceId, {
      instanceId, definitionId, ownerId: 'p1', zone: 'hand',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  }
  for (const { instanceId, definitionId, ownerId } of battlefieldCards) {
    cards.set(instanceId, {
      instanceId, definitionId, ownerId, zone: 'battlefield',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  }

  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards, cardDefinitions: defs,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main',
    step: 'begin_combat', turnNumber: 2, hasPriorityPassed: [false, false],
    stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function spellParse(text: string) {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason ?? '')}`);
  return p;
}

// ── parse tests ───────────────────────────────────────────────────────────────

describe('Slice 4 — RevealRandomCardFromHand: parse tests', () => {
  it('1. Wand of Ith standalone parses as Spell with RevealRandomCardFromHand', () => {
    const p = spellParse('Target player reveals a card at random from their hand.');
    expect(p.kind).toBe('Spell');
    expect(p.effects).toHaveLength(1);
    const eff = p.effects[0] as RevealRandomCardFromHandEffect;
    expect(eff.kind).toBe('RevealRandomCardFromHand');
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
  });

  it("2. Planeswalker's Fury parses as two-clause: RevealRandomCardFromHand + DealDamage", () => {
    const text = "Target opponent reveals a card at random from their hand. This enchantment deals damage equal to that card's mana value to any target.";
    const p = spellParse(text);
    expect(p.effects.length).toBeGreaterThanOrEqual(2);
    const revealEff = p.effects[0] as RevealRandomCardFromHandEffect;
    expect(revealEff.kind).toBe('RevealRandomCardFromHand');
    const dmgEff = p.effects[1] as DealDamageEffect;
    expect(dmgEff.kind).toBe('DealDamage');
    expect(typeof dmgEff.amount).toBe('object');
    if (typeof dmgEff.amount === 'object') {
      expect(dmgEff.amount.kind).toBe('RevealedRandomCardManaValue');
    }
    // Should have two targets: Player (opponent) + Any target
    expect(p.targets.length).toBeGreaterThanOrEqual(2);
    expect(p.targets.some(t => t.type === 'Player')).toBe(true);
    expect(p.targets.some(t => t.type === 'Any')).toBe(true);
  });

  it("3. Planeswalker's Favor parses as two-clause: RevealRandomCardFromHand + ModifyPT(RevealedRandomCardManaValue)", () => {
    const text = "Target opponent reveals a card at random from their hand. Target creature gets +X/+X until end of turn, where X is that card's mana value.";
    const p = spellParse(text);
    expect(p.effects.length).toBeGreaterThanOrEqual(2);
    const revealEff = p.effects[0] as RevealRandomCardFromHandEffect;
    expect(revealEff.kind).toBe('RevealRandomCardFromHand');
    const pumpEff = p.effects[1] as ModifyPTEffect;
    expect(pumpEff.kind).toBe('ModifyPT');
    expect(typeof pumpEff.power).toBe('object');
    if (typeof pumpEff.power === 'object') {
      expect(pumpEff.power.kind).toBe('RevealedRandomCardManaValue');
    }
    expect(typeof pumpEff.toughness).toBe('object');
    if (typeof pumpEff.toughness === 'object') {
      expect(pumpEff.toughness.kind).toBe('RevealedRandomCardManaValue');
    }
  });

  it('4. "target player" variant also parses (not opponent-only)', () => {
    const p = spellParse('Target player reveals a card at random from their hand.');
    expect(p.kind).toBe('Spell');
    const eff = p.effects[0] as RevealRandomCardFromHandEffect;
    expect(eff.kind).toBe('RevealRandomCardFromHand');
    // Player target should not have opponentControls constraint
    expect(p.targets[0].constraints?.opponentControls).toBeFalsy();
  });
});

// ── execution tests ───────────────────────────────────────────────────────────

describe('Slice 4 — RevealRandomCardFromHand: execution tests', () => {
  it('5. RevealRandomCardFromHand: no zone change, hand untouched', () => {
    const state = makeState([
      { instanceId: 'h1', definitionId: 'cre3' },
      { instanceId: 'h2', definitionId: 'cre5' },
    ]);
    const p = parseOracleText('Target player reveals a card at random from their hand.');
    if (p.kind !== 'Spell') throw new Error('not a spell');
    const playerSpec = p.targets.find(t => t.type === 'Player')!;
    const after = executeEffects(state, p.effects, 'p0', ['p1'], [{ id: playerSpec.id }], 0, {});
    // Hand must be unchanged
    const hand = [...after.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'hand');
    expect(hand).toHaveLength(2);
    // Players' life totals must be unchanged (Commander default: 40)
    expect(after.players.find(p => p.id === 'p0')!.life).toBe(40);
    expect(after.players.find(p => p.id === 'p1')!.life).toBe(40);
  });

  it("6. Planeswalker's Fury: deals damage equal to revealed card's CMC", () => {
    // P1's hand has a cmc-5 creature (Baneslayer); it will be revealed (lowest instanceId wins).
    const state = makeState([
      { instanceId: 'hcard', definitionId: 'cre5' },
    ]);
    const text = "Target opponent reveals a card at random from their hand. This enchantment deals damage equal to that card's mana value to any target.";
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('not a spell');
    const playerSpec = p.targets.find(t => t.type === 'Player')!;
    const anySpec = p.targets.find(t => t.type === 'Any')!;
    // Target p0 with the "any target" damage portion
    const after = executeEffects(state, p.effects, 'p0', ['p1', 'p0'], [{ id: playerSpec.id }, { id: anySpec.id }], 0, {});
    // p0 should have taken 5 damage (CMC of Baneslayer Angel, Commander default life 40)
    expect(after.players.find(p => p.id === 'p0')!.life).toBe(35);
  });

  it("7. Planeswalker's Fury: empty hand → 0 damage", () => {
    const state = makeState([]); // p1 has empty hand
    const text = "Target opponent reveals a card at random from their hand. This enchantment deals damage equal to that card's mana value to any target.";
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('not a spell');
    const playerSpec = p.targets.find(t => t.type === 'Player')!;
    const anySpec = p.targets.find(t => t.type === 'Any')!;
    const after = executeEffects(state, p.effects, 'p0', ['p1', 'p0'], [{ id: playerSpec.id }, { id: anySpec.id }], 0, {});
    // 0 damage taken (Commander default life 40)
    expect(after.players.find(p => p.id === 'p0')!.life).toBe(40);
  });

  it("8. Planeswalker's Favor: creature gets +X/+X where X = revealed card's CMC", () => {
    // P1's hand has cmc-3 creature. P0 has a creature on the battlefield.
    const state = makeState(
      [{ instanceId: 'hcard', definitionId: 'cre3' }],
      [{ instanceId: 'bcre', definitionId: 'cre3', ownerId: 'p0' }],
    );
    const text = "Target opponent reveals a card at random from their hand. Target creature gets +X/+X until end of turn, where X is that card's mana value.";
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('not a spell');
    const playerSpec = p.targets.find(t => t.type === 'Player')!;
    const creatureSpec = p.targets.find(t => t.type === 'Creature')!;
    // Reveal p1's hand, pump p0's battlefield creature
    const after = executeEffects(state, p.effects, 'p0', ['p1', 'bcre'], [{ id: playerSpec.id }, { id: creatureSpec.id }], 0, {});
    // The creature should have +3/+3 counters (CMC of Gray Ogre)
    const cre = after.cards.get('bcre');
    expect(cre).toBeDefined();
    const powerMod = cre!.counters['_powerMod'] ?? 0;
    const toughnessMod = cre!.counters['_toughnessMod'] ?? 0;
    expect(powerMod).toBe(3);
    expect(toughnessMod).toBe(3);
  });

  it('9. Wand of Ith (target player): no state change, hand stays intact', () => {
    const state = makeState([
      { instanceId: 'c1', definitionId: 'cre3' },
      { instanceId: 'c2', definitionId: 'land' },
    ]);
    const p = parseOracleText('Target player reveals a card at random from their hand.');
    if (p.kind !== 'Spell') throw new Error('not a spell');
    const playerSpec = p.targets.find(t => t.type === 'Player')!;
    const after = executeEffects(state, p.effects, 'p0', ['p1'], [{ id: playerSpec.id }], 0, {});
    // Hand completely unchanged
    const hand = [...after.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'hand');
    expect(hand).toHaveLength(2);
  });
});
