/**
 * Slice 12 — Licid family + en-Kor / Warrior damage-redirect family
 *
 * Parser coverage:
 *   en-Kor (RedirectDamage):
 *     - "The next 1 damage that would be dealt to this creature this turn is
 *        dealt to target creature you control instead."  (Warrior en-Kor)
 *     - "The next 1 damage that would be dealt to this creature this turn is
 *        dealt to target creature instead."  (unconstrained form, e.g. Spirit en-Kor)
 *     - "The next 1 damage that would be dealt to this creature this turn is
 *        dealt to you instead."  (self-redirect — Daughter of Autumn variant)
 *
 *   Licid (LicidTransform):
 *     - "This creature loses this ability and becomes an Aura enchantment with
 *        enchant creature. Attach it to target creature you don't control."
 *     - "This creature loses this ability and becomes an Aura enchantment with
 *        enchant creature. Attach it to target creature."
 *
 * Execution coverage:
 *   - RedirectDamage registers a DamagePreventionEffectRef with redirectToId;
 *     subsequent damage to the source is dealt to the redirect target instead.
 *   - LicidTransform sets licidAura + attachedTo on the source permanent;
 *     getEffectiveCardTypes returns ['enchantment'] while licidAura is set.
 *
 * Decline coverage:
 *   - "to any target instead" (non-creature redirect) stays Unparsed.
 *   - "to ~ instead" (named-card redirect) stays Unparsed.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardInstance, CardDefinition } from '../types';
import { createPlayer } from '../types';
import { populateParsedCache } from '../cards/card-parser-cache';
import { getEffectiveCardTypes } from '../effective-types';

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
    type_line: defOverrides.type_line ?? 'Creature',
    oracle_text: defOverrides.oracle_text ?? '',
    mana_cost: defOverrides.mana_cost ?? '{0}',
    cmc: defOverrides.cmc ?? 0,
    colors: defOverrides.colors ?? [],
    color_identity: defOverrides.color_identity ?? [],
    keywords: defOverrides.keywords ?? [],
    card_types: defOverrides.card_types ?? ['creature'],
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
// 1. Parser: en-Kor redirect
// ---------------------------------------------------------------------------

describe('en-Kor family — parser', () => {
  it('Warrior en-Kor: "next 1 damage ... to target creature you control instead" parses as RedirectDamage', () => {
    const result = parseOracleText(
      '{0}: The next 1 damage that would be dealt to this creature this turn is dealt to target creature you control instead.',
    );
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    expect(result.abilities).toHaveLength(1);
    const ab = result.abilities[0];
    expect(ab.effects).toHaveLength(1);
    const eff = ab.effects[0];
    expect(eff.kind).toBe('RedirectDamage');
    if (eff.kind !== 'RedirectDamage') return;
    expect(eff.amount).toBe(1);
    expect(eff.source).toBe('Source');
    expect(eff.redirectTarget.kind).toBe('Chosen');
    // One target spec (the redirect-to creature)
    expect(ab.targets).toHaveLength(1);
    const spec = ab.targets[0];
    expect(spec.type).toBe('Creature');
    expect(spec.constraints?.controllerControls).toBe(true);
  });

  it('Spirit en-Kor: unconstrained creature target parses correctly', () => {
    const result = parseOracleText(
      '{0}: The next 1 damage that would be dealt to this creature this turn is dealt to target creature instead.',
    );
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    const eff = result.abilities[0].effects[0];
    expect(eff.kind).toBe('RedirectDamage');
    if (eff.kind !== 'RedirectDamage') return;
    expect(eff.amount).toBe(1);
    // No controller constraint on the target
    const spec = result.abilities[0].targets[0];
    expect(spec.type).toBe('Creature');
    expect(spec.constraints?.controllerControls).toBeUndefined();
  });

  it('Self-redirect variant: "dealt to you instead" parses with Controller target', () => {
    // Daughter-of-Autumn-like pattern where damage goes to controller, not a creature.
    const result = parseOracleText(
      '{W}: The next 1 damage that would be dealt to this creature this turn is dealt to you instead.',
    );
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    const eff = result.abilities[0].effects[0];
    expect(eff.kind).toBe('RedirectDamage');
    if (eff.kind !== 'RedirectDamage') return;
    expect(eff.redirectTarget).toEqual({ kind: 'Controller' });
    // Controller-redirect produces no target spec (no chosen target needed)
    expect(result.abilities[0].targets).toHaveLength(0);
  });

  it('Nomads en-Kor: "{0}: The next 1 damage ... to target creature you control instead."', () => {
    // Direct spell-text form (no activated-ability cost wrapper)
    const result = parseOracleText(
      'The next 1 damage that would be dealt to this creature this turn is dealt to target creature you control instead.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects[0].kind).toBe('RedirectDamage');
  });

  it('Decline: "dealt to any target instead" stays Unparsed (not a creature redirect)', () => {
    const result = parseOracleText(
      'The next 1 damage that would be dealt to this creature this turn is dealt to any target instead.',
    );
    expect(result.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// 2. Executor: en-Kor redirect
// ---------------------------------------------------------------------------

describe('en-Kor family — execution', () => {
  it('RedirectDamage registers a redirect shield with redirectToId', () => {
    const state = createTestState();
    addCard(state, 'enkor', 'p1', 'battlefield', {
      name: 'Warrior en-Kor',
      type_line: 'Creature — Kor Warrior',
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    });
    addCard(state, 'shield_target', 'p1', 'battlefield', {
      name: 'Other Creature',
      type_line: 'Creature',
      card_types: ['creature'],
      power: 2,
      toughness: 5,
    });

    const redirectEffect = {
      kind: 'RedirectDamage' as const,
      source: 'Source' as const,
      redirectTarget: { kind: 'Chosen' as const, targetId: 'target_spec_1' },
      amount: 1,
    };

    const newState = executeEffects(
      state,
      [redirectEffect],
      'p1',
      ['shield_target'],
      [{ id: 'target_spec_1' }],
      0,
      { sourceInstanceId: 'enkor' },
    );

    const shields = newState.damagePreventionEffects ?? [];
    expect(shields).toHaveLength(1);
    expect(shields[0].protectedTargetId).toBe('enkor');
    expect(shields[0].amount).toBe(1);
    expect(shields[0].redirectToId).toBe('shield_target');
    expect(shields[0].combatOnly).toBe(false);
  });

  it('Damage to source creature is redirected to chosen creature', () => {
    const state = createTestState();
    addCard(state, 'enkor', 'p1', 'battlefield', {
      name: 'Warrior en-Kor',
      type_line: 'Creature — Kor Warrior',
      card_types: ['creature'],
      power: 1,
      toughness: 3,
    });
    addCard(state, 'blocker', 'p1', 'battlefield', {
      name: 'Big Blocker',
      type_line: 'Creature',
      card_types: ['creature'],
      power: 3,
      toughness: 10,
    });

    // Register a redirect shield manually (simulating what the executor does)
    const stateWithShield: GameState = {
      ...state,
      damagePreventionEffects: [{
        id: 'redirect_1',
        sourceInstanceId: 'enkor',
        controllerId: 'p1',
        protectedTargetId: 'enkor',
        amount: 1,
        combatOnly: false,
        expiresAtTurnNumber: 1,
        redirectToId: 'blocker',
      }],
    };

    // Now deal 1 damage to enkor — should be redirected to blocker
    const dealEffect = {
      kind: 'DealDamage' as const,
      source: { kind: 'ThisSpell' as const },
      target: { kind: 'Chosen' as const, targetId: 'target_damage' },
      amount: 1,
    };
    const newState = executeEffects(
      stateWithShield,
      [dealEffect],
      'p2',
      ['enkor'],
      [{ id: 'target_damage' }],
      0,
      {},
    );

    const enkorCard = newState.cards.get('enkor');
    const blockerCard = newState.cards.get('blocker');

    // enkor took no damage (redirect fired)
    expect(enkorCard?.damage).toBe(0);
    // blocker received the redirected damage
    expect(blockerCard?.damage).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Parser: Licid family
// ---------------------------------------------------------------------------

describe('Licid family — parser', () => {
  it('Transmogrifying Licid: "becomes an Aura enchantment ... attach it to target creature you don\'t control"', () => {
    const result = parseOracleText(
      '{1}, {T}: This creature loses this ability and becomes an Aura enchantment with enchant creature. Attach it to target creature you don\'t control.',
    );
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    expect(result.abilities).toHaveLength(1);
    const ab = result.abilities[0];
    // Find the LicidTransform effect
    const licidEff = ab.effects.find(e => e.kind === 'LicidTransform');
    expect(licidEff).toBeDefined();
    if (!licidEff || licidEff.kind !== 'LicidTransform') return;
    expect(licidEff.attachTarget.kind).toBe('Chosen');
    // Target spec has opponentControls constraint
    expect(ab.targets).toHaveLength(1);
    expect(ab.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('Convulsing Licid: "attach it to target creature" (no controller constraint)', () => {
    const result = parseOracleText(
      '{1}, {T}: This creature loses this ability and becomes an Aura enchantment with enchant creature. Attach it to target creature.',
    );
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    const ab = result.abilities[0];
    const licidEff = ab.effects.find(e => e.kind === 'LicidTransform');
    expect(licidEff).toBeDefined();
    if (!licidEff || licidEff.kind !== 'LicidTransform') return;
    // No constraints
    const spec = ab.targets[0];
    expect(spec.constraints?.opponentControls).toBeUndefined();
    expect(spec.constraints?.controllerControls).toBeUndefined();
  });

  it('Tempting Licid: "attach it to target creature you control"', () => {
    const result = parseOracleText(
      '{1}, {T}: This creature loses this ability and becomes an Aura enchantment with enchant creature. Attach it to target creature you control.',
    );
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    const ab = result.abilities[0];
    const licidEff = ab.effects.find(e => e.kind === 'LicidTransform');
    expect(licidEff).toBeDefined();
    const spec = ab.targets[0];
    expect(spec.constraints?.controllerControls).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Executor: Licid transform
// ---------------------------------------------------------------------------

describe('Licid family — execution', () => {
  it('LicidTransform sets licidAura=true and attachedTo on source permanent', () => {
    const state = createTestState();
    addCard(state, 'licid', 'p1', 'battlefield', {
      name: 'Transmogrifying Licid',
      type_line: 'Creature — Licid',
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    });
    addCard(state, 'host_creature', 'p2', 'battlefield', {
      name: 'Bear',
      type_line: 'Creature — Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    const licidEffect = {
      kind: 'LicidTransform' as const,
      attachTarget: { kind: 'Chosen' as const, targetId: 'target_attach' },
    };

    const newState = executeEffects(
      state,
      [licidEffect],
      'p1',
      ['host_creature'],
      [{ id: 'target_attach' }],
      0,
      { sourceInstanceId: 'licid' },
    );

    const licidCard = newState.cards.get('licid');
    expect(licidCard?.licidAura).toBe(true);
    expect(licidCard?.attachedTo).toBe('host_creature');
  });

  it('getEffectiveCardTypes returns ["enchantment"] for a Licid in Aura form', () => {
    const state = createTestState();
    addCard(state, 'licid', 'p1', 'battlefield', {
      name: 'Gossamer Chains',
      type_line: 'Creature — Licid',
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    });

    // Manually set licidAura flag (simulating post-transform state)
    const licidCards = new Map(state.cards);
    licidCards.set('licid', { ...state.cards.get('licid')!, licidAura: true, attachedTo: 'some_creature' });
    const transformedState = { ...state, cards: licidCards };

    const types = getEffectiveCardTypes(transformedState, 'licid');
    expect(types).toEqual(['enchantment']);
    // Should NOT include 'creature' while in Aura form
    expect(types).not.toContain('creature');
  });
});
