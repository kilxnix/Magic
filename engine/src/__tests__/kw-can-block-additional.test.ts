/**
 * Slice 8: "Can block an additional creature" — parser and combat tests.
 *
 * Covers:
 *  1. Parser recognition of the static form ("each combat")
 *  2. Parser recognition of the activated form ("this turn")
 *  3. Static form: creature CAN block two attackers simultaneously
 *  4. Normal creature CANNOT block two attackers simultaneously (default CR 509.1b)
 *  5. Activated-ability grant: runtime 'CanBlockAdditional' allows the extra block
 *  6. Real oracle text from the examples (Selesnya Sagittars, Two-Headed Giant,
 *     Mounted Archers, Vigilant Sentry)
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { declareAttackers, declareBlockers } from '../combat';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function creatureDef(
  id: string,
  oracle: string,
  keywords: string[] = [],
  power = 2,
  toughness = 2,
): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Test',
    oracle_text: oracle,
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords,
    card_types: ['creature'],
    power,
    toughness,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  over: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...over,
  };
}

/**
 * Build a minimal GameState:
 *  - p1 controls two attackers (atk1, atk2) using definitions atk1Def / atk2Def
 *  - p2 controls one blocker (blk) using definition blkDef
 */
function twoAttackerState(
  atk1Def: CardDefinition,
  atk2Def: CardDefinition,
  blkDef: CardDefinition,
): { state: GameState; atk1Id: string; atk2Id: string; blkId: string } {
  const defs = new Map<string, CardDefinition>([
    [atk1Def.id, atk1Def],
    [atk2Def.id, atk2Def],
    [blkDef.id, blkDef],
  ]);
  const cards = new Map<string, CardInstance>([
    ['atk1', makeCard('atk1', atk1Def.id, 'p1')],
    ['atk2', makeCard('atk2', atk2Def.id, 'p1')],
    ['blk',  makeCard('blk',  blkDef.id,  'p2')],
  ]);
  const state: GameState = {
    players: [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob')],
    cards,
    cardDefinitions: defs,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'combat',
    step: 'declare_attackers',
    turnNumber: 3,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    playersWhoAttackedThisTurn: [],
  };
  return { state, atk1Id: 'atk1', atk2Id: 'atk2', blkId: 'blk' };
}

// ---------------------------------------------------------------------------
// Section 1: Parser recognition — static form
// ---------------------------------------------------------------------------

describe('matchCanBlockAdditionalStatic — parser recognition', () => {
  it('parses "This creature can block an additional creature each combat." as StaticAbility', () => {
    const parsed = parseOracleText(
      'This creature can block an additional creature each combat.',
    );
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.selfOnly).toBe(true);
    expect(parsed.ability.modifier).toEqual({
      kind: 'GrantKeyword',
      keyword: 'CanBlockAdditional',
    });
  });

  it('parses Selesnya Sagittars oracle text (multi-line with Reach)', () => {
    // Real oracle text: "Reach\nThis creature can block an additional creature each combat."
    const parsed = parseOracleText(
      'Reach\nThis creature can block an additional creature each combat.',
    );
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.selfOnly).toBe(true);
    expect(parsed.ability.modifier.kind).toBe('GrantKeyword');
    if (parsed.ability.modifier.kind === 'GrantKeyword') {
      expect(parsed.ability.modifier.keyword).toBe('CanBlockAdditional');
    }
  });

  it('parses Two-Headed Giant of Foriys oracle text (Trample + can block additional)', () => {
    // Two-Headed Giant: "Trample\nThis creature can block an additional creature each combat."
    const parsed = parseOracleText(
      'Trample\nThis creature can block an additional creature each combat.',
    );
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('GrantKeyword');
    if (parsed.ability.modifier.kind === 'GrantKeyword') {
      expect(parsed.ability.modifier.keyword).toBe('CanBlockAdditional');
    }
  });

  it('does NOT parse faces with unrun additional abilities as StaticAbility', () => {
    // Oracle with an unrecognized triggered ability alongside — stays Unparsed
    const parsed = parseOracleText(
      'This creature can block an additional creature each combat.\nWhenever this creature blocks, do something unparseable.',
    );
    // It may parse the triggered part, but must NOT claim the whole face as a
    // pure CanBlockAdditional static while masking an unrun ability.
    // Either Unparsed or Triggered (the trigger, if parsed, wins)
    expect(['Unparsed', 'Triggered']).toContain(parsed.kind);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Parser recognition — activated form
// ---------------------------------------------------------------------------

describe('matchCanBlockAdditionalActivated — parser recognition', () => {
  it('parses "this creature can block an additional creature this turn." as GrantKeyword', () => {
    // This is the EFFECT clause of an activated ability (cost is stripped by
    // parseActivatedAbilities). We test the clause parser directly.
    const parsed = parseOracleText(
      '{2}: This creature can block an additional creature this turn.',
    );
    // Should parse as an Activated ability containing a GrantKeyword effect
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    expect(parsed.abilities.length).toBeGreaterThanOrEqual(1);
    const ab = parsed.abilities[0];
    expect(ab.effects.length).toBeGreaterThanOrEqual(1);
    const ef = ab.effects[0];
    expect(ef.kind).toBe('GrantKeyword');
    if (ef.kind === 'GrantKeyword') {
      expect(ef.keyword).toBe('CanBlockAdditional');
      expect(ef.untilEndOfTurn).toBe(true);
      expect(ef.target).toEqual({ kind: 'Source' });
    }
  });

  it('parses Vigilant Sentry / Mounted Archers style "{M}: ~ can block an additional creature this turn"', () => {
    // "~" variant — same effect
    const parsed = parseOracleText(
      '{3}: ~ can block an additional creature this turn.',
    );
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    const ef = parsed.abilities[0]?.effects[0];
    expect(ef?.kind).toBe('GrantKeyword');
    if (ef?.kind === 'GrantKeyword') {
      expect(ef.keyword).toBe('CanBlockAdditional');
    }
  });
});

// ---------------------------------------------------------------------------
// Section 3: Static form combat enforcement
// ---------------------------------------------------------------------------

describe('CanBlockAdditional static — combat enforcement', () => {
  it('a creature WITHOUT the ability CANNOT block two attackers simultaneously', () => {
    const vanilla = creatureDef('vanilla', '');
    const atk1 = creatureDef('a1', '');
    const atk2 = creatureDef('a2', '');
    const { state, atk1Id, atk2Id, blkId } = twoAttackerState(atk1, atk2, vanilla);

    const afterAttack = declareAttackers(state, 'p1', [
      { cardInstanceId: atk1Id, defendingPlayerId: 'p2' },
      { cardInstanceId: atk2Id, defendingPlayerId: 'p2' },
    ]);

    expect(() =>
      declareBlockers(afterAttack, 'p2', [
        { cardInstanceId: blkId, blockingAttackerId: atk1Id },
        { cardInstanceId: blkId, blockingAttackerId: atk2Id },
      ]),
    ).toThrow(/cannot block more than 1 attacker/i);
  });

  it('a creature WITH "can block an additional creature each combat" CAN block two attackers', () => {
    const sagittars = creatureDef(
      'sagittars',
      'Reach\nThis creature can block an additional creature each combat.',
    );
    const atk1 = creatureDef('a1', '');
    const atk2 = creatureDef('a2', '');
    const { state, atk1Id, atk2Id, blkId } = twoAttackerState(atk1, atk2, sagittars);

    const afterAttack = declareAttackers(state, 'p1', [
      { cardInstanceId: atk1Id, defendingPlayerId: 'p2' },
      { cardInstanceId: atk2Id, defendingPlayerId: 'p2' },
    ]);

    // Should NOT throw
    const afterBlocks = declareBlockers(afterAttack, 'p2', [
      { cardInstanceId: blkId, blockingAttackerId: atk1Id },
      { cardInstanceId: blkId, blockingAttackerId: atk2Id },
    ]);
    expect(afterBlocks.combat!.blockers).toHaveLength(2);
  });

  it('Two-Headed Giant of Foriys oracle text is honored in combat', () => {
    const twoHead = creatureDef(
      'twohead',
      'Trample\nThis creature can block an additional creature each combat.',
      [],
      4,
      4,
    );
    const atk1 = creatureDef('a1', '');
    const atk2 = creatureDef('a2', '');
    const { state, atk1Id, atk2Id, blkId } = twoAttackerState(atk1, atk2, twoHead);

    const afterAttack = declareAttackers(state, 'p1', [
      { cardInstanceId: atk1Id, defendingPlayerId: 'p2' },
      { cardInstanceId: atk2Id, defendingPlayerId: 'p2' },
    ]);

    // Two-Headed Giant can block both
    expect(() =>
      declareBlockers(afterAttack, 'p2', [
        { cardInstanceId: blkId, blockingAttackerId: atk1Id },
        { cardInstanceId: blkId, blockingAttackerId: atk2Id },
      ]),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Section 4: Activated form — execution and combat enforcement
// ---------------------------------------------------------------------------

describe('CanBlockAdditional activated — execution and combat enforcement', () => {
  it('executing the GrantKeyword/Source effect stores CanBlockAdditional in grantedKeywords', () => {
    const activatedDef = creatureDef(
      'mounted',
      '{2}: This creature can block an additional creature this turn.',
    );
    const parsed = parseOracleText(activatedDef.oracle_text);
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;

    const defs = new Map<string, CardDefinition>([[activatedDef.id, activatedDef]]);
    const cards = new Map<string, CardInstance>([
      ['src', makeCard('src', activatedDef.id, 'p1')],
    ]);
    let state: GameState = {
      players: [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob')],
      cards,
      cardDefinitions: defs,
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'combat',
      step: 'declare_blockers',
      turnNumber: 3,
      hasPriorityPassed: [false, false],
      stack: [],
      combat: null,
      battlefieldAbilities: new Map(),
      pendingTriggers: [],
      playersWhoAttackedThisTurn: [],
    };

    // Execute the first ability's effects (targeting source)
    const ab = parsed.abilities[0];
    state = executeEffects(state, ab.effects, 'p1', [], [], 0, { sourceInstanceId: 'src' });

    const card = state.cards.get('src')!;
    expect(card.grantedKeywords).toContain('CanBlockAdditional');
  });

  it('grantedKeywords CanBlockAdditional enables blocking two attackers this turn', () => {
    const vanilla = creatureDef('vanilla', '');
    const atk1 = creatureDef('a1', '');
    const atk2 = creatureDef('a2', '');
    const { state: baseState, atk1Id, atk2Id, blkId } = twoAttackerState(atk1, atk2, vanilla);

    // Manually grant the keyword (simulating the activated ability execution)
    const newCards = new Map(baseState.cards);
    const blkCard = newCards.get(blkId)!;
    newCards.set(blkId, { ...blkCard, grantedKeywords: ['CanBlockAdditional'] });
    const state = { ...baseState, cards: newCards };

    const afterAttack = declareAttackers(state, 'p1', [
      { cardInstanceId: atk1Id, defendingPlayerId: 'p2' },
      { cardInstanceId: atk2Id, defendingPlayerId: 'p2' },
    ]);

    // With the keyword granted, the creature can now block both
    expect(() =>
      declareBlockers(afterAttack, 'p2', [
        { cardInstanceId: blkId, blockingAttackerId: atk1Id },
        { cardInstanceId: blkId, blockingAttackerId: atk2Id },
      ]),
    ).not.toThrow();
  });
});
