import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';

/**
 * Coverage tests for player-effect matchers added to parser.ts:
 *  - matchTargetPlayerLoseLife   ("target player/opponent loses N life")
 *  - matchTargetPlayerGainLife   ("target player/opponent gains N life")
 *  - matchEachPlayerGainLife     ("each player gains N life")
 *  - matchTargetPlayerDiscardAtRandom ("target player discards N cards at random")
 *
 * Each asserts the effect kind, the player TargetRef, the count/amount, and (for
 * targeted variants) that a single Player target spec is generated. All emitted
 * effect+target combinations are handled honestly by the executor:
 *  - LoseLife / GainLife: EachPlayer loop + resolveTargetRef(Chosen Player)
 *  - Discard: resolveTargetRef(Chosen Player) and executeDiscard honors `random`
 */

function spell(text: string) {
  const parsed = parseOracleText(text);
  expect(parsed.kind).toBe('Spell');
  return parsed as Extract<ReturnType<typeof parseOracleText>, { kind: 'Spell' }>;
}

describe('target player loses N life', () => {
  it('parses "Target player loses 3 life."', () => {
    const p = spell('Target player loses 3 life.');
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('LoseLife');
    if (e.kind !== 'LoseLife') throw new Error('wrong kind');
    expect(e.player).toEqual({ kind: 'Chosen', targetId: 'target_1' });
    expect(e.amount).toBe(3);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
  });

  it('treats "target opponent loses N life" as a chosen Player target', () => {
    const p = spell('Target opponent loses 5 life.');
    const e = p.effects[0];
    expect(e.kind).toBe('LoseLife');
    if (e.kind !== 'LoseLife') throw new Error('wrong kind');
    expect(e.player).toEqual({ kind: 'Chosen', targetId: 'target_1' });
    expect(e.amount).toBe(5);
    expect(p.targets).toHaveLength(1);
  });

  it('handles word numbers ("two")', () => {
    const p = spell('Target player loses two life.');
    const e = p.effects[0];
    if (e.kind !== 'LoseLife') throw new Error('wrong kind');
    expect(e.amount).toBe(2);
  });
});

describe('target player gains N life', () => {
  it('parses to a chosen Player, not the controller', () => {
    const p = spell('Target player gains 4 life.');
    const e = p.effects[0];
    expect(e.kind).toBe('GainLife');
    if (e.kind !== 'GainLife') throw new Error('wrong kind');
    expect(e.player).toEqual({ kind: 'Chosen', targetId: 'target_1' });
    expect(e.amount).toBe(4);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
  });
});

describe('each player gains N life', () => {
  it('parses to an EachPlayer ref with no targets', () => {
    const p = spell('Each player gains 3 life.');
    const e = p.effects[0];
    expect(e.kind).toBe('GainLife');
    if (e.kind !== 'GainLife') throw new Error('wrong kind');
    expect(e.player).toEqual({ kind: 'EachPlayer' });
    expect(e.amount).toBe(3);
    expect(p.targets).toHaveLength(0);
  });
});

describe('target player discards N cards at random', () => {
  it('sets the random flag and a chosen Player target', () => {
    const p = spell('Target player discards two cards at random.');
    const e = p.effects[0];
    expect(e.kind).toBe('Discard');
    if (e.kind !== 'Discard') throw new Error('wrong kind');
    expect(e.player).toEqual({ kind: 'Chosen', targetId: 'target_1' });
    expect(e.count).toBe(2);
    expect(e.random).toBe(true);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
  });

  it('parses the X-style "discards X cards at random" with a numeric N too', () => {
    const p = spell('Target opponent discards 3 cards at random.');
    const e = p.effects[0];
    if (e.kind !== 'Discard') throw new Error('wrong kind');
    expect(e.count).toBe(3);
    expect(e.random).toBe(true);
  });
});
