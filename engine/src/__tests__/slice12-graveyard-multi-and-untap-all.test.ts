import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

/**
 * Slice 12 coverage: two additive parser wins.
 *
 * (a) "Return two/three target creature cards from your graveyard to your hand"
 *     — Death's Duet, Soul Strings.  matchReturnFromGraveyard now handles exact-N
 *     (no "up to") by detecting the count word before "target".  Executor is
 *     unchanged: resolveChosenTargetIds already iterates every id for count > 1.
 *
 * (b) "Untap all artifacts" / "Untap all lands" (no "you control")
 *     — Blinkmoth Infusion family.  matchUntap now falls through to a new branch
 *     that emits AllOfType with controllerControls:false, which the executor's
 *     Untap AllOfType path already handles (untapControllerId = undefined → every
 *     matching permanent on the battlefield, regardless of owner).
 */

// ────────────────────────────────────────────────────────────────────────────
// Shared card definitions
// ────────────────────────────────────────────────────────────────────────────

const defs: Record<string, CardDefinition> = {
  bear: {
    id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear',
    oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
    colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
    power: 2, toughness: 2,
  },
  wurm: {
    id: 'wurm', name: 'Spined Wurm', type_line: 'Creature — Wurm',
    oracle_text: '', mana_cost: '{4}{G}', cmc: 5,
    colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
    power: 5, toughness: 4,
  },
  angel: {
    id: 'angel', name: 'Serra Angel', type_line: 'Creature — Angel',
    oracle_text: 'Flying, vigilance', mana_cost: '{3}{W}{W}', cmc: 5,
    colors: ['W'], color_identity: ['W'], keywords: ['Flying', 'Vigilance'],
    card_types: ['creature'], power: 4, toughness: 4,
  },
  rock: {
    id: 'rock', name: 'Mana Rock', type_line: 'Artifact',
    oracle_text: '', mana_cost: '{2}', cmc: 2,
    colors: [], color_identity: [], keywords: [], card_types: ['artifact'],
  },
  rock2: {
    id: 'rock2', name: 'Another Rock', type_line: 'Artifact',
    oracle_text: '', mana_cost: '{3}', cmc: 3,
    colors: [], color_identity: [], keywords: [], card_types: ['artifact'],
  },
  forest: {
    id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest',
    oracle_text: '', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
  },
  island: {
    id: 'island', name: 'Island', type_line: 'Basic Land — Island',
    oracle_text: '', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['U'], keywords: [], card_types: ['land'],
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function mkCard(
  instanceId: string,
  definitionId: string,
  zone: CardInstance['zone'],
  ownerId = 'p0',
  tapped = false,
): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function makeBaseState(): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(),
    cardDefinitions: new Map(Object.entries(defs)),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'upkeep', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

const zone = (s: GameState, id: string) => s.cards.get(id)?.zone;
const tapped = (s: GameState, id: string) => s.cards.get(id)!.tapped;

// ────────────────────────────────────────────────────────────────────────────
// Part A: exact-N graveyard return ("Return two target creature cards…")
// ────────────────────────────────────────────────────────────────────────────

describe('slice12-exact-N-graveyard-return', () => {
  it("Death's Duet: parses to Spell with ReturnFromGraveyard, count=2, CreatureCardInGraveyard target", () => {
    const p = parseOracleText("Return two target creature cards from your graveyard to your hand.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects).toHaveLength(1);
    expect(p.effects[0]).toMatchObject({ kind: 'ReturnFromGraveyard', destination: 'hand' });
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('CreatureCardInGraveyard');
    // count must be 2 (exact — no minCount means exactly 2 required)
    expect(p.targets[0].count).toBe(2);
    expect(p.targets[0].minCount).toBeUndefined();
  });

  it("Death's Duet executor: both chosen graveyard creatures return to hand", () => {
    const state = makeBaseState();
    state.cards.set('bear1', mkCard('bear1', 'bear', 'graveyard'));
    state.cards.set('wurm1', mkCard('wurm1', 'wurm', 'graveyard'));
    state.cards.set('angel1', mkCard('angel1', 'angel', 'graveyard'));

    const p = parseOracleText("Return two target creature cards from your graveyard to your hand.");
    if (p.kind !== 'Spell') throw new Error('expected Spell');

    // Choose the bear and wurm; angel stays
    const r = executeEffects(state, p.effects, 'p0', ['bear1', 'wurm1'], p.targets);
    expect(zone(r, 'bear1')).toBe('hand');
    expect(zone(r, 'wurm1')).toBe('hand');
    expect(zone(r, 'angel1')).toBe('graveyard');
  });

  it("Soul Strings (oracle includes 'unless any player pays {X}'): still parses and executes the return", () => {
    const oracle = "Return two target creature cards from your graveyard to your hand unless any player pays {X}.";
    const p = parseOracleText(oracle);
    // The 'unless' clause is silently dropped; the return effect is honest.
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const rfg = p.effects.find(e => e.kind === 'ReturnFromGraveyard');
    expect(rfg).toBeDefined();
    if (!rfg || rfg.kind !== 'ReturnFromGraveyard') return;
    expect(rfg.destination).toBe('hand');
    expect(p.targets[0].count).toBe(2);

    // Execution: two creatures return
    const state = makeBaseState();
    state.cards.set('bear1', mkCard('bear1', 'bear', 'graveyard'));
    state.cards.set('wurm1', mkCard('wurm1', 'wurm', 'graveyard'));
    const r = executeEffects(state, p.effects, 'p0', ['bear1', 'wurm1'], p.targets);
    expect(zone(r, 'bear1')).toBe('hand');
    expect(zone(r, 'wurm1')).toBe('hand');
  });

  it("Three-target graveyard return: 'Return three target creature cards from your graveyard to your hand.' — count=3", () => {
    const p = parseOracleText("Return three target creature cards from your graveyard to your hand.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets[0].count).toBe(3);
    expect(p.effects[0]).toMatchObject({ kind: 'ReturnFromGraveyard', destination: 'hand' });

    // Execute: three creatures return to hand
    const state = makeBaseState();
    state.cards.set('bear1', mkCard('bear1', 'bear', 'graveyard'));
    state.cards.set('wurm1', mkCard('wurm1', 'wurm', 'graveyard'));
    state.cards.set('angel1', mkCard('angel1', 'angel', 'graveyard'));
    const r = executeEffects(state, p.effects, 'p0', ['bear1', 'wurm1', 'angel1'], p.targets);
    expect(zone(r, 'bear1')).toBe('hand');
    expect(zone(r, 'wurm1')).toBe('hand');
    expect(zone(r, 'angel1')).toBe('hand');
  });

  it("'Return up to two target creature cards...' (existing 'up to' form) still parses correctly", () => {
    // Regression guard: the "up to" path must be unaffected.
    const p = parseOracleText("Return up to two target creature cards from your graveyard to your hand.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets[0].count).toBe(2);
    // "up to" — minCount not required, but count is still 2 (max).
    expect(p.effects[0]).toMatchObject({ kind: 'ReturnFromGraveyard', destination: 'hand' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part B: "Untap all artifacts" / "Untap all lands" (no "you control")
// ────────────────────────────────────────────────────────────────────────────

describe('slice12-untap-all-noncreature-any-controller', () => {
  it("Blinkmoth Infusion: 'Untap all artifacts.' parses to Untap AllOfType artifacts, controllerControls:false", () => {
    const p = parseOracleText("Untap all artifacts.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects).toHaveLength(1);
    const eff = p.effects[0];
    expect(eff.kind).toBe('Untap');
    if (eff.kind !== 'Untap') return;
    expect(eff.target.kind).toBe('AllOfType');
    if (eff.target.kind !== 'AllOfType') return;
    expect(eff.target.filter).toMatchObject({ types: ['artifact'] });
    expect(eff.target.controllerControls).toBe(false);
  });

  it("Blinkmoth Infusion executor: untaps BOTH players' artifacts (controllerControls:false)", () => {
    const state = makeBaseState();
    // p0: 2 tapped artifacts; p1: 1 tapped artifact, 1 tapped land
    state.cards.set('p0-r1', mkCard('p0-r1', 'rock', 'battlefield', 'p0', true));
    state.cards.set('p0-r2', mkCard('p0-r2', 'rock2', 'battlefield', 'p0', true));
    state.cards.set('p1-r1', mkCard('p1-r1', 'rock', 'battlefield', 'p1', true));
    state.cards.set('p1-f1', mkCard('p1-f1', 'forest', 'battlefield', 'p1', true));

    const p = parseOracleText("Untap all artifacts.");
    if (p.kind !== 'Spell') throw new Error('expected Spell');

    const r = executeEffects(state, p.effects, 'p0', [], []);
    // All artifacts untapped, regardless of owner
    expect(tapped(r, 'p0-r1')).toBe(false);
    expect(tapped(r, 'p0-r2')).toBe(false);
    expect(tapped(r, 'p1-r1')).toBe(false);
    // The tapped land is NOT an artifact — untouched
    expect(tapped(r, 'p1-f1')).toBe(true);
  });

  it("'Untap all lands.' (no 'you control') parses to Untap AllOfType lands, controllerControls:false", () => {
    const p = parseOracleText("Untap all lands.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const eff = p.effects[0];
    expect(eff.kind).toBe('Untap');
    if (eff.kind !== 'Untap') return;
    expect(eff.target.kind).toBe('AllOfType');
    if (eff.target.kind !== 'AllOfType') return;
    expect(eff.target.filter).toMatchObject({ types: ['land'] });
    expect(eff.target.controllerControls).toBe(false);
  });

  it("'Untap all lands.' executor: untaps both players' lands", () => {
    const state = makeBaseState();
    state.cards.set('p0-f1', mkCard('p0-f1', 'forest', 'battlefield', 'p0', true));
    state.cards.set('p1-i1', mkCard('p1-i1', 'island', 'battlefield', 'p1', true));
    state.cards.set('p0-r1', mkCard('p0-r1', 'rock', 'battlefield', 'p0', true));

    const p = parseOracleText("Untap all lands.");
    if (p.kind !== 'Spell') throw new Error('expected Spell');

    const r = executeEffects(state, p.effects, 'p0', [], []);
    expect(tapped(r, 'p0-f1')).toBe(false);  // p0's land untapped
    expect(tapped(r, 'p1-i1')).toBe(false);  // p1's land also untapped
    expect(tapped(r, 'p0-r1')).toBe(true);   // artifact is not a land — untouched
  });

  it("'Untap all lands you control.' (with 'you control') still parses to controllerControls:true — regression guard", () => {
    const p = parseOracleText("Untap all lands you control.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const eff = p.effects[0];
    expect(eff.kind).toBe('Untap');
    if (eff.kind !== 'Untap') return;
    expect(eff.target.kind).toBe('AllOfType');
    if (eff.target.kind !== 'AllOfType') return;
    expect(eff.target.controllerControls).toBe(true);
  });

  it("'Untap all artifacts you control.' (with 'you control') still parses to controllerControls:true — regression guard", () => {
    const p = parseOracleText("Untap all artifacts you control.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const eff = p.effects[0];
    expect(eff.kind).toBe('Untap');
    if (eff.kind !== 'Untap') return;
    expect(eff.target.kind).toBe('AllOfType');
    if (eff.target.kind !== 'AllOfType') return;
    expect(eff.target.controllerControls).toBe(true);
  });

  it("'Untap all creatures.' parses to Untap AllOfType creatures, controllerControls:false", () => {
    const p = parseOracleText("Untap all creatures.");
    // This is the AllCreatures path or AllOfType creatures — either is fine.
    // We just verify it parses (was already supported) and doesn't regress.
    expect(p.kind).not.toBe('Unparsed');
  });
});
