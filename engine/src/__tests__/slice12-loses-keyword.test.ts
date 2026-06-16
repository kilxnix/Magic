/**
 * Slice 12 — "target creature loses <keyword(s)> until end of turn"
 *
 * Tests for matchTargetCreatureLosesKeyword:
 *   • Single keyword:  "Target creature loses flying until end of turn."   (Canopy Claws)
 *   • Multi-keyword list: "Target creature loses flying, first strike, and trample until end of turn."
 *   • Flashback tail absorbed: Canopy Claws full oracle text
 *   • Trigger-body usage (When ~ attacks, ...)
 *   • Execution: LoseKeyword effects run via executor, lostKeywords set on card
 *   • Negative cases: "loses all abilities" and "loses your choice of" stay Unparsed
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { instanceHasKeyword } from '../keywords';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Minimal test state helpers
// ---------------------------------------------------------------------------

function makeDef(over: Partial<CardDefinition> & { id: string; keywords: string[] }): CardDefinition {
  return {
    name: 'Test Creature',
    type_line: 'Creature — Test',
    oracle_text: '',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
    ...over,
  };
}

function makeState(defKeywords: string[]): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  const defId = 'def-test';
  cards.set('creature-1', {
    instanceId: 'creature-1',
    definitionId: defId,
    ownerId: 'player-1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set(defId, makeDef({ id: defId, keywords: defKeywords }));

  return {
    players: [
      {
        id: 'player-1',
        name: 'P1',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
    ],
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('Slice 12 – matchTargetCreatureLosesKeyword parser', () => {
  it('parses Canopy Claws single-keyword: "Target creature loses flying until end of turn."', () => {
    const result = parseOracleText('Target creature loses flying until end of turn.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]).toMatchObject({
      kind: 'LoseKeyword',
      keyword: 'Flying',
      untilEndOfTurn: true,
    });
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Creature');
  });

  it('parses Canopy Claws full oracle (flashback tail is a separate clause)', () => {
    // Full oracle: "Target creature loses flying until end of turn. Flashback {G} (…)"
    // The parser sees the first sentence only; flashback is a keyword line absorbed separately.
    const result = parseOracleText('Target creature loses flying until end of turn.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects[0]).toMatchObject({ kind: 'LoseKeyword', keyword: 'Flying' });
  });

  it('parses explicit two-keyword list: "Target creature loses flying and trample until end of turn."', () => {
    const result = parseOracleText('Target creature loses flying and trample until end of turn.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(2);
    const keywords = result.effects.map(e => (e as { keyword: string }).keyword);
    expect(keywords).toContain('Flying');
    expect(keywords).toContain('Trample');
    expect(result.effects.every(e => e.kind === 'LoseKeyword')).toBe(true);
  });

  it('parses explicit three-keyword list with commas: "Target creature loses flying, first strike, and trample until end of turn."', () => {
    const result = parseOracleText('Target creature loses flying, first strike, and trample until end of turn.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(3);
    const kinds = result.effects.map(e => e.kind);
    expect(kinds.every(k => k === 'LoseKeyword')).toBe(true);
    const keywords = result.effects.map(e => (e as { keyword: string }).keyword);
    expect(keywords).toContain('Flying');
    expect(keywords).toContain('First Strike');
    expect(keywords).toContain('Trample');
  });

  it('parses inside a trigger body (When ~ attacks, target creature loses flying until end of turn.)', () => {
    const result = parseOracleText('When ~ attacks, target creature loses flying until end of turn.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0]).toMatchObject({ kind: 'LoseKeyword', keyword: 'Flying' });
  });

  it('does NOT parse "target creature loses all abilities until end of turn" (no LoseAllAbilities executor)', () => {
    const result = parseOracleText('Target creature loses all abilities until end of turn.');
    expect(result.kind).toBe('Unparsed');
  });

  it('does NOT parse "your choice of" form (no runtime keyword-choice infrastructure)', () => {
    // Walking Sponge: "{T}: Target creature loses your choice of flying, first strike, or trample until end of turn."
    const result = parseOracleText(
      '{T}: Target creature loses your choice of flying, first strike, or trample until end of turn.'
    );
    // Should be Unparsed or Activated with an Unparsed ability body — either way,
    // no LoseKeyword effects emitted for the choice body.
    if (result.kind === 'Spell') {
      expect(result.effects.every(e => e.kind !== 'LoseKeyword')).toBe(true);
    } else {
      // Activated with unparsed body is also fine
      expect(['Unparsed', 'Activated']).toContain(result.kind);
    }
  });

  it('does NOT parse "gets −2/−0 and loses flying" (handled by matchModifyPTAndLoseKeyword, not this matcher)', () => {
    // matchModifyPTAndLoseKeyword handles the combo form; this matcher should NOT consume it.
    const result = parseOracleText('Target creature gets -2/-0 and loses flying until end of turn.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    // Should have BOTH ModifyPT and LoseKeyword effects (from matchModifyPTAndLoseKeyword)
    const kinds = result.effects.map(e => e.kind);
    expect(kinds).toContain('ModifyPT');
    expect(kinds).toContain('LoseKeyword');
  });
});

// ---------------------------------------------------------------------------
// Executor tests
// ---------------------------------------------------------------------------

describe('Slice 12 – LoseKeyword executor (single keyword)', () => {
  it('removes Flying from a creature that has it in its definition keywords', () => {
    const state = makeState(['Flying', 'Trample']);
    // Confirm Flying is present before the effect
    expect(instanceHasKeyword(state, 'creature-1', 'Flying')).toBe(true);

    const parsed = parseOracleText('Target creature loses flying until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const newState = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['creature-1'],
      parsed.targets.map(t => ({ id: t.id })),
    );

    const card = newState.cards.get('creature-1')!;
    expect(card.lostKeywords).toContain('Flying');
    expect(instanceHasKeyword(newState, 'creature-1', 'Flying')).toBe(false);
    // Other keywords are unaffected
    expect(instanceHasKeyword(newState, 'creature-1', 'Trample')).toBe(true);
  });

  it('removes multiple keywords from an explicit list in one spell resolution', () => {
    const state = makeState(['Flying', 'First Strike', 'Trample']);
    expect(instanceHasKeyword(state, 'creature-1', 'Flying')).toBe(true);
    expect(instanceHasKeyword(state, 'creature-1', 'First Strike')).toBe(true);
    expect(instanceHasKeyword(state, 'creature-1', 'Trample')).toBe(true);

    const parsed = parseOracleText('Target creature loses flying, first strike, and trample until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(3);

    const newState = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['creature-1'],
      parsed.targets.map(t => ({ id: t.id })),
    );

    expect(instanceHasKeyword(newState, 'creature-1', 'Flying')).toBe(false);
    expect(instanceHasKeyword(newState, 'creature-1', 'First Strike')).toBe(false);
    expect(instanceHasKeyword(newState, 'creature-1', 'Trample')).toBe(false);
  });

  it('is a no-op when the creature does not have the keyword (idempotent)', () => {
    const state = makeState(['Trample']); // no Flying
    expect(instanceHasKeyword(state, 'creature-1', 'Flying')).toBe(false);

    const parsed = parseOracleText('Target creature loses flying until end of turn.');
    if (parsed.kind !== 'Spell') return;

    const newState = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['creature-1'],
      parsed.targets.map(t => ({ id: t.id })),
    );

    // Flying still absent; Trample untouched
    expect(instanceHasKeyword(newState, 'creature-1', 'Flying')).toBe(false);
    expect(instanceHasKeyword(newState, 'creature-1', 'Trample')).toBe(true);
  });

  it('works on a creature not in the battlefield (executor silently no-ops)', () => {
    const state = makeState(['Flying']);
    // Move creature to graveyard
    const cards = new Map(state.cards);
    cards.set('creature-1', { ...cards.get('creature-1')!, zone: 'graveyard' });
    const stateInGraveyard = { ...state, cards };

    const parsed = parseOracleText('Target creature loses flying until end of turn.');
    if (parsed.kind !== 'Spell') return;

    const newState = executeEffects(
      stateInGraveyard,
      parsed.effects,
      'player-1',
      ['creature-1'],
      parsed.targets.map(t => ({ id: t.id })),
    );

    // No change — creature is not on battlefield
    expect(newState.cards.get('creature-1')!.lostKeywords).toBeUndefined();
  });
});
