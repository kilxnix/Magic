/**
 * Slice 3/12: matchBecomesCopy extensions for activated/triggered clone clauses.
 *
 * Covers the three uncredited commander-legal forms:
 *
 *  1. Mirage Mirror  — "{2}: This artifact becomes a copy of target artifact,
 *                       creature, enchantment, or land until end of turn."
 *     Subject: 'this artifact' → Source.  Copy source: Permanent target.
 *
 *  2. Shapesharer    — "{2}{U}: Target Shapeshifter becomes a copy of target
 *                       creature until your next turn."
 *     Subject: 'target shapeshifter' → Chosen (subtype constraint).
 *     Duration: 'until your next turn' (previously declined).
 *
 *  3. Tilonalli's Skinshifter — "Whenever this creature attacks, it becomes a
 *                                copy of another target nonlegendary attacking
 *                                creature until end of turn."
 *     Subject: 'it' → Source (inside attack trigger body).
 *     Copy source: Chosen creature with nonlegendary + attacking constraints.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText, parseActivatedAbilities } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { getCardDefinition } from '../game-state';
import { createPlayer } from '../types';
import type { BecomesCopyEffect, Effect } from '../effects/ast';
import type { CardDefinition, CardInstance, GameState } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDef(
  id: string,
  name: string,
  power: number,
  toughness: number,
  card_types: string[] = ['creature'],
  subtypes: string[] = [],
): CardDefinition {
  return {
    id,
    name,
    type_line: `${card_types.join(' ')} — ${name}`,
    oracle_text: '',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types,
    power,
    toughness,
    ...(subtypes.length ? { subtypes } : {}),
  };
}

function makeInst(instanceId: string, definitionId: string, ownerId: string): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone: 'battlefield' as const,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
}

function makeState(defs: CardDefinition[], insts: CardInstance[]): GameState {
  return {
    players: [createPlayer('p1', 'P1'), createPlayer('p2', 'P2')],
    cards: new Map(insts.map(inst => [inst.instanceId, inst])),
    cardDefinitions: new Map(defs.map(def => [def.id, def])),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ── Mirage Mirror parser tests ────────────────────────────────────────────────

describe('matchBecomesCopy extension — Mirage Mirror ("this artifact" subject, Permanent copy source)', () => {
  // Real Mirage Mirror oracle text (effect part after colon):
  const EFFECT_TEXT =
    'This artifact becomes a copy of target artifact, creature, enchantment, or land until end of turn.';

  it('parses effect clause to BecomesCopy with Source subject', () => {
    const parsed = parseOracleText(EFFECT_TEXT);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const e = parsed.effects[0] as BecomesCopyEffect;
    expect(e.kind).toBe('BecomesCopy');
    expect(e.subject.kind).toBe('Source');
    expect(e.mass).toBeUndefined();
  });

  it('emits exactly one Permanent TargetSpec (the copy source)', () => {
    const parsed = parseOracleText(EFFECT_TEXT);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Permanent');
  });

  it('full Mirage Mirror oracle parses as Activated with BecomesCopy effect', () => {
    const fullOracle =
      '{2}: This artifact becomes a copy of target artifact, creature, enchantment, or land until end of turn.';
    const abilities = parseActivatedAbilities(fullOracle);
    expect(abilities).toHaveLength(1);
    const ab = abilities[0];
    expect(ab.effects).toHaveLength(1);
    const e = ab.effects[0] as BecomesCopyEffect;
    expect(e.kind).toBe('BecomesCopy');
    expect(e.subject.kind).toBe('Source');
    // Copy source spec must be Permanent type (covers artifact/creature/enchantment/land)
    expect(ab.targets[0].type).toBe('Permanent');
  });

  it('executor: source (Mirage Mirror) takes on dragon definition when copy source is dragon', () => {
    // Simulate: "mirror" artifact becomes a copy of a creature on the battlefield.
    const mirrorDef = makeDef('mirror-def', 'Mirage Mirror', 0, 0, ['artifact']);
    const dragonDef = makeDef('dragon-def', 'Dragon', 5, 5, ['creature']);
    const mirrorInst = makeInst('mirror-i', 'mirror-def', 'p1');
    const dragonInst = makeInst('dragon-i', 'dragon-def', 'p2');

    const state = makeState([mirrorDef, dragonDef], [mirrorInst, dragonInst]);

    const parsed = parseOracleText(EFFECT_TEXT);
    if (parsed.kind !== 'Spell') throw new Error('Expected Spell');

    // Subject is Source (the mirror instance, passed as sourceInstanceId arg 5).
    // Only one target: the copy source (dragon).
    expect(parsed.targets).toHaveLength(1);

    const result = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['dragon-i'],   // chosen targets: [copySourceSpec]
      parsed.targets,
      0,
      { sourceInstanceId: 'mirror-i' },  // the mirror is the subject (Source)
    );

    const mirror = result.cards.get('mirror-i')!;
    expect(mirror.becomesCopyOfDefinitionId).toBe('dragon-def');
    const def = getCardDefinition(result, mirror);
    expect(def.name).toBe('Dragon');
    expect(def.power).toBe(5);
  });
});

// ── Shapesharer parser tests ──────────────────────────────────────────────────

describe('matchBecomesCopy extension — Shapesharer ("target Shapeshifter" subject, until your next turn)', () => {
  // Real Shapesharer oracle text (effect part):
  const EFFECT_TEXT =
    'Target Shapeshifter becomes a copy of target creature until your next turn.';

  it('parses to BecomesCopy with Chosen subject (Shapeshifter subtype) and Chosen copy source', () => {
    const parsed = parseOracleText(EFFECT_TEXT);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const e = parsed.effects[0] as BecomesCopyEffect;
    expect(e.kind).toBe('BecomesCopy');
    expect(e.subject.kind).toBe('Chosen');
    expect(e.copySource.kind).toBe('Chosen');
    expect(e.mass).toBeUndefined();
  });

  it('emits two TargetSpecs — first is Creature/Shapeshifter, second is Creature', () => {
    const parsed = parseOracleText(EFFECT_TEXT);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(2);
    // Subject spec: Creature with subtype 'shapeshifter' (lowercase, as in CREATURE_SUBTYPE_MAP)
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].constraints?.subtypes).toContain('shapeshifter');
    // Copy source spec: Creature (no subtype restriction)
    expect(parsed.targets[1].type).toBe('Creature');
    expect(parsed.targets[1].constraints?.subtypes).toBeUndefined();
  });

  it('the two TargetSpecs reference different targetId values', () => {
    const parsed = parseOracleText(EFFECT_TEXT);
    if (parsed.kind !== 'Spell') throw new Error('not Spell');
    const e = parsed.effects[0] as BecomesCopyEffect;
    const subId = (e.subject as { kind: 'Chosen'; targetId: string }).targetId;
    const srcId = (e.copySource as { kind: 'Chosen'; targetId: string }).targetId;
    expect(subId).not.toBe(srcId);
  });

  it('executor: target Shapeshifter gains dragon definition', () => {
    const shapeshifterDef = makeDef('shapeshift-def', 'Shapeshifter', 1, 1, ['creature'], ['Shapeshifter']);
    const dragonDef = makeDef('dragon-def', 'Dragon', 6, 6, ['creature']);
    const shapeInst = makeInst('shape-i', 'shapeshift-def', 'p1');
    const dragonInst = makeInst('dragon-i', 'dragon-def', 'p2');

    const state = makeState([shapeshifterDef, dragonDef], [shapeInst, dragonInst]);

    const parsed = parseOracleText(EFFECT_TEXT);
    if (parsed.kind !== 'Spell') throw new Error('Expected Spell');
    expect(parsed.targets).toHaveLength(2);

    // targets: [subjectSpec (shapeshifter), copySourceSpec (dragon)]
    const result = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['shape-i', 'dragon-i'],
      parsed.targets,
      0,
    );

    const shape = result.cards.get('shape-i')!;
    expect(shape.becomesCopyOfDefinitionId).toBe('dragon-def');
    expect(getCardDefinition(result, shape).name).toBe('Dragon');
    expect(getCardDefinition(result, shape).power).toBe(6);
  });
});

// ── Tilonalli's Skinshifter parser tests ──────────────────────────────────────

describe('matchBecomesCopy extension — Tilonalli\'s Skinshifter ("it" subject, "another target nonlegendary attacking creature")', () => {
  // Real Tilonalli's Skinshifter triggered body (after trigger prefix stripped):
  const FULL_ORACLE =
    "Whenever this creature attacks, it becomes a copy of another target nonlegendary attacking creature until end of turn.";

  it('parses full oracle as Triggered with BecomesCopy effect', () => {
    const parsed = parseOracleText(FULL_ORACLE);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger.kind).toBe('Attacks');
    expect(parsed.ability.effects).toHaveLength(1);
    const e = parsed.ability.effects[0] as BecomesCopyEffect;
    expect(e.kind).toBe('BecomesCopy');
    // 'it' → Source (the creature that attacked)
    expect(e.subject.kind).toBe('Source');
    expect(e.copySource.kind).toBe('Chosen');
    expect(e.mass).toBeUndefined();
  });

  it('copy source TargetSpec has nonlegendary + attacking constraints', () => {
    const parsed = parseOracleText(FULL_ORACLE);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    // Only one TargetSpec: the copy source (subject is Source, needs no spec)
    expect(parsed.targets).toHaveLength(1);
    const copySpec = parsed.targets[0];
    expect(copySpec.type).toBe('Creature');
    expect(copySpec.constraints?.excludeSupertypes).toContain('legendary');
    expect(copySpec.constraints?.combatStatus).toBe('attacking');
  });

  it('executor: skinshifter (Source) gains copy of chosen attacking creature', () => {
    const skinshifterDef = makeDef('skin-def', "Tilonalli's Skinshifter", 1, 1);
    const bearDef = makeDef('bear-def', 'Bear', 2, 2);
    const skinInst = makeInst('skin-i', 'skin-def', 'p1');
    const bearInst = makeInst('bear-i', 'bear-def', 'p2');

    const state = makeState([skinshifterDef, bearDef], [skinInst, bearInst]);

    const parsed = parseOracleText(FULL_ORACLE);
    if (parsed.kind !== 'Triggered') throw new Error('Expected Triggered');

    // Execute the trigger body: skinshifter (sourceInstanceId) becomes a copy of bear.
    const result = executeEffects(
      state,
      parsed.ability.effects,
      'p1',
      ['bear-i'],       // chosen targets: [copySourceSpec]
      parsed.targets,
      0,
      { sourceInstanceId: 'skin-i' },   // the skinshifter is the source/subject
    );

    const skin = result.cards.get('skin-i')!;
    expect(skin.becomesCopyOfDefinitionId).toBe('bear-def');
    expect(getCardDefinition(result, skin).name).toBe('Bear');
    expect(getCardDefinition(result, skin).power).toBe(2);
  });
});

// ── Additional edge-case parser tests ─────────────────────────────────────────

describe('matchBecomesCopy extension — "it" self-reference in spell context', () => {
  it('parses "It becomes a copy of target creature until end of turn." with Source subject', () => {
    const parsed = parseOracleText('It becomes a copy of target creature until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const e = parsed.effects[0] as BecomesCopyEffect;
    expect(e.kind).toBe('BecomesCopy');
    expect(e.subject.kind).toBe('Source');
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
  });
});
