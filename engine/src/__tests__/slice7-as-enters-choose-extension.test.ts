/**
 * slice7-as-enters-choose-extension.test.ts
 *
 * Oracle-parser coverage slice 7/12 — As-enters-choose declaration extension
 *
 * Scope:
 *   1. "choose artifact, creature, enchantment, instant, or sorcery" option-list
 *      form (Cloud Key / Mycosynth Lattice style) is now absorbed both:
 *        (a) in the whole-face stripChooseCreatureTypeETB path, and
 *        (b) in the per-line parseOracleTextPerLine absorber (step 1c).
 *      CHOOSE_CARD_TYPE_LIST_ETB_RE regex covers any subset/ordering of card
 *      types separated by commas and "or".
 *
 *   2. "Spells of the chosen type [you cast] cost {1} less to cast."
 *      (Cloud Key companion body) now parses correctly:
 *        - Bare "spells" subject → chosenCardTypeFromSource:true (card-type check)
 *        - With "you cast" scope → controller:'you'
 *        - Without "you cast" → controller:'any'
 *
 *   3. Existing "Creatures of the chosen type get/have..." still uses
 *      chosenCreatureTypeFromSource (creature-subtype check) — regression guard.
 *
 *   4. Honesty: Arcane Adaptation body ("Creatures you control are the chosen type
 *      in addition to their other types.") still stays Unparsed — no TypeAdd static
 *      modifier in the engine.
 *
 *   5. Execution: Cloud Key-style ReduceCost applies only to spells of the chosen
 *      card type (e.g. artifact spells when chosenCreatureType='artifact').
 *
 * Real oracle wordings referenced:
 *   Cloud Key — "As Cloud Key enters the battlefield, choose artifact, creature,
 *                enchantment, instant, or sorcery.
 *                Spells of the chosen type you cast cost {1} less to cast."
 *   Arcane Adaptation — "...Creatures you control are the chosen type in addition
 *                         to their other types."  (Unparsed — no TypeAdd executor)
 *   Xenograft — "...Each creature you control is the chosen type in addition to
 *                their other types."  (Unparsed — no TypeAdd executor)
 *   Shared Triumph — "Creatures of the chosen type get +1/+1." (existing, regression)
 *   Steely Resolve — "Creatures of the chosen type have shroud." (existing, regression)
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import {
  registerContinuousEffect,
  getCostReduction,
} from '../effects/continuous';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    name: opts.name || id,
    type_line: opts.type_line || 'Creature',
    oracle_text: opts.oracle_text || '',
    mana_cost: opts.mana_cost || '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors || [],
    color_identity: opts.color_identity || [],
    keywords: opts.keywords || [],
    card_types: opts.card_types || ['creature'],
    power: opts.power ?? 1,
    toughness: opts.toughness ?? 1,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: overrides.players || [makePlayer('p1'), makePlayer('p2')],
    cards: overrides.cards || new Map(),
    cardDefinitions: overrides.cardDefinitions || new Map(),
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
    continuousEffects: overrides.continuousEffects || [],
  };
}

// ---------------------------------------------------------------------------
// 1. Parse: option-list choose declaration — "choose artifact, creature, ..."
// ---------------------------------------------------------------------------

describe('Slice 7 (as-enters-choose): option-list choose declaration absorption', () => {
  // Cloud Key oracle (normalized: card name replaced with ~)
  const CLOUD_KEY_ORACLE =
    'As ~ enters the battlefield, choose artifact, creature, enchantment, instant, or sorcery.\n' +
    'Spells of the chosen type you cast cost {1} less to cast.';

  it('1. Full Cloud Key oracle parses as StaticAbility (choose-line absorbed)', () => {
    const r = parseOracleText(CLOUD_KEY_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'ReduceCost', amount: 1 });
    expect(r.ability.filter.chosenCardTypeFromSource).toBe(true);
    expect(r.ability.controller).toBe('you');
  });

  it('2. "choose artifact or creature" two-type form is absorbed', () => {
    const oracle =
      'As ~ enters, choose artifact or creature.\n' +
      'Spells of the chosen type you cast cost {1} less to cast.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter.chosenCardTypeFromSource).toBe(true);
  });

  it('3. "choose instant or sorcery" two-type form is absorbed', () => {
    const oracle =
      'As ~ enters the battlefield, choose instant or sorcery.\n' +
      'Spells of the chosen type cost {1} less to cast.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter.chosenCardTypeFromSource).toBe(true);
    // No "you cast" → controller defaults to 'any'
    expect(r.ability.controller).toBe('any');
  });

  it('4. Per-line absorber handles the choose line on its own line (multi-line face)', () => {
    // When the choose line is mid-face, per-line dispatch absorbs it
    const oracle =
      'As ~ enters the battlefield, choose artifact, creature, enchantment, instant, or sorcery.\n' +
      'Spells of the chosen type cost {1} less to cast.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'ReduceCost', amount: 1 });
  });
});

// ---------------------------------------------------------------------------
// 2. Parse: companion body — "Spells of the chosen type [you cast] cost {1} less"
// ---------------------------------------------------------------------------

describe('Slice 7 (as-enters-choose): companion body parsing', () => {
  it('5. "Spells of the chosen type cost {1} less to cast." uses chosenCardTypeFromSource', () => {
    const r = parseOracleText('Spells of the chosen type cost {1} less to cast.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'ReduceCost', amount: 1 });
    // Bare "spells" subject → card-type filter
    expect(r.ability.filter.chosenCardTypeFromSource).toBe(true);
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBeUndefined();
    // No controller scope → 'any'
    expect(r.ability.controller).toBe('any');
  });

  it('6. "Spells of the chosen type you cast cost {1} less to cast." uses controller=you', () => {
    const r = parseOracleText('Spells of the chosen type you cast cost {1} less to cast.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'ReduceCost', amount: 1 });
    expect(r.ability.filter.chosenCardTypeFromSource).toBe(true);
    expect(r.ability.controller).toBe('you');
  });

  it('7. "Creatures of the chosen type get +1/+1." still uses chosenCreatureTypeFromSource (regression)', () => {
    // "Creatures" has an explicit type → creature-subtype check (not card-type check)
    const r = parseOracleText('Creatures of the chosen type get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
    expect(r.ability.filter.chosenCardTypeFromSource).toBeUndefined();
    expect(r.ability.filter.types).toContain('creature');
  });

  it('8. "Creatures of the chosen type have shroud." still uses chosenCreatureTypeFromSource (regression)', () => {
    const r = parseOracleText('Creatures of the chosen type have shroud.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
    expect(r.ability.filter.chosenCardTypeFromSource).toBeUndefined();
  });

  it('9. "Creature spells you cast of the chosen type cost {1} less." uses chosenCreatureTypeFromSource (Herald\'s Horn pattern)', () => {
    const r = parseOracleText('Creature spells you cast of the chosen type cost {1} less to cast.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
    expect(r.ability.filter.chosenCardTypeFromSource).toBeUndefined();
    expect(r.ability.filter.types).toContain('creature');
    expect(r.ability.controller).toBe('you');
  });
});

// ---------------------------------------------------------------------------
// 3. Honesty: type-adding companion bodies stay Unparsed
// ---------------------------------------------------------------------------

describe('Slice 7 (as-enters-choose): honesty — unsupported companion bodies stay Unparsed', () => {
  it('10. Arcane Adaptation full oracle stays Unparsed (TypeAdd body not supported)', () => {
    const oracle =
      'As ~ enters the battlefield, choose a creature type.\n' +
      'Creatures you control are the chosen type in addition to their other types.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('11. Xenograft full oracle stays Unparsed (TypeAdd body not supported)', () => {
    const oracle =
      'As ~ enters the battlefield, choose a creature type.\n' +
      'Each creature you control is the chosen type in addition to their other types.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('12. Circle of Solace body stays Unparsed (counter-activated not supported)', () => {
    // Circle of Solace has a triggered ward-like ability; no executor for
    // "you may pay {1}. If you do, counter that spell or ability" on a trigger.
    const body =
      'Whenever a creature of the chosen type becomes the target of a spell or ability an opponent controls, ' +
      'you may pay {1}. If you do, counter that spell or ability.';
    const r = parseOracleText(body);
    expect(r.kind).toBe('Unparsed');
  });

  it('13. Circle of Solace full oracle stays Unparsed (companion clause unsupported)', () => {
    const oracle =
      'As ~ enters the battlefield, choose a creature type.\n' +
      'Whenever a creature of the chosen type becomes the target of a spell or ability an opponent controls, ' +
      'you may pay {1}. If you do, counter that spell or ability.';
    const r = parseOracleText(oracle);
    // Even though the choose line is absorbable, the body is unsupported →
    // the whole face stays Unparsed (honesty bar).
    expect(r.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// 4. Execution: Cloud Key ReduceCost applies only to spells of the chosen card type
// ---------------------------------------------------------------------------

describe('Slice 7 (as-enters-choose): execution — Cloud Key cost reduction', () => {
  /**
   * Build a minimal state:
   *   - Cloud Key (artifact) on battlefield with chosenCreatureType = chosenType
   *   - A sorcery spell in hand
   *   - An artifact spell in hand
   */
  function buildCloudKeyState(chosenType: string): GameState {
    const defs = new Map<string, CardDefinition>();
    defs.set('ck_def', makeDef('ck_def', {
      name: 'Cloud Key',
      type_line: 'Artifact',
      oracle_text:
        'As ~ enters the battlefield, choose artifact, creature, enchantment, instant, or sorcery.\n' +
        'Spells of the chosen type you cast cost {1} less to cast.',
      card_types: ['artifact'],
      power: undefined,
      toughness: undefined,
    }));
    defs.set('sorcery_def', makeDef('sorcery_def', {
      name: 'Test Sorcery',
      type_line: 'Sorcery',
      mana_cost: '{2}{R}',
      cmc: 3,
      card_types: ['sorcery'],
      colors: ['R'],
      power: undefined,
      toughness: undefined,
    }));
    defs.set('artifact_def', makeDef('artifact_def', {
      name: 'Test Artifact',
      type_line: 'Artifact',
      mana_cost: '{3}',
      cmc: 3,
      card_types: ['artifact'],
      colors: [],
      power: undefined,
      toughness: undefined,
    }));
    defs.set('creature_def', makeDef('creature_def', {
      name: 'Test Creature',
      type_line: 'Creature — Human',
      mana_cost: '{1}{W}',
      cmc: 2,
      card_types: ['creature'],
      colors: ['W'],
      power: 2,
      toughness: 2,
    }));

    const cards = new Map<string, CardInstance>();
    cards.set('ck', makeCard('ck', 'ck_def', 'p1', {
      choices: { chosenCreatureType: chosenType },
    }));
    // Spells in hand (zone mismatch from 'battlefield' default, so override)
    cards.set('sorcery', { ...makeCard('sorcery', 'sorcery_def', 'p1'), zone: 'hand' });
    cards.set('artifact', { ...makeCard('artifact', 'artifact_def', 'p1'), zone: 'hand' });
    cards.set('creature', { ...makeCard('creature', 'creature_def', 'p1'), zone: 'hand' });

    return makeState({ cards, cardDefinitions: defs });
  }

  it('14. ReduceCost applies to sorcery spells when chosen type is "sorcery"', () => {
    let state = buildCloudKeyState('sorcery');
    state = registerContinuousAbilitiesForPermanent(state, 'ck');

    const sorceryDef = state.cardDefinitions.get('sorcery_def')!;
    const artifactDef = state.cardDefinitions.get('artifact_def')!;
    const creatureDef = state.cardDefinitions.get('creature_def')!;

    // Sorcery should be reduced by 1
    expect(getCostReduction(state, 'p1', sorceryDef)).toBe(1);
    // Artifact and creature should NOT be reduced
    expect(getCostReduction(state, 'p1', artifactDef)).toBe(0);
    expect(getCostReduction(state, 'p1', creatureDef)).toBe(0);
  });

  it('15. ReduceCost applies to artifact spells when chosen type is "artifact"', () => {
    let state = buildCloudKeyState('artifact');
    state = registerContinuousAbilitiesForPermanent(state, 'ck');

    const sorceryDef = state.cardDefinitions.get('sorcery_def')!;
    const artifactDef = state.cardDefinitions.get('artifact_def')!;

    expect(getCostReduction(state, 'p1', artifactDef)).toBe(1);
    expect(getCostReduction(state, 'p1', sorceryDef)).toBe(0);
  });

  it('16. ReduceCost applies to creature spells when chosen type is "creature"', () => {
    let state = buildCloudKeyState('creature');
    state = registerContinuousAbilitiesForPermanent(state, 'ck');

    const creatureDef = state.cardDefinitions.get('creature_def')!;
    const artifactDef = state.cardDefinitions.get('artifact_def')!;

    expect(getCostReduction(state, 'p1', creatureDef)).toBe(1);
    expect(getCostReduction(state, 'p1', artifactDef)).toBe(0);
  });

  it('17. ReduceCost does not apply when no chosenCreatureType is set on Cloud Key', () => {
    let state = buildCloudKeyState('');
    // Remove the choices so chosenCreatureType is empty
    const ck = state.cards.get('ck')!;
    state = {
      ...state,
      cards: new Map([...state.cards, ['ck', { ...ck, choices: {} }]]),
    };
    state = registerContinuousAbilitiesForPermanent(state, 'ck');

    const sorceryDef = state.cardDefinitions.get('sorcery_def')!;
    expect(getCostReduction(state, 'p1', sorceryDef)).toBe(0);
  });

  it('18. ReduceCost does not apply to opponent when controller=you', () => {
    let state = buildCloudKeyState('sorcery');
    state = registerContinuousAbilitiesForPermanent(state, 'ck');

    const sorceryDef = state.cardDefinitions.get('sorcery_def')!;

    // p1 gets the reduction, p2 does not (Cloud Key is controller: 'you')
    expect(getCostReduction(state, 'p1', sorceryDef)).toBe(1);
    expect(getCostReduction(state, 'p2', sorceryDef)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Regression: existing creatures-of-chosen-type forms still work
// ---------------------------------------------------------------------------

describe('Slice 7 (as-enters-choose): regression — existing chosen-type statics unaffected', () => {
  it('19. Full Shared Triumph oracle still parses as StaticAbility', () => {
    const oracle =
      'As ~ enters the battlefield, choose a creature type.\n' +
      'Creatures of the chosen type get +1/+1.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
    expect(r.ability.filter.types).toContain('creature');
  });

  it('20. Full Steely Resolve oracle still parses as StaticAbility', () => {
    const oracle =
      'As ~ enters the battlefield, choose a creature type.\n' +
      'Creatures of the chosen type have shroud.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'GrantKeyword', keyword: 'shroud' });
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
  });

  it('21. "Creature spells you cast of the chosen type cost {1} less" (Herald\'s Horn) still parses', () => {
    const oracle =
      'As ~ enters, choose a creature type.\n' +
      'Creature spells you cast of the chosen type cost {1} less to cast.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
    expect(r.ability.filter.types).toContain('creature');
    expect(r.ability.controller).toBe('you');
  });
});
