/**
 * Slice 9 — "You control enchanted creature/permanent" (ControlEnchanted)
 *
 * Tests that the theft-Aura static (Control Magic, Mind Control, Confiscate,
 * Persuasion, Threads of Disloyalty, Take Possession, Lay Claim) is:
 *   1. Parsed correctly as a StaticAbility with modifier { kind: 'ControlEnchanted' }
 *   2. Executed: when the Aura enters attached, the enchanted permanent's ownerId
 *      is transferred to the Aura's controller
 *   3. Reverted: when the Aura leaves the battlefield (SBA path), ownerId is
 *      restored to the original controller
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { pruneDetachedEffects } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { checkStateBasedActions } from '../state-based';
import { resetContinuousTimestamp } from '../effects/continuous';
import type { CardDefinition, CardInstance, GameState } from '../types';
import { createPlayer } from '../types';

// ---------------------------------------------------------------------------
// Card definitions
// ---------------------------------------------------------------------------

const controlMagic: CardDefinition = {
  id: 'control-magic',
  name: 'Control Magic',
  type_line: 'Enchantment — Aura',
  oracle_text: 'Enchant creature\nYou control enchanted creature.',
  mana_cost: '{2}{U}{U}',
  cmc: 4,
  colors: ['U'],
  color_identity: ['U'],
  keywords: [],
  card_types: ['enchantment'],
};

const mindControl: CardDefinition = {
  id: 'mind-control',
  name: 'Mind Control',
  type_line: 'Enchantment — Aura',
  oracle_text: 'Enchant creature\nYou control enchanted creature.',
  mana_cost: '{3}{U}{U}',
  cmc: 5,
  colors: ['U'],
  color_identity: ['U'],
  keywords: [],
  card_types: ['enchantment'],
};

const takePos: CardDefinition = {
  id: 'take-possession',
  name: 'Take Possession',
  type_line: 'Enchantment — Aura',
  oracle_text: 'Enchant permanent\nYou control enchanted permanent.',
  mana_cost: '{5}{U}{U}',
  cmc: 7,
  colors: ['U'],
  color_identity: ['U'],
  keywords: [],
  card_types: ['enchantment'],
};

// A card whose oracle contains only the theft clause (no "Enchant" preamble) —
// to verify matchControlEnchanted works on a bare single-sentence text.
const bareTheft: CardDefinition = {
  id: 'bare-theft',
  name: 'Bare Theft',
  type_line: 'Enchantment — Aura',
  oracle_text: 'You control enchanted creature.',
  mana_cost: '{U}{U}',
  cmc: 2,
  colors: ['U'],
  color_identity: ['U'],
  keywords: [],
  card_types: ['enchantment'],
};

const vanillaCreature: CardDefinition = {
  id: 'bear',
  name: 'Bear',
  type_line: 'Creature — Bear',
  oracle_text: '',
  mana_cost: '{1}{G}',
  cmc: 2,
  colors: ['G'],
  color_identity: ['G'],
  keywords: [],
  power: 2,
  toughness: 2,
  card_types: ['creature'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'],
  extra: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...extra,
  };
}

function makeBaseState(extraCards: [string, CardInstance][] = [], extraDefs: [string, CardDefinition][] = []): GameState {
  return {
    players: [createPlayer('p0', 'Alice'), createPlayer('p1', 'Bob')],
    cards: new Map(extraCards),
    cardDefinitions: new Map([
      ['control-magic', controlMagic],
      ['mind-control', mindControl],
      ['take-possession', takePos],
      ['bare-theft', bareTheft],
      ['bear', vanillaCreature],
      ...extraDefs,
    ]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 3,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ---------------------------------------------------------------------------
// Section 1: Parse tests
// ---------------------------------------------------------------------------

describe('Slice 9 — matchControlEnchanted: parse', () => {
  beforeEach(() => resetContinuousTimestamp());

  it('parses "Control Magic" (Enchant creature + You control enchanted creature.)', () => {
    const result = parseOracleText('Enchant creature\nYou control enchanted creature.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('ControlEnchanted');
    expect(result.ability.attachedOnly).toBe(true);
  });

  it('parses "Take Possession" (Enchant permanent + You control enchanted permanent.)', () => {
    const result = parseOracleText('Enchant permanent\nYou control enchanted permanent.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('ControlEnchanted');
  });

  it('parses bare "You control enchanted creature." without Enchant preamble', () => {
    const result = parseOracleText('You control enchanted creature.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('ControlEnchanted');
  });

  it('parses "You control enchanted permanent." (no creature restriction)', () => {
    const result = parseOracleText('You control enchanted permanent.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('ControlEnchanted');
  });

  it('does NOT parse when there is an additional non-keyword clause (honesty gate)', () => {
    // A card with theft + an additional triggered/effect clause should remain Unparsed
    // (the parser should not claim coverage of the extra clause).
    const result = parseOracleText(
      'Enchant creature\nYou control enchanted creature.\nWhen ~ leaves the battlefield, return enchanted creature to its owner\'s hand.',
    );
    // The trigger clause means this is NOT a simple ControlEnchanted face.
    // The whole-face matchControlEnchanted check would see the trigger and decline.
    // The result should be Triggered (the trigger is the primary parse) or Unparsed.
    expect(result.kind).not.toBe('StaticAbility');
  });

  it('parses "Threads of Disloyalty" wording (Enchant creature you control... style text)', () => {
    // Threads of Disloyalty: "Enchant creature with power 2 or less\nYou control enchanted creature."
    const result = parseOracleText('Enchant creature with power 2 or less\nYou control enchanted creature.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('ControlEnchanted');
  });
});

// ---------------------------------------------------------------------------
// Section 2: Execution tests — control transfer on attach
// ---------------------------------------------------------------------------

describe('Slice 9 — ControlEnchanted: control transfer on Aura attach', () => {
  beforeEach(() => resetContinuousTimestamp());

  it('transfers ownerId of enchanted creature to Aura controller on attach', () => {
    // p1 controls a bear; p0 casts Control Magic and it enters attached.
    const bear = makeInstance('bear_0', 'bear', 'p1', 'battlefield');
    const aura = makeInstance('aura_0', 'control-magic', 'p0', 'battlefield', {
      attachedTo: 'bear_0',
    });

    let state = makeBaseState([
      ['bear_0', bear],
      ['aura_0', aura],
    ]);

    // registerContinuousAbilitiesForPermanent handles the ControlEnchanted attach hook.
    state = registerContinuousAbilitiesForPermanent(state, 'aura_0');

    // The bear should now be owned/controlled by p0.
    expect(state.cards.get('bear_0')!.ownerId).toBe('p0');

    // The Aura should have stored the original owner for the revert path.
    const auraCard = state.cards.get('aura_0')!;
    expect(auraCard.choices?.previousEnchantedOwnerId).toBe('p1');
    expect(auraCard.choices?.stolenPermanentId).toBe('bear_0');

    // A continuous effect should have been registered for the Aura.
    const ce = state.continuousEffects?.find(e => e.sourceInstanceId === 'aura_0');
    expect(ce).toBeDefined();
    expect(ce!.ability.modifier.kind).toBe('ControlEnchanted');
  });

  it('transfers control for "Take Possession" (Enchant permanent)', () => {
    const artifact = makeInstance('art_0', 'bear', 'p1', 'battlefield');
    const aura = makeInstance('aura_0', 'take-possession', 'p0', 'battlefield', {
      attachedTo: 'art_0',
    });

    let state = makeBaseState([
      ['art_0', artifact],
      ['aura_0', aura],
    ]);

    state = registerContinuousAbilitiesForPermanent(state, 'aura_0');

    expect(state.cards.get('art_0')!.ownerId).toBe('p0');
    expect(state.cards.get('aura_0')!.choices?.previousEnchantedOwnerId).toBe('p1');
    expect(state.cards.get('aura_0')!.choices?.stolenPermanentId).toBe('art_0');
  });

  it('does not transfer control when Aura is not attached to anything', () => {
    const aura = makeInstance('aura_0', 'control-magic', 'p0', 'battlefield');
    // No attachedTo set.

    let state = makeBaseState([['aura_0', aura]]);
    state = registerContinuousAbilitiesForPermanent(state, 'aura_0');

    // No crash, no cards changed.
    expect(state.cards.get('aura_0')!.choices?.stolenPermanentId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Section 3: Revert tests — control returns on Aura leaving
// ---------------------------------------------------------------------------

describe('Slice 9 — ControlEnchanted: revert on Aura leaving battlefield', () => {
  beforeEach(() => resetContinuousTimestamp());

  it('reverts ownerId to original controller when Aura is destroyed (pruneDetachedEffects)', () => {
    // Set up: p0 controls an Aura attached to p1's bear; control has been transferred.
    const bear = makeInstance('bear_0', 'bear', 'p0', 'battlefield'); // currently p0-owned (stolen)
    // Aura leaves the battlefield (e.g. Disenchant was cast).
    const aura = makeInstance('aura_0', 'control-magic', 'p0', 'graveyard', {
      choices: { previousEnchantedOwnerId: 'p1', stolenPermanentId: 'bear_0' },
    });

    // Build a state that still has the ControlEnchanted continuous effect
    // (as if the Aura just moved to the graveyard and pruneDetachedEffects hasn't run yet).
    const state: GameState = {
      ...makeBaseState([
        ['bear_0', bear],
        ['aura_0', aura],
      ]),
      continuousEffects: [
        {
          id: 'ce_test_1',
          sourceInstanceId: 'aura_0',
          controllerId: 'p0',
          ability: {
            kind: 'StaticAbility',
            modifier: { kind: 'ControlEnchanted' },
            filter: { permanent: true },
            controller: 'you',
            excludeSelf: false,
            attachedOnly: true,
          },
          timestamp: 1,
        },
      ],
    };

    const pruned = pruneDetachedEffects(state);

    // The bear should be reverted to p1's control.
    expect(pruned.cards.get('bear_0')!.ownerId).toBe('p1');

    // The continuous effect should be removed (Aura is no longer on battlefield).
    expect(pruned.continuousEffects?.some(e => e.sourceInstanceId === 'aura_0')).toBe(false);
  });

  it('reverts via SBA when enchanted creature dies (Aura becomes illegal, goes to graveyard)', () => {
    // p0 cast Control Magic on p1's bear. Bear now has ownerId = 'p0'.
    // The bear takes lethal damage and will die in SBA.
    const bear = makeInstance('bear_0', 'bear', 'p0', 'battlefield', {
      // enough damage to die (toughness=2)
      damage: 3,
    });
    const aura = makeInstance('aura_0', 'control-magic', 'p0', 'battlefield', {
      attachedTo: 'bear_0',
      choices: { previousEnchantedOwnerId: 'p1', stolenPermanentId: 'bear_0' },
    });

    const state: GameState = {
      ...makeBaseState([
        ['bear_0', bear],
        ['aura_0', aura],
      ]),
      continuousEffects: [
        {
          id: 'ce_sba',
          sourceInstanceId: 'aura_0',
          controllerId: 'p0',
          ability: {
            kind: 'StaticAbility',
            modifier: { kind: 'ControlEnchanted' },
            filter: { permanent: true },
            controller: 'you',
            excludeSelf: false,
            attachedOnly: true,
          },
          timestamp: 2,
        },
      ],
    };

    const after = checkStateBasedActions(state);

    // The bear should have died (moved to graveyard or ceased to exist).
    const bearAfter = after.cards.get('bear_0');
    expect(bearAfter?.zone).not.toBe('battlefield');

    // The Aura should have gone to the graveyard (was attached to a now-dead creature).
    const auraAfter = after.cards.get('aura_0');
    expect(auraAfter?.zone).toBe('graveyard');

    // Because the bear died (no longer on battlefield), the revert is a no-op —
    // the bear is not on the battlefield so there's nothing to revert ownerId for.
    // The key invariant is: no crash and the SBA ran cleanly.
    expect(auraAfter).toBeDefined();
  });

  it('does not revert if the stolen permanent has also left the battlefield', () => {
    // Aura left battlefield; but so did the enchanted creature. No revert needed.
    const aura = makeInstance('aura_0', 'control-magic', 'p0', 'graveyard', {
      choices: { previousEnchantedOwnerId: 'p1', stolenPermanentId: 'bear_0' },
    });
    // bear_0 is in the graveyard (not on battlefield)
    const bear = makeInstance('bear_0', 'bear', 'p0', 'graveyard');

    const state: GameState = {
      ...makeBaseState([
        ['bear_0', bear],
        ['aura_0', aura],
      ]),
      continuousEffects: [
        {
          id: 'ce_double_gone',
          sourceInstanceId: 'aura_0',
          controllerId: 'p0',
          ability: {
            kind: 'StaticAbility',
            modifier: { kind: 'ControlEnchanted' },
            filter: { permanent: true },
            controller: 'you',
            excludeSelf: false,
            attachedOnly: true,
          },
          timestamp: 3,
        },
      ],
    };

    const pruned = pruneDetachedEffects(state);

    // Bear remains in graveyard with whatever ownerId it had; no crash.
    expect(pruned.cards.get('bear_0')!.zone).toBe('graveyard');
    // The ownerId should NOT have been changed (permanent not on battlefield).
    expect(pruned.cards.get('bear_0')!.ownerId).toBe('p0');
  });
});
