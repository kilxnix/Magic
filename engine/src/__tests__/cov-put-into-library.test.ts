import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { validateTargetChoices } from '../effects/targets';

/**
 * Coverage slice 3/12: "put target X on top/bottom of its owner's library"
 * (Time Ebb family).
 *
 * Matcher: matchPutIntoLibrary in src/effects/matchers/zones.ts
 * Effect:  PutIntoLibrary { position: 'top' | 'bottom' }
 * Executor: existing case 'PutIntoLibrary' (~line 3840 executor.ts).
 *
 * Real oracle wordings exercised:
 *   - Time Ebb: "Put target creature on top of its owner's library."
 *   - Grasp of Phantoms: "Put target creature on top of its owner's library."
 *     (Flashback line absorbed by per-line path)
 *   - Fallow Earth: "Put target land on top of its owner's library."
 *   - Temporal Spring: "Put target permanent on top of its owner's library."
 *   - Deprive: ETB trigger tail "put it on top of its owner's library"
 *   - Temporal Eddy: "Put target creature or planeswalker on top of its owner's library."
 *   - Bottom variants: "Put target creature on the bottom of its owner's library."
 */

// ── card definitions ─────────────────────────────────────────────────────────

const defs: Record<string, CardDefinition> = {
  bear: {
    id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear',
    oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
    colors: ['G'], color_identity: ['G'], keywords: [],
    card_types: ['creature'], power: 2, toughness: 2,
  },
  plains: {
    id: 'plains', name: 'Plains', type_line: 'Basic Land — Plains',
    oracle_text: '', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['W'], keywords: [],
    card_types: ['land'],
  },
  relic: {
    id: 'relic', name: 'Mind Stone', type_line: 'Artifact',
    oracle_text: '', mana_cost: '{2}', cmc: 2,
    colors: [], color_identity: [], keywords: [],
    card_types: ['artifact'],
  },
  walker: {
    id: 'walker', name: 'Jace, the Mind Sculptor', type_line: 'Legendary Planeswalker — Jace',
    oracle_text: '', mana_cost: '{2}{U}{U}', cmc: 4,
    colors: ['U'], color_identity: ['U'], keywords: [],
    card_types: ['planeswalker'],
  },
};

// ── state factory ─────────────────────────────────────────────────────────────

/** Returns a state with bear1 / plains1 / relic1 / walker1 on the battlefield. */
function bfState(): GameState {
  const mk = (id: string, defId: string, owner = 'p0'): CardInstance => ({
    instanceId: id,
    definitionId: defId,
    ownerId: owner,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([
      ['bear1',   mk('bear1',   'bear')],
      ['plains1', mk('plains1', 'plains')],
      ['relic1',  mk('relic1',  'relic')],
      ['walker1', mk('walker1', 'walker')],
    ]),
    cardDefinitions: new Map(Object.entries(defs)),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 3,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

const zone = (s: GameState, id: string) => s.cards.get(id)?.zone;

// ── parse-only helpers ────────────────────────────────────────────────────────

describe('cov-put-into-library — parse shape', () => {

  it('Time Ebb: "Put target creature on top of its owner\'s library." parses to PutIntoLibrary top Creature', () => {
    const p = parseOracleText("Put target creature on top of its owner's library.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects).toHaveLength(1);
    expect(p.effects[0]).toMatchObject({ kind: 'PutIntoLibrary', position: 'top' });
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Creature');
  });

  it('Fallow Earth: "Put target land on top of its owner\'s library." parses to PutIntoLibrary top Land', () => {
    const p = parseOracleText("Put target land on top of its owner's library.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects[0]).toMatchObject({ kind: 'PutIntoLibrary', position: 'top' });
    expect(p.targets[0].type).toBe('Land');
  });

  it('Temporal Spring: "Put target permanent on top of its owner\'s library." → Permanent', () => {
    const p = parseOracleText("Put target permanent on top of its owner's library.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects[0]).toMatchObject({ kind: 'PutIntoLibrary', position: 'top' });
    expect(p.targets[0].type).toBe('Permanent');
  });

  it('Bottom variant: "Put target creature on the bottom of its owner\'s library." → position bottom', () => {
    const p = parseOracleText("Put target creature on the bottom of its owner's library.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects[0]).toMatchObject({ kind: 'PutIntoLibrary', position: 'bottom' });
    expect(p.targets[0].type).toBe('Creature');
  });

  it('Temporal Eddy variant: "Put target creature or planeswalker on top of its owner\'s library." → CreatureOrPlaneswalker', () => {
    const p = parseOracleText("Put target creature or planeswalker on top of its owner's library.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects[0]).toMatchObject({ kind: 'PutIntoLibrary', position: 'top' });
    expect(p.targets[0].type).toBe('CreatureOrPlaneswalker');
  });

  it('Artifact target: "Put target artifact on top of its owner\'s library." → Artifact', () => {
    const p = parseOracleText("Put target artifact on top of its owner's library.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects[0]).toMatchObject({ kind: 'PutIntoLibrary', position: 'top' });
    expect(p.targets[0].type).toBe('Artifact');
  });

  it('Grasp of Phantoms (Flashback absorbed): "Put target creature on top of its owner\'s library. / Flashback {7}{U}" parses as Spell', () => {
    const p = parseOracleText("Put target creature on top of its owner's library.\nFlashback {7}{U}");
    // The flashback keyword line is absorbed; the spell still parses.
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects[0]).toMatchObject({ kind: 'PutIntoLibrary', position: 'top' });
    expect(p.targets[0].type).toBe('Creature');
    // Flashback keyword recorded in absorbedKeywords or we don't care — just not Unparsed.
  });

  it('"Put it on top of its owner\'s library" trigger tail parses as Source self-effect (no target)', () => {
    // This form appears as trigger tail (e.g. Sunken Hope, Deprive).
    // Parsed standalone it is a Spell with Source target.
    const p = parseOracleText("Put it on top of its owner's library.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects[0]).toMatchObject({ kind: 'PutIntoLibrary', position: 'top', target: { kind: 'Source' } });
    expect(p.targets).toHaveLength(0);
  });

  it('ETB trigger: "When this creature enters, put target creature on top of its owner\'s library." parses as ETB', () => {
    const p = parseOracleText("When this creature enters, put target creature on top of its owner's library.");
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    expect(p.ability.effects[0]).toMatchObject({ kind: 'PutIntoLibrary', position: 'top' });
    expect(p.targets[0].type).toBe('Creature');
  });

});

// ── execution tests ───────────────────────────────────────────────────────────

describe('cov-put-into-library — execution', () => {

  it('Time Ebb: puts targeted creature from battlefield to top of owner\'s library', () => {
    const p = parseOracleText("Put target creature on top of its owner's library.");
    if (p.kind !== 'Spell') throw new Error('expected Spell');

    const state = bfState();
    // Validate legality: bear1 is a creature — should be valid.
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['bear1'])).not.toThrow();
    // plains1 is a land — should be invalid for Creature target.
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['plains1'])).toThrow();

    const result = executeEffects(state, p.effects, 'p0', ['bear1'], p.targets);
    expect(zone(result, 'bear1')).toBe('library');
    // Other cards untouched.
    expect(zone(result, 'plains1')).toBe('battlefield');
    expect(zone(result, 'relic1')).toBe('battlefield');
  });

  it('Fallow Earth: puts targeted land from battlefield to top of library', () => {
    const p = parseOracleText("Put target land on top of its owner's library.");
    if (p.kind !== 'Spell') throw new Error('expected Spell');

    const state = bfState();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['plains1'])).not.toThrow();
    // bear1 is a creature — invalid for Land target.
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['bear1'])).toThrow();

    const result = executeEffects(state, p.effects, 'p0', ['plains1'], p.targets);
    expect(zone(result, 'plains1')).toBe('library');
    expect(zone(result, 'bear1')).toBe('battlefield');
  });

  it('Bottom variant: puts targeted creature to the bottom of its library', () => {
    const p = parseOracleText("Put target creature on the bottom of its owner's library.");
    if (p.kind !== 'Spell') throw new Error('expected Spell');

    const state = bfState();
    const result = executeEffects(state, p.effects, 'p0', ['bear1'], p.targets);
    expect(zone(result, 'bear1')).toBe('library');
    // The executor's PutIntoLibrary bottom path places it last — just verify it's in library.
    expect(zone(result, 'plains1')).toBe('battlefield');
  });

  it('Temporal Spring / permanent target: can bounce any permanent type', () => {
    const p = parseOracleText("Put target permanent on top of its owner's library.");
    if (p.kind !== 'Spell') throw new Error('expected Spell');

    const state = bfState();
    // Creature is a valid permanent target.
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['bear1'])).not.toThrow();
    // Artifact is also valid.
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['relic1'])).not.toThrow();

    const r1 = executeEffects(state, p.effects, 'p0', ['bear1'], p.targets);
    expect(zone(r1, 'bear1')).toBe('library');

    const r2 = executeEffects(state, p.effects, 'p0', ['relic1'], p.targets);
    expect(zone(r2, 'relic1')).toBe('library');
  });

  it('Creature-or-planeswalker target: both creature and planeswalker are valid targets', () => {
    const p = parseOracleText("Put target creature or planeswalker on top of its owner's library.");
    if (p.kind !== 'Spell') throw new Error('expected Spell');

    const state = bfState();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['bear1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['walker1'])).not.toThrow();
    // Plain land is invalid.
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['plains1'])).toThrow();

    const r = executeEffects(state, p.effects, 'p0', ['walker1'], p.targets);
    expect(zone(r, 'walker1')).toBe('library');
    expect(zone(r, 'bear1')).toBe('battlefield');
  });

});
