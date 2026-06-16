/**
 * slice12-equipment-becomes-attached-choose-color.test.ts
 *
 * Oracle-parser coverage slice 12 — As-becomes-attached choose-color statics
 * on Equipment + protection-from-chosen rider.
 *
 * Scope:
 *   1. step-1c absorber extended to recognise
 *      "As this Equipment becomes attached to a creature, choose a color/creature type."
 *      (Equipment-specific attach-time declaration, distinct from the ETB form).
 *
 *   2. Companion "Equipped creature gets +N/+N and has protection from the chosen color."
 *      is parsed via matchAttachedStaticBuff (PT modifier recognised, attachedOnly flag
 *      set) while keywords.ts getProtectionColors / protectionClausesFor enforces the
 *      protection rider via the equipment's choices.chosenColor.
 *
 *   3. Execution: isProtectedFromSource returns true for sources matching the chosen
 *      color on the attached equipment.
 *
 * Real oracle wordings tested:
 *   Sanctuary Blade:
 *     "As this Equipment becomes attached to a creature, choose a color.
 *      Equipped creature gets +2/+0 and has protection from the chosen color."
 *   (choose-creature-type variant):
 *     "As this Equipment becomes attached to a creature, choose a creature type.
 *      Equipped creature has protection from the chosen creature type."
 *   (Equip cost absorption alongside the choose declaration):
 *     Full Sanctuary Blade oracle with Equip line absorbed as a keyword.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { isProtectedFromSource } from '../keywords';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

// ============================================================================
// Helpers
// ============================================================================

function makePlayer(id: string): Player {
  return {
    id, name: id, life: 40,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false, hasPriority: false, hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  extra: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    ...extra,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Artifact — Equipment',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['artifact'],
    power: opts.power ?? undefined,
    toughness: opts.toughness ?? undefined,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: overrides.players ?? [makePlayer('p1'), makePlayer('p2')],
    cards: overrides.cards ?? new Map(),
    cardDefinitions: overrides.cardDefinitions ?? new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'main1',
    step: 'none',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: overrides.continuousEffects ?? [],
  };
}

// ============================================================================
// Sanctuary Blade oracle (exact real wording, ~ substituted for card name)
// ============================================================================

const SANCTUARY_BLADE_ORACLE =
  'As this Equipment becomes attached to a creature, choose a color.\n' +
  'Equipped creature gets +2/+0 and has protection from the chosen color.';

// Full oracle with Equip cost (the equip line is absorbed as a parametric keyword).
const SANCTUARY_BLADE_FULL =
  'As this Equipment becomes attached to a creature, choose a color.\n' +
  'Equipped creature gets +2/+0 and has protection from the chosen color.\n' +
  'Equip {2}{W}';

// ============================================================================
// 1. Parse: "As this Equipment becomes attached to a creature, choose a color."
//    declaration line is absorbed (step-1c) and the companion buff sentence
//    parses as a StaticAbility with attachedOnly flag.
// ============================================================================

describe('Slice 12: as-becomes-attached choose-color absorption (Sanctuary Blade)', () => {
  it('1. Full Sanctuary Blade 2-line oracle parses as StaticAbility (attachedOnly)', () => {
    const r = parseOracleText(SANCTUARY_BLADE_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.attachedOnly).toBe(true);
  });

  it('2. Companion buff has PT modifier +2/+0', () => {
    const r = parseOracleText(SANCTUARY_BLADE_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 2, toughness: 0 });
  });

  it('3. Full oracle with Equip line still parses as StaticAbility', () => {
    const r = parseOracleText(SANCTUARY_BLADE_FULL);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.attachedOnly).toBe(true);
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 2, toughness: 0 });
  });

  it('4. Normalized "this artifact" form (after normalizeSelfSubtypeNouns) is absorbed', () => {
    // normalizeSelfSubtypeNouns converts "this Equipment" → "this artifact" before
    // parseOracleTextPerLine runs. Verify the normalised form also parses cleanly.
    const normalizedOracle =
      'As this artifact becomes attached to a creature, choose a color.\n' +
      'Equipped creature gets +2/+0 and has protection from the chosen color.';
    const r = parseOracleText(normalizedOracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.attachedOnly).toBe(true);
  });

  it('5. choose-creature-type form is also absorbed', () => {
    // Variant using "choose a creature type" instead of "choose a color".
    const oracle =
      'As this Equipment becomes attached to a creature, choose a creature type.\n' +
      'Equipped creature has protection from creatures of the chosen type.';
    // The companion line "has protection from creatures of the chosen type" falls
    // into the keyword-only (modifier: ModifyPT 0/0) branch of matchAttachedStaticBuff.
    const r = parseOracleText(oracle);
    // Expect either StaticAbility (best case) or at minimum NOT Unparsed
    // (the choose-declaration line must not block parsing).
    // In practice matchAttachedStaticBuff picks up "Equipped creature has ..."
    expect(r.kind).toBe('StaticAbility');
  });

  it('6. choose-color declaration line alone is not parsed as a runnable effect', () => {
    // A lone "As this Equipment becomes attached to a creature, choose a color."
    // line (single line, no companion) has no parseable executor body and stays
    // Unparsed — the absorber only fires in the multi-line per-line path.
    const lone = 'As this Equipment becomes attached to a creature, choose a color.';
    const r = parseOracleText(lone);
    // Single-line form: not parseable standalone (no executor body).
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// 2. Execution: isProtectedFromSource enforces protection from chosen color
//    on the equipped creature via the equipment's choices.chosenColor.
// ============================================================================

describe('Slice 12: protection from chosen color execution (Sanctuary Blade)', () => {
  function buildState(chosenColor: 'W' | 'U' | 'B' | 'R' | 'G') {
    const defs = new Map<string, CardDefinition>();

    defs.set('blade_def', makeDef('blade_def', {
      name: 'Sanctuary Blade',
      type_line: 'Artifact — Equipment',
      oracle_text: SANCTUARY_BLADE_ORACLE,
      card_types: ['artifact'],
    }));

    defs.set('creature_def', makeDef('creature_def', {
      name: 'Protected Warrior',
      type_line: 'Creature — Human Warrior',
      oracle_text: '',
      card_types: ['creature'],
      colors: ['W'],
      power: 2,
      toughness: 2,
    }));

    defs.set('red_spell_def', makeDef('red_spell_def', {
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: 'Deal 3 damage to any target.',
      card_types: ['instant'],
      colors: ['R'],
    }));

    defs.set('blue_spell_def', makeDef('blue_spell_def', {
      name: 'Counterspell',
      type_line: 'Instant',
      oracle_text: 'Counter target spell.',
      card_types: ['instant'],
      colors: ['U'],
    }));

    const cards = new Map<string, CardInstance>();

    // Sanctuary Blade attached to the creature with the chosen color stored.
    cards.set('blade', makeCard('blade', 'blade_def', 'p1', {
      attachedTo: 'warrior',
      choices: { chosenColor },
    }));
    cards.set('warrior', makeCard('warrior', 'creature_def', 'p1'));
    cards.set('red_spell', makeCard('red_spell', 'red_spell_def', 'p2', { zone: 'hand' }));
    cards.set('blue_spell', makeCard('blue_spell', 'blue_spell_def', 'p2', { zone: 'hand' }));

    const state = makeState({ cards, cardDefinitions: defs });
    return state;
  }

  it('7. Warrior is protected from red when chosenColor = R', () => {
    const state = buildState('R');
    expect(isProtectedFromSource(state, 'warrior', 'red_spell')).toBe(true);
    expect(isProtectedFromSource(state, 'warrior', 'blue_spell')).toBe(false);
  });

  it('8. Warrior is protected from blue when chosenColor = U', () => {
    const state = buildState('U');
    expect(isProtectedFromSource(state, 'warrior', 'blue_spell')).toBe(true);
    expect(isProtectedFromSource(state, 'warrior', 'red_spell')).toBe(false);
  });

  it('9. No protection when blade has no chosenColor set', () => {
    const defs = new Map<string, CardDefinition>();
    defs.set('blade_def', makeDef('blade_def', {
      name: 'Sanctuary Blade',
      type_line: 'Artifact — Equipment',
      oracle_text: SANCTUARY_BLADE_ORACLE,
      card_types: ['artifact'],
    }));
    defs.set('creature_def', makeDef('creature_def', {
      name: 'Warrior',
      type_line: 'Creature — Human',
      oracle_text: '',
      card_types: ['creature'],
      colors: ['W'],
      power: 2,
      toughness: 2,
    }));
    defs.set('red_spell_def', makeDef('red_spell_def', {
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: '',
      card_types: ['instant'],
      colors: ['R'],
    }));

    const cards = new Map<string, CardInstance>();
    // Blade attached but no chosenColor (not yet set at ETB)
    cards.set('blade', makeCard('blade', 'blade_def', 'p1', {
      attachedTo: 'warrior',
      // No choices.chosenColor
    }));
    cards.set('warrior', makeCard('warrior', 'creature_def', 'p1'));
    cards.set('red_spell', makeCard('red_spell', 'red_spell_def', 'p2', { zone: 'hand' }));

    const state = makeState({ cards, cardDefinitions: defs });
    // No chosenColor → no protection
    expect(isProtectedFromSource(state, 'warrior', 'red_spell')).toBe(false);
  });
});
