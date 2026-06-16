/**
 * Slice 9/12 — Aura attached-permanent lifecycle effects.
 *
 * Tests three new matcher families:
 *   1. "When enchanted creature dies, return that card to the battlefield
 *      under your control" (False Demise / Shade's Form / Minion's Return /
 *      Soul Channeling).
 *   2. "{cost}: Regenerate enchanted creature." (Regeneration / Spirit Link
 *      regen-variant Auras).
 *   3. "~ deals N damage to that creature's controller" trigger body
 *      (Insolence family).
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function baseDef(over: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id: 'base', name: 'Base', type_line: 'Creature', oracle_text: '',
    mana_cost: '{1}', cmc: 1, colors: [], color_identity: [], keywords: [],
    card_types: ['creature'], power: 2, toughness: 2, ...over,
  };
}

function makeCard(id: string, owner: string, zone: CardInstance['zone'] = 'battlefield', over: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId: id, definitionId: 'base', ownerId: owner, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    ...over,
  };
}

/** Minimal two-player game state. Cards are passed as an array of instances. */
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
// Family 1: "when enchanted creature dies, return that card to the battlefield
//            under your control" (False Demise / Shade's Form / Minion's Return)
// ---------------------------------------------------------------------------

describe('Family 1: enchanted-creature dies → return to battlefield (False Demise)', () => {

  it('parses False Demise oracle text as a Dies trigger with AttachedCreatureDies', () => {
    const text = "Enchant creature\nWhen enchanted creature dies, return that card to the battlefield under your control.";
    const result = parseOracleText(text);
    expect(result.kind).toBe('Dies');
    if (result.kind !== 'Dies') return;
    expect(result.ability.trigger).toEqual({ kind: 'AttachedCreatureDies' });
  });

  it('parses the trigger body as ReturnFromGraveyard to battlefield targeting EventCreature', () => {
    const text = "Enchant creature\nWhen enchanted creature dies, return that card to the battlefield under your control.";
    const result = parseOracleText(text);
    if (result.kind !== 'Dies') throw new Error('expected Dies');
    const [effect] = result.ability.effects;
    expect(effect.kind).toBe('ReturnFromGraveyard');
    if (effect.kind !== 'ReturnFromGraveyard') return;
    expect(effect.destination).toBe('battlefield');
    expect(effect.target).toEqual({ kind: 'EventCreature' });
  });

  it('parses Shade\'s Form oracle text (no "under your control" rider) the same way', () => {
    // Shade's Form: "When enchanted creature dies, return that card to the battlefield."
    const text = "Enchant creature\nWhen enchanted creature dies, return that card to the battlefield.";
    const result = parseOracleText(text);
    expect(result.kind).toBe('Dies');
    if (result.kind !== 'Dies') return;
    const [effect] = result.ability.effects;
    expect(effect.kind).toBe('ReturnFromGraveyard');
    if (effect.kind !== 'ReturnFromGraveyard') return;
    expect(effect.destination).toBe('battlefield');
    expect(effect.target).toEqual({ kind: 'EventCreature' });
  });

  it('parses Minion\'s Return oracle text (with static buff + dies trigger)', () => {
    // Minion's Return: "Enchanted creature gets +1/+1. When enchanted creature dies,
    //                   return that card to the battlefield under your control."
    const text = "Enchant creature\nEnchanted creature gets +1/+1. When enchanted creature dies, return that card to the battlefield under your control.";
    const result = parseOracleText(text);
    // With both static buff and dies trigger, parser picks the dies trigger.
    expect(result.kind).toBe('Dies');
    if (result.kind !== 'Dies') return;
    expect(result.ability.trigger).toEqual({ kind: 'AttachedCreatureDies' });
    const [effect] = result.ability.effects;
    expect(effect.kind).toBe('ReturnFromGraveyard');
  });

  it('executes ReturnFromGraveyard with EventCreature from graveyard to battlefield', () => {
    // Simulate the trigger body firing: the dying creature (evtCard) is now in
    // graveyard, and the effect should move it back to battlefield.
    const evtCard = makeCard('evt', 'p0', 'graveyard');
    const state = makeState([evtCard]);

    const effects = [{ kind: 'ReturnFromGraveyard' as const, target: { kind: 'EventCreature' as const }, destination: 'battlefield' as const }];
    const after = executeEffects(state, effects, 'p0', [], [], 0, {
      sourceInstanceId: undefined,
      eventContext: { cardInstanceId: 'evt' },
    });

    expect(after.cards.get('evt')!.zone).toBe('battlefield');
  });

  it('safely no-ops ReturnFromGraveyard when event context is absent', () => {
    const evtCard = makeCard('evt', 'p0', 'graveyard');
    const state = makeState([evtCard]);

    const effects = [{ kind: 'ReturnFromGraveyard' as const, target: { kind: 'EventCreature' as const }, destination: 'battlefield' as const }];
    const after = executeEffects(state, effects, 'p0', [], [], 0, {});

    // No event context → EventCreature resolves to '' → no change, no crash.
    expect(after.cards.get('evt')!.zone).toBe('graveyard');
  });
});

// ---------------------------------------------------------------------------
// Family 2: "{cost}: Regenerate enchanted creature."
// ---------------------------------------------------------------------------

describe('Family 2: Regenerate enchanted creature (Regeneration Aura)', () => {

  it('parses "{B}: Regenerate enchanted creature." as an activated ability', () => {
    const text = "{B}: Regenerate enchanted creature.";
    const result = parseOracleText(text);
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    const ability = result.abilities[0];
    expect(ability).toBeTruthy();
    expect(ability.effects[0]).toMatchObject({ kind: 'Regenerate', target: { kind: 'SourceAttachedTo' } });
  });

  it('parses the multiline Aura form (Enchant creature + activated ability)', () => {
    const text = "Enchant creature\n{G}: Regenerate enchanted creature.";
    const result = parseOracleText(text);
    // "Enchant creature" is a keyword preamble — parseActivatedAbilities still finds the ability.
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    const eff = result.abilities[0].effects[0];
    expect(eff.kind).toBe('Regenerate');
    if (eff.kind !== 'Regenerate') return;
    expect(eff.target).toEqual({ kind: 'SourceAttachedTo' });
  });

  it('parses "{1}{B}: Regenerate enchanted permanent." also', () => {
    const text = "{1}{B}: Regenerate enchanted permanent.";
    const result = parseOracleText(text);
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    const eff = result.abilities[0].effects[0];
    expect(eff.kind).toBe('Regenerate');
    if (eff.kind !== 'Regenerate') return;
    expect(eff.target).toEqual({ kind: 'SourceAttachedTo' });
  });

  it('executes Regenerate with SourceAttachedTo to grant a regen shield on the attached creature', () => {
    // aura attached to 'creature'
    const aura = makeCard('aura', 'p0', 'battlefield', { attachedTo: 'creature' });
    const creature = makeCard('creature', 'p0', 'battlefield');
    const state = makeState([aura, creature]);

    const effects = [{ kind: 'Regenerate' as const, target: { kind: 'SourceAttachedTo' as const } }];
    const after = executeEffects(state, effects, 'p0', [], [], 0, {
      sourceInstanceId: 'aura',
    });

    expect(after.cards.get('creature')!.regenerationShields).toBe(1);
    // Aura itself is untouched.
    expect(after.cards.get('aura')!.regenerationShields).toBeUndefined();
  });

  it('safely no-ops Regenerate SourceAttachedTo when aura is not attached to anything', () => {
    const aura = makeCard('aura', 'p0', 'battlefield');
    const state = makeState([aura]);

    const effects = [{ kind: 'Regenerate' as const, target: { kind: 'SourceAttachedTo' as const } }];
    // Should not throw.
    expect(() => executeEffects(state, effects, 'p0', [], [], 0, { sourceInstanceId: 'aura' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Family 3: "~ deals N damage to that creature's controller" (Insolence)
// ---------------------------------------------------------------------------

describe('Family 3: Insolence — deals damage to that creature\'s controller', () => {

  it('parses Insolence oracle text as a Triggered ability with DealsDamage trigger', () => {
    const text = "Enchant creature\nWhenever enchanted creature deals damage, ~ deals 1 damage to that creature's controller.";
    const result = parseOracleText(text);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toMatchObject({ kind: 'DealsDamage', who: 'enchantedCreature' });
  });

  it('parses the trigger body as DealDamage to EventPlayer with amount 1', () => {
    const text = "Enchant creature\nWhenever enchanted creature deals damage, ~ deals 1 damage to that creature's controller.";
    const result = parseOracleText(text);
    if (result.kind !== 'Triggered') throw new Error('expected Triggered');
    const [effect] = result.ability.effects;
    expect(effect.kind).toBe('DealDamage');
    if (effect.kind !== 'DealDamage') return;
    expect(effect.amount).toBe(1);
    expect(effect.target).toEqual({ kind: 'EventPlayer' });
    // No chosen targets — EventPlayer is resolved from event context.
    expect(result.targets).toHaveLength(0);
  });

  it('parses "this aura deals 2 damage to that creature\'s controller" with amount 2', () => {
    const text = "This aura deals 2 damage to that creature's controller.";
    const result = parseOracleText(text);
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const [effect] = result.effects;
    expect(effect.kind).toBe('DealDamage');
    if (effect.kind !== 'DealDamage') return;
    expect(effect.amount).toBe(2);
    expect(effect.target).toEqual({ kind: 'EventPlayer' });
  });

  it('parses "~ deals 1 damage to its controller" (its controller variant)', () => {
    const text = "~ deals 1 damage to its controller.";
    const result = parseOracleText(text);
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const [effect] = result.effects;
    expect(effect.kind).toBe('DealDamage');
    if (effect.kind !== 'DealDamage') return;
    expect(effect.amount).toBe(1);
    expect(effect.target).toEqual({ kind: 'EventPlayer' });
  });

  it('executes DealDamage to EventPlayer (creature controller) from event context', () => {
    // p1 controls the enchanted creature; the trigger fires and deals 1 damage to p1.
    const creature = makeCard('creature', 'p1', 'battlefield');
    const state = makeState([creature]);

    const effects = [{ kind: 'DealDamage' as const, target: { kind: 'EventPlayer' as const }, amount: 1 }];
    const after = executeEffects(state, effects, 'p0', [], [], 0, {
      eventContext: { eventPlayerId: 'p1' },
    });

    const p1After = after.players.find(p => p.id === 'p1')!;
    expect(p1After.life).toBe(39); // 40 - 1
  });

  it('safely no-ops DealDamage to EventPlayer when event context has no eventPlayerId', () => {
    const state = makeState([]);
    const effects = [{ kind: 'DealDamage' as const, target: { kind: 'EventPlayer' as const }, amount: 1 }];
    // EventPlayer resolves to '' when no eventPlayerId → no crash, no damage.
    expect(() => executeEffects(state, effects, 'p0', [], [], 0, {})).not.toThrow();
  });
});
