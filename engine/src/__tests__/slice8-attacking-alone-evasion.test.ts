/**
 * Slice 8: "attacking alone" conditional evasion
 *
 * Covers:
 *   matchAttackingAloneEvasion (static-abilities.ts)
 *     → recognizes "This creature can't be blocked as long as it's attacking alone."
 *       and variant forms ("~ can't be blocked as long as ~ is attacking alone.")
 *     → returns StaticAbility { modifier: GrantKeyword('AttackingAloneEvasion'), selfOnly: true }
 *
 *   attackerHasAttackingAloneEvasion (keywords.ts)
 *     → called from canBlock; returns true iff oracle text matches AND
 *       state.combat.attackers.length === 1 (the creature IS attacking alone)
 *
 *   matchSelfCantBeBlockedActivated (pump-grants.ts)
 *     → extended to accept "it can't be blocked this combat" (Ma Chao triggered form)
 *
 * Oracle examples tested:
 *   Dream Prowler:      "This creature can't be blocked as long as it's attacking alone."
 *   Ma Chao (trigger):  "Whenever ~ attacks alone, it can't be blocked this combat."
 *   Tilde variant:      "~ can't be blocked as long as ~ is attacking alone."
 */

import { describe, it, expect } from 'vitest';
import { canBlock } from '../keywords';
import { canDeclareBlocker, declareAttackers, declareBlockers } from '../combat';
import { getCardsInZone, initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { parseOracleText } from '../effects/parser';
import type { CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function creature(
  id: string,
  opts: {
    oracle?: string;
    keywords?: string[];
    power?: number;
    toughness?: number;
  } = {},
): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Test',
    oracle_text: opts.oracle ?? '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: opts.keywords ?? [],
    card_types: ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

/**
 * p1 controls `attackerDef`; p2 controls `blockerDef`.
 * Both are on the battlefield and non-summoning-sick.
 * Static abilities are registered for both creatures exactly as ETB does.
 */
function setup(attackerDef: CardDefinition, blockerDef: CardDefinition) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: [attackerDef], commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [blockerDef], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);
  for (const [id, card] of state.cards) {
    state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
  }
  state = { ...state, phase: 'combat', step: 'declare_attackers' };

  // Register continuous static abilities (mirrors ETB pipeline)
  for (const c of [...state.cards.values()]) {
    if (c.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, c.instanceId);
    }
  }

  const attackerId = getCardsInZone(state, 'p1', 'battlefield')
    .find(c => state.cards.get(c.instanceId)!.definitionId === attackerDef.id)!.instanceId;
  const blockerId = getCardsInZone(state, 'p2', 'battlefield')
    .find(c => state.cards.get(c.instanceId)!.definitionId === blockerDef.id)!.instanceId;

  return { state, attackerId, blockerId };
}

// ---------------------------------------------------------------------------
// Parse tests
// ---------------------------------------------------------------------------

describe('slice8-attacking-alone-evasion: parser recognizes oracle forms', () => {

  it('Dream Prowler oracle: parses as StaticAbility with AttackingAloneEvasion keyword', () => {
    const result = parseOracleText("This creature can't be blocked as long as it's attacking alone.");
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.selfOnly).toBe(true);
    const mod = result.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind === 'GrantKeyword') {
      expect(mod.keyword.toLowerCase().replace(/[\s_-]/g, '')).toBe('attackingaloneevasion');
    }
  });

  it('Tilde form "~ can\'t be blocked as long as ~ is attacking alone." parses correctly', () => {
    const result = parseOracleText("~ can't be blocked as long as ~ is attacking alone.");
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.selfOnly).toBe(true);
    const mod = result.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind === 'GrantKeyword') {
      expect(mod.keyword.toLowerCase().replace(/[\s_-]/g, '')).toBe('attackingaloneevasion');
    }
  });

  it('"it is attacking alone" variant also parses', () => {
    const result = parseOracleText("This creature can't be blocked as long as it is attacking alone.");
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.selfOnly).toBe(true);
  });

  it('Ma Chao trigger form: "Whenever ~ attacks alone, it can\'t be blocked this combat." parses as Triggered', () => {
    const result = parseOracleText("Whenever ~ attacks alone, it can't be blocked this combat.");
    // Should parse as a triggered ability (Attacks{alone:true} prefix + cant-be-blocked body)
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const trigger = result.ability.trigger;
    expect(trigger.kind).toBe('Attacks');
    if (trigger.kind === 'Attacks') {
      expect(trigger.alone).toBe(true);
    }
    // Body should grant Unblockable (untilEndOfTurn)
    const effects = result.ability.effects;
    expect(effects.length).toBeGreaterThanOrEqual(1);
    const grantEffect = effects.find(e => e.kind === 'GrantKeyword');
    expect(grantEffect).toBeDefined();
    if (grantEffect && grantEffect.kind === 'GrantKeyword') {
      expect(grantEffect.keyword.toLowerCase()).toBe('unblockable');
      expect(grantEffect.untilEndOfTurn).toBe(true);
    }
  });

  it('does NOT parse "This creature can\'t be blocked as long as defending player controls an Island." as AttackingAloneEvasion (should be ConditionalEvasion)', () => {
    const result = parseOracleText("This creature can't be blocked as long as defending player controls an Island.");
    // Should be StaticAbility with ConditionalEvasion, not AttackingAloneEvasion
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    const mod = result.ability.modifier;
    if (mod.kind === 'GrantKeyword') {
      expect(mod.keyword.toLowerCase().replace(/[\s_-]/g, '')).not.toBe('attackingaloneevasion');
    }
  });
});

// ---------------------------------------------------------------------------
// Enforcement tests: canBlock + declareBlockers
// ---------------------------------------------------------------------------

describe('slice8-attacking-alone-evasion: enforcement via canBlock', () => {

  it('Dream Prowler: CANNOT be blocked when it is the sole attacker (attacking alone)', () => {
    const prowler = creature('dream-prowler', {
      oracle: "This creature can't be blocked as long as it's attacking alone.",
    });
    const normalBlocker = creature('bear', {});

    const { state, attackerId, blockerId } = setup(prowler, normalBlocker);

    // Declare only the prowler as attacker (alone)
    const declared = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerId, defendingPlayerId: 'p2' },
    ]);

    // canBlock should return false — it's attacking alone
    expect(canBlock(declared, blockerId, attackerId)).toBe(false);
    expect(canDeclareBlocker(declared, 'p2', blockerId, attackerId)).toBe(false);
    expect(() =>
      declareBlockers(declared, 'p2', [{ cardInstanceId: blockerId, blockingAttackerId: attackerId }]),
    ).toThrow();
  });

  it('Dream Prowler: CAN be blocked when it is NOT the sole attacker', () => {
    // Add a second attacker on p1's side
    const prowler = creature('dream-prowler', {
      oracle: "This creature can't be blocked as long as it's attacking alone.",
    });
    const sidekick = creature('sidekick', {});
    const normalBlocker = creature('bear', {});

    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [prowler, sidekick], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [normalBlocker], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    for (const [id, card] of state.cards) {
      state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
    }
    state = { ...state, phase: 'combat', step: 'declare_attackers' };
    for (const c of [...state.cards.values()]) {
      if (c.zone === 'battlefield') {
        state = registerContinuousAbilitiesForPermanent(state, c.instanceId);
      }
    }

    const prowlerId = getCardsInZone(state, 'p1', 'battlefield')
      .find(c => state.cards.get(c.instanceId)!.definitionId === prowler.id)!.instanceId;
    const sidekickId = getCardsInZone(state, 'p1', 'battlefield')
      .find(c => state.cards.get(c.instanceId)!.definitionId === sidekick.id)!.instanceId;
    const blockerId = getCardsInZone(state, 'p2', 'battlefield')
      .find(c => state.cards.get(c.instanceId)!.definitionId === normalBlocker.id)!.instanceId;

    // Declare BOTH as attackers — prowler is NOT attacking alone
    const declared = declareAttackers(state, 'p1', [
      { cardInstanceId: prowlerId, defendingPlayerId: 'p2' },
      { cardInstanceId: sidekickId, defendingPlayerId: 'p2' },
    ]);

    // The prowler IS blockable because it is not the sole attacker
    expect(canBlock(declared, blockerId, prowlerId)).toBe(true);
    expect(canDeclareBlocker(declared, 'p2', blockerId, prowlerId)).toBe(true);
  });

  it('normal creature has no attacking-alone evasion restriction (no false negatives)', () => {
    const normalAtt = creature('bear-att', {});
    const normalBlocker = creature('bear-blk', {});

    const { state, attackerId, blockerId } = setup(normalAtt, normalBlocker);
    const declared = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerId, defendingPlayerId: 'p2' },
    ]);
    expect(canBlock(declared, blockerId, attackerId)).toBe(true);
  });
});
