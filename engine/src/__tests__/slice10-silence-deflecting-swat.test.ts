/**
 * Slice 10 — Silence + Deflecting Swat
 *
 * Tests parse recognition and engine execution for:
 *  - Silence: "Your opponents can't cast spells this turn."
 *    - Parser emits OpponentsCantCastSpells effect
 *    - Executor registers a SpellCastProhibitionRef
 *    - canCastSpell returns false for prohibited players
 *    - canCastSpell returns true for the caster (not prohibited)
 *    - Prohibition expires at next turn
 *  - Deflecting Swat retargeting:
 *    "You may choose new targets for target spell or ability."
 *    - Parser emits ChangeSpellTargets effect with Spell + Any target specs
 *    - Executor rewrites targets on a single-target stack item
 *    - No-op for a multi-target spell (v1 honesty)
 *  - Deflecting Swat free-cast:
 *    "If you control a commander, you may cast this spell without paying its mana cost."
 *    - canCastSpell returns true with useFreeCast: true when commander is on battlefield
 *    - canCastSpell returns false with useFreeCast: true when commander is absent
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { canCastSpell, castSpell, resolveTopOfStack } from '../stack';
import { executeEffects } from '../effects/executor';
import type { GameState, CardDefinition } from '../types';
import { createPlayer } from '../types';
import { populateParsedCache } from '../cards/card-parser-cache';

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function createTestState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [
      { ...createPlayer('p1', 'Player 1'), manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 }, hasPriority: true },
      { ...createPlayer('p2', 'Player 2'), manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 }, hasPriority: false },
    ],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'main',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    damagePreventionEffects: [],
    gameOutcomePreventionEffects: [],
    spellCastProhibitions: [],
    ...overrides,
  };
}

function addCard(
  state: GameState,
  instanceId: string,
  ownerId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard' | 'command',
  defOverrides: Partial<CardDefinition>,
  opts: { isCommander?: boolean } = {},
): void {
  const baseDef: CardDefinition = {
    id: defOverrides.id ?? instanceId + '_def',
    name: defOverrides.name ?? 'Test Card',
    type_line: defOverrides.type_line ?? 'Instant',
    oracle_text: defOverrides.oracle_text ?? '',
    mana_cost: defOverrides.mana_cost ?? '{0}',
    cmc: defOverrides.cmc ?? 0,
    colors: defOverrides.colors ?? [],
    color_identity: defOverrides.color_identity ?? [],
    keywords: defOverrides.keywords ?? [],
    card_types: defOverrides.card_types ?? ['instant'],
    power: defOverrides.power,
    toughness: defOverrides.toughness,
  };
  const fullDef = populateParsedCache(baseDef);
  state.cardDefinitions.set(fullDef.id, fullDef);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: fullDef.id,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: opts.isCommander ?? false,
  });
  if (opts.isCommander) {
    const player = state.players.find(p => p.id === ownerId);
    if (player) {
      player.commanderInstanceId = instanceId;
      if (!player.commanderInstanceIds) player.commanderInstanceIds = [];
      player.commanderInstanceIds.push(instanceId);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Parser: Silence
// ---------------------------------------------------------------------------

describe('Silence — parser recognition', () => {
  it('parses "Your opponents can\'t cast spells this turn." as OpponentsCantCastSpells', () => {
    const result = parseOracleText("Your opponents can't cast spells this turn.");
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects.length).toBeGreaterThan(0);
    const effect = result.effects[0];
    expect(effect.kind).toBe('OpponentsCantCastSpells');
  });

  it('parses real Silence oracle text', () => {
    // Real oracle text: "Your opponents can't cast spells this turn."
    const result = parseOracleText("Your opponents can't cast spells this turn.");
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects.some(e => e.kind === 'OpponentsCantCastSpells')).toBe(true);
  });

  it('does not parse unrelated text as OpponentsCantCastSpells', () => {
    // A different "can't" effect — should not match the Silence pattern
    const result = parseOracleText("Target creature can't attack or block this turn.");
    // Whether it parses or not, it should not produce OpponentsCantCastSpells
    if (result.kind === 'Spell') {
      expect(result.effects.some(e => e.kind === 'OpponentsCantCastSpells')).toBe(false);
    } else {
      // Unparsed or some other kind is fine — just not a Silence effect
      expect(result.kind).not.toBe('OpponentsCantCastSpells');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Engine: Silence effect registration
// ---------------------------------------------------------------------------

describe('Silence — executor registers prohibition', () => {
  it('executeEffects for OpponentsCantCastSpells adds prohibition covering opponents', () => {
    const state = createTestState();
    const silenceEffect = { kind: 'OpponentsCantCastSpells' as const };
    // executeEffects(state, effects, casterId, chosenTargetIds, targetSpecs, xValue)
    const newState = executeEffects(state, [silenceEffect], 'p1', [], [], 0);
    const prohibitions = newState.spellCastProhibitions ?? [];
    expect(prohibitions.length).toBe(1);
    expect(prohibitions[0].prohibitedPlayerIds).toContain('p2');
    expect(prohibitions[0].prohibitedPlayerIds).not.toContain('p1');
    expect(prohibitions[0].expiresAtTurnNumber).toBe(state.turnNumber);
  });

  it('canCastSpell returns false for prohibited player', () => {
    const state = createTestState({
      spellCastProhibitions: [{
        id: 'test_prohibition',
        controllerId: 'p1',
        prohibitedPlayerIds: ['p2'],
        expiresAtTurnNumber: 1,
      }],
    });
    // p2 has a Lightning Bolt in hand
    addCard(state, 'bolt', 'p2', 'hand', {
      name: 'Lightning Bolt',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      mana_cost: '{R}',
      cmc: 1,
      card_types: ['instant'],
    });
    expect(canCastSpell(state, 'p2', 'bolt')).toBe(false);
  });

  it('canCastSpell still returns true for the caster (p1 not prohibited)', () => {
    const state = createTestState({
      spellCastProhibitions: [{
        id: 'test_prohibition',
        controllerId: 'p1',
        prohibitedPlayerIds: ['p2'],
        expiresAtTurnNumber: 1,
      }],
    });
    addCard(state, 'bolt_p1', 'p1', 'hand', {
      name: 'Lightning Bolt',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      mana_cost: '{R}',
      cmc: 1,
      card_types: ['instant'],
    });
    // p1 is not prohibited and has enough mana
    expect(canCastSpell(state, 'p1', 'bolt_p1')).toBe(true);
  });

  it('prohibition expires when turnNumber advances past expiresAtTurnNumber', () => {
    const state = createTestState({
      turnNumber: 2,
      spellCastProhibitions: [{
        id: 'test_prohibition',
        controllerId: 'p1',
        prohibitedPlayerIds: ['p2'],
        expiresAtTurnNumber: 1, // expired — was turn 1
      }],
    });
    addCard(state, 'bolt', 'p2', 'hand', {
      name: 'Lightning Bolt',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      mana_cost: '{R}',
      cmc: 1,
      card_types: ['instant'],
    });
    // Turn 1 prohibition has expired, p2 can now cast
    expect(canCastSpell(state, 'p2', 'bolt')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Parser: Deflecting Swat retargeting
// ---------------------------------------------------------------------------

describe('Deflecting Swat — retarget parser recognition', () => {
  it('parses "You may choose new targets for target spell or ability." as ChangeSpellTargets', () => {
    const result = parseOracleText("You may choose new targets for target spell or ability.");
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const effect = result.effects.find(e => e.kind === 'ChangeSpellTargets');
    expect(effect).toBeDefined();
  });

  it('emits two target specs: one Spell and one Any', () => {
    const result = parseOracleText("You may choose new targets for target spell or ability.");
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const specs = result.targets;
    expect(specs.length).toBeGreaterThanOrEqual(2);
    const spellSpec = specs.find(s => s.type === 'Spell');
    const anySpec = specs.find(s => s.type === 'Any');
    expect(spellSpec).toBeDefined();
    expect(anySpec).toBeDefined();
  });

  it('parses Deflecting Swat full oracle body', () => {
    const oracle = "If you control a commander, you may cast this spell without paying its mana cost.\nYou may choose new targets for target spell or ability.";
    const result = parseOracleText(oracle);
    // The full body has an "if you control a commander" line plus the retarget line.
    // At minimum the retarget part should produce a ChangeSpellTargets effect.
    if (result.kind === 'Spell') {
      expect(result.effects.some(e => e.kind === 'ChangeSpellTargets')).toBe(true);
    }
    // If it parses as a conditional spell, still valid — just confirm no Unparsed
    expect(result.kind).not.toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// 4. Engine: ChangeSpellTargets rewrites single-target spell
// ---------------------------------------------------------------------------

describe('Deflecting Swat — ChangeSpellTargets executor', () => {
  it('rewrites targets on a single-target spell stack item', () => {
    const state = createTestState();

    // Simulate a spell on the stack targeting creature_p1
    const stackState: GameState = {
      ...state,
      stack: [{
        kind: 'Spell',
        id: 'stack_bolt',
        cardInstanceId: 'nonexistent_bolt',
        casterId: 'p2',
        targets: ['creature_p1'],
        castFromZone: 'hand',
      }],
    };

    // Execute ChangeSpellTargets: redirect to player 'p2'.
    // The target spec ids need to match what the parser produces, but for
    // direct executor tests we pass the chosen target ids in order and use
    // matching spec descriptors.
    const spellSpec = { id: 'spec_spell', count: 1 };
    const newTargetSpec = { id: 'spec_new', count: 1 };
    const changeEffect = {
      kind: 'ChangeSpellTargets' as const,
      target: { kind: 'Chosen' as const, targetId: 'spec_spell' },
      newTarget: { kind: 'Chosen' as const, targetId: 'spec_new' },
    };

    // chosenTargetIds: [spell target id, new target id]
    const newState = executeEffects(
      stackState,
      [changeEffect],
      'p1',
      ['stack_bolt', 'p2'],
      [spellSpec, newTargetSpec],
      0,
    );
    const newStackItem = newState.stack[0];
    expect(newStackItem.targets).toEqual(['p2']);
  });

  it('no-ops for a multi-target spell (v1 honesty)', () => {
    const state = createTestState();
    // Spell with 2 targets
    const stackState: GameState = {
      ...state,
      stack: [{
        kind: 'Spell',
        id: 'stack_multi',
        cardInstanceId: 'multi_target_spell',
        casterId: 'p2',
        targets: ['creature1', 'creature2'],
        castFromZone: 'hand',
      }],
    };

    const spellSpec = { id: 'spec_spell', count: 1 };
    const newTargetSpec = { id: 'spec_new', count: 1 };
    const changeEffect = {
      kind: 'ChangeSpellTargets' as const,
      target: { kind: 'Chosen' as const, targetId: 'spec_spell' },
      newTarget: { kind: 'Chosen' as const, targetId: 'spec_new' },
    };
    const newState = executeEffects(
      stackState,
      [changeEffect],
      'p1',
      ['stack_multi', 'p1'],
      [spellSpec, newTargetSpec],
      0,
    );
    // Multi-target: no-op, targets unchanged
    expect(newState.stack[0].targets).toEqual(['creature1', 'creature2']);
  });
});

// ---------------------------------------------------------------------------
// 5. Deflecting Swat free-cast condition
// ---------------------------------------------------------------------------

describe('Deflecting Swat — free-cast when controlling a commander', () => {
  it('canCastSpell with useFreeCast: true succeeds when commander is on battlefield', () => {
    const state = createTestState();
    // p1 controls a commander on the battlefield
    addCard(state, 'commander_card', 'p1', 'battlefield', {
      id: 'commander_def',
      name: 'Test Commander',
      type_line: 'Legendary Creature — Human',
      oracle_text: '',
      mana_cost: '{G}{G}{G}',
      cmc: 3,
      card_types: ['creature'],
      power: 3,
      toughness: 3,
    }, { isCommander: true });

    // p1 has Deflecting Swat in hand
    addCard(state, 'swat_card', 'p1', 'hand', {
      id: 'deflecting_swat_def',
      name: 'Deflecting Swat',
      type_line: 'Instant',
      oracle_text:
        "If you control a commander, you may cast this spell without paying its mana cost.\n" +
        "You may choose new targets for target spell or ability.",
      mana_cost: '{2}{R}',
      cmc: 3,
      card_types: ['instant'],
    });

    // Player has no mana but useFreeCast means mana cost is zeroed
    const poorPlayer = state.players.find(p => p.id === 'p1')!;
    poorPlayer.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

    // With useFreeCast: commander is on battlefield → cost is 0 → can cast
    expect(canCastSpell(state, 'p1', 'swat_card', { useFreeCast: true })).toBe(true);
  });

  it('canCastSpell with useFreeCast: true fails when commander is absent', () => {
    const state = createTestState();
    // No commander on battlefield for p1
    addCard(state, 'swat_card', 'p1', 'hand', {
      id: 'deflecting_swat_def',
      name: 'Deflecting Swat',
      type_line: 'Instant',
      oracle_text:
        "If you control a commander, you may cast this spell without paying its mana cost.\n" +
        "You may choose new targets for target spell or ability.",
      mana_cost: '{2}{R}',
      cmc: 3,
      card_types: ['instant'],
    });

    const poorPlayer = state.players.find(p => p.id === 'p1')!;
    poorPlayer.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

    // No commander → free-cast condition fails → still needs to pay {2}{R} → can't cast
    expect(canCastSpell(state, 'p1', 'swat_card', { useFreeCast: true })).toBe(false);
  });
});
