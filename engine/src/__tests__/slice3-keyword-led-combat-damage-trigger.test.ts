/**
 * slice3-keyword-led-combat-damage-trigger.test.ts
 *
 * Slice 3/11 coverage — keyword-led creatures with "Whenever ~ deals combat
 * damage to a player, <supported-effect>" triggers.
 *
 * Two sub-problems addressed by this slice:
 *
 *   (A) Named-card subject in the trigger prefix:
 *       "Whenever Balefire Dragon deals combat damage to a player, ..."
 *       matchSelfCombatDamageToPlayerPrefix now scans forward through card-name
 *       tokens (like matchAttacksPrefix does) to reach the "deals" keyword.
 *
 *   (B) New trigger body: "it deals that much damage to each creature that player
 *       controls" (Balefire Dragon family):
 *       matchDealsThatMuchDamageToEachCreatureThatPlayerControls emits
 *       DealDamage{ AllOfType{creature, eventPlayerControls:true}, EventDamageAmount }.
 *       The executor AllOfType/DealDamage branch resolves the event player's
 *       creatures from eventContext.eventPlayerId.
 *
 * Parse tests cover:
 *   — Keyword-preceded trigger (single-line form): "Flying Whenever ~ deals ..."
 *   — Named-card trigger: "Balefire Dragon" as trigger subject
 *   — Balefire body: "it deals that much damage to each creature that player controls"
 *   — Simple supported bodies on keyword-led cards: draw, mill, counter, lose life
 *
 * Execution tests verify AllOfType{eventPlayerControls} resolves correctly.
 *
 * Declined (honesty bar):
 *   — Dazzling Sphinx: "that player exiles ... until they exile an instant or
 *     sorcery card. You may cast that card..." — no free-cast-from-reveal subsystem.
 *   — Hollow Specter: "you may pay {X} ...discard X cards" — optional-pay complex body.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import type { DealDamageEffect, TriggeredAbility, AddCountersEffect, DrawEffect, MillEffect, LoseLifeEffect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCreatureDef(id: string, oracle = '', power = 3, toughness = 3): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Test',
    oracle_text: oracle,
    mana_cost: '{2}{R}',
    cmc: 3,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
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
  });
}

// ---------------------------------------------------------------------------
// PARSE TESTS — keyword-led single-line faces
// ---------------------------------------------------------------------------

describe('slice3 — parse: keyword-led trigger prefix (trimLeadingKeywordOrEnchantPreamble)', () => {
  it('parses "Flying Whenever ~ deals combat damage to a player, you draw a card." (single-line)', () => {
    const result = parseOracleText(
      'Flying Whenever ~ deals combat damage to a player, you draw a card.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(ability.effects[0].kind).toBe('Draw');
  });

  it('parses "Menace Whenever ~ deals combat damage to a player, put a +1/+1 counter on ~." (single-line)', () => {
    const result = parseOracleText(
      'Menace Whenever ~ deals combat damage to a player, put a +1/+1 counter on ~.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(ability.effects[0].kind).toBe('AddCounters');
  });

  it('parses "Trample Whenever ~ deals combat damage to a player, that player mills two cards." (single-line)', () => {
    const result = parseOracleText(
      'Trample Whenever ~ deals combat damage to a player, that player mills two cards.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(ability.effects[0].kind).toBe('Mill');
    const eff = ability.effects[0] as MillEffect;
    expect(eff.player.kind).toBe('EventPlayer');
  });

  it('parses multi-line keyword+trigger ("Flying\\nWhenever ~ deals...")', () => {
    const result = parseOracleText(
      'Flying\nWhenever ~ deals combat damage to a player, that player loses 1 life.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(ability.effects[0].kind).toBe('LoseLife');
  });

  it('multi-line "Flying\\nWhenever ~ deals..." is parsed (trimLeadingKeywordOrEnchantPreamble path)', () => {
    // The newline is treated as whitespace by the tokenizer, so "Flying" becomes
    // a leading preamble token that trimLeadingKeywordOrEnchantPreamble strips,
    // allowing the trigger to parse. absorbedKeywords may or may not be set
    // depending on which absorption path wins; what matters is the parse succeeds.
    const result = parseOracleText(
      'Flying\nWhenever ~ deals combat damage to a player, you draw a card.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(ability.effects[0].kind).toBe('Draw');
  });
});

// ---------------------------------------------------------------------------
// PARSE TESTS — named-card trigger prefix (Balefire Dragon family)
// ---------------------------------------------------------------------------

describe('slice3 — parse: named-card self-combat-damage trigger prefix', () => {
  it('parses "Whenever Balefire Dragon deals combat damage to a player, ..." (named subject)', () => {
    const result = parseOracleText(
      'Whenever Balefire Dragon deals combat damage to a player, it deals that much damage to each creature that player controls.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');
    // 'who' should be 'self' since this is the named-card (self-reference) form
    const trigger = ability.trigger as { kind: string; who: string };
    expect(trigger.who).toBe('self');
  });

  it('parses multi-line "Flying\\nWhenever Balefire Dragon deals combat damage..." (real oracle form)', () => {
    const result = parseOracleText(
      'Flying\nWhenever Balefire Dragon deals combat damage to a player, it deals that much damage to each creature that player controls.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');
  });

  it('parses two-word named-card subject "Whenever Hollow Specter deals..."', () => {
    // Simple body (draw) to test subject parsing; full Hollow Specter body is declined
    const result = parseOracleText(
      'Whenever Hollow Specter deals combat damage to a player, you draw a card.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');
  });
});

// ---------------------------------------------------------------------------
// PARSE TESTS — Balefire Dragon body
// ---------------------------------------------------------------------------

describe('slice3 — parse: matchDealsThatMuchDamageToEachCreatureThatPlayerControls', () => {
  it('parses "it deals that much damage to each creature that player controls." correctly', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, it deals that much damage to each creature that player controls.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const ability = result.ability as TriggeredAbility;
    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as DealDamageEffect;
    expect(eff.kind).toBe('DealDamage');
    expect(eff.target.kind).toBe('AllOfType');
    if (eff.target.kind !== 'AllOfType') return;
    expect(eff.target.filter.types).toContain('creature');
    expect(eff.target.eventPlayerControls).toBe(true);
    expect(typeof eff.amount).toBe('object');
    expect((eff.amount as { kind: string }).kind).toBe('EventDamageAmount');
  });

  it('source "~" produces ThisPermanent', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, it deals that much damage to each creature that player controls.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const eff = (result.ability as TriggeredAbility).effects[0] as DealDamageEffect;
    expect(eff.source?.kind).toBe('ThisPermanent');
  });

  it('full Balefire Dragon oracle text (multi-line) parses correctly', () => {
    const result = parseOracleText(
      'Flying\nWhenever Balefire Dragon deals combat damage to a player, it deals that much damage to each creature that player controls.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');
    const eff = ability.effects[0] as DealDamageEffect;
    expect(eff.kind).toBe('DealDamage');
    expect(eff.target.kind).toBe('AllOfType');
    if (eff.target.kind !== 'AllOfType') return;
    expect(eff.target.eventPlayerControls).toBe(true);
    expect((eff.amount as { kind: string }).kind).toBe('EventDamageAmount');
  });

  it('variant: "this creature deals that much damage to each creature that player controls."', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, this creature deals that much damage to each creature that player controls.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const eff = (result.ability as TriggeredAbility).effects[0] as DealDamageEffect;
    expect(eff.kind).toBe('DealDamage');
    expect(eff.target.kind).toBe('AllOfType');
  });
});

// ---------------------------------------------------------------------------
// HONESTY — Dazzling Sphinx body is declined (no free-cast-from-reveal engine)
// ---------------------------------------------------------------------------

describe('slice3 — honesty: unsupported bodies decline cleanly', () => {
  it('Dazzling Sphinx body stays Unparsed (exile-until + free-cast not supported)', () => {
    const result = parseOracleText(
      "Flying Whenever this creature deals combat damage to a player, that player exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then that player puts the exiled cards that weren't cast this way on the bottom of their library in a random order.",
    );
    expect(result.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS — AllOfType{eventPlayerControls} + EventDamageAmount
// ---------------------------------------------------------------------------

describe('slice3 — execute: DealDamage(AllOfType{eventPlayerControls}, EventDamageAmount)', () => {
  it('Balefire Dragon: 6 combat damage deals 6 to each creature the attacked player controls', () => {
    const dragonDef = makeCreatureDef('balefire', '', 6, 6);
    const p2Creature1Def = makeCreatureDef('p2crea1', '', 2, 3);
    const p2Creature2Def = makeCreatureDef('p2crea2', '', 3, 4);

    const state = baseState([dragonDef, p2Creature1Def, p2Creature2Def]);
    addCard(state, 'balefire_1', 'balefire', 'battlefield', 'p0');
    addCard(state, 'p2crea1_1', 'p2crea1', 'battlefield', 'p1');
    addCard(state, 'p2crea2_1', 'p2crea2', 'battlefield', 'p1');

    const parsed = parseOracleText(
      'Whenever ~ deals combat damage to a player, it deals that much damage to each creature that player controls.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered parse');
    const ability = parsed.ability as TriggeredAbility;

    const beforeDamage1 = state.cards.get('p2crea1_1')!.damage;
    const beforeDamage2 = state.cards.get('p2crea2_1')!.damage;
    expect(beforeDamage1).toBe(0);
    expect(beforeDamage2).toBe(0);

    // Balefire Dragon dealt 6 combat damage to p1 (eventPlayerId='p1', eventDamageAmount=6)
    const after = executeEffects(
      state,
      ability.effects,
      'p0',          // casterId (Balefire's controller)
      [],
      [],
      0,
      { sourceInstanceId: 'balefire_1', eventContext: { eventPlayerId: 'p1', eventDamageAmount: 6 } },
    );

    // Both of p1's creatures should have taken 6 damage
    expect(after.cards.get('p2crea1_1')!.damage).toBe(6);
    expect(after.cards.get('p2crea2_1')!.damage).toBe(6);
  });

  it('only damages event-player creatures, not the attacking player\'s creatures', () => {
    const dragonDef = makeCreatureDef('balefire', '', 6, 6);
    const p0CreatureDef = makeCreatureDef('p0crea', '', 3, 3);
    const p1CreatureDef = makeCreatureDef('p1crea', '', 2, 2);

    const state = baseState([dragonDef, p0CreatureDef, p1CreatureDef]);
    addCard(state, 'balefire_1', 'balefire', 'battlefield', 'p0');
    addCard(state, 'p0crea_1', 'p0crea', 'battlefield', 'p0');   // controller's creature
    addCard(state, 'p1crea_1', 'p1crea', 'battlefield', 'p1');   // opponent's creature

    const parsed = parseOracleText(
      'Whenever ~ deals combat damage to a player, it deals that much damage to each creature that player controls.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered parse');
    const ability = parsed.ability as TriggeredAbility;

    const after = executeEffects(
      state,
      ability.effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'balefire_1', eventContext: { eventPlayerId: 'p1', eventDamageAmount: 4 } },
    );

    // p1's creature takes 4 damage
    expect(after.cards.get('p1crea_1')!.damage).toBe(4);
    // p0's creature (Balefire's controller) is NOT damaged
    expect(after.cards.get('p0crea_1')!.damage).toBe(0);
    // Balefire Dragon itself is not damaged (it's p0's creature)
    expect(after.cards.get('balefire_1')!.damage).toBe(0);
  });

  it('deals 0 damage when eventDamageAmount is 0 (no creatures hurt)', () => {
    const dragonDef = makeCreatureDef('balefire', '', 6, 6);
    const p1CreatureDef = makeCreatureDef('p1crea', '', 2, 2);

    const state = baseState([dragonDef, p1CreatureDef]);
    addCard(state, 'balefire_1', 'balefire', 'battlefield', 'p0');
    addCard(state, 'p1crea_1', 'p1crea', 'battlefield', 'p1');

    const parsed = parseOracleText(
      'Whenever ~ deals combat damage to a player, it deals that much damage to each creature that player controls.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered parse');
    const ability = parsed.ability as TriggeredAbility;

    const after = executeEffects(
      state,
      ability.effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'balefire_1', eventContext: { eventPlayerId: 'p1', eventDamageAmount: 0 } },
    );

    expect(after.cards.get('p1crea_1')!.damage).toBe(0);
  });
});
