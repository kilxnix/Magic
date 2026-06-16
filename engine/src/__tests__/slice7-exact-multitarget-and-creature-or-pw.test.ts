import { describe, it, expect } from 'vitest';
import { executeEffects } from '../effects/executor';
import { parseOracleText } from '../effects/parser';
import type { GameState, CardInstance, CardDefinition } from '../types';

/**
 * Slice 7/12: Plain numeric multi-target + "creature or planeswalker" target unions.
 *
 * Gap 1 — exact-N multi-target (no "up to"):
 *   "Destroy two target enchantments."   (Peace and Quiet)
 *   "Destroy two target lands."          (Rain of Salt)
 *   "Tap two target creatures."          (Blinding Beam modal bullet)
 *
 * Gap 2 — "creature or planeswalker" union in one-sided damage by power:
 *   "Target creature you control deals damage equal to its power to target
 *    creature or planeswalker you don't control."  (Hard-Hitting Question / Earth Tremor)
 */

// ──────────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────────

function makeDef(
  id: string,
  overrides: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: 3,
    toughness: 3,
    card_types: ['creature'],
    ...overrides,
  } as CardDefinition;
}

function makeCard(
  instanceId: string,
  ownerId: string,
  definitionId: string,
  overrides: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...overrides,
  } as CardInstance;
}

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  const creatureDef = makeDef('def-creature');
  const enchantDef = makeDef('def-enchant', {
    type_line: 'Enchantment',
    card_types: ['enchantment'],
    power: undefined,
    toughness: undefined,
    mana_cost: '{W}',
    cmc: 1,
    colors: ['W'],
  });
  const landDef = makeDef('def-land', {
    type_line: 'Land',
    card_types: ['land'],
    power: undefined,
    toughness: undefined,
    mana_cost: '',
    cmc: 0,
    colors: [],
  });
  const planeswDef = makeDef('def-planeswalker', {
    name: 'Planeswalker Test',
    type_line: 'Planeswalker — Test',
    card_types: ['planeswalker'],
    power: undefined,
    toughness: undefined,
    mana_cost: '{3}{W}',
    cmc: 4,
    colors: ['W'],
  });

  cardDefinitions.set('def-creature', creatureDef);
  cardDefinitions.set('def-enchant', enchantDef);
  cardDefinitions.set('def-land', landDef);
  cardDefinitions.set('def-planeswalker', planeswDef);

  // player-1: c1 (creature, power 3), c2 (creature, power 4)
  // player-2: e1 (enchantment), e2 (enchantment), l1 (land), l2 (land), pw1 (planeswalker), c3 (creature)
  cards.set('c1', makeCard('c1', 'player-1', 'def-creature'));
  cards.set('c2', makeCard('c2', 'player-1', 'def-creature'));
  cards.set('e1', makeCard('e1', 'player-2', 'def-enchant'));
  cards.set('e2', makeCard('e2', 'player-2', 'def-enchant'));
  cards.set('l1', makeCard('l1', 'player-2', 'def-land'));
  cards.set('l2', makeCard('l2', 'player-2', 'def-land'));
  cards.set('pw1', makeCard('pw1', 'player-2', 'def-planeswalker', { loyaltyCounters: 4 } as Partial<CardInstance>));
  cards.set('c3', makeCard('c3', 'player-2', 'def-creature'));

  const players = ['player-1', 'player-2'].map((id, idx) => ({
    id,
    name: id,
    life: 40,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    hasPlayedLand: false,
    hasPriority: idx === 0,
    hasLost: false,
  }));

  return {
    players,
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
  } as GameState;
}

const zone = (s: GameState, id: string) => s.cards.get(id)?.zone;
const tapped = (s: GameState, id: string) => s.cards.get(id)?.tapped;

// ──────────────────────────────────────────────────────────────────
// Gap 1: Exact-N multi-target (no "up to")
// ──────────────────────────────────────────────────────────────────

describe('slice7 — exact-N multi-target (Peace and Quiet / Rain of Salt / Blinding Beam)', () => {
  // ── Parse tests ──

  it('parser: "Destroy two target enchantments." → Destroy Chosen, count=2, no minCount', () => {
    const parsed = parseOracleText('Destroy two target enchantments.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    expect(parsed.effects[0].kind).toBe('Destroy');
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Enchantment');
    expect(parsed.targets[0].count).toBe(2);
    // Exact-N: minCount must be absent (the chooser must pick exactly 2).
    expect(parsed.targets[0].minCount).toBeUndefined();
  });

  it('parser: "Destroy two target lands." → Destroy Chosen, count=2, type Land', () => {
    const parsed = parseOracleText('Destroy two target lands.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('Destroy');
    expect(parsed.targets[0].type).toBe('Land');
    expect(parsed.targets[0].count).toBe(2);
  });

  it('parser: "Tap two target creatures." → Tap Chosen, count=2, type Creature', () => {
    const parsed = parseOracleText('Tap two target creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('Tap');
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].count).toBe(2);
  });

  it('parser: "Exile three target permanents." → Exile Chosen, count=3', () => {
    const parsed = parseOracleText('Exile three target permanents.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('Exile');
    expect(parsed.targets[0].type).toBe('Permanent');
    expect(parsed.targets[0].count).toBe(3);
  });

  // Regression: plain "destroy target enchantment" (no number) still count=1
  it('parser: plain "Destroy target enchantment." is unchanged (count=1)', () => {
    const parsed = parseOracleText('Destroy target enchantment.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets[0].count).toBe(1);
    expect(parsed.effects[0].kind).toBe('Destroy');
  });

  // ── Executor tests ──

  it('executor: Destroy two target enchantments sends BOTH to graveyard', () => {
    const parsed = parseOracleText('Destroy two target enchantments.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['e1', 'e2'], parsed.targets);
    expect(zone(r, 'e1')).toBe('graveyard');
    expect(zone(r, 'e2')).toBe('graveyard');
    // Other permanents untouched
    expect(zone(r, 'c1')).toBe('battlefield');
    expect(zone(r, 'l1')).toBe('battlefield');
  });

  it('executor: Tap two target creatures taps both and leaves others untapped', () => {
    const parsed = parseOracleText('Tap two target creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['c1', 'c3'], parsed.targets);
    expect(tapped(r, 'c1')).toBe(true);
    expect(tapped(r, 'c3')).toBe(true);
    expect(tapped(r, 'c2')).toBe(false);
  });

  it('executor: Destroy two target lands destroys both target lands', () => {
    const parsed = parseOracleText('Destroy two target lands.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['l1', 'l2'], parsed.targets);
    expect(zone(r, 'l1')).toBe('graveyard');
    expect(zone(r, 'l2')).toBe('graveyard');
    expect(zone(r, 'e1')).toBe('battlefield');
  });

  it('parser: "Return two target creatures to their owners\' hands." → ReturnToHand count=2', () => {
    const parsed = parseOracleText("Return two target creatures to their owners' hands.");
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('ReturnToHand');
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].count).toBe(2);
  });

  it('executor: Return two target creatures bounces both', () => {
    const parsed = parseOracleText("Return two target creatures to their owners' hands.");
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['c1', 'c3'], parsed.targets);
    expect(zone(r, 'c1')).toBe('hand');
    expect(zone(r, 'c3')).toBe('hand');
    expect(zone(r, 'c2')).toBe('battlefield');
    expect(zone(r, 'e1')).toBe('battlefield');
  });
});

// ──────────────────────────────────────────────────────────────────
// Gap 2: "creature or planeswalker" in one-sided damage by power
// ──────────────────────────────────────────────────────────────────

describe('slice7 — "creature or planeswalker" target union (Hard-Hitting Question / Earth Tremor)', () => {
  // ── Parse tests ──

  it('parser: "Target creature you control deals damage equal to its power to target creature or planeswalker you don\'t control." parses as DealDamage with two targets', () => {
    const oracle =
      "Target creature you control deals damage equal to its power to target creature or planeswalker you don't control.";
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    expect(parsed.effects[0].kind).toBe('DealDamage');
    // Two targets: the attacker (Creature, you control) and the victim (CreatureOrPlaneswalker, opponent)
    expect(parsed.targets).toHaveLength(2);
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].constraints?.controllerControls).toBe(true);
    expect(parsed.targets[1].type).toBe('CreatureOrPlaneswalker');
    expect(parsed.targets[1].constraints?.opponentControls).toBe(true);
  });

  it('parser: "Target creature you control deals damage equal to its power to target creature or planeswalker an opponent controls." parses correctly', () => {
    const oracle =
      'Target creature you control deals damage equal to its power to target creature or planeswalker an opponent controls.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('DealDamage');
    expect(parsed.targets[1].type).toBe('CreatureOrPlaneswalker');
    expect(parsed.targets[1].constraints?.opponentControls).toBe(true);
  });

  it('parser: "Target creature you control deals damage equal to its power to target creature you don\'t control." (no planeswalker) still parses as Creature', () => {
    const oracle =
      "Target creature you control deals damage equal to its power to target creature you don't control.";
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets[1].type).toBe('Creature');
    expect(parsed.targets[1].constraints?.opponentControls).toBe(true);
  });

  // ── Executor test: deal damage to opponent's creature via TargetPower ──
  it('executor: "creature or planeswalker" target — damage dealt to opponent creature equals attacker power', () => {
    const oracle =
      "Target creature you control deals damage equal to its power to target creature or planeswalker you don't control.";
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // c1 (power 3) attacks c3.
    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['c1', 'c3'], parsed.targets);
    // c3 should have taken 3 damage (from c1 power=3)
    expect(r.cards.get('c3')?.damage).toBe(3);
    // c1 should be undamaged (one-sided)
    expect(r.cards.get('c1')?.damage).toBe(0);
  });

  it('executor: "creature or planeswalker" target — damage dealt to opponent planeswalker equals attacker power', () => {
    const oracle =
      "Target creature you control deals damage equal to its power to target creature or planeswalker you don't control.";
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // c1 (power 3) attacks pw1 (a planeswalker).
    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['c1', 'pw1'], parsed.targets);
    // pw1 should have taken 3 damage
    expect(r.cards.get('pw1')?.damage).toBe(3);
    expect(r.cards.get('c1')?.damage).toBe(0);
  });
});
