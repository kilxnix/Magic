import { describe, expect, it, vi } from 'vitest';
import { frameSignature, createFrameCache } from './cardFrame';
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
