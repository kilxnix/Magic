/**
 * AI Decision-Making Tests
 *
 * Verifies the AI makes good gameplay decisions:
 * 1. Taps lands and casts creatures during precombat main
 * 2. Attacks with creatures when the opponent has no blockers
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance, ManaPool } from '../types';
import { createPlayer, emptyManaPool } from '../types';
import { runAITurn, createAIConfig } from '../ai/agent';
import { populateParsedCache } from '../cards/card-parser-cache';

// ---------------------------------------------------------------------------
// Helpers to build card definitions
// ---------------------------------------------------------------------------

function makeMountainDef(id: string): CardDefinition {
  return {
    id,
    name: `Mountain_${id}`,
    type_line: 'Basic Land — Mountain',
    oracle_text: '{T}: Add {R}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['R'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeCreatureDef(
  id: string,
  name: string,
  manaCost: string,
  cmc: number,
  power: number,
  toughness: number,
): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature — Warrior',
    oracle_text: '',
    mana_cost: manaCost,
    cmc,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
  };
}

function makeCardInstance(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'],
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
  };
}

// ---------------------------------------------------------------------------
// Build a minimal 2-player game state from scratch
// ---------------------------------------------------------------------------

function buildBaseState(): {
  state: GameState;
  ids: {
    mtn1: string;
    mtn2: string;
    mtn3: string;
    creature2: string;
    creature3: string;
  };
} {
  // Card definitions
  const mtnDef1 = makeMountainDef('mtn_def_1');
  const mtnDef2 = makeMountainDef('mtn_def_2');
  const mtnDef3 = makeMountainDef('mtn_def_3');
  const smallCreatureDef = makeCreatureDef('small_creature', 'Goblin Striker', '{R}', 1, 2, 2);
  const bigCreatureDef = makeCreatureDef('big_creature', 'Ogre Brute', '{2}{R}', 3, 3, 3);

  const cardDefinitions = new Map<string, CardDefinition>();
  cardDefinitions.set(mtnDef1.id, populateParsedCache(mtnDef1));
  cardDefinitions.set(mtnDef2.id, populateParsedCache(mtnDef2));
  cardDefinitions.set(mtnDef3.id, populateParsedCache(mtnDef3));
  cardDefinitions.set(smallCreatureDef.id, populateParsedCache(smallCreatureDef));
  cardDefinitions.set(bigCreatureDef.id, populateParsedCache(bigCreatureDef));

  // Card instances
  // AI owns 3 mountains on the battlefield (untapped)
  const mtn1 = makeCardInstance('inst_mtn1', mtnDef1.id, 'ai', 'battlefield');
  const mtn2 = makeCardInstance('inst_mtn2', mtnDef2.id, 'ai', 'battlefield');
  const mtn3 = makeCardInstance('inst_mtn3', mtnDef3.id, 'ai', 'battlefield');

  // AI has two creatures in hand
  const creature2 = makeCardInstance('inst_small', smallCreatureDef.id, 'ai', 'hand');
  const creature3 = makeCardInstance('inst_big', bigCreatureDef.id, 'ai', 'hand');

  const cards = new Map<string, CardInstance>();
  cards.set(mtn1.instanceId, mtn1);
  cards.set(mtn2.instanceId, mtn2);
  cards.set(mtn3.instanceId, mtn3);
  cards.set(creature2.instanceId, creature2);
  cards.set(creature3.instanceId, creature3);

  // Players: index 0 = human, index 1 = ai
  const human = createPlayer('human', 'Human', 40);
  const ai = createPlayer('ai', 'AI', 40);

  // AI is the active player (index 1) with priority
  const state: GameState = {
    players: [human, ai],
    cards,
    cardDefinitions,
    activePlayerIndex: 1, // AI's turn
    priorityPlayerIndex: 1, // AI has priority
    phase: 'precombat_main',
    step: 'upkeep', // step is less relevant for main phase
    turnNumber: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };

  return {
    state,
    ids: {
      mtn1: mtn1.instanceId,
      mtn2: mtn2.instanceId,
      mtn3: mtn3.instanceId,
      creature2: creature2.instanceId,
      creature3: creature3.instanceId,
    },
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('AI Decision-Making', () => {
  // -----------------------------------------------------------------------
  // Scenario 1: precombat main with lands + creatures in hand
  // -----------------------------------------------------------------------
  describe('precombat main phase with castable creatures', () => {
    it('should tap a mountain for mana (not just pass)', () => {
      const { state } = buildBaseState();
      const config = createAIConfig('ai', 5); // max difficulty = deterministic
      const { decisions } = runAITurn(state, config);

      // Log every decision for diagnostics
      console.log('--- Scenario 1: decisions ---');
      for (const d of decisions) {
        console.log(`  ${d.action.kind}`, 'reasoning:', d.reasoning);
      }

      const manaActions = decisions.filter(d => d.action.kind === 'ActivateManaAbility');
      expect(manaActions.length).toBeGreaterThan(0);
    });

    it('should cast at least one creature', () => {
      const { state } = buildBaseState();
      const config = createAIConfig('ai', 5);
      const { decisions } = runAITurn(state, config);

      const castActions = decisions.filter(d => d.action.kind === 'CastSpell');
      expect(castActions.length).toBeGreaterThan(0);
    });

    it('should NOT just pass immediately', () => {
      const { state } = buildBaseState();
      const config = createAIConfig('ai', 5);
      const { decisions } = runAITurn(state, config);

      // The very first decision must not be PassPriority
      expect(decisions.length).toBeGreaterThan(0);
      expect(decisions[0].action.kind).not.toBe('PassPriority');
    });

    it('should ideally cast the 3/3 (highest value) when it has enough mana', () => {
      const { state, ids } = buildBaseState();
      const config = createAIConfig('ai', 5);
      const { decisions } = runAITurn(state, config);

      const castActions = decisions.filter(d => d.action.kind === 'CastSpell');
      console.log('--- Cast actions ---');
      for (const c of castActions) {
        if (c.action.kind === 'CastSpell') {
          const def = state.cardDefinitions.get(
            state.cards.get(c.action.cardInstanceId)?.definitionId ?? '',
          );
          console.log(`  Cast: ${def?.name} (${def?.mana_cost})`);
        }
      }

      // With 3 mountains the AI can cast both, or at least the bigger one.
      // We just verify at least one creature was cast.
      expect(castActions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 2: declare attackers with no opposing blockers
  // -----------------------------------------------------------------------
  describe('declare attackers with no opposing blockers', () => {
    it('should attack with a creature when the opponent has no blockers', () => {
      // Build a state at declare_attackers step.
      // AI has a 3/3 creature on the battlefield (not summoning sick).
      // Human has nothing on the battlefield.

      const creatureDef = makeCreatureDef('atk_creature', 'Fire Elemental', '{3}{R}{R}', 5, 3, 3);
      const cardDefinitions = new Map<string, CardDefinition>();
      cardDefinitions.set(creatureDef.id, populateParsedCache(creatureDef));

      const creatureInst = makeCardInstance('inst_attacker', creatureDef.id, 'ai', 'battlefield', {
        summoningSick: false,
      });
      const cards = new Map<string, CardInstance>();
      cards.set(creatureInst.instanceId, creatureInst);

      const human = createPlayer('human', 'Human', 40);
      const ai = createPlayer('ai', 'AI', 40);

      const state: GameState = {
        players: [human, ai],
        cards,
        cardDefinitions,
        activePlayerIndex: 1, // AI's turn
        priorityPlayerIndex: 1,
        phase: 'combat',
        step: 'declare_attackers',
        turnNumber: 3,
        hasPriorityPassed: [false, false],
        stack: [],
        combat: null,
        battlefieldAbilities: new Map(),
        pendingTriggers: [],
      };

      const config = createAIConfig('ai', 5);
      const { decisions } = runAITurn(state, config);

      console.log('--- Scenario 2: attack decisions ---');
      for (const d of decisions) {
        console.log(`  ${d.action.kind}`, d.reasoning);
        if (d.action.kind === 'DeclareAttackers') {
          console.log('    attacks:', d.action.attacks);
        }
      }

      // Should have exactly one decision: DeclareAttackers
      expect(decisions.length).toBeGreaterThan(0);

      const attackDecision = decisions.find(d => d.action.kind === 'DeclareAttackers');
      expect(attackDecision).toBeDefined();

      if (attackDecision && attackDecision.action.kind === 'DeclareAttackers') {
        // The AI should choose to attack, not declare zero attackers
        expect(attackDecision.action.attacks.length).toBeGreaterThan(0);
        // The only defender is 'human'
        expect(attackDecision.action.attacks[0].defendingPlayerId).toBe('human');
        expect(attackDecision.action.attacks[0].cardInstanceId).toBe('inst_attacker');
      }
    });
  });
});
