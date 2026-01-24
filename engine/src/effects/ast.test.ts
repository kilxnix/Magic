import { describe, expect, it } from 'vitest';

import type { DealDamageEffect, TriggeredAbility } from './ast';

describe('effects AST types', () => {
  it('can construct a DealDamage effect with a chosen target', () => {
    const eff: DealDamageEffect = {
      kind: 'DealDamage',
      source: { kind: 'ThisSpell' },
      target: { kind: 'Chosen', targetId: 'some_target_id' },
      amount: 3,
    };

    expect(eff.kind).toBe('DealDamage');
    expect(eff.amount).toBe(3);
    expect(eff.target.kind).toBe('Chosen');
  });

  it('can construct an ETB TriggeredAbility node', () => {
    const ability: TriggeredAbility = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'ETB', who: 'self' },
      effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: 1 }],
    };

    expect(ability.trigger.kind).toBe('ETB');
    expect(ability.effects).toHaveLength(1);
    expect(ability.effects[0].kind).toBe('Draw');
  });
});
