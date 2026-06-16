/**
 * Slice 1: Negated-control conditional statics
 * "as long as you/your opponents control no [other] <filter>"
 *
 * Covers:
 *   - ControlsNone condition parsing (all three example oracle wordings)
 *   - evaluateCondition in continuous.ts (PT boost, keyword grant)
 *   - combat.ts Unblockable gate via getKeywordsForInstance / instanceHasKeyword
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getEffectivePower, getEffectiveToughness, evaluateCondition } from '../effects/continuous';
import { canBlock, instanceHasKeyword } from '../keywords';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition, GameState } from '../types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function creature(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
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

function artifact(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Artifact',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['artifact'],
    power: opts.power ?? undefined,
    toughness: opts.toughness ?? undefined,
  };
}

/**
 * Set up a game state with p1 and p2 decks. All cards land on the battlefield
 * unless a zone override is specified, and continuous statics are registered.
 */
function setup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[] = [creature('dummy')],
  zones: Record<string, 'graveyard' | 'library' | 'hand'> = {},
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];
  let state = initGameState(decks);
  for (const [id, card] of state.cards) {
    const zone = zones[card.definitionId] ?? 'battlefield';
    state.cards.set(id, { ...card, zone, summoningSick: false });
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

// ---------------------------------------------------------------------------
// Parser-level tests
// ---------------------------------------------------------------------------

describe('ControlsNone condition — parser recognition', () => {
  it('Erebos\'s Titan: "As long as your opponents control no creatures, this creature has indestructible."', () => {
    const r = parseOracleText(
      "As long as your opponents control no creatures, this creature has indestructible.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'indestructible' });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toEqual({
      kind: 'ControlsNone',
      controller: 'opponent',
      filter: { types: ['creature'] },
    });
  });

  it('Jeskai Infiltrator: "This creature can\'t be blocked as long as you control no other creatures."', () => {
    const r = parseOracleText(
      "This creature can't be blocked as long as you control no other creatures.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'unblockable' });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toEqual({
      kind: 'ControlsNone',
      controller: 'you',
      filter: { types: ['creature'] },
      excludeSource: true,
    });
  });

  it('Angelic Voices: "Creatures you control get +1/+1 as long as you control no nonartifact, nonwhite creatures."', () => {
    const r = parseOracleText(
      "Creatures you control get +1/+1 as long as you control no nonartifact, nonwhite creatures.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.filter).toEqual(expect.objectContaining({ types: ['creature'] }));
    expect(r.ability.condition).toEqual(expect.objectContaining({
      kind: 'ControlsNone',
      controller: 'you',
    }));
    const cond = r.ability.condition as Extract<typeof r.ability.condition, { kind: 'ControlsNone' }>;
    // Filter must exclude artifact types and white color
    expect(cond.filter.excludeTypes).toContain('artifact');
    expect(cond.filter.excludeColors).toContain('W');
  });

  it('suffix form with simple "no creatures" — emits ControlsNone', () => {
    const r = parseOracleText(
      "This creature gets +2/+2 as long as you control no creatures.",
    );
    // The source itself IS a creature, so "no creatures" with no excludeSource
    // means even the source itself counts. Still should parse.
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({
      kind: 'ControlsNone',
      controller: 'you',
      filter: { types: ['creature'] },
    });
  });

  it('prefix form "As long as your opponents control no creatures"', () => {
    const r = parseOracleText(
      "As long as your opponents control no creatures, this creature gets +3/+3.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({
      kind: 'ControlsNone',
      controller: 'opponent',
      filter: { types: ['creature'] },
    });
  });
});

// ---------------------------------------------------------------------------
// evaluateCondition unit tests (continuous.ts)
// ---------------------------------------------------------------------------

describe('evaluateCondition — ControlsNone (continuous.ts)', () => {
  it('returns true when opponent controls no creatures', () => {
    // p1 has one creature; p2 has none (hand zone)
    const { state } = setup(
      [creature('c1')],
      [creature('c2')],
      { c2: 'hand' },
    );
    const cond = { kind: 'ControlsNone' as const, controller: 'opponent' as const, filter: { types: ['creature'] } };
    expect(evaluateCondition(state, cond, 'p1')).toBe(true);
  });

  it('returns false when opponent controls a creature', () => {
    const { state } = setup([creature('c1')], [creature('c2')]);
    const cond = { kind: 'ControlsNone' as const, controller: 'opponent' as const, filter: { types: ['creature'] } };
    expect(evaluateCondition(state, cond, 'p1')).toBe(false);
  });

  it('excludeSource: true — source creature itself is not counted', () => {
    // p1 has one creature (the source). With excludeSource, "no other creatures" = true.
    const { state, idFor } = setup([creature('src')]);
    const sourceInstanceId = idFor('src');
    const cond = {
      kind: 'ControlsNone' as const,
      controller: 'you' as const,
      filter: { types: ['creature'] },
      excludeSource: true,
    };
    expect(evaluateCondition(state, cond, 'p1', sourceInstanceId)).toBe(true);
  });

  it('excludeSource: true — a second creature makes condition false', () => {
    const { state, idFor } = setup([creature('src'), creature('other')]);
    const sourceInstanceId = idFor('src');
    const cond = {
      kind: 'ControlsNone' as const,
      controller: 'you' as const,
      filter: { types: ['creature'] },
      excludeSource: true,
    };
    expect(evaluateCondition(state, cond, 'p1', sourceInstanceId)).toBe(false);
  });

  it('filter by type — artifact presence does not block "no creatures" condition', () => {
    // p1 controls one artifact (not a creature) but no creatures
    const { state } = setup(
      [artifact('sol')],
      [creature('dummy')],
    );
    const cond = { kind: 'ControlsNone' as const, controller: 'you' as const, filter: { types: ['creature'] } };
    expect(evaluateCondition(state, cond, 'p1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Execution-level: static gating via continuous.ts
// ---------------------------------------------------------------------------

describe('Erebos\'s Titan — indestructible gated on opponents controlling no creatures', () => {
  const erebosTitan = creature('titan', {
    name: "Erebos's Titan (stub)",
    oracle_text: "As long as your opponents control no creatures, this creature has indestructible.",
    colors: ['B'],
    power: 5,
    toughness: 5,
  });

  it('has indestructible when opponent controls no creatures', () => {
    const { state, idFor } = setup(
      [erebosTitan],
      [creature('opp')],
      { opp: 'hand' },  // opponent's creature in hand, not battlefield
    );
    const id = idFor('titan');
    expect(instanceHasKeyword(state, id, 'Indestructible')).toBe(true);
  });

  it('loses indestructible when opponent controls a creature', () => {
    const { state, idFor } = setup([erebosTitan], [creature('opp')]);
    const id = idFor('titan');
    expect(instanceHasKeyword(state, id, 'Indestructible')).toBe(false);
  });
});

describe('Jeskai Infiltrator — unblockable gated on you controlling no other creatures', () => {
  const jeskaiInfiltrator = creature('infiltrator', {
    name: 'Jeskai Infiltrator (stub)',
    oracle_text: "This creature can't be blocked as long as you control no other creatures.",
    colors: ['U'],
    power: 2,
    toughness: 3,
  });

  it('is unblockable when controller has no other creatures', () => {
    // p1 only has the infiltrator; p2 has a blocker
    const blocker = creature('blocker');
    const { state, idFor } = setup([jeskaiInfiltrator], [blocker]);
    const infiltratorId = idFor('infiltrator');
    const blockerId = idFor('blocker');
    // The infiltrator is unblockable, so canBlock returns false
    expect(canBlock(state, blockerId, infiltratorId)).toBe(false);
  });

  it('becomes blockable when controller has another creature', () => {
    const ally = creature('ally');
    const blocker = creature('blocker');
    // p1 controls infiltrator + ally, p2 controls blocker
    const { state, idFor } = setup([jeskaiInfiltrator, ally], [blocker]);
    const infiltratorId = idFor('infiltrator');
    const blockerId = idFor('blocker');
    // Condition false: "you control no other creatures" — ally breaks it
    expect(canBlock(state, blockerId, infiltratorId)).toBe(true);
  });
});

describe('Angelic Voices — +1/+1 gated on controlling no nonartifact, nonwhite creatures', () => {
  const angelicVoices = {
    id: 'voices',
    name: 'Angelic Voices (stub)',
    type_line: 'Enchantment',
    oracle_text: 'Creatures you control get +1/+1 as long as you control no nonartifact, nonwhite creatures.',
    mana_cost: '{2}{W}{W}',
    cmc: 4,
    colors: ['W'] as Array<'W' | 'U' | 'B' | 'R' | 'G'>,
    color_identity: ['W'] as Array<'W' | 'U' | 'B' | 'R' | 'G'>,
    keywords: [] as string[],
    card_types: ['enchantment'] as string[],
    power: undefined,
    toughness: undefined,
  };

  it('grants +1/+1 when controller has only white artifact creatures', () => {
    const whiteArtifactCreature = {
      ...creature('wa', { colors: ['W'] }),
      type_line: 'Artifact Creature — Construct',
      card_types: ['artifact', 'creature'],
    };
    const { state, idFor } = setup([angelicVoices, whiteArtifactCreature]);
    const id = idFor('wa');
    // white artifact creature is excluded from the "no nonartifact, nonwhite" filter
    // (it IS artifact AND IS white), so condition is true → +1/+1 applies
    expect(getEffectivePower(state, id)).toBe(3);  // base 2 + 1
    expect(getEffectiveToughness(state, id)).toBe(3);
  });

  it('loses +1/+1 when controller has a green creature (nonwhite, nonartifact)', () => {
    const greenCreature = creature('gc', { colors: ['G'], power: 2, toughness: 2 });
    const whiteCreature = creature('wc', { colors: ['W'], power: 1, toughness: 1 });
    // Both controlled by p1 alongside Angelic Voices
    const { state, idFor } = setup([angelicVoices, greenCreature, whiteCreature]);
    const wId = idFor('wc');
    // Green creature breaks the condition: +1/+1 should NOT apply
    expect(getEffectivePower(state, wId)).toBe(1);
    expect(getEffectiveToughness(state, wId)).toBe(1);
  });
});
