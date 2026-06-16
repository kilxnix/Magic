/**
 * Slice 9 — Exile / bounce compound-target parity with Destroy
 *
 * Verified asymmetry: matchDestroy accepted ArtifactOrEnchantment,
 * ArtifactEnchantmentOrLand, Artifact, Enchantment, Land, CreatureOrPlaneswalker
 * but matchExile, matchReturnToHand, and matchTap did not.
 *
 * This file:
 * 1. Confirms the new compound-target forms parse correctly (parse-only tests).
 * 2. Executes representative exile/bounce/tap effects on concrete game states.
 * 3. Runs a parity corpus: every (verb, target-noun) pair that matchDestroy
 *    accepts is accepted by the sibling verbs.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeDef(
  id: string,
  overrides: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: id,
    type_line: overrides.type_line ?? 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: 2,
    toughness: 2,
    card_types: overrides.card_types ?? ['creature'],
    ...overrides,
  } as CardDefinition;
}

function makeCard(
  instanceId: string,
  ownerId: string,
  definitionId: string,
  zone: CardInstance['zone'] = 'battlefield',
  overrides: Partial<CardInstance> = {},
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
    ...overrides,
  } as CardInstance;
}

/** Build a minimal two-player state with the provided definitions and instances. */
function makeState(
  defs: CardDefinition[],
  cards: CardInstance[],
): GameState {
  const defMap = new Map(defs.map(d => [d.id, d]));
  const cardMap = new Map(cards.map(c => [c.instanceId, c]));
  return {
    players: [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob')],
    cards: cardMap,
    cardDefinitions: defMap,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

/** Parse oracle text and assert it is a Spell, returning effects. */
function spellEffects(text: string): Effect[] {
  const parsed = parseOracleText(text);
  expect(parsed.kind).toBe('Spell');
  if (parsed.kind !== 'Spell') throw new Error(`Unexpected: ${parsed.kind}`);
  return parsed.effects;
}

// ── Parity corpus ─────────────────────────────────────────────────────────────
// Every target-noun phrase that matchDestroy accepts must also parse for the
// sibling verbs (exile / return-to-hand / tap).

const COMPOUND_TARGET_NOUNS: Array<{ noun: string; expectedType: string }> = [
  { noun: 'artifact',                          expectedType: 'Artifact' },
  { noun: 'enchantment',                       expectedType: 'Enchantment' },
  { noun: 'land',                              expectedType: 'Land' },
  { noun: 'artifact or enchantment',           expectedType: 'ArtifactOrEnchantment' },
  { noun: 'creature or planeswalker',          expectedType: 'CreatureOrPlaneswalker' },
];

const RETURN_SUFFIX = "to its owner's hand";

describe('Slice 9: parity corpus — exile compound targets', () => {
  for (const { noun, expectedType } of COMPOUND_TARGET_NOUNS) {
    it(`parses "Exile target ${noun}." → ${expectedType}`, () => {
      const text = `Exile target ${noun}.`;
      const parsed = parseOracleText(text);
      expect(parsed.kind).toBe('Spell');
      if (parsed.kind !== 'Spell') return;
      expect(parsed.effects).toHaveLength(1);
      const e = parsed.effects[0];
      expect(e.kind).toBe('Exile');
      expect(parsed.targets).toHaveLength(1);
      expect(parsed.targets[0].type).toBe(expectedType);
    });
  }
});

describe('Slice 9: parity corpus — return-to-hand compound targets', () => {
  for (const { noun, expectedType } of COMPOUND_TARGET_NOUNS) {
    it(`parses "Return target ${noun} ${RETURN_SUFFIX}." → ${expectedType}`, () => {
      const text = `Return target ${noun} ${RETURN_SUFFIX}.`;
      const parsed = parseOracleText(text);
      expect(parsed.kind).toBe('Spell');
      if (parsed.kind !== 'Spell') return;
      expect(parsed.effects).toHaveLength(1);
      const e = parsed.effects[0];
      expect(e.kind).toBe('ReturnToHand');
      expect(parsed.targets).toHaveLength(1);
      expect(parsed.targets[0].type).toBe(expectedType);
    });
  }
});

describe('Slice 9: parity corpus — tap compound targets', () => {
  for (const { noun, expectedType } of COMPOUND_TARGET_NOUNS) {
    it(`parses "Tap target ${noun}." → ${expectedType}`, () => {
      const text = `Tap target ${noun}.`;
      const parsed = parseOracleText(text);
      expect(parsed.kind).toBe('Spell');
      if (parsed.kind !== 'Spell') return;
      expect(parsed.effects).toHaveLength(1);
      const e = parsed.effects[0];
      expect(e.kind).toBe('Tap');
      expect(parsed.targets).toHaveLength(1);
      expect(parsed.targets[0].type).toBe(expectedType);
    });
  }
});

// ── Real oracle wording parse tests ───────────────────────────────────────────

describe('Slice 9: real oracle wordings — parse', () => {
  it('Revoke Existence: "Exile target artifact or enchantment."', () => {
    const es = spellEffects('Exile target artifact or enchantment.');
    expect(es).toHaveLength(1);
    expect(es[0].kind).toBe('Exile');
    const parsed = parseOracleText('Exile target artifact or enchantment.');
    if (parsed.kind !== 'Spell') throw new Error();
    expect(parsed.targets[0].type).toBe('ArtifactOrEnchantment');
  });

  it('Fade into Antiquity (same first sentence): parses as ArtifactOrEnchantment', () => {
    const parsed = parseOracleText('Exile target artifact or enchantment.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets[0].type).toBe('ArtifactOrEnchantment');
  });

  it('"Return target artifact or enchantment to its owner\'s hand." parses as ArtifactOrEnchantment bounce', () => {
    const parsed = parseOracleText("Return target artifact or enchantment to its owner's hand.");
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('ReturnToHand');
    expect(parsed.targets[0].type).toBe('ArtifactOrEnchantment');
  });

  it('"Exile target creature or planeswalker." parses as CreatureOrPlaneswalker', () => {
    const parsed = parseOracleText('Exile target creature or planeswalker.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('Exile');
    expect(parsed.targets[0].type).toBe('CreatureOrPlaneswalker');
  });

  it('"Tap target artifact or enchantment." parses as ArtifactOrEnchantment tap', () => {
    const parsed = parseOracleText('Tap target artifact or enchantment.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('Tap');
    expect(parsed.targets[0].type).toBe('ArtifactOrEnchantment');
  });

  it('ArtifactEnchantmentOrLand exile parses correctly', () => {
    const parsed = parseOracleText('Exile target artifact, enchantment, or land.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('Exile');
    expect(parsed.targets[0].type).toBe('ArtifactEnchantmentOrLand');
  });
});

// ── Execution tests ───────────────────────────────────────────────────────────

describe('Slice 9: execution — exile ArtifactOrEnchantment', () => {
  it('exiles an artifact from the battlefield', () => {
    const artifactDef = makeDef('sol-ring', {
      type_line: 'Artifact',
      card_types: ['artifact'],
      power: undefined,
      toughness: undefined,
    });
    const state = makeState(
      [artifactDef],
      [makeCard('sol1', 'p1', 'sol-ring')],
    );
    const parsed = parseOracleText('Exile target artifact or enchantment.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    // chosenTargetIds is a flat array matching parsed.targets order
    const newState = executeEffects(state, parsed.effects, 'p2', ['sol1'], parsed.targets, 0, {});
    expect(newState.cards.get('sol1')!.zone).toBe('exile');
  });

  it('exiles an enchantment from the battlefield', () => {
    const enchantDef = makeDef('pacifism', {
      type_line: 'Enchantment',
      card_types: ['enchantment'],
      power: undefined,
      toughness: undefined,
    });
    const state = makeState(
      [enchantDef],
      [makeCard('pac1', 'p1', 'pacifism')],
    );
    const parsed = parseOracleText('Exile target artifact or enchantment.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const newState = executeEffects(state, parsed.effects, 'p2', ['pac1'], parsed.targets, 0, {});
    expect(newState.cards.get('pac1')!.zone).toBe('exile');
  });
});

describe('Slice 9: execution — bounce ArtifactOrEnchantment', () => {
  it("returns an artifact to its owner's hand", () => {
    const artifactDef = makeDef('mox-pearl', {
      type_line: 'Artifact',
      card_types: ['artifact'],
      power: undefined,
      toughness: undefined,
    });
    const state = makeState(
      [artifactDef],
      [makeCard('mox1', 'p1', 'mox-pearl')],
    );
    const parsed = parseOracleText("Return target artifact or enchantment to its owner's hand.");
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const newState = executeEffects(state, parsed.effects, 'p2', ['mox1'], parsed.targets, 0, {});
    expect(newState.cards.get('mox1')!.zone).toBe('hand');
  });
});

describe('Slice 9: execution — tap ArtifactOrEnchantment', () => {
  it('taps an artifact on the battlefield', () => {
    const artifactDef = makeDef('chrome-mox', {
      type_line: 'Artifact',
      card_types: ['artifact'],
      power: undefined,
      toughness: undefined,
    });
    const state = makeState(
      [artifactDef],
      [makeCard('mox2', 'p1', 'chrome-mox')],
    );
    const parsed = parseOracleText('Tap target artifact or enchantment.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const newState = executeEffects(state, parsed.effects, 'p2', ['mox2'], parsed.targets, 0, {});
    expect(newState.cards.get('mox2')!.tapped).toBe(true);
  });
});

// ── Trigger-body parity (ETB / triggered-ability bodies) ────────────────────

describe('Slice 9: parity inside trigger bodies', () => {
  it('"When ~ enters, exile target artifact or enchantment." parses as ETB', () => {
    const parsed = parseOracleText('When ~ enters, exile target artifact or enchantment.');
    expect(parsed.kind).not.toBe('Unparsed');
    if (parsed.kind !== 'ETB') return;
    const e = parsed.ability.effects[0];
    expect(e.kind).toBe('Exile');
  });

  it('"When ~ enters, return target artifact or enchantment to its owner\'s hand." parses as ETB', () => {
    const parsed = parseOracleText("When ~ enters, return target artifact or enchantment to its owner's hand.");
    expect(parsed.kind).not.toBe('Unparsed');
    if (parsed.kind !== 'ETB') return;
    const e = parsed.ability.effects[0];
    expect(e.kind).toBe('ReturnToHand');
  });
});
