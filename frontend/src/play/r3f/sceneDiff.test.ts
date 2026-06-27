import { describe, expect, it } from 'vitest';
import { diffPlacements, lerpVec3 } from './sceneDiff';
import type { Placement } from './placements';

function p(id: string, pos: [number, number, number], tapped = false): Placement {
  return { id, name: id, seatIndex: 0, row: 'creatures', position: pos, tapped, typeKind: 'other', isOwn: true };
}

describe('diffPlacements', () => {
  it('reports entered ids', () => {
    const d = diffPlacements([], [p('a', [0, 0, 0])]);
    expect(d.entered).toEqual(['a']);
    expect(d.left).toEqual([]);
  });

  it('reports left ids', () => {
    const d = diffPlacements([p('a', [0, 0, 0])], []);
    expect(d.left).toEqual(['a']);
  });

  it('reports moved ids with from/to', () => {
    const d = diffPlacements([p('a', [0, 0, 0])], [p('a', [1, 0, 2])]);
    expect(d.moved).toEqual([{ id: 'a', from: [0, 0, 0], to: [1, 0, 2] }]);
  });

  it('does not report a stationary card as moved', () => {
    const d = diffPlacements([p('a', [0, 0, 0])], [p('a', [0, 0, 0])]);
    expect(d.moved).toEqual([]);
  });

  it('reports tap changes', () => {
    const d = diffPlacements([p('a', [0, 0, 0], false)], [p('a', [0, 0, 0], true)]);
    expect(d.tapChanged).toEqual([{ id: 'a', tapped: true }]);
  });
});

describe('lerpVec3', () => {
  it('interpolates at t=0.5', () => {
    expect(lerpVec3([0, 0, 0], [2, 4, 6], 0.5)).toEqual([1, 2, 3]);
  });
  it('clamps t', () => {
    expect(lerpVec3([0, 0, 0], [2, 2, 2], 2)).toEqual([2, 2, 2]);
    expect(lerpVec3([0, 0, 0], [2, 2, 2], -1)).toEqual([0, 0, 0]);
  });
});
