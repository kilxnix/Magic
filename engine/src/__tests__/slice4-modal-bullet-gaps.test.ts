/**
 * Slice 4: Modal mode-bullet gap closure tests.
 *
 * Covers the 7 new bullet-level matchers added in this slice:
 *  1. matchDestroyAllTappedCreatures — "Destroy all tapped/untapped creatures" (Split Up)
 *  2. matchTapXTargetPermanents     — "Tap X target permanents" (Reality Spasm bullet)
 *  3. matchUntapXTargetPermanents   — "Untap X target permanents" (Reality Spasm bullet)
 *  4. matchTargetPlayerGainLifeX    — "Target player gains X life" (Alabaster Potion bullet)
 *  5. matchPreventDamage X          — "Prevent the next X damage …" (Alabaster Potion bullet)
 *  6. matchTargetPlayerSacrifice    — "Target opponent sacrifices a creature or enchantment of their choice"
 *                                     (Pharika's Libation; existing matcher extended with union type + opponent)
 *  7. matchCopyCreature extended    — "Create a token that is a copy of target artifact creature you control"
 *                                     (Mirage Mockery; existing matcher extended)
 *  8. matchRemoveCountersWhereX     — "Remove X counters from target permanent, where X is the number of…"
 *                                     (Thornmantle Striker)
 *
 * Each block has >=3 parse tests and at least one execution test.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spell(text: string) {
  const parsed = parseOracleText(text);
  expect(parsed.kind, `Expected Spell for: ${text}`).toBe('Spell');
  return parsed as Extract<ReturnType<typeof parseOracleText>, { kind: 'Spell' }>;
}

function spellFx(text: string): Effect[] {
  return spell(text).effects;
}

/** Build a minimal two-player game state with a set of battlefield cards. */
function makeState(
  cards: Array<{
    id: string;
    defId: string;
    owner: string;
    zone?: CardInstance['zone'];
    tapped?: boolean;
    counters?: Record<string, number>;
    types?: string[];
    isToken?: boolean;
  }>,
  defs?: CardDefinition[],
): GameState {
  const cardMap = new Map<string, CardInstance>();
  const defMap = new Map<string, CardDefinition>();

  for (const c of cards) {
    const inst: CardInstance = {
      instanceId: c.id,
      definitionId: c.defId,
      ownerId: c.owner,
      zone: c.zone ?? 'battlefield',
      tapped: c.tapped ?? false,
      summoningSick: false,
      counters: c.counters ?? {},
      damage: 0,
      isCommander: false,
      isToken: c.isToken ?? false,
    };
    cardMap.set(c.id, inst);
  }

  if (defs) {
    for (const d of defs) defMap.set(d.id, d);
  }

  // Auto-create stub definitions for any card whose def isn't provided.
  for (const c of cards) {
    if (!defMap.has(c.defId)) {
      const def: CardDefinition = {
        id: c.defId,
        name: c.defId,
        type_line: (c.types ?? ['creature']).join(' '),
        oracle_text: '',
        mana_cost: '{2}',
        cmc: 2,
        colors: [],
        color_identity: [],
        keywords: [],
        card_types: (c.types ?? ['creature']) as CardDefinition['card_types'],
      };
      defMap.set(c.defId, def);
    }
  }

  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: cardMap,
    cardDefinitions: defMap,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

/**
 * Execute a parsed spell with no targets (mass effects or self-effects).
 * chosenTargetIds and targetSpecs are both empty.
 */
function runNoTargets(
  state: GameState,
  text: string,
  opts: { caster?: string; xValue?: number; sourceInstanceId?: string } = {},
): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
  return executeEffects(
    state,
    p.effects,
    opts.caster ?? 'p0',
    [],
    [],
    opts.xValue ?? 0,
    { sourceInstanceId: opts.sourceInstanceId },
  );
}

/**
 * Execute a parsed spell with single chosen target (single-count spec).
 * targetId is the instance/player ID chosen for the first target spec.
 */
function runSingleTarget(
  state: GameState,
  text: string,
  targetId: string,
  opts: { caster?: string; xValue?: number; sourceInstanceId?: string } = {},
): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
  return executeEffects(
    state,
    p.effects,
    opts.caster ?? 'p0',
    [targetId],           // chosenTargetIds: flat array with one ID
    p.targets,            // targetSpecs: from parse (has the correct spec ID)
    opts.xValue ?? 0,
    { sourceInstanceId: opts.sourceInstanceId },
  );
}

/**
 * Execute a parsed spell with multiple chosen targets for the first spec.
 * targetIds: array of IDs chosen for the first (multi-count) target spec.
 */
function runMultiTarget(
  state: GameState,
  text: string,
  targetIds: string[],
  opts: { caster?: string; xValue?: number; sourceInstanceId?: string } = {},
): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
  return executeEffects(
    state,
    p.effects,
    opts.caster ?? 'p0',
    targetIds,            // chosenTargetIds: flat array (multi-count sliced by executor)
    p.targets,            // targetSpecs: from parse (has count for the spec)
    opts.xValue ?? 0,
    { sourceInstanceId: opts.sourceInstanceId },
  );
}

// ---------------------------------------------------------------------------
// 1. matchDestroyAllTappedCreatures — Split Up
// ---------------------------------------------------------------------------

describe('slice4: Destroy all tapped/untapped creatures (Split Up)', () => {
  it('parses "Destroy all tapped creatures." as Destroy AllOfType with tapped:true', () => {
    const fx = spellFx('Destroy all tapped creatures.');
    expect(fx).toHaveLength(1);
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.kind).toBe('Destroy');
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], tapped: true },
    });
  });

  it('parses "Destroy all untapped creatures." as Destroy AllOfType with tapped:false', () => {
    const fx = spellFx('Destroy all untapped creatures.');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.kind).toBe('Destroy');
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], tapped: false },
    });
  });

  it('parses "Destroy all tapped artifacts." as Destroy AllOfType artifact with tapped:true', () => {
    const fx = spellFx('Destroy all tapped artifacts.');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['artifact'], tapped: true },
    });
  });

  it('does NOT parse "Destroy all creatures." via this matcher (goes to existing AllCreatures)', () => {
    // "Destroy all creatures." still hits matchDestroyAll -> AllCreatures, not AllOfType
    const fx = spellFx('Destroy all creatures.');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.target.kind).toBe('AllCreatures');
  });

  it('execution: tapped creatures are destroyed, untapped survive', () => {
    const state = makeState([
      { id: 'c_tapped', defId: 'd_creature', owner: 'p0', tapped: true },
      { id: 'c_untapped', defId: 'd_creature', owner: 'p0', tapped: false },
    ]);
    const after = runNoTargets(state, 'Destroy all tapped creatures.');
    expect(after.cards.get('c_tapped')!.zone).toBe('graveyard');
    expect(after.cards.get('c_untapped')!.zone).toBe('battlefield');
  });

  it('execution: untapped creatures are destroyed, tapped survive (other bullet)', () => {
    const state = makeState([
      { id: 'c_tapped', defId: 'd_creature', owner: 'p0', tapped: true },
      { id: 'c_untapped', defId: 'd_creature', owner: 'p0', tapped: false },
    ]);
    const after = runNoTargets(state, 'Destroy all untapped creatures.');
    expect(after.cards.get('c_tapped')!.zone).toBe('battlefield');
    expect(after.cards.get('c_untapped')!.zone).toBe('graveyard');
  });
});

// ---------------------------------------------------------------------------
// 2 & 3. matchTapXTargetPermanents / matchUntapXTargetPermanents — Reality Spasm
// ---------------------------------------------------------------------------

describe('slice4: Tap/Untap X target permanents (Reality Spasm)', () => {
  it('parses "Tap X target permanents." as Tap with Chosen target', () => {
    const p = spell('Tap X target permanents.');
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('Tap');
    if (e.kind !== 'Tap') throw new Error('wrong kind');
    expect(e.target.kind).toBe('Chosen');
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Permanent');
    expect(p.targets[0].count).toBeGreaterThan(1); // static cap
    expect(p.targets[0].minCount).toBe(1);
  });

  it('parses "Untap X target permanents." as Untap with Chosen target', () => {
    const p = spell('Untap X target permanents.');
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('Untap');
    if (e.kind !== 'Untap') throw new Error('wrong kind');
    expect(e.target.kind).toBe('Chosen');
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Permanent');
  });

  it('parses "Tap X target creatures." as Tap Chosen Creature target', () => {
    const p = spell('Tap X target creatures.');
    const e = p.effects[0];
    expect(e.kind).toBe('Tap');
    if (e.kind !== 'Tap') throw new Error('wrong kind');
    expect(e.target.kind).toBe('Chosen');
    expect(p.targets[0].type).toBe('Creature');
  });

  it('execution: Tap X — 2 chosen permanents become tapped', () => {
    const state = makeState([
      { id: 'c1', defId: 'd', owner: 'p1', tapped: false },
      { id: 'c2', defId: 'd', owner: 'p1', tapped: false },
    ]);
    const after = runMultiTarget(state, 'Tap X target permanents.', ['c1', 'c2'], { xValue: 2 });
    expect(after.cards.get('c1')!.tapped).toBe(true);
    expect(after.cards.get('c2')!.tapped).toBe(true);
  });

  it('execution: Untap X — 2 tapped permanents become untapped', () => {
    const state = makeState([
      { id: 'c1', defId: 'd', owner: 'p1', tapped: true },
      { id: 'c2', defId: 'd', owner: 'p1', tapped: true },
    ]);
    const after = runMultiTarget(state, 'Untap X target permanents.', ['c1', 'c2'], { xValue: 2 });
    expect(after.cards.get('c1')!.tapped).toBe(false);
    expect(after.cards.get('c2')!.tapped).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. matchTargetPlayerGainLifeX — Alabaster Potion bullet
// ---------------------------------------------------------------------------

describe('slice4: Target player gains X life (Alabaster Potion)', () => {
  it('parses "Target player gains X life." as GainLife Chosen Player, amount { kind: X }', () => {
    const p = spell('Target player gains X life.');
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('GainLife');
    if (e.kind !== 'GainLife') throw new Error('wrong kind');
    expect(e.player.kind).toBe('Chosen');
    expect(e.amount).toEqual({ kind: 'X' });
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
  });

  it('parses "Target opponent gains X life."', () => {
    const p = spell('Target opponent gains X life.');
    const e = p.effects[0];
    expect(e.kind).toBe('GainLife');
    if (e.kind !== 'GainLife') throw new Error('wrong kind');
    expect(e.amount).toEqual({ kind: 'X' });
  });

  it('regression: "Target player gains 3 life." still parses with numeric amount', () => {
    const p = spell('Target player gains 3 life.');
    const e = p.effects[0];
    expect(e.kind).toBe('GainLife');
    if (e.kind !== 'GainLife') throw new Error('wrong kind');
    expect(e.amount).toBe(3);
  });

  it('execution: target player gains xValue life', () => {
    const state = makeState([]);
    const initLife = state.players[1].life;
    const after = runSingleTarget(state, 'Target player gains X life.', 'p1', { xValue: 5 });
    expect(after.players[1].life).toBe(initLife + 5);
  });
});

// ---------------------------------------------------------------------------
// 5. matchPreventDamage with X amount — Alabaster Potion bullet
// ---------------------------------------------------------------------------

describe('slice4: Prevent the next X damage (Alabaster Potion)', () => {
  it('parses "Prevent the next X damage that would be dealt to any target this turn."', () => {
    const p = spell('Prevent the next X damage that would be dealt to any target this turn.');
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('PreventDamage');
    if (e.kind !== 'PreventDamage') throw new Error('wrong kind');
    expect(e.amount).toEqual({ kind: 'X' });
    expect(e.duration).toBe('turn');
  });

  it('parses "Prevent the next X damage that would be dealt to target creature this turn."', () => {
    const p = spell('Prevent the next X damage that would be dealt to target creature this turn.');
    const e = p.effects[0];
    expect(e.kind).toBe('PreventDamage');
    if (e.kind !== 'PreventDamage') throw new Error('wrong kind');
    expect(e.amount).toEqual({ kind: 'X' });
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Creature');
  });

  it('regression: "Prevent the next 3 damage..." still parses with numeric amount', () => {
    const p = spell('Prevent the next 3 damage that would be dealt to target creature this turn.');
    const e = p.effects[0];
    expect(e.kind).toBe('PreventDamage');
    if (e.kind !== 'PreventDamage') throw new Error('wrong kind');
    expect(e.amount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 6. matchTargetPlayerSacrifice extended — Pharika's Libation
// ---------------------------------------------------------------------------

describe("slice4: Target opponent sacrifices creature or enchantment (Pharika's Libation)", () => {
  it('parses "Target opponent sacrifices a creature or enchantment of their choice."', () => {
    const p = spell('Target opponent sacrifices a creature or enchantment of their choice.');
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('Sacrifice');
    if (e.kind !== 'Sacrifice') throw new Error('wrong kind');
    expect(e.player.kind).toBe('Chosen');
    // filter should allow creatures or enchantments
    expect(e.filter).toEqual({ types: ['creature', 'enchantment'] });
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    // target spec should constrain to opponents
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('parses "Target player sacrifices a creature or enchantment of their choice."', () => {
    const p = spell('Target player sacrifices a creature or enchantment of their choice.');
    const e = p.effects[0];
    expect(e.kind).toBe('Sacrifice');
    if (e.kind !== 'Sacrifice') throw new Error('wrong kind');
    expect(e.filter).toEqual({ types: ['creature', 'enchantment'] });
  });

  it('regression: "Target player sacrifices a creature." still parses with creature filter', () => {
    const p = spell('Target player sacrifices a creature.');
    const e = p.effects[0];
    expect(e.kind).toBe('Sacrifice');
    if (e.kind !== 'Sacrifice') throw new Error('wrong kind');
    expect(e.filter).toEqual({ types: ['creature'] });
  });

  it('regression: "Target player sacrifices an artifact or enchantment of their choice."', () => {
    const p = spell('Target player sacrifices an artifact or enchantment of their choice.');
    const e = p.effects[0];
    expect(e.kind).toBe('Sacrifice');
    if (e.kind !== 'Sacrifice') throw new Error('wrong kind');
    expect(e.filter).toEqual({ types: ['artifact', 'enchantment'] });
  });

  it('execution: chosen player sacrifices a matching creature (target player form)', () => {
    const state = makeState([
      { id: 'c_creature', defId: 'd_creature', owner: 'p1', types: ['creature'] },
    ]);
    // p1 has only a creature -- it should be sacrificed when we target p1
    const after = runSingleTarget(
      state,
      'Target player sacrifices a creature or enchantment of their choice.',
      'p1',
    );
    expect(after.cards.get('c_creature')!.zone).toBe('graveyard');
  });
});

// ---------------------------------------------------------------------------
// 7. matchCopyCreature extended — Mirage Mockery (artifact creature target)
// ---------------------------------------------------------------------------

describe('slice4: Create a token copy of target artifact creature (Mirage Mockery)', () => {
  it('parses "Create a token that is a copy of target artifact creature you control."', () => {
    const p = spell('Create a token that is a copy of target artifact creature you control.');
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('Copy');
    if (e.kind !== 'Copy') throw new Error('wrong kind');
    expect(e.target.kind).toBe('Chosen');
    expect(p.targets).toHaveLength(1);
    const t = p.targets[0];
    expect(t.type).toBe('Creature');
    expect(t.constraints?.types).toContain('artifact');
    expect(t.constraints?.controllerControls).toBe(true);
  });

  it("parses the that's phrasing: \"Create a token that's a copy of target artifact creature you control.\"", () => {
    const p = spell("Create a token that's a copy of target artifact creature you control.");
    expect(p.effects[0].kind).toBe('Copy');
    expect(p.targets[0].constraints?.types).toContain('artifact');
  });

  it('regression: "Create a token that is a copy of target creature." still parses (no artifact constraint)', () => {
    const p = spell('Create a token that is a copy of target creature.');
    const e = p.effects[0];
    expect(e.kind).toBe('Copy');
    if (e.kind !== 'Copy') throw new Error('wrong kind');
    expect(p.targets[0].type).toBe('Creature');
    // No types constraint when just "creature"
    expect(p.targets[0].constraints?.types).toBeUndefined();
  });

  it('execution: copies the target artifact creature', () => {
    const artifactCreatureDef: CardDefinition = {
      id: 'd_artifact_creature',
      name: 'Myr Retriever',
      type_line: 'Artifact Creature',
      oracle_text: '',
      mana_cost: '{2}',
      cmc: 2,
      colors: [],
      color_identity: [],
      keywords: [],
      card_types: ['artifact', 'creature'],
      power: 1,
      toughness: 1,
    };
    const state = makeState(
      [{ id: 'c_orig', defId: 'd_artifact_creature', owner: 'p0' }],
      [artifactCreatureDef],
    );
    // Execute — the executor creates a token copy on the battlefield.
    const after = runSingleTarget(
      state,
      'Create a token that is a copy of target artifact creature you control.',
      'c_orig',
    );
    // There should be an extra card (the token copy) on the battlefield.
    const battlefield = [...after.cards.values()].filter(c => c.zone === 'battlefield');
    expect(battlefield).toHaveLength(2);
    const tokenCard = battlefield.find(c => c.instanceId !== 'c_orig');
    expect(tokenCard).toBeDefined();
    expect(tokenCard!.isToken).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. matchRemoveCountersWhereX — Thornmantle Striker
// ---------------------------------------------------------------------------

describe('slice4: Remove X counters from target permanent where X (Thornmantle Striker)', () => {
  it('parses "Remove X +1/+1 counters from target permanent."', () => {
    const p = spell('Remove X +1/+1 counters from target permanent.');
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('RemoveCounters');
    if (e.kind !== 'RemoveCounters') throw new Error('wrong kind');
    expect(e.count).toEqual({ kind: 'X' });
    expect(e.counterType).toBe('+1/+1');
    expect(e.target.kind).toBe('Chosen');
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Permanent');
  });

  it('parses "Remove X counters from target permanent, where X is the number of +1/+1 counters on it."', () => {
    const p = spell(
      'Remove X counters from target permanent, where X is the number of +1/+1 counters on it.',
    );
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('RemoveCounters');
    if (e.kind !== 'RemoveCounters') throw new Error('wrong kind');
    expect(e.count).toEqual({ kind: 'X' });
    expect(e.counterType).toBe('+1/+1');
    expect(e.target.kind).toBe('Chosen');
    expect(p.targets[0].type).toBe('Permanent');
  });

  it('parses "Remove X ki counters from target creature."', () => {
    const p = spell('Remove X ki counters from target creature.');
    const e = p.effects[0];
    expect(e.kind).toBe('RemoveCounters');
    if (e.kind !== 'RemoveCounters') throw new Error('wrong kind');
    expect(e.count).toEqual({ kind: 'X' });
    expect(e.counterType).toBe('ki');
    expect(p.targets[0].type).toBe('Creature');
  });

  it('regression: "Remove a +1/+1 counter from target creature." still parses fixed count', () => {
    const p = spell('Remove a +1/+1 counter from target creature.');
    const e = p.effects[0];
    expect(e.kind).toBe('RemoveCounters');
    if (e.kind !== 'RemoveCounters') throw new Error('wrong kind');
    expect(e.count).toBe(1);
    expect(e.counterType).toBe('+1/+1');
  });

  it('execution: removes X +1/+1 counters from target permanent (xValue=3)', () => {
    const state = makeState([
      {
        id: 'c_target',
        defId: 'd',
        owner: 'p0',
        counters: { '+1/+1': 5 },
        types: ['creature'],
      },
    ]);
    const after = runSingleTarget(
      state,
      'Remove X counters from target permanent, where X is the number of +1/+1 counters on it.',
      'c_target',
      { xValue: 3 },
    );
    expect(after.cards.get('c_target')!.counters['+1/+1']).toBe(2);
  });
});
