import { describe, it, expect } from 'vitest';
import { LoopDetector } from './win-conditions';
import { makeTestState } from './__tests__/test-helpers';

describe('LoopDetector state_repeat', () => {
  it('flags loop after same fingerprint appears 3 times', () => {
    const detector = new LoopDetector();
    const state = makeTestState({});
    expect(detector.observe(state, 'pass')).toBeNull();
    expect(detector.observe(state, 'pass')).toBeNull();
    const sig = detector.observe(state, 'pass');
    expect(sig).not.toBeNull();
    expect(sig?.category).toBe('state_repeat');
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
