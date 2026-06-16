/**
 * slice5-event-damage-triggers.test.ts
 *
 * Slice 5/12 — Event-amount damage triggers: "Whenever X deals damage, you gain
 * that much life" (pre-errata lifelink family) and "this Aura deals that much
 * damage to that creature's controller" (Guilty Conscience reflection wording).
 *
 * Cards covered:
 *   - Mourning Thrull  (self deals damage → you gain that much life)
 *   - Doubtless One    (self deals damage → you gain that much life)
 *   - Armadillo Cloak  (enchanted creature deals damage → controller gains that much life)
 *   - Vampiric Link    (enchanted creature deals damage → controller gains that much life)
 *   - Guilty Conscience (enchanted creature deals damage → this aura deals that much damage
 *                        to that creature's controller)
 *
 * Test plan:
 *   1. Parse oracle text for self-deals-damage trigger (Mourning Thrull wording) — DealsDamage/self
 *   2. Parse oracle text for enchanted-creature-deals-damage trigger (Armadillo Cloak wording)
 *   3. Parse the Guilty Conscience reflection effect body
 *   4. Execute: source creature deals damage to a player → DealsDamage trigger enqueued → resolves GainLife
 *   5. Execute: Aura enchanted-creature pattern → DealsDamage trigger fires for attachedTo match
 *   6. Execute: EventDamageAmount in DealDamage effect (Guilty Conscience body)
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import type { GainLifeEffect, DealDamageEffect, TriggeredAbility } from '../effects/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCreatureDef(id: string, power: number, toughness: number, oracle: string = ''): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Beast',
    oracle_text: oracle,
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
  };
}

function makeAuraDef(id: string, oracle: string): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Enchantment — Aura',
    oracle_text: oracle,
    mana_cost: '{1}{W}',
    cmc: 2,
    colors: ['W'],
    color_identity: ['W'],
    keywords: [],
    card_types: ['enchantment'],
  };
}

function baseState(defs: CardDefinition[]): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map<string, CardInstance>(),
    cardDefinitions: new Map(defs.map(d => [d.id, d])),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

function addCard(
  s: GameState,
  instanceId: string,
  definitionId: string,
  zone: CardInstance['zone'] = 'battlefield',
  ownerId = 'p0',
  attachedTo?: string,
): void {
  s.cards.set(instanceId, {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    attachedTo,
  });
}

// ---------------------------------------------------------------------------
// Parse tests
// ---------------------------------------------------------------------------

describe('Slice 5 — parse: self deals-damage trigger (Mourning Thrull style)', () => {
  it('parses "Whenever ~ deals damage, you gain that much life." as DealsDamage/self + GainLife(EventDamageAmount)', () => {
    const result = parseOracleText('Whenever ~ deals damage, you gain that much life.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('DealsDamage');
    if (ability.trigger.kind !== 'DealsDamage') return;
    expect(ability.trigger.who).toBe('self');

    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as GainLifeEffect;
    expect(eff.kind).toBe('GainLife');
    expect(eff.player.kind).toBe('Controller');
    expect(typeof eff.amount).toBe('object');
    if (typeof eff.amount === 'object') {
      expect((eff.amount as { kind: string }).kind).toBe('EventDamageAmount');
    }
  });

  it('parses "Whenever this creature deals damage, you gain that much life." (modern wording)', () => {
    const result = parseOracleText('Whenever this creature deals damage, you gain that much life.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('DealsDamage');
    if (ability.trigger.kind !== 'DealsDamage') return;
    expect(ability.trigger.who).toBe('self');

    const eff = ability.effects[0] as GainLifeEffect;
    expect(eff.kind).toBe('GainLife');
    expect((eff.amount as { kind: string }).kind).toBe('EventDamageAmount');
  });
});

describe('Slice 5 — parse: enchanted creature deals-damage trigger (Armadillo Cloak / Vampiric Link style)', () => {
  it('parses "Whenever enchanted creature deals damage, you gain that much life." as DealsDamage/enchantedCreature', () => {
    const result = parseOracleText('Whenever enchanted creature deals damage, you gain that much life.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('DealsDamage');
    if (ability.trigger.kind !== 'DealsDamage') return;
    expect(ability.trigger.who).toBe('enchantedCreature');

    const eff = ability.effects[0] as GainLifeEffect;
    expect(eff.kind).toBe('GainLife');
    expect((eff.amount as { kind: string }).kind).toBe('EventDamageAmount');
  });
});

describe('Slice 5 — parse: Guilty Conscience reflection wording', () => {
  it('parses "Whenever enchanted creature deals damage, ~ deals that much damage to that creature\'s controller." as DealsDamage body with EventDamageAmount DealDamage targeting EventPlayer', () => {
    const result = parseOracleText(
      "Whenever enchanted creature deals damage, ~ deals that much damage to that creature's controller.",
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('DealsDamage');
    if (ability.trigger.kind !== 'DealsDamage') return;
    expect(ability.trigger.who).toBe('enchantedCreature');

    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as DealDamageEffect;
    expect(eff.kind).toBe('DealDamage');
    expect((eff.amount as { kind: string }).kind).toBe('EventDamageAmount');
    // "that creature's controller" maps to EventPlayer
    expect(eff.target.kind).toBe('EventPlayer');
  });
});

// ---------------------------------------------------------------------------
// Execution tests
// ---------------------------------------------------------------------------

describe('Slice 5 — execute: DealsDamage trigger enqueues when creature damages player', () => {
  it('source creature dealing damage to a player enqueues DealsDamage triggers on itself', () => {
    const creatureDef = makeCreatureDef('thrull', 2, 2);

    const state = baseState([creatureDef]);
    addCard(state, 'thrull_1', 'thrull');

    // Register the parsed ability on the battlefield.
    const parsed = parseOracleText('Whenever ~ deals damage, you gain that much life.');
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const abilityRef = {
      kind: 'TriggeredAbility' as const,
      trigger: (parsed.ability as TriggeredAbility).trigger,
      effects: (parsed.ability as TriggeredAbility).effects,
    };
    state.battlefieldAbilities.set('thrull_1', [abilityRef]);

    // Execute a DealDamage effect to player p1, with sourceInstanceId = thrull_1.
    const dealEffects = [
      {
        kind: 'DealDamage' as const,
        target: { kind: 'Player' as const, playerId: 'p1' },
        amount: 3,
      },
    ];

    const nextState = executeEffects(
      state, dealEffects, 'p0', [], [], 0,
      { sourceInstanceId: 'thrull_1' },
    );

    // Player p1 should have taken 3 damage (life went from 40 to 37).
    const p1 = nextState.players.find(p => p.id === 'p1')!;
    expect(p1.life).toBe(37);

    // A DealsDamage trigger should have been enqueued.
    expect(nextState.pendingTriggers).toHaveLength(1);
    const trigger = nextState.pendingTriggers[0];
    expect(trigger.ability.trigger.kind).toBe('DealsDamage');
    // eventDamageAmount should carry the 3 damage.
    expect(trigger.eventContext?.eventDamageAmount).toBe(3);
  });

  it('resolving GainLife(EventDamageAmount) via eventContext grants life equal to damage dealt', () => {
    const creatureDef = makeCreatureDef('thrull', 2, 2);
    const state = baseState([creatureDef]);
    addCard(state, 'thrull_1', 'thrull');

    const parsed = parseOracleText('Whenever ~ deals damage, you gain that much life.');
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');
    const abilityRef = {
      kind: 'TriggeredAbility' as const,
      trigger: (parsed.ability as TriggeredAbility).trigger,
      effects: (parsed.ability as TriggeredAbility).effects,
    };
    state.battlefieldAbilities.set('thrull_1', [abilityRef]);

    // Deal 5 damage to enqueue the trigger.
    const dealEffects = [
      {
        kind: 'DealDamage' as const,
        target: { kind: 'Player' as const, playerId: 'p1' },
        amount: 5,
      },
    ];
    const afterDmg = executeEffects(state, dealEffects, 'p0', [], [], 0, { sourceInstanceId: 'thrull_1' });

    expect(afterDmg.pendingTriggers).toHaveLength(1);
    const pending = afterDmg.pendingTriggers[0];
    expect(pending.eventContext?.eventDamageAmount).toBe(5);

    // Resolve the GainLife(EventDamageAmount) effect from the trigger,
    // passing eventDamageAmount=5 via eventContext.
    const gainEffects = pending.ability.effects as GainLifeEffect[];
    const afterGain = executeEffects(
      afterDmg, gainEffects, 'p0', [], [], 0,
      { eventContext: { eventDamageAmount: 5 } },
    );

    // p0 should gain 5 life (from 40 to 45).
    const p0 = afterGain.players.find(p => p.id === 'p0')!;
    expect(p0.life).toBe(45);
  });
});

describe('Slice 5 — execute: Aura enchanted-creature DealsDamage trigger', () => {
  it('Aura fires DealsDamage trigger when the attached creature deals damage', () => {
    const auraDef = makeAuraDef('vampiric_link', 'Whenever enchanted creature deals damage, you gain that much life.');
    const creatureDef = makeCreatureDef('bear', 2, 2);

    const state = baseState([auraDef, creatureDef]);
    addCard(state, 'bear_1', 'bear');
    // Attach the Aura to the bear.
    addCard(state, 'aura_1', 'vampiric_link', 'battlefield', 'p0', 'bear_1');

    // Register the Aura's ability on the battlefield.
    const parsed = parseOracleText('Whenever enchanted creature deals damage, you gain that much life.');
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');
    const abilityRef = {
      kind: 'TriggeredAbility' as const,
      trigger: (parsed.ability as TriggeredAbility).trigger,
      effects: (parsed.ability as TriggeredAbility).effects,
    };
    state.battlefieldAbilities.set('aura_1', [abilityRef]);

    // Bear deals 4 damage to player p1. sourceInstanceId = 'bear_1'.
    // The Aura should fire because aura_1.attachedTo === 'bear_1'.
    const dealEffects = [
      {
        kind: 'DealDamage' as const,
        target: { kind: 'Player' as const, playerId: 'p1' },
        amount: 4,
      },
    ];
    const afterDmg = executeEffects(state, dealEffects, 'p0', [], [], 0, { sourceInstanceId: 'bear_1' });

    // p1 took 4 damage (40 → 36).
    expect(afterDmg.players.find(p => p.id === 'p1')!.life).toBe(36);

    // DealsDamage trigger from aura_1 should be enqueued.
    expect(afterDmg.pendingTriggers).toHaveLength(1);
    const trigger = afterDmg.pendingTriggers[0];
    expect(trigger.sourceInstanceId).toBe('aura_1');
    expect(trigger.eventContext?.eventDamageAmount).toBe(4);

    // Resolve the GainLife(EventDamageAmount) effect: p0 gains 4 life (40 → 44).
    const gainEffects = trigger.ability.effects as GainLifeEffect[];
    const afterGain = executeEffects(
      afterDmg, gainEffects, 'p0', [], [], 0,
      { eventContext: { eventDamageAmount: 4 } },
    );
    expect(afterGain.players.find(p => p.id === 'p0')!.life).toBe(44);
  });
});

describe('Slice 5 — execute: EventDamageAmount in DealDamage effect (Guilty Conscience)', () => {
  it('EventDamageAmount resolves to the stored damage amount in a DealDamage effect body', () => {
    // The Guilty Conscience effect body: deal EventDamageAmount to EventPlayer.
    // Simulate firing the trigger with eventDamageAmount=7 and a resolved player.
    const state = baseState([]);

    const guiltConscEffects = [
      {
        kind: 'DealDamage' as const,
        target: { kind: 'EventPlayer' as const },
        amount: { kind: 'EventDamageAmount' as const },
      },
    ];

    const afterEffect = executeEffects(
      state, guiltConscEffects, 'p0', [], [], 0,
      {
        eventContext: {
          eventDamageAmount: 7,
          eventPlayerId: 'p1', // "that creature's controller"
        },
      },
    );

    // p1 should take 7 damage (40 → 33).
    const p1 = afterEffect.players.find(p => p.id === 'p1')!;
    expect(p1.life).toBe(33);
  });
});
