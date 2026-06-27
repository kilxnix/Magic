import { describe, expect, it } from 'vitest';
import { makeProjector, projectToScreen, type CameraPose } from './projection';

const pose: CameraPose = { position: [0, 10, 10], target: [0, 0, 0], fov: 50 };
const W = 800;
const H = 600;

describe('makeProjector / projectToScreen', () => {
  it('projects the camera target to roughly screen center', () => {
    const p = projectToScreen([0, 0, 0], pose, W, H);
    expect(p.behind).toBe(false);
    expect(p.x).toBeCloseTo(W / 2, 0);
    expect(p.y).toBeCloseTo(H / 2, 0);
  });

  it('projects a point left-of-center to the left half', () => {
    const p = projectToScreen([-3, 0, 0], pose, W, H);
    expect(p.behind).toBe(false);
    expect(p.x).toBeLessThan(W / 2);
  });

  it('flags points behind the camera', () => {
    // Camera at z=10 looking toward origin (-z); a point well behind it (z=30).
    const p = projectToScreen([0, 10, 30], pose, W, H);
    expect(p.behind).toBe(true);
  });

  it('reuses one projector across points', () => {
    const project = makeProjector(pose, W, H);
    const a = project([0, 0, 0]);
    const b = project([2, 0, 0]);
    expect(b.x).toBeGreaterThan(a.x); // +x world → further right on screen
  });

  it('does not divide by zero for an unmeasured (0x0) canvas', () => {
    const p = projectToScreen([0, 0, 0], pose, 0, 0);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});
