import { describe, it, expect } from 'vitest';
import { makeTestState } from './__tests__/test-helpers';
import { hasKeyword } from './keywords';
import { performUntapStep } from './turn-manager';

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

describe('stun counters', () => {
  it('stun counter prevents untap and is consumed', () => {
    // Use battlefieldCreatureWithAbility + tapCreatures so the creature starts tapped
    const state = makeTestState({ battlefieldCreatureWithAbility: true, tapCreatures: true });
    const creature = [...state.cards.values()].find(c => c.zone === 'battlefield')!;
    // Add stun counter
    state.cards.set(creature.instanceId, { ...creature, counters: { stun: 1 } });

    const afterUntap = performUntapStep(state);

    const updated = afterUntap.cards.get(creature.instanceId)!;
    expect(updated.tapped).toBe(true);          // still tapped
    expect(updated.counters.stun ?? 0).toBe(0); // counter consumed
  });

  it('permanent with no stun counter untaps normally', () => {
    const state = makeTestState({ battlefieldCreatureWithAbility: true, tapCreatures: true });
    const afterUntap = performUntapStep(state);
    const creature = [...afterUntap.cards.values()].find(c => c.zone === 'battlefield')!;
    expect(creature.tapped).toBe(false);
  });
});
