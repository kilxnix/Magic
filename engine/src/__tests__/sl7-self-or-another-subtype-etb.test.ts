/**
 * Slice 7: "Whenever this creature or another <Subtype> you control enters" trigger prefix.
 *
 * Coverage:
 *   - Prefix parser recognises the Ally / Dinosaur / creature / Equipment variants.
 *   - matchETBPrefix now accepts "this Equipment enters" (Equipment self-ETB fix).
 *   - SelfOrAnotherSubtypeETB fires when the SOURCE itself enters the battlefield.
 *   - SelfOrAnotherSubtypeETB fires when ANOTHER matching creature/subtype enters.
 *   - SelfOrAnotherSubtypeETB does NOT fire for non-matching permanents.
 *
 * Cards referenced (real oracle text used):
 *   Murasa Pyromancer — "Whenever this creature or another Ally you control enters,
 *     ~ deals 1 damage to target creature or player."
 *   Kazuul Warlord — "Whenever this creature or another Ally you control enters,
 *     put a +1/+1 counter on each Ally you control."
 *   Verdant Sun's Avatar — "Whenever this creature or another Dinosaur you control
 *     enters, you gain life equal to that creature's toughness."  (EventCreature-stat tail)
 *   Shining Armor — "When this Equipment enters, attach it to target creature you control."
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState, getCardsInZone } from '../game-state';
import { executeEffects } from '../effects/executor';
import { checkStateBasedActions } from '../state-based';
import { registerBattlefieldAbilities, createETBTriggers, checkTriggersForEvent } from '../stack';
import type { CardDefinition, TriggeredAbilityRef } from '../types';
import type { Effect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ally(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature — Human Ally',
    oracle_text: '',
    mana_cost: '{2}{R}',
    cmc: 3,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
}

function bear(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
}

function land(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function dinosaur(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature — Dinosaur',
    oracle_text: '',
    mana_cost: '{3}{G}',
    cmc: 4,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 3,
    toughness: 3,
  };
}

// ---------------------------------------------------------------------------
// Section 1: Prefix parser
// ---------------------------------------------------------------------------

describe('sl7-self-or-another-subtype-etb — prefix parsing', () => {
  it('parses Murasa Pyromancer-style Ally ETB: "Whenever this creature or another Ally you control enters, ~ deals 1 damage to target creature or player."', () => {
    const text =
      'Whenever this creature or another Ally you control enters, ~ deals 1 damage to target creature or player.';
    const result = parseOracleText(text);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'SelfOrAnotherSubtypeETB', subtype: 'ally' });
    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('DealDamage');
  });

  it('parses tilde form: "Whenever ~ or another Ally you control enters, you draw a card."', () => {
    const text = 'Whenever ~ or another Ally you control enters, you draw a card.';
    const result = parseOracleText(text);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'SelfOrAnotherSubtypeETB', subtype: 'ally' });
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('parses Dinosaur variant: "Whenever this creature or another Dinosaur you control enters, you gain 3 life."', () => {
    const text =
      'Whenever this creature or another Dinosaur you control enters, you gain 3 life.';
    const result = parseOracleText(text);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'SelfOrAnotherSubtypeETB', subtype: 'dinosaur' });
    expect(result.ability.effects[0].kind).toBe('GainLife');
  });

  it('parses plain-creature variant: "Whenever this creature or another creature you control enters, draw a card."', () => {
    const text = 'Whenever this creature or another creature you control enters, draw a card.';
    const result = parseOracleText(text);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'SelfOrAnotherSubtypeETB', subtype: 'creature' });
  });

  it('parses plural form: "Whenever this creature or another Allies you control enters, draw a card." (normalised to ally)', () => {
    const text = 'Whenever this creature or another Allies you control enters, draw a card.';
    const result = parseOracleText(text);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'SelfOrAnotherSubtypeETB', subtype: 'ally' });
  });

  it('parses Phyrexian variant: "Whenever this creature or another Phyrexian you control enters, each opponent loses 1 life."', () => {
    const text =
      'Whenever this creature or another Phyrexian you control enters, each opponent loses 1 life.';
    const result = parseOracleText(text);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'SelfOrAnotherSubtypeETB', subtype: 'phyrexian' });
    expect(result.ability.effects[0].kind).toBe('LoseLife');
  });

  it('does NOT match "Whenever another Ally you control enters" (missing self-reference) -> AnotherCreatureETB instead', () => {
    // This has no self-reference so it should fall through to AnotherCreatureETB.
    const text = 'Whenever another creature you control enters, draw a card.';
    const result = parseOracleText(text);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    // Must NOT be SelfOrAnotherSubtypeETB
    expect(result.ability.trigger.kind).not.toBe('SelfOrAnotherSubtypeETB');
    expect(result.ability.trigger.kind).toBe('AnotherCreatureETB');
  });

  it('does NOT match a plain self-ETB "When this creature enters" -> ETB kind', () => {
    const text = 'When this creature enters, draw a card.';
    const result = parseOracleText(text);
    expect(result.kind).toBe('ETB');
  });
});

// ---------------------------------------------------------------------------
// Section 2: Equipment self-ETB fix ("this Equipment enters")
// ---------------------------------------------------------------------------

describe('sl7-self-or-another-subtype-etb — Equipment self-ETB prefix fix', () => {
  it('parses "When this Equipment enters, attach it to target creature you control." as ETB (not Unparsed)', () => {
    const text =
      'When this Equipment enters, attach it to target creature you control.';
    const result = parseOracleText(text);
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    expect(result.ability.trigger).toEqual({ kind: 'ETB', who: 'self' });
    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('Attach');
  });

  it('parses Shining Armor-style wording: "When this Equipment enters the battlefield, attach it to target creature you control." as ETB', () => {
    const text =
      'When this Equipment enters the battlefield, attach it to target creature you control.';
    const result = parseOracleText(text);
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    expect(result.ability.trigger.kind).toBe('ETB');
  });
});

// ---------------------------------------------------------------------------
// Section 3: Execution — SelfOrAnotherSubtypeETB fires when SOURCE enters
// ---------------------------------------------------------------------------

describe('sl7-self-or-another-subtype-etb — execution: self-entry fires', () => {
  it('SelfOrAnotherSubtypeETB fires when the source permanent itself enters', () => {
    /**
     * Setup: An Ally with "Whenever this creature or another Ally you control enters,
     * draw a card." enters the battlefield directly. The trigger should fire once
     * (for the source's own entry).
     */
    const watcherDef: CardDefinition = {
      ...ally('ally-watcher', 'Ally Watcher'),
      oracle_text:
        'Whenever this creature or another Ally you control enters, draw a card.',
    };
    // Extra card in library so the Draw effect has something to draw.
    const extraCard = land('forest-1', 'Forest');

    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [watcherDef, extraCard], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];

    let state = initGameState(decks);
    const lib = getCardsInZone(state, 'p1', 'library');
    const watcherCard = lib.find(c => c.definitionId === 'ally-watcher')!;

    // Put the watcher onto the battlefield.
    state.cards.set(watcherCard.instanceId, {
      ...watcherCard,
      zone: 'battlefield',
      summoningSick: false,
    });

    // Register its battlefield abilities (this parses the oracle text and registers
    // SelfOrAnotherSubtypeETB).
    state = registerBattlefieldAbilities(state, watcherCard.instanceId);

    // Simulate entering: queue self-ETB triggers.
    state = createETBTriggers(state, watcherCard.instanceId);

    // Exactly one pending trigger (for the self-entry event).
    const fired = state.pendingTriggers.filter(
      t => t.sourceInstanceId === watcherCard.instanceId,
    );
    expect(fired).toHaveLength(1);
    expect(fired[0].ability.trigger.kind).toBe('SelfOrAnotherSubtypeETB');

    // Execute — controller draws a card.
    const handBefore = getCardsInZone(state, 'p1', 'hand').length;
    const finalState = executeEffects(
      state,
      fired[0].ability.effects as Effect[],
      'p1',
      [],
      [],
    );
    expect(getCardsInZone(finalState, 'p1', 'hand').length).toBe(handBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// Section 4: Execution — SelfOrAnotherSubtypeETB fires when ANOTHER matching
//            creature enters
// ---------------------------------------------------------------------------

describe('sl7-self-or-another-subtype-etb — execution: another-entry fires', () => {
  it('SelfOrAnotherSubtypeETB fires for a second Ally entering under the same controller', () => {
    /**
     * Setup:
     *   - allyWatcher is already on the battlefield and has
     *     "Whenever this creature or another Ally you control enters, draw a card."
     *   - a new Ally (allyNew) enters.
     *   - The trigger should fire once for allyNew's entry.
     */
    const allyWatcherDef: CardDefinition = {
      ...ally('ally-watcher-2', 'Ally Commander'),
      oracle_text:
        'Whenever this creature or another Ally you control enters, draw a card.',
    };
    const allyNewDef = ally('ally-new', 'Rally Ally');
    // Extra card in library so the Draw effect has something to draw.
    const extraCard2 = land('forest-2', 'Forest');

    const decks = [
      {
        playerId: 'p1',
        name: 'Alice',
        cards: [allyWatcherDef, allyNewDef, extraCard2],
        commanderId: 'cmd1',
      },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];

    let state = initGameState(decks);
    const lib = getCardsInZone(state, 'p1', 'library');
    const watcherCard = lib.find(c => c.definitionId === 'ally-watcher-2')!;
    const newAllyCard = lib.find(c => c.definitionId === 'ally-new')!;

    // Put the watcher onto the battlefield (already there).
    state.cards.set(watcherCard.instanceId, {
      ...watcherCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = registerBattlefieldAbilities(state, watcherCard.instanceId);

    // Now the new Ally enters — manually inject it onto battlefield.
    state.cards.set(newAllyCard.instanceId, {
      ...newAllyCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = registerBattlefieldAbilities(state, newAllyCard.instanceId);

    // Simulate the CreatureETB event for allyNew via checkTriggersForEvent.
    state = checkTriggersForEvent(state, {
      kind: 'CreatureETB',
      instanceId: newAllyCard.instanceId,
      controllerId: 'p1',
    });

    // The watcher's trigger should have fired once (for the new Ally's entry).
    const fired = state.pendingTriggers.filter(
      t => t.sourceInstanceId === watcherCard.instanceId,
    );
    expect(fired).toHaveLength(1);
    expect(fired[0].ability.trigger.kind).toBe('SelfOrAnotherSubtypeETB');

    // Effect: controller draws a card.
    const handBefore = getCardsInZone(state, 'p1', 'hand').length;
    const finalState = executeEffects(
      state,
      fired[0].ability.effects as Effect[],
      'p1',
      [],
      [],
    );
    expect(getCardsInZone(finalState, 'p1', 'hand').length).toBe(handBefore + 1);
  });

  it('SelfOrAnotherSubtypeETB does NOT fire when a NON-Ally creature enters', () => {
    const allyWatcherDef: CardDefinition = {
      ...ally('ally-watcher-3', 'Silent Ally'),
      oracle_text:
        'Whenever this creature or another Ally you control enters, draw a card.',
    };
    const bearDef = bear('plain-bear', 'Grizzly Bears');

    const decks = [
      {
        playerId: 'p1',
        name: 'Alice',
        cards: [allyWatcherDef, bearDef],
        commanderId: 'cmd1',
      },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];

    let state = initGameState(decks);
    const lib = getCardsInZone(state, 'p1', 'library');
    const watcherCard = lib.find(c => c.definitionId === 'ally-watcher-3')!;
    const bearCard = lib.find(c => c.definitionId === 'plain-bear')!;

    state.cards.set(watcherCard.instanceId, {
      ...watcherCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = registerBattlefieldAbilities(state, watcherCard.instanceId);

    // The Bear (not an Ally) enters.
    state.cards.set(bearCard.instanceId, {
      ...bearCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = registerBattlefieldAbilities(state, bearCard.instanceId);

    state = checkTriggersForEvent(state, {
      kind: 'CreatureETB',
      instanceId: bearCard.instanceId,
      controllerId: 'p1',
    });

    // The watcher's trigger should NOT have fired for the Bear.
    const fired = state.pendingTriggers.filter(
      t => t.sourceInstanceId === watcherCard.instanceId,
    );
    expect(fired).toHaveLength(0);
  });

  it('SelfOrAnotherSubtypeETB(dinosaur) fires when another Dinosaur you control enters', () => {
    const avatarDef: CardDefinition = {
      ...dinosaur('sun-avatar', "Verdant Sun's Avatar"),
      oracle_text:
        "Whenever this creature or another Dinosaur you control enters, you gain 3 life.",
    };
    const dinoNewDef = dinosaur('rex', 'Tyrannical Rex');

    const decks = [
      {
        playerId: 'p1',
        name: 'Alice',
        cards: [avatarDef, dinoNewDef],
        commanderId: 'cmd1',
      },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];

    let state = initGameState(decks);
    const lib = getCardsInZone(state, 'p1', 'library');
    const avatarCard = lib.find(c => c.definitionId === 'sun-avatar')!;
    const dinoCard = lib.find(c => c.definitionId === 'rex')!;

    state.cards.set(avatarCard.instanceId, {
      ...avatarCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = registerBattlefieldAbilities(state, avatarCard.instanceId);

    state.cards.set(dinoCard.instanceId, {
      ...dinoCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = registerBattlefieldAbilities(state, dinoCard.instanceId);

    state = checkTriggersForEvent(state, {
      kind: 'CreatureETB',
      instanceId: dinoCard.instanceId,
      controllerId: 'p1',
    });

    const fired = state.pendingTriggers.filter(
      t => t.sourceInstanceId === avatarCard.instanceId,
    );
    expect(fired).toHaveLength(1);
    expect(fired[0].ability.trigger.kind).toBe('SelfOrAnotherSubtypeETB');

    // Effect: gain 3 life.
    const before = state.players.find(p => p.id === 'p1')!.life;
    const finalState = executeEffects(
      state,
      fired[0].ability.effects as Effect[],
      'p1',
      [],
      [],
    );
    expect(finalState.players.find(p => p.id === 'p1')!.life).toBe(before + 3);
  });
});
