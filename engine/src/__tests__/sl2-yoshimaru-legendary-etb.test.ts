/**
 * Slice 2: "Whenever another legendary permanent you control enters" trigger.
 *
 * Coverage:
 *   - Prefix parser produces AnotherLegendaryPermanentETB trigger.
 *   - Trigger fires when a legendary creature enters under the same controller.
 *   - Trigger fires when a legendary non-creature permanent enters.
 *   - Trigger does NOT fire when a non-legendary permanent enters.
 *   - Trigger does NOT fire when Yoshimaru itself enters (source excluded).
 *   - Effect body "put a +1/+1 counter on ~" (AddCounters Source) executes.
 *
 * Real oracle text used:
 *   Yoshimaru, Ever Faithful (DON-EN-001):
 *   "Whenever another legendary permanent you control enters, put a +1/+1 counter
 *    on Yoshimaru, Ever Faithful."
 *
 * Per the slice spec the body parses to AddCounters Source, which is exercised
 * via the real counters executor.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState, getCardsInZone } from '../game-state';
import { executeEffects } from '../effects/executor';
import { registerBattlefieldAbilities, createETBTriggers, checkTriggersForEvent } from '../stack';
import type { CardDefinition } from '../types';
import type { AddCountersEffect, Effect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Card definition helpers
// ---------------------------------------------------------------------------

function legendaryCreature(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Legendary Creature — Dog',
    oracle_text: '',
    mana_cost: '{W}',
    cmc: 1,
    colors: ['W'],
    color_identity: ['W'],
    keywords: [],
    card_types: ['creature'],
    power: 1,
    toughness: 1,
  };
}

function legendaryArtifact(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Legendary Artifact',
    oracle_text: '',
    mana_cost: '{3}',
    cmc: 3,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact'],
  };
}

function nonLegendaryCreature(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature — Human',
    oracle_text: '',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
}

function nonLegendaryArtifact(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Artifact',
    oracle_text: '',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact'],
  };
}

/** Yoshimaru, Ever Faithful — real oracle text, normalised for the parser. */
const YOSHIMARU_ORACLE =
  'Whenever another legendary permanent you control enters, put a +1/+1 counter on ~.';

/** 'cmd_none' does not match any test card id so all cards stay in the library. */
const NO_COMMANDER = 'cmd_none';

// ---------------------------------------------------------------------------
// Section 1: Parse tests
// ---------------------------------------------------------------------------

describe('sl2-yoshimaru — prefix parsing', () => {
  it('parses the real Yoshimaru oracle text into AnotherLegendaryPermanentETB trigger', () => {
    const result = parseOracleText(YOSHIMARU_ORACLE);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('AnotherLegendaryPermanentETB');
  });

  it('body parses to a single AddCounters effect on Source', () => {
    const result = parseOracleText(YOSHIMARU_ORACLE);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.effects).toHaveLength(1);
    const eff = result.ability.effects[0] as AddCountersEffect;
    expect(eff.kind).toBe('AddCounters');
    expect(eff.counterType).toBe('+1/+1');
    expect(eff.count).toBe(1);
    expect(eff.target).toEqual({ kind: 'Source' });
  });

  it('parses "enters the battlefield" variant with explicit location phrase', () => {
    const result = parseOracleText(
      'Whenever another legendary permanent you control enters the battlefield, put a +1/+1 counter on ~.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('AnotherLegendaryPermanentETB');
  });

  it('does NOT match "whenever another creature you control enters" (goes to AnotherCreatureETB)', () => {
    const result = parseOracleText('Whenever another creature you control enters, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('AnotherCreatureETB');
  });

  it('does NOT match self-ETB "When ~ enters" (goes to ETB)', () => {
    const result = parseOracleText('When ~ enters, draw a card.');
    expect(result.kind).toBe('ETB');
  });
});

// ---------------------------------------------------------------------------
// Section 2: Execution — trigger fires when legendary creature enters
// ---------------------------------------------------------------------------

describe('sl2-yoshimaru — execution: fires for legendary creature entry', () => {
  it('AnotherLegendaryPermanentETB fires and puts a +1/+1 counter on Yoshimaru when a legendary creature enters', () => {
    const yoshimaruDef: CardDefinition = {
      ...legendaryCreature('yoshimaru-a', 'Yoshimaru, Ever Faithful'),
      oracle_text: YOSHIMARU_ORACLE,
    };
    const legendaryFriendDef = legendaryCreature('legendary-friend-a', 'Isamaru, Hound of Konda');

    const decks = [
      {
        playerId: 'p1',
        name: 'Alice',
        cards: [yoshimaruDef, legendaryFriendDef],
        commanderId: NO_COMMANDER,
      },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: NO_COMMANDER },
    ];

    let state = initGameState(decks);
    const lib = getCardsInZone(state, 'p1', 'library');
    const yoshiCard = lib.find(c => c.definitionId === 'yoshimaru-a')!;
    const friendCard = lib.find(c => c.definitionId === 'legendary-friend-a')!;

    // Put Yoshimaru on the battlefield.
    state.cards.set(yoshiCard.instanceId, {
      ...yoshiCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = registerBattlefieldAbilities(state, yoshiCard.instanceId);

    // Now a legendary friend enters.
    state.cards.set(friendCard.instanceId, {
      ...friendCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = registerBattlefieldAbilities(state, friendCard.instanceId);

    // Fire PermanentETB for the legendary friend.
    state = checkTriggersForEvent(state, {
      kind: 'PermanentETB',
      instanceId: friendCard.instanceId,
      controllerId: 'p1',
    });

    // Exactly one pending trigger from Yoshimaru.
    const fired = state.pendingTriggers.filter(
      t => t.sourceInstanceId === yoshiCard.instanceId,
    );
    expect(fired).toHaveLength(1);
    expect(fired[0].ability.trigger.kind).toBe('AnotherLegendaryPermanentETB');

    // Execute the effect: put a +1/+1 counter on Yoshimaru.
    const countersBefore = (state.cards.get(yoshiCard.instanceId)!.counters['+1/+1'] ?? 0);
    const afterState = executeEffects(
      state,
      fired[0].ability.effects as Effect[],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: yoshiCard.instanceId },
    );

    const yoshiAfter = afterState.cards.get(yoshiCard.instanceId)!;
    expect(yoshiAfter.counters['+1/+1'] ?? 0).toBe(countersBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Execution — fires for legendary non-creature permanent
// ---------------------------------------------------------------------------

describe('sl2-yoshimaru — execution: fires for legendary artifact entry', () => {
  it('AnotherLegendaryPermanentETB fires when a legendary artifact enters', () => {
    const yoshimaruDef: CardDefinition = {
      ...legendaryCreature('yoshimaru-b', 'Yoshimaru, Ever Faithful'),
      oracle_text: YOSHIMARU_ORACLE,
    };
    const legendaryRingDef = legendaryArtifact('legendary-ring-b', 'The One Ring');

    const decks = [
      {
        playerId: 'p1',
        name: 'Alice',
        cards: [yoshimaruDef, legendaryRingDef],
        commanderId: NO_COMMANDER,
      },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: NO_COMMANDER },
    ];

    let state = initGameState(decks);
    const lib = getCardsInZone(state, 'p1', 'library');
    const yoshiCard = lib.find(c => c.definitionId === 'yoshimaru-b')!;
    const ringCard = lib.find(c => c.definitionId === 'legendary-ring-b')!;

    // Put Yoshimaru on the battlefield.
    state.cards.set(yoshiCard.instanceId, {
      ...yoshiCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = registerBattlefieldAbilities(state, yoshiCard.instanceId);

    // The legendary artifact enters.
    state.cards.set(ringCard.instanceId, {
      ...ringCard,
      zone: 'battlefield',
    });
    state = registerBattlefieldAbilities(state, ringCard.instanceId);

    // Fire PermanentETB for the legendary artifact.
    state = checkTriggersForEvent(state, {
      kind: 'PermanentETB',
      instanceId: ringCard.instanceId,
      controllerId: 'p1',
    });

    // Exactly one trigger from Yoshimaru.
    const fired = state.pendingTriggers.filter(
      t => t.sourceInstanceId === yoshiCard.instanceId,
    );
    expect(fired).toHaveLength(1);
    expect(fired[0].ability.trigger.kind).toBe('AnotherLegendaryPermanentETB');

    // Counter is placed correctly.
    const afterState = executeEffects(
      state,
      fired[0].ability.effects as Effect[],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: yoshiCard.instanceId },
    );
    const yoshiAfter = afterState.cards.get(yoshiCard.instanceId)!;
    expect(yoshiAfter.counters['+1/+1'] ?? 0).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Section 4: Non-legendary permanent must NOT trigger
// ---------------------------------------------------------------------------

describe('sl2-yoshimaru — execution: non-legendary permanent does NOT trigger', () => {
  it('does NOT fire when a non-legendary creature enters', () => {
    const yoshimaruDef: CardDefinition = {
      ...legendaryCreature('yoshimaru-c', 'Yoshimaru, Ever Faithful'),
      oracle_text: YOSHIMARU_ORACLE,
    };
    const vanilla = nonLegendaryCreature('vanilla-human-c', 'Grizzly Bears');

    const decks = [
      {
        playerId: 'p1',
        name: 'Alice',
        cards: [yoshimaruDef, vanilla],
        commanderId: NO_COMMANDER,
      },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: NO_COMMANDER },
    ];

    let state = initGameState(decks);
    const lib = getCardsInZone(state, 'p1', 'library');
    const yoshiCard = lib.find(c => c.definitionId === 'yoshimaru-c')!;
    const vanillaCard = lib.find(c => c.definitionId === 'vanilla-human-c')!;

    state.cards.set(yoshiCard.instanceId, {
      ...yoshiCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = registerBattlefieldAbilities(state, yoshiCard.instanceId);

    // Non-legendary creature enters.
    state.cards.set(vanillaCard.instanceId, {
      ...vanillaCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = registerBattlefieldAbilities(state, vanillaCard.instanceId);

    state = checkTriggersForEvent(state, {
      kind: 'PermanentETB',
      instanceId: vanillaCard.instanceId,
      controllerId: 'p1',
    });

    const fired = state.pendingTriggers.filter(
      t => t.sourceInstanceId === yoshiCard.instanceId,
    );
    expect(fired).toHaveLength(0);
  });

  it('does NOT fire when a non-legendary artifact enters', () => {
    const yoshimaruDef: CardDefinition = {
      ...legendaryCreature('yoshimaru-d', 'Yoshimaru, Ever Faithful'),
      oracle_text: YOSHIMARU_ORACLE,
    };
    const plainArtifact = nonLegendaryArtifact('plain-artifact-d', 'Mind Stone');

    const decks = [
      {
        playerId: 'p1',
        name: 'Alice',
        cards: [yoshimaruDef, plainArtifact],
        commanderId: NO_COMMANDER,
      },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: NO_COMMANDER },
    ];

    let state = initGameState(decks);
    const lib = getCardsInZone(state, 'p1', 'library');
    const yoshiCard = lib.find(c => c.definitionId === 'yoshimaru-d')!;
    const artifactCard = lib.find(c => c.definitionId === 'plain-artifact-d')!;

    state.cards.set(yoshiCard.instanceId, {
      ...yoshiCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = registerBattlefieldAbilities(state, yoshiCard.instanceId);

    state.cards.set(artifactCard.instanceId, {
      ...artifactCard,
      zone: 'battlefield',
    });
    state = registerBattlefieldAbilities(state, artifactCard.instanceId);

    state = checkTriggersForEvent(state, {
      kind: 'PermanentETB',
      instanceId: artifactCard.instanceId,
      controllerId: 'p1',
    });

    const fired = state.pendingTriggers.filter(
      t => t.sourceInstanceId === yoshiCard.instanceId,
    );
    expect(fired).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Yoshimaru entering itself must NOT trigger
// ---------------------------------------------------------------------------

describe('sl2-yoshimaru — execution: source entering itself does NOT trigger', () => {
  it('does NOT fire when Yoshimaru itself enters the battlefield', () => {
    const yoshimaruDef: CardDefinition = {
      ...legendaryCreature('yoshimaru-e', 'Yoshimaru, Ever Faithful'),
      oracle_text: YOSHIMARU_ORACLE,
    };

    const decks = [
      {
        playerId: 'p1',
        name: 'Alice',
        cards: [yoshimaruDef],
        commanderId: NO_COMMANDER,
      },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: NO_COMMANDER },
    ];

    let state = initGameState(decks);
    const lib = getCardsInZone(state, 'p1', 'library');
    const yoshiCard = lib.find(c => c.definitionId === 'yoshimaru-e')!;

    // Yoshimaru enters the battlefield.
    state.cards.set(yoshiCard.instanceId, {
      ...yoshiCard,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = registerBattlefieldAbilities(state, yoshiCard.instanceId);
    // createETBTriggers handles the self-ETB path — must NOT queue the legendary trigger.
    state = createETBTriggers(state, yoshiCard.instanceId);

    // Fire PermanentETB for Yoshimaru itself.
    state = checkTriggersForEvent(state, {
      kind: 'PermanentETB',
      instanceId: yoshiCard.instanceId,
      controllerId: 'p1',
    });

    // AnotherLegendaryPermanentETB must not have fired for Yoshimaru's own entry.
    const triggered = state.pendingTriggers.filter(
      t =>
        t.sourceInstanceId === yoshiCard.instanceId &&
        t.ability.trigger.kind === 'AnotherLegendaryPermanentETB',
    );
    expect(triggered).toHaveLength(0);
  });
});
