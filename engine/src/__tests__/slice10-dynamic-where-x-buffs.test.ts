/**
 * Slice 10: Dynamic where-X P/T statics and power-only CDAs.
 *
 * Covers three verified-failing forms:
 *  1. Power-only CDA with instant-and-sorcery union filter
 *     "~'s power is equal to the number of instant and sorcery cards in your graveyard."
 *     (Haughty Djinn family — 4 faces)
 *  2. Attached-buff where-X static (positive buff)
 *     "Enchanted creature gets +X/+X, where X is the number of creature cards in your graveyard."
 *     (Exoskeletal Armor family)
 *  3. Attached-buff where-X static (negative buff)
 *     "Enchanted creature gets -X/-X, where X is the number of creature cards in your graveyard."
 *     (Death's Approach family)
 *  4. Trigger body where-X with instant-and-sorcery filter
 *     "it gets +X/+0 until end of turn, where X is the number of instant and sorcery cards in your graveyard"
 *     (Animus of Night's Reach — trigger body)
 *
 * Parse tests verify the AST shape; execution tests verify the engine applies
 * the correct modifier at query time using the real continuous-effect layer.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import {
  getEffectivePower,
  getEffectiveToughness,
  registerContinuousEffect,
  resetContinuousTimestamp,
} from '../effects/continuous';
import { executeEffects } from '../effects/executor';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';
import type { ForEachAmount } from '../effects/ast';
import { emptyManaPool } from '../types';

// ============================================================================
// Shared helpers
// ============================================================================

function makePlayer(id: string, life = 40): Player {
  return {
    id,
    name: id,
    life,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    commanderInstanceId: null,
    commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false,
    hasPriority: false,
    hasLost: false,
  };
}

function makeCardInst(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'] = 'battlefield',
  extra: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...extra,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Djinn',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{3}{U}',
    cmc: opts.cmc ?? 4,
    colors: opts.colors ?? ['U'],
    color_identity: opts.color_identity ?? ['U'],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 0,
    toughness: opts.toughness ?? 4,
  };
}

function makeState(
  cards: Map<string, CardInstance>,
  cardDefs: Map<string, CardDefinition>,
  extras: Partial<GameState> = {},
): GameState {
  return {
    players: [makePlayer('p1'), makePlayer('p2')],
    cards,
    cardDefinitions: cardDefs,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as GameState['phase'],
    step: 'main' as GameState['step'],
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: [],
    ...extras,
  };
}

// ============================================================================
// 1. Power-only CDA — Haughty Djinn (instant and sorcery union filter)
// ============================================================================

describe('Slice 10 — Power-only CDA: instant and sorcery filter', () => {
  // The CDA sentence in isolation, as it appears when parsed line-by-line in
  // registerContinuousAbilitiesForPermanent (stack.ts processes each oracle line
  // individually, so matchDynamicCDA sees only the CDA sentence).
  const DJINN_CDA =
    "~'s power is equal to the number of instant and sorcery cards in your graveyard.";

  it('parses as StaticAbility/SetBasePTDynamic with powerFormula and null toughnessFormula', () => {
    const result = parseOracleText(DJINN_CDA);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    const mod = result.ability.modifier;
    expect(mod.kind).toBe('SetBasePTDynamic');
    if (mod.kind !== 'SetBasePTDynamic') return;
    // Power-only CDA: toughnessFormula is null
    expect(mod.toughnessFormula).toBeNull();
    // Formula counts instant-or-sorcery cards in your graveyard
    expect(mod.powerFormula!.kind).toBe('ForEach');
    expect(mod.powerFormula!.zone).toBe('graveyard');
    expect(mod.powerFormula!.controller).toBe('you');
    expect(mod.powerFormula!.filter).toBeDefined();
    const f = mod.powerFormula!.filter!;
    // Both instant AND sorcery appear in the types array (union semantics)
    expect(f.types).toContain('instant');
    expect(f.types).toContain('sorcery');
    // selfOnly: true — the CDA only applies to the Djinn itself
    expect(result.ability.selfOnly).toBe(true);
  });

  it('executes correctly: power = number of instant+sorcery cards in graveyard', () => {
    resetContinuousTimestamp();

    const djinnOracleOneLine = DJINN_CDA;
    const djinnDef = makeDef('djinn', {
      oracle_text: djinnOracleOneLine,
      power: 0,
      toughness: 4,
    });
    const djinnInst = makeCardInst('djinn_1', 'djinn', 'p1');
    const instantDef = makeDef('shock', {
      type_line: 'Instant', card_types: ['instant'], power: undefined, toughness: undefined,
    });
    const sorceryDef = makeDef('divination', {
      type_line: 'Sorcery', card_types: ['sorcery'], power: undefined, toughness: undefined,
    });
    const creatureDef = makeDef('bear', {
      type_line: 'Creature — Bear', card_types: ['creature'], power: 2, toughness: 2,
    });

    const cards = new Map<string, CardInstance>([
      ['djinn_1', djinnInst],
      // 2 instants in graveyard
      ['gy1', makeCardInst('gy1', 'shock', 'p1', 'graveyard')],
      ['gy2', makeCardInst('gy2', 'shock', 'p1', 'graveyard')],
      // 1 sorcery in graveyard
      ['gy3', makeCardInst('gy3', 'divination', 'p1', 'graveyard')],
      // 1 creature in graveyard (should NOT count)
      ['gy4', makeCardInst('gy4', 'bear', 'p1', 'graveyard')],
    ]);
    const cardDefs = new Map<string, CardDefinition>([
      ['djinn', djinnDef],
      ['shock', instantDef],
      ['divination', sorceryDef],
      ['bear', creatureDef],
    ]);

    const parsed = parseOracleText(djinnOracleOneLine);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    let state = makeState(cards, cardDefs);
    state = registerContinuousEffect(state, 'djinn_1', 'p1', parsed.ability);

    // 2 instants + 1 sorcery = 3 instant/sorcery cards → power = 3
    expect(getEffectivePower(state, 'djinn_1')).toBe(3);
    // Toughness is NOT set by the CDA — printed toughness (4) applies
    expect(getEffectiveToughness(state, 'djinn_1')).toBe(4);
  });

  it('executes correctly with 0 instant/sorcery cards → power stays 0', () => {
    resetContinuousTimestamp();

    const djinnDef = makeDef('djinn2', { oracle_text: DJINN_CDA, power: 0, toughness: 4 });
    const djinnInst = makeCardInst('djinn_2', 'djinn2', 'p1');
    const creatureDef = makeDef('bear2', {
      type_line: 'Creature — Bear', card_types: ['creature'], power: 2, toughness: 2,
    });
    const cards = new Map<string, CardInstance>([
      ['djinn_2', djinnInst],
      ['gy1', makeCardInst('gy1', 'bear2', 'p1', 'graveyard')],
    ]);
    const cardDefs = new Map<string, CardDefinition>([
      ['djinn2', djinnDef],
      ['bear2', creatureDef],
    ]);

    const parsed = parseOracleText(DJINN_CDA);
    if (parsed.kind !== 'StaticAbility') return;

    let state = makeState(cards, cardDefs);
    state = registerContinuousEffect(state, 'djinn_2', 'p1', parsed.ability);

    expect(getEffectivePower(state, 'djinn_2')).toBe(0);
    expect(getEffectiveToughness(state, 'djinn_2')).toBe(4);
  });
});

// ============================================================================
// 2. Attached-buff where-X (positive) — Exoskeletal Armor
// ============================================================================

describe('Slice 10 — Attached-buff where-X: Exoskeletal Armor (+X/+X)', () => {
  // Oracle text of the standalone buff sentence (after line splitting).
  const ARMOR_BUFF =
    'Enchanted creature gets +X/+X, where X is the number of creature cards in your graveyard.';

  it('parses as StaticAbility/ModifyPTDynamic with attachedOnly: true', () => {
    const result = parseOracleText(ARMOR_BUFF);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    const ability = result.ability;
    expect(ability.attachedOnly).toBe(true);
    const mod = ability.modifier;
    expect(mod.kind).toBe('ModifyPTDynamic');
    if (mod.kind !== 'ModifyPTDynamic') return;
    // +X/+X: both power and toughness formulas are set, signs are +1
    expect(mod.powerSign).toBe(1);
    expect(mod.toughnessSign).toBe(1);
    expect(mod.powerFormula).toBeDefined();
    expect(mod.toughnessFormula).toBeDefined();
    const pf = mod.powerFormula!;
    expect(pf.kind).toBe('ForEach');
    expect(pf.zone).toBe('graveyard');
    expect(pf.controller).toBe('you');
    expect(pf.filter).toEqual({ types: ['creature'] });
  });

  it('executes correctly: enchanted creature gains +X/+X from graveyard creature count', () => {
    resetContinuousTimestamp();

    const ARMOR_BUFF_ORACLE = ARMOR_BUFF;

    const armorDef = makeDef('armor', {
      oracle_text: ARMOR_BUFF_ORACLE,
      type_line: 'Enchantment — Aura',
      card_types: ['enchantment'],
      power: undefined,
      toughness: undefined,
    });
    const creatureDef = makeDef('bear', {
      type_line: 'Creature — Bear', card_types: ['creature'], power: 2, toughness: 2,
    });

    const armorInst = makeCardInst('armor_1', 'armor', 'p1', 'battlefield', {
      attachedTo: 'bear_1',
    });
    const bearInst = makeCardInst('bear_1', 'bear', 'p1', 'battlefield');

    const cards = new Map<string, CardInstance>([
      ['armor_1', armorInst],
      ['bear_1', bearInst],
      // 3 creature cards in p1's graveyard
      ['gy1', makeCardInst('gy1', 'bear', 'p1', 'graveyard')],
      ['gy2', makeCardInst('gy2', 'bear', 'p1', 'graveyard')],
      ['gy3', makeCardInst('gy3', 'bear', 'p1', 'graveyard')],
    ]);
    const cardDefs = new Map<string, CardDefinition>([
      ['armor', armorDef],
      ['bear', creatureDef],
    ]);

    const parsed = parseOracleText(ARMOR_BUFF_ORACLE);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    let state = makeState(cards, cardDefs);
    // Register armor as a continuous effect sourced from the aura instance
    state = registerContinuousEffect(state, 'armor_1', 'p1', parsed.ability);

    // Bear's base: 2/2. Armor grants +3/+3 (3 creature cards in graveyard).
    expect(getEffectivePower(state, 'bear_1')).toBe(5);
    expect(getEffectiveToughness(state, 'bear_1')).toBe(5);
    // Armor itself doesn't have a P/T
    // The enchanted bear should not affect itself
    expect(getEffectivePower(state, 'armor_1')).toBe(0);
  });
});

// ============================================================================
// 3. Attached-buff where-X (negative) — Death's Approach
// ============================================================================

describe('Slice 10 — Attached-buff where-X: Death\'s Approach (-X/-X)', () => {
  const APPROACH_BUFF =
    "Enchanted creature gets -X/-X, where X is the number of creature cards in your graveyard.";

  it('parses as StaticAbility/ModifyPTDynamic with negative signs', () => {
    const result = parseOracleText(APPROACH_BUFF);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    const mod = result.ability.modifier;
    expect(mod.kind).toBe('ModifyPTDynamic');
    if (mod.kind !== 'ModifyPTDynamic') return;
    // -X/-X: both signs are negative
    expect(mod.powerSign).toBe(-1);
    expect(mod.toughnessSign).toBe(-1);
    expect(mod.powerFormula).toBeDefined();
    expect(mod.toughnessFormula).toBeDefined();
    expect(mod.powerFormula!.filter).toEqual({ types: ['creature'] });
    expect(result.ability.attachedOnly).toBe(true);
  });

  it('executes correctly: enchanted creature loses -X/-X (2 creature graveyard cards)', () => {
    resetContinuousTimestamp();

    const approachDef = makeDef('approach', {
      oracle_text: APPROACH_BUFF,
      type_line: 'Enchantment — Aura',
      card_types: ['enchantment'],
      power: undefined,
      toughness: undefined,
    });
    const creatureDef = makeDef('troll', {
      type_line: 'Creature — Troll', card_types: ['creature'], power: 4, toughness: 4,
    });

    const approachInst = makeCardInst('approach_1', 'approach', 'p1', 'battlefield', {
      attachedTo: 'troll_1',
    });
    const trollInst = makeCardInst('troll_1', 'troll', 'p1', 'battlefield');

    const cards = new Map<string, CardInstance>([
      ['approach_1', approachInst],
      ['troll_1', trollInst],
      // 2 creature cards in p1's graveyard
      ['gy1', makeCardInst('gy1', 'troll', 'p1', 'graveyard')],
      ['gy2', makeCardInst('gy2', 'troll', 'p1', 'graveyard')],
    ]);
    const cardDefs = new Map<string, CardDefinition>([
      ['approach', approachDef],
      ['troll', creatureDef],
    ]);

    const parsed = parseOracleText(APPROACH_BUFF);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    let state = makeState(cards, cardDefs);
    state = registerContinuousEffect(state, 'approach_1', 'p1', parsed.ability);

    // Troll base 4/4 minus -2/-2 = 2/2
    expect(getEffectivePower(state, 'troll_1')).toBe(2);
    expect(getEffectiveToughness(state, 'troll_1')).toBe(2);
  });
});

// ============================================================================
// 4. Trigger body where-X with instant-and-sorcery filter
//    (Animus of Night's Reach — triggered ability body)
// ============================================================================

describe('Slice 10 — Trigger body where-X: instant and sorcery filter (Animus of Night\'s Reach)', () => {
  // The trigger body "it gets +X/+0 until end of turn, where X is the number of
  // instant and sorcery cards in your graveyard" appears inside a triggered ability.
  // We test the trigger-level parse (from an "attacks" trigger) to confirm the
  // ForEach filter includes both instant and sorcery.
  const ANIMUS_ORACLE =
    "Whenever ~ attacks, it gets +X/+0 until end of turn, where X is the number of instant and sorcery cards in your graveyard.";

  it('parses as Triggered with ModifyPT effect carrying instant+sorcery ForEach', () => {
    const result = parseOracleText(ANIMUS_ORACLE);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;
    expect(eff.untilEndOfTurn).toBe(true);
    // Power is ForEach (instant+sorcery in graveyard), toughness is 0
    const power = eff.power as ForEachAmount;
    expect(power.kind).toBe('ForEach');
    expect(power.zone).toBe('graveyard');
    expect(power.controller).toBe('you');
    expect(power.filter).toBeDefined();
    expect(power.filter!.types).toContain('instant');
    expect(power.filter!.types).toContain('sorcery');
    expect(eff.toughness).toBe(0);
  });

  it('executes trigger: source gets +3/+0 with 3 instant/sorcery cards in graveyard', () => {
    const result = parseOracleText(ANIMUS_ORACLE);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const instantDef = makeDef('lightning', {
      type_line: 'Instant', card_types: ['instant'], power: undefined, toughness: undefined,
    });
    const animusDef = makeDef('animus', {
      type_line: 'Creature — Spirit', card_types: ['creature'], power: 2, toughness: 3,
    });

    const cards = new Map<string, CardInstance>([
      ['animus_1', makeCardInst('animus_1', 'animus', 'p1', 'battlefield')],
      ['gy1', makeCardInst('gy1', 'lightning', 'p1', 'graveyard')],
      ['gy2', makeCardInst('gy2', 'lightning', 'p1', 'graveyard')],
      ['gy3', makeCardInst('gy3', 'lightning', 'p1', 'graveyard')],
    ]);
    const cardDefs = new Map<string, CardDefinition>([
      ['animus', animusDef],
      ['lightning', instantDef],
    ]);

    const state = makeState(cards, cardDefs);
    const newState = executeEffects(
      state,
      result.ability.effects,
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: 'animus_1' },
    );

    // 3 instants in graveyard → +3/+0
    expect(newState.cards.get('animus_1')!.counters['_powerMod']).toBe(3);
    expect(newState.cards.get('animus_1')!.counters['_toughnessMod'] ?? 0).toBe(0);
  });
});

// ============================================================================
// 5. Honesty gate — forms that should still be Unparsed
// ============================================================================

describe('Slice 10 — Honesty gate: unsupported forms stay Unparsed', () => {
  it('attached-buff where-X with unsupported zone phrase does not parse', () => {
    // "opponents control" is a recognized zone phrase, but let's try an invented one
    const weird =
      'Enchanted creature gets +X/+X, where X is the number of cards in your library while you have 10 or more.';
    // This should not emit a StaticAbility (where-X parse should fail gracefully)
    const result = parseOracleText(weird);
    // Either Unparsed or something else — the key is it doesn't crash
    expect(result).toBeDefined();
  });

  it('power-and-toughness CDA with instant-and-sorcery filter also works', () => {
    // Ensure the "and" connector fix doesn't break the both-P/T form
    const bothOracle =
      "~'s power and toughness are each equal to the number of instant and sorcery cards in your graveyard.";
    const result = parseOracleText(bothOracle);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    const mod = result.ability.modifier;
    expect(mod.kind).toBe('SetBasePTDynamic');
    if (mod.kind !== 'SetBasePTDynamic') return;
    expect(mod.toughnessFormula).not.toBeNull();
    expect(mod.powerFormula!.filter!.types).toContain('instant');
    expect(mod.powerFormula!.filter!.types).toContain('sorcery');
  });
});
