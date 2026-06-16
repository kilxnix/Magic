import { describe, expect, it } from 'vitest';
import { parseOracleText } from '../effects/parser';

/**
 * Parse-coverage batch: each new matcher maps oracle text onto effects that the
 * executor already runs (Discard, ModifyPT/AllCreatures, Destroy with color
 * constraints), so asserting the parsed AST is the honesty bar here.
 */
describe('discard with word-numbers and player forms', () => {
  it('parses "target player discards two cards"', () => {
    const r = parseOracleText('Target player discards two cards.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const d = r.effects.find(e => e.kind === 'Discard') as Extract<typeof r.effects[number], { kind: 'Discard' }>;
    expect(d).toBeTruthy();
    expect(d.count).toBe(2);
  });

  it('parses "target opponent discards their hand"', () => {
    const r = parseOracleText('Target opponent discards their hand.');
    expect(r.kind).toBe('Spell');
  });

  it('parses "each opponent discards a card"', () => {
    const r = parseOracleText('Each opponent discards a card.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const d = r.effects.find(e => e.kind === 'Discard') as Extract<typeof r.effects[number], { kind: 'Discard' }>;
    expect(d.player.kind).toBe('EachOpponent');
    expect(d.count).toBe(1);
  });
});

describe('all-creatures mass pump/shrink', () => {
  it('parses "all creatures get -2/-0 until end of turn" onto AllCreatures', () => {
    const r = parseOracleText('All creatures get -2/-0 until end of turn.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const m = r.effects.find(e => e.kind === 'ModifyPT') as Extract<typeof r.effects[number], { kind: 'ModifyPT' }>;
    expect(m.target.kind).toBe('AllCreatures');
    expect(m.power).toBe(-2);
    expect(m.toughness === 0).toBe(true); // parseInt('-0') is -0; === treats it as 0
  });
});

describe('dual/tri-color target constraints', () => {
  it('parses "destroy target white or blue creature" with both colors', () => {
    const r = parseOracleText('Destroy target white or blue creature.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.targets[0].constraints?.colors?.sort()).toEqual(['U', 'W']);
  });

  it('parses damage to "target white or blue creature"', () => {
    const r = parseOracleText('~ deals 4 damage to target white or blue creature.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.targets[0].constraints?.colors?.sort()).toEqual(['U', 'W']);
  });

  it('still parses single-color and plain creature targets', () => {
    expect(parseOracleText('Destroy target red creature.').kind).toBe('Spell');
    expect(parseOracleText('Destroy target creature.').kind).toBe('Spell');
    expect(parseOracleText('Destroy target nonblack creature.').kind).toBe('Spell');
  });
});
