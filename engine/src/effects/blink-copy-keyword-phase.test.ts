// Phase 16: Tests for blink/flicker, copy effects, keyword granting, and phasing

import { describe, it, expect } from 'vitest';
import { parseOracleText } from './parser';
import { executeEffects } from './executor';
import { canAttackThisTurn, canBlock, instanceHasKeyword } from '../keywords';
import type { Effect } from './ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

/**
 * Create a minimal test GameState with one creature on the battlefield.
 */
function createTestState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  // A creature on the battlefield (player-1 owns)
  cards.set('creature-1', {
    instanceId: 'creature-1',
    definitionId: 'def-creature',
    ownerId: 'player-1',
    zone: 'battlefield',
    tapped: true,
    summoningSick: false,
    counters: { '+1/+1': 2 },
    damage: 1,
    isCommander: false,
  });

  cardDefinitions.set('def-creature', {
    id: 'def-creature',
    name: 'Test Creature',
    type_line: 'Creature — Human Soldier',
    oracle_text: '',
    mana_cost: '{2}{W}',
    cmc: 3,
    colors: ['W'],
    color_identity: ['W'],
    keywords: ['Flying'],
    power: 3,
    toughness: 3,
    card_types: ['creature'],
  });

  // A second creature (player-2 owns)
  cards.set('creature-2', {
    instanceId: 'creature-2',
    definitionId: 'def-creature-2',
    ownerId: 'player-2',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-creature-2', {
    id: 'def-creature-2',
    name: 'Enemy Creature',
    type_line: 'Creature — Goblin',
    oracle_text: '',
    mana_cost: '{1}{R}',
    cmc: 2,
    colors: ['R'],
    color_identity: ['R'],
    keywords: ['Haste'],
    power: 2,
    toughness: 1,
    card_types: ['creature'],
  });

  // A permanent (artifact) on the battlefield
  cards.set('artifact-1', {
    instanceId: 'artifact-1',
    definitionId: 'def-artifact',
    ownerId: 'player-1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-artifact', {
    id: 'def-artifact',
    name: 'Test Artifact',
    type_line: 'Artifact',
    oracle_text: '',
    mana_cost: '{3}',
    cmc: 3,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact'],
  });

  // Library cards
  for (let i = 1; i <= 5; i++) {
    cards.set(`lib-card-${i}`, {
      instanceId: `lib-card-${i}`,
      definitionId: 'def-generic',
      ownerId: 'player-1',
      zone: 'library',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
  }

  cardDefinitions.set('def-generic', {
    id: 'def-generic',
    name: 'Generic Card',
    type_line: 'Instant',
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['instant'],
  });

  return {
    players: [
      {
        id: 'player-1',
        name: 'Player 1',
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
      {
        id: 'player-2',
        name: 'Player 2',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: false,
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
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ============================================================================
// TASK 1: Blink/Flicker
// ============================================================================

describe('Blink/Flicker', () => {
  describe('Parser', () => {
    it('parses "Exile target creature, then return it to the battlefield under its owner\'s control."', () => {
      const result = parseOracleText(
        "Exile target creature, then return it to the battlefield under its owner's control."
      );
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Blink');
      if (result.effects[0].kind !== 'Blink') return;
      expect(result.effects[0].ownerControl).toBe(true);
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Creature');
    });

    it('parses "Exile target creature you control, then return it to the battlefield."', () => {
      const result = parseOracleText(
        'Exile target creature you control, then return it to the battlefield.'
      );
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Blink');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Creature');
    });

    it('parses delayed blink "Exile target permanent, return it to the battlefield at the beginning of the next end step."', () => {
      const result = parseOracleText(
        'Exile target permanent, return it to the battlefield at the beginning of the next end step.'
      );
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Blink');
      if (result.effects[0].kind !== 'Blink') return;
      expect(result.effects[0].delayed).toBe(true);
      expect(result.targets[0].type).toBe('Permanent');
    });
  });

  describe('Executor', () => {
    it('blinks a creature: resets tapped, damage, counters, and summoning sickness', () => {
      const state = createTestState();
      const creature = state.cards.get('creature-1')!;
      // Pre-conditions: tapped, has damage, has counters
      expect(creature.tapped).toBe(true);
      expect(creature.damage).toBe(1);
      expect(creature.counters['+1/+1']).toBe(2);

      const effects: Effect[] = [
        { kind: 'Blink', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(state, effects, 'player-1', ['creature-1'], [{ id: 'target_1' }]);

      const blinked = newState.cards.get('creature-1')!;
      expect(blinked.zone).toBe('battlefield');
      expect(blinked.tapped).toBe(false);
      expect(blinked.damage).toBe(0);
      expect(blinked.counters).toEqual({});
      expect(blinked.summoningSick).toBe(true);
    });

    it('blink clears granted keywords', () => {
      const state = createTestState();
      // Grant a keyword first
      const cards = new Map(state.cards);
      const creature = cards.get('creature-1')!;
      cards.set('creature-1', { ...creature, grantedKeywords: ['Hexproof'] });
      const stateWithKeyword = { ...state, cards };

      const effects: Effect[] = [
        { kind: 'Blink', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(stateWithKeyword, effects, 'player-1', ['creature-1'], [{ id: 'target_1' }]);
      const blinked = newState.cards.get('creature-1')!;
      expect(blinked.grantedKeywords).toBeUndefined();
    });

    it('blink applies battlefield entry replacement text on return', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      const cardDefinitions = new Map(state.cardDefinitions);
      cardDefinitions.set('def-tapped-entry', {
        id: 'def-tapped-entry',
        name: 'Tapped Entry Beast',
        type_line: 'Creature - Beast',
        oracle_text: 'This creature enters tapped.',
        mana_cost: '{2}{G}',
        cmc: 3,
        colors: ['G'],
        color_identity: ['G'],
        keywords: [],
        power: 3,
        toughness: 3,
        card_types: ['creature'],
      });
      cards.set('tapped-entry', {
        instanceId: 'tapped-entry',
        definitionId: 'def-tapped-entry',
        ownerId: 'player-1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: { '+1/+1': 1 },
        damage: 2,
        isCommander: false,
      });
      const modifiedState = { ...state, cards, cardDefinitions };
      const effects: Effect[] = [
        { kind: 'Blink', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(modifiedState, effects, 'player-1', ['tapped-entry'], [{ id: 'target_1' }]);
      const blinked = newState.cards.get('tapped-entry')!;
      expect(blinked.zone).toBe('battlefield');
      expect(blinked.tapped).toBe(true);
      expect(blinked.counters).toEqual({});
      expect(blinked.damage).toBe(0);
    });

    it('blink does nothing if target is not on battlefield', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      const creature = cards.get('creature-1')!;
      cards.set('creature-1', { ...creature, zone: 'graveyard' });
      const stateWithGraveyard = { ...state, cards };

      const effects: Effect[] = [
        { kind: 'Blink', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(stateWithGraveyard, effects, 'player-1', ['creature-1'], [{ id: 'target_1' }]);
      expect(newState.cards.get('creature-1')!.zone).toBe('graveyard');
    });
  });
});

// ============================================================================
// TASK 2: Copy Effects
// ============================================================================

describe('Copy Effects', () => {
  describe('Parser', () => {
    it('parses "Create a token that\'s a copy of target creature."', () => {
      const result = parseOracleText("Create a token that's a copy of target creature.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Copy');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Creature');
    });

    it('parses "Create a copy of target creature."', () => {
      const result = parseOracleText('Create a copy of target creature.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Copy');
    });

    it('parses "Create a token that is a copy of target creature."', () => {
      const result = parseOracleText('Create a token that is a copy of target creature.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Copy');
    });
  });

  describe('Executor', () => {
    it('creates a token copy on the battlefield with same definition', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'Copy', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(state, effects, 'player-1', ['creature-2'], [{ id: 'target_1' }]);

      // Find the copy (new card instance)
      let copyFound = false;
      for (const [id, card] of newState.cards) {
        if (id.startsWith('copy_') && card.definitionId === 'def-creature-2') {
          copyFound = true;
          expect(card.ownerId).toBe('player-1'); // controller creates the copy
          expect(card.zone).toBe('battlefield');
          expect(card.tapped).toBe(false);
          expect(card.summoningSick).toBe(true);
          expect(card.isToken).toBe(true);
          expect(card.copiedFromDefinitionId).toBe('def-creature-2');
          expect(card.isCommander).toBe(false);
        }
      }
      expect(copyFound).toBe(true);
    });

    it('copy tokens apply copied card battlefield entry replacement text', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      const cardDefinitions = new Map(state.cardDefinitions);
      cardDefinitions.set('def-copy-tapped', {
        id: 'def-copy-tapped',
        name: 'Copy Tapped Beast',
        type_line: 'Creature - Beast',
        oracle_text: 'This creature enters tapped.',
        mana_cost: '{3}{G}',
        cmc: 4,
        colors: ['G'],
        color_identity: ['G'],
        keywords: [],
        power: 4,
        toughness: 4,
        card_types: ['creature'],
      });
      cards.set('copy-source', {
        instanceId: 'copy-source',
        definitionId: 'def-copy-tapped',
        ownerId: 'player-2',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      const modifiedState = { ...state, cards, cardDefinitions };
      const effects: Effect[] = [
        { kind: 'Copy', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(modifiedState, effects, 'player-1', ['copy-source'], [{ id: 'target_1' }]);
      const copy = [...newState.cards.values()].find(card =>
        card.instanceId.startsWith('copy_') && card.definitionId === 'def-copy-tapped',
      );
      expect(copy).toBeDefined();
      expect(copy?.ownerId).toBe('player-1');
      expect(copy?.zone).toBe('battlefield');
      expect(copy?.tapped).toBe(true);
      expect(copy?.isToken).toBe(true);
    });

    it('copy of a card that does not exist returns unchanged state', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'Copy', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(state, effects, 'player-1', ['nonexistent'], [{ id: 'target_1' }]);
      expect(newState.cards.size).toBe(state.cards.size);
    });
  });
});

// ============================================================================
// TASK 3: Grant Keyword
// ============================================================================

describe('Grant Keyword', () => {
  describe('Parser', () => {
    it('parses "Target creature gains hexproof until end of turn."', () => {
      const result = parseOracleText('Target creature gains hexproof until end of turn.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('GrantKeyword');
      if (result.effects[0].kind !== 'GrantKeyword') return;
      expect(result.effects[0].keyword).toBe('Hexproof');
      expect(result.effects[0].untilEndOfTurn).toBe(true);
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Creature');
    });

    it('parses "Target creature gains indestructible until end of turn."', () => {
      const result = parseOracleText('Target creature gains indestructible until end of turn.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('GrantKeyword');
      if (result.effects[0].kind !== 'GrantKeyword') return;
      expect(result.effects[0].keyword).toBe('Indestructible');
      expect(result.effects[0].untilEndOfTurn).toBe(true);
    });

    it('parses "Target creature gains flying until end of turn."', () => {
      const result = parseOracleText('Target creature gains flying until end of turn.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('GrantKeyword');
      if (result.effects[0].kind !== 'GrantKeyword') return;
      expect(result.effects[0].keyword).toBe('Flying');
    });

    it('parses "Target creature you control gains hexproof until end of turn."', () => {
      const result = parseOracleText('Target creature you control gains hexproof until end of turn.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('GrantKeyword');
    });

    it('parses "Target creature gains double strike until end of turn."', () => {
      const result = parseOracleText('Target creature gains double strike until end of turn.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('GrantKeyword');
      if (result.effects[0].kind !== 'GrantKeyword') return;
      expect(result.effects[0].keyword).toBe('Double Strike');
    });

    it('parses "Target creature gains trample."', () => {
      const result = parseOracleText('Target creature gains trample.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('GrantKeyword');
      if (result.effects[0].kind !== 'GrantKeyword') return;
      expect(result.effects[0].keyword).toBe('Trample');
      expect(result.effects[0].untilEndOfTurn).toBe(false);
    });

    it('parses temporary cannot-block target restrictions', () => {
      const result = parseOracleText("Target creature can't block this turn.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0]).toMatchObject({
        kind: 'GrantKeyword',
        keyword: 'CannotBlock',
        untilEndOfTurn: true,
      });
      expect(result.targets[0].type).toBe('Creature');
    });

    it('parses temporary cannot-attack-or-block target restrictions', () => {
      const result = parseOracleText("Target creature can't attack or block this turn.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(2);
      expect(result.effects.map(effect => effect.kind === 'GrantKeyword' ? effect.keyword : null))
        .toEqual(['CannotAttack', 'CannotBlock']);
    });

    it('parses temporary unblockable target restrictions', () => {
      const result = parseOracleText("Target creature can't be blocked this turn.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0]).toMatchObject({
        kind: 'GrantKeyword',
        keyword: 'Unblockable',
        untilEndOfTurn: true,
      });
    });

    it('parses all supported keywords', () => {
      const keywords = [
        'hexproof', 'indestructible', 'flying', 'trample', 'lifelink',
        'deathtouch', 'vigilance', 'reach', 'menace', 'haste',
      ];
      for (const kw of keywords) {
        const result = parseOracleText(`Target creature gains ${kw} until end of turn.`);
        expect(result.kind).toBe('Spell');
        if (result.kind !== 'Spell') continue;
        expect(result.effects[0].kind).toBe('GrantKeyword');
      }
    });
  });

  describe('Executor', () => {
    it('grants a keyword to a creature', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'GrantKeyword', target: { kind: 'Chosen', targetId: 'target_1' }, keyword: 'Hexproof', untilEndOfTurn: true },
      ];

      const newState = executeEffects(state, effects, 'player-1', ['creature-1'], [{ id: 'target_1' }]);

      const creature = newState.cards.get('creature-1')!;
      expect(creature.grantedKeywords).toContain('Hexproof');
    });

    it('applies parsed cannot-block restrictions to blocking legality', () => {
      const result = parseOracleText("Target creature can't block this turn.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      const state = createTestState();
      const newState = executeEffects(state, result.effects, 'player-1', ['creature-1'], result.targets);

      expect(newState.cards.get('creature-1')!.grantedKeywords).toContain('CannotBlock');
      expect(canBlock(newState, 'creature-1', 'creature-2')).toBe(false);
    });

    it('applies parsed cannot-attack restrictions to attack legality', () => {
      const result = parseOracleText("Target creature can't attack this turn.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      const state = createTestState();
      const newState = executeEffects(state, result.effects, 'player-1', ['creature-1'], result.targets);

      expect(newState.cards.get('creature-1')!.grantedKeywords).toContain('CannotAttack');
      expect(canAttackThisTurn(newState, 'creature-1')).toBe(false);
    });

    it('applies parsed unblockable restrictions to blocking legality', () => {
      const result = parseOracleText("Target creature can't be blocked this turn.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      const state = createTestState();
      const newState = executeEffects(state, result.effects, 'player-1', ['creature-2'], result.targets);

      expect(newState.cards.get('creature-2')!.grantedKeywords).toContain('Unblockable');
      expect(canBlock(newState, 'creature-1', 'creature-2')).toBe(false);
    });

    it('does not duplicate granted keywords', () => {
      const state = createTestState();
      // Pre-grant the keyword
      const cards = new Map(state.cards);
      const creature = cards.get('creature-1')!;
      cards.set('creature-1', { ...creature, grantedKeywords: ['Hexproof'] });
      const stateWithKeyword = { ...state, cards };

      const effects: Effect[] = [
        { kind: 'GrantKeyword', target: { kind: 'Chosen', targetId: 'target_1' }, keyword: 'Hexproof', untilEndOfTurn: true },
      ];

      const newState = executeEffects(stateWithKeyword, effects, 'player-1', ['creature-1'], [{ id: 'target_1' }]);
      const updated = newState.cards.get('creature-1')!;
      // Should still only have one Hexproof
      expect(updated.grantedKeywords?.filter(k => k === 'Hexproof')).toHaveLength(1);
    });

    it('can grant multiple different keywords', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'GrantKeyword', target: { kind: 'Chosen', targetId: 'target_1' }, keyword: 'Hexproof', untilEndOfTurn: true },
        { kind: 'GrantKeyword', target: { kind: 'Chosen', targetId: 'target_1' }, keyword: 'Indestructible', untilEndOfTurn: true },
      ];

      const newState = executeEffects(state, effects, 'player-1', ['creature-1'], [{ id: 'target_1' }]);
      const creature = newState.cards.get('creature-1')!;
      expect(creature.grantedKeywords).toContain('Hexproof');
      expect(creature.grantedKeywords).toContain('Indestructible');
    });

    it('can remove an existing keyword temporarily', () => {
      const state = createTestState();
      expect(instanceHasKeyword(state, 'creature-1', 'Flying')).toBe(true);

      const effects: Effect[] = [
        { kind: 'LoseKeyword', target: { kind: 'Chosen', targetId: 'target_1' }, keyword: 'Flying', untilEndOfTurn: true },
      ];

      const newState = executeEffects(state, effects, 'player-1', ['creature-1'], [{ id: 'target_1' }]);
      expect(newState.cards.get('creature-1')!.lostKeywords).toContain('Flying');
      expect(instanceHasKeyword(newState, 'creature-1', 'Flying')).toBe(false);
    });

    it('does nothing for card not on battlefield', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      const creature = cards.get('creature-1')!;
      cards.set('creature-1', { ...creature, zone: 'graveyard' });
      const stateWithGraveyard = { ...state, cards };

      const effects: Effect[] = [
        { kind: 'GrantKeyword', target: { kind: 'Chosen', targetId: 'target_1' }, keyword: 'Hexproof', untilEndOfTurn: true },
      ];

      const newState = executeEffects(stateWithGraveyard, effects, 'player-1', ['creature-1'], [{ id: 'target_1' }]);
      expect(newState.cards.get('creature-1')!.grantedKeywords).toBeUndefined();
    });
  });
});

// ============================================================================
// TASK 4: Phasing
// ============================================================================

describe('Phasing', () => {
  describe('Parser', () => {
    it('parses "Target permanent phases out."', () => {
      const result = parseOracleText('Target permanent phases out.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('PhaseOut');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Permanent');
    });

    it('parses "Target creature phases out."', () => {
      const result = parseOracleText('Target creature phases out.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('PhaseOut');
      expect(result.targets[0].type).toBe('Creature');
    });
  });

  describe('Executor', () => {
    it('sets phasedOut flag on a permanent', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'PhaseOut', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(state, effects, 'player-1', ['creature-1'], [{ id: 'target_1' }]);

      const creature = newState.cards.get('creature-1')!;
      expect(creature.phasedOut).toBe(true);
      expect(creature.zone).toBe('battlefield'); // stays on battlefield
    });

    it('does nothing if target is not on battlefield', () => {
      const state = createTestState();
      const cards = new Map(state.cards);
      const creature = cards.get('creature-1')!;
      cards.set('creature-1', { ...creature, zone: 'hand' });
      const stateWithHand = { ...state, cards };

      const effects: Effect[] = [
        { kind: 'PhaseOut', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(stateWithHand, effects, 'player-1', ['creature-1'], [{ id: 'target_1' }]);
      const creature2 = newState.cards.get('creature-1')!;
      expect(creature2.phasedOut).toBeUndefined();
    });

    it('can phase out an artifact', () => {
      const state = createTestState();
      const effects: Effect[] = [
        { kind: 'PhaseOut', target: { kind: 'Chosen', targetId: 'target_1' } },
      ];

      const newState = executeEffects(state, effects, 'player-1', ['artifact-1'], [{ id: 'target_1' }]);
      const artifact = newState.cards.get('artifact-1')!;
      expect(artifact.phasedOut).toBe(true);
    });
  });
});

// ============================================================================
// Combined / integration tests
// ============================================================================

describe('Combined effects', () => {
  it('blink + draw combined', () => {
    const result = parseOracleText(
      "Exile target creature, then return it to the battlefield under its owner's control. Draw a card."
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    // Should parse at least the blink effect
    expect(result.effects.length).toBeGreaterThanOrEqual(1);
    expect(result.effects[0].kind).toBe('Blink');
  });
});
