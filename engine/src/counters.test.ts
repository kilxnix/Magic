import { describe, it, expect } from 'vitest';
import { makeTestState } from './__tests__/test-helpers';
import { hasKeyword } from './keywords';

describe('keyword counters grant keywords', () => {
  it('creature with a flying counter has flying', () => {
    const state = makeTestState({ battlefieldCreature: true });
    const creature = [...state.cards.values()].find(c => c.zone === 'battlefield')!;
    state.cards.set(creature.instanceId, { ...creature, counters: { ...creature.counters, flying: 1 } });
    expect(hasKeyword(state, creature.instanceId, 'flying')).toBe(true);
  });

  it('creature without flying counter does not have flying', () => {
    const state = makeTestState({ battlefieldCreature: true });
    const creature = [...state.cards.values()].find(c => c.zone === 'battlefield')!;
    expect(hasKeyword(state, creature.instanceId, 'flying')).toBe(false);
  });

  it('creature loses flying when flying counter is removed', () => {
    const state = makeTestState({ battlefieldCreature: true });
    const creature = [...state.cards.values()].find(c => c.zone === 'battlefield')!;
    state.cards.set(creature.instanceId, { ...creature, counters: { flying: 1 } });
    expect(hasKeyword(state, creature.instanceId, 'flying')).toBe(true);

    const updated = state.cards.get(creature.instanceId)!;
    state.cards.set(creature.instanceId, { ...updated, counters: {} });
    expect(hasKeyword(state, creature.instanceId, 'flying')).toBe(false);
  });
});
