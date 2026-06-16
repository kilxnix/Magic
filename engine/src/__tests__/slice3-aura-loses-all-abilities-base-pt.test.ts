/**
 * Slice 3 — Aura "loses all abilities and is/becomes/has a <type> creature with
 * base power and toughness N/N"
 *
 * Covers matchAttachedStaticBuff extended to handle the 'loses' verb prefix
 * (Frogify / Reprobation / Utter-Insignificance family).
 *
 * EXECUTOR ROUTE: Fully backed by the aura cache:
 *   - card-parser-cache.ts parseEquipmentBonus extracts losesAllAbilities,
 *     setBasePower/setBaseToughness, setTypes/addTypes.
 *   - continuous.ts getEquipmentPTBonus substitutes the set base P/T.
 *   - keywords.ts instanceLosesAllAbilities suppresses the creature's abilities.
 *
 * This test file verifies:
 *   1. Parser accepts the combined sentence and returns StaticAbility (not Unparsed).
 *   2. The aura cache (populateParsedCache) correctly extracts the base P/T,
 *      setTypes, and losesAllAbilities from real oracle wordings.
 *   3. Execution: getEffectivePower/getEffectiveToughness reflect the set base P/T
 *      when the aura is attached, and instanceLosesAllAbilities returns true.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { populateParsedCache } from '../cards/card-parser-cache';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { instanceLosesAllAbilities } from '../keywords';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDef(
  id: string,
  oracle: string,
  typeLine: string,
  power?: number,
  toughness?: number,
): CardDefinition {
  const base: CardDefinition = {
    id,
    name: id,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: '{1}{U}',
    cmc: 2,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: typeLine.toLowerCase().includes('enchantment') ? ['enchantment'] : ['creature'],
  };
  if (power !== undefined) base.power = power;
  if (toughness !== undefined) base.toughness = toughness;
  return base;
}

function makeInstance(
  instanceId: string,
  definitionId: string,
  opts: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId: 'p1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...opts,
  };
}

function baseState(
  cards: Map<string, CardInstance>,
  defs: Map<string, CardDefinition>,
): GameState {
  return {
    players: [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob')],
    cards,
    cardDefinitions: defs,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ---------------------------------------------------------------------------
// PARSER TESTS — face must not be Unparsed
// ---------------------------------------------------------------------------

describe('Slice 3 aura loses-all-abilities base-PT: parser', () => {
  it('parses Frogify: "Enchant creature. Enchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1."', () => {
    const oracle =
      'Enchant creature.\nEnchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
  });

  it('parses Reprobation: "Enchant creature. Enchanted creature loses all abilities and is a Coward creature with base power and toughness 0/1."', () => {
    const oracle =
      'Enchant creature.\nEnchanted creature loses all abilities and is a Coward creature with base power and toughness 0/1.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
  });

  it('parses Frature/Unable to Scream: "in addition to its other types" form with base power and toughness 0/2', () => {
    const oracle =
      'Enchant creature.\nEnchanted creature loses all abilities and is a Toy artifact creature with base power and toughness 0/2 in addition to its other types.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
  });

  it('parses "loses all abilities and has base power and toughness 1/1" (Utter Insignificance body sentence)', () => {
    // Utter Insignificance has Flash and an activated ability, but the key
    // "loses all abilities" line should parse as StaticAbility on its own.
    const oracle =
      'Enchant creature.\nEnchanted creature loses all abilities and has base power and toughness 1/1.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
  });

  it('does NOT parse "loses all abilities" alone (no base P/T — no executor run)', () => {
    // Pure "loses all abilities" with no base P/T set stays Unparsed because
    // there is no continuous-layer consumer for ability-stripping without the
    // accompanying P/T set (the cache only fires when there is an attached creature
    // with a base P/T override to apply).
    const oracle =
      'Enchant creature.\nEnchanted creature loses all abilities.';
    const result = parseOracleText(oracle);
    // Should NOT be a StaticAbility via the loses-all-abilities-only path
    // (our matcher gates on "base power and toughness" being present).
    expect(result.kind).not.toBe('StaticAbility');
  });
});

// ---------------------------------------------------------------------------
// CACHE TESTS — populateParsedCache extracts the right bonus fields
// ---------------------------------------------------------------------------

describe('Slice 3 aura loses-all-abilities base-PT: aura cache extraction', () => {
  it('Frogify: extracts setBasePower=1, setBaseToughness=1, losesAllAbilities=true', () => {
    const def = makeDef(
      'frogify',
      'Enchant creature.\nEnchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.',
      'Enchantment — Aura',
    );
    const cached = populateParsedCache(def);
    expect(cached.equipmentBonus).toBeDefined();
    expect(cached.equipmentBonus?.setBasePower).toBe(1);
    expect(cached.equipmentBonus?.setBaseToughness).toBe(1);
    expect(cached.equipmentBonus?.losesAllAbilities).toBe(true);
  });

  it('Reprobation: extracts setBasePower=0, setBaseToughness=1, losesAllAbilities=true', () => {
    const def = makeDef(
      'reprobation',
      'Enchant creature.\nEnchanted creature loses all abilities and is a Coward creature with base power and toughness 0/1.',
      'Enchantment — Aura',
    );
    const cached = populateParsedCache(def);
    expect(cached.equipmentBonus).toBeDefined();
    expect(cached.equipmentBonus?.setBasePower).toBe(0);
    expect(cached.equipmentBonus?.setBaseToughness).toBe(1);
    expect(cached.equipmentBonus?.losesAllAbilities).toBe(true);
  });

  it('Frature/Unable to Scream: extracts setBasePower=0, setBaseToughness=2, addTypes=[artifact]', () => {
    const def = makeDef(
      'unable-to-scream',
      'Enchant creature.\nEnchanted creature loses all abilities and is a Toy artifact creature with base power and toughness 0/2 in addition to its other types.',
      'Enchantment — Aura',
    );
    const cached = populateParsedCache(def);
    expect(cached.equipmentBonus).toBeDefined();
    expect(cached.equipmentBonus?.setBasePower).toBe(0);
    expect(cached.equipmentBonus?.setBaseToughness).toBe(2);
    expect(cached.equipmentBonus?.losesAllAbilities).toBe(true);
    // "in addition to its other types" → addTypes (not setTypes)
    expect(cached.equipmentBonus?.addTypes).toContain('artifact');
  });

  it('Utter Insignificance body: extracts setBasePower=1, setBaseToughness=1, losesAllAbilities=true (has form)', () => {
    const def = makeDef(
      'utter-insignificance',
      'Enchant creature.\nEnchanted creature loses all abilities and has base power and toughness 1/1.',
      'Enchantment — Aura',
    );
    const cached = populateParsedCache(def);
    expect(cached.equipmentBonus).toBeDefined();
    expect(cached.equipmentBonus?.setBasePower).toBe(1);
    expect(cached.equipmentBonus?.setBaseToughness).toBe(1);
    expect(cached.equipmentBonus?.losesAllAbilities).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS — getEffectivePower/Toughness reflect attached aura
// ---------------------------------------------------------------------------

describe('Slice 3 aura loses-all-abilities base-PT: execution', () => {
  it('getEffectivePower/Toughness returns the set base P/T (1/1) from Frogify when attached', () => {
    // Creature with base 5/5
    const creatureDef = makeDef('big-beast', '', 'Creature — Beast', 5, 5);
    const frogifyDef = makeDef(
      'frogify',
      'Enchant creature.\nEnchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.',
      'Enchantment — Aura',
    );
    const cachedFrogify = populateParsedCache(frogifyDef);

    const cards = new Map<string, CardInstance>([
      ['c1', makeInstance('c1', 'big-beast')],
      ['aura1', makeInstance('aura1', 'frogify', { attachedTo: 'c1' })],
    ]);
    const defs = new Map<string, CardDefinition>([
      ['big-beast', creatureDef],
      ['frogify', cachedFrogify],
    ]);
    const state = baseState(cards, defs);

    expect(getEffectivePower(state, 'c1')).toBe(1);
    expect(getEffectiveToughness(state, 'c1')).toBe(1);
  });

  it('getEffectivePower/Toughness returns set base P/T (0/1) from Reprobation when attached', () => {
    const creatureDef = makeDef('dragon', '', 'Creature — Dragon', 5, 5);
    const reprobationDef = makeDef(
      'reprobation',
      'Enchant creature.\nEnchanted creature loses all abilities and is a Coward creature with base power and toughness 0/1.',
      'Enchantment — Aura',
    );
    const cachedReprobation = populateParsedCache(reprobationDef);

    const cards = new Map<string, CardInstance>([
      ['c2', makeInstance('c2', 'dragon')],
      ['aura2', makeInstance('aura2', 'reprobation', { attachedTo: 'c2' })],
    ]);
    const defs = new Map<string, CardDefinition>([
      ['dragon', creatureDef],
      ['reprobation', cachedReprobation],
    ]);
    const state = baseState(cards, defs);

    expect(getEffectivePower(state, 'c2')).toBe(0);
    expect(getEffectiveToughness(state, 'c2')).toBe(1);
  });

  it('instanceLosesAllAbilities returns true for creature enchanted by Frogify', () => {
    const creatureDef = makeDef('attacker', '', 'Creature — Human', 3, 3);
    const frogifyDef = makeDef(
      'frogify2',
      'Enchant creature.\nEnchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.',
      'Enchantment — Aura',
    );
    const cachedFrogify = populateParsedCache(frogifyDef);

    const cards = new Map<string, CardInstance>([
      ['c3', makeInstance('c3', 'attacker')],
      ['aura3', makeInstance('aura3', 'frogify2', { attachedTo: 'c3' })],
    ]);
    const defs = new Map<string, CardDefinition>([
      ['attacker', creatureDef],
      ['frogify2', cachedFrogify],
    ]);
    const state = baseState(cards, defs);

    expect(instanceLosesAllAbilities(state, 'c3')).toBe(true);
  });

  it('instanceLosesAllAbilities returns false for creature NOT enchanted by Frogify', () => {
    const creatureDef = makeDef('free-creature', '', 'Creature — Human', 3, 3);
    const cards = new Map<string, CardInstance>([
      ['c4', makeInstance('c4', 'free-creature')],
    ]);
    const defs = new Map<string, CardDefinition>([
      ['free-creature', creatureDef],
    ]);
    const state = baseState(cards, defs);

    expect(instanceLosesAllAbilities(state, 'c4')).toBe(false);
  });
});
