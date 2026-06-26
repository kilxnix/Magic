import { describe, expect, it } from 'vitest';
import { seatTransform, zoneSlotLocal, worldSlot, SEAT_R, ROW_Z } from './layout';

describe('seatTransform', () => {
  it('places you (index 0) at +Z facing center with no rotation', () => {
    const t = seatTransform(0, 2);
    expect(t.position[0]).toBeCloseTo(0);
    expect(t.position[2]).toBeCloseTo(SEAT_R);
    expect(t.rotationY).toBeCloseTo(0);
  });

  it('places the opposite seat (index 1 of 2) at -Z, half-turn rotated', () => {
    const t = seatTransform(1, 2);
    expect(t.position[2]).toBeCloseTo(-SEAT_R);
    expect(t.rotationY).toBeCloseTo(Math.PI);
  });

  it('gives distinct rotations to four seats', () => {
    const ys = [0, 1, 2, 3].map((i) => seatTransform(i, 4).rotationY);
    expect(new Set(ys.map((y) => y.toFixed(3))).size).toBe(4);
  });
});

describe('zoneSlotLocal', () => {
  it('centers a single slot at local x=0', () => {
    expect(zoneSlotLocal('creatures', 0, 1)[0]).toBeCloseTo(0);
  });

  it('spreads slots symmetrically around x=0', () => {
    const a = zoneSlotLocal('lands', 0, 2)[0];
    const b = zoneSlotLocal('lands', 1, 2)[0];
    expect(a).toBeCloseTo(-b);
    expect(a).toBeLessThan(b);
  });

  it('puts creatures nearer table center than lands', () => {
    // local +Z points toward the player, so smaller z = nearer center.
    expect(ROW_Z.creatures).toBeLessThan(ROW_Z.lands);
  });
});

describe('worldSlot', () => {
  it('for you (seat 0) matches seat position plus local slot', () => {
    const w = worldSlot(0, 2, 'creatures', 0, 1);
    expect(w[0]).toBeCloseTo(0);
    expect(w[2]).toBeCloseTo(SEAT_R + ROW_Z.creatures);
  });

  it('rotates the local frame for the opposite seat', () => {
    // seat 1 of 2 is half-turned: a +x local offset becomes -x in world.
    const w0 = worldSlot(1, 2, 'lands', 0, 2);
    const w1 = worldSlot(1, 2, 'lands', 1, 2);
    expect(w0[0]).toBeCloseTo(-zoneSlotLocal('lands', 0, 2)[0]);
    expect(w1[0]).toBeCloseTo(-zoneSlotLocal('lands', 1, 2)[0]);
  });
});
