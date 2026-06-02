import { describe, it, expect } from 'vitest';
import { LoopDetector } from './win-conditions';
import { makeTestState } from './__tests__/test-helpers';

describe('LoopDetector state_repeat', () => {
  it('flags loop when a cycle of two states repeats 3 times', () => {
    // A genuine infinite loop cycles through distinct states, e.g. A → B → A → B → A → B.
    // The third occurrence of A trips the threshold.
    const detector = new LoopDetector();
    const stateA = makeTestState({});
    const stateB = makeTestState({});
    stateA.players[0] = { ...stateA.players[0], life: 40 };
    stateB.players[0] = { ...stateB.players[0], life: 41 };

    expect(detector.observe(stateA, 'a')).toBeNull(); // 1st A
    expect(detector.observe(stateB, 'b')).toBeNull(); // 1st B
    expect(detector.observe(stateA, 'a')).toBeNull(); // 2nd A
    expect(detector.observe(stateB, 'b')).toBeNull(); // 2nd B
    const sig = detector.observe(stateA, 'a');         // 3rd A — flags
    expect(sig).not.toBeNull();
    expect(sig?.category).toBe('state_repeat');
  });

  it('static stalls do not flag a loop (same state observed many times)', () => {
    // The user is stuck on a step (e.g. cleanup-discard) and the engine observes the
    // same state repeatedly. This is not a loop — count only when fingerprint changes.
    const detector = new LoopDetector();
    const state = makeTestState({});
    for (let i = 0; i < 10; i++) {
      expect(detector.observe(state, 'pass')).toBeNull();
    }
  });

  it('distinct states do not flag a loop', () => {
    const detector = new LoopDetector();
    const s1 = makeTestState({});
    const s2 = makeTestState({});
    const s3 = makeTestState({});
    s1.players[0] = { ...s1.players[0], life: 40 };
    s2.players[0] = { ...s2.players[0], life: 39 };
    s3.players[0] = { ...s3.players[0], life: 38 };
    expect(detector.observe(s1, 'a')).toBeNull();
    expect(detector.observe(s2, 'a')).toBeNull();
    expect(detector.observe(s3, 'a')).toBeNull();
  });

  it('normal repeated board shapes on later turns do not flag a loop', () => {
    const detector = new LoopDetector();
    for (let turn = 1; turn <= 8; turn += 1) {
      const state = makeTestState({});
      state.turnNumber = turn;
      state.phase = 'precombat_main';
      state.step = 'upkeep';
      state.activePlayerIndex = 0;
      expect(detector.observe(state, 'turn')).toBeNull();
    }
  });
});

describe('LoopDetector unbounded_growth', () => {
  it('flags loop when total life swings by > 1000 in one step', () => {
    const detector = new LoopDetector();
    const before = makeTestState({});
    before.players[0] = { ...before.players[0], life: 40 };
    const after = makeTestState({});
    after.players[0] = { ...after.players[0], life: 2000 };
    detector.observe(before, 'pre');
    const sig = detector.observe(after, 'ability');
    expect(sig?.category).toBe('unbounded_growth');
  });
});

describe('LoopDetector reset', () => {
  it('reset clears history', () => {
    const detector = new LoopDetector();
    const state = makeTestState({});
    detector.observe(state, 'a');
    detector.observe(state, 'a');
    detector.reset();
    expect(detector.observe(state, 'a')).toBeNull();
  });
});

describe('LoopDetector trigger_self_loop', () => {
  it('flags loop when same source triggers > 50 times', () => {
    const detector = new LoopDetector();
    for (let i = 0; i < 50; i++) {
      expect(detector.recordTrigger('worldgorger_dragon_1')).toBeNull();
    }
    const sig = detector.recordTrigger('worldgorger_dragon_1');
    expect(sig).not.toBeNull();
    expect(sig?.category).toBe('trigger_self_loop');
    expect(sig?.sources).toContain('worldgorger_dragon_1');
  });

  it('resetTriggers clears per-source counts', () => {
    const detector = new LoopDetector();
    for (let i = 0; i < 50; i++) detector.recordTrigger('source_a');
    detector.resetTriggers();
    expect(detector.recordTrigger('source_a')).toBeNull();
  });

  it('reset also clears trigger counts', () => {
    const detector = new LoopDetector();
    for (let i = 0; i < 50; i++) detector.recordTrigger('source_a');
    detector.reset();
    expect(detector.recordTrigger('source_a')).toBeNull();
  });
});
