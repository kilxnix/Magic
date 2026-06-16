/**
 * Slice 10 — "Next N damage" prevention shields
 *
 * Parser coverage (prevention-only subset):
 *   - "Prevent the next N damage that would be dealt to enchanted creature this turn."
 *     → PreventDamage { target: SourceAttachedTo, amount: N }
 *   - "Prevent the next N damage that would be dealt to this creature this turn."
 *     → PreventDamage { target: Source, amount: N } (also as activated ability)
 *   - "{W}: Prevent the next 1 damage that would be dealt to target creature or player this turn."
 *     → already-supported form; regression guard
 *   - "{0}: Prevent the next 1 damage that would be dealt to this creature this turn."
 *     → Activated ability form with Source target
 *
 * Execution coverage:
 *   - Source prevention: the prevention shield targets the source card itself;
 *     damage to sourceInstanceId is reduced.
 *   - SourceAttachedTo prevention: prevention shield targets the card the Aura
 *     is attached to; damage to attachedTo creature is reduced.
 *   - Unrelated damage events are not prevented (shield is target-scoped).
 *
 * Decline coverage (honesty bar):
 *   - "The next N damage that would be dealt to this creature this turn is dealt
 *     to target creature you control instead." stays Unparsed (redirection —
 *     DamagePreventionEffectRef has no redirectToId; engine cannot move damage).
 *   - "The next N damage that would be dealt to enchanted creature this turn is
 *     dealt to any target instead." stays Unparsed (same reason).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { applyDamageReplacementEffects } from '../effects/replacement';
import type { GameState, CardInstance, CardDefinition } from '../types';
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
  opts: { attachedTo?: string } = {},
): void {
  const baseDef: CardDefinition = {
    id: defOverrides.id ?? instanceId + '_def',
    name: defOverrides.name ?? 'Test Card',
    type_line: defOverrides.type_line ?? 'Enchantment',
    oracle_text: defOverrides.oracle_text ?? '',
    mana_cost: defOverrides.mana_cost ?? '{0}',
    cmc: defOverrides.cmc ?? 0,
    colors: defOverrides.colors ?? [],
    color_identity: defOverrides.color_identity ?? [],
    keywords: defOverrides.keywords ?? [],
    card_types: defOverrides.card_types ?? ['enchantment'],
    power: defOverrides.power,
    toughness: defOverrides.toughness,
  };
  const fullDef = populateParsedCache(baseDef);
  state.cardDefinitions.set(fullDef.id, fullDef);
  const inst: CardInstance = {
    instanceId,
    definitionId: fullDef.id,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
  if (opts.attachedTo) inst.attachedTo = opts.attachedTo;
  state.cards.set(instanceId, inst);
}

// ---------------------------------------------------------------------------
// 1. Parser: "Prevent the next N damage ... to enchanted creature this turn."
// ---------------------------------------------------------------------------

describe('prevention shields — enchanted creature target', () => {
  it('parses as PreventDamage with SourceAttachedTo target', () => {
    const result = parseOracleText(
      'Prevent the next 1 damage that would be dealt to enchanted creature this turn.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0];
    expect(eff.kind).toBe('PreventDamage');
    if (eff.kind !== 'PreventDamage') return;
    expect(eff.amount).toBe(1);
    expect(eff.target).toEqual({ kind: 'SourceAttachedTo' });
    expect(eff.combatOnly).toBe(false);
  });

  it('parses "enchanted permanent" form as SourceAttachedTo', () => {
    const result = parseOracleText(
      'Prevent the next 2 damage that would be dealt to enchanted permanent this turn.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0];
    expect(eff.kind).toBe('PreventDamage');
    if (eff.kind !== 'PreventDamage') return;
    expect(eff.amount).toBe(2);
    expect(eff.target).toEqual({ kind: 'SourceAttachedTo' });
  });

  it('parses larger N correctly for enchanted creature', () => {
    const result = parseOracleText(
      'Prevent the next 3 damage that would be dealt to enchanted creature this turn.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0];
    expect(eff.kind).toBe('PreventDamage');
    if (eff.kind !== 'PreventDamage') return;
    expect(eff.amount).toBe(3);
    expect(eff.target).toEqual({ kind: 'SourceAttachedTo' });
  });
});

// ---------------------------------------------------------------------------
// 2. Parser: "Prevent the next N damage ... to this creature this turn."
// ---------------------------------------------------------------------------

describe('prevention shields — this creature (Source) target', () => {
  it('parses "this creature" as Source target in spell form', () => {
    const result = parseOracleText(
      'Prevent the next 1 damage that would be dealt to this creature this turn.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0];
    expect(eff.kind).toBe('PreventDamage');
    if (eff.kind !== 'PreventDamage') return;
    expect(eff.amount).toBe(1);
    expect(eff.target).toEqual({ kind: 'Source' });
    expect(eff.combatOnly).toBe(false);
  });

  it('parses "{0}: Prevent the next 1 damage ... to this creature" as Activated ability', () => {
    // Warrior en-Kor family: self-prevention activated ability
    const result = parseOracleText(
      '{0}: Prevent the next 1 damage that would be dealt to this creature this turn.',
    );
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    expect(result.abilities).toHaveLength(1);
    const ab = result.abilities[0];
    expect(ab.cost.mana).toBe('{0}');
    const eff = ab.effects[0];
    expect(eff.kind).toBe('PreventDamage');
    if (eff.kind !== 'PreventDamage') return;
    expect(eff.amount).toBe(1);
    expect(eff.target).toEqual({ kind: 'Source' });
  });

  it('parses "{W}: Prevent the next 1 damage ... to this creature" with mana cost', () => {
    const result = parseOracleText(
      '{W}: Prevent the next 1 damage that would be dealt to this creature this turn.',
    );
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    const ab = result.abilities[0];
    // The tokenizer lowercases mana symbols; accept '{w}' or '{W}'
    expect(ab.cost.mana?.toLowerCase()).toBe('{w}');
    const eff = ab.effects[0];
    expect(eff.kind).toBe('PreventDamage');
    if (eff.kind !== 'PreventDamage') return;
    expect(eff.target).toEqual({ kind: 'Source' });
  });
});

// ---------------------------------------------------------------------------
// 3. Execution: Source (self-prevention)
// ---------------------------------------------------------------------------

describe('prevention shields — executor Source target', () => {
  it('registers a protectedTargetId equal to sourceInstanceId', () => {
    const state = createTestState();
    addCard(state, 'creature_1', 'p1', 'battlefield', {
      name: 'Test Creature',
      type_line: 'Creature',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    const preventEffect = {
      kind: 'PreventDamage' as const,
      target: { kind: 'Source' as const },
      amount: 1 as const,
      combatOnly: false,
      duration: 'turn' as const,
    };

    const newState = executeEffects(
      state,
      [preventEffect],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: 'creature_1' },
    );

    const shields = newState.damagePreventionEffects ?? [];
    expect(shields).toHaveLength(1);
    // The shield must be targeted at the source creature, not global
    expect(shields[0].protectedTargetId).toBe('creature_1');
    expect(shields[0].amount).toBe(1);
  });

  it('Source shield prevents damage dealt to sourceInstanceId', () => {
    const state = createTestState();
    addCard(state, 'creature_1', 'p1', 'battlefield', {
      name: 'Test Creature',
      type_line: 'Creature',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    const preventEffect = {
      kind: 'PreventDamage' as const,
      target: { kind: 'Source' as const },
      amount: 1 as const,
      combatOnly: false,
      duration: 'turn' as const,
    };

    const stateWithShield = executeEffects(
      state,
      [preventEffect],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: 'creature_1' },
    );

    const damageEvent = {
      type: 'DamageDealt' as const,
      targetId: 'creature_1',
      amount: 3,
      isCombatDamage: false,
    };
    const result = applyDamageReplacementEffects(stateWithShield, damageEvent);
    // 3 damage - 1 shield = 2 remaining
    expect(result.event).not.toBeNull();
    expect(result.event?.amount).toBe(2);
  });

  it('Source shield does NOT prevent damage to a different creature', () => {
    const state = createTestState();
    addCard(state, 'creature_1', 'p1', 'battlefield', {
      name: 'Shield Holder',
      type_line: 'Creature',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });
    addCard(state, 'creature_2', 'p2', 'battlefield', {
      name: 'Other Creature',
      type_line: 'Creature',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    const preventEffect = {
      kind: 'PreventDamage' as const,
      target: { kind: 'Source' as const },
      amount: 1 as const,
      combatOnly: false,
      duration: 'turn' as const,
    };

    const stateWithShield = executeEffects(
      state,
      [preventEffect],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: 'creature_1' },
    );

    // Damage to creature_2 — shield protects creature_1, not creature_2
    const damageEvent = {
      type: 'DamageDealt' as const,
      targetId: 'creature_2',
      amount: 3,
      isCombatDamage: false,
    };
    const result = applyDamageReplacementEffects(stateWithShield, damageEvent);
    // Full 3 damage should go through
    expect(result.event).not.toBeNull();
    expect(result.event?.amount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Execution: SourceAttachedTo (enchanted creature prevention)
// ---------------------------------------------------------------------------

describe('prevention shields — executor SourceAttachedTo target', () => {
  it('registers a protectedTargetId equal to the attached creature', () => {
    const state = createTestState();
    // The protected creature
    addCard(state, 'creature_1', 'p1', 'battlefield', {
      name: 'Protected Creature',
      type_line: 'Creature',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });
    // The Aura attached to creature_1
    addCard(state, 'aura_1', 'p1', 'battlefield', {
      name: 'Protective Aura',
      type_line: 'Enchantment — Aura',
      card_types: ['enchantment'],
    }, { attachedTo: 'creature_1' });

    const preventEffect = {
      kind: 'PreventDamage' as const,
      target: { kind: 'SourceAttachedTo' as const },
      amount: 2 as const,
      combatOnly: false,
      duration: 'turn' as const,
    };

    const newState = executeEffects(
      state,
      [preventEffect],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: 'aura_1' },
    );

    const shields = newState.damagePreventionEffects ?? [];
    expect(shields).toHaveLength(1);
    // Shield must target the creature the Aura is attached to
    expect(shields[0].protectedTargetId).toBe('creature_1');
    expect(shields[0].amount).toBe(2);
  });

  it('SourceAttachedTo shield prevents damage to the attached creature', () => {
    const state = createTestState();
    addCard(state, 'creature_1', 'p1', 'battlefield', {
      name: 'Protected Creature',
      type_line: 'Creature',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });
    addCard(state, 'aura_1', 'p1', 'battlefield', {
      name: 'Protective Aura',
      type_line: 'Enchantment — Aura',
      card_types: ['enchantment'],
    }, { attachedTo: 'creature_1' });

    const preventEffect = {
      kind: 'PreventDamage' as const,
      target: { kind: 'SourceAttachedTo' as const },
      amount: 2 as const,
      combatOnly: false,
      duration: 'turn' as const,
    };

    const stateWithShield = executeEffects(
      state,
      [preventEffect],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: 'aura_1' },
    );

    const damageEvent = {
      type: 'DamageDealt' as const,
      targetId: 'creature_1',
      amount: 5,
      isCombatDamage: false,
    };
    const result = applyDamageReplacementEffects(stateWithShield, damageEvent);
    // 5 damage - 2 shield = 3 remaining
    expect(result.event).not.toBeNull();
    expect(result.event?.amount).toBe(3);
  });

  it('SourceAttachedTo shield no-ops when Aura is not attached to anything', () => {
    const state = createTestState();
    // Aura not attached to anything (attachedTo is undefined)
    addCard(state, 'aura_unattached', 'p1', 'battlefield', {
      name: 'Floating Aura',
      type_line: 'Enchantment — Aura',
      card_types: ['enchantment'],
    });

    const preventEffect = {
      kind: 'PreventDamage' as const,
      target: { kind: 'SourceAttachedTo' as const },
      amount: 1 as const,
      combatOnly: false,
      duration: 'turn' as const,
    };

    const newState = executeEffects(
      state,
      [preventEffect],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: 'aura_unattached' },
    );

    const shields = newState.damagePreventionEffects ?? [];
    // Shield registered but protectedTargetId is undefined (no-op for damage events
    // to specific targets, but we check it gracefully returns a shield entry)
    // The shield is registered; amount matches
    expect(shields[0]?.amount).toBe(1);
    // protectedTargetId is undefined (no creature attached)
    expect(shields[0]?.protectedTargetId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Decline/parse coverage: redirection forms (Slice 12 update)
// ---------------------------------------------------------------------------

describe('prevention shields — redirection forms (Slice 12)', () => {
  it('en-Kor style redirect "dealt to target creature instead" now parses as RedirectDamage', () => {
    // Slice 12: Warrior en-Kor family — redirectToId support added, this now parses.
    const result = parseOracleText(
      'The next 1 damage that would be dealt to this creature this turn is dealt to target creature you control instead.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0];
    expect(eff.kind).toBe('RedirectDamage');
    if (eff.kind !== 'RedirectDamage') return;
    expect(eff.amount).toBe(1);
    expect(eff.source).toBe('Source');
    // redirectTarget is a Chosen ref to the target creature spec
    expect(eff.redirectTarget.kind).toBe('Chosen');
  });

  it('Ward of Piety style "dealt to any target instead" stays Unparsed (non-creature redirect)', () => {
    // We only claim creature-redirect (en-Kor family); "any target" redirect is not claimed.
    const result = parseOracleText(
      '{1}{W}: The next 1 damage that would be dealt to enchanted creature this turn is dealt to any target instead.',
    );
    expect(result.kind).toBe('Unparsed');
  });

  it('Daughter of Autumn style "dealt to named card instead" stays Unparsed', () => {
    const result = parseOracleText(
      '{W}: The next 1 damage that would be dealt to target white creature this turn is dealt to ~ instead.',
    );
    expect(result.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// 6. Regression guard: existing prevention forms still work
// ---------------------------------------------------------------------------

describe('prevention shields — regression: existing forms unaffected', () => {
  it('"prevent all damage that would be dealt to you this turn" still works', () => {
    const result = parseOracleText(
      'Prevent all damage that would be dealt to you this turn.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0];
    expect(eff.kind).toBe('PreventDamage');
    if (eff.kind !== 'PreventDamage') return;
    expect(eff.amount).toBe('all');
    expect(eff.target).toEqual({ kind: 'Controller' });
  });

  it('"prevent the next 3 damage that would be dealt to target creature this turn" still works', () => {
    const result = parseOracleText(
      'Prevent the next 3 damage that would be dealt to target creature this turn.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0];
    expect(eff.kind).toBe('PreventDamage');
    if (eff.kind !== 'PreventDamage') return;
    expect(eff.amount).toBe(3);
    // Target is a Chosen spec (requires explicit target choice)
    expect(eff.target?.kind).toBe('Chosen');
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Creature');
  });

  it('"prevent all combat damage that would be dealt this turn" still works', () => {
    const result = parseOracleText(
      'Prevent all combat damage that would be dealt this turn.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0];
    expect(eff.kind).toBe('PreventDamage');
    if (eff.kind !== 'PreventDamage') return;
    expect(eff.amount).toBe('all');
    expect(eff.combatOnly).toBe(true);
  });
});
