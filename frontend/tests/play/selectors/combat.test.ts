import { describe, expect, it } from 'vitest';
import { combat } from '../../../src/play/selectors/combat';
import { makeLegalAction } from '../fixtures/simpleState';

function attackAction(attacks: { cardInstanceId: string; defendingPlayerId: string }[]) {
  return makeLegalAction({
    kind: 'DeclareAttackers',
    label: 'Attack',
    _engineAction: { kind: 'DeclareAttackers', attacks } as never,
  });
}

function blockAction(blocks: { cardInstanceId: string; blockingAttackerId: string }[]) {
  return makeLegalAction({
    kind: 'DeclareBlockers',
    label: 'Block',
    _engineAction: { kind: 'DeclareBlockers', blocks } as never,
  });
}

describe('combat', () => {
  it('reports step none and no eligibles outside combat', () => {
    const ctx = combat({ step: 'main', legalActions: [] });
    expect(ctx.step).toBe('none');
    expect(ctx.eligibleIds).toEqual([]);
  });

  it('derives eligible attackers from DeclareAttackers actions', () => {
    const ctx = combat({
      step: 'declare_attackers',
      legalActions: [
        attackAction([{ cardInstanceId: 'a1', defendingPlayerId: 'ai1' }]),
        attackAction([{ cardInstanceId: 'a2', defendingPlayerId: 'ai1' }]),
      ],
    });
    expect(ctx.step).toBe('declare-attackers');
    expect(ctx.eligibleIds.sort()).toEqual(['a1', 'a2']);
  });

  it('derives eligible blockers from DeclareBlockers actions', () => {
    const ctx = combat({
      step: 'declare_blockers',
      legalActions: [
        blockAction([{ cardInstanceId: 'b1', blockingAttackerId: 'a1' }]),
        blockAction([{ cardInstanceId: 'b2', blockingAttackerId: 'a1' }]),
      ],
    });
    expect(ctx.step).toBe('declare-blockers');
    expect(ctx.eligibleIds.sort()).toEqual(['b1', 'b2']);
  });

  it('reports order-damage when a damage assignment choice is active', () => {
    const ctx = combat({
      step: 'combat_damage',
      legalActions: [],
      damageAssignmentChoice: { attackerInstanceId: 'a1', blockerInstanceIds: ['b1', 'b2'] },
    });
    expect(ctx.step).toBe('order-damage');
    expect(ctx.assignments['a1']).toEqual(['b1', 'b2']);
  });

  it('deduplicates eligible ids that appear in multiple actions', () => {
    const ctx = combat({
      step: 'declare_attackers',
      legalActions: [
        attackAction([{ cardInstanceId: 'a1', defendingPlayerId: 'ai1' }]),
        attackAction([{ cardInstanceId: 'a1', defendingPlayerId: 'ai2' }]),
      ],
    });
    expect(ctx.eligibleIds).toEqual(['a1']);
  });
});
