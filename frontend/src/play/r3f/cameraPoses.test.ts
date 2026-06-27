import { describe, expect, it } from 'vitest';
import { defaultPose, focusPose, lerpPose, easeInOut } from './cameraPoses';

describe('defaultPose', () => {
  it('is centered, raised, and pulled back', () => {
    const p = defaultPose(2);
    expect(p.position[0]).toBeCloseTo(0); // centered on X
    expect(p.position[1]).toBeGreaterThan(0); // above the table
    expect(p.position[2]).toBeGreaterThan(0); // on the +Z (viewer) side
  });

  it('lifts and pulls back as seats increase', () => {
    const two = defaultPose(2);
    const four = defaultPose(4);
    expect(four.position[1]).toBeGreaterThan(two.position[1]);
    expect(four.position[2]).toBeGreaterThan(two.position[2]);
  });
});

describe('focusPose', () => {
  it('places the camera in front of the board on +Z and above its target', () => {
    // seat 1 of 4 sits on +X; its board faces global +Z like every board.
    const p = focusPose(1, 4);
    expect(p.position[2]).toBeGreaterThan(p.target[2]); // camera is +Z of the board it faces
    expect(p.position[1]).toBeGreaterThan(p.target[1]); // and elevated
    expect(p.position[0]).toBeCloseTo(p.target[0]); // horizontally centered on the board
  });

  it('aims at the chosen seat, not the center', () => {
    const acrossTable = focusPose(2, 4); // -Z seat
    expect(acrossTable.target[2]).toBeLessThan(0); // looks toward the far board
  });
});

describe('lerpPose', () => {
  const a = defaultPose(4);
  const b = focusPose(2, 4);

  it('returns the endpoints at t=0 and t=1', () => {
    expect(lerpPose(a, b, 0)).toEqual(a);
    expect(lerpPose(a, b, 1)).toEqual(b);
  });

  it('interpolates the midpoint', () => {
    const mid = lerpPose(a, b, 0.5);
    expect(mid.position[1]).toBeCloseTo((a.position[1] + b.position[1]) / 2);
    expect(mid.target[2]).toBeCloseTo((a.target[2] + b.target[2]) / 2);
  });

  it('clamps t outside [0,1]', () => {
    expect(lerpPose(a, b, -1)).toEqual(a);
    expect(lerpPose(a, b, 2)).toEqual(b);
  });
});

describe('easeInOut', () => {
  it('pins endpoints and is symmetric at the midpoint', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });
});
