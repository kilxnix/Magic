/**
 * Slice 5 — "Damage equal to its/twice its power" (bite family)
 *
 * Parser matchers: matchDealDamageTwiceItsPower, matchMutinyStyle,
 * matchEachSubtypeDealsDamageByPower (in matchers/damage.ts).
 *
 * AST additions: DealDamageAllByPowerEffect (ast.ts), TargetPower.multiplier (ast.ts).
 * Executor: DealDamageAllByPower case + multiplier branch on TargetPower.
 *
 * Real oracle wordings exercised:
 *   - Fall of the Hammer (existing matchOneSidedDealDamageByPower, regression)
 *   - Animist's Might  ("~ deals damage equal to twice its power to target creature")
 *   - Mutiny           ("target creature an opponent controls deals damage equal to
 *                        its power to another target creature that player controls")
 *   - Bartz and Boko trigger tail ("each other Bird you control deals damage equal
 *                                   to its power to target creature")
 */

import { describe, it, expect } from 'vitest';
import { executeEffects } from '../effects/executor';
import { parseOracleText } from '../effects/parser';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Test-state helpers
// ---------------------------------------------------------------------------

function makeDef(id: string, power = 3, toughness = 3, subtypes: string[] = []): CardDefinition {
  const st = subtypes.length > 0 ? `Creature — ${subtypes.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')}` : 'Creature — Bear';
  return {
    id,
    name: id,
    type_line: st,
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power,
    toughness,
    card_types: ['creature'],
  } as CardDefinition;
}

function makeCreature(instanceId: string, ownerId: string, defId: string): CardInstance {
  return {
    instanceId,
    definitionId: defId,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  } as CardInstance;
}

interface MakeStateOpts {
  /** Extra card definitions beyond the defaults */
  extraDefs?: CardDefinition[];
  /** Extra card instances beyond the defaults */
  extraCards?: CardInstance[];
}

function makeState(opts: MakeStateOpts = {}): GameState {
  const cardDefinitions = new Map<string, CardDefinition>();
  const cards = new Map<string, CardInstance>();

  // Default defs
  const defBear = makeDef('def-bear');
  const defBird3 = makeDef('def-bird-3', 3, 1, ['bird']);
  const defBird2 = makeDef('def-bird-2', 2, 1, ['bird']);
  const defTarget = makeDef('def-target', 5, 5);

  cardDefinitions.set('def-bear', defBear);
  cardDefinitions.set('def-bird-3', defBird3);
  cardDefinitions.set('def-bird-2', defBird2);
  cardDefinitions.set('def-target', defTarget);

  for (const d of (opts.extraDefs ?? [])) cardDefinitions.set(d.id, d);

  // Default creatures:
  //  p1: attacker1 (bear 3/3), bird-a (3/1 Bird), bird-b (2/1 Bird)
  //  p2: defender1 (5/5), defender2 (5/5)
  cards.set('attacker1', makeCreature('attacker1', 'player-1', 'def-bear'));
  cards.set('bird-a',    makeCreature('bird-a',    'player-1', 'def-bird-3'));
  cards.set('bird-b',    makeCreature('bird-b',    'player-1', 'def-bird-2'));
  cards.set('defender1', makeCreature('defender1', 'player-2', 'def-target'));
  cards.set('defender2', makeCreature('defender2', 'player-2', 'def-target'));

  for (const c of (opts.extraCards ?? [])) cards.set(c.instanceId, c);

  const players = (['player-1', 'player-2'] as const).map((id, idx) => ({
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

const dmg = (s: GameState, id: string) => s.cards.get(id)?.damage ?? -1;
const life = (s: GameState, id: string) => s.players.find(p => p.id === id)?.life ?? -1;

// ---------------------------------------------------------------------------
// REGRESSION: Fall of the Hammer (already parsed by matchOneSidedDealDamageByPower)
// ---------------------------------------------------------------------------

describe('slice5-bite-family: Fall of the Hammer (regression)', () => {
  it('parses "target creature you control deals damage equal to its power to target creature an opponent controls"', () => {
    const parsed = parseOracleText(
      'Target creature you control deals damage equal to its power to target creature an opponent controls.',
    ) as any;
    expect(parsed.kind).toBe('Spell');
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    expect(eff.amount.kind).toBe('TargetPower');
    expect(eff.amount.target.kind).toBe('Chosen');
    expect(parsed.targets).toHaveLength(2);
    // sourceSpec has controllerControls
    const sourceSpec = parsed.targets.find((t: any) => t.id === eff.amount.target.targetId);
    expect(sourceSpec.constraints?.controllerControls).toBe(true);
    // destSpec has opponentControls
    const destSpec = parsed.targets.find((t: any) => t.id === eff.target.targetId);
    expect(destSpec.constraints?.opponentControls).toBe(true);
  });

  it('executes Fall of the Hammer: attacker1 (3/3) deals 3 to defender1 (5/5)', () => {
    const parsed = parseOracleText(
      'Target creature you control deals damage equal to its power to target creature an opponent controls.',
    ) as any;
    expect(parsed.kind).toBe('Spell');
    // sourceSpec id is the first target (controllerControls), destSpec is second
    const sourceSpec = parsed.targets.find((t: any) => t.constraints?.controllerControls);
    const destSpec   = parsed.targets.find((t: any) => t.constraints?.opponentControls);
    const result = executeEffects(
      makeState(), parsed.effects, 'player-1',
      [sourceSpec.id === parsed.targets[0].id ? 'attacker1' : 'defender1',
       destSpec.id   === parsed.targets[1].id ? 'defender1' : 'attacker1'],
      parsed.targets,
    );
    expect(dmg(result, 'defender1')).toBe(3);
    expect(dmg(result, 'attacker1')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Animist's Might — "twice its power"
// ---------------------------------------------------------------------------

describe("slice5-bite-family: Animist's Might — twice its power", () => {
  it('parses "~ deals damage equal to twice its power to target creature"', () => {
    const parsed = parseOracleText(
      "~ deals damage equal to twice its power to target creature.",
    ) as any;
    expect(parsed.kind).toBe('Spell');
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    expect(eff.amount).toEqual({ kind: 'TargetPower', target: { kind: 'Source' }, multiplier: 2 });
    expect(eff.source).toEqual({ kind: 'ThisPermanent' });
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
  });

  it('parses "~ deals damage equal to twice its power to any target"', () => {
    const parsed = parseOracleText(
      '~ deals damage equal to twice its power to any target.',
    ) as any;
    expect(parsed.kind).toBe('Spell');
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    expect(eff.amount.multiplier).toBe(2);
    expect(parsed.targets[0].type).toBe('Any');
  });

  it('executes twice-power: source permanent (power=3) deals 6 to defender1 (5/5)', () => {
    const parsed = parseOracleText(
      '~ deals damage equal to twice its power to target creature.',
    ) as any;
    expect(parsed.kind).toBe('Spell');
    // sourceInstanceId is attacker1 (3/3 bear)
    const result = executeEffects(
      makeState(), parsed.effects, 'player-1',
      ['defender1'],
      parsed.targets,
      0,
      { sourceInstanceId: 'attacker1' },
    );
    // 3 power × 2 = 6 damage
    expect(dmg(result, 'defender1')).toBe(6);
    expect(dmg(result, 'attacker1')).toBe(0);
  });

  it('executes twice-power: source with power=2 deals 4 to target player', () => {
    const def2 = makeDef('def-2power', 2, 2);
    const src2 = makeCreature('src2', 'player-1', 'def-2power');
    const parsed = parseOracleText(
      '~ deals damage equal to twice its power to target player.',
    ) as any;
    expect(parsed.kind).toBe('Spell');
    const result = executeEffects(
      makeState({ extraDefs: [def2], extraCards: [src2] }),
      parsed.effects, 'player-1',
      ['player-2'],
      parsed.targets,
      0,
      { sourceInstanceId: 'src2' },
    );
    // power=2 × 2 = 4 damage
    expect(life(result, 'player-2')).toBe(36);
  });
});

// ---------------------------------------------------------------------------
// Mutiny — "target creature an opponent controls deals damage to another target"
// ---------------------------------------------------------------------------

describe('slice5-bite-family: Mutiny style', () => {
  it('parses Mutiny oracle: "target creature an opponent controls deals damage equal to its power to another target creature that player controls"', () => {
    const parsed = parseOracleText(
      'Target creature an opponent controls deals damage equal to its power to another target creature that player controls.',
    ) as any;
    expect(parsed.kind).toBe('Spell');
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    expect(eff.amount.kind).toBe('TargetPower');
    expect(eff.amount.target.kind).toBe('Chosen');
    expect(parsed.targets).toHaveLength(2);
    // source spec — the forced creature: opponentControls
    const srcSpec = parsed.targets.find((t: any) => t.id === eff.amount.target.targetId);
    expect(srcSpec).toBeTruthy();
    expect(srcSpec.type).toBe('Creature');
    expect(srcSpec.constraints?.opponentControls).toBe(true);
    // destination spec — the creature being hit
    const dstSpec = parsed.targets.find((t: any) => t.id === eff.target.targetId);
    expect(dstSpec).toBeTruthy();
    expect(dstSpec.type).toBe('Creature');
  });

  it('executes Mutiny: forced creature (5/5 on p2) deals 5 to another creature (3/3 on p1)', () => {
    const parsed = parseOracleText(
      'Target creature an opponent controls deals damage equal to its power to another target creature that player controls.',
    ) as any;
    expect(parsed.kind).toBe('Spell');
    const srcSpec = parsed.targets.find((t: any) => t.constraints?.opponentControls);
    const dstSpec = parsed.targets.find((t: any) => t.id !== srcSpec.id);
    // defender1 (5/5) is forced; attacker1 (3/3) is hit
    const chosenIds = parsed.targets.map((t: any) =>
      t.id === srcSpec.id ? 'defender1' : 'attacker1',
    );
    const result = executeEffects(
      makeState(), parsed.effects, 'player-1', chosenIds, parsed.targets,
    );
    expect(dmg(result, 'attacker1')).toBe(5);
    expect(dmg(result, 'defender1')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bartz and Boko trigger tail — DealDamageAllByPower
// ---------------------------------------------------------------------------

describe('slice5-bite-family: Each other Subtype you control deals damage equal to its power', () => {
  it('parses Bartz and Boko trigger tail: "each other Bird you control deals damage equal to its power to target creature"', () => {
    const parsed = parseOracleText(
      'Each other Bird you control deals damage equal to its power to target creature.',
    ) as any;
    expect(parsed.kind).toBe('Spell');
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamageAllByPower');
    expect(eff.sourceFilter.subtypes).toContain('bird');
    expect(eff.sourceFilter.types).toContain('creature');
    expect(eff.controller).toBe('you');
    expect(eff.excludeSource).toBe(true);
    expect(eff.target.kind).toBe('Chosen');
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
  });

  it('parses without "other": "each Bird you control deals damage equal to its power to target creature"', () => {
    const parsed = parseOracleText(
      'Each Bird you control deals damage equal to its power to target creature.',
    ) as any;
    expect(parsed.kind).toBe('Spell');
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamageAllByPower');
    expect(eff.excludeSource).toBe(false);
  });

  it('executes DealDamageAllByPower: two Birds (3/1 + 2/1) each deal their OWN power to defender1', () => {
    const parsed = parseOracleText(
      'Each other Bird you control deals damage equal to its power to target creature.',
    ) as any;
    expect(parsed.kind).toBe('Spell');
    // bird-a has power 3, bird-b has power 2 → 3+2=5 total damage to defender1
    const result = executeEffects(
      makeState(), parsed.effects, 'player-1',
      ['defender1'],
      parsed.targets,
      0,
      { sourceInstanceId: 'bird-a' }, // sourceInstanceId = bird-a; excludeSource should skip it
    );
    // With excludeSource=true and sourceInstanceId='bird-a':
    // Only bird-b (power=2) deals damage (bird-a is excluded as source)
    // defender1 should receive 2 damage
    expect(dmg(result, 'defender1')).toBe(2);
    expect(dmg(result, 'attacker1')).toBe(0);
  });

  it('executes DealDamageAllByPower (no excludeSource): both Birds deal to defender1 = 5 total', () => {
    const parsed = parseOracleText(
      'Each Bird you control deals damage equal to its power to target creature.',
    ) as any;
    expect(parsed.kind).toBe('Spell');
    // No excludeSource, so bird-a (3) + bird-b (2) = 5
    const result = executeEffects(
      makeState(), parsed.effects, 'player-1',
      ['defender1'],
      parsed.targets,
    );
    expect(dmg(result, 'defender1')).toBe(5);
    expect(dmg(result, 'attacker1')).toBe(0);
  });

  it('executes DealDamageAllByPower: non-bird creature (attacker1) is NOT included in the damage dealing', () => {
    const parsed = parseOracleText(
      'Each Bird you control deals damage equal to its power to target creature.',
    ) as any;
    // Only the two Birds should deal damage; attacker1 (bear) should not contribute
    const result = executeEffects(
      makeState(), parsed.effects, 'player-1',
      ['defender1'],
      parsed.targets,
    );
    // bird-a (3) + bird-b (2) = 5, NOT attacker1's 3
    expect(dmg(result, 'defender1')).toBe(5);
  });
});
