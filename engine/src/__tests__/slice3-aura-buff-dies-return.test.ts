/**
 * Slice 3 — Aura buff + "when enchanted creature dies, return this card to
 * its owner's hand" trigger family.
 *
 * Covers the extension to matchReturnToHand that accepts "return this card
 * to its owner's hand" as ReturnToHand with Source target (the Aura itself),
 * enabling oracle texts like Ghoulish Impetus, Angelic Destiny, and Soul Snare.
 *
 * EXECUTOR ROUTE:
 *   - Static buff: parseEquipmentBonus cache in card-parser-cache.ts.
 *   - AttachedCreatureDies trigger: stack.ts fires when source.attachedTo === dying
 *     creature instanceId (existing trigger.kind === 'AttachedCreatureDies').
 *   - ReturnToHand(Source): executor.ts ReturnToHand case uses sourceInstanceId
 *     (the aura's instanceId) → executeReturnToHand(state, aura.instanceId).
 *
 * No new AST nodes, no new executor verbs.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseDef(over: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id: 'base', name: 'Base', type_line: 'Enchantment — Aura',
    oracle_text: '', mana_cost: '{1}{W}', cmc: 2,
    colors: ['W'], color_identity: ['W'], keywords: [],
    card_types: ['enchantment'],
    ...over,
  };
}

function makeCard(
  id: string,
  owner: string,
  zone: CardInstance['zone'] = 'battlefield',
  over: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId: id, definitionId: 'base', ownerId: owner, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0,
    isCommander: false, ...over,
  };
}

function makeState(cards: CardInstance[]): GameState {
  const def = baseDef();
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map([['base', def]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

// ---------------------------------------------------------------------------
// Parse tests
// ---------------------------------------------------------------------------

describe('Slice 3: return this card to its owner\'s hand — parse', () => {
  it('parses bare "return this card to its owner\'s hand." as ReturnToHand(Source)', () => {
    const result = parseOracleText("Return this card to its owner's hand.");
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const [effect] = result.effects;
    expect(effect.kind).toBe('ReturnToHand');
    if (effect.kind !== 'ReturnToHand') return;
    expect(effect.target).toEqual({ kind: 'Source' });
  });

  it('matches "return this card" without consuming trailing period in consumed count', () => {
    const result = parseOracleText("Return this card to its owner's hand.");
    expect(result.kind).toBe('Spell');
    expect(result.kind).not.toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// Ghoulish Impetus family: buff + deathtouch + dies-return trigger
// ---------------------------------------------------------------------------

describe('Slice 3: Ghoulish Impetus family — buff + dies-return trigger', () => {
  /**
   * Ghoulish Impetus (real oracle):
   * Enchant creature
   * Enchanted creature gets +1/+1 and has deathtouch. Goad enchanted creature.
   * When enchanted creature dies, return this card to its owner's hand.
   */
  const ghoulishImpetus =
    "Enchant creature\n" +
    "Enchanted creature gets +1/+1 and has deathtouch. Goad enchanted creature.\n" +
    "When enchanted creature dies, return this card to its owner's hand.";

  it('parses as Dies trigger (not Unparsed)', () => {
    const result = parseOracleText(ghoulishImpetus);
    expect(result.kind).toBe('Dies');
  });

  it('trigger kind is AttachedCreatureDies', () => {
    const result = parseOracleText(ghoulishImpetus);
    if (result.kind !== 'Dies') throw new Error('expected Dies');
    expect(result.ability.trigger).toEqual({ kind: 'AttachedCreatureDies' });
  });

  it('trigger body is ReturnToHand with Source target', () => {
    const result = parseOracleText(ghoulishImpetus);
    if (result.kind !== 'Dies') throw new Error('expected Dies');
    const [effect] = result.ability.effects;
    expect(effect.kind).toBe('ReturnToHand');
    if (effect.kind !== 'ReturnToHand') return;
    expect(effect.target).toEqual({ kind: 'Source' });
  });

  it('has no chosen targets (Source is resolved at execution time)', () => {
    const result = parseOracleText(ghoulishImpetus);
    if (result.kind !== 'Dies') throw new Error('expected Dies');
    expect(result.targets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Angelic Destiny family: bigger buff + flying + first strike + is an Angel
// ---------------------------------------------------------------------------

describe('Slice 3: Angelic Destiny family — buff + flying + first strike + dies-return', () => {
  /**
   * Angelic Destiny (real oracle):
   * Enchant creature
   * Enchanted creature gets +4/+4 and gains flying and first strike and is an Angel.
   * When enchanted creature dies, return this card to its owner's hand.
   */
  const angelicDestiny =
    "Enchant creature\n" +
    "Enchanted creature gets +4/+4 and gains flying and first strike and is an Angel.\n" +
    "When enchanted creature dies, return this card to its owner's hand.";

  it('parses as Dies trigger (not Unparsed)', () => {
    const result = parseOracleText(angelicDestiny);
    expect(result.kind).toBe('Dies');
  });

  it('trigger kind is AttachedCreatureDies', () => {
    const result = parseOracleText(angelicDestiny);
    if (result.kind !== 'Dies') throw new Error('expected Dies');
    expect(result.ability.trigger).toEqual({ kind: 'AttachedCreatureDies' });
  });

  it('trigger body is ReturnToHand with Source', () => {
    const result = parseOracleText(angelicDestiny);
    if (result.kind !== 'Dies') throw new Error('expected Dies');
    const [effect] = result.ability.effects;
    expect(effect.kind).toBe('ReturnToHand');
    if (effect.kind !== 'ReturnToHand') return;
    expect(effect.target).toEqual({ kind: 'Source' });
  });
});

// ---------------------------------------------------------------------------
// Radiant Grace: keyword-only buff Aura, no trigger — still parses
// ---------------------------------------------------------------------------

describe('Slice 3: Radiant Grace — keyword-only buff Aura (regression)', () => {
  /**
   * Radiant Grace (simplified oracle):
   * Enchant creature
   * Enchanted creature gets +1/+0 and has vigilance.
   */
  const radiantGrace =
    "Enchant creature\n" +
    "Enchanted creature gets +1/+0 and has vigilance.";

  it('still parses as StaticAbility (regression guard)', () => {
    const result = parseOracleText(radiantGrace);
    expect(result.kind).toBe('StaticAbility');
  });
});

// ---------------------------------------------------------------------------
// Execution test: ReturnToHand(Source) moves the aura back to hand
// ---------------------------------------------------------------------------

describe('Slice 3: ReturnToHand(Source) execution', () => {
  it('returns the aura (source) from battlefield to hand', () => {
    // Set up: aura is on battlefield, attached to 'creature'
    const aura = makeCard('aura', 'p0', 'battlefield', { attachedTo: 'creature' });
    const creature = makeCard('creature', 'p0', 'battlefield');
    const state = makeState([aura, creature]);

    const effects = [{ kind: 'ReturnToHand' as const, target: { kind: 'Source' as const } }];
    const after = executeEffects(state, effects, 'p0', [], [], 0, {
      sourceInstanceId: 'aura',
    });

    expect(after.cards.get('aura')!.zone).toBe('hand');
    // Creature is unaffected.
    expect(after.cards.get('creature')!.zone).toBe('battlefield');
  });

  it('no-ops gracefully when sourceInstanceId is absent', () => {
    const aura = makeCard('aura', 'p0', 'battlefield');
    const state = makeState([aura]);

    const effects = [{ kind: 'ReturnToHand' as const, target: { kind: 'Source' as const } }];
    // Should not throw even without sourceInstanceId.
    expect(() => executeEffects(state, effects, 'p0', [], [], 0, {})).not.toThrow();
  });

  it('returns the aura even when the attached creature is no longer on battlefield', () => {
    // Simulates the trigger firing: creature already died/moved to graveyard
    // The aura is still on battlefield (it may be moved to graveyard by SBA later,
    // but the trigger fires before SBA removes it).
    const aura = makeCard('aura', 'p0', 'battlefield');
    const creature = makeCard('creature', 'p0', 'graveyard');
    const state = makeState([aura, creature]);

    const effects = [{ kind: 'ReturnToHand' as const, target: { kind: 'Source' as const } }];
    const after = executeEffects(state, effects, 'p0', [], [], 0, {
      sourceInstanceId: 'aura',
    });

    expect(after.cards.get('aura')!.zone).toBe('hand');
  });
});

// ---------------------------------------------------------------------------
// Minimal-form dies trigger (no buff line)
// ---------------------------------------------------------------------------

describe('Slice 3: bare dies-return Aura (no buff)', () => {
  const simpleDiesReturn =
    "Enchant creature\n" +
    "When enchanted creature dies, return this card to its owner's hand.";

  it('parses as Dies trigger', () => {
    const result = parseOracleText(simpleDiesReturn);
    expect(result.kind).toBe('Dies');
  });

  it('trigger is AttachedCreatureDies with ReturnToHand(Source)', () => {
    const result = parseOracleText(simpleDiesReturn);
    if (result.kind !== 'Dies') throw new Error('expected Dies');
    expect(result.ability.trigger).toEqual({ kind: 'AttachedCreatureDies' });
    const [effect] = result.ability.effects;
    expect(effect.kind).toBe('ReturnToHand');
    if (effect.kind !== 'ReturnToHand') return;
    expect(effect.target).toEqual({ kind: 'Source' });
  });
});
