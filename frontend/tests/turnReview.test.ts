import { describe, expect, it } from 'vitest';
import {
  actionIdentity,
  coachMessageFromDecision,
  playByPlayFromDecision,
  ratingFromDecisionDelta,
  type DecisionReview,
} from '../src/lib/turnReview';

function decision(overrides: Partial<DecisionReview> = {}): DecisionReview {
  return {
    schemaVersion: 1,
    evaluator: 'engine-heuristic-v1',
    decisionId: 'test',
    phase: 'precombat_main',
    step: 'main',
    legalActionCount: 3,
    selected: { actionType: 'CastSpell', label: 'Cast Shock', score: 2 },
    best: { actionType: 'CastSpell', label: 'Cast Lightning Strike', score: 7 },
    alternatives: [],
    scoreDelta: 5,
    confidence: 'high',
    confidenceReasons: [],
    rulesAudit: { ok: true },
    elapsedMs: 1,
    ...overrides,
  };
}

describe('turn review helpers', () => {
  it('maps evaluator deltas to review ratings', () => {
    expect(ratingFromDecisionDelta(0, true)).toBe('excellent');
    expect(ratingFromDecisionDelta(1, false)).toBe('good');
    expect(ratingFromDecisionDelta(3, false)).toBe('okay');
    expect(ratingFromDecisionDelta(6, false)).toBe('bad');
    expect(ratingFromDecisionDelta(12, false)).toBe('blunder');
  });

  it('creates stable identities for target-sensitive actions', () => {
    expect(actionIdentity({ kind: 'CastSpell', cardInstanceId: 'card-1', targets: ['target-1'] }))
      .toBe('CastSpell:card-1:target-1:');
    expect(actionIdentity({ kind: 'PassPriority' })).toBe('PassPriority');
  });

  it('writes post-game play-by-play from a captured decision', () => {
    expect(playByPlayFromDecision('Cast Shock', decision()))
      .toContain('preferred Cast Lightning Strike by 5.0 points');
    expect(playByPlayFromDecision('Cast Shock', decision({
      best: { actionType: 'CastSpell', label: 'Cast Shock', score: 2 },
      scoreDelta: 0,
    }))).toContain('strong available line');
  });

  it('adds Xenagos-specific coaching when the decision involves key deck lines', () => {
    const message = coachMessageFromDecision(decision({
      selected: { actionType: 'CastSpell', label: 'Cast Terror of the Peaks', score: 4 },
      best: { actionType: 'CastSpell', label: 'Cast Dracogenesis', score: 8 },
      alternatives: [
        { actionType: 'CastSpell', label: 'Cast Dracogenesis', score: 8 },
        { actionType: 'CastSpell', label: 'Cast Terror of the Peaks', score: 4 },
      ],
      scoreDelta: 4,
    }));

    expect(message).toContain('Xenagos focus');
    expect(message).toContain('ETB damage spot');
  });
});
