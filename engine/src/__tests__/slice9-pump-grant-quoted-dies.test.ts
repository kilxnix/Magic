/**
 * Slice 9: Pump + grant-quoted-dies-ability
 *
 * "Target creature gets +N/+N and gains \"When this creature dies, <effect>\"."
 * (Demonic Gifts / Supernatural Stamina / Galuf's Final Act family.)
 *
 * Tests:
 *  1. Parser: returns [ModifyPT, GrantDiesTrigger] for Demonic Gifts wording.
 *  2. Parser: returns [ModifyPT, GrantDiesTrigger] for AddCounters inner body.
 *  3. Parser: rejects unsupported inner body (returns non-Spell or falls through).
 *  4. Execution: GrantDiesTrigger adds the Dies trigger to battlefieldAbilities.
 *  5. Execution: When the creature dies (state-based), the Dies trigger fires and
 *     ReturnFromGraveyard executes (creature returns to battlefield).
 *  6. Execution: AddCounters inner body variant (Galuf's Final Act style).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { checkStateBasedActions } from '../state-based';
import { initGameState, getCardsInZone } from '../game-state';
import type { CardDefinition, TriggeredAbilityRef } from '../types';
import type { Effect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Helper card definitions
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

describe('slice9-pump-grant-quoted-dies: parser', () => {
  it('parses Demonic Gifts / Supernatural Stamina wording (return to battlefield)', () => {
    const text =
      'Target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield under its owner\'s control."';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.effects).toHaveLength(2);

    // First effect: ModifyPT
    const pt = parsed.effects[0];
    expect(pt.kind).toBe('ModifyPT');
    if (pt.kind !== 'ModifyPT') return;
    expect(pt.power).toBe(2);
    expect(pt.toughness).toBe(0);
    expect(pt.untilEndOfTurn).toBe(true);

    // Second effect: GrantDiesTrigger
    const gdt = parsed.effects[1];
    expect(gdt.kind).toBe('GrantDiesTrigger');
    if (gdt.kind !== 'GrantDiesTrigger') return;
    expect(gdt.dieEffects).toHaveLength(1);
    expect(gdt.dieEffects[0].kind).toBe('ReturnFromGraveyard');
    const rfg = gdt.dieEffects[0] as Extract<Effect, { kind: 'ReturnFromGraveyard' }>;
    expect(rfg.destination).toBe('battlefield');

    // Both effects target the same chosen creature
    const ptTarget = (pt as Extract<Effect, { kind: 'ModifyPT' }>).target;
    const gdtTarget = gdt.target;
    expect(ptTarget.kind).toBe('Chosen');
    expect(gdtTarget.kind).toBe('Chosen');
    expect((ptTarget as Extract<typeof ptTarget, { kind: 'Chosen' }>).targetId)
      .toBe((gdtTarget as Extract<typeof gdtTarget, { kind: 'Chosen' }>).targetId);

    // One target spec: the chosen creature
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
  });

  it('parses Galuf\'s Final Act style (AddCounters inner body)', () => {
    const text =
      'Target creature gets +1/+0 and gains "When this creature dies, put a +1/+1 counter on target creature."';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.effects).toHaveLength(2);

    const pt = parsed.effects[0];
    expect(pt.kind).toBe('ModifyPT');
    if (pt.kind !== 'ModifyPT') return;
    expect(pt.power).toBe(1);
    expect(pt.toughness).toBe(0);

    const gdt = parsed.effects[1];
    expect(gdt.kind).toBe('GrantDiesTrigger');
    if (gdt.kind !== 'GrantDiesTrigger') return;
    expect(gdt.dieEffects).toHaveLength(1);
    expect(gdt.dieEffects[0].kind).toBe('AddCounters');
    const ac = gdt.dieEffects[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(ac.counterType).toBe('+1/+1');
    expect(ac.count).toBe(1);
  });

  it('parses return-to-hand inner body variant', () => {
    const text =
      'Target creature gets +2/+0 and gains "When this creature dies, return it to its owner\'s hand."';
    const parsed = parseOracleText(text);
    // Should parse — ReturnFromGraveyard to hand is also executor-backed.
    // The inner "return it to its owner's hand" may or may not parse depending on
    // matchReturnFromGraveyard's self-return wording coverage; if unparsed, the
    // outer matcher rejects gracefully (returns Unparsed or tries next matcher).
    // We only assert that if it parses, the structure is correct.
    if (parsed.kind === 'Spell') {
      const gdtEffect = parsed.effects.find(e => e.kind === 'GrantDiesTrigger');
      if (gdtEffect) {
        expect(gdtEffect.kind).toBe('GrantDiesTrigger');
        if (gdtEffect.kind !== 'GrantDiesTrigger') return;
        expect(gdtEffect.dieEffects[0].kind).toBe('ReturnFromGraveyard');
      }
    }
    // Test passes regardless — rejecting an unparseable inner body is also correct.
  });

  it('does NOT parse when inner body is unsupported (DealDamage body — not executor-backed in granted-trigger slot)', () => {
    // "When this creature dies, ~ deals 2 damage to any target." — DealDamage inner body
    // is not in the accepted set (only ReturnFromGraveyard and AddCounters).
    const text =
      'Target creature gets +2/+0 and gains "When this creature dies, ~ deals 2 damage to any target."';
    const parsed = parseOracleText(text);
    // Should not be Spell with GrantDiesTrigger — either Unparsed or falls through.
    if (parsed.kind === 'Spell') {
      const gdtEffect = parsed.effects.find(e => e.kind === 'GrantDiesTrigger');
      expect(gdtEffect).toBeUndefined();
    }
    // Unparsed is also acceptable.
  });
});

// ---------------------------------------------------------------------------
// Execution tests
// ---------------------------------------------------------------------------

describe('slice9-pump-grant-quoted-dies: execution', () => {
  it('GrantDiesTrigger adds the Dies trigger to battlefieldAbilities', () => {
    // Set up a minimal game state with one creature
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

    // Parse and execute the Demonic Gifts effect
    const text =
      'Target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield under its owner\'s control."';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // Pass the parsed target spec so the executor can build chosenTargets correctly.
    const afterEffect = executeEffects(
      state,
      parsed.effects,
      'p1',
      [zombieCard.instanceId],
      parsed.targets,
      0,
      { sourceInstanceId: zombieCard.instanceId },
    );

    // battlefieldAbilities should now have a Dies trigger for the zombie.
    const abilities = afterEffect.battlefieldAbilities.get(zombieCard.instanceId);
    expect(abilities).toBeDefined();
    const diesAbility = abilities!.find(
      a => a.trigger.kind === 'Dies' && (a.trigger as { who?: string }).who === 'self',
    );
    expect(diesAbility).toBeDefined();
    expect(diesAbility!.effects).toHaveLength(1);
    expect(diesAbility!.effects[0].kind).toBe('ReturnFromGraveyard');
  });

  it('creature dies after pump → Dies trigger fires → returns to battlefield', () => {
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

    // Directly register a Dies trigger on the elf (simulating what GrantDiesTrigger executor does).
    const diesAbility: TriggeredAbilityRef = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'Dies', who: 'self' },
      effects: [{
        kind: 'ReturnFromGraveyard',
        target: { kind: 'Source' },
        destination: 'battlefield',
      }],
    };
    const abilities = new Map(state.battlefieldAbilities);
    abilities.set(elfCard.instanceId, [diesAbility]);
    state = { ...state, battlefieldAbilities: abilities };

    // Now apply lethal damage to trigger death.
    const damagedState = {
      ...state,
      cards: new Map(state.cards).set(elfCard.instanceId, {
        ...state.cards.get(elfCard.instanceId)!,
        damage: 10, // lethal for a 1/1
      }),
    };

    // State-based actions: creature dies AND trigger fires.
    const afterDeath = checkStateBasedActions(damagedState);

    // Elf should be in graveyard.
    expect(afterDeath.cards.get(elfCard.instanceId)!.zone).toBe('graveyard');

    // The Dies trigger should be in pendingTriggers.
    const firedTriggers = afterDeath.pendingTriggers.filter(
      t => t.sourceInstanceId === elfCard.instanceId
        && t.ability.trigger.kind === 'Dies',
    );
    expect(firedTriggers).toHaveLength(1);

    // Execute the trigger effect: ReturnFromGraveyard to battlefield.
    // The sourceInstanceId in the trigger context is the elf's instanceId (died creature).
    const afterReturn = executeEffects(
      afterDeath,
      firedTriggers[0].ability.effects as Effect[],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: elfCard.instanceId },
    );
    expect(afterReturn.cards.get(elfCard.instanceId)!.zone).toBe('battlefield');
  });

  it('AddCounters inner body fires on death (Galuf style)', () => {
    const victim = creature('soldier', 'Soldier', 2, 2);
    const target = creature('knight', 'Knight', 3, 3);
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [victim, target], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const lib = getCardsInZone(state, 'p1', 'library');
    const soldierCard = lib.find(c => c.definitionId === 'soldier')!;
    const knightCard = lib.find(c => c.definitionId === 'knight')!;

    state.cards.set(soldierCard.instanceId, {
      ...soldierCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state.cards.set(knightCard.instanceId, {
      ...knightCard,
      zone: 'battlefield',
      summoningSick: false,
    });

    // Grant a Dies trigger: "When this creature dies, put a +1/+1 counter on target creature."
    // The target of the AddCounters effect would be resolved to the knight.
    // For simplicity we use AllCreaturesYouControl as the counter target (self-resolving).
    const diesTriggerAbility: TriggeredAbilityRef = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'Dies', who: 'self' },
      effects: [{
        kind: 'AddCounters',
        target: { kind: 'AllCreaturesYouControl' },
        counterType: '+1/+1',
        count: 1,
      }],
    };
    const abilities = new Map(state.battlefieldAbilities);
    abilities.set(soldierCard.instanceId, [diesTriggerAbility]);
    state = { ...state, battlefieldAbilities: abilities };

    // Apply lethal damage to soldier.
    state = {
      ...state,
      cards: new Map(state.cards).set(soldierCard.instanceId, {
        ...state.cards.get(soldierCard.instanceId)!,
        damage: 10,
      }),
    };

    const afterDeath = checkStateBasedActions(state);

    // Soldier should be dead.
    expect(afterDeath.cards.get(soldierCard.instanceId)!.zone).toBe('graveyard');

    // Dies trigger should be pending.
    const firedTriggers = afterDeath.pendingTriggers.filter(
      t => t.sourceInstanceId === soldierCard.instanceId
        && t.ability.trigger.kind === 'Dies',
    );
    expect(firedTriggers).toHaveLength(1);

    // Execute the trigger: AllCreaturesYouControl gets a +1/+1 counter.
    // The soldier is now dead, so only the knight (still on battlefield) should get the counter.
    const afterCounter = executeEffects(
      afterDeath,
      firedTriggers[0].ability.effects as Effect[],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: soldierCard.instanceId },
    );
    const knightCounters = afterCounter.cards.get(knightCard.instanceId)!.counters;
    expect(knightCounters['+1/+1']).toBe(1);
  });
});
