import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import type { Effect } from '../effects/ast';

function effects(text: string): Effect[] {
  const parsed = parseOracleText(text);
  expect(parsed.kind).toBe('Spell');
  if (parsed.kind !== 'Spell') throw new Error('not a spell');
  return parsed.effects;
}

describe('counters: remove N <type> counter from target permanent', () => {
  it('parses "Remove a -1/-1 counter from target creature." (Chainbreaker)', () => {
    const fx = effects('Remove a -1/-1 counter from target creature.');
    expect(fx).toHaveLength(1);
    expect(fx[0].kind).toBe('RemoveCounters');
    const e = fx[0] as Extract<Effect, { kind: 'RemoveCounters' }>;
    expect(e.counterType).toBe('-1/-1');
    expect(e.count).toBe(1);
    expect(e.target.kind).toBe('Chosen');
  });

  it('parses a numeric count and "counters" plural', () => {
    const fx = effects('Remove two +1/+1 counters from target creature.');
    const e = fx[0] as Extract<Effect, { kind: 'RemoveCounters' }>;
    expect(e.kind).toBe('RemoveCounters');
    expect(e.counterType).toBe('+1/+1');
    expect(e.count).toBe(2);
    expect(e.target.kind).toBe('Chosen');
  });

  it('parses "from target artifact" with a Chosen artifact target', () => {
    const parsed = parseOracleText('Remove a charge counter from target artifact.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const e = parsed.effects[0] as Extract<Effect, { kind: 'RemoveCounters' }>;
    expect(e.kind).toBe('RemoveCounters');
    expect(e.counterType).toBe('charge');
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Artifact');
  });

  it('parses "you control" constraint on the target', () => {
    const parsed = parseOracleText('Remove a stun counter from target creature you control.');
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    expect(parsed.targets[0].constraints?.controllerControls).toBe(true);
  });

  it('still leaves self-reference removal to the base matcher (Source target)', () => {
    const fx = effects('Remove a +1/+1 counter from it.');
    const e = fx[0] as Extract<Effect, { kind: 'RemoveCounters' }>;
    expect(e.kind).toBe('RemoveCounters');
    expect(e.target).toEqual({ kind: 'Source' });
  });
});

describe('counters: put on enchanted/equipped creature (SourceAttachedTo)', () => {
  it('parses "Put a +1/+1 counter on enchanted creature." (Forced Adaptation)', () => {
    const fx = effects('Put a +1/+1 counter on enchanted creature.');
    expect(fx).toHaveLength(1);
    expect(fx[0].kind).toBe('AddCounters');
    const e = fx[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(e.counterType).toBe('+1/+1');
    expect(e.count).toBe(1);
    expect(e.target).toEqual({ kind: 'SourceAttachedTo' });
  });

  it('parses "Put two +1/+1 counters on equipped creature."', () => {
    const fx = effects('Put two +1/+1 counters on equipped creature.');
    const e = fx[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(e.kind).toBe('AddCounters');
    expect(e.count).toBe(2);
    expect(e.target).toEqual({ kind: 'SourceAttachedTo' });
  });

  it('does NOT match a trailing conditional ("if it is red") to avoid wrong semantics', () => {
    const parsed = parseOracleText('Put a +1/+1 counter on equipped creature if it is red.');
    // Should not be a clean single AddCounters/SourceAttachedTo spell — the
    // conditional tail makes matchAddCountersAttached bail.
    if (parsed.kind === 'Spell') {
      const e = parsed.effects[0] as Extract<Effect, { kind: 'AddCounters' }>;
      expect(e?.target).not.toEqual({ kind: 'SourceAttachedTo' });
    } else {
      expect(parsed.kind).not.toBe('Spell');
    }
  });
});

describe('counters: you get N <type> counter(s) (Controller player counters)', () => {
  it('parses "You get a poison counter." as Controller AddCounters poison', () => {
    const fx = effects('You get a poison counter.');
    expect(fx).toHaveLength(1);
    expect(fx[0].kind).toBe('AddCounters');
    const e = fx[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(e.counterType).toBe('poison');
    expect(e.count).toBe(1);
    expect(e.target).toEqual({ kind: 'Controller' });
  });

  it('parses a numeric count: "You get 2 experience counters."', () => {
    const fx = effects('You get 2 experience counters.');
    const e = fx[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(e.kind).toBe('AddCounters');
    expect(e.counterType).toBe('experience');
    expect(e.count).toBe(2);
    expect(e.target).toEqual({ kind: 'Controller' });
  });

  it('does not hijack "you get {E}" energy (still parses as energy AddCounters)', () => {
    const fx = effects('You get {E}{E}.');
    const e = fx[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(e.kind).toBe('AddCounters');
    expect(e.counterType).toBe('energy');
    expect(e.count).toBe(2);
  });
});
