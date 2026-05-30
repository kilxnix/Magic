import { describe, it, expect } from 'vitest';
import {
  hasKeyword,
  getKeywordsFromDefinition,
  getKeywordsForInstance,
  instanceHasKeyword,
  canAttackThisTurn,
  shouldTapWhenAttacking,
  canBlock,
  satisfiesMenace,
  isLethalDamage,
  canBeTargetedByOpponent,
  canBeTargetedByController,
  isIndestructible,
} from './keywords';
import type { CardDefinition, CardInstance, GameState } from './types';

function makeCreatureDef(keywords: string[] = []): CardDefinition {
  return {
    id: 'test-creature',
    name: 'Test Creature',
    type_line: 'Creature — Test',
    oracle_text: '',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords,
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
}

function makeTestState(
  defKeywords: string[] = [],
  cardOverrides: Partial<CardInstance> = {},
): GameState {
  const def = makeCreatureDef(defKeywords);
  const cards = new Map<string, CardInstance>();
  cards.set('creature-1', {
    instanceId: 'creature-1',
    definitionId: 'test-creature',
    ownerId: 'player-1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...cardOverrides,
  });

  const cardDefinitions = new Map<string, CardDefinition>();
  cardDefinitions.set('test-creature', def);

  return {
    players: [
      {
        id: 'player-1',
        name: 'Player 1',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
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
  };
}

describe('keywords', () => {
  describe('hasKeyword', () => {
    it('returns true when definition has keyword', () => {
      const def = makeCreatureDef(['Flying', 'Trample']);
      expect(hasKeyword(def, 'Flying')).toBe(true);
      expect(hasKeyword(def, 'Trample')).toBe(true);
    });

    it('returns false when definition lacks keyword', () => {
      const def = makeCreatureDef(['Flying']);
      expect(hasKeyword(def, 'Trample')).toBe(false);
    });

    it('handles case-insensitive matching', () => {
      const def = makeCreatureDef(['flying', 'TRAMPLE']);
      expect(hasKeyword(def, 'Flying')).toBe(true);
      expect(hasKeyword(def, 'Trample')).toBe(true);
    });

    it('handles first strike / double strike normalization', () => {
      const def = makeCreatureDef(['First Strike', 'Double Strike']);
      expect(hasKeyword(def, 'First Strike')).toBe(true);
      expect(hasKeyword(def, 'Double Strike')).toBe(true);
    });
  });

  describe('getKeywordsFromDefinition', () => {
    it('returns set of canonical keywords', () => {
      const def = makeCreatureDef(['Flying', 'Trample', 'Lifelink']);
      const keywords = getKeywordsFromDefinition(def);
      expect(keywords.has('Flying')).toBe(true);
      expect(keywords.has('Trample')).toBe(true);
      expect(keywords.has('Lifelink')).toBe(true);
      expect(keywords.size).toBe(3);
    });

    it('ignores unknown keywords', () => {
      const def = makeCreatureDef(['Flying', 'SomeUnknownKeyword']);
      const keywords = getKeywordsFromDefinition(def);
      expect(keywords.has('Flying')).toBe(true);
      expect(keywords.size).toBe(1);
    });
  });

  describe('getKeywordsForInstance', () => {
    it('returns keywords from card definition', () => {
      const state = makeTestState(['Flying', 'Haste']);
      const keywords = getKeywordsForInstance(state, 'creature-1');
      expect(keywords.has('Flying')).toBe(true);
      expect(keywords.has('Haste')).toBe(true);
    });

    it('uses the active face for modal permanents', () => {
      const state = makeTestState();
      state.cardDefinitions.set('test-creature', {
        ...makeCreatureDef([]),
        name: 'Dormant Meadow // Awakened Drake',
        type_line: 'Land',
        oracle_text: '{T}: Add {G}.',
        mana_cost: '',
        cmc: 0,
        card_types: ['land'],
        power: undefined,
        toughness: undefined,
        faces: [
          {
            id: 'test-creature:front',
            name: 'Dormant Meadow',
            type_line: 'Land',
            oracle_text: '{T}: Add {G}.',
            mana_cost: '',
            cmc: 0,
            colors: [],
            keywords: [],
            card_types: ['land'],
          },
          {
            id: 'test-creature:back',
            name: 'Awakened Drake',
            type_line: 'Creature — Drake',
            oracle_text: 'Flying',
            mana_cost: '{3}{U}',
            cmc: 4,
            colors: ['U'],
            keywords: ['Flying'],
            card_types: ['creature'],
            power: 3,
            toughness: 4,
          },
        ],
      });
      state.cards.set('creature-1', {
        ...state.cards.get('creature-1')!,
        activeFaceName: 'Awakened Drake',
        summoningSick: false,
      });

      expect(getKeywordsForInstance(state, 'creature-1').has('Flying')).toBe(true);
      expect(canAttackThisTurn(state, 'creature-1')).toBe(true);
      expect(isLethalDamage(state, 'attacker', 'creature-1', 3)).toBe(false);
      expect(isLethalDamage(state, 'attacker', 'creature-1', 4)).toBe(true);
    });

    it('returns empty set for nonexistent card', () => {
      const state = makeTestState();
      const keywords = getKeywordsForInstance(state, 'nonexistent');
      expect(keywords.size).toBe(0);
    });
  });

  describe('canAttackThisTurn', () => {
    it('allows attack when not summoning sick', () => {
      const state = makeTestState([], { summoningSick: false });
      expect(canAttackThisTurn(state, 'creature-1')).toBe(true);
    });

    it('prevents attack when summoning sick', () => {
      const state = makeTestState([], { summoningSick: true });
      expect(canAttackThisTurn(state, 'creature-1')).toBe(false);
    });

    it('allows attack with haste despite summoning sickness', () => {
      const state = makeTestState(['Haste'], { summoningSick: true });
      expect(canAttackThisTurn(state, 'creature-1')).toBe(true);
    });

    it('prevents attack with defender', () => {
      const state = makeTestState(['Defender'], { summoningSick: false });
      expect(canAttackThisTurn(state, 'creature-1')).toBe(false);
    });
  });

  describe('shouldTapWhenAttacking', () => {
    it('returns true without vigilance', () => {
      const state = makeTestState([]);
      expect(shouldTapWhenAttacking(state, 'creature-1')).toBe(true);
    });

    it('returns false with vigilance', () => {
      const state = makeTestState(['Vigilance']);
      expect(shouldTapWhenAttacking(state, 'creature-1')).toBe(false);
    });
  });

  describe('canBlock', () => {
    it('allows blocking non-flying creature', () => {
      const state = makeTestState([]);
      // Add attacker without flying
      state.cards.set('attacker', {
        instanceId: 'attacker',
        definitionId: 'test-creature',
        ownerId: 'player-2',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      expect(canBlock(state, 'creature-1', 'attacker')).toBe(true);
    });

    it('prevents blocking flying creature without flying/reach', () => {
      const state = makeTestState([]);
      // Add flying attacker
      const flyingDef = makeCreatureDef(['Flying']);
      flyingDef.id = 'flying-creature';
      state.cardDefinitions.set('flying-creature', flyingDef);
      state.cards.set('attacker', {
        instanceId: 'attacker',
        definitionId: 'flying-creature',
        ownerId: 'player-2',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      expect(canBlock(state, 'creature-1', 'attacker')).toBe(false);
    });

    it('allows blocking flying with flying', () => {
      const state = makeTestState(['Flying']);
      const flyingDef = makeCreatureDef(['Flying']);
      flyingDef.id = 'flying-creature';
      state.cardDefinitions.set('flying-creature', flyingDef);
      state.cards.set('attacker', {
        instanceId: 'attacker',
        definitionId: 'flying-creature',
        ownerId: 'player-2',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      expect(canBlock(state, 'creature-1', 'attacker')).toBe(true);
    });

    it('allows blocking flying with reach', () => {
      const state = makeTestState(['Reach']);
      const flyingDef = makeCreatureDef(['Flying']);
      flyingDef.id = 'flying-creature';
      state.cardDefinitions.set('flying-creature', flyingDef);
      state.cards.set('attacker', {
        instanceId: 'attacker',
        definitionId: 'flying-creature',
        ownerId: 'player-2',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      expect(canBlock(state, 'creature-1', 'attacker')).toBe(true);
    });
  });

  describe('satisfiesMenace', () => {
    it('returns true for non-menace attacker with any blockers', () => {
      const state = makeTestState([]);
      expect(satisfiesMenace(state, 'creature-1', [])).toBe(true);
      expect(satisfiesMenace(state, 'creature-1', ['blocker-1'])).toBe(true);
    });

    it('returns true for menace attacker with 0 blockers', () => {
      const state = makeTestState(['Menace']);
      expect(satisfiesMenace(state, 'creature-1', [])).toBe(true);
    });

    it('returns false for menace attacker with 1 blocker', () => {
      const state = makeTestState(['Menace']);
      expect(satisfiesMenace(state, 'creature-1', ['blocker-1'])).toBe(false);
    });

    it('returns true for menace attacker with 2+ blockers', () => {
      const state = makeTestState(['Menace']);
      expect(satisfiesMenace(state, 'creature-1', ['b1', 'b2'])).toBe(true);
      expect(satisfiesMenace(state, 'creature-1', ['b1', 'b2', 'b3'])).toBe(true);
    });
  });

  describe('isLethalDamage', () => {
    it('returns true when damage meets toughness', () => {
      const state = makeTestState([], { damage: 0 });
      expect(isLethalDamage(state, 'source', 'creature-1', 2)).toBe(true);
    });

    it('returns true when damage exceeds toughness', () => {
      const state = makeTestState([], { damage: 0 });
      expect(isLethalDamage(state, 'source', 'creature-1', 5)).toBe(true);
    });

    it('returns false when damage is less than toughness', () => {
      const state = makeTestState([], { damage: 0 });
      expect(isLethalDamage(state, 'source', 'creature-1', 1)).toBe(false);
    });

    it('considers existing damage', () => {
      const state = makeTestState([], { damage: 1 });
      expect(isLethalDamage(state, 'source', 'creature-1', 1)).toBe(true);
    });

    it('deathtouch makes any positive damage lethal', () => {
      const state = makeTestState([]);
      // Add deathtouch source
      const dtDef = makeCreatureDef(['Deathtouch']);
      dtDef.id = 'dt-creature';
      state.cardDefinitions.set('dt-creature', dtDef);
      state.cards.set('source', {
        instanceId: 'source',
        definitionId: 'dt-creature',
        ownerId: 'player-1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      expect(isLethalDamage(state, 'source', 'creature-1', 1)).toBe(true);
    });
  });

  describe('canBeTargetedByOpponent', () => {
    it('returns true for normal creatures', () => {
      const state = makeTestState([]);
      expect(canBeTargetedByOpponent(state, 'creature-1')).toBe(true);
    });

    it('returns false for hexproof creatures', () => {
      const state = makeTestState(['Hexproof']);
      expect(canBeTargetedByOpponent(state, 'creature-1')).toBe(false);
    });

    it('returns false for shroud creatures', () => {
      const state = makeTestState(['Shroud']);
      expect(canBeTargetedByOpponent(state, 'creature-1')).toBe(false);
    });
  });

  describe('canBeTargetedByController', () => {
    it('returns true for normal creatures', () => {
      const state = makeTestState([]);
      expect(canBeTargetedByController(state, 'creature-1')).toBe(true);
    });

    it('returns true for hexproof creatures (controller can target)', () => {
      const state = makeTestState(['Hexproof']);
      expect(canBeTargetedByController(state, 'creature-1')).toBe(true);
    });

    it('returns false for shroud creatures (nobody can target)', () => {
      const state = makeTestState(['Shroud']);
      expect(canBeTargetedByController(state, 'creature-1')).toBe(false);
    });
  });

  describe('isIndestructible', () => {
    it('returns false for normal creatures', () => {
      const state = makeTestState([]);
      expect(isIndestructible(state, 'creature-1')).toBe(false);
    });

    it('returns true for indestructible creatures', () => {
      const state = makeTestState(['Indestructible']);
      expect(isIndestructible(state, 'creature-1')).toBe(true);
    });
  });
});
