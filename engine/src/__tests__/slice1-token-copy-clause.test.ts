/**
 * Slice 1: matchCreateTokenCopy — "create a token that's a copy of <extended target>"
 *
 * Covers the forms NOT handled by matchCopyCreature:
 *   1. "another target nonland permanent you control" (Extravagant Replication)
 *   2. "target non-<Subtype> creature" (Croaking Counterpart style)
 *   3. plural fixed count: "two tokens that are copies of target creature"
 *   4. "target noncreature permanent" (Hate Mirage)
 *   5. Execution: creates the correct number of token copies on the battlefield.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spell(text: string) {
  const parsed = parseOracleText(text);
  expect(parsed.kind, `Expected Spell for: ${text}`).toBe('Spell');
  return parsed as Extract<ReturnType<typeof parseOracleText>, { kind: 'Spell' }>;
}

function triggered(text: string) {
  const parsed = parseOracleText(text);
  // Accept both Triggered and ETB
  expect(['Triggered', 'ETB'], `Expected Triggered/ETB for: ${text}`).toContain(parsed.kind);
  return parsed as Extract<ReturnType<typeof parseOracleText>, { kind: 'Triggered' }>;
}

function makeState(
  cards: Array<{
    id: string;
    defId: string;
    owner: string;
    zone?: CardInstance['zone'];
  }>,
  defs?: CardDefinition[],
): GameState {
  const cardMap = new Map<string, CardInstance>();
  const defMap = new Map<string, CardDefinition>();

  for (const c of cards) {
    cardMap.set(c.id, {
      instanceId: c.id,
      definitionId: c.defId,
      ownerId: c.owner,
      zone: c.zone ?? 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
      isToken: false,
    });
  }

  if (defs) {
    for (const d of defs) defMap.set(d.id, d);
  }

  for (const c of cards) {
    if (!defMap.has(c.defId)) {
      defMap.set(c.defId, {
        id: c.defId,
        name: c.defId,
        type_line: 'Creature',
        oracle_text: '',
        mana_cost: '{2}',
        cmc: 2,
        colors: [],
        color_identity: [],
        keywords: [],
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      });
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

function runSingleTarget(
  state: GameState,
  text: string,
  targetId: string,
  opts: { caster?: string } = {},
): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
  return executeEffects(
    state,
    p.effects,
    opts.caster ?? 'p0',
    [targetId],
    p.targets,
    0,
    {},
  );
}

// ---------------------------------------------------------------------------
// 1. "another target nonland permanent you control" (Extravagant Replication)
// ---------------------------------------------------------------------------

describe('slice1-token-copy: another target nonland permanent you control', () => {
  const TEXT = "Create a token that's a copy of another target nonland permanent you control.";

  it('parses as a Spell with a Copy effect', () => {
    const p = spell(TEXT);
    expect(p.effects).toHaveLength(1);
    expect(p.effects[0].kind).toBe('Copy');
  });

  it('emits a single NonlandPermanent target spec', () => {
    const p = spell(TEXT);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('NonlandPermanent');
  });

  it('applies notSource and controllerControls constraints', () => {
    const p = spell(TEXT);
    const t = p.targets[0];
    expect(t.constraints?.notSource).toBe(true);
    expect(t.constraints?.controllerControls).toBe(true);
  });

  it('execution: creates a token copy of the chosen nonland permanent', () => {
    const enchantDef: CardDefinition = {
      id: 'd_enchant',
      name: 'Propaganda',
      type_line: 'Enchantment',
      oracle_text: '',
      mana_cost: '{2}{U}',
      cmc: 3,
      colors: ['U'],
      color_identity: ['U'],
      keywords: [],
      card_types: ['enchantment'],
    };
    const state = makeState(
      [{ id: 'c_prop', defId: 'd_enchant', owner: 'p0' }],
      [enchantDef],
    );
    const after = runSingleTarget(state, TEXT, 'c_prop');
    const battlefield = [...after.cards.values()].filter(c => c.zone === 'battlefield');
    expect(battlefield).toHaveLength(2);
    const token = battlefield.find(c => c.instanceId !== 'c_prop');
    expect(token).toBeDefined();
    expect(token!.isToken).toBe(true);
  });

  it('trigger context: upkeep trigger body parses correctly (Extravagant Replication style)', () => {
    const trigText = "At the beginning of your upkeep, create a token that's a copy of another target nonland permanent you control.";
    const p = parseOracleText(trigText);
    expect(['Triggered', 'ETB']).toContain(p.kind);
    if (p.kind !== 'Triggered' && p.kind !== 'ETB') return;
    expect(p.ability.effects).toHaveLength(1);
    expect(p.ability.effects[0].kind).toBe('Copy');
  });
});

// ---------------------------------------------------------------------------
// 2. "target non-<Subtype> creature" (Croaking Counterpart style)
// ---------------------------------------------------------------------------

describe('slice1-token-copy: target non-Frog creature', () => {
  const TEXT = "Create a token that's a copy of target non-Frog creature.";

  it('parses as a Spell with a Copy effect', () => {
    const p = spell(TEXT);
    expect(p.effects).toHaveLength(1);
    expect(p.effects[0].kind).toBe('Copy');
  });

  it('emits a Creature target spec with excludeSubtypes frog', () => {
    const p = spell(TEXT);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Creature');
    expect(p.targets[0].constraints?.excludeSubtypes).toContain('frog');
  });

  it('parses the "that is" copula variant', () => {
    const p = spell("Create a token that is a copy of target non-Frog creature.");
    expect(p.effects[0].kind).toBe('Copy');
    expect(p.targets[0].constraints?.excludeSubtypes).toContain('frog');
  });

  it('execution: creates a token copy of the target non-Frog creature', () => {
    const dragonDef: CardDefinition = {
      id: 'd_dragon',
      name: 'Some Dragon',
      type_line: 'Creature — Dragon',
      oracle_text: '',
      mana_cost: '{5}{R}',
      cmc: 6,
      colors: ['R'],
      color_identity: ['R'],
      keywords: ['Flying'],
      card_types: ['creature'],
      power: 5,
      toughness: 5,
    };
    const state = makeState(
      [{ id: 'c_dragon', defId: 'd_dragon', owner: 'p1' }],
      [dragonDef],
    );
    const after = runSingleTarget(state, TEXT, 'c_dragon');
    const battlefield = [...after.cards.values()].filter(c => c.zone === 'battlefield');
    expect(battlefield).toHaveLength(2);
    const token = battlefield.find(c => c.instanceId !== 'c_dragon');
    expect(token).toBeDefined();
    expect(token!.isToken).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Plural fixed count: "create two tokens that are copies of target creature"
// ---------------------------------------------------------------------------

describe('slice1-token-copy: two tokens that are copies of target creature (plural count)', () => {
  const TEXT = "Create two tokens that are copies of target nonland permanent.";

  it('parses as a Spell with two Copy effects', () => {
    const p = spell(TEXT);
    expect(p.effects).toHaveLength(2);
    for (const e of p.effects) {
      expect(e.kind).toBe('Copy');
    }
  });

  it('emits one NonlandPermanent target spec (shared by both effects)', () => {
    const p = spell(TEXT);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('NonlandPermanent');
  });

  it('execution: creates two token copies', () => {
    const creatureDef: CardDefinition = {
      id: 'd_hydra',
      name: 'Hydra',
      type_line: 'Creature — Hydra',
      oracle_text: '',
      mana_cost: '{4}{G}',
      cmc: 5,
      colors: ['G'],
      color_identity: ['G'],
      keywords: [],
      card_types: ['creature'],
      power: 4,
      toughness: 4,
    };
    const state = makeState(
      [{ id: 'c_hydra', defId: 'd_hydra', owner: 'p0' }],
      [creatureDef],
    );
    const after = runSingleTarget(state, TEXT, 'c_hydra');
    const battlefield = [...after.cards.values()].filter(c => c.zone === 'battlefield');
    // Original + 2 tokens
    expect(battlefield).toHaveLength(3);
    const tokens = battlefield.filter(c => c.isToken);
    expect(tokens).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 4. "target noncreature permanent" form
// ---------------------------------------------------------------------------

describe('slice1-token-copy: target noncreature permanent', () => {
  const TEXT = "Create a token that's a copy of target noncreature permanent.";

  it('parses as a Spell with a Copy effect', () => {
    const p = spell(TEXT);
    expect(p.effects).toHaveLength(1);
    expect(p.effects[0].kind).toBe('Copy');
  });

  it('emits a Permanent target spec with excludeTypes creature', () => {
    const p = spell(TEXT);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Permanent');
    expect(p.targets[0].constraints?.excludeTypes).toContain('creature');
  });
});

// ---------------------------------------------------------------------------
// 5. Non-regression: existing matchCopyCreature forms still parse
// ---------------------------------------------------------------------------

describe('slice1-token-copy: non-regression for existing matchCopyCreature forms', () => {
  it('plain "target creature" still parses via matchCopyCreature', () => {
    const p = spell("Create a token that's a copy of target creature.");
    expect(p.effects[0].kind).toBe('Copy');
    expect(p.targets[0].type).toBe('Creature');
    // No excludeSubtypes — this is the plain form
    expect(p.targets[0].constraints?.excludeSubtypes).toBeUndefined();
  });

  it('"target permanent" still parses via matchCopyCreature', () => {
    const p = spell("Create a token that's a copy of target permanent.");
    expect(p.effects[0].kind).toBe('Copy');
    expect(p.targets[0].type).toBe('Permanent');
  });

  it('"create a copy of target creature" still parses', () => {
    const p = spell("Create a copy of target creature.");
    expect(p.effects[0].kind).toBe('Copy');
  });
});
