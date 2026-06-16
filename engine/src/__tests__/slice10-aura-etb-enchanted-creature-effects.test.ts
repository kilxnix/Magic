/**
 * Slice 10 — Aura ETB attached-subject effects
 *
 * Covers three new "enchanted creature" subject matchers that fire inside Aura
 * ETB trigger bodies, routing the effect to the creature the Aura is attached to
 * (SourceAttachedTo target ref):
 *
 *  1. matchEnchantedCreatureGrantKeyword  — "enchanted creature gains <kw>[, <kw>][ and <kw>] [until end of turn]"
 *     Cards: Starlit Mantle, Aspect of Manticore, Fire-Rim Form, Gilt-Leaf's Embrace,
 *            Aquitect's Defenses, Cradle of Safety, Military Discipline, Fae Flight
 *
 *  2. matchEnchantedCreatureFight  — "enchanted creature fights up to one target creature [you don't control / an opponent controls]"
 *     Cards: Pitiless Fists, Warbriar Blessing, Meltstrider's Resolve
 *
 *  3. matchEnchantedCreatureDealsDamageByPower  — "enchanted creature deals damage equal to its power to any [other] target"
 *     Cards: Pain for All
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { instanceHasKeyword } from '../keywords';
import { initGameState } from '../game-state';
import type {
  Effect,
  GrantKeywordEffect,
  FightEffect,
  DealDamageEffect,
} from '../effects/ast';
import type { CardDefinition, GameState, CardInstance } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function etbEffects(oracle: string): Effect[] {
  const parsed = parseOracleText(oracle);
  if (parsed.kind !== 'ETB') {
    throw new Error(`Expected ETB parse, got ${parsed.kind} for: ${oracle}`);
  }
  return parsed.ability.effects;
}

function spellEffects(oracle: string): Effect[] {
  const parsed = parseOracleText(oracle);
  if (parsed.kind !== 'Spell') {
    throw new Error(`Expected Spell parse, got ${parsed.kind} for: ${oracle}`);
  }
  return parsed.effects;
}

function creatureDef(id: string, power = 2, toughness = 2): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Test',
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

function auraDef(id: string, oracle: string): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Enchantment — Aura',
    oracle_text: oracle,
    mana_cost: '{W}',
    cmc: 1,
    colors: ['W'],
    color_identity: ['W'],
    keywords: [],
    card_types: ['enchantment'],
  };
}

function setup(p1Defs: CardDefinition[], p2Defs: CardDefinition[]) {
  const state = initGameState([
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ]);
  return state;
}

function moveToZone(state: GameState, instanceId: string, zone: 'battlefield'): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone, summoningSick: false });
  return { ...state, cards: newCards };
}

function findCard(state: GameState, defId: string): CardInstance {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  throw new Error(`Card not found by defId: ${defId}`);
}

/** Attach aura to creature by setting attachedTo on the aura instance. */
function attachAuraToCreature(state: GameState, auraInstanceId: string, creatureInstanceId: string): GameState {
  const aura = state.cards.get(auraInstanceId);
  if (!aura) throw new Error('Aura not found');
  const newCards = new Map(state.cards);
  newCards.set(auraInstanceId, { ...aura, attachedTo: creatureInstanceId });
  return { ...state, cards: newCards };
}

// ── Part 1: matchEnchantedCreatureGrantKeyword — parse ────────────────────────

describe('Slice 10: enchanted creature grant keyword — parse', () => {
  it('parses Starlit Mantle ETB as a GrantKeyword{Hexproof}+GrantKeyword{Indestructible} pair', () => {
    // "When this Aura enters, enchanted creature gains hexproof and indestructible until end of turn."
    const effects = etbEffects(
      'When ~ enters, enchanted creature gains hexproof and indestructible until end of turn.',
    );
    expect(effects).toHaveLength(2);
    const [e1, e2] = effects as GrantKeywordEffect[];
    expect(e1.kind).toBe('GrantKeyword');
    expect(e1.target).toEqual({ kind: 'SourceAttachedTo' });
    expect(e1.keyword).toBe('Hexproof');
    expect(e1.untilEndOfTurn).toBe(true);
    expect(e2.kind).toBe('GrantKeyword');
    expect(e2.target).toEqual({ kind: 'SourceAttachedTo' });
    expect(e2.keyword).toBe('Indestructible');
    expect(e2.untilEndOfTurn).toBe(true);
  });

  it('parses Aspect of Manticore single-keyword form (gains first strike until end of turn)', () => {
    // "When this Aura enters, enchanted creature gains first strike until end of turn."
    const effects = etbEffects(
      'When ~ enters, enchanted creature gains first strike until end of turn.',
    );
    expect(effects).toHaveLength(1);
    const e = effects[0] as GrantKeywordEffect;
    expect(e.kind).toBe('GrantKeyword');
    expect(e.target).toEqual({ kind: 'SourceAttachedTo' });
    expect(e.keyword).toBe('First Strike');
    expect(e.untilEndOfTurn).toBe(true);
  });

  it('parses Gilt-Leaf\'s Embrace / Fae Flight (gains flying and trample until end of turn)', () => {
    const effects = etbEffects(
      "When ~ enters, enchanted creature gains flying and trample until end of turn.",
    );
    expect(effects).toHaveLength(2);
    const kws = (effects as GrantKeywordEffect[]).map(e => e.keyword);
    expect(kws).toContain('Flying');
    expect(kws).toContain('Trample');
    for (const e of effects as GrantKeywordEffect[]) {
      expect(e.target).toEqual({ kind: 'SourceAttachedTo' });
      expect(e.untilEndOfTurn).toBe(true);
    }
  });

  it('parses a three-keyword list (gains hexproof, first strike, and trample)', () => {
    const effects = etbEffects(
      'When ~ enters, enchanted creature gains hexproof, first strike, and trample until end of turn.',
    );
    expect(effects).toHaveLength(3);
    const kws = (effects as GrantKeywordEffect[]).map(e => e.keyword);
    expect(kws).toContain('Hexproof');
    expect(kws).toContain('First Strike');
    expect(kws).toContain('Trample');
  });

  it('parses the bare "enchanted creature gains hexproof" clause (no duration) inside an ETB trigger', () => {
    // Without the ETB trigger prefix this reads as a static-ability Aura buff, which is correct.
    // Inside a trigger body it must parse as GrantKeyword{SourceAttachedTo}.
    const effects = etbEffects('When ~ enters, enchanted creature gains hexproof.');
    expect(effects).toHaveLength(1);
    const e = effects[0] as GrantKeywordEffect;
    expect(e.kind).toBe('GrantKeyword');
    expect(e.target).toEqual({ kind: 'SourceAttachedTo' });
    expect(e.keyword).toBe('Hexproof');
    expect(e.untilEndOfTurn).toBe(false);
  });
});

// ── Part 2: matchEnchantedCreatureFight — parse ───────────────────────────────

describe('Slice 10: enchanted creature fight — parse', () => {
  it('parses Pitiless Fists ETB fight (no qualifier)', () => {
    const effects = etbEffects(
      'When ~ enters, enchanted creature fights up to one target creature.',
    );
    expect(effects).toHaveLength(1);
    const e = effects[0] as FightEffect;
    expect(e.kind).toBe('Fight');
    expect(e.fighterA).toEqual({ kind: 'SourceAttachedTo' });
    expect(e.fighterB.kind).toBe('Chosen');
    // The target should be optional (up-to-one)
    const parsed = parseOracleText(
      'When ~ enters, enchanted creature fights up to one target creature.',
    );
    if (parsed.kind === 'ETB') {
      expect(parsed.targets[0]?.minCount).toBe(0);
    }
  });

  it('parses Warbriar Blessing ETB fight (you don\'t control qualifier)', () => {
    const effects = etbEffects(
      "When ~ enters, enchanted creature fights up to one target creature you don't control.",
    );
    expect(effects).toHaveLength(1);
    const e = effects[0] as FightEffect;
    expect(e.kind).toBe('Fight');
    expect(e.fighterA).toEqual({ kind: 'SourceAttachedTo' });
    expect(e.fighterB.kind).toBe('Chosen');
    const parsed = parseOracleText(
      "When ~ enters, enchanted creature fights up to one target creature you don't control.",
    );
    if (parsed.kind === 'ETB') {
      expect(parsed.targets[0]?.constraints?.opponentControls).toBe(true);
    }
  });

  it('parses Meltstrider\'s Resolve (an opponent controls qualifier)', () => {
    const effects = etbEffects(
      "When ~ enters, enchanted creature fights up to one target creature an opponent controls.",
    );
    expect(effects).toHaveLength(1);
    const e = effects[0] as FightEffect;
    expect(e.fighterA).toEqual({ kind: 'SourceAttachedTo' });
    const parsed = parseOracleText(
      "When ~ enters, enchanted creature fights up to one target creature an opponent controls.",
    );
    if (parsed.kind === 'ETB') {
      expect(parsed.targets[0]?.constraints?.opponentControls).toBe(true);
    }
  });
});

// ── Part 3: matchEnchantedCreatureDealsDamageByPower — parse ─────────────────

describe('Slice 10: enchanted creature deals damage equal to its power — parse', () => {
  it('parses Pain for All ETB (any other target)', () => {
    const effects = etbEffects(
      'When ~ enters, enchanted creature deals damage equal to its power to any other target.',
    );
    expect(effects).toHaveLength(1);
    const e = effects[0] as DealDamageEffect;
    expect(e.kind).toBe('DealDamage');
    expect(e.target.kind).toBe('Chosen');
    expect(e.amount).toMatchObject({ kind: 'TargetPower', target: { kind: 'SourceAttachedTo' } });
    // Target spec should be Any
    const parsed = parseOracleText(
      'When ~ enters, enchanted creature deals damage equal to its power to any other target.',
    );
    if (parsed.kind === 'ETB') {
      expect(parsed.targets[0]?.type).toBe('Any');
    }
  });

  it('also parses the "any target" form (without "other")', () => {
    const effects = etbEffects(
      'When ~ enters, enchanted creature deals damage equal to its power to any target.',
    );
    expect(effects).toHaveLength(1);
    const e = effects[0] as DealDamageEffect;
    expect(e.kind).toBe('DealDamage');
    expect(e.amount).toMatchObject({ kind: 'TargetPower', target: { kind: 'SourceAttachedTo' } });
  });
});

// ── Part 4: Execution tests ───────────────────────────────────────────────────

describe('Slice 10: execution — enchanted creature gains keyword', () => {
  it('grants keyword to the attached creature (Hexproof) via SourceAttachedTo', () => {
    // Set up: creature on battlefield, Aura attached to it, execute GrantKeyword.
    const creature = creatureDef('bear', 2, 2);
    const aura = auraDef('starlit-mantle', 'When ~ enters, enchanted creature gains hexproof and indestructible until end of turn.');

    let state = setup([creature, aura], [creatureDef('blocker', 1, 1)]);

    const bearInst = findCard(state, 'bear');
    const auraInst = findCard(state, 'starlit-mantle');

    state = moveToZone(state, bearInst.instanceId, 'battlefield');
    state = moveToZone(state, auraInst.instanceId, 'battlefield');
    state = attachAuraToCreature(state, auraInst.instanceId, bearInst.instanceId);

    // Verify the Aura is properly attached
    expect(state.cards.get(auraInst.instanceId)!.attachedTo).toBe(bearInst.instanceId);

    // Bear should not have Hexproof yet
    expect(instanceHasKeyword(state, bearInst.instanceId, 'Hexproof')).toBe(false);

    // Build the ETB effect from oracle text
    const parsed = parseOracleText(
      'When ~ enters, enchanted creature gains hexproof and indestructible until end of turn.',
    );
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;

    const { effects, targets } = { effects: parsed.ability.effects, targets: parsed.targets };

    // Execute the effects with aura as source (provides sourceInstanceId)
    state = executeEffects(state, effects, 'p1', [], targets, 0, {
      sourceInstanceId: auraInst.instanceId,
    });

    // The bear should now have both keywords
    expect(instanceHasKeyword(state, bearInst.instanceId, 'Hexproof')).toBe(true);
    expect(instanceHasKeyword(state, bearInst.instanceId, 'Indestructible')).toBe(true);
  });
});

describe('Slice 10: execution — enchanted creature fights (Warbriar Blessing)', () => {
  it('enchanted creature deals and receives damage from the target creature', () => {
    const bear = creatureDef('bear', 3, 3);   // attacker (attached-to)
    const aura = auraDef('warbriar-blessing', "When ~ enters, enchanted creature fights up to one target creature you don't control.");
    const enemy = creatureDef('goblin', 1, 1); // enemy creature to fight

    let state = setup([bear, aura], [enemy]);

    const bearInst = findCard(state, 'bear');
    const auraInst = findCard(state, 'warbriar-blessing');
    const enemyInst = findCard(state, 'goblin');

    state = moveToZone(state, bearInst.instanceId, 'battlefield');
    state = moveToZone(state, auraInst.instanceId, 'battlefield');
    state = moveToZone(state, enemyInst.instanceId, 'battlefield');
    state = attachAuraToCreature(state, auraInst.instanceId, bearInst.instanceId);

    const parsed = parseOracleText(
      "When ~ enters, enchanted creature fights up to one target creature you don't control.",
    );
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;

    const { effects, targets } = { effects: parsed.ability.effects, targets: parsed.targets };
    // Target spec for the enemy creature
    expect(targets).toHaveLength(1);
    const targetSpec = targets[0];

    // Execute with the enemy as the chosen fight target
    state = executeEffects(state, effects, 'p1', [enemyInst.instanceId], [targetSpec], 0, {
      sourceInstanceId: auraInst.instanceId,
    });

    // The goblin (1/1) should have taken 3 damage from the bear (3/3)
    const goblinAfter = state.cards.get(enemyInst.instanceId)!;
    expect(goblinAfter.damage).toBe(3);

    // The bear (3/3) should have taken 1 damage from the goblin (1/1)
    const bearAfter = state.cards.get(bearInst.instanceId)!;
    expect(bearAfter.damage).toBe(1);
  });

  it('skips the fight when no target is chosen (up-to-one optional fight)', () => {
    const bear = creatureDef('bear2', 3, 3);
    const aura = auraDef('aura2', "When ~ enters, enchanted creature fights up to one target creature you don't control.");

    let state = setup([bear, aura], []);

    const bearInst = findCard(state, 'bear2');
    const auraInst = findCard(state, 'aura2');
    state = moveToZone(state, bearInst.instanceId, 'battlefield');
    state = moveToZone(state, auraInst.instanceId, 'battlefield');
    state = attachAuraToCreature(state, auraInst.instanceId, bearInst.instanceId);

    const parsed = parseOracleText(
      "When ~ enters, enchanted creature fights up to one target creature you don't control.",
    );
    if (parsed.kind !== 'ETB') return;

    const { effects, targets } = { effects: parsed.ability.effects, targets: parsed.targets };

    // No target chosen — bear should take no damage
    state = executeEffects(state, effects, 'p1', [], [targets[0]], 0, {
      sourceInstanceId: auraInst.instanceId,
    });

    expect(state.cards.get(bearInst.instanceId)!.damage).toBe(0);
  });
});

describe('Slice 10: execution — enchanted creature deals damage equal to its power (Pain for All)', () => {
  it('deals damage equal to attached creature\'s power to the chosen target', () => {
    const attacker = creatureDef('dragon', 5, 5);   // 5/5 attached creature
    const aura = auraDef('pain-for-all', 'When ~ enters, enchanted creature deals damage equal to its power to any other target.');
    const enemy = creatureDef('soldier', 1, 1);

    let state = setup([attacker, aura], [enemy]);

    const attackerInst = findCard(state, 'dragon');
    const auraInst = findCard(state, 'pain-for-all');
    const enemyInst = findCard(state, 'soldier');

    state = moveToZone(state, attackerInst.instanceId, 'battlefield');
    state = moveToZone(state, auraInst.instanceId, 'battlefield');
    state = moveToZone(state, enemyInst.instanceId, 'battlefield');
    state = attachAuraToCreature(state, auraInst.instanceId, attackerInst.instanceId);

    const parsed = parseOracleText(
      'When ~ enters, enchanted creature deals damage equal to its power to any other target.',
    );
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;

    const { effects, targets } = { effects: parsed.ability.effects, targets: parsed.targets };
    expect(targets[0]?.type).toBe('Any');

    // Execute with enemy as the chosen target
    state = executeEffects(state, effects, 'p1', [enemyInst.instanceId], [targets[0]], 0, {
      sourceInstanceId: auraInst.instanceId,
    });

    // The soldier should have taken 5 damage (dragon's power)
    expect(state.cards.get(enemyInst.instanceId)!.damage).toBe(5);
    // The dragon should be unscathed
    expect(state.cards.get(attackerInst.instanceId)!.damage).toBe(0);
  });
});
