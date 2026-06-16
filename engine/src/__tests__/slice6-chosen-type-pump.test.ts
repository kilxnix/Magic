/**
 * Slice 6 — "Choose a creature type. Creatures you control of the chosen type
 * get +N/+M [and gain <keyword>] until end of turn." spell-pump family.
 *
 * Example card: "And They Shall Know No Fear"
 * Oracle: "Choose a creature type. Creatures you control of the chosen type get
 * +1/+0 and gain indestructible until end of turn."
 *
 * Tests:
 *  1. Parses as Spell (not Unparsed)
 *  2. Emits ModifyPT effect with chosenCreatureTypeFromCastTime:true filter
 *  3. Emits GrantKeyword effect (indestructible) with same filter
 *  4. Execution: only creatures of the chosen type get the P/T buff
 *  5. Execution: keyword (indestructible) granted only to chosen-type creatures
 *  6. Execution: no chosenCreatureType supplied → no creature buffed (safe no-op)
 *  7. Parse without leading "choose a creature type" sentence (buff-only clause)
 *  8. Execution with multiple creatures of chosen type — all get buffed
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';
import type { ModifyPTEffect, GrantKeywordEffect } from '../effects/ast';

// ── oracle text constants ──────────────────────────────────────────────────────

/** Full "And They Shall Know No Fear" pattern — leading choose sentence + buff. */
const AND_THEY_SHALL_KNOW_NO_FEAR =
  'Choose a creature type. Creatures you control of the chosen type get +1/+0 and gain indestructible until end of turn.';

/** Buff clause only, no leading choose sentence (the half-clause form). */
const BUFF_CLAUSE_ONLY =
  'Creatures you control of the chosen type get +2/+2 until end of turn.';

/** Patriarch's Bidding style: PT only, no keyword. */
const PT_ONLY =
  'Choose a creature type. Creatures you control of the chosen type get +1/+1 until end of turn.';

// ── helpers ───────────────────────────────────────────────────────────────────

function makePlayer(id: string): Player {
  return {
    id, name: id, life: 20,
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
  zone: CardInstance['zone'] = 'battlefield',
  extra: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
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
    mana_cost: opts.mana_cost || '',
    cmc: opts.cmc || 0,
    colors: opts.colors || [],
    color_identity: opts.color_identity || [],
    keywords: opts.keywords || [],
    card_types: opts.card_types || ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeState(
  cards: Map<string, CardInstance>,
  cardDefinitions: Map<string, CardDefinition>,
): GameState {
  return {
    players: [makePlayer('p1'), makePlayer('p2')],
    cards,
    cardDefinitions,
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
    continuousEffects: [],
  };
}

/** Build a state with a Goblin and an Elf on the battlefield under p1's control. */
function buildState() {
  const defs = new Map<string, CardDefinition>([
    ['goblin_def', makeDef('goblin_def', {
      name: 'Goblin Test',
      type_line: 'Creature - Goblin',
      power: 1,
      toughness: 1,
    })],
    ['elf_def', makeDef('elf_def', {
      name: 'Elf Test',
      type_line: 'Creature - Elf',
      power: 1,
      toughness: 1,
    })],
    ['goblin2_def', makeDef('goblin2_def', {
      name: 'Goblin Test 2',
      type_line: 'Creature - Goblin',
      power: 2,
      toughness: 1,
    })],
  ]);

  const cards = new Map<string, CardInstance>([
    ['goblin', makeCard('goblin', 'goblin_def', 'p1')],
    ['elf', makeCard('elf', 'elf_def', 'p1')],
    ['goblin2', makeCard('goblin2', 'goblin2_def', 'p1')],
  ]);

  return makeState(cards, defs);
}

function runSpell(
  oracleText: string,
  state: GameState,
  namedCardChoices: Record<string, string> = {},
): GameState {
  const parsed = parseOracleText(oracleText);
  if (parsed.kind !== 'Spell') throw new Error(`Expected Spell, got ${parsed.kind}`);
  return executeEffects(state, parsed.effects, 'p1', [], [], 0,
    { namedCardChoices });
}

// ── 1. Parse tests ────────────────────────────────────────────────────────────

describe('Slice 6 chosen-type pump: parse', () => {
  it('1. full "choose a creature type ... get +1/+0 and gain indestructible" parses as Spell', () => {
    const parsed = parseOracleText(AND_THEY_SHALL_KNOW_NO_FEAR);
    expect(parsed.kind).toBe('Spell');
  });

  it('2. emits ModifyPT effect with chosenCreatureTypeFromCastTime:true filter', () => {
    const parsed = parseOracleText(AND_THEY_SHALL_KNOW_NO_FEAR);
    if (parsed.kind !== 'Spell') throw new Error(`Expected Spell, got ${parsed.kind}`);
    const modPT = parsed.effects.find(e => e.kind === 'ModifyPT') as ModifyPTEffect | undefined;
    expect(modPT).toBeDefined();
    if (!modPT) return;
    expect(modPT.power).toBe(1);
    expect(modPT.toughness).toBe(0);
    expect(modPT.untilEndOfTurn).toBe(true);
    expect(modPT.target.kind).toBe('AllCreaturesYouControlMatching');
    if (modPT.target.kind !== 'AllCreaturesYouControlMatching') return;
    expect(modPT.target.filter.chosenCreatureTypeFromCastTime).toBe(true);
    expect(modPT.target.filter.types).toContain('creature');
  });

  it('3. emits GrantKeyword(Indestructible) effect with same chosenCreatureTypeFromCastTime filter', () => {
    const parsed = parseOracleText(AND_THEY_SHALL_KNOW_NO_FEAR);
    if (parsed.kind !== 'Spell') throw new Error(`Expected Spell, got ${parsed.kind}`);
    const grantKw = parsed.effects.find(e => e.kind === 'GrantKeyword') as GrantKeywordEffect | undefined;
    expect(grantKw).toBeDefined();
    if (!grantKw) return;
    // GRANTABLE_KEYWORDS stores keywords Title-cased: 'indestructible' -> 'Indestructible'
    expect(grantKw.keyword).toBe('Indestructible');
    expect(grantKw.untilEndOfTurn).toBe(true);
    expect(grantKw.target.kind).toBe('AllCreaturesYouControlMatching');
    if (grantKw.target.kind !== 'AllCreaturesYouControlMatching') return;
    expect(grantKw.target.filter.chosenCreatureTypeFromCastTime).toBe(true);
  });

  it('7. buff-clause-only form (no leading choose sentence) also parses as Spell', () => {
    const parsed = parseOracleText(BUFF_CLAUSE_ONLY);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const modPT = parsed.effects.find(e => e.kind === 'ModifyPT') as ModifyPTEffect | undefined;
    expect(modPT).toBeDefined();
    if (!modPT) return;
    expect(modPT.power).toBe(2);
    expect(modPT.toughness).toBe(2);
  });

  it('PT-only form (no keyword) parses as Spell', () => {
    const parsed = parseOracleText(PT_ONLY);
    expect(parsed.kind).toBe('Spell');
  });
});

// ── 4-8. Executor tests ───────────────────────────────────────────────────────

describe('Slice 6 chosen-type pump: execution', () => {
  it('4. chosenCreatureType=Goblin buffs Goblin, does NOT buff Elf', () => {
    const state = buildState();
    const after = runSpell(AND_THEY_SHALL_KNOW_NO_FEAR, state, { chosenCreatureType: 'Goblin' });

    // PT modifications stored in counters: '_powerMod' / '_toughnessMod'
    const goblin = after.cards.get('goblin');
    expect(goblin?.counters['_powerMod']).toBe(1);
    expect(goblin?.counters['_toughnessMod']).toBe(0);

    // Elf should have no power mod counter
    const elf = after.cards.get('elf');
    expect(elf?.counters['_powerMod'] ?? 0).toBe(0);
  });

  it('5. keyword (Indestructible) granted only to creatures of chosen type', () => {
    const state = buildState();
    const after = runSpell(AND_THEY_SHALL_KNOW_NO_FEAR, state, { chosenCreatureType: 'Goblin' });

    // Keywords stored in grantedKeywords array (Title-cased)
    const goblin = after.cards.get('goblin');
    expect(goblin?.grantedKeywords?.includes('Indestructible')).toBe(true);

    const elf = after.cards.get('elf');
    expect(elf?.grantedKeywords?.includes('Indestructible')).toBeFalsy();
  });

  it('6. no chosenCreatureType supplied → no creature buffed (safe no-op)', () => {
    const state = buildState();
    const after = runSpell(AND_THEY_SHALL_KNOW_NO_FEAR, state, {});

    // Neither creature should have gained the PT modifier
    const goblin = after.cards.get('goblin');
    const elf = after.cards.get('elf');
    expect(goblin?.counters['_powerMod'] ?? 0).toBe(0);
    expect(elf?.counters['_powerMod'] ?? 0).toBe(0);
    // Neither should have keyword
    expect(goblin?.grantedKeywords?.includes('Indestructible')).toBeFalsy();
    expect(elf?.grantedKeywords?.includes('Indestructible')).toBeFalsy();
  });

  it('8. all creatures of chosen type get buffed (multiple Goblins)', () => {
    const state = buildState();
    const after = runSpell(AND_THEY_SHALL_KNOW_NO_FEAR, state, { chosenCreatureType: 'Goblin' });

    // Both goblin and goblin2 should be buffed
    const goblin = after.cards.get('goblin');
    const goblin2 = after.cards.get('goblin2');
    expect(goblin?.counters['_powerMod']).toBe(1);
    expect(goblin2?.counters['_powerMod']).toBe(1);

    // Elf not buffed
    const elf = after.cards.get('elf');
    expect(elf?.counters['_powerMod'] ?? 0).toBe(0);
  });

  it('choosing Elf buffs Elf, leaves Goblins alone', () => {
    const state = buildState();
    const after = runSpell(AND_THEY_SHALL_KNOW_NO_FEAR, state, { chosenCreatureType: 'Elf' });

    const elf = after.cards.get('elf');
    expect(elf?.counters['_powerMod']).toBe(1);
    expect(elf?.grantedKeywords?.includes('Indestructible')).toBe(true);

    const goblin = after.cards.get('goblin');
    expect(goblin?.counters['_powerMod'] ?? 0).toBe(0);
    expect(goblin?.grantedKeywords?.includes('Indestructible')).toBeFalsy();
  });
});
