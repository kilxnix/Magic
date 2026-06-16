import { describe, expect, it } from 'vitest';
import { priority } from '../../../src/play/selectors/priority';
import { makeLegalAction } from '../fixtures/simpleState';

describe('priority', () => {
  it('reports hasPriority from isHumanTurn', () => {
    const ctx = priority({ isHumanTurn: true, legalActions: [], phase: 'precombat_main', step: 'main' });
    expect(ctx.hasPriority).toBe(true);
  });

  it('canPass is true whenever the human has priority (no dead-ends)', () => {
    // Even with no legal actions at all, if it's the human's window they can pass.
    const ctx = priority({ isHumanTurn: true, legalActions: [], phase: 'precombat_main', step: 'main' });
    expect(ctx.canPass).toBe(true);
  });

  it('canPass is false when the human does not have priority', () => {
    const ctx = priority({ isHumanTurn: false, legalActions: [], phase: 'precombat_main', step: 'main' });
    expect(ctx.canPass).toBe(false);
  });

  it('hasMeaningfulResponse is true when a non-pass action exists', () => {
    const ctx = priority({
      isHumanTurn: true,
      legalActions: [
        makeLegalAction({ kind: 'CastSpell', cardInstanceId: 'c1', label: 'Cast' }),
        makeLegalAction({ kind: 'PassPriority', label: 'Pass' }),
      ],
      phase: 'precombat_main',
      step: 'main',
    });
    expect(ctx.hasMeaningfulResponse).toBe(true);
  });

  it('hasMeaningfulResponse is false when only pass/skip actions exist', () => {
    const ctx = priority({
      isHumanTurn: true,
      legalActions: [
        makeLegalAction({ kind: 'PassPriority', label: 'Pass' }),
        makeLegalAction({ kind: 'SkipEmptyPhases', label: 'Skip' }),
      ],
      phase: 'precombat_main',
      step: 'main',
    });
    expect(ctx.hasMeaningfulResponse).toBe(false);
  });

  it('builds a human-readable phase label', () => {
    expect(priority({ isHumanTurn: true, legalActions: [], phase: 'precombat_main', step: 'main' }).phaseLabel)
      .toBe('Main Phase 1');
    expect(priority({ isHumanTurn: true, legalActions: [], phase: 'combat', step: 'declare_attackers' }).phaseLabel)
      .toBe('Declare Attackers');
    expect(priority({ isHumanTurn: true, legalActions: [], phase: 'postcombat_main', step: 'main' }).phaseLabel)
      .toBe('Main Phase 2');
  });

  it('exposes the hold-priority capability from the input flag', () => {
    expect(priority({ isHumanTurn: true, legalActions: [], phase: 'beginning', step: 'upkeep', canHold: true }).canHold)
      .toBe(true);
    expect(priority({ isHumanTurn: true, legalActions: [], phase: 'beginning', step: 'upkeep' }).canHold)
      .toBe(false);
  });
});
