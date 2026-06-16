import { describe, it, expect } from 'vitest';
import { executeEffects } from '../effects/executor';
import { parseOracleText } from '../effects/parser';
import { validateTargetChoices } from '../effects/targets';
import type { GameState, CardInstance, CardDefinition } from '../types';

/**
 * Coverage: divided damage — "~/it deals N|X damage divided as you choose
 * among <one, two, or three targets | any number of target ...>."
 *
 * Parser produces a single DealDamageDivided effect carrying the TOTAL amount
 * plus ONE multi-target spec (count = selection cap, minCount = 1 since the
 * caster may pick fewer). The executor splits the resolved total across every
 * chosen id and pushes each portion through the existing executeDealDamage
 * path: an explicit division can ride the namedCardChoices payload
 * ("damageDivision": "2,1"), otherwise the total is split evenly with the
 * remainder to the earliest chosen targets (all to the first when only one
 * target was chosen).
 *
 * Real oracle wordings exercised: Arc Lightning, Forked Lightning, Boulderfall,
 * Hail of Arrows (X total), Dragonlord Atarka (ETB trigger body).
 */

function makeDef(id: string): CardDefinition {
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
    power: 4,
    toughness: 4,
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

function makeState(combat?: GameState['combat']): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();
  cardDefinitions.set('def-bear', makeDef('def-bear'));

  // player-1 controls c1, c2 ; player-2 controls e1, e2 (only explicitly
  // chosen targets may ever be damaged).
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
    combat: combat ?? null,
  } as GameState;
}

const dmg = (s: GameState, id: string) => s.cards.get(id)?.damage;
const life = (s: GameState, id: string) => s.players.find(p => p.id === id)?.life;

describe('cov-divided-damage', () => {
  // ----- PARSER + EXECUTOR: real oracle wordings -----

  it('Arc Lightning: "~ deals 3 damage divided as you choose among one, two, or three targets."', () => {
    const parsed = parseOracleText('~ deals 3 damage divided as you choose among one, two, or three targets.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Any');
    expect(parsed.targets[0].count).toBe(3);
    expect(parsed.targets[0].minCount).toBe(1);
    expect(parsed.effects).toHaveLength(1);
    expect(parsed.effects[0].kind).toBe('DealDamageDivided');
    if (parsed.effects[0].kind !== 'DealDamageDivided') return;
    expect(parsed.effects[0].amount).toBe(3);
    expect(parsed.effects[0].target).toEqual({ kind: 'Chosen', targetId: parsed.targets[0].id });

    // Three chosen targets, no explicit division → even split 1/1/1.
    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['e1', 'e2', 'player-2'], parsed.targets);
    expect(dmg(r, 'e1')).toBe(1);
    expect(dmg(r, 'e2')).toBe(1);
    expect(life(r, 'player-2')).toBe(39);
    // Unchosen permanents and players untouched.
    expect(dmg(r, 'c1')).toBe(0);
    expect(life(r, 'player-1')).toBe(40);
  });

  it('Arc Lightning honors an explicit "damageDivision" choice payload', () => {
    const parsed = parseOracleText('~ deals 3 damage divided as you choose among one, two, or three targets.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const r = executeEffects(
      makeState(), parsed.effects, 'player-1', ['e1', 'player-2'], parsed.targets, 0,
      { namedCardChoices: { damageDivision: '2,1' } },
    );
    expect(dmg(r, 'e1')).toBe(2);
    expect(life(r, 'player-2')).toBe(39);
    expect(dmg(r, 'e2')).toBe(0);
  });

  it('Forked Lightning: "~ deals 4 damage divided as you choose among any number of targets."', () => {
    const parsed = parseOracleText('~ deals 4 damage divided as you choose among any number of targets.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // "any number" with a fixed total caps the selection at the total itself.
    expect(parsed.targets[0].type).toBe('Any');
    expect(parsed.targets[0].count).toBe(4);
    expect(parsed.targets[0].minCount).toBe(1);
    expect(parsed.effects[0].kind).toBe('DealDamageDivided');

    // Two chosen targets, even split 2/2.
    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['e1', 'e2'], parsed.targets);
    expect(dmg(r, 'e1')).toBe(2);
    expect(dmg(r, 'e2')).toBe(2);
    expect(dmg(r, 'c1')).toBe(0);
  });

  it('Boulderfall: "~ deals 5 damage divided as you choose among any number of targets." — one chosen target takes it all', () => {
    const parsed = parseOracleText('~ deals 5 damage divided as you choose among any number of targets.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets[0].count).toBe(5);

    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['e1'], parsed.targets);
    expect(dmg(r, 'e1')).toBe(5);
    expect(dmg(r, 'e2')).toBe(0);
    expect(life(r, 'player-2')).toBe(40);
  });

  it('Hail of Arrows: "~ deals X damage divided as you choose among any number of target attacking creatures."', () => {
    const parsed = parseOracleText('~ deals X damage divided as you choose among any number of target attacking creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].constraints?.combatStatus).toBe('attacking');
    expect(parsed.targets[0].minCount).toBe(1);
    expect(parsed.effects[0].kind).toBe('DealDamageDivided');
    if (parsed.effects[0].kind !== 'DealDamageDivided') return;
    expect(parsed.effects[0].amount).toEqual({ kind: 'X' });

    const combatState = makeState({
      attackers: [
        { cardInstanceId: 'e1', defendingPlayerId: 'player-1' },
        { cardInstanceId: 'e2', defendingPlayerId: 'player-1' },
      ],
      blockers: [],
      damageAssignment: new Map(),
    } as unknown as GameState['combat']);

    // Targeting legality: an attacker is legal even when fewer than `count`
    // targets are chosen (minCount), a non-attacker is rejected.
    expect(() => validateTargetChoices(combatState, 'player-1', parsed.targets, ['e1'])).not.toThrow();
    expect(() => validateTargetChoices(combatState, 'player-1', parsed.targets, ['c1'])).toThrow(/attacking/);

    // X = 5 divided over two attackers, even split with remainder first: 3/2.
    const r = executeEffects(combatState, parsed.effects, 'player-1', ['e1', 'e2'], parsed.targets, 5);
    expect(dmg(r, 'e1')).toBe(3);
    expect(dmg(r, 'e2')).toBe(2);
    expect(dmg(r, 'c1')).toBe(0);
  });

  it('Dragonlord Atarka ETB: "When this creature enters, it deals 5 damage divided as you choose among any number of target creatures and/or planeswalkers your opponents control."', () => {
    const parsed = parseOracleText('When this creature enters, it deals 5 damage divided as you choose among any number of target creatures and/or planeswalkers your opponents control.');
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;

    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].constraints?.opponentControls).toBe(true);
    expect(parsed.targets[0].count).toBe(5);
    const effect = parsed.ability.effects[0];
    expect(effect.kind).toBe('DealDamageDivided');
    if (effect.kind !== 'DealDamageDivided') return;
    expect(effect.amount).toBe(5);
    expect(effect.source).toEqual({ kind: 'ThisPermanent' });

    // Opponent's own creatures are illegal choices for the controller.
    const state = makeState();
    expect(() => validateTargetChoices(state, 'player-1', parsed.targets, ['e1', 'e2'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'player-1', parsed.targets, ['c1'])).toThrow(/opponent/);

    const r = executeEffects(
      state, parsed.ability.effects, 'player-1', ['e1', 'e2'], parsed.targets, 0,
      { namedCardChoices: { damageDivision: '4,1' } },
    );
    expect(dmg(r, 'e1')).toBe(4);
    expect(dmg(r, 'e2')).toBe(1);
    expect(dmg(r, 'c1')).toBe(0);
    expect(dmg(r, 'c2')).toBe(0);
  });

  // ----- EXECUTOR GUARDS -----

  it('an invalid explicit division (wrong sum) falls back to the even split', () => {
    const parsed = parseOracleText('~ deals 5 damage divided as you choose among any number of targets.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const r = executeEffects(
      makeState(), parsed.effects, 'player-1', ['e1', 'e2'], parsed.targets, 0,
      { namedCardChoices: { damageDivision: '4,4' } }, // sums to 8, total is 5
    );
    expect(dmg(r, 'e1')).toBe(3);
    expect(dmg(r, 'e2')).toBe(2);
  });

  it('placeholder/unknown ids are dropped before dividing (unfilled multi-target slots)', () => {
    const parsed = parseOracleText('~ deals 4 damage divided as you choose among any number of targets.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const r = executeEffects(
      makeState(), parsed.effects, 'player-1',
      ['e1', '__deckreps_invalid_resolution_target__1'], parsed.targets,
    );
    expect(dmg(r, 'e1')).toBe(4);
    expect(dmg(r, 'e2')).toBe(0);
  });

  it('Rock Slide "without flying" stays unparsed — no constraint support, so no dishonest partial match', () => {
    const parsed = parseOracleText('~ deals X damage divided as you choose among any number of target attacking creatures without flying.');
    expect(parsed.kind).toBe('Unparsed');
  });

  // ----- TARGET VALIDATION: minCount allows 1..count choices -----

  it('validateTargetChoices accepts 1..count choices for a minCount spec and rejects 0 or count+1', () => {
    const parsed = parseOracleText('~ deals 3 damage divided as you choose among one, two, or three targets.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const state = makeState();
    expect(() => validateTargetChoices(state, 'player-1', parsed.targets, ['e1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'player-1', parsed.targets, ['e1', 'e2'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'player-1', parsed.targets, ['e1', 'e2', 'player-2'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'player-1', parsed.targets, [])).toThrow(/Expected 1 to 3 target choice/);
    expect(() => validateTargetChoices(state, 'player-1', parsed.targets, ['e1', 'e2', 'c1', 'c2'])).toThrow(/Expected 1 to 3 target choice/);
  });

  // ----- REGRESSION: single-target damage and exact-count specs unchanged -----

  it('plain "~ deals 3 damage to any target" still parses as single-target DealDamage', () => {
    const parsed = parseOracleText('~ deals 3 damage to any target.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('DealDamage');
    expect(parsed.targets[0].count).toBe(1);
    expect(parsed.targets[0].minCount).toBeUndefined();
    // Exact-count validation unchanged for specs without minCount.
    expect(() => validateTargetChoices(makeState(), 'player-1', parsed.targets, [])).toThrow(/Expected 1 target choice/);
  });
});
