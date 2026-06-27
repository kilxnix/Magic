import { describe, expect, it, vi } from 'vitest';
import { frameSignature, createFrameCache, frameSpec } from './cardFrame';
import type { Placement } from './placements';

function p(over: Partial<Placement>): Placement {
  return { id: 'x', name: 'Forest', seatIndex: 0, row: 'lands', position: [0, 0, 0], tapped: false, typeKind: 'other', isOwn: true, ...over };
}

describe('frameSignature', () => {
  it('is equal for identical cards', () => {
    expect(frameSignature(p({}))).toBe(frameSignature(p({ id: 'other' })));
  });
  it('differs by power/toughness', () => {
    expect(frameSignature(p({ power: 2, toughness: 2 }))).not.toBe(frameSignature(p({ power: 3, toughness: 3 })));
  });
  it('differs by counters', () => {
    expect(frameSignature(p({ counters: { '+1/+1': 1 } }))).not.toBe(frameSignature(p({})));
  });
});

describe('createFrameCache', () => {
  it('calls make once per distinct signature', () => {
    const make = vi.fn((c: Placement) => ({ tex: c.name }));
    const cache = createFrameCache(make);
    cache.get(p({ id: 'a' }));
    cache.get(p({ id: 'b' })); // same signature as a
    cache.get(p({ id: 'c', name: 'Island' }));
    expect(make).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(2);
  });
});

describe('frameSpec', () => {
  it('tints a mono-green creature green and shows its P/T', () => {
    const s = frameSpec(p({ typeKind: 'creature', colorIdentity: ['G'], manaCost: '{1}{G}', power: 3, toughness: 3 }));
    expect(s.tint).toBe('#1c6b3c');
    expect(s.pt).toBe('3/3');
    expect(s.manaPips).toEqual(['1', 'G']);
  });
  it('tints a multicolor card gold', () => {
    expect(frameSpec(p({ colorIdentity: ['W', 'U'], manaCost: '{W}{U}' })).tint).toBe('#c9a227');
  });
  it('tints a colorless land brown and has no P/T', () => {
    const s = frameSpec(p({ typeKind: 'land', colorIdentity: [], manaCost: '' }));
    expect(s.tint).toBe('#6b4f2a');
    expect(s.pt).toBeNull();
  });
});

describe('frameSignature varies by frame-relevant fields', () => {
  it('differs by manaCost', () => {
    expect(frameSignature(p({ name: 'X', manaCost: '{G}' }))).not.toBe(frameSignature(p({ name: 'X', manaCost: '{R}' })));
  });
});
