/**
 * Slice 9 — Land-subtype and named-card counts in parseNumberOfFilterAmount.
 *
 * Covers:
 *   1. Parser: basic-land plural words (Forests/Islands/Swamps/Mountains/Plains)
 *      parse to ForEachAmount with land + subtype filter.
 *   2. Parser: "creatures named ~" parses to ForEachAmount with namesSelf filter.
 *   3. Execution: burn damage using land-count (Spitting Earth family).
 *   4. Execution: CDA P/T using land-count (Dungrove Elder family).
 *   5. Execution: damage using named-self count (Plague Rats family).
 *
 * Real oracle wordings tested:
 *   Spitting Earth  — "~ deals damage to target creature equal to the number of
 *                      Mountains you control."
 *   Dungrove Elder  — "~'s power and toughness are each equal to the number of
 *                      Forests you control."
 *   Plague Rats     — "~ deals damage to target creature equal to the number of
 *                      creatures named ~ on the battlefield." (adapted)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState, CardDefinition, CardInstance, Player } from '../types';
import { emptyManaPool } from '../types';
import { parseOracleText, parseNumberOfFilterAmount } from '../effects/parser';
import { executeEffects, resetTokenCounter } from '../effects/executor';
import {
  getEffectivePower,
  getEffectiveToughness,
  registerContinuousEffect,
  resetContinuousTimestamp,
} from '../effects/continuous';
import type { ForEachAmount } from '../effects/ast';

/** Split a plain-text phrase into lowercase word tokens (no mana costs). */
function tok(text: string): string[] {
  return text.toLowerCase().replace(/[.,;]/g, ' $& ').split(/\s+/).filter(Boolean);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function makePlayer(id: string, life = 40): Player {
  return {
    id, name: id, life, poisonCounters: 0, commanderDamage: {},
    commanderTax: 0, commanderInstanceId: null, commanderCastCount: 0,
    manaPool: emptyManaPool(), hasPlayedLand: false, hasPriority: false, hasLost: false,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{R}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? ['R'],
    color_identity: opts.color_identity ?? ['R'],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 1,
    toughness: opts.toughness ?? 1,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'] = 'battlefield',
): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function makeState(
  cards: CardInstance[],
  defs: CardDefinition[],
): GameState {
  return {
    players: [makePlayer('p1'), makePlayer('p2')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(defs.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'main', turnNumber: 1,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
    continuousEffects: [],
  };
}

// ── 1. Parser: land-subtype plural words ────────────────────────────────────

describe('parseNumberOfFilterAmount — land-subtype words', () => {
  it('parses "the number of Mountains you control" → land/Mountain subtype filter', () => {
    const tokens = tok('the number of Mountains you control');
    const result = parseNumberOfFilterAmount(tokens, 0);
    expect(result).not.toBeNull();
    if (!result) return;
    const { amount } = result;
    expect(amount.kind).toBe('ForEach');
    expect(amount.zone).toBe('battlefield');
    expect(amount.controller).toBe('you');
    expect(amount.filter).toMatchObject({ types: ['land'], subtypes: ['Mountain'] });
  });

  it('parses "the number of Forests you control" → land/Forest subtype filter', () => {
    const tokens = tok('the number of Forests you control');
    const result = parseNumberOfFilterAmount(tokens, 0);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.amount.filter).toMatchObject({ types: ['land'], subtypes: ['Forest'] });
  });

  it('parses "the number of Islands you control" → land/Island subtype filter', () => {
    const tokens = tok('the number of Islands you control');
    const result = parseNumberOfFilterAmount(tokens, 0);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.amount.filter).toMatchObject({ types: ['land'], subtypes: ['Island'] });
  });

  it('parses "the number of Swamps you control" → land/Swamp subtype filter', () => {
    const tokens = tok('the number of Swamps you control');
    const result = parseNumberOfFilterAmount(tokens, 0);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.amount.filter).toMatchObject({ types: ['land'], subtypes: ['Swamp'] });
  });

  it('parses "the number of Plains you control" → land/Plains subtype filter', () => {
    const tokens = tok('the number of Plains you control');
    const result = parseNumberOfFilterAmount(tokens, 0);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.amount.filter).toMatchObject({ types: ['land'], subtypes: ['Plains'] });
  });
});

// ── 2. Parser: named-self pattern ───────────────────────────────────────────

describe('parseNumberOfFilterAmount — creatures named ~', () => {
  it('parses "the number of creatures named ~ on the battlefield" → namesSelf filter', () => {
    const tokens = tok('the number of creatures named ~ on the battlefield');
    const result = parseNumberOfFilterAmount(tokens, 0);
    expect(result).not.toBeNull();
    if (!result) return;
    const { amount } = result;
    expect(amount.kind).toBe('ForEach');
    expect(amount.zone).toBe('battlefield');
    expect(amount.controller).toBe('each');
    expect(amount.filter).toMatchObject({ types: ['creature'], namesSelf: true });
  });

  it('parses "the number of creatures named ~ you control" → namesSelf/you filter', () => {
    const tokens = tok('the number of creatures named ~ you control');
    const result = parseNumberOfFilterAmount(tokens, 0);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.amount.filter).toMatchObject({ namesSelf: true });
    expect(result.amount.controller).toBe('you');
  });
});

// ── 3. Full oracle parse: Spitting Earth (burn equals Mountains you control) ─

describe('Spitting Earth — oracle parse', () => {
  it('parses to DealDamage with ForEach(battlefield/you/Mountain)', () => {
    // Oracle text uses ~ as the card name placeholder (parser convention)
    const oracle =
      "~ deals damage to target creature equal to the number of Mountains you control.";
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).not.toBe('Unparsed');
    if (parsed.kind === 'Unparsed') return;
    // Should produce a Spell with DealDamage effect
    const effects = parsed.kind === 'Spell' ? parsed.effects : [];
    const dmg = effects.find(e => e.kind === 'DealDamage');
    expect(dmg).toBeDefined();
    if (!dmg || dmg.kind !== 'DealDamage') return;
    const amount = dmg.amount as ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.filter).toMatchObject({ types: ['land'], subtypes: ['Mountain'] });
    expect(amount.controller).toBe('you');
    expect(amount.zone).toBe('battlefield');
  });
});

// ── 4. Execution: burn deals damage equal to Mountains ──────────────────────

describe('Spitting Earth — execution (Mountains you control → damage)', () => {
  const SPITTING_EARTH_ORACLE =
    "~ deals damage to target creature equal to the number of Mountains you control.";

  const mountainDef = makeDef('mountain', {
    name: 'Mountain', type_line: 'Basic Land — Mountain',
    card_types: ['land'], colors: [], color_identity: ['R'],
    mana_cost: '', cmc: 0, power: undefined, toughness: undefined,
  });
  const targetDef = makeDef('target_creature', {
    name: 'Grizzly Bears', type_line: 'Creature — Bear',
    card_types: ['creature'], colors: ['G'], mana_cost: '{1}{G}', cmc: 2,
    power: 2, toughness: 2,
  });

  it('deals damage equal to the number of Mountains you control (3 Mountains → 3 damage)', () => {
    const cards = [
      makeCard('mt1', 'mountain', 'p1'),
      makeCard('mt2', 'mountain', 'p1'),
      makeCard('mt3', 'mountain', 'p1'),
      makeCard('target_1', 'target_creature', 'p2'),
    ];
    const state = makeState(cards, [mountainDef, targetDef]);
    const parsed = parseOracleText(SPITTING_EARTH_ORACLE);
    if (parsed.kind === 'Unparsed' || parsed.kind !== 'Spell') return;
    const newState = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['target_1'],
      parsed.targets,
      0,
      { sourceInstanceId: 'spitting_earth_src' },
    );
    const targetCard = newState.cards.get('target_1');
    expect(targetCard?.damage).toBe(3);
  });

  it('deals 0 damage when no Mountains are controlled', () => {
    const islandDef = makeDef('island', {
      name: 'Island', type_line: 'Basic Land — Island',
      card_types: ['land'], colors: [], mana_cost: '', cmc: 0,
      power: undefined, toughness: undefined,
    });
    const cards = [
      makeCard('isl1', 'island', 'p1'),
      makeCard('target_2', 'target_creature', 'p2'),
    ];
    const state = makeState(cards, [islandDef, targetDef]);
    const parsed = parseOracleText(SPITTING_EARTH_ORACLE);
    if (parsed.kind === 'Unparsed' || parsed.kind !== 'Spell') return;
    const newState = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['target_2'],
      parsed.targets,
      0,
      { sourceInstanceId: 'spitting_earth_src' },
    );
    const targetCard = newState.cards.get('target_2');
    expect(targetCard?.damage).toBe(0);
  });
});

// ── 5. CDA P/T equals number of Forests (Dungrove Elder) ────────────────────

describe('Dungrove Elder — CDA P/T = Forests you control', () => {
  const DUNGROVE_ORACLE =
    "Hexproof\nDungrove Elder's power and toughness are each equal to the number of Forests you control.";

  const forestDef = makeDef('forest', {
    name: 'Forest', type_line: 'Basic Land — Forest',
    card_types: ['land'], colors: [], color_identity: ['G'],
    mana_cost: '', cmc: 0, power: undefined, toughness: undefined,
  });
  const dungroveElderDef = makeDef('dungrove_elder', {
    name: 'Dungrove Elder',
    type_line: 'Creature — Treefolk',
    oracle_text: DUNGROVE_ORACLE,
    card_types: ['creature'], colors: ['G'], mana_cost: '{2}{G}', cmc: 3,
    power: 0, toughness: 0,
  });

  beforeEach(() => {
    resetContinuousTimestamp();
    resetTokenCounter();
  });

  it('parses Dungrove Elder oracle to SetBasePTDynamic with Forest filter', () => {
    const parsed = parseOracleText(DUNGROVE_ORACLE);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const mod = parsed.ability.modifier;
    expect(mod.kind).toBe('SetBasePTDynamic');
    if (mod.kind !== 'SetBasePTDynamic') return;
    expect(mod.powerFormula!.filter).toMatchObject({ types: ['land'], subtypes: ['Forest'] });
    expect(mod.toughnessFormula).not.toBeNull();
    expect(mod.toughnessFormula?.filter).toMatchObject({ types: ['land'], subtypes: ['Forest'] });
  });

  it('P/T = 4 when 4 Forests are controlled', () => {
    const cards = [
      makeCard('elder_1', 'dungrove_elder', 'p1'),
      makeCard('f1', 'forest', 'p1'),
      makeCard('f2', 'forest', 'p1'),
      makeCard('f3', 'forest', 'p1'),
      makeCard('f4', 'forest', 'p1'),
    ];
    let state = makeState(cards, [dungroveElderDef, forestDef]);
    const parsed = parseOracleText(DUNGROVE_ORACLE);
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, 'elder_1', 'p1', parsed.ability);
    }
    expect(getEffectivePower(state, 'elder_1')).toBe(4);
    expect(getEffectiveToughness(state, 'elder_1')).toBe(4);
  });

  it('P/T = 0 when no Forests are controlled', () => {
    const mountainDef2 = makeDef('mountain2', {
      name: 'Mountain', type_line: 'Basic Land — Mountain',
      card_types: ['land'], colors: [], mana_cost: '', cmc: 0,
      power: undefined, toughness: undefined,
    });
    const cards = [
      makeCard('elder_2', 'dungrove_elder', 'p1'),
      makeCard('m1', 'mountain2', 'p1'),
    ];
    let state = makeState(cards, [dungroveElderDef, mountainDef2]);
    const parsed = parseOracleText(DUNGROVE_ORACLE);
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, 'elder_2', 'p1', parsed.ability);
    }
    expect(getEffectivePower(state, 'elder_2')).toBe(0);
    expect(getEffectiveToughness(state, 'elder_2')).toBe(0);
  });
});

// ── 6. Execution: Plague Rats named-self count ───────────────────────────────

describe('Plague Rats — damage = creatures named ~ on the battlefield', () => {
  // Oracle text uses ~ as the card name placeholder (parser convention).
  // The second ~ in "named ~" is the self-referential name filter.
  const PLAGUE_RATS_ORACLE =
    "~ deals damage to target creature equal to the number of creatures named ~ on the battlefield.";

  const ratsDef = makeDef('plague_rats', {
    name: 'Plague Rats',
    type_line: 'Creature — Rat',
    oracle_text: '~ deals damage to target creature equal to the number of creatures named ~ on the battlefield.',
    card_types: ['creature'], colors: ['B'], mana_cost: '{1}{B}', cmc: 2,
    power: 0, toughness: 0,
  });
  const bearDef = makeDef('bear', {
    name: 'Grizzly Bears',
    type_line: 'Creature — Bear',
    card_types: ['creature'], colors: ['G'], mana_cost: '{1}{G}', cmc: 2,
    power: 2, toughness: 2,
  });

  it('parses to DealDamage with namesSelf filter', () => {
    const parsed = parseOracleText(PLAGUE_RATS_ORACLE);
    expect(parsed.kind).not.toBe('Unparsed');
    if (parsed.kind === 'Unparsed' || parsed.kind !== 'Spell') return;
    const dmg = parsed.effects.find(e => e.kind === 'DealDamage');
    expect(dmg).toBeDefined();
    if (!dmg || dmg.kind !== 'DealDamage') return;
    const amount = dmg.amount as ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.filter?.namesSelf).toBe(true);
    expect(amount.zone).toBe('battlefield');
    expect(amount.controller).toBe('each');
  });

  it('damage = 3 when 3 Plague Rats are on the battlefield', () => {
    // 3 Plague Rats on the battlefield; spell source is one of them (rats_1)
    const cards = [
      makeCard('rats_1', 'plague_rats', 'p1'),
      makeCard('rats_2', 'plague_rats', 'p1'),
      makeCard('rats_3', 'plague_rats', 'p2'),
      makeCard('target_bear', 'bear', 'p2'),
    ];
    const state = makeState(cards, [ratsDef, bearDef]);
    const parsed = parseOracleText(PLAGUE_RATS_ORACLE);
    if (parsed.kind === 'Unparsed' || parsed.kind !== 'Spell') return;
    const newState = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['target_bear'],
      parsed.targets,
      0,
      { sourceInstanceId: 'rats_1' },
    );
    const target = newState.cards.get('target_bear');
    // 3 Plague Rats on battlefield → 3 damage
    expect(target?.damage).toBe(3);
  });

  it('damage = 1 when only 1 Plague Rat is on the battlefield', () => {
    const cards = [
      makeCard('rats_solo', 'plague_rats', 'p1'),
      makeCard('target_bear2', 'bear', 'p2'),
    ];
    const state = makeState(cards, [ratsDef, bearDef]);
    const parsed = parseOracleText(PLAGUE_RATS_ORACLE);
    if (parsed.kind === 'Unparsed' || parsed.kind !== 'Spell') return;
    const newState = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['target_bear2'],
      parsed.targets,
      0,
      { sourceInstanceId: 'rats_solo' },
    );
    const target = newState.cards.get('target_bear2');
    expect(target?.damage).toBe(1);
  });

  it('different-named creature does NOT count as named ~ (Grizzly Bears ≠ Plague Rats)', () => {
    // Grizzly Bears are on battlefield but not named Plague Rats
    const cards = [
      makeCard('rats_only', 'plague_rats', 'p1'),
      makeCard('bear_1', 'bear', 'p2'),
      makeCard('bear_2', 'bear', 'p2'),
      makeCard('target_bear3', 'bear', 'p2'),
    ];
    const state = makeState(cards, [ratsDef, bearDef]);
    const parsed = parseOracleText(PLAGUE_RATS_ORACLE);
    if (parsed.kind === 'Unparsed' || parsed.kind !== 'Spell') return;
    const newState = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['target_bear3'],
      parsed.targets,
      0,
      { sourceInstanceId: 'rats_only' },
    );
    const target = newState.cards.get('target_bear3');
    // Only 1 Plague Rat on battlefield (the bears don't count)
    expect(target?.damage).toBe(1);
  });
});
