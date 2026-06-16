/**
 * Slice 7: matchBecomesCopy — "~ becomes a copy of target creature until end of turn"
 *
 * Tests cover:
 *  1. Parser: single-target trailing-duration form (Sakashima style)
 *  2. Parser: leading-duration self-copy form (Vesuvan Shapeshifter style)
 *  3. Parser: mass form — "each other creature becomes a copy of target nonlegendary
 *             creature until end of turn" (Mirrorweave style)
 *  4. Executor: single-target form writes becomesCopyOfDefinitionId, and
 *               getCardDefinition returns the copied definition
 *  5. Executor: mass form transforms all other battlefield creatures
 *  6. Executor: cleanupDamage clears becomesCopyOfDefinitionId at end of turn
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { getCardDefinition } from '../game-state';
import { cleanupDamage } from '../state-based';
import { createPlayer } from '../types';
import type { BecomesCopyEffect, Effect } from '../effects/ast';
import type { CardDefinition, CardInstance, GameState } from '../types';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeDef(id: string, name: string, power: number, toughness: number, legendary = false): CardDefinition {
  return {
    id,
    name,
    type_line: legendary ? `Legendary Creature — ${name}` : `Creature — ${name}`,
    oracle_text: '',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
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

function effectsOf(text: string): Effect[] {
  const parsed = parseOracleText(text);
  if (parsed.kind !== 'Spell') {
    throw new Error(`Expected Spell for "${text}", got ${parsed.kind}`);
  }
  return parsed.effects;
}

// ── Parser tests ─────────────────────────────────────────────────────────────

describe('matchBecomesCopy: parser', () => {
  it('parses trailing-duration "target creature becomes a copy of target creature until end of turn"', () => {
    const es = effectsOf('Target creature becomes a copy of target creature until end of turn.');
    expect(es).toHaveLength(1);
    const e = es[0] as BecomesCopyEffect;
    expect(e.kind).toBe('BecomesCopy');
    expect(e.subject.kind).toBe('Chosen');
    expect(e.copySource.kind).toBe('Chosen');
    expect(e.mass).toBeUndefined();
    // The two targets must reference DIFFERENT chosen specs
    expect((e.subject as { kind: 'Chosen'; targetId: string }).targetId)
      .not.toBe((e.copySource as { kind: 'Chosen'; targetId: string }).targetId);
  });

  it('parses leading-duration self-copy "Until end of turn, ~ becomes a copy of target creature"', () => {
    const es = effectsOf('Until end of turn, ~ becomes a copy of target creature.');
    expect(es).toHaveLength(1);
    const e = es[0] as BecomesCopyEffect;
    expect(e.kind).toBe('BecomesCopy');
    expect(e.subject.kind).toBe('Source');
    expect(e.copySource.kind).toBe('Chosen');
    expect(e.mass).toBeUndefined();

    // Self-copy produces only ONE TargetSpec (the copy source)
    const parsed = parseOracleText('Until end of turn, ~ becomes a copy of target creature.');
    if (parsed.kind !== 'Spell') throw new Error('not a Spell');
    expect(parsed.targets).toHaveLength(1);
  });

  it('parses mass form "Each other creature becomes a copy of target nonlegendary creature until end of turn"', () => {
    const es = effectsOf(
      'Each other creature becomes a copy of target nonlegendary creature until end of turn.'
    );
    expect(es).toHaveLength(1);
    const e = es[0] as BecomesCopyEffect;
    expect(e.kind).toBe('BecomesCopy');
    expect(e.mass).toBe(true);
    expect(e.copySource.kind).toBe('Chosen');

    // Only ONE TargetSpec (the copy source); no separate subject target
    const parsed = parseOracleText(
      'Each other creature becomes a copy of target nonlegendary creature until end of turn.'
    );
    if (parsed.kind !== 'Spell') throw new Error('not a Spell');
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].constraints?.excludeSupertypes).toContain('legendary');
  });
});

// ── Executor tests ────────────────────────────────────────────────────────────

describe('matchBecomesCopy: executor', () => {
  it('single-target form: subject gains becomesCopyOfDefinitionId of copy source', () => {
    // subject: bear (2/2); copy source: dragon (5/5)
    const bearDef = makeDef('bear-def', 'Bear', 2, 2);
    const dragonDef = makeDef('dragon-def', 'Dragon', 5, 5);
    const bearInst = makeInst('bear-i', 'bear-def', 'p1');
    const dragonInst = makeInst('dragon-i', 'dragon-def', 'p2');

    const state = makeState([bearDef, dragonDef], [bearInst, dragonInst]);

    const parsed = parseOracleText(
      'Target creature becomes a copy of target creature until end of turn.'
    );
    if (parsed.kind !== 'Spell') throw new Error('not a Spell');

    // Two targets: subject is first TargetSpec, copy source is second.
    expect(parsed.targets).toHaveLength(2);

    // executeEffects takes a flat string[] of chosen IDs in the same order as targetSpecs.
    // Targets order: [subjectSpec, copySourceSpec] — from matchBecomesCopy return value.
    const result = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['bear-i', 'dragon-i'],   // flat chosen IDs in spec order
      parsed.targets,             // targetSpecs
      0,
    );

    const bear = result.cards.get('bear-i')!;
    expect(bear.becomesCopyOfDefinitionId).toBe('dragon-def');

    // getCardDefinition should now return dragon's stats
    const def = getCardDefinition(result, bear);
    expect(def.power).toBe(5);
    expect(def.toughness).toBe(5);
    expect(def.name).toBe('Dragon');
  });

  it('mass form: all other battlefield creatures gain the copy source definition', () => {
    const bearDef = makeDef('bear-def', 'Bear', 2, 2);
    const wolfDef = makeDef('wolf-def', 'Wolf', 1, 1);
    const dragonDef = makeDef('dragon-def', 'Dragon', 5, 5);

    // dragon is the copy source; bear + wolf should both become dragons
    const bearInst = makeInst('bear-i', 'bear-def', 'p1');
    const wolfInst = makeInst('wolf-i', 'wolf-def', 'p2');
    const dragonInst = makeInst('dragon-i', 'dragon-def', 'p2');

    const state = makeState([bearDef, wolfDef, dragonDef], [bearInst, wolfInst, dragonInst]);

    const parsed = parseOracleText(
      'Each other creature becomes a copy of target nonlegendary creature until end of turn.'
    );
    if (parsed.kind !== 'Spell') throw new Error('not a Spell');

    expect(parsed.targets).toHaveLength(1);

    // Mass form: only one target (the copy source)
    const result = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['dragon-i'],     // flat chosen IDs in spec order
      parsed.targets,   // targetSpecs
      0,
    );

    // Bear and Wolf become Dragon
    const bear = result.cards.get('bear-i')!;
    const wolf = result.cards.get('wolf-i')!;
    const dragon = result.cards.get('dragon-i')!;

    expect(bear.becomesCopyOfDefinitionId).toBe('dragon-def');
    expect(wolf.becomesCopyOfDefinitionId).toBe('dragon-def');
    // Dragon itself is NOT transformed (can't become a copy of itself)
    expect(dragon.becomesCopyOfDefinitionId).toBeUndefined();

    // getCardDefinition now returns Dragon stats for both
    expect(getCardDefinition(result, bear).power).toBe(5);
    expect(getCardDefinition(result, wolf).power).toBe(5);
  });

  it('cleanupDamage clears becomesCopyOfDefinitionId, restoring original definition', () => {
    const bearDef = makeDef('bear-def', 'Bear', 2, 2);
    const dragonDef = makeDef('dragon-def', 'Dragon', 5, 5);
    const bearInst: CardInstance = {
      ...makeInst('bear-i', 'bear-def', 'p1'),
      becomesCopyOfDefinitionId: 'dragon-def',
    };

    const state = makeState([bearDef, dragonDef], [bearInst]);

    // Before cleanup: getCardDefinition sees dragon
    expect(getCardDefinition(state, bearInst).power).toBe(5);

    const cleaned = cleanupDamage({ ...state, step: 'cleanup' });
    const cleanedBear = cleaned.cards.get('bear-i')!;

    expect(cleanedBear.becomesCopyOfDefinitionId).toBeUndefined();
    expect(getCardDefinition(cleaned, cleanedBear).power).toBe(2);
    expect(getCardDefinition(cleaned, cleanedBear).name).toBe('Bear');
  });
});
