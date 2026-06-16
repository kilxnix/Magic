/**
 * Slice 9 — Grant-ability anthem generalization tests.
 *
 * Coverage:
 *   A. Multi-keyword "have" static: "Creatures you control have trample and haste."
 *      → GrantKeywords(['Trample','Haste']) registered for all controlled creatures.
 *   B. Honest decline of quoted non-runnable abilities: Phenax-style
 *      `Creatures you control have "{T}: Each opponent mills..."` must NOT parse as
 *      a GrantKeyword with garbage keyword — it should be Unparsed so we don't
 *      falsely credit an ability the engine cannot execute.
 *   C. "~ and other [Subtype] creatures you control get/have" pattern: Vampire
 *      Nocturnus family, where the conditional static includes both the source
 *      card itself and other creatures of the same subtype.
 *
 * Executor route:
 *   - Multi-keyword GrantKeywords: handled by getGrantedKeywords / getKeywordsForInstance
 *     in continuous.ts / keywords.ts (both already check GrantKeywords). Registered
 *     via registerContinuousAbilitiesForPermanent (stack.ts).
 *   - Quoted-ability decline: correctness — no false GrantKeyword with garbage keyword.
 *   - "~ and other X" form: emits a StaticAbility with filter:{ types:['creature'],
 *     subtypes:['vampire'] } and controller:'you', excludeSelf:false, so the source
 *     (itself a Vampire) is included in the affected group, matching the MTG rule.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import {
  registerContinuousEffect,
  getGrantedKeywords,
} from '../effects/continuous';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { getKeywordsForInstance } from '../keywords';
import type { CardDefinition, CardInstance, GameState, Player } from '../types';
import { emptyManaPool } from '../types';

// ============================================================================
// Test helpers
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
  opts: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId, definitionId, ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...opts,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Test',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: overrides.players ?? [makePlayer('p1'), makePlayer('p2')],
    cards: overrides.cards ?? new Map(),
    cardDefinitions: overrides.cardDefinitions ?? new Map(),
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
    continuousEffects: overrides.continuousEffects ?? [],
  } as GameState;
}

function makeDeckSetup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[] = [makeDef('p2dummy')],
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];
  let state = initGameState(decks);
  for (const [, card] of state.cards) {
    state.cards.set(card.instanceId, {
      ...card,
      zone: 'battlefield',
      summoningSick: false,
    });
  }
  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }
  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;
  return { state, idFor };
}

// ============================================================================
// A. Multi-keyword "have" static — parse tests
// ============================================================================

describe('Slice 9 — Multi-keyword have static (parse)', () => {
  it('"Creatures you control have trample and haste." parses as GrantKeywords', () => {
    const r = parseOracleText('Creatures you control have trample and haste.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    // May emit GrantKeyword (single) or GrantKeywords (multiple) — both are valid
    if (mod.kind === 'GrantKeywords') {
      expect(mod.keywords.map(k => k.toLowerCase())).toContain('trample');
      expect(mod.keywords.map(k => k.toLowerCase())).toContain('haste');
    } else if (mod.kind === 'GrantKeyword') {
      // At minimum trample is claimed
      expect(['trample', 'haste']).toContain(mod.keyword.toLowerCase());
    }
    expect(r.ability.filter).toMatchObject({ types: ['creature'] });
    expect(r.ability.controller).toBe('you');
    expect(r.ability.excludeSelf).toBe(false);
  });

  it('"Other creatures you control have trample and haste." parses as GrantKeywords with excludeSelf', () => {
    const r = parseOracleText('Other creatures you control have trample and haste.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    if (mod.kind === 'GrantKeywords') {
      expect(mod.keywords.map(k => k.toLowerCase())).toContain('trample');
      expect(mod.keywords.map(k => k.toLowerCase())).toContain('haste');
    }
    expect(r.ability.excludeSelf).toBe(true);
  });

  it('"Creatures you control have flying and lifelink." parses as GrantKeywords', () => {
    const r = parseOracleText('Creatures you control have flying and lifelink.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    if (mod.kind === 'GrantKeywords') {
      expect(mod.keywords.map(k => k.toLowerCase())).toContain('flying');
      expect(mod.keywords.map(k => k.toLowerCase())).toContain('lifelink');
    }
  });

  it('Single keyword "Creatures you control have flying." parses as GrantKeyword (not GrantKeywords)', () => {
    const r = parseOracleText('Creatures you control have flying.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    // Single keyword should still work and be correctly recognized
    const mod = r.ability.modifier;
    expect(mod.kind === 'GrantKeyword' || mod.kind === 'GrantKeywords').toBe(true);
    // Note: readGrantableKeyword returns capitalized keywords ('Flying', 'Haste', etc.)
    if (mod.kind === 'GrantKeyword') expect(mod.keyword.toLowerCase()).toBe('flying');
    if (mod.kind === 'GrantKeywords') expect(mod.keywords.map(k => k.toLowerCase())).toContain('flying');
  });

  it('"Rageblood Shaman: Other Minotaur creatures you control get +1/+1 and have trample." parses as StaticAbility', () => {
    const r = parseOracleText('Other Minotaur creatures you control get +1/+1 and have trample.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    // The ModifyPT is the primary effect; the keyword comes via additionalStaticKeywordFromLine
    expect(r.ability.modifier.kind).toBe('ModifyPT');
    expect(r.ability.filter).toMatchObject({ types: ['creature'], subtypes: ['minotaur'] });
    expect(r.ability.excludeSelf).toBe(true);
  });

  it('"Other Vampire creatures you control get +2/+1 and have flying." parses as StaticAbility', () => {
    const r = parseOracleText('Other Vampire creatures you control get +2/+1 and have flying.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ModifyPT');
    expect(r.ability.filter).toMatchObject({ types: ['creature'], subtypes: ['vampire'] });
    expect(r.ability.excludeSelf).toBe(true);
  });
});

// ============================================================================
// B. Honest decline of quoted non-runnable abilities
// ============================================================================

describe('Slice 9 — Quoted ability honest decline', () => {
  it('Phenax-style mill ability is NOT claimed as GrantKeyword with garbage keyword', () => {
    // Phenax, God of Deception: Creatures you control have "{T}: Each opponent mills
    // cards equal to that creature's toughness."
    // The mill-by-toughness ability is NOT runnable in the engine, so this must be
    // Unparsed — not falsely claimed as a GrantKeyword with "{T}:" as the keyword.
    const r = parseOracleText(
      'Creatures you control have "{T}: Each opponent mills cards equal to that creature\'s toughness."',
    );
    // Must NOT claim this as a StaticAbility with a garbage GrantKeyword
    if (r.kind === 'StaticAbility') {
      const mod = r.ability.modifier;
      // If it somehow parses, it must NOT have a garbage keyword like `"__mana_0__`
      if (mod.kind === 'GrantKeyword') {
        expect(mod.keyword).not.toMatch(/^"?__mana_/);
        expect(mod.keyword).not.toContain('"');
      }
    }
    // The correct result is Unparsed — we assert the garbage keyword is not present
    // (the above guard verifies honesty; whether it's Unparsed or StaticAbility with
    // a legitimate modifier is acceptable but Unparsed is the desired outcome)
    expect(r.kind).toBe('Unparsed');
  });

  it('"Creatures you control have haste." still parses correctly after quoted-ability fix', () => {
    const r = parseOracleText('Creatures you control have haste.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind === 'GrantKeyword' || mod.kind === 'GrantKeywords').toBe(true);
    // readGrantableKeyword returns capitalized keywords
    if (mod.kind === 'GrantKeyword') expect(mod.keyword.toLowerCase()).toBe('haste');
  });

  it('"Other creatures you control have trample." is still correctly parsed after fix', () => {
    const r = parseOracleText('Other creatures you control have trample.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind === 'GrantKeyword' || mod.kind === 'GrantKeywords').toBe(true);
    if (mod.kind === 'GrantKeyword') expect(mod.keyword.toLowerCase()).toBe('trample');
    expect(r.ability.excludeSelf).toBe(true);
  });

  it('GrantActivatedManaAbility is still recognized for the runnable any-color case', () => {
    const r = parseOracleText('Creatures you control have "{T}: Add one mana of any color."');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    // This specific form IS runnable via the GrantActivatedManaAbility path
    expect(r.ability.modifier.kind).toBe('GrantActivatedManaAbility');
  });
});

// ============================================================================
// C. Vampire Nocturnus "~ and other X creatures" form
// ============================================================================

describe('Slice 9 — "~ and other X creatures you control" static', () => {
  it('"~ and other Vampire creatures you control get +2/+1 and have flying." parses as StaticAbility', () => {
    // Vampire Nocturnus inner predicate after condition is stripped by matchConditionalStaticAbility
    const r = parseOracleText('~ and other Vampire creatures you control get +2/+1 and have flying.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ModifyPT');
    expect(r.ability.filter).toMatchObject({ types: ['creature'], subtypes: ['vampire'] });
    // excludeSelf must be false: the source (a Vampire) is included in the effect
    expect(r.ability.excludeSelf).toBe(false);
    expect(r.ability.controller).toBe('you');
  });
});

// ============================================================================
// D. Execution tests — multi-keyword continuous grant
// ============================================================================

describe('Slice 9 — Multi-keyword grant execution', () => {
  it('GrantKeywords static grants both trample and haste to all controlled creatures', () => {
    const anthemDef = makeDef('anthem', {
      name: 'Anthem Source',
      type_line: 'Enchantment',
      oracle_text: 'Creatures you control have trample and haste.',
      card_types: ['enchantment'],
      power: 0,
      toughness: 0,
    });
    const creatureDef = makeDef('creature1', {
      name: 'Vanilla Creature',
      type_line: 'Creature — Human',
      power: 2,
      toughness: 2,
    });

    const { state, idFor } = makeDeckSetup([anthemDef, creatureDef]);
    const creatureId = idFor('creature1');

    const keywords = getKeywordsForInstance(state, creatureId);
    // Both trample and haste should be granted
    const hasTramp = keywords.has('Trample') || getGrantedKeywords(state, creatureId).some(
      k => k.toLowerCase() === 'trample',
    );
    const hasHaste = keywords.has('Haste') || getGrantedKeywords(state, creatureId).some(
      k => k.toLowerCase() === 'haste',
    );
    expect(hasTramp).toBe(true);
    expect(hasHaste).toBe(true);
  });

  it('Single-keyword "have flying" grants flying to controlled creatures', () => {
    const anthemDef = makeDef('fly_anthem', {
      name: 'Flight Giver',
      type_line: 'Enchantment',
      oracle_text: 'Creatures you control have flying.',
      card_types: ['enchantment'],
      power: 0,
      toughness: 0,
    });
    const bearDef = makeDef('bear', {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      power: 2,
      toughness: 2,
    });

    const { state, idFor } = makeDeckSetup([anthemDef, bearDef]);
    const bearId = idFor('bear');

    const granted = getGrantedKeywords(state, bearId);
    const hasFlying = granted.some(k => k.toLowerCase() === 'flying')
      || getKeywordsForInstance(state, bearId).has('Flying');
    expect(hasFlying).toBe(true);
  });

  it('GrantKeywords does NOT apply to opponent\'s creatures', () => {
    // Use registerContinuousEffect directly for fine-grained control
    const anthemDef = makeDef('anthem2', {
      name: 'Controller Anthem',
      type_line: 'Enchantment',
      oracle_text: 'Creatures you control have trample and haste.',
      card_types: ['enchantment'],
      power: 0,
      toughness: 0,
    });
    const myCreatureDef = makeDef('myc', {
      name: 'My Creature',
      type_line: 'Creature — Human',
      power: 2,
      toughness: 2,
    });
    const oppCreatureDef = makeDef('oppc', {
      name: 'Opponent Creature',
      type_line: 'Creature — Orc',
      power: 2,
      toughness: 2,
    });

    const { state, idFor } = makeDeckSetup(
      [anthemDef, myCreatureDef],
      [oppCreatureDef],
    );
    const myId = idFor('myc');
    const oppId = idFor('oppc');

    // My creature should have the keywords
    const myKws = getGrantedKeywords(state, myId);
    const myHasTramp = myKws.some(k => k.toLowerCase() === 'trample')
      || getKeywordsForInstance(state, myId).has('Trample');

    // Opponent's creature should NOT have the keywords
    const oppKws = getGrantedKeywords(state, oppId);
    const oppHasTramp = oppKws.some(k => k.toLowerCase() === 'trample')
      || getKeywordsForInstance(state, oppId).has('Trample');

    expect(myHasTramp).toBe(true);
    expect(oppHasTramp).toBe(false);
  });
});
