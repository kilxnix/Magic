/**
 * Slice 6 — Granted dies-trigger body extension:
 * 'return it to the battlefield [tapped] under its owner's/your control'
 * + no-PT 'gains "When this creature dies, ..."' variant.
 *
 * Cards covered:
 *   - Demonic Gifts:        "... gets +2/+0 and gains \"When this creature dies, return it to the battlefield under its owner's control.\"" (already worked; now with explicit tapped=undefined)
 *   - Supernatural Stamina: "Until end of turn, ... gets +2/+0 and gains \"When this creature dies, return it to the battlefield tapped under its owner's control.\""
 *   - Not Dead After All:   "Until end of turn, ... you control gains \"When this creature dies, return it to the battlefield tapped under its owner's control.\""
 *   - Undying Evil:         "Until end of turn, ... gains \"When this creature dies, return it to the battlefield tapped under its owner's control.\""
 *
 * Tests:
 *  1. Parser: trailing-duration PT + tapped body → [ModifyPT, GrantDiesTrigger] with tapped:true
 *  2. Parser: leading-duration PT + tapped body → [ModifyPT, GrantDiesTrigger] with tapped:true
 *  3. Parser: no-PT leading-duration (Not Dead After All) → [GrantDiesTrigger] with tapped:true
 *  4. Parser: no-PT no-duration (Undying Evil style) → [GrantDiesTrigger] with tapped:true
 *  5. Parser: original non-tapped form still works → tapped field absent
 *  6. Parser: "under your control" variant parses as battlefield return
 *  7. Execution: tapped creature returns to battlefield in tapped state
 *  8. Execution: no-PT GrantDiesTrigger adds dies trigger; creature returns tapped
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { checkStateBasedActions } from '../state-based';
import { initGameState, getCardsInZone } from '../game-state';
import type { CardDefinition, TriggeredAbilityRef } from '../types';
import type { Effect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function creature(id: string, name: string, power = 2, toughness = 2): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature — Human',
    oracle_text: '',
    mana_cost: '{1}{B}',
    cmc: 2,
    colors: ['B'],
    color_identity: ['B'],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
  };
}

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('slice6-grant-dies-trigger-ext: parser', () => {
  it('1. trailing-duration PT + tapped body (Supernatural Stamina base wording)', () => {
    const text =
      'Target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner\'s control."';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.effects).toHaveLength(2);

    const pt = parsed.effects[0];
    expect(pt.kind).toBe('ModifyPT');
    if (pt.kind !== 'ModifyPT') return;
    expect(pt.power).toBe(2);
    expect(pt.toughness).toBe(0);
    expect(pt.untilEndOfTurn).toBe(true);

    const gdt = parsed.effects[1];
    expect(gdt.kind).toBe('GrantDiesTrigger');
    if (gdt.kind !== 'GrantDiesTrigger') return;
    expect(gdt.dieEffects).toHaveLength(1);

    const rfg = gdt.dieEffects[0] as Extract<Effect, { kind: 'ReturnFromGraveyard' }>;
    expect(rfg.kind).toBe('ReturnFromGraveyard');
    expect(rfg.destination).toBe('battlefield');
    expect(rfg.tapped).toBe(true);

    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
  });

  it('2. leading-duration PT + tapped body (Supernatural Stamina canonical wording)', () => {
    const text =
      'Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner\'s control."';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.effects).toHaveLength(2);
    expect(parsed.effects[0].kind).toBe('ModifyPT');
    expect(parsed.effects[1].kind).toBe('GrantDiesTrigger');

    const gdt = parsed.effects[1];
    if (gdt.kind !== 'GrantDiesTrigger') return;
    const rfg = gdt.dieEffects[0] as Extract<Effect, { kind: 'ReturnFromGraveyard' }>;
    expect(rfg.tapped).toBe(true);
    expect(rfg.destination).toBe('battlefield');

    const pt = parsed.effects[0];
    if (pt.kind !== 'ModifyPT') return;
    expect(pt.power).toBe(2);
    expect(pt.toughness).toBe(0);
  });

  it('3. no-PT leading-duration (Not Dead After All wording)', () => {
    const text =
      'Until end of turn, target creature you control gains "When this creature dies, return it to the battlefield tapped under its owner\'s control."';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // Only GrantDiesTrigger, no ModifyPT
    expect(parsed.effects).toHaveLength(1);
    expect(parsed.effects[0].kind).toBe('GrantDiesTrigger');

    const gdt = parsed.effects[0];
    if (gdt.kind !== 'GrantDiesTrigger') return;
    expect(gdt.dieEffects).toHaveLength(1);

    const rfg = gdt.dieEffects[0] as Extract<Effect, { kind: 'ReturnFromGraveyard' }>;
    expect(rfg.kind).toBe('ReturnFromGraveyard');
    expect(rfg.destination).toBe('battlefield');
    expect(rfg.tapped).toBe(true);

    // Target should have controllerControls constraint
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].constraints?.controllerControls).toBe(true);
  });

  it('4. no-PT no-duration (Undying Evil style)', () => {
    const text =
      'Target creature gains "When this creature dies, return it to the battlefield tapped under its owner\'s control."';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.effects).toHaveLength(1);
    expect(parsed.effects[0].kind).toBe('GrantDiesTrigger');

    const gdt = parsed.effects[0];
    if (gdt.kind !== 'GrantDiesTrigger') return;
    const rfg = gdt.dieEffects[0] as Extract<Effect, { kind: 'ReturnFromGraveyard' }>;
    expect(rfg.destination).toBe('battlefield');
    expect(rfg.tapped).toBe(true);

    expect(parsed.targets).toHaveLength(1);
  });

  it('5. original non-tapped form still works (Demonic Gifts wording)', () => {
    const text =
      'Target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield under its owner\'s control."';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.effects).toHaveLength(2);
    expect(parsed.effects[0].kind).toBe('ModifyPT');
    expect(parsed.effects[1].kind).toBe('GrantDiesTrigger');

    const gdt = parsed.effects[1];
    if (gdt.kind !== 'GrantDiesTrigger') return;
    const rfg = gdt.dieEffects[0] as Extract<Effect, { kind: 'ReturnFromGraveyard' }>;
    expect(rfg.destination).toBe('battlefield');
    // tapped should be absent (not set) for the non-tapped form
    expect(rfg.tapped).toBeFalsy();
  });

  it('6. "under your control" variant parses as battlefield return', () => {
    // Some cards use "your control" instead of "its owner's control"
    const text =
      'Target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under your control."';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.effects).toHaveLength(2);
    const gdt = parsed.effects[1];
    if (gdt.kind !== 'GrantDiesTrigger') return;
    const rfg = gdt.dieEffects[0] as Extract<Effect, { kind: 'ReturnFromGraveyard' }>;
    expect(rfg.kind).toBe('ReturnFromGraveyard');
    expect(rfg.destination).toBe('battlefield');
    expect(rfg.tapped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Execution tests
// ---------------------------------------------------------------------------

describe('slice6-grant-dies-trigger-ext: execution', () => {
  it('7. creature with tapped dies-trigger returns to battlefield tapped', () => {
    const creatureDef = creature('zombie', 'Zombie');
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [creatureDef], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const zombieCard = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(zombieCard.instanceId, {
      ...zombieCard,
      zone: 'battlefield',
      summoningSick: false,
    });

    // Register a Dies trigger that returns the creature tapped.
    const diesAbility: TriggeredAbilityRef = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'Dies', who: 'self' },
      effects: [{
        kind: 'ReturnFromGraveyard',
        target: { kind: 'Source' },
        destination: 'battlefield',
        tapped: true,
      }],
    };
    const abilities = new Map(state.battlefieldAbilities);
    abilities.set(zombieCard.instanceId, [diesAbility]);
    state = { ...state, battlefieldAbilities: abilities };

    // Apply lethal damage.
    state = {
      ...state,
      cards: new Map(state.cards).set(zombieCard.instanceId, {
        ...state.cards.get(zombieCard.instanceId)!,
        damage: 10,
      }),
    };

    const afterDeath = checkStateBasedActions(state);
    expect(afterDeath.cards.get(zombieCard.instanceId)!.zone).toBe('graveyard');

    // Find and execute the dies trigger.
    const firedTriggers = afterDeath.pendingTriggers.filter(
      t => t.sourceInstanceId === zombieCard.instanceId && t.ability.trigger.kind === 'Dies',
    );
    expect(firedTriggers).toHaveLength(1);

    const afterReturn = executeEffects(
      afterDeath,
      firedTriggers[0].ability.effects as Effect[],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: zombieCard.instanceId },
    );

    const returnedCard = afterReturn.cards.get(zombieCard.instanceId)!;
    expect(returnedCard.zone).toBe('battlefield');
    // Card should be tapped because tapped:true was set in the effect.
    expect(returnedCard.tapped).toBe(true);
  });

  it('8. no-PT GrantDiesTrigger executor adds dies trigger; creature returns tapped on death', () => {
    const creatureDef = creature('elf', 'Elf', 1, 1);
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [creatureDef], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const elfCard = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(elfCard.instanceId, {
      ...elfCard,
      zone: 'battlefield',
      summoningSick: false,
    });

    // Parse the Not Dead After All wording and execute the GrantDiesTrigger effect.
    const text =
      'Until end of turn, target creature you control gains "When this creature dies, return it to the battlefield tapped under its owner\'s control."';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const afterGrant = executeEffects(
      state,
      parsed.effects,
      'p1',
      [elfCard.instanceId],
      parsed.targets,
      0,
      { sourceInstanceId: elfCard.instanceId },
    );

    // battlefieldAbilities should have a Dies trigger for the elf.
    const abilities = afterGrant.battlefieldAbilities.get(elfCard.instanceId);
    expect(abilities).toBeDefined();
    const diesAbility = abilities!.find(a => a.trigger.kind === 'Dies');
    expect(diesAbility).toBeDefined();
    expect(diesAbility!.effects[0].kind).toBe('ReturnFromGraveyard');
    const rfgEffect = diesAbility!.effects[0] as Extract<Effect, { kind: 'ReturnFromGraveyard' }>;
    expect(rfgEffect.tapped).toBe(true);
    expect(rfgEffect.destination).toBe('battlefield');

    // Now kill the elf and verify it returns tapped.
    const damagedState = {
      ...afterGrant,
      cards: new Map(afterGrant.cards).set(elfCard.instanceId, {
        ...afterGrant.cards.get(elfCard.instanceId)!,
        damage: 10,
      }),
    };

    const afterDeath = checkStateBasedActions(damagedState);
    expect(afterDeath.cards.get(elfCard.instanceId)!.zone).toBe('graveyard');

    const firedTriggers = afterDeath.pendingTriggers.filter(
      t => t.sourceInstanceId === elfCard.instanceId && t.ability.trigger.kind === 'Dies',
    );
    expect(firedTriggers).toHaveLength(1);

    const afterReturn = executeEffects(
      afterDeath,
      firedTriggers[0].ability.effects as Effect[],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: elfCard.instanceId },
    );

    const returnedCard = afterReturn.cards.get(elfCard.instanceId)!;
    expect(returnedCard.zone).toBe('battlefield');
    expect(returnedCard.tapped).toBe(true);
  });
});
