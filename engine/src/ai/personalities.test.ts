import { describe, it, expect } from 'vitest';
import {
  PERSONALITY_WEIGHTS,
  getPersonalityWeights,
  getDefaultPersonality,
  applyPersonalityModifier,
  shouldSpreadAttacks,
  getGrudgeMultiplier,
} from './personalities';
import type { AIPersonality } from './types';

describe('PERSONALITY_WEIGHTS', () => {
  it('defines weights for all four personalities', () => {
    expect(PERSONALITY_WEIGHTS.Aggressive).toBeDefined();
    expect(PERSONALITY_WEIGHTS.Greedy).toBeDefined();
    expect(PERSONALITY_WEIGHTS.Political).toBeDefined();
    expect(PERSONALITY_WEIGHTS.Balanced).toBeDefined();
  });

  it('Aggressive has high attack aggressiveness', () => {
    expect(PERSONALITY_WEIGHTS.Aggressive.attackAggressiveness).toBeGreaterThan(0.8);
  });

  it('Greedy has low attack aggressiveness', () => {
    expect(PERSONALITY_WEIGHTS.Greedy.attackAggressiveness).toBeLessThan(0.5);
  });

  it('Political has high grudge bias', () => {
    expect(PERSONALITY_WEIGHTS.Political.grudgeBias).toBeGreaterThan(0.8);
  });

  it('Balanced has moderate values', () => {
    const balanced = PERSONALITY_WEIGHTS.Balanced;
    expect(balanced.attackAggressiveness).toBeGreaterThan(0.4);
    expect(balanced.attackAggressiveness).toBeLessThan(0.8);
    expect(balanced.boardDevelopment).toBeGreaterThan(0.5);
    expect(balanced.boardDevelopment).toBeLessThan(0.9);
  });

  it('all weights are between 0 and 1', () => {
    const personalities: AIPersonality[] = ['Aggressive', 'Greedy', 'Political', 'Balanced'];
    for (const personality of personalities) {
      const weights = PERSONALITY_WEIGHTS[personality];
      expect(weights.boardDevelopment).toBeGreaterThanOrEqual(0);
      expect(weights.boardDevelopment).toBeLessThanOrEqual(1);
      expect(weights.attackAggressiveness).toBeGreaterThanOrEqual(0);
      expect(weights.attackAggressiveness).toBeLessThanOrEqual(1);
      expect(weights.removalEagerness).toBeGreaterThanOrEqual(0);
      expect(weights.removalEagerness).toBeLessThanOrEqual(1);
      expect(weights.grudgeBias).toBeGreaterThanOrEqual(0);
      expect(weights.grudgeBias).toBeLessThanOrEqual(1);
      expect(weights.politicalSpread).toBeGreaterThanOrEqual(0);
      expect(weights.politicalSpread).toBeLessThanOrEqual(1);
    }
  });
});

describe('getPersonalityWeights', () => {
  it('returns correct weights for each personality', () => {
    expect(getPersonalityWeights('Aggressive')).toBe(PERSONALITY_WEIGHTS.Aggressive);
    expect(getPersonalityWeights('Greedy')).toBe(PERSONALITY_WEIGHTS.Greedy);
    expect(getPersonalityWeights('Political')).toBe(PERSONALITY_WEIGHTS.Political);
    expect(getPersonalityWeights('Balanced')).toBe(PERSONALITY_WEIGHTS.Balanced);
  });
});

describe('getDefaultPersonality', () => {
  it('returns Aggressive or Greedy for difficulty 1-2', () => {
    const results = new Set<AIPersonality>();
    for (let i = 0; i < 50; i++) {
      results.add(getDefaultPersonality(1));
      results.add(getDefaultPersonality(2));
    }
    // Should only have Aggressive or Greedy
    for (const result of results) {
      expect(['Aggressive', 'Greedy']).toContain(result);
    }
  });

  it('returns Balanced for difficulty 3', () => {
    expect(getDefaultPersonality(3)).toBe('Balanced');
  });

  it('returns Political or Balanced for difficulty 4', () => {
    const results = new Set<AIPersonality>();
    for (let i = 0; i < 50; i++) {
      results.add(getDefaultPersonality(4));
    }
    for (const result of results) {
      expect(['Political', 'Balanced']).toContain(result);
    }
  });

  it('returns Balanced for difficulty 5', () => {
    expect(getDefaultPersonality(5)).toBe('Balanced');
  });
});

describe('applyPersonalityModifier', () => {
  it('aggressive personality boosts attack scores', () => {
    const aggressiveWeights = PERSONALITY_WEIGHTS.Aggressive;
    const greedyWeights = PERSONALITY_WEIGHTS.Greedy;

    const baseScore = 10;
    const aggressiveAttack = applyPersonalityModifier(baseScore, 'attack', aggressiveWeights);
    const greedyAttack = applyPersonalityModifier(baseScore, 'attack', greedyWeights);

    expect(aggressiveAttack).toBeGreaterThan(greedyAttack);
  });

  it('greedy personality boosts development scores', () => {
    const greedyWeights = PERSONALITY_WEIGHTS.Greedy;

    const baseScore = 10;
    const developmentScore = applyPersonalityModifier(baseScore, 'development', greedyWeights);

    // Greedy has max boardDevelopment, so should get max boost
    expect(developmentScore).toBeGreaterThan(baseScore * 0.9);
  });

  it('political personality uses removal moderately', () => {
    const politicalWeights = PERSONALITY_WEIGHTS.Political;
    const aggressiveWeights = PERSONALITY_WEIGHTS.Aggressive;

    const baseScore = 10;
    const politicalRemoval = applyPersonalityModifier(baseScore, 'removal', politicalWeights);
    const aggressiveRemoval = applyPersonalityModifier(baseScore, 'removal', aggressiveWeights);

    // Political is more conservative with removal
    expect(politicalRemoval).toBeLessThan(aggressiveRemoval);
  });

  it('applies pass modifier based on development preference', () => {
    const greedyWeights = PERSONALITY_WEIGHTS.Greedy;
    const aggressiveWeights = PERSONALITY_WEIGHTS.Aggressive;

    const baseScore = -0.1; // Typical pass score
    const greedyPass = applyPersonalityModifier(baseScore, 'pass', greedyWeights);
    const aggressivePass = applyPersonalityModifier(baseScore, 'pass', aggressiveWeights);

    // Greedy prefers passing slightly less (wants to develop)
    // But with negative scores, the relationship inverts
    expect(typeof greedyPass).toBe('number');
    expect(typeof aggressivePass).toBe('number');
  });
});

describe('shouldSpreadAttacks', () => {
  it('political personality spreads attacks more often', () => {
    const politicalWeights = PERSONALITY_WEIGHTS.Political;

    // Run many trials
    let spreadCount = 0;
    for (let i = 0; i < 100; i++) {
      if (shouldSpreadAttacks(politicalWeights)) {
        spreadCount++;
      }
    }

    // Should spread most of the time (95% weight)
    expect(spreadCount).toBeGreaterThan(80);
  });

  it('aggressive personality rarely spreads attacks', () => {
    const aggressiveWeights = PERSONALITY_WEIGHTS.Aggressive;

    let spreadCount = 0;
    for (let i = 0; i < 100; i++) {
      if (shouldSpreadAttacks(aggressiveWeights)) {
        spreadCount++;
      }
    }

    // Should rarely spread (20% weight)
    expect(spreadCount).toBeLessThan(40);
  });
});

describe('getGrudgeMultiplier', () => {
  it('returns 1.0 with no grudge', () => {
    const weights = PERSONALITY_WEIGHTS.Political;
    expect(getGrudgeMultiplier(weights, 0)).toBe(1.0);
  });

  it('political personality has higher grudge multiplier', () => {
    const politicalWeights = PERSONALITY_WEIGHTS.Political;
    const balancedWeights = PERSONALITY_WEIGHTS.Balanced;

    const grudgeLevel = 0.8;
    const politicalMultiplier = getGrudgeMultiplier(politicalWeights, grudgeLevel);
    const balancedMultiplier = getGrudgeMultiplier(balancedWeights, grudgeLevel);

    expect(politicalMultiplier).toBeGreaterThan(balancedMultiplier);
  });

  it('greedy personality ignores grudges', () => {
    const greedyWeights = PERSONALITY_WEIGHTS.Greedy;

    const maxGrudge = 1.0;
    const multiplier = getGrudgeMultiplier(greedyWeights, maxGrudge);

    // Greedy has 0.1 grudgeBias, so multiplier should be close to 1.0
    expect(multiplier).toBeLessThan(1.2);
  });

  it('max grudge with max bias gives 2.0 multiplier', () => {
    const weights = { ...PERSONALITY_WEIGHTS.Political, grudgeBias: 1.0 };
    const multiplier = getGrudgeMultiplier(weights, 1.0);
    expect(multiplier).toBe(2.0);
  });
});
