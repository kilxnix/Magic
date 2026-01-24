import { describe, it, expect } from 'vitest';
import { CombatState } from './types';

describe('Combat Types', () => {
  it('CombatState tracks attackers mapped to defending players', () => {
    const combat: CombatState = {
      attackers: [{ cardInstanceId: 'inst_1', defendingPlayerId: 'p2' }],
      blockers: [],
      damageAssignment: new Map(),
    };
    expect(combat.attackers[0].defendingPlayerId).toBe('p2');
  });

  it('CombatState tracks blockers mapped to attackers', () => {
    const combat: CombatState = {
      attackers: [{ cardInstanceId: 'inst_1', defendingPlayerId: 'p2' }],
      blockers: [{ cardInstanceId: 'inst_2', blockingAttackerId: 'inst_1' }],
      damageAssignment: new Map(),
    };
    expect(combat.blockers[0].blockingAttackerId).toBe('inst_1');
  });
});
