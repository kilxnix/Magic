import { describe, it, expect } from 'vitest';
import { makeDecision, createAIConfig, runAITurn } from './agent';
import { GameState, CardDefinition, createPlayer, Phase, Step } from '../types';

// Helper to create minimal game state
function createTestState(overrides: Partial<GameState> = {}): GameState {
  const players = [
    { ...createPlayer('p1', 'Player 1'), hasPriority: true },
    { ...createPlayer('p2', 'Player 2'), hasPriority: false },
  ];

  return {
    players,
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as Phase,
    step: 'upkeep' as Step,
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    ...overrides,
  };
}

// Helper to add a card to the game state
function addCard(
  state: GameState,
  instanceId: string,
  ownerId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard' | 'command',
  def: Partial<CardDefinition>,
  options: { tapped?: boolean; summoningSick?: boolean } = {},
): void {
  const fullDef: CardDefinition = {
    id: def.id ?? instanceId,
    name: def.name ?? 'Test Card',
    type_line: def.type_line ?? 'Creature',
    oracle_text: def.oracle_text ?? '',
    mana_cost: def.mana_cost ?? '',
    cmc: def.cmc ?? 0,
    colors: def.colors ?? [],
    color_identity: def.color_identity ?? [],
    keywords: def.keywords ?? [],
    card_types: def.card_types ?? ['creature'],
    power: def.power,
    toughness: def.toughness,
  };

  state.cardDefinitions.set(fullDef.id, fullDef);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: fullDef.id,
    ownerId,
    zone,
    tapped: options.tapped ?? false,
    summoningSick: options.summoningSick ?? (zone === 'battlefield'),
    counters: {},
    damage: 0,
    isCommander: false,
  });
}

describe('Difficulty Tiers', () => {
  describe('Difficulty 1-2 (Basic play)', () => {
    it('plays available cards without complex sequencing', () => {
      const state = createTestState({
        activePlayerIndex: 0,
        priorityPlayerIndex: 0,
        phase: 'precombat_main',
      });

      addCard(state, 'forest1', 'p1', 'hand', {
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        card_types: ['land'],
      });

      const config = createAIConfig('p1', 1);
      const decision = makeDecision(state, config);

      // Even at low difficulty, should play land
      expect(decision).not.toBeNull();
      // Action should be legal (PlayLand or PassPriority)
      expect(['PlayLand', 'PassPriority']).toContain(decision!.action.kind);
    });

    it('attacks when able', () => {
      const state = createTestState({
        activePlayerIndex: 0,
        priorityPlayerIndex: 0,
        phase: 'combat',
        step: 'declare_attackers',
      });

      addCard(state, 'creature1', 'p1', 'battlefield', {
        name: 'Bear',
        card_types: ['creature'],
        power: 2,
        toughness: 2,
        keywords: [],
      }, { summoningSick: false });

      const config = createAIConfig('p1', 1);
      const decision = makeDecision(state, config);

      expect(decision).not.toBeNull();
      expect(decision!.action.kind).toBe('DeclareAttackers');
    });
  });

  describe('Difficulty 3 (Precon level)', () => {
    it('prefers higher value plays', () => {
      const state = createTestState({
        activePlayerIndex: 0,
        priorityPlayerIndex: 0,
        phase: 'precombat_main',
      });

      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 5, C: 0 };

      // Add two creatures: one small, one big
      addCard(state, 'small', 'p1', 'hand', {
        name: 'Squirrel',
        mana_cost: '{G}',
        cmc: 1,
        card_types: ['creature'],
        power: 1,
        toughness: 1,
      });

      addCard(state, 'big', 'p1', 'hand', {
        id: 'big_def',
        name: 'Giant',
        mana_cost: '{3}{G}{G}',
        cmc: 5,
        card_types: ['creature'],
        power: 5,
        toughness: 5,
      });

      const config = createAIConfig('p1', 3);
      const decision = makeDecision(state, config);

      expect(decision).not.toBeNull();
      expect(decision!.action.kind).toBe('CastSpell');

      // At difficulty 3, should prefer the bigger creature (higher mana value)
      if (decision!.action.kind === 'CastSpell') {
        expect(decision!.action.cardInstanceId).toBe('big');
      }
    });

    it('targets biggest threat with removal', () => {
      const state = createTestState({
        activePlayerIndex: 0,
        priorityPlayerIndex: 0,
        phase: 'precombat_main',
      });

      state.players[0].manaPool = { W: 0, U: 0, B: 3, R: 0, G: 0, C: 0 };

      // Add removal spell
      addCard(state, 'murder', 'p1', 'hand', {
        name: 'Murder',
        mana_cost: '{1}{B}{B}',
        cmc: 3,
        card_types: ['instant'],
        oracle_text: 'Destroy target creature.',
      });

      // Add opponent creatures
      addCard(state, 'small', 'p2', 'battlefield', {
        name: 'Squirrel',
        card_types: ['creature'],
        power: 1,
        toughness: 1,
        keywords: [],
      });

      addCard(state, 'big', 'p2', 'battlefield', {
        id: 'big_def',
        name: 'Dragon',
        card_types: ['creature'],
        power: 6,
        toughness: 6,
        keywords: ['Flying'],
      });

      const config = createAIConfig('p1', 3);
      const { finalState, decisions } = runAITurn(state, config);

      // Should have cast the removal spell
      const castDecision = decisions.find(d => d.action.kind === 'CastSpell');
      expect(castDecision).toBeDefined();

      // Should have targeted the bigger threat
      if (castDecision && castDecision.action.kind === 'CastSpell') {
        expect(castDecision.action.targets).toContain('big');
      }
    });
  });

  describe('Difficulty 4-5 (Optimized play)', () => {
    it('makes consistent optimal decisions', () => {
      const state = createTestState({
        activePlayerIndex: 0,
        priorityPlayerIndex: 0,
        phase: 'precombat_main',
      });

      addCard(state, 'forest1', 'p1', 'hand', {
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        card_types: ['land'],
      });

      // At high difficulty, should consistently play land (no randomness)
      const config = createAIConfig('p1', 5);

      // Run multiple times - should always play land
      for (let i = 0; i < 5; i++) {
        const decision = makeDecision(state, config);
        expect(decision).not.toBeNull();
        expect(decision!.action.kind).toBe('PlayLand');
      }
    });

    it('prioritizes commander damage when close to lethal', () => {
      const state = createTestState({
        activePlayerIndex: 0,
        priorityPlayerIndex: 0,
        phase: 'combat',
        step: 'declare_attackers',
        players: [
          { ...createPlayer('p1', 'Player 1'), hasPriority: true },
          { ...createPlayer('p2', 'Player 2'), hasPriority: false, commanderDamage: {} },
          { ...createPlayer('p3', 'Player 3'), hasPriority: false, commanderDamage: {} },
        ],
        hasPriorityPassed: [false, false, false],
      });

      // p2 has taken 16 commander damage, p3 has taken 0
      state.players[1].commanderDamage = { commander: 16 };
      state.players[2].life = 10; // Lower life but no commander damage

      addCard(state, 'commander', 'p1', 'battlefield', {
        name: 'Commander',
        card_types: ['creature'],
        power: 6,
        toughness: 6,
        keywords: [],
      }, { summoningSick: false });
      state.cards.get('commander')!.isCommander = true;

      const config = createAIConfig('p1', 5);
      const decision = makeDecision(state, config);

      expect(decision).not.toBeNull();
      expect(decision!.action.kind).toBe('DeclareAttackers');

      if (decision!.action.kind === 'DeclareAttackers') {
        // Should attack p2 (16 + 6 = 22 commander damage = lethal)
        expect(decision!.action.attacks.length).toBeGreaterThan(0);
        expect(decision!.action.attacks[0].defendingPlayerId).toBe('p2');
      }
    });
  });

  describe('Randomness by difficulty', () => {
    it('low difficulty has more variance in decisions', () => {
      // This test is statistical - we run many iterations and check variance
      const state = createTestState({
        activePlayerIndex: 0,
        priorityPlayerIndex: 0,
        phase: 'precombat_main',
      });

      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 };

      // Two similar-value creatures
      addCard(state, 'bear1', 'p1', 'hand', {
        name: 'Bear A',
        mana_cost: '{1}{G}',
        cmc: 2,
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      });

      addCard(state, 'bear2', 'p1', 'hand', {
        id: 'bear2_def',
        name: 'Bear B',
        mana_cost: '{1}{G}',
        cmc: 2,
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      });

      // Low difficulty - track which bear is cast
      const lowDiffResults: string[] = [];
      for (let i = 0; i < 20; i++) {
        const config = createAIConfig('p1', 1);
        const decision = makeDecision({ ...state }, config);
        if (decision && decision.action.kind === 'CastSpell') {
          lowDiffResults.push(decision.action.cardInstanceId);
        }
      }

      // High difficulty - track which bear is cast
      const highDiffResults: string[] = [];
      for (let i = 0; i < 20; i++) {
        const config = createAIConfig('p1', 5);
        const decision = makeDecision({ ...state }, config);
        if (decision && decision.action.kind === 'CastSpell') {
          highDiffResults.push(decision.action.cardInstanceId);
        }
      }

      // Low difficulty should have more variety (both bears cast sometimes)
      const lowUnique = new Set(lowDiffResults).size;
      const highUnique = new Set(highDiffResults).size;

      // High difficulty should be more consistent (same bear each time)
      expect(highUnique).toBeLessThanOrEqual(lowUnique);
    });
  });
});
