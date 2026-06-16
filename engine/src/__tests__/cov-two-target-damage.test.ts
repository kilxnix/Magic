import { describe, it, expect } from 'vitest';
import { executeEffects } from '../effects/executor';
import { parseOracleText } from '../effects/parser';
import { validateTargetChoices } from '../effects/targets';
import type { GameState, CardInstance, CardDefinition } from '../types';

/**
 * Coverage: two-target ETB/spell damage split —
 * "[it/~/this <type>] deals N damage to target (opponent|player) [or planeswalker]
 *   and N damage to up to one target (creature|creature or planeswalker)."
 *
 * Covered cards / wordings:
 *   Burning Sun's Avatar  — "it deals 3 damage to target opponent or planeswalker
 *                             and 3 damage to up to one target creature."
 *   Rakdos Firewheeler    — "it deals 2 damage to target opponent and 2 damage to
 *                             up to one target creature or planeswalker."
 *   Generic spell form    — "~ deals 3 damage to target player and 2 damage to
 *                             up to one target creature."
 *
 * Parser contract:
 *   • kind: ETB | Spell
 *   • 2 TargetSpecs (spec1: Player, spec2: Creature|CreatureOrPlaneswalker)
 *   • spec2.minCount === 0  (choosing zero is legal)
 *   • 2 DealDamage effects referencing spec1 / spec2
 *
 * Executor contract:
 *   • effects execute sequentially; spec1 target takes n1 damage, spec2 takes n2
 *   • when spec2 target is omitted (empty string / none), the second DealDamage is a no-op
 *   • the first target is never damaged by the second effect
 */

// ── Minimal game-state helpers ───────────────────────────────────────────────

function makeCreatureDef(id: string): CardDefinition {
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
  } as CardDefinition;
}

function makeCreature(instanceId: string, ownerId: string): CardInstance {
  return {
    instanceId,
    definitionId: 'def-bear',
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  } as CardInstance;
}

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();
  cardDefinitions.set('def-bear', makeCreatureDef('def-bear'));

  // player-1 owns c1, c2; player-2 owns e1, e2
  cards.set('c1', makeCreature('c1', 'player-1'));
  cards.set('c2', makeCreature('c2', 'player-1'));
  cards.set('e1', makeCreature('e1', 'player-2'));
  cards.set('e2', makeCreature('e2', 'player-2'));

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

const dmg = (s: GameState, id: string) => s.cards.get(id)?.damage ?? 0;
const life = (s: GameState, id: string) => s.players.find(p => p.id === id)?.life ?? -1;

// ── Parser tests ─────────────────────────────────────────────────────────────

describe('cov-two-target-damage — parser', () => {
  it('Burning Sun\'s Avatar ETB: parses "it deals 3 damage to target opponent or planeswalker and 3 damage to up to one target creature."', () => {
    const parsed = parseOracleText(
      'When this creature enters, it deals 3 damage to target opponent or planeswalker and 3 damage to up to one target creature.',
    );
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;

    // Two target specs
    expect(parsed.targets).toHaveLength(2);
    const [spec1, spec2] = parsed.targets;

    // First spec: Player (opponent only)
    expect(spec1.type).toBe('Player');
    expect(spec1.constraints?.opponentControls).toBe(true);
    expect(spec1.count).toBe(1);
    expect(spec1.minCount).toBeUndefined(); // required, not optional

    // Second spec: Creature, optional (up to one)
    expect(spec2.type).toBe('Creature');
    expect(spec2.count).toBe(1);
    expect(spec2.minCount).toBe(0); // "up to one"

    // Two DealDamage effects
    const effects = parsed.ability.effects;
    expect(effects).toHaveLength(2);
    expect(effects[0].kind).toBe('DealDamage');
    expect(effects[1].kind).toBe('DealDamage');
    if (effects[0].kind !== 'DealDamage' || effects[1].kind !== 'DealDamage') return;

    expect(effects[0].amount).toBe(3);
    expect(effects[1].amount).toBe(3);
    expect(effects[0].source).toEqual({ kind: 'ThisPermanent' });
    expect(effects[1].source).toEqual({ kind: 'ThisPermanent' });
    expect(effects[0].target).toEqual({ kind: 'Chosen', targetId: spec1.id });
    expect(effects[1].target).toEqual({ kind: 'Chosen', targetId: spec2.id });
  });

  it('Rakdos Firewheeler ETB: parses "it deals 2 damage to target opponent and 2 damage to up to one target creature or planeswalker."', () => {
    const parsed = parseOracleText(
      'When this creature enters, it deals 2 damage to target opponent and 2 damage to up to one target creature or planeswalker.',
    );
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;

    expect(parsed.targets).toHaveLength(2);
    const [spec1, spec2] = parsed.targets;

    expect(spec1.type).toBe('Player');
    expect(spec1.constraints?.opponentControls).toBe(true);

    // "creature or planeswalker" → CreatureOrPlaneswalker
    expect(spec2.type).toBe('CreatureOrPlaneswalker');
    expect(spec2.minCount).toBe(0);

    const effects = parsed.ability.effects;
    expect(effects).toHaveLength(2);
    if (effects[0].kind !== 'DealDamage' || effects[1].kind !== 'DealDamage') return;
    expect(effects[0].amount).toBe(2);
    expect(effects[1].amount).toBe(2);
  });

  it('Spell form: "~ deals 3 damage to target player and 2 damage to up to one target creature." parses as Spell with two specs', () => {
    const parsed = parseOracleText(
      '~ deals 3 damage to target player and 2 damage to up to one target creature.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.targets).toHaveLength(2);
    const [spec1, spec2] = parsed.targets;

    // "target player" — no opponentControls constraint
    expect(spec1.type).toBe('Player');
    expect(spec1.constraints?.opponentControls).toBeUndefined();

    expect(spec2.type).toBe('Creature');
    expect(spec2.minCount).toBe(0);

    expect(parsed.effects).toHaveLength(2);
    if (parsed.effects[0].kind !== 'DealDamage' || parsed.effects[1].kind !== 'DealDamage') return;
    expect(parsed.effects[0].amount).toBe(3);
    expect(parsed.effects[1].amount).toBe(2);
  });

  it('target opponent or planeswalker first-target: opponentControls on spec1', () => {
    const parsed = parseOracleText(
      '~ deals 4 damage to target opponent or planeswalker and 2 damage to up to one target creature.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets[0].constraints?.opponentControls).toBe(true);
    expect(parsed.targets[1].type).toBe('Creature');
    expect(parsed.targets[1].minCount).toBe(0);
  });
});

// ── validateTargetChoices tests ───────────────────────────────────────────────

describe('cov-two-target-damage — target validation', () => {
  it('validates: first target required (opponent player), second optional (0..1 creature)', () => {
    const parsed = parseOracleText(
      'When this creature enters, it deals 3 damage to target opponent or planeswalker and 3 damage to up to one target creature.',
    );
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;

    const state = makeState();
    // player-2 is the opponent from player-1's perspective
    // Valid: both targets supplied
    expect(() => validateTargetChoices(state, 'player-1', parsed.targets, ['player-2', 'e1'])).not.toThrow();
    // Valid: only first target (second is optional, minCount=0)
    expect(() => validateTargetChoices(state, 'player-1', parsed.targets, ['player-2'])).not.toThrow();
    // Invalid: zero targets (first spec requires exactly 1)
    expect(() => validateTargetChoices(state, 'player-1', parsed.targets, [])).toThrow();
    // Invalid: player-1 can't be chosen as "opponent" for the first target
    expect(() => validateTargetChoices(state, 'player-1', parsed.targets, ['player-1', 'e1'])).toThrow(/opponent/);
  });
});

// ── Executor tests ───────────────────────────────────────────────────────────

describe('cov-two-target-damage — executor', () => {
  it('Burning Sun\'s Avatar: both targets take damage when two targets are provided', () => {
    const parsed = parseOracleText(
      'When this creature enters, it deals 3 damage to target opponent or planeswalker and 3 damage to up to one target creature.',
    );
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;

    const state = makeState();
    // Choose player-2 as opponent target and e1 as creature target
    const result = executeEffects(
      state,
      parsed.ability.effects,
      'player-1',
      ['player-2', 'e1'],
      parsed.targets,
    );

    expect(life(result, 'player-2')).toBe(37); // 40 - 3
    expect(dmg(result, 'e1')).toBe(3);
    // Untouched
    expect(dmg(result, 'e2')).toBe(0);
    expect(dmg(result, 'c1')).toBe(0);
    expect(life(result, 'player-1')).toBe(40);
  });

  it('Rakdos Firewheeler: only opponent takes damage when no creature target is chosen (up to one = optional)', () => {
    const parsed = parseOracleText(
      'When this creature enters, it deals 2 damage to target opponent and 2 damage to up to one target creature or planeswalker.',
    );
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;

    const state = makeState();
    // Only provide the first (required) target; omit the optional creature target
    const result = executeEffects(
      state,
      parsed.ability.effects,
      'player-1',
      ['player-2'],
      parsed.targets,
    );

    expect(life(result, 'player-2')).toBe(38); // 40 - 2
    // No creatures damaged
    expect(dmg(result, 'e1')).toBe(0);
    expect(dmg(result, 'e2')).toBe(0);
    expect(dmg(result, 'c1')).toBe(0);
  });

  it('Spell form: different amounts to different targets', () => {
    const parsed = parseOracleText(
      '~ deals 3 damage to target player and 2 damage to up to one target creature.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const state = makeState();
    const result = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['player-2', 'e2'],
      parsed.targets,
    );

    expect(life(result, 'player-2')).toBe(37); // 40 - 3
    expect(dmg(result, 'e2')).toBe(2);
    expect(dmg(result, 'e1')).toBe(0);
    expect(life(result, 'player-1')).toBe(40);
  });

  it('regression: single-target "~ deals 3 damage to any target." still parses as DealDamage (not two-target)', () => {
    const parsed = parseOracleText('~ deals 3 damage to any target.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.effects).toHaveLength(1);
    expect(parsed.effects[0].kind).toBe('DealDamage');
  });
});
